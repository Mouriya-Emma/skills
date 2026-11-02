// What evidence each acceptance row owes, by its face and the issue's test form.

import type { Face, Form } from "./model.ts";

export const STEPS = [
  "before",
  "after",
  "run",
  "deploy",
  "start",
  "log",
  "request",
  "driver",
  "preview",
  "migrate",
  "apply",
  "readback",
  "session",
] as const;
export type Step = (typeof STEPS)[number];
export const isStep = (s: string): s is Step => (STEPS as readonly string[]).includes(s);

/** Where a step's capture must sit relative to the change. */
export type Anchor = "head" | "base";

export type StepRule = { readonly step: Step; readonly anchor: Anchor; readonly needsImage: boolean };

/** Steps in required time order (ordered = startedAt must increase along the list). */
export type Requirement = { readonly steps: readonly StepRule[]; readonly ordered: boolean };

const at = (step: Step, needsImage = false): StepRule => ({ step, anchor: "head", needsImage });

export function requirementFor(face: Face, form: Form): Requirement {
  switch (face) {
    case "gui":
      return { steps: [{ step: "before", anchor: "base", needsImage: true }, at("after", true)], ordered: false };
    case "cli":
      return { steps: [at("run")], ordered: false };
    case "service":
      return form === "e2e"
        ? { steps: [at("deploy"), at("log"), at("request")], ordered: true }
        : { steps: [at("start"), at("log"), at("request")], ordered: true };
    case "library":
      return { steps: [at("driver")], ordered: false };
    case "data":
      return form === "e2e"
        ? { steps: [at("preview"), at("migrate"), at("readback")], ordered: true }
        : { steps: [at("migrate"), at("readback")], ordered: true };
    case "iac":
      return { steps: [at("preview"), at("apply"), at("readback")], ordered: true };
    case "agent-config":
      return { steps: [at("session")], ordered: false };
  }
}

/** The step implied when a face owes exactly one step, so `--step` may be omitted. */
export function defaultStep(face: Face, form: Form): Step | null {
  const r = requirementFor(face, form);
  return r.steps.length === 1 ? (r.steps[0] as StepRule).step : null;
}
