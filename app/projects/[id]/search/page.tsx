'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import type { PICOConcept, SearchQueries, SearchRecord, SearchStats } from '@/lib/search/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Stage = 'idle' | 'generating' | 'retrieving' | 'done' | 'error';

interface SearchState {
  question: string;
  pico: PICOConcept | null;
  queries: SearchQueries | null;
  records: SearchRecord[];
  stats: SearchStats | null;
}

interface QuickScopeState {
  open: boolean;
  running: boolean;
  reviews: SearchRecord[];
  summary: string;
  keyTerms: string[];
  error: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function storageKey(projectId: string) {
  return `h-evidence-search-${projectId}`;
}

function loadSaved(projectId: string): SearchState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return null;
    return JSON.parse(raw) as SearchState;
  } catch {
    return null;
  }
}

function saveState(projectId: string, state: SearchState) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
}

function downloadCSV(records: SearchRecord[], projectId: string) {
  // Client-side CSV generation matching lib/search/export.ts logic
  function escapeCSV(val: string | number | null | undefined): string {
    if (val === null || val === undefined) return '""';
    return '"' + String(val).replace(/"/g, '""') + '"';
  }
  const headers = ['Title', 'Authors', 'Year', 'Journal', 'DOI', 'Source', 'Abstract', 'URL'];
  const unique = records.filter((r) => !r.isDuplicate);
  const rows = unique.map((r) =>
    [
      escapeCSV(r.title),
      escapeCSV(r.authors.join('; ')),
      escapeCSV(r.year),
      escapeCSV(r.journal),
      escapeCSV(r.doi),
      escapeCSV(r.source),
      escapeCSV(r.abstract),
      escapeCSV(r.url),
    ].join(',')
  );
  const csv = [headers.map(escapeCSV).join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `search-results-${projectId}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const SOURCE_LABELS: Record<string, string> = {
  pubmed: 'PubMed',
  europepmc: 'Europe PMC',
  openalex: 'OpenAlex',
};

const SOURCE_COLORS: Record<string, string> = {
  pubmed: '#1a6fa8',
  europepmc: '#227a4f',
  openalex: '#7b3fa8',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function Badge({ source }: { source: string }) {
  const color = SOURCE_COLORS[source] ?? '#555';
  return (
    <span
      className="inline-block text-xs font-medium rounded px-1.5 py-0.5 shrink-0"
      style={{ backgroundColor: color + '18', color, border: `1px solid ${color}40` }}
    >
      {SOURCE_LABELS[source] ?? source}
    </span>
  );
}

function PICOCard({ pico }: { pico: PICOConcept }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: '#e5e7eb' }}>
      <button
        className="w-full flex items-center justify-between px-5 py-3 text-left"
        style={{ backgroundColor: 'rgba(27,58,92,0.04)' }}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-semibold text-sm" style={{ color: 'var(--color-primary)' }}>
          PICO Concept
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }}
        >
          <path d="M4 6l4 4 4-4" stroke="var(--color-primary)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="px-5 py-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(['population', 'intervention', 'comparator', 'outcome'] as const).map((field) => (
            <div key={field}>
              <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--color-secondary)' }}>
                {field}
              </div>
              <div className="text-sm text-gray-700">{pico[field]}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface QueryBoxProps {
  label: string;
  value: string;
  onSave: (v: string) => void;
}

function QueryBox({ label, value, onSave }: QueryBoxProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  return (
    <div className="rounded-xl border bg-white" style={{ borderColor: '#e5e7eb' }}>
      <div
        className="flex items-center justify-between px-4 py-2 border-b"
        style={{ borderColor: '#e5e7eb', backgroundColor: 'rgba(27,58,92,0.04)' }}
      >
        <span className="text-xs font-semibold" style={{ color: 'var(--color-primary)' }}>
          {label}
        </span>
        {!editing ? (
          <button
            onClick={() => { setDraft(value); setEditing(true); }}
            className="text-xs flex items-center gap-1 hover:opacity-70"
            style={{ color: 'var(--color-secondary)' }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M11 2l3 3-9 9H2v-3l9-9z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            Edit
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => { onSave(draft); setEditing(false); }}
              className="text-xs font-medium"
              style={{ color: 'var(--color-secondary)' }}
            >
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-xs text-gray-400"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
      {editing ? (
        <textarea
          className="w-full px-4 py-3 text-xs font-mono resize-none focus:outline-none"
          style={{ minHeight: '90px', color: '#333' }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
        />
      ) : (
        <pre className="px-4 py-3 text-xs font-mono whitespace-pre-wrap break-words" style={{ color: '#333' }}>
          {value}
        </pre>
      )}
    </div>
  );
}

interface ResultRowProps {
  record: SearchRecord;
}

function ResultRow({ record }: ResultRowProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b last:border-b-0" style={{ borderColor: '#f0f0f0' }}>
      <div
        className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50"
        onClick={() => setExpanded((v) => !v)}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          className="shrink-0 mt-1"
          style={{
            transform: expanded ? 'rotate(180deg)' : undefined,
            transition: 'transform 0.15s',
            color: 'var(--color-secondary)',
          }}
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-2 mb-1">
            <span className="font-medium text-sm leading-snug" style={{ color: 'var(--color-primary)' }}>
              {record.title}
            </span>
            <Badge source={record.source} />
            {record.year && (
              <span className="text-xs text-gray-400 shrink-0">{record.year}</span>
            )}
          </div>
          <div className="text-xs text-gray-500 truncate">
            {record.authors.slice(0, 3).join(', ')}
            {record.authors.length > 3 ? ` +${record.authors.length - 3} more` : ''}
            {record.journal ? ` · ${record.journal}` : ''}
          </div>
        </div>
        <div className="shrink-0">
          {record.doi ? (
            <a
              href={`https://doi.org/${record.doi}`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-xs hover:underline"
              style={{ color: 'var(--color-secondary)' }}
            >
              DOI
            </a>
          ) : record.url ? (
            <a
              href={record.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-xs hover:underline"
              style={{ color: 'var(--color-secondary)' }}
            >
              Link
            </a>
          ) : null}
        </div>
      </div>
      {expanded && record.abstract && (
        <div className="px-10 pb-3">
          <p className="text-xs text-gray-600 leading-relaxed">{record.abstract}</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SearchPage() {
  const params = useParams();
  const projectId = typeof params?.id === 'string' ? params.id : 'unknown';

  const [question, setQuestion] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [pico, setPico] = useState<PICOConcept | null>(null);
  const [queries, setQueries] = useState<SearchQueries | null>(null);
  const [records, setRecords] = useState<SearchRecord[]>([]);
  const [stats, setStats] = useState<SearchStats | null>(null);

  const [qs, setQs] = useState<QuickScopeState>({
    open: false,
    running: false,
    reviews: [],
    summary: '',
    keyTerms: [],
    error: null,
  });

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  // Load saved state on mount — DB first, localStorage fallback
  useEffect(() => {
    async function loadState() {
      let saved: SearchState | null = null;
      try {
        const res = await fetch(`/api/state/${projectId}/search`);
        if (res.ok) {
          const data = (await res.json()) as { state: SearchState | null };
          if (data.state && Object.keys(data.state).length > 0) {
            saved = data.state;
            // Write-through to localStorage
            saveState(projectId, saved);
          }
        }
      } catch {
        // fall through to localStorage
      }

      if (!saved) {
        saved = loadSaved(projectId);
      }

      if (saved) {
        setQuestion(saved.question ?? '');
        setPico(saved.pico);
        setQueries(saved.queries);
        setRecords(saved.records ?? []);
        setStats(saved.stats);
        if (saved.records && saved.records.length > 0) {
          setStage('done');
        }
      }
    }

    loadState();
  }, [projectId]);

  function startTimer() {
    setElapsed(0);
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function handleGenerate() {
    if (!question.trim()) return;
    setError(null);
    setStage('generating');
    setStatusMsg('Generating PICO concept...');
    startTimer();

    try {
      setStatusMsg('Translating to database queries...');
      const res = await fetch('/api/search/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const data = (await res.json()) as {
        pico?: PICOConcept;
        queries?: SearchQueries;
        error?: string;
      };

      if (!res.ok || data.error) {
        throw new Error(data.error ?? `Server error ${res.status}`);
      }

      stopTimer();
      setPico(data.pico!);
      setQueries(data.queries!);
      setStage('idle'); // show the PICO+queries review stage — user still needs to click Run Search
    } catch (err) {
      stopTimer();
      setStage('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSearch() {
    if (!queries) return;
    setError(null);
    setStage('retrieving');
    startTimer();

    const messages = [
      'Searching PubMed...',
      'Searching Europe PMC...',
      'Searching OpenAlex...',
      'Deduplicating results...',
    ];
    let msgIdx = 0;
    setStatusMsg(messages[0]);
    const msgInterval = setInterval(() => {
      msgIdx = (msgIdx + 1) % messages.length;
      setStatusMsg(messages[msgIdx]);
    }, 4000);

    try {
      const res = await fetch('/api/search/retrieve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries }),
      });

      clearInterval(msgInterval);
      stopTimer();

      const data = (await res.json()) as {
        records?: SearchRecord[];
        stats?: SearchStats;
        error?: string;
      };

      if (!res.ok || data.error) {
        throw new Error(data.error ?? `Server error ${res.status}`);
      }

      const newRecords = data.records ?? [];
      const newStats = data.stats ?? null;

      setRecords(newRecords);
      setStats(newStats);
      setStage('done');

      // Persist to localStorage
      const searchState: SearchState = {
        question,
        pico,
        queries,
        records: newRecords,
        stats: newStats,
      };
      saveState(projectId, searchState);

      // Save to DB (checkpoint: search results returned)
      fetch(`/api/state/${projectId}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: searchState }),
      }).catch(() => {}); // silent — localStorage already updated
    } catch (err) {
      clearInterval(msgInterval);
      stopTimer();
      setStage('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleQuickScope() {
    if (!question.trim()) return;
    setQs((prev) => ({ ...prev, open: true, running: true, error: null, reviews: [], summary: '', keyTerms: [] }));

    try {
      const res = await fetch('/api/search/quickscope', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const data = (await res.json()) as {
        reviews?: SearchRecord[];
        summary?: string;
        keyTerms?: string[];
        error?: string;
      };

      if (!res.ok || data.error) {
        throw new Error(data.error ?? `Server error ${res.status}`);
      }

      setQs((prev) => ({
        ...prev,
        running: false,
        reviews: data.reviews ?? [],
        summary: data.summary ?? '',
        keyTerms: data.keyTerms ?? [],
      }));
    } catch (err) {
      setQs((prev) => ({
        ...prev,
        running: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  const uniqueRecords = records.filter((r) => !r.isDuplicate);
  const hasPico = pico !== null && queries !== null;
  const isGenerating = stage === 'generating';
  const isRetrieving = stage === 'retrieving';
  const isBusy = isGenerating || isRetrieving;

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
      {/* Step header */}
      <div className="flex items-center gap-3">
        <div
          className="flex items-center justify-center rounded-full text-sm font-bold shrink-0"
          style={{ width: '36px', height: '36px', backgroundColor: 'var(--color-secondary)', color: 'white' }}
        >
          1
        </div>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-primary)' }}>
            Search &amp; Retrieval
          </h1>
          <p className="text-sm text-gray-500">Project: {projectId}</p>
        </div>
      </div>

      {/* Stage 1: Question input */}
      <div className="rounded-xl border bg-white p-6 space-y-4" style={{ borderColor: '#e5e7eb' }}>
        <label className="block">
          <span className="text-sm font-semibold mb-1.5 block" style={{ color: 'var(--color-primary)' }}>
            Research Question
          </span>
          <textarea
            className="w-full rounded-lg border px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2"
            style={{ borderColor: '#d1d5db', minHeight: '100px' }}
            placeholder="e.g. What is the effectiveness of metformin compared to placebo in reducing HbA1c levels in adults with type 2 diabetes?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={isBusy}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate();
            }}
          />
          <p className="text-xs text-gray-400 mt-1">Press Cmd/Ctrl+Enter to generate</p>
        </label>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleQuickScope}
            disabled={isBusy || !question.trim()}
            className="px-4 py-2 rounded-lg border text-sm font-medium transition-opacity disabled:opacity-40"
            style={{ borderColor: 'var(--color-secondary)', color: 'var(--color-secondary)' }}
          >
            Quick Scope
          </button>
          <button
            onClick={handleGenerate}
            disabled={isBusy || !question.trim()}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold text-white transition-opacity disabled:opacity-40"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            {isGenerating ? <><Spinner size={16} /> Generating...</> : 'Generate Search Strategy'}
          </button>
        </div>
      </div>

      {/* Quick Scope panel */}
      {qs.open && (
        <div className="rounded-xl border bg-white p-5 space-y-3" style={{ borderColor: 'var(--color-secondary)', borderWidth: '2px' }}>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm" style={{ color: 'var(--color-primary)' }}>
              Quick Scope — Existing Reviews Check
            </h3>
            <button
              onClick={() => setQs((prev) => ({ ...prev, open: false }))}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Dismiss
            </button>
          </div>

          {qs.running && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Spinner size={16} />
              Checking for existing reviews...
            </div>
          )}

          {qs.error && (
            <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-3">
              {qs.error}
            </div>
          )}

          {!qs.running && !qs.error && qs.keyTerms.length > 0 && (
            <>
              <div className="text-xs text-gray-500">
                Key terms used: {qs.keyTerms.map((t) => <code key={t} className="bg-gray-100 rounded px-1 mx-0.5">{t}</code>)}
              </div>

              {qs.summary && (
                <p className="text-sm text-gray-700 leading-relaxed border-l-2 pl-3" style={{ borderColor: 'var(--color-secondary)' }}>
                  {qs.summary}
                </p>
              )}

              {qs.reviews.length === 0 ? (
                <p className="text-sm text-gray-500 italic">No systematic reviews found on this exact topic in PubMed (last 10 years).</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {qs.reviews.length} review{qs.reviews.length !== 1 ? 's' : ''} found
                  </p>
                  {qs.reviews.map((r) => (
                    <div key={r.id} className="border rounded-lg px-4 py-2.5" style={{ borderColor: '#e5e7eb' }}>
                      <div className="font-medium text-sm" style={{ color: 'var(--color-primary)' }}>
                        {r.title}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {r.year ?? 'n.d.'}{r.journal ? ` · ${r.journal}` : ''}
                        {r.url && (
                          <>
                            {' · '}
                            <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: 'var(--color-secondary)' }}>
                              View
                            </a>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Generating status */}
      {isGenerating && (
        <div className="flex items-center gap-3 rounded-xl border bg-white px-5 py-4" style={{ borderColor: '#e5e7eb' }}>
          <Spinner />
          <div>
            <div className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>{statusMsg}</div>
            <div className="text-xs text-gray-400">{elapsed}s elapsed</div>
          </div>
        </div>
      )}

      {/* Stage 2: PICO + queries review */}
      {hasPico && stage !== 'generating' && (
        <div className="space-y-4">
          <PICOCard pico={pico} />

          <div className="space-y-3">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
              Database Queries
            </h3>
            <QueryBox
              label="PubMed — E-utilities syntax ([tiab], [mesh], AND/OR)"
              value={queries!.pubmed}
              onSave={(v) => setQueries((q) => q ? { ...q, pubmed: v } : q)}
            />
            <QueryBox
              label="Europe PMC — field prefix syntax (TITLE:, ABSTRACT:)"
              value={queries!.europepmc}
              onSave={(v) => setQueries((q) => q ? { ...q, europepmc: v } : q)}
            />
            <QueryBox
              label="OpenAlex — search parameter (keyword terms)"
              value={queries!.openalex}
              onSave={(v) => setQueries((q) => q ? { ...q, openalex: v } : q)}
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleSearch}
              disabled={isRetrieving}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold text-white transition-opacity disabled:opacity-40"
              style={{ backgroundColor: 'var(--color-secondary)' }}
            >
              {isRetrieving ? <><Spinner size={16} /> Searching...</> : 'Run Search'}
            </button>
          </div>
        </div>
      )}

      {/* Retrieving status */}
      {isRetrieving && (
        <div className="flex items-center gap-3 rounded-xl border bg-white px-5 py-4" style={{ borderColor: '#e5e7eb' }}>
          <Spinner />
          <div>
            <div className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>{statusMsg}</div>
            <div className="text-xs text-gray-400">{elapsed}s elapsed</div>
          </div>
        </div>
      )}

      {/* Error */}
      {stage === 'error' && error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5">
          <div className="font-semibold text-sm text-red-700 mb-1">Error</div>
          <p className="text-xs text-red-600">{error}</p>
          <button
            onClick={() => { setStage('idle'); setError(null); }}
            className="mt-3 text-xs font-medium text-red-600 hover:underline"
          >
            Dismiss and retry
          </button>
        </div>
      )}

      {/* Stage 3: Results */}
      {stage === 'done' && stats && (
        <div className="space-y-4">
          {/* Stats bar */}
          <div className="rounded-xl border bg-white px-5 py-4" style={{ borderColor: '#e5e7eb' }}>
            <div className="flex flex-wrap gap-4 text-sm">
              <div>
                <span className="text-gray-500">PubMed: </span>
                <span className="font-semibold" style={{ color: 'var(--color-primary)' }}>{stats.pubmedCount}</span>
              </div>
              <div>
                <span className="text-gray-500">Europe PMC: </span>
                <span className="font-semibold" style={{ color: 'var(--color-primary)' }}>{stats.europepmcCount}</span>
              </div>
              <div>
                <span className="text-gray-500">OpenAlex: </span>
                <span className="font-semibold" style={{ color: 'var(--color-primary)' }}>{stats.openalexCount}</span>
              </div>
              <div className="border-l pl-4" style={{ borderColor: '#e5e7eb' }}>
                <span className="text-gray-500">Total raw: </span>
                <span className="font-semibold" style={{ color: 'var(--color-primary)' }}>{stats.totalRaw}</span>
              </div>
              <div>
                <span className="text-gray-500">Duplicates removed: </span>
                <span className="font-semibold text-amber-600">{stats.duplicatesRemoved}</span>
              </div>
              <div>
                <span className="text-gray-500">Final: </span>
                <span className="font-bold text-lg" style={{ color: 'var(--color-secondary)' }}>{stats.finalCount}</span>
              </div>
            </div>
          </div>

          {/* Export + New search */}
          <div className="flex gap-3">
            <button
              onClick={() => downloadCSV(records, projectId)}
              className="px-4 py-2 rounded-lg border text-sm font-medium transition-opacity"
              style={{ borderColor: 'var(--color-secondary)', color: 'var(--color-secondary)' }}
            >
              Export CSV
            </button>
            <button
              onClick={() => {
                setStage('idle');
                setRecords([]);
                setStats(null);
                setPico(null);
                setQueries(null);
              }}
              className="px-4 py-2 rounded-lg border text-sm font-medium text-gray-500"
              style={{ borderColor: '#d1d5db' }}
            >
              New Search
            </button>
          </div>

          {/* Results table */}
          {uniqueRecords.length === 0 ? (
            <div className="rounded-xl border bg-white p-8 text-center text-gray-400 text-sm" style={{ borderColor: '#e5e7eb' }}>
              No results found for these queries.
            </div>
          ) : (
            <div
              className="rounded-xl border bg-white overflow-hidden"
              style={{ borderColor: '#e5e7eb', maxHeight: '60vh', overflowY: 'auto' }}
            >
              <div className="px-4 py-2 border-b text-xs font-semibold text-gray-500 uppercase tracking-wide" style={{ borderColor: '#f0f0f0' }}>
                {uniqueRecords.length} unique records
              </div>
              {uniqueRecords.map((record) => (
                <ResultRow key={record.id} record={record} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
