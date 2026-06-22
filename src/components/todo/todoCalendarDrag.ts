interface TodoCalendarDropTarget {
  containsPoint: (clientX: number, clientY: number) => boolean;
  drop: (itemId: string, clientX: number, clientY: number) => boolean;
  onDragOverChange?: (isOver: boolean) => void;
}

interface ActiveTodoCalendarDrag {
  itemId: string;
  clientX: number;
  clientY: number;
  sourceWidth?: number;
  sourceHeight?: number;
}

interface CompletedTodoExternalDrop {
  itemId: string;
  at: number;
}

export type TodoCalendarDragSnapshot = ActiveTodoCalendarDrag;

interface TodoCalendarDragOptions {
  sourceWidth?: number;
  sourceHeight?: number;
}

const dropTargets = new Set<TodoCalendarDropTarget>();
const dragListeners = new Set<(snapshot: TodoCalendarDragSnapshot | null) => void>();
let activeDrag: ActiveTodoCalendarDrag | null = null;
let currentOverTarget: TodoCalendarDropTarget | null = null;
let lastExternalDrop: CompletedTodoExternalDrop | null = null;

function getTodoCalendarDragSnapshot(): TodoCalendarDragSnapshot | null {
  return activeDrag ? { ...activeDrag } : null;
}

function emitTodoCalendarDragChange(): void {
  const snapshot = getTodoCalendarDragSnapshot();
  dragListeners.forEach((listener) => listener(snapshot));
}

export function subscribeTodoCalendarDrag(
  listener: (snapshot: TodoCalendarDragSnapshot | null) => void,
): () => void {
  dragListeners.add(listener);
  listener(getTodoCalendarDragSnapshot());
  return () => {
    dragListeners.delete(listener);
  };
}

export function registerTodoCalendarDropTarget(
  target: TodoCalendarDropTarget,
): () => void {
  dropTargets.add(target);
  return () => {
    if (currentOverTarget === target) {
      target.onDragOverChange?.(false);
      currentOverTarget = null;
    }
    dropTargets.delete(target);
  };
}

export function beginTodoCalendarDrag(
  itemId: string,
  clientX: number,
  clientY: number,
  options: TodoCalendarDragOptions = {},
): void {
  activeDrag = { itemId, clientX, clientY, ...options };
  updateTodoCalendarDrag(clientX, clientY);
}

export function updateTodoCalendarDrag(clientX: number, clientY: number): boolean {
  if (!activeDrag) return false;
  activeDrag = { ...activeDrag, clientX, clientY };

  const nextTarget =
    Array.from(dropTargets)
      .reverse()
      .find((target) => target.containsPoint(clientX, clientY)) ?? null;

  if (nextTarget !== currentOverTarget) {
    currentOverTarget?.onDragOverChange?.(false);
    nextTarget?.onDragOverChange?.(true);
    currentOverTarget = nextTarget;
  }

  emitTodoCalendarDragChange();
  return nextTarget != null;
}

export function finishTodoCalendarDrag(clientX: number, clientY: number): boolean {
  if (!activeDrag) return false;
  const itemId = activeDrag.itemId;
  const target =
    Array.from(dropTargets)
      .reverse()
      .find((entry) => entry.containsPoint(clientX, clientY)) ?? null;

  clearTodoCalendarDrag();
  const dropped = target?.drop(itemId, clientX, clientY) ?? false;
  if (dropped) {
    lastExternalDrop = { itemId, at: Date.now() };
  }
  return dropped;
}

export function clearTodoCalendarDrag(): void {
  const hadActiveDrag = activeDrag != null;
  activeDrag = null;
  currentOverTarget?.onDragOverChange?.(false);
  currentOverTarget = null;
  if (hadActiveDrag) {
    emitTodoCalendarDragChange();
  }
}

export function consumeLastTodoExternalDrop(itemId: string): boolean {
  const entry = lastExternalDrop;
  if (!entry || entry.itemId !== itemId || Date.now() - entry.at > 750) {
    return false;
  }
  lastExternalDrop = null;
  return true;
}
