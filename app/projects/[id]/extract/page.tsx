'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { parseCodingForm, assessPromptQuality } from '@/lib/extract/parseCodingForm';
import { exportToExcel } from '@/lib/extract/exportCodingForm';
import { DEFAULT_EXTRACTION_PROMPTS, createMetadataCodingRow } from '@/lib/extract/defaultForm';
import type { SearchRecord } from '@/lib/search/types';
import type { ScreenState } from '@/lib/screen/types';
import type {
  ExtractionPrompt,
  ExtractionResponse,
  ExtractionResult,
  CodingFormRow,
} from '@/lib/extract/types';

// Dynamically import PDFViewer to avoid SSR issues with pdfjs
const PDFViewer = dynamic(() => import('@/components/PDFViewer'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
      Loading PDF viewer...
    </div>
  ),
});

type ExtractPhase = 'setup' | 'review' | 'complete';

interface PersistedState {
  prompts: ExtractionPrompt[];
  promptsConfirmed: boolean;
  results: Record<string, ExtractionResult>;
  recordedRows: CodingFormRow[];
  phase: ExtractPhase;
}

interface ExtractPageProps {
  params: Promise<{ id: string }>;
}

interface FullTextDiscovery {
  id: string;
  isOpenAccess: boolean;
  fullTextUrl: string | null;
  landingPageUrl: string | null;
  source: string;
}

export default function ExtractPage({ params }: ExtractPageProps) {
  const { id: projectId } = use(params);
  const router = useRouter();

  // ── Core state ──────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<ExtractPhase>('setup');
  const [prompts, setPrompts] = useState<ExtractionPrompt[]>([]);
  const [promptsConfirmed, setPromptsConfirmed] = useState(false);
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [currentPdfIndex, setCurrentPdfIndex] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [results, setResults] = useState<Record<string, ExtractionResult>>({});
  const [recordedRows, setRecordedRows] = useState<CodingFormRow[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [highlightSource, setHighlightSource] = useState<{ text: string; page: string } | null>(null);
  const [viewFormOpen, setViewFormOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [includedStudyCount, setIncludedStudyCount] = useState(0);
  const [automaticRowsCreated, setAutomaticRowsCreated] = useState(false);

  // ── LocalStorage persistence ─────────────────────────────────────────────
  const storageKey = `extract_state_${projectId}`;

  useEffect(() => {
    async function loadState() {
      let parsed: Partial<PersistedState> | null = null;

      let searchRecords: SearchRecord[] = [];
      let screenState: ScreenState | null = null;

      // DB first: load this step and its upstream project data together.
      try {
        const [res, searchRes, screenRes] = await Promise.all([
          fetch(`/api/state/${projectId}/extract`),
          fetch(`/api/state/${projectId}/search`),
          fetch(`/api/state/${projectId}/screen`),
        ]);
        if (res.ok) {
          const data = (await res.json()) as { state: Partial<PersistedState> | null };
          if (data.state && Object.keys(data.state).length > 0) {
            parsed = data.state;
            // Write-through to localStorage
            try { localStorage.setItem(storageKey, JSON.stringify(parsed)); } catch { /* ignore */ }
          }
        }
        if (searchRes.ok) {
          const data = (await searchRes.json()) as { state: { records?: SearchRecord[] } | null };
          searchRecords = data.state?.records ?? [];
        }
        if (screenRes.ok) {
          const data = (await screenRes.json()) as { state: ScreenState | null };
          screenState = data.state;
        }
      } catch {
        // fall through
      }

      // Fallback: localStorage
      if (!parsed) {
        try {
          const saved = localStorage.getItem(storageKey);
          if (saved) parsed = JSON.parse(saved) as Partial<PersistedState>;
        } catch {
          // ignore corrupt storage
        }
      }

      const includedIds = new Set<string>();
      if (screenState) {
        for (const result of Object.values(screenState.results)) {
          if ((result.humanDecision ?? result.consensusDecision) === 'include') {
            includedIds.add(result.recordId);
          }
        }
      }
      const includedRecords = searchRecords.filter(
        (record) => includedIds.has(record.id) && !record.isDuplicate
      );
      setIncludedStudyCount(includedRecords.length);

      let rowsForWorkspace = parsed?.recordedRows ?? [];
      let generatedAutomatically = false;

      if (includedRecords.length > 0 && rowsForWorkspace.length === 0) {
        rowsForWorkspace = includedRecords.map(createMetadataCodingRow);
        generatedAutomatically = true;
      }

      // Discover legal open-access copies without downloading restricted files.
      if (
        includedRecords.length > 0 &&
        rowsForWorkspace.some((row) => !row['Open access status'])
      ) {
        const discoveries: FullTextDiscovery[] = [];
        for (let index = 0; index < includedRecords.length; index += 25) {
          try {
            const response = await fetch('/api/fulltext/discover', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                records: includedRecords.slice(index, index + 25).map((record) => ({
                  id: record.id,
                  doi: record.doi,
                  url: record.url,
                })),
              }),
            });
            if (response.ok) {
              const data = (await response.json()) as { results?: FullTextDiscovery[] };
              discoveries.push(...(data.results ?? []));
            }
          } catch {
            // Discovery is an enhancement; metadata extraction remains usable.
          }
        }

        const discoveryById = new Map(discoveries.map((item) => [item.id, item]));
        rowsForWorkspace = rowsForWorkspace.map((row) => {
          const discovery = discoveryById.get(row['Study ID']);
          if (!discovery) return { ...row, 'Open access status': 'Not checked' };
          return {
            ...row,
            'Open access status': discovery.isOpenAccess ? 'Open access copy found' : 'Manual full-text check needed',
            'Full text link': discovery.fullTextUrl ?? discovery.landingPageUrl ?? '',
            'Full text source': discovery.source,
          };
        });
      }

      if (parsed) {
        if (parsed.prompts) setPrompts(parsed.prompts);
        if (parsed.promptsConfirmed !== undefined) setPromptsConfirmed(parsed.promptsConfirmed);
        if (parsed.results) setResults(parsed.results);
        if (rowsForWorkspace.length > 0) setRecordedRows(rowsForWorkspace);
        if (parsed.phase) setPhase(parsed.phase);
      }

      // First visit migration: carry included studies forward and generate a
      // standard SLR coding form without requiring uploads.
      if (includedRecords.length > 0 && generatedAutomatically) {
        const automaticRows = rowsForWorkspace;
        setPrompts(DEFAULT_EXTRACTION_PROMPTS);
        setPromptsConfirmed(true);
        setRecordedRows(automaticRows);
        setPhase('complete');
        setAutomaticRowsCreated(true);

        const automaticState: PersistedState = {
          prompts: DEFAULT_EXTRACTION_PROMPTS,
          promptsConfirmed: true,
          results: parsed?.results ?? {},
          recordedRows: automaticRows,
          phase: 'complete',
        };
        try {
          await fetch(`/api/state/${projectId}/extract`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: automaticState }),
          });
        } catch {
          // local persistence below still keeps the workflow usable
        }
      } else if (rowsForWorkspace.length > 0 && rowsForWorkspace !== parsed?.recordedRows) {
        setRecordedRows(rowsForWorkspace);
        const enrichedState: PersistedState = {
          prompts: parsed?.prompts?.length ? parsed.prompts : DEFAULT_EXTRACTION_PROMPTS,
          promptsConfirmed: parsed?.promptsConfirmed ?? true,
          results: parsed?.results ?? {},
          recordedRows: rowsForWorkspace,
          phase: parsed?.phase ?? 'complete',
        };
        try {
          await fetch(`/api/state/${projectId}/extract`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: enrichedState }),
          });
        } catch {
          // local persistence below still keeps the workflow usable
        }
      }

      setHydrated(true);
    }

    loadState();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const toSave: PersistedState = {
        prompts,
        promptsConfirmed,
        results,
        recordedRows,
        phase,
      };
      localStorage.setItem(storageKey, JSON.stringify(toSave));
    } catch {
      // ignore storage errors
    }
  }, [prompts, promptsConfirmed, results, recordedRows, phase, storageKey, hydrated]);

  // ── PDF extraction ────────────────────────────────────────────────────────
  const triggerExtraction = useCallback(
    async (file: File) => {
      if (results[file.name]?.responses?.length > 0) return; // already extracted
      setExtracting(true);
      setExtractError(null);
      try {
        // Dynamic import keeps pdfjs-dist out of the SSR module graph
        const { extractPDFText } = await import('@/lib/extract/pdfExtract');
        const { fullText } = await extractPDFText(file);
        const res = await fetch('/api/extract/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pdfText: fullText,
            prompts: prompts.map((p) => p.text),
            pdfName: file.name,
          }),
        });
        const data = (await res.json()) as {
          responses?: ExtractionResponse[];
          pdfName?: string;
          error?: string;
        };
        if (data.error && !data.responses) {
          setExtractError(data.error);
        }
        const responses = data.responses ?? [];
        setResults((prev) => ({
          ...prev,
          [file.name]: {
            pdfName: file.name,
            responses,
            recorded: false,
            extractedAt: new Date().toISOString(),
          },
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setExtractError(msg);
      } finally {
        setExtracting(false);
      }
    },
    [prompts, results]
  );

  // Auto-trigger extraction when current PDF changes
  useEffect(() => {
    if (phase !== 'review') return;
    const file = pdfFiles[currentPdfIndex];
    if (!file) return;
    if (!results[file.name]) {
      triggerExtraction(file);
    }
  }, [currentPdfIndex, pdfFiles, phase, results, triggerExtraction]);

  // ── Response editing ──────────────────────────────────────────────────────
  function handleResponseEdit(pdfName: string, promptText: string, value: string) {
    setResults((prev) => {
      const result = prev[pdfName];
      if (!result) return prev;
      return {
        ...prev,
        [pdfName]: {
          ...result,
          responses: result.responses.map((r) =>
            r.prompt === promptText ? { ...r, response: value, edited: true } : r
          ),
        },
      };
    });
  }

  // ── Record & Next PDF ─────────────────────────────────────────────────────
  function handleRecord() {
    const file = pdfFiles[currentPdfIndex];
    if (!file) return;
    const result = results[file.name];
    if (!result) return;

    const row: CodingFormRow = { pdfName: file.name };
    for (const r of result.responses) {
      row[r.prompt] = r.response;
    }

    const newRecordedRows = [...recordedRows, row];
    const newResults = { ...results, [file.name]: { ...results[file.name], recorded: true } };

    setRecordedRows(newRecordedRows);
    setResults(newResults);

    // Save to DB (checkpoint: row recorded)
    const stateToSave: PersistedState = {
      prompts,
      promptsConfirmed,
      results: newResults,
      recordedRows: newRecordedRows,
      phase: currentPdfIndex < pdfFiles.length - 1 ? phase : 'complete',
    };
    fetch(`/api/state/${projectId}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: stateToSave }),
    }).catch(() => {}); // silent — localStorage already updated

    if (currentPdfIndex < pdfFiles.length - 1) {
      const nextIndex = currentPdfIndex + 1;
      setCurrentPdfIndex(nextIndex);
      setCurrentPage(1);
      setHighlightSource(null);
    } else {
      setPhase('complete');
    }
  }

  // ── Coding form upload ────────────────────────────────────────────────────
  async function handleCodingFormUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseCodingForm(file);
      setPrompts(parsed);
      setPromptsConfirmed(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to parse coding form');
    }
    // Reset input so same file can be re-uploaded
    e.target.value = '';
  }

  function handlePDFUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setPdfFiles((prev) => [...prev, ...files]);
    e.target.value = '';
  }

  function handleStartExtraction() {
    setPhase('review');
    setCurrentPdfIndex(0);
    setCurrentPage(1);
    setHighlightSource(null);
    // Trigger extraction for first PDF
    const first = pdfFiles[0];
    if (first && !results[first.name]) {
      triggerExtraction(first);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  const currentFile = pdfFiles[currentPdfIndex] ?? null;
  const currentResult = currentFile ? results[currentFile.name] : null;

  function qualityBadge(quality: 'good' | 'warn' | 'bad') {
    if (quality === 'good')
      return (
        <span className="text-xs font-medium px-2 py-0.5 rounded-full"
          style={{ backgroundColor: '#dcfce7', color: '#166534' }}>
          Good
        </span>
      );
    if (quality === 'warn')
      return (
        <span className="text-xs font-medium px-2 py-0.5 rounded-full"
          style={{ backgroundColor: '#fef9c3', color: '#854d0e' }}>
          Check phrasing
        </span>
      );
    return (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full"
        style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>
        Too vague
      </span>
    );
  }

  if (!hydrated) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: 'var(--color-secondary)', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  // ── SETUP PHASE ────────────────────────────────────────────────────────────
  if (phase === 'setup') {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex items-center justify-center rounded-full text-sm font-bold shrink-0"
            style={{ width: '36px', height: '36px', backgroundColor: 'var(--color-secondary)', color: 'white' }}>
            3
          </div>
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--color-primary)' }}>
              Data Extraction Workspace
            </h1>
            <p className="text-sm text-gray-500">Project: {projectId}</p>
          </div>
        </div>

        {/* Coding form upload */}
        <section className="rounded-xl border bg-white p-6 mb-6" style={{ borderColor: '#e5e7eb' }}>
          <h2 className="font-semibold text-base mb-1" style={{ color: 'var(--color-primary)' }}>
            Coding Form
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            A standard systematic-review coding form is created automatically from included studies. Upload a custom form only when the protocol requires different fields.
          </p>

          {/* Guidance tip */}
          <div className="rounded-lg p-3 mb-4 text-xs"
            style={{ backgroundColor: '#eff6ff', color: '#1e40af' }}>
            <strong>Tip:</strong> Good prompts: &ldquo;What is the total sample size?&rdquo; / &ldquo;List all
            authors, separated by commas.&rdquo; — Poor prompts: &ldquo;Authors&rdquo;, &ldquo;N&rdquo; (too
            vague, no action verb or question mark).
          </div>

          <label className="block border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors hover:bg-gray-50"
            style={{ borderColor: 'var(--color-secondary)' }}>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleCodingFormUpload}
              className="sr-only"
            />
            <div className="text-sm text-gray-500">
              Click to upload or drag &amp; drop
              <br />
              <span className="text-xs">.xlsx, .xls, .csv accepted</span>
            </div>
          </label>

          {/* Parsed prompts table */}
          {prompts.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-700">
                  {prompts.length} extraction prompt{prompts.length !== 1 ? 's' : ''} found
                </h3>
                {promptsConfirmed && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: '#dcfce7', color: '#166534' }}>
                    Confirmed
                  </span>
                )}
              </div>
              <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#e5e7eb' }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: '#f9fafb' }}>
                      <th className="text-left px-3 py-2 text-gray-600 font-medium">#</th>
                      <th className="text-left px-3 py-2 text-gray-600 font-medium">Prompt</th>
                      <th className="text-left px-3 py-2 text-gray-600 font-medium">Quality</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prompts.map((p) => (
                      <tr key={p.index} className="border-t" style={{ borderColor: '#e5e7eb' }}>
                        <td className="px-3 py-2 text-gray-400 text-xs">{p.index + 1}</td>
                        <td className="px-3 py-2 text-gray-700">{p.text}</td>
                        <td className="px-3 py-2">{qualityBadge(assessPromptQuality(p.text))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!promptsConfirmed && (
                <button
                  onClick={() => setPromptsConfirmed(true)}
                  className="mt-3 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ backgroundColor: 'var(--color-primary)' }}
                >
                  Confirm Prompts
                </button>
              )}
              {promptsConfirmed && (
                <button
                  onClick={() => { setPrompts([]); setPromptsConfirmed(false); }}
                  className="mt-3 px-4 py-2 rounded-lg text-sm font-medium text-gray-600 border hover:bg-gray-50"
                  style={{ borderColor: '#d1d5db' }}
                >
                  Re-upload coding form
                </button>
              )}
            </div>
          )}
        </section>

        {/* PDF upload */}
        <section className="rounded-xl border bg-white p-6 mb-6" style={{ borderColor: '#e5e7eb' }}>
          <h2 className="font-semibold text-base mb-1" style={{ color: 'var(--color-primary)' }}>
            Optional Full-Text Enrichment
          </h2>
          <p className="text-sm text-gray-500 mb-1">
            Included studies are already available from screening. Upload only the PDFs you want to enrich with full-text evidence and page-level citations.
          </p>
          <p className="text-xs text-gray-400 mb-4">
            Text-only mode: PDFs are processed as extracted text. Visual content (figures, tables)
            requires a vision-capable model.
          </p>

          <label className="block border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors hover:bg-gray-50"
            style={{ borderColor: 'var(--color-secondary)' }}>
            <input
              type="file"
              accept=".pdf"
              multiple
              onChange={handlePDFUpload}
              className="sr-only"
            />
            <div className="text-sm text-gray-500">
              Click to upload or drag &amp; drop
              <br />
              <span className="text-xs">.pdf files accepted · multiple allowed</span>
            </div>
          </label>

          {pdfFiles.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium text-gray-700 mb-2">
                {pdfFiles.length} PDF{pdfFiles.length !== 1 ? 's' : ''} queued
              </p>
              <ul className="space-y-1">
                {pdfFiles.map((f, i) => (
                  <li key={i} className="flex items-center justify-between text-sm px-3 py-2 rounded-lg"
                    style={{ backgroundColor: '#f9fafb' }}>
                    <span className="text-gray-700 truncate max-w-xs">{f.name}</span>
                    <button
                      onClick={() => setPdfFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-xs text-red-400 hover:text-red-600 ml-2 shrink-0"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Start button */}
        <div className="flex justify-end">
          <button
            disabled={!promptsConfirmed || pdfFiles.length === 0}
            onClick={handleStartExtraction}
            className="px-6 py-3 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--color-secondary)' }}
          >
            Enrich Uploaded PDFs →
          </button>
        </div>
      </div>
    );
  }

  // ── REVIEW PHASE ──────────────────────────────────────────────────────────
  if (phase === 'review') {
    return (
      <div className="h-full flex flex-col">
        {/* Top bar: PDF selector */}
        <div className="px-6 py-3 border-b flex items-center justify-between"
          style={{ borderColor: '#e5e7eb', backgroundColor: '#f9fafb' }}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (currentPdfIndex > 0) {
                  setCurrentPdfIndex((i) => i - 1);
                  setCurrentPage(1);
                  setHighlightSource(null);
                }
              }}
              disabled={currentPdfIndex === 0}
              className="text-sm px-2 py-1 rounded border disabled:opacity-40 hover:bg-gray-100"
              style={{ borderColor: '#d1d5db' }}
            >
              ← Prev PDF
            </button>
            <span className="text-sm font-medium text-gray-700">
              PDF {currentPdfIndex + 1} of {pdfFiles.length}:&nbsp;
              <span className="text-gray-500">{currentFile?.name ?? ''}</span>
            </span>
            <button
              onClick={() => {
                if (currentPdfIndex < pdfFiles.length - 1) {
                  setCurrentPdfIndex((i) => i + 1);
                  setCurrentPage(1);
                  setHighlightSource(null);
                }
              }}
              disabled={currentPdfIndex >= pdfFiles.length - 1}
              className="text-sm px-2 py-1 rounded border disabled:opacity-40 hover:bg-gray-100"
              style={{ borderColor: '#d1d5db' }}
            >
              Next PDF →
            </button>
          </div>
          <button
            onClick={() => setPhase('setup')}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            ← Back to setup
          </button>
        </div>

        {/* Side-by-side layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: PDF viewer */}
          <div className="w-1/2 border-r overflow-y-auto p-4" style={{ borderColor: '#e5e7eb' }}>
            <PDFViewer
              file={currentFile}
              currentPage={currentPage}
              onPageChange={setCurrentPage}
              totalPages={totalPages}
              onLoad={(n) => setTotalPages(n)}
              highlightSource={highlightSource}
            />
          </div>

          {/* Right: extraction grid */}
          <div className="w-1/2 overflow-y-auto p-4 flex flex-col gap-4">
            {/* Grid header */}
            <div className="flex items-center justify-between">
              <div>
                {extracting ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
                      style={{ borderColor: 'var(--color-secondary)', borderTopColor: 'transparent' }} />
                    Extracting data from {currentFile?.name ?? ''}…
                  </div>
                ) : currentResult ? (
                  <p className="text-sm text-green-700 font-medium">
                    AI extraction complete — review and edit responses, then click Record.
                  </p>
                ) : extractError ? (
                  <p className="text-sm text-red-600">{extractError}</p>
                ) : null}
              </div>
              <button
                onClick={handleRecord}
                disabled={!currentResult || extracting}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                style={{ backgroundColor: 'var(--color-secondary)' }}
              >
                {currentPdfIndex < pdfFiles.length - 1 ? 'Record & Next PDF →' : 'Record & Finish'}
              </button>
            </div>

            {/* Response cards */}
            {extracting && !currentResult && (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
                <div className="w-10 h-10 border-4 border-t-transparent rounded-full animate-spin"
                  style={{ borderColor: 'var(--color-secondary)', borderTopColor: 'transparent' }} />
                <span className="text-sm">Running AI extraction…</span>
              </div>
            )}

            {currentResult && (
              <div className="flex flex-col gap-3">
                {currentResult.responses.map((resp, i) => {
                  const isNotReported = resp.response === 'Not reported';
                  const isError = resp.response.startsWith('Extraction failed');
                  return (
                    <div key={i} className="rounded-xl border p-4 bg-white"
                      style={{ borderColor: '#e5e7eb' }}>
                      {/* Prompt */}
                      <p className="text-sm font-semibold mb-2"
                        style={{ color: 'var(--color-primary)' }}>
                        {resp.prompt}
                      </p>

                      {/* Response textarea */}
                      <textarea
                        value={resp.response}
                        onChange={(e) =>
                          handleResponseEdit(currentFile!.name, resp.prompt, e.target.value)
                        }
                        rows={2}
                        className="w-full rounded border px-3 py-2 text-sm resize-y"
                        style={{
                          borderColor: '#d1d5db',
                          color: isNotReported || isError ? '#9ca3af' : '#374151',
                          fontStyle: isNotReported || isError ? 'italic' : 'normal',
                        }}
                      />
                      {resp.edited && (
                        <span className="text-xs text-blue-500 mt-0.5 block">Edited</span>
                      )}

                      {/* Source quote — clickable */}
                      {resp.source && (
                        <button
                          onClick={() => {
                            const pageNum = parseInt(resp.page, 10);
                            if (!isNaN(pageNum) && pageNum > 0) {
                              setCurrentPage(pageNum);
                            }
                            setHighlightSource({ text: resp.source, page: resp.page });
                          }}
                          className="mt-2 flex items-start gap-1 text-xs text-left transition-colors hover:opacity-80 w-full"
                          style={{ color: 'var(--color-secondary)' }}
                          title="Click to jump to this source in the PDF"
                        >
                          <span className="shrink-0">📍</span>
                          <span>
                            {resp.page ? `Page ${resp.page}: ` : ''}
                            &ldquo;{resp.source.slice(0, 100)}{resp.source.length > 100 ? '…' : ''}&rdquo;
                          </span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Placeholder if no result yet and not extracting */}
            {!currentResult && !extracting && (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-gray-400">
                <p className="text-sm">Select a PDF and start extraction to see results here.</p>
                {pdfFiles.length > 0 && (
                  <button
                    onClick={() => triggerExtraction(pdfFiles[currentPdfIndex])}
                    className="mt-2 px-4 py-2 rounded-lg text-sm font-semibold text-white"
                    style={{ backgroundColor: 'var(--color-secondary)' }}
                  >
                    Extract Now
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── COMPLETE PHASE ────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center justify-center rounded-full text-sm font-bold shrink-0"
          style={{ width: '36px', height: '36px', backgroundColor: '#16a34a', color: 'white' }}>
          ✓
        </div>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-primary)' }}>
            Extraction Workspace Ready
          </h1>
          <p className="text-sm text-gray-500">
            {recordedRows.length} included stud{recordedRows.length === 1 ? 'y' : 'ies'} carried forward
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-6">
        <div className="rounded-xl border bg-white p-4" style={{ borderColor: '#e5e7eb' }}>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Open full text</p>
          <p className="text-2xl font-bold mt-1" style={{ color: 'var(--color-primary)' }}>{recordedRows.filter((row) => row['Open access status'] === 'Open access copy found').length}</p>
          <p className="text-xs text-gray-400 mt-1">Legal copies discovered automatically</p>
        </div>
        <div className="rounded-xl border bg-white p-4" style={{ borderColor: '#e5e7eb' }}>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Included studies</p>
          <p className="text-2xl font-bold mt-1" style={{ color: 'var(--color-primary)' }}>{includedStudyCount || recordedRows.length}</p>
          <p className="text-xs text-gray-400 mt-1">Loaded automatically from screening</p>
        </div>
        <div className="rounded-xl border bg-white p-4" style={{ borderColor: '#e5e7eb' }}>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Coding fields</p>
          <p className="text-2xl font-bold mt-1" style={{ color: 'var(--color-primary)' }}>{prompts.length}</p>
          <p className="text-xs text-gray-400 mt-1">Generated standard SLR template</p>
        </div>
        <div className="rounded-xl border bg-white p-4" style={{ borderColor: '#e5e7eb' }}>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Workflow status</p>
          <p className="text-sm font-bold mt-2 text-green-700">Ready for report</p>
          <p className="text-xs text-gray-400 mt-1">PDF enrichment remains optional</p>
        </div>
      </div>

      {automaticRowsCreated && (
        <div className="rounded-xl border p-4 mb-6 text-sm" style={{ borderColor: '#bfdbfe', backgroundColor: '#eff6ff', color: '#1e40af' }}>
          <strong>Automatic handoff complete.</strong> Screening decisions, bibliographic metadata, and abstracts have been transferred into the coding form. Upload full text only for fields that require deeper verification.
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3 mb-6">
        <button
          onClick={() => exportToExcel(recordedRows, prompts)}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          Download Form (.xlsx)
        </button>
        <button
          onClick={() => setViewFormOpen((v) => !v)}
          className="px-4 py-2 rounded-lg text-sm font-semibold border transition-colors hover:bg-gray-50"
          style={{ borderColor: 'var(--color-secondary)', color: 'var(--color-secondary)' }}
        >
          {viewFormOpen ? 'Hide Form' : 'View Form'}
        </button>
        <button
          onClick={() => {
            // Allow adding more PDFs
            setPhase('setup');
          }}
          className="px-4 py-2 rounded-lg text-sm font-medium border text-gray-600 hover:bg-gray-50"
          style={{ borderColor: '#d1d5db' }}
        >
          Add or Enrich with PDFs
        </button>
        <button
          onClick={() => router.push(`/projects/${projectId}/report`)}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--color-secondary)' }}
        >
          Proceed to Report →
        </button>
      </div>

      {/* Optional narrative step */}
      <div
        className="rounded-xl border p-4 mb-6 flex items-center justify-between gap-4"
        style={{ borderColor: '#e5e7eb', backgroundColor: '#f9fafb' }}
      >
        <div>
          <p className="text-sm font-medium text-gray-700">Optional: Narrative Drafting</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Generate background and discussion prose before writing the report.
          </p>
        </div>
        <button
          onClick={() => router.push(`/projects/${projectId}/narrative`)}
          className="shrink-0 px-4 py-2 rounded-lg text-sm font-semibold border transition-colors hover:bg-white"
          style={{ borderColor: 'var(--color-secondary)', color: 'var(--color-secondary)' }}
        >
          Generate Narrative Draft →
        </button>
      </div>

      {/* In-app table */}
      {viewFormOpen && recordedRows.length > 0 && (
        <div className="rounded-xl border overflow-hidden mb-6" style={{ borderColor: '#e5e7eb' }}>
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr style={{ backgroundColor: 'var(--color-primary)' }}>
                  <th
                    className="text-left px-3 py-2 text-white font-semibold sticky left-0 z-10"
                    style={{ backgroundColor: 'var(--color-primary)', minWidth: '160px' }}
                  >
                    Study
                  </th>
                  {prompts.map((p) => (
                    <th key={p.index} className="text-left px-3 py-2 text-white font-semibold"
                      style={{ minWidth: '140px' }}>
                      {p.text.slice(0, 40)}{p.text.length > 40 ? '…' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recordedRows.map((row, i) => (
                  <tr key={i} className="border-t hover:bg-gray-50" style={{ borderColor: '#e5e7eb' }}>
                    <td
                      className="px-3 py-2 text-gray-700 font-medium sticky left-0"
                      style={{ backgroundColor: 'white', minWidth: '160px' }}
                      title={row.pdfName}
                    >
                      {row.pdfName.slice(0, 30)}{row.pdfName.length > 30 ? '…' : ''}
                    </td>
                    {prompts.map((p) => {
                      const val = row[p.text] ?? '';
                      return (
                        <td key={p.index} className="px-3 py-2 text-gray-600"
                          style={{ minWidth: '140px' }}
                          title={val}>
                          {val.slice(0, 100)}{val.length > 100 ? '…' : ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {recordedRows.length === 0 && (
        <div className="rounded-xl border-2 border-dashed p-8 text-center text-gray-400 text-sm"
          style={{ borderColor: '#d1d5db' }}>
          No rows recorded yet. Go back and record some PDF extractions.
        </div>
      )}
    </div>
  );
}
