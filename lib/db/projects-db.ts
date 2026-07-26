import { getDb } from './index';

export interface ProjectRow {
  id: string;
  name: string;
  description: string;
  current_step: string;
  created_at: string;
  updated_at: string;
}

export async function dbListProjects(): Promise<ProjectRow[]> {
  const sql = getDb();
  const rows = await sql`
    SELECT id, name, description, current_step, created_at, updated_at
    FROM projects
    ORDER BY created_at DESC
  `;
  return rows as ProjectRow[];
}

export async function dbCreateProject(
  id: string,
  name: string,
  description: string
): Promise<ProjectRow> {
  const sql = getDb();
  const rows = await sql`
    INSERT INTO projects (id, name, description)
    VALUES (${id}, ${name}, ${description})
    RETURNING *
  `;
  return rows[0] as ProjectRow;
}

export async function dbDeleteProject(id: string): Promise<void> {
  const sql = getDb();
  await sql`DELETE FROM projects WHERE id = ${id}`;
}

export async function dbGetProject(id: string): Promise<ProjectRow | null> {
  const sql = getDb();
  const rows = await sql`SELECT * FROM projects WHERE id = ${id}`;
  return (rows[0] as ProjectRow) ?? null;
}

export async function dbUpdateProjectStep(id: string, step: string): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE projects
    SET current_step = ${step}, updated_at = NOW()
    WHERE id = ${id}
  `;
}
