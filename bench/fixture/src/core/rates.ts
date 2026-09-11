import { type Clock } from "../util/clock.js";
export class RateWindow {
  private hits: number[] = [];
  constructor(private clock: Clock, private windowMs: number, private limit: number) {}
  allow(): boolean {
    const now = this.clock.now();
    this.hits = this.hits.filter((t) => now - t < this.windowMs);
    if (this.hits.length >= this.limit) return false;
    this.hits.push(now);
    return true;
  }
  remaining(): number { return Math.max(0, this.limit - this.hits.length); }
}
