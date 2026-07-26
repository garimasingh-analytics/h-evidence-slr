import { NextRequest, NextResponse } from 'next/server';
import { dbListProjects, dbCreateProject } from '@/lib/db/projects-db';

export async function GET(): Promise<NextResponse> {
  try {
    const projects = await dbListProjects();
    return NextResponse.json(projects);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { id: string; name: string; description?: string };
    const { id, name, description = '' } = body;

    if (!id || !name) {
      return NextResponse.json({ error: 'id and name are required' }, { status: 400 });
    }

    const project = await dbCreateProject(id, name, description);
    return NextResponse.json(project);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
