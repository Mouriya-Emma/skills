// Domain vocabulary shared by issue parsing, evidence requirements and rendering.

export const FACES = ["gui", "cli", "service", "library", "data", "iac", "agent-config"] as const;
export type Face = (typeof FACES)[number];

export const FORMS = ["e2e", "集成", "最薄入口", "driver"] as const;
export type Form = (typeof FORMS)[number];

export const ROLES = ["正例", "负例", "保持"] as const;
export type Role = (typeof ROLES)[number];

export const DIMENSIONS = ["function", "environment", "integration", "assumption"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

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
      return ["e2e"];
    case "gui":
      return ["e2e", "集成"];
    case "library":
      return ["e2e", "集成", "driver"];
    case "cli":
    case "service":
    case "data":
      return ["e2e", "集成", "最薄入口"];
  }
}

export const isFace = (s: string): s is Face => (FACES as readonly string[]).includes(s);
export const isForm = (s: string): s is Form => (FORMS as readonly string[]).includes(s);
export const isRole = (s: string): s is Role => (ROLES as readonly string[]).includes(s);
export const isDimension = (s: string): s is Dimension => (DIMENSIONS as readonly string[]).includes(s);

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
