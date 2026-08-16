import type {
  IdealSurfaceKind,
  IdealSurfaceModel,
} from "../lib/geometry/continuous-surfaces";
import type {
  ComparisonGeometry,
  ComparisonShapeKind,
} from "../lib/geometry/comparison-surfaces";

/** Lightweight scene contract kept separate from the Three.js renderer chunk. */
export type Vec3Tuple = [number, number, number];
export type QuaternionTuple = [number, number, number, number];

export interface ScenePanel {
  id: string;
  label: string;
  position: Vec3Tuple;
  quaternion: QuaternionTuple;
  irradianceWm2?: number;
  temperatureC?: number;
  powerW?: number;
  bypassActive?: boolean;
  selected?: boolean;
}

export interface SceneObstacle {
  id: string;
  type: "mountain" | "building" | "tree" | "wall" | "ground" | "water" | "other";
  label: string;
  position: Vec3Tuple;
  rotation?: Vec3Tuple;
  scale: Vec3Tuple;
  color?: string;
}

export interface ThreeWorkspaceProps {
  panels: ScenePanel[];
  obstacles: SceneObstacle[];
  selectedPanelId: string | null;
  selectedObstacleId?: string | null;
  onSelectPanel: (id: string | null) => void;
  onSelectObstacle?: (id: string | null) => void;
  onPanelTransform: (id: string, position: Vec3Tuple, quaternion: QuaternionTuple) => void;
  onObstacleTransform?: (id: string, position: Vec3Tuple, rotation: Vec3Tuple, scale: Vec3Tuple) => void;
  transformMode: "translate" | "rotate" | "scale";
  gridSnap: boolean;
  surfaceSnap: boolean;
  showNormals: boolean;
  showRays: boolean;
  sunVector: Vec3Tuple;
  sunElevationDeg: number;
  rotationAngleRad: number;
  continuousSurface?: {
    kind: IdealSurfaceKind;
    cylinderAspectRatio?: number;
    coneAspectRatio?: number;
    model?: IdealSurfaceModel;
  } | null;
  idealSurfaceModel?: IdealSurfaceModel | null;
  showZoneBoundaries?: boolean;
  showSurfaceSamples?: boolean;
  cameraView?: "perspective" | "top";
  parcelAreaM2?: number;
  parcelAspectRatio?: number;
  parcelShape?: "rectangle" | "circle";
  parcelWidthM?: number;
  parcelDepthM?: number;
  parcelRotationRad?: number;
  showParcelBoundary?: boolean;
  sweptFootprintM2?: number;
  showSweptFootprint?: boolean;
  supportHeightM?: number;
  structureHeightM?: number;
  showHeightGuide?: boolean;
  gltfUrl?: string | null;
  quality?: "fast" | "balanced" | "precise";
}

export function parcelDimensionsFromArea(areaM2: number, aspectRatio = 1) {
  const safeArea = Number.isFinite(areaM2) ? Math.max(0, areaM2) : 0;
  const safeAspect = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  return {
    widthM: Math.sqrt(safeArea * safeAspect),
    depthM: Math.sqrt(safeArea / safeAspect),
  };
}

export interface ParcelRenderGeometry {
  shape: "rectangle" | "circle";
  widthM: number;
  depthM: number;
  radiusM: number;
  rotationRad: number;
  areaM2: number;
}

export function resolveParcelRenderGeometry(input: {
  shape?: "rectangle" | "circle";
  areaM2?: number;
  aspectRatio?: number;
  widthM?: number;
  depthM?: number;
  rotationRad?: number;
}): ParcelRenderGeometry {
  const shape = input.shape ?? "rectangle";
  const areaM2 = Number.isFinite(input.areaM2) ? Math.max(0, input.areaM2 ?? 0) : 0;
  const explicitWidthM = Number.isFinite(input.widthM) && (input.widthM ?? 0) > 0
    ? input.widthM!
    : undefined;
  const explicitDepthM = Number.isFinite(input.depthM) && (input.depthM ?? 0) > 0
    ? input.depthM!
    : undefined;
  const rotationRad = Number.isFinite(input.rotationRad) ? input.rotationRad ?? 0 : 0;

  if (shape === "circle") {
    const explicitDiameterM = explicitWidthM ?? explicitDepthM;
    const radiusM = explicitDiameterM !== undefined
      ? explicitDiameterM / 2
      : Math.sqrt(areaM2 / Math.PI);
    const diameterM = 2 * radiusM;
    return {
      shape,
      widthM: diameterM,
      depthM: diameterM,
      radiusM,
      rotationRad: 0,
      areaM2: Math.PI * radiusM * radiusM,
    };
  }

  const fallback = parcelDimensionsFromArea(areaM2, input.aspectRatio);
  const widthM = explicitWidthM ?? (
    explicitDepthM !== undefined && areaM2 > 0 ? areaM2 / explicitDepthM : fallback.widthM
  );
  const depthM = explicitDepthM ?? (
    explicitWidthM !== undefined && areaM2 > 0 ? areaM2 / explicitWidthM : fallback.depthM
  );
  return {
    shape,
    widthM,
    depthM,
    radiusM: Math.hypot(widthM, depthM) / 2,
    rotationRad,
    areaM2: widthM * depthM,
  };
}

export function comparisonParcelRenderGeometry(
  kind: ComparisonShapeKind,
  comparison: ComparisonGeometry,
  options: { clearanceM?: number; sceneRotationRad?: number } = {},
): ParcelRenderGeometry {
  const clearanceM = Number.isFinite(options.clearanceM)
    ? Math.max(0, options.clearanceM ?? 0)
    : 0;
  const useCircle = kind !== "plane" && kind !== "cube";
  if (useCircle) {
    const radiusM = Math.sqrt(comparison.footprint.staticProjectedAreaM2 / Math.PI)
      + clearanceM;
    return resolveParcelRenderGeometry({
      shape: "circle",
      areaM2: Math.PI * radiusM ** 2,
    });
  }

  const dimensions = comparison.dimensions;
  const widthM = kind === "plane"
    ? dimensions.widthM
    : comparison.footprint.staticBoundsWidthM;
  const depthM = kind === "plane"
    ? (dimensions.planeSlantLengthM ?? 0)
      * Math.abs(Math.cos((dimensions.planeTiltDeg ?? 0) * Math.PI / 180))
    : comparison.footprint.staticBoundsDepthM;
  return resolveParcelRenderGeometry({
    shape: "rectangle",
    areaM2: comparison.footprint.staticProjectedAreaM2,
    widthM: widthM + 2 * clearanceM,
    depthM: depthM + 2 * clearanceM,
    rotationRad: kind === "plane"
      ? (dimensions.planeAzimuthDeg ?? 0) * Math.PI / 180 + (options.sceneRotationRad ?? 0)
      : 0,
  });
}
