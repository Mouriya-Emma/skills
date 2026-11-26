// What evidence one expected result owes: the face says in what form it is observed.

import type { Face } from "./model.ts";

export const STEPS = ["after", "run", "request", "log", "migrate", "preview", "apply", "readback", "session"] as const;
export type Step = (typeof STEPS)[number];
export const isStep = (s: string): s is Step => (STEPS as readonly string[]).includes(s);

export type StepRule = { readonly step: Step; readonly needsImage: boolean };

/** Steps in required time order (ordered = their startedAt must increase along the list). */
export type Requirement = { readonly steps: readonly StepRule[]; readonly ordered: boolean };

const at = (step: Step, needsImage = false): StepRule => ({ step, needsImage });

/** The observation of the changed product, in the form its face is seen in. */
export function requirementFor(face: Face): Requirement {
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

/** The step implied when a result owes exactly one step, so `--step` may be omitted. */
export function defaultStep(face: Face): Step | null {
  const steps = requirementFor(face).steps;
  return steps.length === 1 ? (steps[0] as StepRule).step : null;
}
