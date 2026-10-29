/**
 * Share concurrent refreshes without reusing a result after the refresh completes.
 * @template T
 * @param {{ pending?: Promise<T> }} state
 * @param {() => Promise<T>} load
 * @returns {Promise<T>}
 */
export function singleFlight(state, load) {
  if (!state.pending) {
    state.pending = Promise.resolve().then(load).finally(() => { state.pending = undefined; });
  }
  return state.pending;
}
