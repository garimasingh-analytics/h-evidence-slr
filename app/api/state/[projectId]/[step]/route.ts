import { NextRequest, NextResponse } from 'next/server';
import { dbGetState, dbSaveState } from '@/lib/db/state-db';
import { dbGetProject, dbUpdateProjectStep } from '@/lib/db/projects-db';

interface RouteParams {
  params: Promise<{ projectId: string; step: string }>;
}

const STEP_ORDER = ['search', 'screen', 'extract', 'narrative', 'report'];

export async function GET(_request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { projectId, step } = await params;
    const state = await dbGetState(projectId, step);
    return NextResponse.json({ state });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { projectId, step } = await params;
    const body = (await request.json()) as { state: unknown };
    await dbSaveState(projectId, step, body.state);

    // Advance current_step if this step is further along
    try {
      const project = await dbGetProject(projectId);
      if (project) {
        const currentIdx = STEP_ORDER.indexOf(project.current_step);
        const newIdx = STEP_ORDER.indexOf(step);
        if (newIdx > currentIdx) {
          await dbUpdateProjectStep(projectId, step);
        }
      }
    } catch {
      // Non-critical — don't fail the state save if step tracking fails
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
