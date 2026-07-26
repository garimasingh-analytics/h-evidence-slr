'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import type { NarrativeSection, NarrativeDraft, NarrativeState } from '@/lib/narrative/types';
import type { ScreenState } from '@/lib/screen/types';
import type { SearchRecord } from '@/lib/search/types';
import type { ExtractState } from '@/lib/extract/types';

interface NarrativePageProps {
  params: Promise<{ id: string }>;
}

// ── LocalStorage helpers ────────────────────────────────────────────────────
function loadJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage errors
  }
}

// ── Included-study builder ──────────────────────────────────────────────────
interface IncludedStudy {
  title: string;
  authors: string[];
  year: number | null;
  abstract: string;
  journal: string | null;
}

function buildIncludedStudies(projectId: string): IncludedStudy[] {
  const screenState = loadJSON<ScreenState>(`screen_state_${projectId}`);
  const searchResults = loadJSON<{ records: SearchRecord[] }>(`search_results_${projectId}`);

  if (!screenState || !searchResults) return [];

  const includedIds = new Set<string>();
  for (const [id, result] of Object.entries(screenState.results)) {
    const isIncluded =
      result.humanDecision === 'include' ||
      (result.humanDecision === null && result.consensusDecision === 'include');
    if (isIncluded) includedIds.add(id);
  }

  const records = searchResults.records ?? [];
  return records
    .filter((r) => includedIds.has(r.id) && !r.isDuplicate)
    .map((r) => ({
      title: r.title,
      authors: r.authors,
      year: r.year,
      abstract: r.abstract,
      journal: r.journal,
    }));
}

function buildExtractionSummary(projectId: string): string {
  const extractState = loadJSON<ExtractState>(`extract_state_${projectId}`);
  if (!extractState || extractState.recordedRows.length === 0) return '';

  return extractState.recordedRows
    .map((row) => {
      const lines = [`Study: ${row.pdfName}`];
      for (const [key, val] of Object.entries(row)) {
        if (key !== 'pdfName' && val) {
          lines.push(`${key}: ${val}`);
        }
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

// ── Component ───────────────────────────────────────────────────────────────
export default function NarrativePage({ params }: NarrativePageProps) {
  const { id: projectId } = use(params);
  const router = useRouter();

  const stateKey = `narrative_state_${projectId}`;
  const questionKey = `narrative_question_${projectId}`;

  const [hydrated, setHydrated] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [draft, setDraft] = useState<NarrativeDraft | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState<string>('');
  const [genError, setGenError] = useState<string | null>(null);

  const [question, setQuestion] = useState('');
  const [questionSaved, setQuestionSaved] = useState(false);

  const [includedStudies, setIncludedStudies] = useState<IncludedStudy[]>([]);
  const [recordedPdfsCount, setRecordedPdfsCount] = useState(0);

  const [editedSections, setEditedSections] = useState<Record<string, string>>({});

  // ── Hydrate from DB first, localStorage fallback ────────────────────────
  useEffect(() => {
    async function loadState() {
      let saved: Omit<NarrativeState, 'generating'> | null = null;
      let savedQuestion = '';

      // DB first
      try {
        const res = await fetch(`/api/state/${projectId}/narrative`);
        if (res.ok) {
          const data = (await res.json()) as { state: Record<string, unknown> | null };
          if (data.state && Object.keys(data.state).length > 0) {
            saved = data.state as Omit<NarrativeState, 'generating'>;
            savedQuestion = (data.state.question as string) ?? '';
            // Write-through to localStorage
            saveJSON(stateKey, saved);
            if (savedQuestion) {
              try { localStorage.setItem(questionKey, savedQuestion); } catch { /* ignore */ }
            }
          }
        }
      } catch {
        // fall through
      }

      // Fallback: localStorage
      if (!saved) {
        saved = loadJSON<Omit<NarrativeState, 'generating'>>(stateKey);
        savedQuestion = localStorage.getItem(questionKey) ?? '';
      }

      if (saved) {
        setEnabled(saved.enabled ?? true);
        if (saved.draft) {
          setDraft(saved.draft);
          const edits: Record<string, string> = {};
          for (const s of saved.draft.sections) {
            edits[s.id] = s.content;
          }
          setEditedSections(edits);
        }
      }

      setQuestion(savedQuestion);

      // Load context stats from DB or localStorage
      let studies: IncludedStudy[] = [];
      try {
        const [searchRes, screenRes] = await Promise.all([
          fetch(`/api/state/${projectId}/search`),
          fetch(`/api/state/${projectId}/screen`),
        ]);
        const searchData = searchRes.ok ? (await searchRes.json()) as { state: { records?: SearchRecord[] } | null } : { state: null };
        const screenData = screenRes.ok ? (await screenRes.json()) as { state: ScreenState | null } : { state: null };
        if (searchData.state?.records && screenData.state) {
          const screenState = screenData.state;
          const includedIds = new Set<string>();
          for (const [id, result] of Object.entries(screenState.results)) {
            const isIncluded =
              result.humanDecision === 'include' ||
              (result.humanDecision === null && result.consensusDecision === 'include');
            if (isIncluded) includedIds.add(id);
          }
          studies = (searchData.state.records ?? [])
            .filter((r: SearchRecord) => includedIds.has(r.id) && !r.isDuplicate)
            .map((r: SearchRecord) => ({
              title: r.title,
              authors: r.authors,
              year: r.year,
              abstract: r.abstract,
              journal: r.journal,
            }));
        }
      } catch {
        // fall through to localStorage
      }

      if (studies.length === 0) {
        studies = buildIncludedStudies(projectId);
      }
      setIncludedStudies(studies);

      let recordedCount = 0;
      try {
        const extractRes = await fetch(`/api/state/${projectId}/extract`);
        if (extractRes.ok) {
          const extractData = (await extractRes.json()) as { state: { recordedRows?: unknown[] } | null };
          recordedCount = extractData.state?.recordedRows?.length ?? 0;
        }
      } catch { /* ignore */ }

      if (recordedCount === 0) {
        const extractState = loadJSON<ExtractState>(`extract_state_${projectId}`);
        recordedCount = extractState?.recordedRows.length ?? 0;
      }
      setRecordedPdfsCount(recordedCount);

      setHydrated(true);
    }

    loadState();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ── Persist narrative state ──────────────────────────────────────────────
  useEffect(() => {
    if (!hydrated) return;

    // Build sections with any edits applied
    const sectionsToSave: NarrativeSection[] | undefined = draft?.sections.map((s) => ({
      ...s,
      content: editedSections[s.id] ?? s.content,
      edited: (editedSections[s.id] ?? s.content) !== s.content || s.edited,
    }));

    const toSave: Omit<NarrativeState, 'generating'> = {
      enabled,
      draft: draft
        ? { ...draft, sections: sectionsToSave ?? draft.sections }
        : null,
    };
    saveJSON(stateKey, toSave);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, draft, editedSections, hydrated]);

  // ── Save question ─────────────────────────────────────────────────────────
  function handleSaveQuestion() {
    localStorage.setItem(questionKey, question);
    setQuestionSaved(true);
    setTimeout(() => setQuestionSaved(false), 2000);

    // Save to DB (fire-and-forget)
    const stateToSave = { enabled, draft, question };
    fetch(`/api/state/${projectId}/narrative`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: stateToSave }),
    }).catch(() => {});
  }

  // ── Generate ──────────────────────────────────────────────────────────────
  async function handleGenerate() {
    if (!question.trim()) return;
    setGenerating(true);
    setGenError(null);

    try {
      setGenStatus('Generating background section...');

      const extractionSummary = buildExtractionSummary(projectId);

      const res = await fetch('/api/narrative/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: question.trim(),
          includedStudies: includedStudies.slice(0, 20),
          extractionSummary,
        }),
      });

      setGenStatus('Generating discussion section...');

      const data = (await res.json()) as {
        sections?: NarrativeSection[];
        studyCount?: number;
        error?: string;
      };

      if (!res.ok || data.error) {
        throw new Error(data.error ?? `Server error ${res.status}`);
      }

      if (!data.sections || data.sections.length === 0) {
        throw new Error('No sections returned from server');
      }

      const newDraft: NarrativeDraft = {
        sections: data.sections,
        generatedAt: new Date().toISOString(),
        question: question.trim(),
        studyCount: data.studyCount ?? includedStudies.length,
      };
      setDraft(newDraft);

      // Reset edits to fresh generated content
      const edits: Record<string, string> = {};
      for (const s of data.sections) {
        edits[s.id] = s.content;
      }
      setEditedSections(edits);

      // Save to DB (checkpoint: draft generated)
      const stateToSave = { enabled, draft: newDraft, question: question.trim() };
      fetch(`/api/state/${projectId}/narrative`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: stateToSave }),
      }).catch(() => {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setGenError(`Narrative generation failed: ${msg}`);
    } finally {
      setGenerating(false);
      setGenStatus('');
    }
  }

  // ── Section edit ──────────────────────────────────────────────────────────
  function handleSectionEdit(sectionId: string, value: string) {
    setEditedSections((prev) => ({ ...prev, [sectionId]: value }));
  }

  // ── Download draft ────────────────────────────────────────────────────────
  function handleDownload() {
    if (!draft) return;
    const lines: string[] = [];
    lines.push(`Narrative Draft — ${draft.question}`);
    lines.push(`Generated: ${new Date(draft.generatedAt).toLocaleString()}`);
    lines.push(`Studies: ${draft.studyCount}`);
    lines.push('');

    for (const section of draft.sections) {
      lines.push(`=== ${section.title} ===`);
      lines.push('');
      lines.push(editedSections[section.id] ?? section.content);
      lines.push('');
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `narrative_draft_${projectId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (!hydrated) {
    return (
      <div className="flex items-center justify-center h-64">
        <div
          className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: 'var(--color-secondary)', borderTopColor: 'transparent' }}
        />
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push(`/projects/${projectId}/extract`)}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            ← Back to Extract
          </button>
          <span className="text-gray-300">|</span>
          <span className="text-sm font-medium" style={{ color: 'var(--color-secondary)' }}>
            Narrative Drafting (Optional)
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-primary)' }}>
          Narrative Drafting
        </h1>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        This step is optional. The narrative draft provides background and discussion prose to support
        your PRISMA report. You can skip this step and proceed directly to Report generation.
      </p>

      {/* Toggle */}
      <section className="rounded-xl border bg-white p-5 mb-5" style={{ borderColor: '#e5e7eb' }}>
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <div
            onClick={() => setEnabled((v) => !v)}
            className="relative inline-flex items-center shrink-0"
            style={{ width: '44px', height: '24px' }}
            role="switch"
            aria-checked={enabled}
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') setEnabled((v) => !v); }}
          >
            <div
              className="absolute inset-0 rounded-full transition-colors"
              style={{ backgroundColor: enabled ? 'var(--color-secondary)' : '#d1d5db' }}
            />
            <div
              className="absolute rounded-full bg-white shadow transition-transform"
              style={{
                width: '18px',
                height: '18px',
                top: '3px',
                left: enabled ? '23px' : '3px',
              }}
            />
          </div>
          <span className="text-sm font-medium text-gray-700">
            Enable narrative drafting for this project
          </span>
        </label>
      </section>

      {/* Disabled state */}
      {!enabled && (
        <div
          className="rounded-xl border p-8 text-center text-sm text-gray-400"
          style={{ borderColor: '#e5e7eb', backgroundColor: '#f9fafb' }}
        >
          Narrative drafting is disabled for this project. Enable it above to generate background
          and discussion prose.
        </div>
      )}

      {/* Enabled content */}
      {enabled && (
        <>
          {/* Research question */}
          <section className="rounded-xl border bg-white p-5 mb-5" style={{ borderColor: '#e5e7eb' }}>
            <label
              htmlFor="research-question"
              className="block text-sm font-semibold mb-2"
              style={{ color: 'var(--color-primary)' }}
            >
              Research question
              <span className="font-normal text-gray-400 ml-1">(used to focus the narrative)</span>
            </label>
            <div className="flex gap-2">
              <input
                id="research-question"
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g. What is the effectiveness of CBT for depression in adults?"
                className="flex-1 rounded-lg border px-3 py-2 text-sm text-gray-700 focus:outline-none"
                style={{ borderColor: '#d1d5db' }}
              />
              <button
                onClick={handleSaveQuestion}
                disabled={!question.trim()}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                {questionSaved ? 'Saved!' : 'Save'}
              </button>
            </div>
          </section>

          {/* Context stats */}
          <section className="flex flex-wrap gap-3 mb-5">
            <div
              className="flex items-center gap-2 rounded-full px-4 py-1.5 text-sm"
              style={{ backgroundColor: '#f3f4f6', color: '#6b7280' }}
            >
              <span className="font-semibold" style={{ color: 'var(--color-primary)' }}>
                {includedStudies.length}
              </span>
              included studies loaded from screening
            </div>
            <div
              className="flex items-center gap-2 rounded-full px-4 py-1.5 text-sm"
              style={{ backgroundColor: '#f3f4f6', color: '#6b7280' }}
            >
              <span className="font-semibold" style={{ color: 'var(--color-primary)' }}>
                {recordedPdfsCount}
              </span>
              recorded PDFs from extraction
            </div>
          </section>

          {/* Missing data warnings */}
          {includedStudies.length === 0 && (
            <div
              className="rounded-lg p-4 mb-5 text-sm"
              style={{ backgroundColor: '#fff7ed', color: '#c2410c', borderColor: '#fdba74', border: '1px solid' }}
            >
              No included studies found. Complete the{' '}
              <button
                className="underline font-medium"
                onClick={() => router.push(`/projects/${projectId}/screen`)}
              >
                Screening step
              </button>{' '}
              first and mark studies as included.
            </div>
          )}

          {recordedPdfsCount === 0 && (
            <div
              className="rounded-lg p-4 mb-5 text-sm"
              style={{ backgroundColor: '#eff6ff', color: '#1d4ed8', borderColor: '#93c5fd', border: '1px solid' }}
            >
              No extraction data found. The discussion section will be less detailed without it.
              You can still generate a background section.{' '}
              <button
                className="underline font-medium"
                onClick={() => router.push(`/projects/${projectId}/extract`)}
              >
                Go to Extraction
              </button>
            </div>
          )}

          {/* Generate button */}
          <div className="mb-6">
            <button
              onClick={handleGenerate}
              disabled={generating || !question.trim()}
              className="px-6 py-3 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--color-secondary)' }}
            >
              {generating
                ? genStatus || 'Generating...'
                : draft
                ? 'Regenerate Narrative Draft'
                : 'Generate Narrative Draft'}
            </button>
            {generating && (
              <span className="ml-3 inline-flex items-center gap-2 text-sm text-gray-400">
                <span
                  className="inline-block w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
                  style={{ borderColor: 'var(--color-secondary)', borderTopColor: 'transparent' }}
                />
                {genStatus}
              </span>
            )}
          </div>

          {/* Error */}
          {genError && (
            <div
              className="rounded-lg p-4 mb-5 text-sm"
              style={{ backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5' }}
            >
              {genError}
            </div>
          )}

          {/* Draft sections */}
          {draft && (
            <>
              <div className="flex items-center gap-2 mb-3">
                <p className="text-xs text-gray-400">
                  Generated {new Date(draft.generatedAt).toLocaleString()} — {draft.studyCount}{' '}
                  studies
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
                {draft.sections.map((section) => {
                  const currentContent = editedSections[section.id] ?? section.content;
                  const isEdited = currentContent !== section.content || section.edited;

                  return (
                    <div
                      key={section.id}
                      className="rounded-xl border bg-white p-5 flex flex-col"
                      style={{ borderColor: '#e5e7eb' }}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <h2 className="font-bold text-base" style={{ color: 'var(--color-primary)' }}>
                          {section.title}
                        </h2>
                        {isEdited && (
                          <span
                            className="text-xs font-medium px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: '#dbeafe', color: '#1e40af' }}
                          >
                            edited
                          </span>
                        )}
                      </div>

                      <textarea
                        value={currentContent}
                        onChange={(e) => handleSectionEdit(section.id, e.target.value)}
                        rows={14}
                        className="w-full rounded-lg border px-3 py-2 text-sm text-gray-700 resize-y leading-relaxed focus:outline-none flex-1"
                        style={{ borderColor: '#d1d5db' }}
                      />

                      <p className="text-xs text-gray-400 mt-2 text-right">
                        {currentContent.length} characters
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Bottom actions */}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleDownload}
                  className="px-4 py-2 rounded-lg text-sm font-semibold border transition-colors hover:bg-gray-50"
                  style={{ borderColor: 'var(--color-secondary)', color: 'var(--color-secondary)' }}
                >
                  Download Draft (.txt)
                </button>
                <button
                  onClick={() => router.push(`/projects/${projectId}/report`)}
                  className="px-5 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ backgroundColor: 'var(--color-secondary)' }}
                >
                  Proceed to Report →
                </button>
              </div>
            </>
          )}

          {/* No draft yet — show proceed link anyway */}
          {!draft && (
            <div className="mt-2">
              <button
                onClick={() => router.push(`/projects/${projectId}/report`)}
                className="text-sm text-gray-400 hover:text-gray-600 underline"
              >
                Skip and proceed to Report →
              </button>
            </div>
          )}
        </>
      )}

      {/* Always show skip link when disabled */}
      {!enabled && (
        <div className="mt-5">
          <button
            onClick={() => router.push(`/projects/${projectId}/report`)}
            className="px-5 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--color-secondary)' }}
          >
            Proceed to Report →
          </button>
        </div>
      )}
    </div>
  );
}
