import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { toGraphNodes, wouldCreateCycle } from '@/lib/graph';
import { parseDependencyIds, dependenciesExist, MISSING_DEPS_ERROR } from '@/lib/dependencies';

interface Params {
  params: {
    id: string;
  };
}

export async function PATCH(request: Request, { params }: Params) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const parsed = parseDependencyIds(body.dependencyIds);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const depIds = parsed.ids;
    if (depIds.includes(id)) {
      return NextResponse.json({ error: 'A task cannot depend on itself' }, { status: 400 });
    }

    // The validate-then-write must be atomic: two concurrent edits could
    // otherwise each pass the cycle check and jointly persist a cycle.
    // Serializable is explicit so the guarantee survives a datasource swap
    // (SQLite serializes writers anyway; Postgres/MySQL would not at their
    // default isolation, since the two writes touch disjoint rows).
    const result = await prisma.$transaction(
      async (tx) => {
        const target = await tx.todo.findUnique({ where: { id }, select: { id: true } });
        if (!target) {
          return { error: 'Todo not found', status: 404 };
        }

        if (!(await dependenciesExist(tx, depIds))) {
          return { error: MISSING_DEPS_ERROR, status: 400 };
        }

        const todos = await tx.todo.findMany({
          select: { id: true, dependencies: { select: { id: true } } },
        });
        if (wouldCreateCycle(toGraphNodes(todos), id, depIds)) {
          return { error: 'These dependencies would create a circular dependency', status: 400 };
        }

        const todo = await tx.todo.update({
          where: { id },
          data: {
            dependencies: { set: depIds.map((depId) => ({ id: depId })) },
          },
        });
        return { todo };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.todo);
  } catch (error) {
    // The target's existence is checked inside the transaction, so a P2025
    // here means a dependency vanished mid-update, not a missing todo.
    if ((error as { code?: string }).code === 'P2025') {
      return NextResponse.json({ error: MISSING_DEPS_ERROR }, { status: 400 });
    }
    return NextResponse.json({ error: 'Error updating todo' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  try {
    await prisma.todo.delete({
      where: { id },
    });
    return NextResponse.json({ message: 'Todo deleted' }, { status: 200 });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2025') {
      return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Error deleting todo' }, { status: 500 });
  }
}
