import { type Result, ok, err } from "../util/result.js";
export interface Record_ { id: string; value: number; updatedAt: number }
export class Store {
  private items = new Map<string, Record_>();
  put(r: Record_): Result<Record_> {
    if (!r.id) return err("id required");
    this.items.set(r.id, r);
    return ok(r);
  }
  get(id: string): Result<Record_> {
    const found = this.items.get(id);
    return found ? ok(found) : err("not found: " + id);
  }
  all(): Record_[] { return [...this.items.values()]; }
  size(): number { return this.items.size; }
}
