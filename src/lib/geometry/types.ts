export const PANEL_WIDTH_M = 0.05 as const;
export const PANEL_HEIGHT_M = 0.05 as const;
export const PANEL_AREA_M2 = 0.0025 as const;
export const MAX_PANELS_PER_VARIANT = 20 as const;
export const MAX_VARIANTS = 5 as const;

export type Vec3 = readonly [number, number, number];
export type Quaternion = readonly [number, number, number, number];

export type PresetName =
  | "cube"
  | "plane"
  | "cylinder"
  | "sphere"
  | "cone"
  | "free";

export interface Panel {
  id: string;
  widthM: typeof PANEL_WIDTH_M;
  heightM: typeof PANEL_HEIGHT_M;
  areaM2: typeof PANEL_AREA_M2;
  position: Vec3;
  /** Unit quaternion [x,y,z,w]. Local +Z is the generating front face. */
  quaternion: Quaternion;
  /** Cached world-space front normal, always derived from quaternion. */
  normal: Vec3;
}

export type ObstacleType =
  | "mountain"
  | "building"
  | "tree"
  | "wall"
  | "ground"
  | "water"
  | "other"
  | "gltf";

export interface Obstacle {
  id: string;
  type: ObstacleType;
  name: string;
  position: Vec3;
  quaternion: Quaternion;
  /** Full local box size used by the lightweight ray/AABB engine. */
  sizeM: Vec3;
  castsShadow: boolean;
  assetId?: string;
}

export type EnvironmentPresetName =
  | "mountain"
  | "coastal"
  | "open-plain"
  | "suburban"
  | "urban";

export interface EnvironmentPreset {
  id: EnvironmentPresetName;
  labelKo: string;
  roughnessLengthM: number;
  turbulenceIntensity: number;
  groundAlbedo: number;
  defaultSoilingLossFraction: number;
  saltExposureFactor: number;
  wakeModel: "engineering-approximation";
  assumptionsKo: readonly string[];
}

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

export type VisibilityOccluder =
  | { kind: "aabb"; id: string; bounds: Aabb }
  | { kind: "panel"; id: string; panel: Panel };

export interface VisibilityOptions {
  /** Odd values give a centre sample. Values are clamped to 1..15. */
  samplesPerSide?: number;
  epsilonM?: number;
  maxDistanceM?: number;
}

export interface VisibilityResult {
  panelId: string;
  visibility: number;
  visibleSamples: number;
  totalSamples: number;
  frontFacing: boolean;
  blockedBy: Record<string, number>;
}
