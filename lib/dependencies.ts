import { PrismaClient, Prisma } from '@prisma/client';

// Single home for the dependencyIds request contract, shared by POST and
// PATCH so the two routes cannot drift.

export const INVALID_DEPS_ERROR = 'dependencyIds must be an array of ids';
export const MISSING_DEPS_ERROR = 'One or more dependencies no longer exist';

export function parseDependencyIds(
  input: unknown
): { ok: true; ids: number[] } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, ids: [] };
  if (!Array.isArray(input) || !input.every(Number.isInteger)) {
    return { ok: false, error: INVALID_DEPS_ERROR };
  }
  return { ok: true, ids: Array.from(new Set<number>(input)) };
}

// Works with either the base client or a transaction client, so PATCH can
// run the check inside its transaction.
export async function dependenciesExist(
  db: PrismaClient | Prisma.TransactionClient,
  ids: number[]
): Promise<boolean> {
  if (ids.length === 0) return true;
  const found = await db.todo.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  return found.length === ids.length;
}
