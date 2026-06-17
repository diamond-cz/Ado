export const TODO_POMODORO_START_EVENT = "todo:start-pomodoro";

export interface TodoPomodoroStartDetail {
  itemId: string | null;
}

export function requestTodoPomodoroStart(itemId: string | null) {
  window.dispatchEvent(
    new CustomEvent<TodoPomodoroStartDetail>(TODO_POMODORO_START_EVENT, {
      detail: { itemId },
    }),
  );
}

export function listenTodoPomodoroStart(
  handler: (detail: TodoPomodoroStartDetail) => void,
) {
  const listener = (event: Event) => {
    handler((event as CustomEvent<TodoPomodoroStartDetail>).detail);
  };
  window.addEventListener(TODO_POMODORO_START_EVENT, listener);
  return () => window.removeEventListener(TODO_POMODORO_START_EVENT, listener);
}
