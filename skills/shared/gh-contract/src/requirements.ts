// What evidence one expected result owes: the face says in what form it is observed, the kind says whether the
// state before the change must be shown beside it.

import type { Face, Kind } from "./model.ts";

export const STEPS = ["before", "after", "run", "request", "log", "migrate", "preview", "apply", "readback", "session"] as const;
export type Step = (typeof STEPS)[number];
export const isStep = (s: string): s is Step => (STEPS as readonly string[]).includes(s);

/** Where a step's capture must sit relative to the change. */
export type Anchor = "head" | "base";

export type StepRule = { readonly step: Step; readonly anchor: Anchor; readonly needsImage: boolean };

/** Steps in required time order (ordered = the head-anchored steps' startedAt must increase along the list). */
export type Requirement = { readonly steps: readonly StepRule[]; readonly ordered: boolean };

const at = (step: Step, needsImage = false): StepRule => ({ step, anchor: "head", needsImage });

/** The observation of the changed product, in the form its face is seen in. */
function observed(face: Face): Requirement {
  switch (face) {
    case "gui":
      return { steps: [at("after", true)], ordered: false };
    case "cli":
    case "library":
      return { steps: [at("run")], ordered: false };
    case "service":
      return { steps: [at("request"), at("log")], ordered: false };
    case "data":
      return { steps: [at("migrate"), at("readback")], ordered: true };
    case "iac":
      return { steps: [at("preview"), at("apply"), at("readback")], ordered: true };
    case "agent-config":
      return { steps: [at("session")], ordered: false };
  }
}

/** Faces whose observation already carries the prior state: a preview or a migration shows what it replaces. */
function showsPriorState(face: Face): boolean {
  switch (face) {
    case "data":
    case "iac":
      return true;
    case "gui":
    case "cli":
    case "library":
    case "service":
    case "agent-config":
      return false;
  }
}

/** Kinds proven by comparison: the same observation on the base commit stands beside the one on HEAD. */
export function comparesBefore(kind: Kind): boolean {
  switch (kind) {
    case "改":
    case "保持":
      return true;
    case "新":
    case "删":
      return false;
  }
}

export function requirementFor(face: Face, kind: Kind): Requirement {
  const head = observed(face);
  if (!comparesBefore(kind) || showsPriorState(face)) return head;
  return { steps: [{ step: "before", anchor: "base", needsImage: face === "gui" }, ...head.steps], ordered: head.ordered };
}

/** The step implied when a result owes exactly one step, so `--step` may be omitted. */
export function defaultStep(face: Face, kind: Kind): Step | null {
  const r = requirementFor(face, kind);
  return r.steps.length === 1 ? (r.steps[0] as StepRule).step : null;
}
