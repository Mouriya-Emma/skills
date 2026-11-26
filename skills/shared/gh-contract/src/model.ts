// Domain vocabulary shared by issue parsing, evidence requirements and rendering.

export const FACES = ["gui", "cli", "service", "library", "data", "iac", "agent-config"] as const;
export type Face = (typeof FACES)[number];

export const FORMS = ["e2e", "集成", "最薄入口"] as const;
export type Form = (typeof FORMS)[number];

/** What an expected result does to the product; it picks the evidence template. */
export const KINDS = ["改", "新", "删", "保持"] as const;
export type Kind = (typeof KINDS)[number];

/** The evidence template a kind uses, as shown to readers. */
export function templateOf(kind: Kind): string {
  switch (kind) {
    case "改":
      return "改功能（前后对比）";
    case "新":
      return "新功能";
    case "删":
      return "删功能";
    case "保持":
      return "保持不变（前后对比）";
  }
}

export type Family = "应用" | "基础设施" | "agent 配置";

export function familyOf(face: Face): Family {
  switch (face) {
    case "gui":
    case "cli":
    case "service":
    case "library":
    case "data":
      return "应用";
    case "iac":
      return "基础设施";
    case "agent-config":
      return "agent 配置";
  }
}

/** Test forms a face admits. */
export function formsFor(face: Face): readonly Form[] {
  switch (face) {
    case "iac":
    case "agent-config":
    case "gui":
      return ["e2e", "集成"];
    case "library":
    case "cli":
    case "service":
    case "data":
      return ["e2e", "集成", "最薄入口"];
  }
}

export type Proof = "testable" | "external";

export function proofOf(face: Face): Proof {
  switch (face) {
    case "cli":
    case "service":
    case "library":
    case "data":
      return "testable";
    case "gui":
    case "iac":
    case "agent-config":
      return "external";
  }
}

export const TESTABLE_FACES: readonly Face[] = FACES.filter((f) => proofOf(f) === "testable");
export const EXTERNAL_FACES: readonly Face[] = FACES.filter((f) => proofOf(f) === "external");

export const isFace = (s: string): s is Face => (FACES as readonly string[]).includes(s);
export const isForm = (s: string): s is Form => (FORMS as readonly string[]).includes(s);
export const isKind = (s: string): s is Kind => (KINDS as readonly string[]).includes(s);

export type Severity = "error" | "warn";
export type Diagnostic = { readonly severity: Severity; readonly where: string; readonly message: string };

export const err = (where: string, message: string): Diagnostic => ({ severity: "error", where, message });
export const warn = (where: string, message: string): Diagnostic => ({ severity: "warn", where, message });

/** Evidence images, by file extension; the content types the attachment uploader accepts for screenshots. */
export const IMAGE_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
