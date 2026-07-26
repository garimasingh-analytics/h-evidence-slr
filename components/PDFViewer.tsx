'use client';

import { useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PDFViewerProps {
  file: File | null;
  currentPage: number;
  onPageChange: (page: number) => void;
  totalPages: number;
  onLoad: (numPages: number) => void;
  highlightSource: { text: string; page: string } | null;
}

export default function PDFViewer({
  file,
  currentPage,
  onPageChange,
  totalPages,
  onLoad,
  highlightSource,
}: PDFViewerProps) {
  const [loading, setLoading] = useState(true);
  const pageContainerRef = useRef<HTMLDivElement>(null);

  // Scroll the page container into view when page changes
  useEffect(() => {
    if (pageContainerRef.current) {
      pageContainerRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [currentPage]);

  if (!file) {
    return (
      <div className="flex items-center justify-center h-64 rounded-lg border-2 border-dashed text-gray-400 text-sm"
        style={{ borderColor: '#e5e7eb' }}>
        No PDF selected
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Navigation bar */}
      <div className="flex items-center justify-between rounded-lg px-3 py-2 text-sm"
        style={{ backgroundColor: 'var(--color-primary)', color: 'white' }}>
        <button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          className="px-2 py-1 rounded transition-opacity disabled:opacity-40 hover:opacity-80"
          aria-label="Previous page"
        >
          ← Prev
        </button>
        <span className="font-medium">
          Page {currentPage} of {totalPages || '—'}
        </span>
        <button
          onClick={() => onPageChange(Math.min(totalPages || currentPage, currentPage + 1))}
          disabled={totalPages > 0 && currentPage >= totalPages}
          className="px-2 py-1 rounded transition-opacity disabled:opacity-40 hover:opacity-80"
          aria-label="Next page"
        >
          Next →
        </button>
      </div>

      {/* PDF render area */}
      <div
        ref={pageContainerRef}
        className="flex justify-center overflow-auto rounded-lg border"
        style={{ borderColor: '#e5e7eb', minHeight: '400px', backgroundColor: '#f9fafb' }}
      >
        {loading && (
          <div className="absolute flex items-center justify-center w-full h-full">
            <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: 'var(--color-secondary)', borderTopColor: 'transparent' }} />
          </div>
        )}
        <Document
          file={file}
          onLoadSuccess={({ numPages }) => {
            setLoading(false);
            onLoad(numPages);
          }}
          onLoadError={() => setLoading(false)}
          loading={
            <div className="flex items-center justify-center p-12">
              <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: 'var(--color-secondary)', borderTopColor: 'transparent' }} />
            </div>
          }
        >
          <Page
            pageNumber={currentPage}
            width={500}
            renderTextLayer={true}
            renderAnnotationLayer={true}
          />
        </Document>
      </div>

      {/* Source highlight box */}
      {highlightSource && highlightSource.text && (
        <div
          className="rounded-lg p-4 text-sm border-l-4"
          style={{
            backgroundColor: '#fefce8',
            borderLeftColor: 'var(--color-secondary)',
          }}
        >
          <div className="font-semibold mb-1 text-gray-700">
            Source{highlightSource.page ? ` (page ${highlightSource.page})` : ''}:
          </div>
          <blockquote className="text-gray-800 italic leading-relaxed">
            &ldquo;{highlightSource.text}&rdquo;
          </blockquote>
        </div>
      )}
    </div>
  );
}
