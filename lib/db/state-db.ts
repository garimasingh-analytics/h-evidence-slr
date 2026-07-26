import { getDb } from './index';

export async function dbGetState(
  projectId: string,
  step: string
): Promise<Record<string, unknown> | null> {
  const sql = getDb();
  const rows = await sql`
    SELECT state FROM step_state
    WHERE project_id = ${projectId} AND step = ${step}
  `;
  if (rows.length === 0) return null;
  // The neon driver returns JSONB columns already parsed
  return rows[0].state as Record<string, unknown>;
}

export async function dbSaveState(
  projectId: string,
  step: string,
  state: unknown
): Promise<void> {
  const sql = getDb();
  await sql`
    INSERT INTO step_state (project_id, step, state)
    VALUES (${projectId}, ${step}, ${JSON.stringify(state)}::jsonb)
    ON CONFLICT (project_id, step)
    DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()
  `;
}
