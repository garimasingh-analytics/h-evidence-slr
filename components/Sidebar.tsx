'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getProjects, saveProject, deleteProject } from '@/lib/projectStore';
import type { Project } from '@/lib/types';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [projects, setProjects] = useState<Project[]>([]);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [formError, setFormError] = useState('');
  const [listLoading, setListLoading] = useState(true);

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const dbProjects = (await res.json()) as Array<{
          id: string;
          name: string;
          description: string;
          created_at: string;
          current_step: string;
        }>;
        const mapped: Project[] = dbProjects.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          createdAt: p.created_at,
          currentStep: (p.current_step ?? 'search') as Project['currentStep'],
        }));
        setProjects(mapped);
        // Write-through to localStorage
        mapped.forEach((p) => saveProject(p));
      } else {
        throw new Error('DB unavailable');
      }
    } catch {
      // Fallback to localStorage
      setProjects(getProjects().sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
    // Refresh when storage changes (e.g. another tab)
    const handleStorage = () => loadProjects();
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [loadProjects]);

  function getActiveProjectId(): string | null {
    const match = pathname.match(/^\/projects\/([^/]+)/);
    return match ? match[1] : null;
  }

  const activeProjectId = getActiveProjectId();

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) {
      setFormError('Project name is required.');
      return;
    }

    const id = generateId();
    const now = new Date().toISOString();
    const newProject: Project = {
      id,
      name: newName.trim(),
      description: newDescription.trim(),
      createdAt: now,
      currentStep: 'search',
    };

    // Optimistic UI update
    setNewName('');
    setNewDescription('');
    setFormError('');
    setShowNewForm(false);

    // DB primary
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name: newProject.name, description: newProject.description }),
      });
      if (!res.ok) throw new Error('DB write failed');
    } catch {
      // silently fall through — localStorage covers it
    }

    // localStorage fallback (always write)
    saveProject(newProject);

    await loadProjects();
    router.push(`/projects/${id}/search`);
  }

  async function handleDeleteProject(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (!confirm('Delete this project? This cannot be undone.')) return;

    // DB primary
    try {
      await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    } catch {
      // silently fall through
    }

    // localStorage fallback
    deleteProject(id);

    await loadProjects();
    if (activeProjectId === id) {
      router.push('/');
    }
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  return (
    <aside
      className="flex flex-col shrink-0 overflow-hidden"
      style={{
        width: '260px',
        minHeight: '100vh',
        backgroundColor: 'var(--color-primary)',
        color: 'white',
      }}
    >
      {/* Logo / Brand */}
      <div
        className="flex items-center gap-2 px-4 py-5 border-b"
        style={{ borderColor: 'rgba(255,255,255,0.12)' }}
      >
        <div
          className="flex items-center justify-center rounded font-bold text-sm"
          style={{
            width: '32px',
            height: '32px',
            backgroundColor: 'var(--color-secondary)',
            flexShrink: 0,
          }}
        >
          H
        </div>
        <div>
          <div className="font-semibold text-sm leading-tight">H Evidence</div>
          <div className="text-xs leading-tight" style={{ color: 'rgba(255,255,255,0.6)' }}>
            AI SLR Tool
          </div>
        </div>
      </div>

      {/* New Project Button */}
      <div className="px-3 py-3">
        <button
          onClick={() => {
            setShowNewForm((v) => !v);
            setFormError('');
          }}
          className="w-full flex items-center justify-center gap-2 rounded px-3 py-2 text-sm font-medium transition-colors cursor-pointer"
          style={{
            backgroundColor: 'var(--color-secondary)',
            color: 'white',
          }}
        >
          <span style={{ fontSize: '16px', lineHeight: 1 }}>+</span>
          New Project
        </button>
      </div>

      {/* Inline New Project Form */}
      {showNewForm && (
        <form
          onSubmit={handleCreateProject}
          className="mx-3 mb-3 rounded p-3 flex flex-col gap-2"
          style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
        >
          <input
            type="text"
            placeholder="Project name *"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="rounded px-2 py-1.5 text-sm w-full outline-none"
            style={{
              backgroundColor: 'rgba(255,255,255,0.12)',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.2)',
            }}
            autoFocus
          />
          <textarea
            placeholder="Description (optional)"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            rows={2}
            className="rounded px-2 py-1.5 text-sm w-full outline-none resize-none"
            style={{
              backgroundColor: 'rgba(255,255,255,0.12)',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.2)',
            }}
          />
          {formError && (
            <p className="text-xs" style={{ color: '#f87171' }}>
              {formError}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 rounded px-3 py-1.5 text-xs font-medium cursor-pointer"
              style={{ backgroundColor: 'var(--color-secondary)', color: 'white' }}
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => {
                setShowNewForm(false);
                setNewName('');
                setNewDescription('');
                setFormError('');
              }}
              className="flex-1 rounded px-3 py-1.5 text-xs font-medium cursor-pointer"
              style={{ backgroundColor: 'rgba(255,255,255,0.12)', color: 'white' }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Projects List */}
      <nav
        className="flex-1 overflow-y-auto px-2 pb-4 transition-opacity"
        style={{ opacity: listLoading ? 0.6 : 1 }}
      >
        {projects.length === 0 && !showNewForm && (
          <p className="text-xs px-2 py-4 text-center" style={{ color: 'rgba(255,255,255,0.45)' }}>
            No projects yet. Create one above.
          </p>
        )}
        {projects.map((project) => {
          const isActive = project.id === activeProjectId;
          return (
            <div
              key={project.id}
              onClick={() => router.push(`/projects/${project.id}/search`)}
              className="group relative flex flex-col rounded mb-1 px-3 py-2.5 cursor-pointer transition-colors"
              style={{
                backgroundColor: isActive ? 'rgba(59,155,197,0.18)' : 'transparent',
                borderLeft: isActive ? '3px solid var(--color-secondary)' : '3px solid transparent',
              }}
            >
              <span
                className="text-sm font-medium leading-snug truncate pr-5"
                style={{ color: isActive ? 'white' : 'rgba(255,255,255,0.85)' }}
              >
                {project.name}
              </span>
              <span className="text-xs mt-0.5 truncate" style={{ color: 'rgba(255,255,255,0.45)' }}>
                {formatDate(project.createdAt)}
              </span>
              <button
                onClick={(e) => handleDeleteProject(e, project.id)}
                className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 cursor-pointer"
                style={{ color: 'rgba(255,255,255,0.5)', lineHeight: 1 }}
                title="Delete project"
                aria-label="Delete project"
              >
                ×
              </button>
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div
        className="px-4 py-3 text-xs border-t"
        style={{
          borderColor: 'rgba(255,255,255,0.12)',
          color: 'rgba(255,255,255,0.35)',
        }}
      >
        Phase 7 · Prototype
      </div>
    </aside>
  );
}
