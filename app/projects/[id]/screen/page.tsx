'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { computeKappa, kappaLabel, kappaColor } from '@/lib/screen/kappa';
import { shouldCalibrate, selectCalibrationExamples, CALIBRATION_TRIGGER } from '@/lib/screen/calibration';
import type {
  ScreenState,
  ScreeningResult,
  ScreenDecision,
  ScreeningCriteria,
  AuditEntry,
  FewShotExample,
} from '@/lib/screen/types';
import type { SearchRecord } from '@/lib/search/types';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function makeAuditEntry(
  type: AuditEntry['type'],
  details: Record<string, unknown>
): AuditEntry {
  return { id: makeId(), timestamp: new Date().toISOString(), type, details };
}

function emptyState(): ScreenState {
  return {
    criteria: { inclusion: '', exclusion: '' },
    results: {},
    screeningProgress: 0,
    screeningComplete: false,
    kappa: null,
    calibrationExamples: [],
    humanCorrections: [],
    calibrationLog: [],
    auditLog: [],
  };
}

type Phase = 'setup' | 'screening' | 'done' | 'error';

function decisionBadge(decision: ScreenDecision): string {
  if (decision === 'include') return 'bg-green-100 text-green-800';
  if (decision === 'exclude') return 'bg-gray-100 text-gray-700';
  return 'bg-yellow-100 text-yellow-800';
}

function decisionLabel(d: ScreenDecision): string {
  if (d === 'include') return 'Include';
  if (d === 'exclude') return 'Exclude';
  return 'Flag';
}

// ─── component ───────────────────────────────────────────────────────────────

interface ScreenPageProps {
  params: Promise<{ id: string }>;
}

export default function ScreenPage({ params }: ScreenPageProps) {
  const [projectId, setProjectId] = useState<string>('');
  const router = useRouter();

  // Records from Phase 2
  const [records, setRecords] = useState<SearchRecord[]>([]);
  const [recordsLoaded, setRecordsLoaded] = useState(false);

  // Screen state
  const [state, setState] = useState<ScreenState>(emptyState());
  const stateRef = useRef<ScreenState>(emptyState());

  // Phase: 'setup' | 'screening' | 'done' | 'error'
  const [phase, setPhase] = useState<Phase>('setup');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [currentBatch, setCurrentBatch] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const abortRef = useRef(false);

  // UI toggles
  const [expandedAbstracts, setExpandedAbstracts] = useState<Set<string>>(new Set());
  const [showAllRecords, setShowAllRecords] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [calibrationNotice, setCalibrationNotice] = useState(false);

  // Resolve params
  useEffect(() => {
    params.then(({ id }) => setProjectId(id));
  }, [params]);

  // Load search results — DB first for records, then localStorage
  useEffect(() => {
    if (!projectId) return;

    async function loadSearchRecords() {
      try {
        const res = await fetch(`/api/state/${projectId}/search`);
        if (res.ok) {
          const data = (await res.json()) as { state: { records?: SearchRecord[] } | null };
          if (data.state?.records) {
            setRecords(data.state.records);
            setRecordsLoaded(true);
            return;
          }
        }
      } catch {
        // fall through
      }
      // Fallback: localStorage
      try {
        const raw = localStorage.getItem(`search_results_${projectId}`);
        if (raw) {
          const data = JSON.parse(raw) as { records: SearchRecord[] };
          setRecords(data.records ?? []);
        }
        // Also try search state key
        const raw2 = localStorage.getItem(`h-evidence-search-${projectId}`);
        if (raw2 && !localStorage.getItem(`search_results_${projectId}`)) {
          const data2 = JSON.parse(raw2) as { records?: SearchRecord[] };
          if (data2.records) setRecords(data2.records);
        }
      } catch {
        // ignore
      }
      setRecordsLoaded(true);
    }

    loadSearchRecords();
  }, [projectId]);

  // Load saved screen state — DB first, localStorage fallback
  useEffect(() => {
    if (!projectId) return;

    async function loadScreenState() {
      try {
        const res = await fetch(`/api/state/${projectId}/screen`);
        if (res.ok) {
          const data = (await res.json()) as { state: ScreenState | null };
          if (data.state && Object.keys(data.state).length > 0) {
            const saved = data.state;
            // Write-through to localStorage
            try {
              localStorage.setItem(`screen_state_${projectId}`, JSON.stringify(saved));
            } catch { /* ignore */ }
            stateRef.current = saved;
            setState(saved);
            if (saved.screeningComplete) setPhase('done');
            else if (Object.keys(saved.results).length > 0) setPhase('done');
            return;
          }
        }
      } catch {
        // fall through
      }
      // Fallback: localStorage
      try {
        const raw = localStorage.getItem(`screen_state_${projectId}`);
        if (raw) {
          const saved = JSON.parse(raw) as ScreenState;
          stateRef.current = saved;
          setState(saved);
          if (saved.screeningComplete) setPhase('done');
          else if (Object.keys(saved.results).length > 0) setPhase('done');
        }
      } catch {
        // ignore
      }
    }

    loadScreenState();
  }, [projectId]);

  // Persist state whenever it changes
  const persistState = useCallback(
    (s: ScreenState) => {
      if (!projectId) return;
      try {
        localStorage.setItem(`screen_state_${projectId}`, JSON.stringify(s));
      } catch {
        // ignore quota errors
      }
    },
    [projectId]
  );

  function updateState(updater: (prev: ScreenState) => ScreenState) {
    setState((prev) => {
      const next = updater(prev);
      stateRef.current = next;
      persistState(next);
      return next;
    });
  }

  // Elapsed timer
  useEffect(() => {
    if (phase !== 'screening') return;
    const start = Date.now();
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // ─── screening loop ───────────────────────────────────────────────────────

  // Three records per checkpoint keeps Groq requests within the free TPM limit
  // while avoiding the overhead of two model calls for every single record.
  const BATCH_SIZE = 3;

  async function runScreening() {
    const criteria = stateRef.current.criteria;
    const toScreen = records.filter(
      (r) => !r.isDuplicate && !stateRef.current.results[r.id]
    );

    if (toScreen.length === 0) {
      setPhase('done');
      return;
    }

    const batches = Math.ceil(toScreen.length / BATCH_SIZE);
    setTotalBatches(batches);
    setCurrentBatch(0);
    abortRef.current = false;
    setPhase('screening');
    setErrorMsg('');
    setElapsedSeconds(0);

    // Audit: screening started
    updateState((prev) => ({
      ...prev,
      auditLog: [
        ...prev.auditLog,
        makeAuditEntry('screening_started', {
          totalRecords: toScreen.length,
          criteria,
        }),
      ],
    }));

    for (let i = 0; i < toScreen.length; i += BATCH_SIZE) {
      if (abortRef.current) break;

      const batch = toScreen.slice(i, i + BATCH_SIZE).map((r) => ({
        id: r.id,
        title: r.title,
        abstract: r.abstract ?? '',
      }));

      const batchIndex = Math.floor(i / BATCH_SIZE);
      setCurrentBatch(batchIndex + 1);

      try {
        const res = await fetch('/api/screen/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            records: batch,
            criteria: stateRef.current.criteria,
            calibrationExamples: stateRef.current.calibrationExamples,
          }),
        });

        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }

        const data = (await res.json()) as { results: ScreeningResult[] };

        // Merge into state and build the exact checkpoint that will be written
        // to the project database. Do not rely on React's asynchronous state
        // update having completed before the save starts.
        let included = 0, excluded = 0, flagged = 0;
        const previous = stateRef.current;
        const newResults = { ...previous.results };
        for (const r of data.results) {
          newResults[r.recordId] = r;
          const d = r.consensusDecision ?? 'flag';
          if (d === 'include') included++;
          else if (d === 'exclude') excluded++;
          else flagged++;
        }
        const checkpoint: ScreenState = {
          ...previous,
          results: newResults,
          screeningProgress: Object.keys(newResults).length,
          auditLog: [
            ...previous.auditLog,
            makeAuditEntry('screening_batch_complete', {
              batchIndex,
              batchSize: batch.length,
              included,
              excluded,
              flagged,
            }),
          ],
        };
        stateRef.current = checkpoint;
        setState(checkpoint);
        persistState(checkpoint);

        setProgress(Math.min(i + BATCH_SIZE, toScreen.length));

        // Await every checkpoint so closing/reloading the page never discards a
        // completed (and potentially expensive) Ollama result.
        const saveRes = await fetch(`/api/state/${projectId}/screen`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: checkpoint }),
        });
        if (!saveRes.ok) {
          throw new Error(`Could not save screening checkpoint (HTTP ${saveRes.status})`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMsg(`Batch ${batchIndex + 1} failed: ${msg}`);
        setPhase('error');
        return;
      }
    }

    if (!abortRef.current) {
      // Compute kappa across all results
      const previous = stateRef.current;
      const allResults = Object.values(previous.results);
      const completedState: ScreenState = {
        ...previous,
        screeningComplete: true,
        kappa: computeKappa(allResults),
      };
      stateRef.current = completedState;
      setState(completedState);
      persistState(completedState);
      await fetch(`/api/state/${projectId}/screen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: completedState }),
      });
      setPhase('done');
    }
  }

  function cancelScreening() {
    abortRef.current = true;
    setPhase('done');
  }

  async function retryBatch() {
    setErrorMsg('');
    await runScreening();
  }

  // ─── human review ─────────────────────────────────────────────────────────

  function handleHumanDecision(result: ScreeningResult, decision: ScreenDecision, note: string) {
    const overridesConsensus = decision !== result.consensusDecision;

    updateState((prev) => {
      const updated: ScreeningResult = {
        ...result,
        humanDecision: decision,
        humanNote: note,
        humanReviewedAt: new Date().toISOString(),
      };

      const newResults = { ...prev.results, [result.recordId]: updated };

      // Record correction if it overrides the AI consensus
      let newCorrections = prev.humanCorrections;
      if (overridesConsensus) {
        // Find the original record for title/abstract
        const rec = records.find((r) => r.id === result.recordId);
        const enrichedResult = {
          ...updated,
          title: rec?.title ?? result.recordId,
          abstract: rec?.abstract ?? '',
        } as ScreeningResult & { title: string; abstract: string };

        newCorrections = [
          ...prev.humanCorrections,
          { result: enrichedResult, originalConsensus: result.consensusDecision },
        ];
      }

      // Audit: human decision
      const newAudit: AuditEntry[] = [
        ...prev.auditLog,
        makeAuditEntry('human_decision', {
          recordId: result.recordId,
          decision,
          overrideConsensus: overridesConsensus,
        }),
      ];

      // Check calibration
      let newExamples = prev.calibrationExamples;
      let newCalibLog = prev.calibrationLog;
      const newAuditFinal = [...newAudit];

      if (shouldCalibrate(newCorrections)) {
        newExamples = selectCalibrationExamples(newCorrections) as FewShotExample[];
        newCalibLog = [
          ...prev.calibrationLog,
          {
            timestamp: new Date().toISOString(),
            correctionCount: newCorrections.length,
            examplesCount: newExamples.length,
          },
        ];
        newAuditFinal.push(
          makeAuditEntry('calibration_update', {
            examplesCount: newExamples.length,
            correctionCount: newCorrections.length,
          })
        );
        setCalibrationNotice(true);
        setTimeout(() => setCalibrationNotice(false), 4000);
      }

      return {
        ...prev,
        results: newResults,
        humanCorrections: newCorrections,
        calibrationExamples: newExamples,
        calibrationLog: newCalibLog,
        auditLog: newAuditFinal,
      };
    });

    // Save to DB after human decision (fire-and-forget)
    // Use a small timeout to let the state settle first
    setTimeout(() => {
      fetch(`/api/state/${projectId}/screen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: stateRef.current }),
      }).catch(() => {}); // silent — localStorage already updated
    }, 0);
  }

  // ─── derived data ─────────────────────────────────────────────────────────

  const nonDuplicateRecords = records.filter((r) => !r.isDuplicate);
  const screenedResults = Object.values(state.results);

  const includeCount = screenedResults.filter(
    (r) => (r.humanDecision ?? r.consensusDecision) === 'include'
  ).length;
  const excludeCount = screenedResults.filter(
    (r) => (r.humanDecision ?? r.consensusDecision) === 'exclude'
  ).length;
  const flagCount = screenedResults.filter(
    (r) => r.consensusDecision === null || (r.humanDecision === null && r.consensusDecision === 'flag')
  ).length;

  // Records needing human review: no consensus OR flagged without human decision
  const reviewQueue = screenedResults.filter(
    (r) => r.humanDecision === null && (r.consensusDecision === null || r.consensusDecision === 'flag')
  );
  const humanReviewRemaining = reviewQueue.length;
  const unscreenedRemaining = Math.max(0, nonDuplicateRecords.length - screenedResults.length);

  const allHumanReviewDone =
    phase === 'done' &&
    screenedResults.length > 0 &&
    unscreenedRemaining === 0 &&
    humanReviewRemaining === 0;

  // ─── render helpers ───────────────────────────────────────────────────────

  function ReviewCard({ result }: { result: ScreeningResult }) {
    const rec = records.find((r) => r.id === result.recordId);
    const [note, setNote] = useState(result.humanNote ?? '');
    const [expanded, setExpanded] = useState(expandedAbstracts.has(result.recordId));

    function decide(d: ScreenDecision) {
      handleHumanDecision(result, d, note);
    }

    return (
      <div className="rounded-xl border bg-white p-5 mb-4" style={{ borderColor: '#e5e7eb' }}>
        {/* Header row */}
        <div className="flex items-start justify-between gap-4 mb-3">
          <button
            className="text-left font-medium text-sm leading-snug flex-1"
            style={{ color: 'var(--color-primary)' }}
            onClick={() => {
              setExpanded((v) => !v);
              setExpandedAbstracts((prev) => {
                const next = new Set(prev);
                if (next.has(result.recordId)) next.delete(result.recordId);
                else next.add(result.recordId);
                return next;
              });
            }}
          >
            {rec?.title ?? result.recordId}
            <span className="text-xs text-gray-400 ml-2">{expanded ? '▲' : '▼'}</span>
          </button>
          <div className="flex gap-2 shrink-0">
            {(['include', 'exclude', 'flag'] as ScreenDecision[]).map((d) => (
              <button
                key={d}
                onClick={() => decide(d)}
                className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  d === 'include'
                    ? 'border-green-400 text-green-700 hover:bg-green-100'
                    : d === 'exclude'
                    ? 'border-gray-400 text-gray-700 hover:bg-gray-100'
                    : 'border-yellow-400 text-yellow-700 hover:bg-yellow-100'
                }`}
              >
                {decisionLabel(d)}
              </button>
            ))}
          </div>
        </div>

        {expanded && rec?.abstract && (
          <p className="text-sm text-gray-600 mb-3 leading-relaxed">{rec.abstract}</p>
        )}

        {/* AI decisions */}
        <div className="flex flex-wrap gap-3 mb-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500">Reviewer A:</span>
            <span className={`px-2 py-0.5 rounded-full font-semibold ${decisionBadge(result.passA.decision)}`}>
              {decisionLabel(result.passA.decision)}
            </span>
            <span className="text-gray-400">({result.passA.confidence})</span>
            <span className="text-gray-500 italic">— {result.passA.reason}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 mb-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500">Reviewer B:</span>
            <span className={`px-2 py-0.5 rounded-full font-semibold ${decisionBadge(result.passB.decision)}`}>
              {decisionLabel(result.passB.decision)}
            </span>
            <span className="text-gray-400">({result.passB.confidence})</span>
            <span className="text-gray-500 italic">— {result.passB.reason}</span>
          </div>
        </div>

        {/* Note field */}
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note…"
          className="w-full text-xs border rounded px-2 py-1 text-gray-600"
          style={{ borderColor: '#e5e7eb' }}
        />
      </div>
    );
  }

  // ─── render ───────────────────────────────────────────────────────────────

  if (!projectId) {
    return <div className="p-8 text-gray-400">Loading…</div>;
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        <div
          className="flex items-center justify-center rounded-full text-sm font-bold shrink-0"
          style={{ width: '36px', height: '36px', backgroundColor: 'var(--color-secondary)', color: 'white' }}
        >
          2
        </div>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-primary)' }}>
            Screening &amp; Calibration
          </h1>
          <p className="text-sm text-gray-500">Project: {projectId}</p>
        </div>
      </div>

      {/* Calibration notice toast */}
      {calibrationNotice && (
        <div className="mb-4 rounded-lg px-4 py-3 text-sm font-medium bg-blue-50 border border-blue-200 text-blue-800">
          Calibration updated — AI accuracy should improve on subsequent batches. ({CALIBRATION_TRIGGER} corrections processed)
        </div>
      )}

      {/* ── SECTION 1: Criteria Setup ────────────────────────────────────── */}
      {(phase === 'setup' || phase === 'error') && (
        <div className="rounded-xl border bg-white p-6 mb-6" style={{ borderColor: '#e5e7eb' }}>
          <h2 className="font-semibold text-base mb-4" style={{ color: 'var(--color-primary)' }}>
            Screening Criteria
          </h2>

          {/* Records summary */}
          {recordsLoaded && (
            nonDuplicateRecords.length > 0 ? (
              <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-4 py-2 text-sm text-green-800">
                {nonDuplicateRecords.length} candidate records from Phase 2 loaded
                {records.filter((r) => r.isDuplicate).length > 0 &&
                  ` (${records.filter((r) => r.isDuplicate).length} duplicates excluded)`}
              </div>
            ) : (
              <div className="mb-4 rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-2 text-sm text-yellow-800">
                No search results found. Complete Phase 2 (Search) first before screening.
              </div>
            )
          )}

          {/* Criteria textareas */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Inclusion Criteria
              </label>
              <textarea
                rows={6}
                className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2"
                style={{ borderColor: '#d1d5db', '--tw-ring-color': 'var(--color-secondary)' } as React.CSSProperties}
                placeholder={"e.g.\n- Adults aged 18+ with a confirmed diagnosis\n- Randomized controlled trials\n- Published in English"}
                value={state.criteria.inclusion}
                onChange={(e) =>
                  updateState((prev) => ({
                    ...prev,
                    criteria: { ...prev.criteria, inclusion: e.target.value },
                  }))
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Exclusion Criteria
              </label>
              <textarea
                rows={6}
                className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2"
                style={{ borderColor: '#d1d5db', '--tw-ring-color': 'var(--color-secondary)' } as React.CSSProperties}
                placeholder={"e.g.\n- Case reports or case series\n- Conference abstracts without full text\n- Studies with fewer than 10 participants"}
                value={state.criteria.exclusion}
                onChange={(e) =>
                  updateState((prev) => ({
                    ...prev,
                    criteria: { ...prev.criteria, exclusion: e.target.value },
                  }))
                }
              />
            </div>
          </div>

          {phase === 'error' && errorMsg && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              <strong>Error:</strong> {errorMsg}
              <button
                onClick={retryBatch}
                className="ml-3 underline text-red-600 hover:text-red-800"
              >
                Retry
              </button>
            </div>
          )}

          <button
            onClick={runScreening}
            disabled={
              !state.criteria.inclusion.trim() ||
              !state.criteria.exclusion.trim() ||
              nonDuplicateRecords.length === 0
            }
            className="px-5 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            Start AI Screening
          </button>

          {Object.keys(state.results).length > 0 && (
            <button
              onClick={() => setPhase('done')}
              className="ml-3 px-5 py-2 rounded-lg text-sm font-semibold border transition-colors"
              style={{ borderColor: 'var(--color-secondary)', color: 'var(--color-secondary)' }}
            >
              Resume Review
            </button>
          )}
        </div>
      )}

      {/* ── SECTION 2: Progress ─────────────────────────────────────────── */}
      {phase === 'screening' && (
        <div className="rounded-xl border bg-white p-6 mb-6" style={{ borderColor: '#e5e7eb' }}>
          <h2 className="font-semibold text-base mb-4" style={{ color: 'var(--color-primary)' }}>
            AI Screening in Progress
          </h2>

          <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
            <span>
              Batch {currentBatch} of {totalBatches} &mdash; {progress} / {nonDuplicateRecords.length} records screened
            </span>
            <span className="font-mono text-gray-400">{elapsedSeconds}s elapsed</span>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-gray-100 rounded-full h-3 mb-4">
            <div
              className="h-3 rounded-full transition-all"
              style={{
                width: `${nonDuplicateRecords.length > 0 ? (progress / nonDuplicateRecords.length) * 100 : 0}%`,
                backgroundColor: 'var(--color-secondary)',
              }}
            />
          </div>

          <p className="text-xs text-gray-400 mb-4">
            Each paper runs two independent AI reviewer passes in parallel and is saved immediately.
            With a laptop-hosted local model, a paper can take about 1–2 minutes. You may cancel and resume later.
          </p>

          <button
            onClick={cancelScreening}
            className="px-4 py-1.5 rounded-lg text-sm border border-gray-300 text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      )}

      {/* ── SECTION 3: Results Overview ─────────────────────────────────── */}
      {phase === 'done' && screenedResults.length > 0 && (
        <>
          <div className="rounded-xl border bg-white p-6 mb-6" style={{ borderColor: '#e5e7eb' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-base" style={{ color: 'var(--color-primary)' }}>
                Screening Results
              </h2>
              <button
                onClick={() => { setPhase('setup'); setErrorMsg(''); }}
                className="text-xs border rounded px-3 py-1 text-gray-500 hover:bg-gray-50"
                style={{ borderColor: '#e5e7eb' }}
              >
                Edit Criteria &amp; Re-screen
              </button>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <StatCard label="Total screened" value={screenedResults.length} color="text-gray-800" />
              <StatCard label="AI: Include" value={includeCount} color="text-green-600" />
              <StatCard label="AI: Exclude" value={excludeCount} color="text-gray-600" />
              <StatCard label="Flag / Disagree" value={flagCount} color="text-yellow-600" />
            </div>

            {/* Kappa */}
            {state.kappa !== null && (
              <div className="rounded-lg bg-gray-50 border px-5 py-4" style={{ borderColor: '#e5e7eb' }}>
                <div className="flex items-center gap-3 mb-1">
                  <span
                    className={`text-3xl font-bold tabular-nums ${kappaColor(state.kappa)}`}
                  >
                    {state.kappa.toFixed(2)}
                  </span>
                  <span className={`text-base font-semibold ${kappaColor(state.kappa)}`}>
                    {kappaLabel(state.kappa)}
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  Cohen&rsquo;s Kappa — measures agreement between the two independent AI reviewers.
                  Scores above 0.6 indicate substantial agreement.
                </p>
              </div>
            )}

            {/* Human review remaining */}
            <div className="mt-4 flex items-center gap-3">
              <span
                className={`text-sm font-medium ${humanReviewRemaining > 0 ? 'text-yellow-700' : 'text-green-700'}`}
              >
                {unscreenedRemaining > 0
                  ? `${unscreenedRemaining} records still need AI screening`
                  : humanReviewRemaining > 0
                  ? `${humanReviewRemaining} records remaining in review queue`
                  : 'All records reviewed'}
              </span>
              {unscreenedRemaining > 0 && (
                <button
                  onClick={runScreening}
                  className="ml-auto px-4 py-1.5 rounded-lg text-sm font-semibold text-white"
                  style={{ backgroundColor: 'var(--color-primary)' }}
                >
                  Resume AI Screening
                </button>
              )}
            </div>
          </div>

          {/* ── SECTION 4: Human Review Queue ─────────────────────────── */}
          {reviewQueue.length > 0 && (
            <div className="mb-6">
              <h2 className="font-semibold text-base mb-3" style={{ color: 'var(--color-primary)' }}>
                Human Review Queue
                <span className="ml-2 text-sm font-normal text-gray-500">
                  ({reviewQueue.length} records need review)
                </span>
              </h2>
              {reviewQueue.map((result) => (
                <ReviewCard key={result.recordId} result={result} />
              ))}
            </div>
          )}

          {/* Review complete banner */}
          {allHumanReviewDone && (
            <div
              className="rounded-xl border-2 p-5 mb-6 flex items-center justify-between"
              style={{ borderColor: 'var(--color-secondary)', backgroundColor: 'rgba(59,155,197,0.06)' }}
            >
              <div>
                <p className="font-semibold text-base" style={{ color: 'var(--color-secondary)' }}>
                  Review Complete
                </p>
                <p className="text-sm text-gray-500 mt-0.5">
                  All records have been reviewed. Proceed to the extraction step.
                </p>
              </div>
              <button
                onClick={() => router.push(`/projects/${projectId}/extract`)}
                className="px-5 py-2 rounded-lg text-sm font-semibold text-white"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                Proceed to Extract →
              </button>
            </div>
          )}

          {/* All Records collapsible table */}
          <div className="mb-6">
            <button
              onClick={() => setShowAllRecords((v) => !v)}
              className="flex items-center gap-2 text-sm font-medium mb-3"
              style={{ color: 'var(--color-primary)' }}
            >
              <span>{showAllRecords ? '▼' : '▶'}</span>
              All Records ({screenedResults.length})
            </button>
            {showAllRecords && (
              <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#e5e7eb' }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left">
                      <th className="px-4 py-2 font-medium text-gray-600">Title</th>
                      <th className="px-4 py-2 font-medium text-gray-600">Pass A</th>
                      <th className="px-4 py-2 font-medium text-gray-600">Pass B</th>
                      <th className="px-4 py-2 font-medium text-gray-600">Consensus</th>
                      <th className="px-4 py-2 font-medium text-gray-600">Human</th>
                    </tr>
                  </thead>
                  <tbody>
                    {screenedResults.map((r) => {
                      const rec = records.find((x) => x.id === r.recordId);
                      return (
                        <tr key={r.recordId} className="border-t" style={{ borderColor: '#f3f4f6' }}>
                          <td className="px-4 py-2 max-w-xs truncate text-gray-700">
                            {rec?.title ?? r.recordId}
                          </td>
                          <td className="px-4 py-2">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${decisionBadge(r.passA.decision)}`}>
                              {decisionLabel(r.passA.decision)}
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${decisionBadge(r.passB.decision)}`}>
                              {decisionLabel(r.passB.decision)}
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            {r.consensusDecision ? (
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${decisionBadge(r.consensusDecision)}`}>
                                {decisionLabel(r.consensusDecision)}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">Disagree</span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            {r.humanDecision ? (
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${decisionBadge(r.humanDecision)}`}>
                                {decisionLabel(r.humanDecision)}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">Pending</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Audit Trail ─────────────────────────────────────────────────── */}
      {state.auditLog.length > 0 && (
        <div className="mb-6">
          <button
            onClick={() => setShowAudit((v) => !v)}
            className="flex items-center gap-2 text-sm font-medium mb-3"
            style={{ color: 'var(--color-primary)' }}
          >
            <span>{showAudit ? '▼' : '▶'}</span>
            Audit Trail ({state.auditLog.length} entries)
          </button>
          {showAudit && (
            <div className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: '#e5e7eb' }}>
              {state.auditLog.map((entry) => (
                <div
                  key={entry.id}
                  className="border-b px-4 py-3 text-xs flex gap-4"
                  style={{ borderColor: '#f3f4f6' }}
                >
                  <span className="text-gray-400 font-mono shrink-0">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                  <span
                    className="font-medium shrink-0"
                    style={{ color: 'var(--color-secondary)' }}
                  >
                    {entry.type}
                  </span>
                  <span className="text-gray-500 font-mono truncate">
                    {JSON.stringify(entry.details)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── small stat card ─────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border bg-gray-50 px-4 py-3" style={{ borderColor: '#e5e7eb' }}>
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}
