import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/index';

export async function POST(): Promise<NextResponse> {
  try {
    const sql = getDb();

    // Create tables (idempotent)
    await sql`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        current_step TEXT DEFAULT 'search',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    // Add columns in case table existed with fewer columns (safe to re-run)
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''`;
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS current_step TEXT DEFAULT 'search'`;
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`;
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`;

    await sql`
      CREATE TABLE IF NOT EXISTS step_state (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        step TEXT NOT NULL,
        state JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (project_id, step)
      )
    `;

    return NextResponse.json({ ok: true, message: 'Migration complete' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
