// Boundary readers for JSON returned by gh: each one checks the shape it claims.

import { EnvError } from "./proc.ts";

export type Obj = { readonly [k: string]: unknown };

export function obj(v: unknown, what: string): Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new EnvError(`${what}: expected object`);
  return v as Obj; // checked above: non-null, non-array object
}
export function arr(v: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(v)) throw new EnvError(`${what}: expected array`);
  return v;
}
export function str(v: unknown, what: string): string {
  if (typeof v !== "string") throw new EnvError(`${what}: expected string`);
  return v;
}
export function strOrNull(v: unknown, what: string): string | null {
  return v === null || v === undefined ? null : str(v, what);
}
export function num(v: unknown, what: string): number {
  if (typeof v !== "number") throw new EnvError(`${what}: expected number`);
  return v;
}
export function bool(v: unknown, what: string): boolean {
  if (typeof v !== "boolean") throw new EnvError(`${what}: expected boolean`);
  return v;
}
export function field(o: Obj, k: string): unknown {
  return o[k];
}
export function objOrNull(v: unknown, what: string): Obj | null {
  return v === null || v === undefined ? null : obj(v, what);
}
