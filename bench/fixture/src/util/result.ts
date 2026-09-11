export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = <T>(error: string): Result<T> => ({ ok: false, error });
export function unwrap<T>(r: Result<T>, fallback: T): T { return r.ok ? r.value : fallback; }
