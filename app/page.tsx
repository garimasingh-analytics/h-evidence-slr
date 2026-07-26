'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getProjects, createProject } from '@/lib/projectStore';
import type { Project } from '@/lib/types';

const STEP_LABELS: Record<string, string> = {
  search: 'Search',
  screen: 'Screen',
  extract: 'Extract',
  report: 'Report',
};

function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-8 text-center">
      <div
        className="flex items-center justify-center rounded-full mb-6"
        style={{
          width: '72px',
          height: '72px',
          backgroundColor: 'rgba(59,155,197,0.12)',
        }}
      >
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <path
            d="M16 6v20M6 16h20"
            stroke="var(--color-secondary)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--color-primary)' }}>
        No projects yet
      </h2>
      <p className="text-sm text-gray-500 max-w-xs mb-6">
        Create your first systematic literature review project to get started.
      </p>
      <button
        onClick={onCreateClick}
        className="rounded px-6 py-2.5 text-sm font-medium transition-opacity hover:opacity-90 cursor-pointer"
        style={{ backgroundColor: 'var(--color-secondary)', color: 'white' }}
      >
        Create New Project
      </button>
    </div>
  );
}

function ProjectCard({ project, onClick }: { project: Project; onClick: () => void }) {
  const stepPercent: Record<string, number> = { search: 25, screen: 50, extract: 75, report: 100 };
  const percent = stepPercent[project.currentStep] ?? 25;

  return (
    <button
      onClick={onClick}
      className="text-left w-full rounded-xl border p-5 bg-white transition-shadow hover:shadow-md cursor-pointer"
      style={{ borderColor: '#e5e7eb' }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h3
            className="font-semibold text-base leading-snug truncate"
            style={{ color: 'var(--color-primary)' }}
          >
            {project.name}
          </h3>
          {project.description && (
            <p className="text-sm text-gray-500 mt-1 line-clamp-2">{project.description}</p>
          )}
        </div>
        <span
          className="shrink-0 text-xs font-medium rounded-full px-2.5 py-1"
          style={{
            backgroundColor: 'rgba(59,155,197,0.12)',
            color: 'var(--color-secondary)',
          }}
        >
          {STEP_LABELS[project.currentStep]}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#e5e7eb' }}>
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${percent}%`,
            backgroundColor: 'var(--color-secondary)',
          }}
        />
      </div>

      <p className="text-xs text-gray-400 mt-2">
        Created{' '}
        {new Date(project.createdAt).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })}
      </p>
    </button>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [formError, setFormError] = useState('');

  const loadProjects = useCallback(async () => {
    // DB primary
    try {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const rows = (await res.json()) as Array<{
          id: string;
          name: string;
          description: string;
          current_step: string;
          created_at: string;
        }>;
        const dbProjects: Project[] = rows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description ?? '',
          createdAt: r.created_at,
          currentStep: (r.current_step ?? 'search') as Project['currentStep'],
        }));
        setProjects(dbProjects);
        // Write-through to localStorage
        dbProjects.forEach((p) => {
          try {
            const stored = getProjects();
            const idx = stored.findIndex((s) => s.id === p.id);
            if (idx < 0) stored.push(p);
            else stored[idx] = { ...stored[idx], currentStep: p.currentStep };
            localStorage.setItem('h-evidence-slr-projects', JSON.stringify(stored));
          } catch { /* ignore */ }
        });
        return;
      }
    } catch {
      // fall through
    }
    // Fallback: localStorage
    setProjects(getProjects().sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }, []);

  useEffect(() => {
    loadProjects();
    window.addEventListener('storage', loadProjects);
    return () => window.removeEventListener('storage', loadProjects);
  }, [loadProjects]);

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) {
      setFormError('Project name is required.');
      return;
    }
    const project = createProject(newName, newDescription);
    setNewName('');
    setNewDescription('');
    setFormError('');
    setShowNewForm(false);
    // DB primary (fire-and-forget — localStorage already saved)
    fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: project.id, name: project.name, description: project.description }),
    }).catch(() => {});
    await loadProjects();
    router.push(`/projects/${project.id}/search`);
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--color-primary)' }}>
          H Evidence AI SLR Tool
        </h1>
        <p className="text-gray-500 max-w-xl">
          AI-assisted systematic literature review platform. Search, screen, extract, and generate
          PRISMA-2020-compliant reports — all in one place.
        </p>
      </div>

      {/* Workflow summary cards */}
      <div className="grid grid-cols-4 gap-3 mb-10">
        {[
          { num: 1, label: 'Search', desc: 'Retrieve papers from PubMed, Europe PMC & OpenAlex' },
          { num: 2, label: 'Screen', desc: 'AI dual-pass screening with human review' },
          { num: 3, label: 'Extract', desc: 'Side-by-side PDF & coding form extraction' },
          { num: 4, label: 'Report', desc: 'Generate PRISMA-2020 Word manuscript' },
        ].map((item) => (
          <div
            key={item.num}
            className="rounded-lg p-4 border"
            style={{ backgroundColor: 'white', borderColor: '#e5e7eb' }}
          >
            <div
              className="flex items-center justify-center rounded-full text-xs font-bold mb-2"
              style={{
                width: '28px',
                height: '28px',
                backgroundColor: 'var(--color-secondary)',
                color: 'white',
              }}
            >
              {item.num}
            </div>
            <div className="font-semibold text-sm mb-1" style={{ color: 'var(--color-primary)' }}>
              {item.label}
            </div>
            <div className="text-xs text-gray-400">{item.desc}</div>
          </div>
        ))}
      </div>

      {/* Projects section */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--color-primary)' }}>
          Your Projects
        </h2>
        <button
          onClick={() => {
            setShowNewForm((v) => !v);
            setFormError('');
          }}
          className="flex items-center gap-1.5 rounded px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90 cursor-pointer"
          style={{ backgroundColor: 'var(--color-secondary)', color: 'white' }}
        >
          <span style={{ fontSize: '16px', lineHeight: 1 }}>+</span>
          New Project
        </button>
      </div>

      {/* New project inline form */}
      {showNewForm && (
        <form
          onSubmit={handleCreateProject}
          className="rounded-xl border p-5 mb-4 bg-white"
          style={{ borderColor: '#e5e7eb' }}
        >
          <h3 className="font-semibold text-sm mb-3" style={{ color: 'var(--color-primary)' }}>
            Create New Project
          </h3>
          <div className="flex flex-col gap-3">
            <input
              type="text"
              placeholder="Project name *"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="rounded border px-3 py-2 text-sm outline-none focus:ring-2"
              style={{
                borderColor: '#d1d5db',
              }}
              autoFocus
            />
            <textarea
              placeholder="Description (optional)"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              rows={2}
              className="rounded border px-3 py-2 text-sm outline-none resize-none focus:ring-2"
              style={{ borderColor: '#d1d5db' }}
            />
            {formError && <p className="text-xs text-red-500">{formError}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                className="rounded px-4 py-2 text-sm font-medium cursor-pointer"
                style={{ backgroundColor: 'var(--color-secondary)', color: 'white' }}
              >
                Create Project
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowNewForm(false);
                  setNewName('');
                  setNewDescription('');
                  setFormError('');
                }}
                className="rounded px-4 py-2 text-sm font-medium border cursor-pointer"
                style={{ borderColor: '#d1d5db', color: '#374151' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Projects grid or empty state */}
      {projects.length === 0 ? (
        <EmptyState onCreateClick={() => setShowNewForm(true)} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onClick={() => router.push(`/projects/${project.id}/${project.currentStep}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
