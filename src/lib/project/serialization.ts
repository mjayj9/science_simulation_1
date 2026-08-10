import { migrateProject } from "./migrations";
import { validateProject, type ProjectV3 } from "./schema";

export const PROJECT_FORMAT = "solar-simulator-project" as const;

interface ProjectEnvelope {
  format: typeof PROJECT_FORMAT;
  schemaVersion: 3;
  appVersion: string;
  exportedAt: string;
  document: ProjectV3;
}

export function exportProject(
  project: ProjectV3,
  options: { pretty?: boolean; appVersion?: string; now?: Date } = {},
): string {
  const document = validateProject(project);
  const envelope: ProjectEnvelope = {
    format: PROJECT_FORMAT,
    schemaVersion: 3,
    appVersion: options.appVersion ?? "0.1.0",
    exportedAt: (options.now ?? new Date()).toISOString(),
    document,
  };
  return JSON.stringify(envelope, null, options.pretty === false ? undefined : 2);
}

export function importProject(serialized: string | unknown): ProjectV3 {
  let parsed: unknown = serialized;
  if (typeof serialized === "string") {
    try {
      parsed = JSON.parse(serialized);
    } catch (error) {
      throw new SyntaxError(`프로젝트 JSON을 해석할 수 없습니다: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (typeof parsed === "object" && parsed !== null && "format" in parsed) {
    const envelope = parsed as Record<string, unknown>;
    if (envelope.format !== PROJECT_FORMAT) throw new Error(`지원하지 않는 프로젝트 형식: ${String(envelope.format)}`);
    parsed = envelope.document;
  }
  return migrateProject(parsed);
}
