import { z } from "zod";
import {
  ENVIRONMENT_PRESETS,
  MAX_PANELS_PER_VARIANT,
  MAX_VARIANTS,
  PANEL_AREA_M2,
  PANEL_HEIGHT_M,
  PANEL_WIDTH_M,
  generatePreset,
  normalFromQuaternion,
  type Panel,
  type PresetName,
} from "../geometry";

const finite = z.number().finite();
const nonNegative = finite.min(0);
const fraction = finite.min(0).max(1);
const id = z.string().min(1).max(200);

export const vec3Schema = z.tuple([finite, finite, finite]);
export const quaternionSchema = z
  .tuple([finite, finite, finite, finite])
  .refine((q) => Math.abs(Math.hypot(...q) - 1) <= 1e-5, "쿼터니언은 정규화되어야 합니다.");

export const panelSchema = z
  .object({
    id,
    widthM: z.literal(PANEL_WIDTH_M),
    heightM: z.literal(PANEL_HEIGHT_M),
    areaM2: z.literal(PANEL_AREA_M2),
    position: vec3Schema,
    quaternion: quaternionSchema,
    normal: vec3Schema.refine((normal) => Math.abs(Math.hypot(...normal) - 1) <= 1e-5, "패널 법선은 단위벡터여야 합니다."),
  })
  .superRefine((panel, context) => {
    const expected = normalFromQuaternion(panel.quaternion);
    const difference = Math.hypot(
      expected[0] - panel.normal[0],
      expected[1] - panel.normal[1],
      expected[2] - panel.normal[2],
    );
    if (difference > 1e-5) {
      context.addIssue({ code: "custom", path: ["normal"], message: "패널 법선이 쿼터니언의 전면 방향과 다릅니다." });
    }
  });

export const obstacleSchema = z.object({
  id,
  type: z.enum(["mountain", "building", "tree", "wall", "ground", "water", "other", "gltf"]),
  name: z.string().min(1).max(200),
  position: vec3Schema,
  quaternion: quaternionSchema,
  sizeM: vec3Schema.refine((size) => size.every((component) => component > 0), "장애물 크기는 모두 0보다 커야 합니다."),
  castsShadow: z.boolean(),
  assetId: id.optional(),
});

export const environmentSchema = z.object({
  preset: z.enum(["mountain", "coastal", "open-plain", "suburban", "urban"]),
  roughnessLengthM: finite.gt(0),
  turbulenceIntensity: fraction,
  groundAlbedo: fraction,
  soilingLossFraction: fraction,
  saltExposureFactor: nonNegative,
  obstacles: z.array(obstacleSchema).max(500),
});

export const circuitNodeSchema = z.object({
  id,
  kind: z.enum(["panel-positive", "panel-negative", "junction", "bypass-diode", "inverter-input"]),
  panelId: id.optional(),
  polarity: z.enum(["positive", "negative"]).optional(),
  x: finite.optional(),
  y: finite.optional(),
});

export const circuitEdgeSchema = z.object({
  id,
  source: id,
  target: id,
});

export const circuitSchema = z.object({
  nodes: z.array(circuitNodeSchema).max(1000),
  edges: z.array(circuitEdgeSchema).max(2000),
});

export const inverterSchema = z.object({
  ratedAcW: finite.gt(0),
  nominalEfficiency: fraction.gt(0),
  mpptMinV: nonNegative,
  mpptMaxV: finite.gt(0),
  maxInputCurrentA: finite.gt(0),
  standbyPowerW: nonNegative,
  wiringLossFraction: fraction,
}).refine((value) => value.mpptMaxV > value.mpptMinV, {
  path: ["mpptMaxV"],
  message: "MPPT 최대 전압은 최소 전압보다 커야 합니다.",
});

export const rotationSchema = z.object({
  mode: z.enum(["static", "fixed-rpm", "wind-driven"]),
  initialAngleDeg: finite,
  fixedRpm: finite.min(-300).max(300),
  inertiaKgM2: finite.gt(0),
  dampingNms: nonNegative,
  frictionNm: nonNegative,
  dragCoefficient: nonNegative,
  maximumRpm: finite.gt(0).max(1000),
});

export const shapeVariantSchema = z
  .object({
    id,
    name: z.string().min(1).max(200),
    preset: z.enum(["cube", "plane", "cylinder", "sphere", "hemisphere", "cone", "free"]),
    panels: z.array(panelSchema).min(1).max(MAX_PANELS_PER_VARIANT),
    circuit: circuitSchema,
    inverter: inverterSchema,
    rotation: rotationSchema,
  })
  .superRefine((variant, context) => {
    const panelIds = new Set(variant.panels.map((panel) => panel.id));
    if (panelIds.size !== variant.panels.length) {
      context.addIssue({ code: "custom", path: ["panels"], message: "형상 안에 중복 패널 ID가 있습니다." });
    }
    const nodeIds = new Set(variant.circuit.nodes.map((node) => node.id));
    if (nodeIds.size !== variant.circuit.nodes.length) {
      context.addIssue({ code: "custom", path: ["circuit", "nodes"], message: "중복 회로 노드 ID가 있습니다." });
    }
    variant.circuit.nodes.forEach((node, index) => {
      if (node.panelId && !panelIds.has(node.panelId)) {
        context.addIssue({ code: "custom", path: ["circuit", "nodes", index, "panelId"], message: "존재하지 않는 패널 참조입니다." });
      }
    });
    variant.circuit.edges.forEach((edge, index) => {
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
        context.addIssue({ code: "custom", path: ["circuit", "edges", index], message: "회로 edge가 존재하지 않는 노드를 참조합니다." });
      }
    });
  });

export const locationSchema = z.object({
  latitudeDeg: finite.min(-90).max(90),
  longitudeDeg: finite.min(-180).max(180),
  elevationM: finite.min(-500).max(9000),
  timezone: z.string().min(1).max(100),
});

export const timeSchema = z.object({
  mode: z.enum(["instant", "day", "month", "year"]),
  startIso: z.string().datetime({ offset: true }),
  endIso: z.string().datetime({ offset: true }),
  stepSeconds: finite.int().min(1).max(86400),
});

export const weatherInputSchema = z.object({
  mode: z.enum(["manual", "open-meteo", "pvgis", "nasa-power", "offline"]),
  preset: z.enum(["clear", "partly-cloudy", "overcast", "rain", "night"]),
  ghiWm2: nonNegative,
  dniWm2: nonNegative,
  dhiWm2: nonNegative,
  ambientC: finite.min(-100).max(100),
  windSpeedMs: nonNegative.max(150),
  windDirectionDeg: finite.min(0).max(360),
  gustMs: nonNegative.max(200),
  cloudFraction: fraction,
  precipitationMm: nonNegative,
});

export const simulationSettingsSchema = z.object({
  modelMode: z.enum(["simple", "detailed"]),
  shadingSamplesPerSide: z.number().int().min(1).max(15),
  randomSeed: z.string().min(1).max(200),
  workerChunkSize: z.number().int().min(1).max(1024),
});

export const resultSettingsSchema = z.object({
  retainPanelSeries: z.boolean(),
  includeLossLedger: z.boolean(),
  normalizedByArea: z.boolean(),
});

export const assetReferenceSchema = z.object({
  id,
  fileName: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().int().min(0),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
  embeddedBase64: z.string().optional(),
});

export const projectV3Schema = z
  .object({
    schemaVersion: z.literal(3),
    id,
    name: z.string().min(1).max(200),
    revision: z.number().int().min(0),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    shared: z.object({
      location: locationSchema,
      time: timeSchema,
      weather: weatherInputSchema,
      environment: environmentSchema,
      simulation: simulationSettingsSchema,
      resultSettings: resultSettingsSchema,
    }),
    variants: z.array(shapeVariantSchema).min(1).max(MAX_VARIANTS),
    assets: z.array(assetReferenceSchema).max(100),
  })
  .superRefine((project, context) => {
    if (project.variants.reduce((sum, variant) => sum + variant.panels.length, 0) > 100) {
      context.addIssue({ code: "custom", path: ["variants"], message: "전체 패널 수는 최대 100개입니다." });
    }
    if (new Set(project.variants.map((variant) => variant.id)).size !== project.variants.length) {
      context.addIssue({ code: "custom", path: ["variants"], message: "중복 형상 ID가 있습니다." });
    }
    if (new Set(project.assets.map((asset) => asset.id)).size !== project.assets.length) {
      context.addIssue({ code: "custom", path: ["assets"], message: "중복 자산 ID가 있습니다." });
    }
    if (Date.parse(project.shared.time.endIso) < Date.parse(project.shared.time.startIso)) {
      context.addIssue({ code: "custom", path: ["shared", "time", "endIso"], message: "종료 시각은 시작 시각보다 빠를 수 없습니다." });
    }
  });

export type ProjectV3 = z.infer<typeof projectV3Schema>;
export type ShapeVariant = z.infer<typeof shapeVariantSchema>;

export class ProjectValidationError extends Error {
  readonly issues: z.ZodIssue[];

  constructor(issues: z.ZodIssue[]) {
    super(issues.map((issue) => `${issue.path.join(".") || "project"}: ${issue.message}`).join("\n"));
    this.name = "ProjectValidationError";
    this.issues = issues;
  }
}

export function validateProject(input: unknown): ProjectV3 {
  const result = projectV3Schema.safeParse(input);
  if (!result.success) throw new ProjectValidationError(result.error.issues);
  return result.data;
}

export function safeValidateProject(input: unknown) {
  return projectV3Schema.safeParse(input);
}

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createAutomaticCircuit(panels: readonly Panel[]) {
  const nodes = panels.flatMap((panel, index) => [
    { id: `${panel.id}-positive`, kind: "panel-positive" as const, panelId: panel.id, polarity: "positive" as const, x: index * 120, y: 0 },
    { id: `${panel.id}-negative`, kind: "panel-negative" as const, panelId: panel.id, polarity: "negative" as const, x: index * 120, y: 80 },
  ]);
  const inverterPositive = { id: "inverter-positive", kind: "inverter-input" as const, polarity: "positive" as const };
  const inverterNegative = { id: "inverter-negative", kind: "inverter-input" as const, polarity: "negative" as const };
  const edges = panels.flatMap((panel, index) => {
    if (index === 0) {
      return [{ id: `wire-in-positive-${panel.id}`, source: inverterPositive.id, target: `${panel.id}-positive` }];
    }
    return [{ id: `wire-series-${index}`, source: `${panels[index - 1].id}-negative`, target: `${panel.id}-positive` }];
  });
  const last = panels.at(-1)!;
  edges.push({ id: "wire-in-negative", source: `${last.id}-negative`, target: inverterNegative.id });
  return { nodes: [...nodes, inverterPositive, inverterNegative], edges };
}

export function createVariant(preset: PresetName = "plane", name?: string): ShapeVariant {
  const panels = generatePreset(preset);
  return shapeVariantSchema.parse({
    id: makeId("variant"),
    name: name ?? ({ cube: "정육면체", plane: "평면", cylinder: "원기둥", sphere: "구", hemisphere: "반구", cone: "원뿔", free: "자유 조립" }[preset]),
    preset,
    panels,
    circuit: createAutomaticCircuit(panels),
    inverter: {
      ratedAcW: 20,
      nominalEfficiency: 0.96,
      mpptMinV: 0.1,
      mpptMaxV: 100,
      maxInputCurrentA: 20,
      standbyPowerW: 0,
      wiringLossFraction: 0.02,
    },
    rotation: {
      mode: "static",
      initialAngleDeg: 0,
      fixedRpm: 0,
      inertiaKgM2: 0.02,
      dampingNms: 0.002,
      frictionNm: 0.001,
      dragCoefficient: 1.17,
      maximumRpm: 120,
    },
  });
}

export function createDefaultProject(options: {
  id?: string;
  name?: string;
  preset?: PresetName;
  now?: Date;
} = {}): ProjectV3 {
  const now = options.now ?? new Date();
  const timestamp = now.toISOString();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const environment = ENVIRONMENT_PRESETS["open-plain"];
  return validateProject({
    schemaVersion: 3,
    id: options.id ?? makeId("project"),
    name: options.name ?? "새 태양광 시나리오",
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    shared: {
      location: { latitudeDeg: 37.5665, longitudeDeg: 126.978, elevationM: 38, timezone: "Asia/Seoul" },
      time: { mode: "day", startIso: timestamp, endIso: tomorrow, stepSeconds: 300 },
      weather: {
        mode: "offline",
        preset: "clear",
        ghiWm2: 800,
        dniWm2: 700,
        dhiWm2: 100,
        ambientC: 25,
        windSpeedMs: 2,
        windDirectionDeg: 180,
        gustMs: 3,
        cloudFraction: 0,
        precipitationMm: 0,
      },
      environment: {
        preset: environment.id,
        roughnessLengthM: environment.roughnessLengthM,
        turbulenceIntensity: environment.turbulenceIntensity,
        groundAlbedo: environment.groundAlbedo,
        soilingLossFraction: environment.defaultSoilingLossFraction,
        saltExposureFactor: environment.saltExposureFactor,
        obstacles: [],
      },
      simulation: { modelMode: "detailed", shadingSamplesPerSide: 3, randomSeed: "solar-default-2026", workerChunkSize: 32 },
      resultSettings: { retainPanelSeries: false, includeLossLedger: true, normalizedByArea: true },
    },
    variants: [createVariant(options.preset ?? "plane")],
    assets: [],
  });
}

export const PROJECT_SCHEMA_VERSION = 3 as const;
