import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { searchPexelsImage } from '@/lib/pexels';
import { toGraphNodes, computeSchedule, criticalPath } from '@/lib/graph';
import { parseDependencyIds, dependenciesExist, MISSING_DEPS_ERROR } from '@/lib/dependencies';

export async function GET() {
  try {
    const todos = await prisma.todo.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        dependencies: { select: { id: true, title: true } },
      },
    });

    const nodes = toGraphNodes(todos);
    const schedule = computeSchedule(nodes);

    return NextResponse.json({
      todos: todos.map((t) => ({
        ...t,
        earliestStart: schedule.get(t.id)?.earliestStart ?? null,
      })),
      criticalPath: criticalPath(nodes, schedule),
    });
  } catch (error) {
    return NextResponse.json({ error: 'Error fetching todos' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const { title, dueDate, dependencyIds } = body;
    if (typeof title !== 'string' || title.trim() === '') {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    let parsedDueDate: Date | null = null;
    if (dueDate) {
      parsedDueDate = new Date(dueDate);
      if (isNaN(parsedDueDate.getTime())) {
        return NextResponse.json({ error: 'Invalid due date' }, { status: 400 });
      }
    }

    const parsed = parseDependencyIds(dependencyIds);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const depIds = parsed.ids;

    // Independent work: the image lookup shouldn't delay dependency validation.
    const [imageUrl, depsOk] = await Promise.all([
      searchPexelsImage(title),
      dependenciesExist(prisma, depIds),
    ]);
    if (!depsOk) {
      return NextResponse.json({ error: MISSING_DEPS_ERROR }, { status: 400 });
    }

    const todo = await prisma.todo.create({
      data: {
        title,
        dueDate: parsedDueDate,
        imageUrl,
        dependencies: { connect: depIds.map((id) => ({ id })) },
      },
    });
    return NextResponse.json(todo, { status: 201 });
  } catch (error) {
    // dependency deleted between the existence check and the create
    if ((error as { code?: string }).code === 'P2025') {
      return NextResponse.json({ error: MISSING_DEPS_ERROR }, { status: 400 });
    }
    return NextResponse.json({ error: 'Error creating todo' }, { status: 500 });
  }
}
