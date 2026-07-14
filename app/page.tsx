"use client"
import { useState, useEffect, memo } from 'react';
import { DAY_MS } from '@/lib/graph';

interface TodoItem {
  id: number;
  title: string;
  dueDate: string | null;
  imageUrl: string | null;
  earliestStart: string | null;
  dependencies: { id: number; title: string }[];
}

// Date-only values are stored as midnight UTC; formatting must stay in UTC
// or the displayed day shifts backward for viewers west of UTC.
const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { timeZone: 'UTC' });

// Overdue only once the due day has ended in the viewer's local calendar:
// take the stored UTC Y/M/D and build local midnight of the following day.
const isOverdue = (dueDate: string) => {
  const d = new Date(dueDate);
  const endOfDueDayLocal = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Date.now() >= endOfDueDayLocal.getTime();
};

function TodoImage({ src, alt }: { src: string; alt: string }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  return (
    <div className="relative w-16 h-16 rounded-md overflow-hidden bg-gray-200 flex-shrink-0 mr-4">
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {status === 'error' ? (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-xs">
          no image
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
          className={`w-full h-full object-cover transition-opacity duration-300 ${
            status === 'loaded' ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </div>
  );
}

function DependencyPicker({
  todos,
  selected,
  onToggle,
  excludeId,
}: {
  todos: TodoItem[];
  selected: number[];
  onToggle: (id: number) => void;
  excludeId?: number;
}) {
  const options = todos.filter((t) => t.id !== excludeId);
  if (options.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((t) => (
        <label
          key={t.id}
          className={`px-2 py-1 rounded-full text-sm cursor-pointer border ${
            selected.includes(t.id)
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'bg-white text-gray-600 border-gray-300'
          }`}
        >
          <input
            type="checkbox"
            className="hidden"
            checked={selected.includes(t.id)}
            onChange={() => onToggle(t.id)}
          />
          {t.title}
        </label>
      ))}
    </div>
  );
}

const NODE_W = 150;
const NODE_H = 44;
const COL_GAP = 210;
const ROW_GAP = 70;

const DependencyGraph = memo(function DependencyGraph({
  todos,
  criticalPath,
}: {
  todos: TodoItem[];
  criticalPath: number[];
}) {
  if (todos.length === 0) return null;

  const depIds = new Map(todos.map((t) => [t.id, t.dependencies.map((d) => d.id)]));

  // Column = scheduled day. The server's earliestStart already encodes the
  // longest dependency chain, so don't re-derive it client-side.
  const startTimes = todos
    .map((t) => (t.earliestStart ? new Date(t.earliestStart).getTime() : null))
    .filter((s): s is number => s !== null);
  const minStart = startTimes.length > 0 ? Math.min(...startTimes) : 0;
  const columnOf = (t: TodoItem) =>
    t.earliestStart
      ? Math.round((new Date(t.earliestStart).getTime() - minStart) / DAY_MS)
      : 0;

  const columns = new Map<number, TodoItem[]>();
  for (const t of todos) {
    const d = columnOf(t);
    if (!columns.has(d)) columns.set(d, []);
    columns.get(d)!.push(t);
  }

  // Order each column so nodes sit near the average row of their
  // dependencies (barycenter heuristic) — fewer edge crossings.
  const rowOf = new Map<number, number>();
  for (const day of Array.from(columns.keys()).sort((a, b) => a - b)) {
    const col = columns.get(day)!;
    const barycenter = (t: TodoItem) => {
      const rows = (depIds.get(t.id) ?? [])
        .map((dep) => rowOf.get(dep))
        .filter((r): r is number => r !== undefined);
      return rows.length > 0 ? rows.reduce((s, r) => s + r, 0) / rows.length : 0;
    };
    col.sort((a, b) => barycenter(a) - barycenter(b));
    col.forEach((t, i) => rowOf.set(t.id, i));
  }

  const pos = new Map<number, { x: number; y: number }>();
  for (const [d, col] of columns) {
    col.forEach((t, i) => pos.set(t.id, { x: 20 + d * COL_GAP, y: 20 + i * ROW_GAP }));
  }

  const width = 40 + columns.size * COL_GAP;
  const height = 40 + Math.max(...Array.from(columns.values()).map((c) => c.length)) * ROW_GAP;

  const criticalEdges = new Set<string>();
  for (let i = 0; i < criticalPath.length - 1; i++) {
    criticalEdges.add(`${criticalPath[i]}->${criticalPath[i + 1]}`);
  }
  const criticalNodes = new Set(criticalPath);

  return (
    <div className="bg-white bg-opacity-90 rounded-lg shadow-lg p-4 overflow-x-auto">
      <h2 className="text-gray-800 font-bold mb-2">Dependency Graph</h2>
      <p className="text-sm text-gray-500 mb-2">Critical path highlighted in red.</p>
      <svg width={width} height={height}>
        <defs>
          {/* userSpaceOnUse keeps arrowheads a constant size instead of
              scaling with strokeWidth (the thick critical edges otherwise
              get huge triangles that crowd the nodes) */}
          <marker id="arrow" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="8" refX="8" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="#9ca3af" />
          </marker>
          <marker id="arrow-critical" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="8" refX="8" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="#ef4444" />
          </marker>
        </defs>
        {(() => {
          // Curved edges with endpoints spread along each node's side, so
          // arrows into the same node never stack and column-skipping
          // edges arc between rows instead of cutting through boxes.
          const edges = todos.flatMap((t) =>
            (depIds.get(t.id) ?? [])
              .filter((dep) => pos.has(dep) && pos.has(t.id))
              .map((dep) => ({ from: dep, to: t.id, sy: 0, ty: 0 }))
          );
          const bySource = new Map<number, typeof edges>();
          const byTarget = new Map<number, typeof edges>();
          for (const e of edges) {
            if (!bySource.has(e.from)) bySource.set(e.from, []);
            bySource.get(e.from)!.push(e);
            if (!byTarget.has(e.to)) byTarget.set(e.to, []);
            byTarget.get(e.to)!.push(e);
          }
          for (const [id, group] of bySource) {
            group.sort((a, b) => pos.get(a.to)!.y - pos.get(b.to)!.y);
            group.forEach((e, i) => {
              e.sy = pos.get(id)!.y + (NODE_H * (i + 1)) / (group.length + 1);
            });
          }
          for (const [id, group] of byTarget) {
            group.sort((a, b) => pos.get(a.from)!.y - pos.get(b.from)!.y);
            group.forEach((e, i) => {
              e.ty = pos.get(id)!.y + (NODE_H * (i + 1)) / (group.length + 1);
            });
          }
          return edges.map((e) => {
            const sx = pos.get(e.from)!.x + NODE_W;
            const tx = pos.get(e.to)!.x;
            const bend = Math.max(40, (tx - sx) / 2);
            const critical = criticalEdges.has(`${e.from}->${e.to}`);
            return (
              <path
                key={`${e.from}->${e.to}`}
                d={`M ${sx} ${e.sy} C ${sx + bend} ${e.sy}, ${tx - bend} ${e.ty}, ${tx} ${e.ty}`}
                fill="none"
                stroke={critical ? '#ef4444' : '#9ca3af'}
                strokeWidth={critical ? 2 : 1.5}
                markerEnd={critical ? 'url(#arrow-critical)' : 'url(#arrow)'}
              />
            );
          });
        })()}
        {todos.map((t) => {
          const p = pos.get(t.id)!;
          const critical = criticalNodes.has(t.id);
          return (
            <g key={t.id}>
              <rect
                x={p.x}
                y={p.y}
                width={NODE_W}
                height={NODE_H}
                rx={8}
                fill={critical ? '#fee2e2' : '#f3f4f6'}
                stroke={critical ? '#ef4444' : '#d1d5db'}
                strokeWidth={critical ? 2 : 1}
              />
              <text
                x={p.x + NODE_W / 2}
                y={p.y + NODE_H / 2 + 4}
                textAnchor="middle"
                fontSize="12"
                fill="#1f2937"
              >
                {t.title.length > 20 ? t.title.slice(0, 19) + '…' : t.title}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
});

export default function Home() {
  const [newTodo, setNewTodo] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [newDepIds, setNewDepIds] = useState<number[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [criticalPath, setCriticalPath] = useState<number[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDepIds, setEditDepIds] = useState<number[]>([]);

  useEffect(() => {
    fetchTodos();
  }, []);

  const fetchTodos = async () => {
    try {
      const res = await fetch('/api/todos');
      if (!res.ok) {
        console.error('Failed to fetch todos: server returned', res.status);
        return; // keep showing the last good list
      }
      const data = await res.json();
      const nextTodos: TodoItem[] = Array.isArray(data.todos) ? data.todos : [];
      setTodos(nextTodos);
      setCriticalPath(Array.isArray(data.criticalPath) ? data.criticalPath : []);
      // reconcile pending dependency selections with what actually exists,
      // covering deletes made in other tabs, not just this one
      const liveIds = new Set(nextTodos.map((t) => t.id));
      setNewDepIds((ids) => ids.filter((depId) => liveIds.has(depId)));
      setEditDepIds((ids) => ids.filter((depId) => liveIds.has(depId)));
    } catch (error) {
      console.error('Failed to fetch todos:', error);
    }
  };

  const toggle = (ids: number[], id: number) =>
    ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

  const handleAddTodo = async () => {
    if (!newTodo.trim()) return;
    try {
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTodo,
          dueDate: newDueDate || null,
          dependencyIds: newDepIds,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to add todo');
        return; // keep the user's input so they can correct and retry
      }
      setNewTodo('');
      setNewDueDate('');
      setNewDepIds([]);
      fetchTodos();
    } catch (error) {
      console.error('Failed to add todo:', error);
    }
  };

  const handleSaveDeps = async (id: number) => {
    try {
      const res = await fetch(`/api/todos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dependencyIds: editDepIds }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to update dependencies');
        return;
      }
      setEditingId(null);
      fetchTodos();
    } catch (error) {
      console.error('Failed to update dependencies:', error);
    }
  };

  const handleDeleteTodo = async (id: number) => {
    try {
      const res = await fetch(`/api/todos/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to delete todo');
        return;
      }
      fetchTodos(); // also reconciles pending dependency selections
    } catch (error) {
      console.error('Failed to delete todo:', error);
    }
  };

  const criticalSet = new Set(criticalPath);

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-500 to-red-500 flex flex-col items-center p-4">
      <div className="w-full max-w-2xl">
        <h1 className="text-4xl font-bold text-center text-white mb-8">Things To Do App</h1>
        <div className="flex mb-3">
          <input
            type="text"
            className="flex-grow p-3 rounded-l-full focus:outline-none text-gray-700"
            placeholder="Add a new todo"
            value={newTodo}
            onChange={(e) => setNewTodo(e.target.value)}
          />
          <input
            type="date"
            className="p-3 focus:outline-none text-gray-700"
            value={newDueDate}
            onChange={(e) => setNewDueDate(e.target.value)}
          />
          <button
            onClick={handleAddTodo}
            className="bg-white text-indigo-600 p-3 rounded-r-full hover:bg-gray-100 transition duration-300"
          >
            Add
          </button>
        </div>
        {todos.length > 0 && (
          <div className="bg-white bg-opacity-90 rounded-lg shadow-lg p-3 mb-6">
            <span className="text-sm text-gray-600 mr-2">Depends on:</span>
            <DependencyPicker
              todos={todos}
              selected={newDepIds}
              onToggle={(id) => setNewDepIds(toggle(newDepIds, id))}
            />
          </div>
        )}
        <ul>
          {todos.map((todo) => (
            <li
              key={todo.id}
              className="bg-white bg-opacity-90 p-4 mb-4 rounded-lg shadow-lg"
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center flex-grow">
                  {todo.imageUrl && <TodoImage src={todo.imageUrl} alt={todo.title} />}
                  <div className="flex flex-col">
                    <span className="text-gray-800">
                      {todo.title}
                      {criticalSet.has(todo.id) && (
                        <span className="ml-2 text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">
                          critical path
                        </span>
                      )}
                    </span>
                    {todo.dueDate && (
                      <span
                        className={
                          isOverdue(todo.dueDate)
                            ? 'text-red-500 text-sm'
                            : 'text-gray-500 text-sm'
                        }
                      >
                        Due {formatDate(todo.dueDate)}
                      </span>
                    )}
                    {todo.earliestStart && (
                      <span className="text-gray-500 text-sm">
                        Earliest start {formatDate(todo.earliestStart)}
                      </span>
                    )}
                    {todo.dependencies.length > 0 && (
                      <span className="text-gray-500 text-sm">
                        Depends on: {todo.dependencies.map((d) => d.title).join(', ')}
                      </span>
                    )}
                    <button
                      onClick={() => {
                        setEditingId(editingId === todo.id ? null : todo.id);
                        setEditDepIds(todo.dependencies.map((d) => d.id));
                      }}
                      className="text-indigo-600 text-sm text-left hover:underline"
                    >
                      {editingId === todo.id ? 'Cancel' : 'Edit dependencies'}
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteTodo(todo.id)}
                  className="text-red-500 hover:text-red-700 transition duration-300"
                >
                  {/* Delete Icon */}
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
              {editingId === todo.id && (
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <DependencyPicker
                    todos={todos}
                    selected={editDepIds}
                    onToggle={(id) => setEditDepIds(toggle(editDepIds, id))}
                    excludeId={todo.id}
                  />
                  <button
                    onClick={() => handleSaveDeps(todo.id)}
                    className="mt-2 bg-indigo-600 text-white text-sm px-4 py-1 rounded-full hover:bg-indigo-700 transition duration-300"
                  >
                    Save
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <DependencyGraph todos={todos} criticalPath={criticalPath} />
      </div>
    </div>
  );
}
