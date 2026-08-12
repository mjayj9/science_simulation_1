import {
  PANEL_AREA_M2,
  PANEL_HEIGHT_M,
  PANEL_WIDTH_M,
  generatePreset,
  normalFromQuaternion,
  normalizeQuaternion,
  quaternionFromNormal,
  type Panel,
  type PresetName,
} from "../geometry";
import {
  createAutomaticCircuit,
  createDefaultProject,
  createVariant,
  validateProject,
  type ProjectV3,
} from "./schema";

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label}은 객체여야 합니다.`);
  }
  return value as JsonRecord;
}

function finiteVec3(value: unknown, fallback: readonly [number, number, number]) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
    ? [Number(value[0]), Number(value[1]), Number(value[2])] as const
    : fallback;
}

function normalizeLegacyPanel(value: unknown, index: number): Panel {
  const source = record(value, `panels.${index}`);
  const position = finiteVec3(source.position, [0, 0, 0]);
  const quaternion = Array.isArray(source.quaternion) && source.quaternion.length === 4 && source.quaternion.every(Number.isFinite)
    ? normalizeQuaternion(source.quaternion as [number, number, number, number])
    : quaternionFromNormal(finiteVec3(source.normal, [0, 0, 1]));
  return {
    id: typeof source.id === "string" && source.id ? source.id : `migrated-panel-${index + 1}`,
    widthM: PANEL_WIDTH_M,
    heightM: PANEL_HEIGHT_M,
    areaM2: PANEL_AREA_M2,
    position,
    quaternion,
    normal: normalFromQuaternion(quaternion),
  };
}

/** V1 was a single-shape document with `version: 1` and optional loose fields. */
export function migrateV1ToV2(input: unknown): JsonRecord {
  const source = record(input, "V1 프로젝트");
  if (source.version !== 1 && source.schemaVersion !== 1) throw new Error("V1 프로젝트가 아닙니다.");
  const now = typeof source.updatedAt === "string" ? source.updatedAt : new Date(0).toISOString();
  const preset = (["cube", "plane", "cylinder", "sphere", "hemisphere", "cone", "free"] as const).includes(source.preset as PresetName)
    ? source.preset as PresetName
    : "plane";
  const panels = Array.isArray(source.panels) && source.panels.length > 0
    ? source.panels.slice(0, 20).map(normalizeLegacyPanel)
    : generatePreset(preset);
  const defaults = createDefaultProject({ id: typeof source.id === "string" ? source.id : "migrated-project", name: typeof source.name === "string" ? source.name : "가져온 프로젝트", now: new Date(now) });
  const defaultVariant = createVariant(preset, typeof source.shapeName === "string" ? source.shapeName : undefined);
  return {
    ...defaults,
    schemaVersion: 2,
    shared: {
      ...defaults.shared,
      ...(typeof source.shared === "object" && source.shared !== null ? source.shared : {}),
      resultSettings: undefined,
    },
    variants: [{ ...defaultVariant, id: "migrated-variant-1", panels, circuit: createAutomaticCircuit(panels) }],
    assets: Array.isArray(source.assets) ? source.assets : [],
  };
}

/** V3 adds explicit result settings and makes assets/rotation defaults mandatory. */
export function migrateV2ToV3(input: unknown): JsonRecord {
  const source = record(input, "V2 프로젝트");
  if (source.schemaVersion !== 2) throw new Error("V2 프로젝트가 아닙니다.");
  const defaults = createDefaultProject({ now: new Date(typeof source.updatedAt === "string" ? source.updatedAt : 0) });
  const shared = record(source.shared, "shared");
  return {
    ...source,
    schemaVersion: 3,
    revision: typeof source.revision === "number" ? source.revision : 0,
    shared: {
      ...defaults.shared,
      ...shared,
      resultSettings: {
        ...defaults.shared.resultSettings,
        ...(typeof shared.resultSettings === "object" && shared.resultSettings !== null ? shared.resultSettings : {}),
      },
    },
    assets: Array.isArray(source.assets) ? source.assets : [],
  };
}

export function migrateProject(input: unknown): ProjectV3 {
  let current: unknown = structuredClone(input);
  const source = record(current, "프로젝트");
  let version = Number(source.schemaVersion ?? source.version);
  if (!Number.isInteger(version)) throw new Error("저장 형식 버전이 없습니다.");
  if (version > 3) throw new Error(`이 앱보다 새로운 저장 형식 V${version}은 불러올 수 없습니다.`);
  if (version < 1) throw new Error(`지원하지 않는 저장 형식 V${version}입니다.`);
  if (version === 1) {
    current = migrateV1ToV2(current);
    version = 2;
  }
  if (version === 2) current = migrateV2ToV3(current);
  return validateProject(current);
}

export const migrations = { 1: migrateV1ToV2, 2: migrateV2ToV3 } as const;
