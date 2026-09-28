/** @param {string} state */
export function canCancelCliRun(state) {
  return state === "started";
}
