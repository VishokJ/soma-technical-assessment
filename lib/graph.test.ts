import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { wouldCreateCycle, computeSchedule, criticalPath, toGraphNodes, GraphNode } from './graph';
import { parseDependencyIds } from './dependencies';

const node = (id: number, deps: number[] = []): GraphNode => ({
  id,
  dependencyIds: deps,
});

// midnight UTC, n days after the frozen "today"
const day = (n: number) => new Date(Date.UTC(2026, 6, 13 + n));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-13T15:30:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('wouldCreateCycle', () => {
  it('rejects a direct two-node cycle', () => {
    const nodes = [node(1), node(2, [1])];
    expect(wouldCreateCycle(nodes, 1, [2])).toBe(true);
  });

  it('rejects a transitive cycle', () => {
    // 3 -> 2 -> 1; making 1 depend on 3 closes the loop
    const nodes = [node(1), node(2, [1]), node(3, [2])];
    expect(wouldCreateCycle(nodes, 1, [3])).toBe(true);
  });

  it('rejects a self-dependency', () => {
    const nodes = [node(1)];
    expect(wouldCreateCycle(nodes, 1, [1])).toBe(true);
  });

  it('allows edges that do not close a loop', () => {
    const nodes = [node(1), node(2, [1]), node(3)];
    expect(wouldCreateCycle(nodes, 3, [1, 2])).toBe(false);
  });

  it('allows depending on a sibling branch (diamond)', () => {
    const nodes = [node(1), node(2, [1]), node(3, [1]), node(4, [2])];
    expect(wouldCreateCycle(nodes, 4, [2, 3])).toBe(false);
  });

  it('handles an empty dependency list', () => {
    const nodes = [node(1), node(2, [1])];
    expect(wouldCreateCycle(nodes, 2, [])).toBe(false);
  });
});

describe('computeSchedule', () => {
  it('starts independent tasks today', () => {
    const schedule = computeSchedule([node(1), node(2)]);
    expect(schedule.get(1)).toEqual({ earliestStart: day(0), earliestFinish: day(1) });
    expect(schedule.get(2)).toEqual({ earliestStart: day(0), earliestFinish: day(1) });
  });

  it('starts a task after its dependency finishes', () => {
    const schedule = computeSchedule([node(1), node(2, [1])]);
    expect(schedule.get(2)).toEqual({ earliestStart: day(1), earliestFinish: day(2) });
  });

  it('cascades through a chain', () => {
    const schedule = computeSchedule([node(1), node(2, [1]), node(3, [2])]);
    expect(schedule.get(3)?.earliestStart).toEqual(day(2));
  });

  it('uses the latest-finishing dependency', () => {
    // 4 waits on both a 1-long branch (3) and a 2-long branch (1 -> 2)
    const schedule = computeSchedule([node(1), node(2, [1]), node(3), node(4, [2, 3])]);
    expect(schedule.get(4)?.earliestStart).toEqual(day(2));
  });

  it('schedules a diamond correctly', () => {
    const schedule = computeSchedule([node(1), node(2, [1]), node(3, [1]), node(4, [2, 3])]);
    expect(schedule.get(1)?.earliestStart).toEqual(day(0));
    expect(schedule.get(2)?.earliestStart).toEqual(day(1));
    expect(schedule.get(3)?.earliestStart).toEqual(day(1));
    expect(schedule.get(4)?.earliestStart).toEqual(day(2));
  });

  it('omits tasks stuck in a pre-existing data cycle', () => {
    const schedule = computeSchedule([node(1, [2]), node(2, [1]), node(3)]);
    expect(schedule.get(1)).toBeUndefined();
    expect(schedule.get(2)).toBeUndefined();
    expect(schedule.get(3)?.earliestStart).toEqual(day(0));
  });

  it('returns an empty schedule for no tasks', () => {
    expect(computeSchedule([]).size).toBe(0);
  });
});

describe('criticalPath', () => {
  it('is empty for no tasks', () => {
    expect(criticalPath([])).toEqual([]);
  });

  it('is empty when no dependency edges exist (no arbitrary winner)', () => {
    expect(criticalPath([node(1), node(2), node(3)])).toEqual([]);
  });

  it('follows a chain end to end', () => {
    expect(criticalPath([node(1), node(2, [1]), node(3, [2])])).toEqual([1, 2, 3]);
  });

  it('picks the longest branch through a diamond', () => {
    // 1 -> 2 -> 3 -> 5 is longer than 1 -> 4 -> 5
    const nodes = [node(1), node(2, [1]), node(3, [2]), node(4, [1]), node(5, [3, 4])];
    expect(criticalPath(nodes)).toEqual([1, 2, 3, 5]);
  });

  it('ignores short independent tasks', () => {
    const nodes = [node(1), node(2, [1]), node(9)];
    expect(criticalPath(nodes)).toEqual([1, 2]);
  });

  it('returns one of the tied longest paths in a symmetric diamond', () => {
    const nodes = [node(1), node(2, [1]), node(3, [1]), node(4, [2, 3])];
    const path = criticalPath(nodes);
    expect(path).toHaveLength(3);
    expect(path[0]).toBe(1);
    expect(path[2]).toBe(4);
    expect([2, 3]).toContain(path[1]);
  });

  it('produces the same path when given a precomputed schedule', () => {
    const nodes = [node(1), node(2, [1]), node(3, [2]), node(4, [1])];
    const schedule = computeSchedule(nodes);
    expect(criticalPath(nodes, schedule)).toEqual(criticalPath(nodes));
  });
});

describe('parseDependencyIds', () => {
  it('treats missing input as no dependencies', () => {
    expect(parseDependencyIds(undefined)).toEqual({ ok: true, ids: [] });
    expect(parseDependencyIds(null)).toEqual({ ok: true, ids: [] });
  });

  it('rejects non-arrays and non-integer entries', () => {
    expect(parseDependencyIds('1').ok).toBe(false);
    expect(parseDependencyIds([1, 'a']).ok).toBe(false);
    expect(parseDependencyIds([1.5]).ok).toBe(false);
  });

  it('dedupes valid ids', () => {
    expect(parseDependencyIds([3, 1, 3])).toEqual({ ok: true, ids: [3, 1] });
  });
});

describe('toGraphNodes', () => {
  it('projects todos with included dependencies onto graph nodes', () => {
    const todos = [
      { id: 1, dependencies: [] },
      { id: 2, dependencies: [{ id: 1 }] },
      { id: 3, dependencies: [{ id: 1 }, { id: 2 }] },
    ];
    expect(toGraphNodes(todos)).toEqual([node(1), node(2, [1]), node(3, [1, 2])]);
  });
});
