// Dependency-graph helpers. Tasks have no duration field, so every task
// is treated as taking one day; a task's earliest start is the day after
// all of its dependencies could finish.

export interface GraphNode {
  id: number;
  dependencyIds: number[];
}

export interface ScheduleEntry {
  earliestStart: Date;
  earliestFinish: Date;
}

// Projects Prisma todos (with included dependencies) onto GraphNodes.
export function toGraphNodes(
  todos: { id: number; dependencies: { id: number }[] }[]
): GraphNode[] {
  return todos.map((t) => ({
    id: t.id,
    dependencyIds: t.dependencies.map((d) => d.id),
  }));
}

export const DAY_MS = 24 * 60 * 60 * 1000;

function todayUTC(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// True if making `taskId` depend on `newDepIds` would create a cycle,
// i.e. some proposed dependency can already reach `taskId`.
export function wouldCreateCycle(
  nodes: GraphNode[],
  taskId: number,
  newDepIds: number[]
): boolean {
  const depsById = new Map(nodes.map((n) => [n.id, n.dependencyIds]));
  const visited = new Set<number>();

  const canReach = (from: number): boolean => {
    if (from === taskId) return true;
    if (visited.has(from)) return false;
    visited.add(from);
    return (depsById.get(from) ?? []).some(canReach);
  };

  return newDepIds.some(canReach);
}

// Topological (Kahn's) order; nodes stuck in a cycle are omitted.
function topoSort(nodes: GraphNode[]): GraphNode[] {
  const remainingDeps = new Map(
    nodes.map((n) => [n.id, new Set(n.dependencyIds)])
  );
  const dependents = new Map<number, number[]>();
  for (const n of nodes) {
    for (const dep of n.dependencyIds) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(n.id);
    }
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const queue = nodes.filter((n) => n.dependencyIds.length === 0).map((n) => n.id);
  const order: GraphNode[] = [];

  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    order.push(byId.get(id)!);
    for (const dependent of dependents.get(id) ?? []) {
      const deps = remainingDeps.get(dependent)!;
      deps.delete(id);
      if (deps.size === 0) queue.push(dependent);
    }
  }
  return order;
}

export function computeSchedule(nodes: GraphNode[]): Map<number, ScheduleEntry> {
  const schedule = new Map<number, ScheduleEntry>();
  const start = todayUTC();

  for (const node of topoSort(nodes)) {
    let earliestStart = start;
    for (const dep of node.dependencyIds) {
      const depFinish = schedule.get(dep)?.earliestFinish;
      if (depFinish && depFinish > earliestStart) earliestStart = depFinish;
    }
    schedule.set(node.id, {
      earliestStart,
      earliestFinish: new Date(earliestStart.getTime() + DAY_MS),
    });
  }
  return schedule;
}

// Longest path through the DAG, as an ordered list of task ids.
// Pass the schedule when one is already computed, so both results share
// the same "today" anchor and the topo sort runs once.
export function criticalPath(
  nodes: GraphNode[],
  schedule: Map<number, ScheduleEntry> = computeSchedule(nodes)
): number[] {
  const predecessor = new Map<number, number>();

  for (const node of nodes) {
    const start = schedule.get(node.id)?.earliestStart;
    if (!start) continue;
    for (const dep of node.dependencyIds) {
      if (schedule.get(dep)?.earliestFinish.getTime() === start.getTime()) {
        predecessor.set(node.id, dep);
        break;
      }
    }
  }

  let endId: number | null = null;
  let latest = -Infinity;
  for (const [id, entry] of schedule) {
    if (entry.earliestFinish.getTime() > latest) {
      latest = entry.earliestFinish.getTime();
      endId = id;
    }
  }
  if (endId === null) return [];

  const path = [endId];
  while (predecessor.has(path[0])) path.unshift(predecessor.get(path[0])!);
  // A "path" of one node means no dependency chain exists — with no edges,
  // every task ties and the winner is arbitrary, so report no critical path.
  return path.length > 1 ? path : [];
}
