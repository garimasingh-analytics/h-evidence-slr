'use client';

import type { Project, WizardStep } from './types';

const STORAGE_KEY = 'h-evidence-slr-projects';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function getProjects(): Project[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Project[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setProjects(projects: Project[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export function getProject(id: string): Project | null {
  const projects = getProjects();
  return projects.find((p) => p.id === id) ?? null;
}

export function saveProject(project: Project): void {
  const projects = getProjects();
  const index = projects.findIndex((p) => p.id === project.id);
  if (index >= 0) {
    projects[index] = project;
  } else {
    projects.push(project);
  }
  setProjects(projects);
}

export function deleteProject(id: string): void {
  const projects = getProjects().filter((p) => p.id !== id);
  setProjects(projects);
}

export function createProject(name: string, description: string): Project {
  const project: Project = {
    id: generateId(),
    name: name.trim(),
    description: description.trim(),
    createdAt: new Date().toISOString(),
    currentStep: 'search' as WizardStep,
  };
  saveProject(project);
  return project;
}
