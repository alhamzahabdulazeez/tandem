import { Store } from "../core/store.js";
export function summarise(store: Store): { count: number; total: number } {
  const all = store.all();
  return { count: all.length, total: all.reduce((s, r) => s + r.value, 0) };
}
