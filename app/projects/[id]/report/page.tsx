'use client';

import { useState, useEffect, useCallback, use, useRef } from 'react';
import type { SearchRecord } from '@/lib/search/types';
import type { ScreenState } from '@/lib/screen/types';
import type { NarrativeState } from '@/lib/narrative/types';
import type { ExtractState } from '@/lib/extract/types';
import type {
  PRISMAStats,
  ManuscriptSection,
  ChecklistItem,
  IncludedStudy,
} from '@/lib/report/types';
import { generatePRISMASVG } from '@/lib/report/prisma-svg';
import { PRISMA_CHECKLIST } from '@/lib/report/checklist-items';

type ReportPhase = 'setup' | 'generating' | 'review' | 'compiling' | 'done';

const GENERATING_MESSAGES = [
  'Generating abstract...',
  'Drafting introduction...',
  'Writing methods section...',
  'Compiling results...',
  'Drafting discussion...',
  'Writing conclusions...',
  'Finalising manuscript...',
];

interface ReportPageProps {
  params: Promise<{ id: string }>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function buildExtractionSummary(
  recordedRows: ExtractState['recordedRows'],
  prompts: ExtractState['prompts']
): string {
  return recordedRows
    .map(
      (row) =>
        `Study: ${row.pdfName}\n` +
        prompts
          .map((p) => `${p.text}: ${(row as Record<string, string>)[p.text] ?? 'Not reported'}`)
          .join('\n')
    )
    .join('\n\n');
}

function getIncludedStudies(
  screenState: ScreenState | null,
  searchRecords: SearchRecord[]
): IncludedStudy[] {
  if (!screenState) return [];

  const includedIds = new Set<string>();
  for (const result of Object.values(screenState.results)) {
    const decision = result.humanDecision ?? result.consensusDecision;
    if (decision === 'include') {
      includedIds.add(result.recordId);
    }
  }

  const recordMap = new Map(searchRecords.map((r) => [r.id, r]));

  return [...includedIds].flatMap((id) => {
    const rec = recordMap.get(id);
    if (!rec) return [];
    return [
      {
        title: rec.title,
        authors: rec.authors,
        year: rec.year,
        journal: rec.journal,
        doi: rec.doi,
        abstract: rec.abstract,
        source: rec.source,
      },
    ];
  });
}

function computeStats(
  searchRecords: SearchRecord[],
  screenState: ScreenState | null
): PRISMAStats {
  const totalIdentified = searchRecords.length;
  const duplicatesRemoved = searchRecords.filter((r) => r.isDuplicate).length;
  const nonDupe = searchRecords.filter((r) => !r.isDuplicate);
  const recordsScreened = nonDupe.length;

  const pubmedCount = nonDupe.filter((r) => r.source === 'pubmed').length;
  const europepmcCount = nonDupe.filter((r) => r.source === 'europepmc').length;
  const openalexCount = nonDupe.filter((r) => r.source === 'openalex').length;

  let recordsIncluded = 0;
  let recordsExcluded = 0;
  const exclusionReasons: Record<string, number> = {};

  if (screenState) {
    for (const result of Object.values(screenState.results)) {
      const decision = result.humanDecision ?? result.consensusDecision;
      if (decision === 'include') {
        recordsIncluded++;
      } else if (decision === 'exclude') {
        recordsExcluded++;
        const reason = result.passA?.reason ?? 'Not stated';
        exclusionReasons[reason] = (exclusionReasons[reason] ?? 0) + 1;
      }
    }
  }

  return {
    pubmedCount,
    europepmcCount,
    openalexCount,
    totalIdentified,
    duplicatesRemoved,
    recordsScreened,
    recordsExcluded,
    recordsIncluded,
    exclusionReasons,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────────

export default function ReportPage({ params }: ReportPageProps) {
  const { id: projectId } = use(params);

  const [hydrated, setHydrated] = useState(false);

  // Source data from earlier phases
  const [searchRecords, setSearchRecords] = useState<SearchRecord[]>([]);
  const [screenState, setScreenState] = useState<ScreenState | null>(null);
  const [narrativeState, setNarrativeState] = useState<NarrativeState | null>(null);
  const [extractState, setExtractState] = useState<ExtractState | null>(null);
  const [researchQuestion, setResearchQuestion] = useState('');
  const [searchQueries, setSearchQueries] = useState<{
    pubmed: string;
    europepmc: string;
    openalex: string;
  } | null>(null);

  // Report-specific state
  const [phase, setPhase] = useState<ReportPhase>('setup');
  const [title, setTitle] = useState('');
  const [sections, setSections] = useState<ManuscriptSection[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(
    PRISMA_CHECKLIST.map((item) => ({ ...item, status: 'pending' as const, note: '' }))
  );
  const [auditRunning, setAuditRunning] = useState(false);
  const [auditComplete, setAuditComplete] = useState(false);
  const [generatingMsgIdx, setGeneratingMsgIdx] = useState(0);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);

  const generatingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const storageKey = `report_state_${projectId}`;

  // ── Hydrate from DB first, localStorage fallback ──
  useEffect(() => {
    async function loadAllState() {
      // Attempt to load cross-step data from DB in parallel
      try {
        const [searchRes, screenRes, narrativeRes, extractRes, reportRes] = await Promise.all([
          fetch(`/api/state/${projectId}/search`),
          fetch(`/api/state/${projectId}/screen`),
          fetch(`/api/state/${projectId}/narrative`),
          fetch(`/api/state/${projectId}/extract`),
          fetch(`/api/state/${projectId}/report`),
        ]);

        if (searchRes.ok) {
          const d = (await searchRes.json()) as { state: { records?: SearchRecord[]; queries?: { pubmed: string; europepmc: string; openalex: string } } | null };
          if (d.state?.records) setSearchRecords(d.state.records);
          if (d.state?.queries) setSearchQueries(d.state.queries);
        }
        if (screenRes.ok) {
          const d = (await screenRes.json()) as { state: ScreenState | null };
          if (d.state) setScreenState(d.state);
        }
        if (narrativeRes.ok) {
          const d = (await narrativeRes.json()) as { state: (NarrativeState & { question?: string }) | null };
          if (d.state) {
            setNarrativeState(d.state);
            if (d.state.question) setResearchQuestion(d.state.question);
          }
        }
        if (extractRes.ok) {
          const d = (await extractRes.json()) as { state: ExtractState | null };
          if (d.state) setExtractState(d.state);
        }
        if (reportRes.ok) {
          const d = (await reportRes.json()) as { state: { sections?: ManuscriptSection[]; checklist?: ChecklistItem[]; auditComplete?: boolean; title?: string } | null };
          if (d.state) {
            if (d.state.sections?.length) { setSections(d.state.sections); setPhase('review'); }
            if (d.state.checklist?.length) setChecklist(d.state.checklist);
            if (d.state.auditComplete) setAuditComplete(d.state.auditComplete);
            if (d.state.title) setTitle(d.state.title);
          }
        }
        setHydrated(true);
        return;
      } catch {
        // fall through to localStorage
      }

      // Fallback: localStorage
      try {
        const rawSearch = localStorage.getItem(`search_results_${projectId}`);
        if (rawSearch) {
          const data = JSON.parse(rawSearch) as {
            records?: SearchRecord[];
            queries?: { pubmed: string; europepmc: string; openalex: string };
          };
          if (data.records) setSearchRecords(data.records);
          if (data.queries) setSearchQueries(data.queries);
        }
        // Also try the h-evidence-search key used by search page
        if (!localStorage.getItem(`search_results_${projectId}`)) {
          const rawSearch2 = localStorage.getItem(`h-evidence-search-${projectId}`);
          if (rawSearch2) {
            const data2 = JSON.parse(rawSearch2) as { records?: SearchRecord[]; queries?: { pubmed: string; europepmc: string; openalex: string } };
            if (data2.records) setSearchRecords(data2.records);
            if (data2.queries) setSearchQueries(data2.queries);
          }
        }

        const rawScreen = localStorage.getItem(`screen_state_${projectId}`);
        if (rawScreen) setScreenState(JSON.parse(rawScreen) as ScreenState);

        const rawNarrative = localStorage.getItem(`narrative_state_${projectId}`);
        if (rawNarrative) setNarrativeState(JSON.parse(rawNarrative) as NarrativeState);

        const rawExtract = localStorage.getItem(`extract_state_${projectId}`);
        if (rawExtract) setExtractState(JSON.parse(rawExtract) as ExtractState);

        const savedQuestion = localStorage.getItem(`narrative_question_${projectId}`) ?? '';
        setResearchQuestion(savedQuestion);

        const rawReport = localStorage.getItem(storageKey);
        if (rawReport) {
          const saved = JSON.parse(rawReport) as {
            sections?: ManuscriptSection[];
            checklist?: ChecklistItem[];
            auditComplete?: boolean;
            title?: string;
          };
          if (saved.sections?.length) {
            setSections(saved.sections);
            setPhase('review');
          }
          if (saved.checklist?.length) setChecklist(saved.checklist);
          if (saved.auditComplete) setAuditComplete(saved.auditComplete);
          if (saved.title) setTitle(saved.title);
        }
      } catch {
        // ignore corrupt storage
      }
      setHydrated(true);
    }

    loadAllState();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Pre-fill title from research question
  useEffect(() => {
    if (hydrated && !title && researchQuestion) setTitle(researchQuestion);
  }, [hydrated, researchQuestion, title]);

  // Persist report state
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(storageKey, JSON.stringify({ sections, checklist, auditComplete, title }));
  }, [sections, checklist, auditComplete, title, storageKey, hydrated]);

  // Generating message cycling
  useEffect(() => {
    if (phase === 'generating') {
      generatingInterval.current = setInterval(() => {
        setGeneratingMsgIdx((i) => (i + 1) % GENERATING_MESSAGES.length);
      }, 3500);
    } else {
      if (generatingInterval.current) {
        clearInterval(generatingInterval.current);
        generatingInterval.current = null;
      }
    }
    return () => {
      if (generatingInterval.current) clearInterval(generatingInterval.current);
    };
  }, [phase]);

  // ── Derived values ──
  const stats = computeStats(searchRecords, screenState);
  const includedStudies = getIncludedStudies(screenState, searchRecords);
  const extractionSummary =
    extractState && extractState.recordedRows.length > 0
      ? buildExtractionSummary(extractState.recordedRows, extractState.prompts)
      : '';
  const narrativeSections =
    narrativeState?.draft?.sections?.map((s) => ({ id: s.id as string, content: s.content })) ?? [];
  const svgDiagram = hydrated ? generatePRISMASVG(stats) : '';
  const metCount = checklist.filter((c) => c.status === 'met').length;

  // ── Actions ──
  const handleGenerate = useCallback(async () => {
    setPhase('generating');
    setGenerateError(null);
    setGeneratingMsgIdx(0);

    try {
      const sectionIds = [
        'abstract',
        'introduction',
        'methods',
        'results',
        'discussion',
        'conclusions',
      ] as const;
      const generated: ManuscriptSection[] = [...sections];

      // One section per request keeps every Ollama call inside the hosting
      // timeout. Save each result immediately so a later failure is resumable.
      for (let i = 0; i < sectionIds.length; i++) {
        if (generated.some((section) => section.id === sectionIds[i])) continue;
        setGeneratingMsgIdx(i);
        const res = await fetch('/api/report/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sectionId: sectionIds[i],
            question: title || researchQuestion || 'Systematic Review',
            stats,
            includedStudies,
            criteria: screenState?.criteria ?? undefined,
            narrativeSections: narrativeSections.length ? narrativeSections : undefined,
            extractionSummary: extractionSummary || undefined,
          }),
        });

        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          throw new Error(
            (errData.error as string) ??
              `The ${sectionIds[i]} section could not be generated (HTTP ${res.status}).`
          );
        }

        const data = (await res.json()) as { sections: ManuscriptSection[] };
        if (!data.sections?.[0]) throw new Error(`No ${sectionIds[i]} section returned`);
        generated.push(data.sections[0]);
        setSections([...generated]);
        await fetch(`/api/state/${projectId}/report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: { sections: generated, checklist, auditComplete, title } }),
        });
      }

      setPhase('review');
    } catch (err) {
      setGenerateError(String(err));
      setPhase('setup');
    }
  }, [title, researchQuestion, stats, includedStudies, screenState, narrativeSections, extractionSummary, checklist, auditComplete, projectId, sections]);

  const handleRunAudit = useCallback(async () => {
    if (!sections.length) return;
    setAuditRunning(true);
    const manuscriptText = sections.map((s) => `\n\n## ${s.title}\n${s.content}`).join('');
    try {
      const res = await fetch('/api/report/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manuscriptText }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { checklist: ChecklistItem[] };
      setChecklist(data.checklist);
      setAuditComplete(true);

      // Save to DB (checkpoint: audit complete)
      fetch(`/api/state/${projectId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: { sections, checklist: data.checklist, auditComplete: true, title } }),
      }).catch(() => {});
    } catch (err) {
      console.error('Audit error:', err);
    } finally {
      setAuditRunning(false);
    }
  }, [sections, projectId, title]);

  const handleDownloadDocx = useCallback(async () => {
    setPhase('compiling');
    setCompileError(null);
    try {
      const res = await fetch('/api/report/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          sections,
          includedStudies,
          stats,
          queries: searchQueries ?? undefined,
          criteria: screenState?.criteria ?? undefined,
        }),
      });

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error((errData.error as string) ?? `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeTitle = (title ?? 'report').slice(0, 40).replace(/[^a-z0-9]/gi, '_');
      a.download = `${safeTitle}_systematic_review.docx`;
      a.click();
      URL.revokeObjectURL(url);
      setPhase('done');
    } catch (err) {
      setCompileError(String(err));
      setPhase('review');
    }
  }, [title, sections, includedStudies, stats, searchQueries, screenState]);

  const handleDownloadSVG = useCallback(() => {
    if (!svgDiagram) return;
    const blob = new Blob([svgDiagram], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'prisma_flow_diagram.svg';
    a.click();
    URL.revokeObjectURL(url);
  }, [svgDiagram]);

  const updateSection = useCallback((id: string, newContent: string) => {
    setSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, content: newContent, edited: true } : s))
    );
  }, []);

  const scrollToSection = useCallback((id: string) => {
    const el = document.getElementById(`section-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  if (!hydrated) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-gray-400">
        Loading...
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // SETUP phase
  // ─────────────────────────────────────────────────────────────────
  if (phase === 'setup') {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10">
        {/* Step header */}
        <div className="flex items-center gap-3 mb-6">
          <div
            className="flex items-center justify-center rounded-full text-sm font-bold shrink-0"
            style={{ width: 36, height: 36, backgroundColor: 'var(--color-secondary)', color: 'white' }}
          >
            4
          </div>
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--color-primary)' }}>
              Report Generation
            </h1>
            <p className="text-sm text-gray-500">Project: {projectId}</p>
          </div>
        </div>

        {/* Data summary */}
        <div className="rounded-xl border p-5 mb-6 bg-white" style={{ borderColor: '#e5e7eb' }}>
          <h2 className="font-semibold text-sm mb-3" style={{ color: 'var(--color-primary)' }}>
            Data available for this report
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <dt className="text-gray-500">Total records identified</dt>
            <dd className="font-medium" style={{ color: 'var(--color-primary)' }}>
              {stats.totalIdentified}
            </dd>
            <dt className="text-gray-500">After deduplication</dt>
            <dd className="font-medium" style={{ color: 'var(--color-primary)' }}>
              {stats.recordsScreened}
            </dd>
            <dt className="text-gray-500">Included studies</dt>
            <dd className="font-medium" style={{ color: 'var(--color-primary)' }}>
              {stats.recordsIncluded}
            </dd>
            <dt className="text-gray-500">Recorded extractions</dt>
            <dd className="font-medium" style={{ color: 'var(--color-primary)' }}>
              {extractState?.recordedRows.length ?? 0}
            </dd>
            <dt className="text-gray-500">Narrative draft</dt>
            <dd className="font-medium" style={{ color: 'var(--color-primary)' }}>
              {narrativeState?.draft ? 'Available' : 'Not generated'}
            </dd>
          </dl>
        </div>

        {/* PRISMA preview */}
        <div className="rounded-xl border p-5 mb-6 bg-white" style={{ borderColor: '#e5e7eb' }}>
          <h2 className="font-semibold text-sm mb-3" style={{ color: 'var(--color-primary)' }}>
            PRISMA flow diagram preview
          </h2>
          <div
            className="overflow-hidden rounded"
            dangerouslySetInnerHTML={{ __html: svgDiagram }}
          />
        </div>

        {/* Title input */}
        <div className="mb-6">
          <label
            className="block text-sm font-medium mb-1"
            style={{ color: 'var(--color-primary)' }}
          >
            Manuscript title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter a title for your systematic review manuscript"
            className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
            style={{ borderColor: '#d1d5db', color: 'var(--color-primary)' }}
          />
        </div>

        {generateError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 mb-4 text-sm text-red-700">
            Generation failed: {generateError}
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={!title.trim()}
          className="w-full py-3 rounded-xl text-white font-semibold text-sm transition-opacity disabled:opacity-40"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          Generate Report
        </button>
        <p className="text-xs text-gray-400 text-center mt-2">
          6 sequential model calls. Estimated time: 3–5 minutes with a local model.
        </p>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // GENERATING phase
  // ─────────────────────────────────────────────────────────────────
  if (phase === 'generating') {
    return (
      <div className="max-w-xl mx-auto px-6 py-20 flex flex-col items-center text-center">
        <div
          className="rounded-full mb-6"
          style={{
            width: 64,
            height: 64,
            backgroundColor: 'var(--color-secondary)',
            opacity: 0.3,
            animation: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite',
          }}
        />
        <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--color-primary)' }}>
          Generating manuscript
        </h2>
        <p className="text-sm text-gray-500 mb-6">{GENERATING_MESSAGES[generatingMsgIdx]}</p>
        <p className="text-xs text-gray-400">
          This may take 3–5 minutes with the local model. Please keep this tab open.
        </p>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // REVIEW / COMPILING / DONE phase — three-column layout
  // ─────────────────────────────────────────────────────────────────
  const isCompiling = phase === 'compiling';
  const isDone = phase === 'done';

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 56px)', overflow: 'hidden' }}>
      {/* ── Left: Table of contents ── */}
      <aside
        className="overflow-y-auto border-r p-4"
        style={{ width: 180, flexShrink: 0, borderColor: '#e5e7eb' }}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
          Sections
        </p>
        <nav className="space-y-1">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => scrollToSection(s.id)}
              className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-gray-100 transition-colors"
              style={{ color: s.edited ? 'var(--color-secondary)' : 'var(--color-primary)' }}
            >
              {s.title}
              {s.edited && (
                <span className="ml-1 text-gray-400 text-[10px]">(edited)</span>
              )}
            </button>
          ))}
          <button
            onClick={() => scrollToSection('references')}
            className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-gray-100 transition-colors"
            style={{ color: 'var(--color-primary)' }}
          >
            References
          </button>
        </nav>
      </aside>

      {/* ── Center: Section editors ── */}
      <main
        className="flex-1 overflow-y-auto p-6 space-y-6"
        style={{ paddingBottom: 80 }}
      >
        {sections.map((s) => (
          <div
            key={s.id}
            id={`section-${s.id}`}
            className="rounded-xl border bg-white p-5"
            style={{ borderColor: '#e5e7eb' }}
          >
            <div className="flex items-center justify-between mb-3">
              <h2
                className="text-base font-semibold"
                style={{ color: 'var(--color-primary)' }}
              >
                {s.title}
              </h2>
              {s.edited && (
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{
                    backgroundColor: 'rgba(59,155,197,0.12)',
                    color: 'var(--color-secondary)',
                  }}
                >
                  edited
                </span>
              )}
            </div>
            <textarea
              value={s.content}
              onChange={(e) => updateSection(s.id, e.target.value)}
              rows={Math.max(6, Math.ceil(s.content.length / 80))}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none resize-y"
              style={{ borderColor: '#d1d5db', color: '#374151' }}
            />
            <p className="text-xs text-gray-400 mt-1 text-right">{s.content.length} chars</p>
          </div>
        ))}

        {/* References preview */}
        <div
          id="section-references"
          className="rounded-xl border bg-white p-5"
          style={{ borderColor: '#e5e7eb' }}
        >
          <h2
            className="text-base font-semibold mb-3"
            style={{ color: 'var(--color-primary)' }}
          >
            References
          </h2>
          {includedStudies.length === 0 ? (
            <p className="text-sm text-gray-400">
              No included studies with metadata. References will be empty in the document.
            </p>
          ) : (
            <ol className="space-y-1">
              {includedStudies.map((study, i) => (
                <li key={i} className="text-xs text-gray-600 pl-4" style={{ textIndent: '-16px', paddingLeft: '16px' }}>
                  {study.authors.slice(0, 3).join(', ')}
                  {study.authors.length > 3 ? ' et al.' : ''}
                  {study.year ? ` (${study.year}).` : '.'}{' '}
                  <em>{study.title}</em>.
                  {study.journal ? ` ${study.journal}` : ''}
                  {study.doi ? `. https://doi.org/${study.doi}` : ''}
                </li>
              ))}
            </ol>
          )}
        </div>
      </main>

      {/* ── Right: Checklist + SVG ── */}
      <aside
        className="overflow-y-auto border-l p-4 space-y-4"
        style={{ width: 256, flexShrink: 0, borderColor: '#e5e7eb', paddingBottom: 80 }}
      >
        {/* PRISMA Audit */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              PRISMA Checklist
            </p>
            {auditComplete && (
              <span className="text-xs text-gray-500">{metCount}/27 met</span>
            )}
          </div>

          <button
            onClick={handleRunAudit}
            disabled={auditRunning || !sections.length}
            className="w-full py-2 rounded-lg text-white text-xs font-semibold disabled:opacity-40 transition-opacity mb-3"
            style={{ backgroundColor: 'var(--color-secondary)' }}
          >
            {auditRunning ? 'Auditing...' : 'Run PRISMA Audit'}
          </button>

          {auditComplete && (
            <details open className="text-xs">
              <summary className="cursor-pointer text-gray-500 mb-1">
                View {checklist.length} items
              </summary>
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {checklist.map((item) => {
                  const icon =
                    item.status === 'met' ? '✅' :
                    item.status === 'partial' ? '⚠️' :
                    item.status === 'missing' ? '❌' : '⏳';
                  return (
                    <div
                      key={item.number}
                      className="flex items-start gap-1.5 p-1.5 rounded"
                      style={{ backgroundColor: '#f9fafb' }}
                      title={item.note || item.description}
                    >
                      <span className="shrink-0">{icon}</span>
                      <span className="text-gray-700">
                        {item.number}. {item.item}
                      </span>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </div>

        {/* PRISMA Flow Diagram SVG */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
            Flow Diagram
          </p>
          <div
            className="rounded-lg border overflow-hidden"
            style={{ borderColor: '#e5e7eb' }}
            dangerouslySetInnerHTML={{ __html: svgDiagram }}
          />
          <button
            onClick={handleDownloadSVG}
            className="w-full mt-2 py-1.5 rounded-lg border text-xs font-medium transition-colors hover:bg-gray-50"
            style={{ borderColor: 'var(--color-secondary)', color: 'var(--color-secondary)' }}
          >
            Download Flow Diagram
          </button>
          <p className="text-xs text-gray-400 mt-1 leading-tight">
            A structured table version is embedded in the .docx file.
          </p>
        </div>

        {/* Regenerate */}
        <button
          onClick={() => {
            setSections([]);
            setAuditComplete(false);
            setChecklist(
              PRISMA_CHECKLIST.map((item) => ({ ...item, status: 'pending' as const, note: '' }))
            );
            setPhase('setup');
          }}
          className="w-full py-1.5 rounded-lg border text-xs font-medium text-gray-400 hover:bg-gray-50 transition-colors"
          style={{ borderColor: '#d1d5db' }}
        >
          Regenerate
        </button>
      </aside>

      {/* ── Bottom action bar ── */}
      <div
        className="fixed bottom-0 left-0 right-0 border-t bg-white px-6 py-3 flex items-center justify-between"
        style={{ borderColor: '#e5e7eb', zIndex: 10 }}
      >
        <div className="text-sm text-gray-500">
          {sections.length} sections &bull; {includedStudies.length} studies &bull;{' '}
          {sections.filter((s) => s.edited).length} edited
          {isDone && (
            <span className="ml-2 font-medium" style={{ color: '#16a34a' }}>
              Download complete!
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {compileError && (
            <span className="text-xs text-red-500">Error: {compileError}</span>
          )}
          <button
            onClick={handleDownloadDocx}
            disabled={isCompiling || !sections.length}
            className="px-6 py-2 rounded-xl text-white text-sm font-semibold disabled:opacity-40 transition-opacity flex items-center gap-2"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            {isCompiling && (
              <span
                style={{
                  display: 'inline-block',
                  width: 16,
                  height: 16,
                  border: '2px solid white',
                  borderTopColor: 'transparent',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
            )}
            {isCompiling ? 'Compiling...' : 'Download .docx'}
          </button>
        </div>
      </div>
    </div>
  );
}
