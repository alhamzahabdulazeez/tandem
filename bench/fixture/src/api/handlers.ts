import { Store, type Record_ } from "../core/store.js";
import { unwrap } from "../util/result.js";
export function putHandler(store: Store, r: Record_): string {
  const res = store.put(r);
  return res.ok ? "stored " + res.value.id : "error " + res.error;
}
export function getValue(store: Store, id: string, fallback: number): number {
  return unwrap(store.get(id), { id, value: fallback, updatedAt: 0 }).value;
}
