// Browser-like page history for sidebar navigation + mouse back/forward
// buttons (XButton1 = back, XButton2 = forward). Pure functions, unit-tested.

export function createHistory(initial) {
  return { stack: [initial], index: 0 };
}

export function push(state, page) {
  // Navigating to the page we're already on is a no-op (no history spam).
  if (state.stack[state.index] === page) return state;
  // Navigating from mid-history truncates the forward branch, like a browser.
  const stack = state.stack.slice(0, state.index + 1);
  stack.push(page);
  return { stack, index: stack.length - 1 };
}

export function back(state) {
  if (state.index <= 0) return state;
  return { ...state, index: state.index - 1 };
}

export function forward(state) {
  if (state.index >= state.stack.length - 1) return state;
  return { ...state, index: state.index + 1 };
}

export const canBack = (state) => state.index > 0;
export const canForward = (state) => state.index < state.stack.length - 1;
export const current = (state) => state.stack[state.index];
