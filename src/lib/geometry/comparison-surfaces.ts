import {
  DEFAULT_SURFACE_AZIMUTH_SAMPLES,
  DEFAULT_SURFACE_MERIDIONAL_SEGMENTS,
  SURFACE_MERIDIONAL_ORDER,
  maximumConeProjectedArea,
  pointOnContinuousSurface,
  validateSurfaceAzimuthSamples,
  validateSurfaceMeridionalSegments,
  type ContinuousSurfaceDimensions,
  type ContinuousSurfaceKind,
  type SurfaceIntegrationModel,
  type SurfacePoint,
  type SurfaceSample,
  type SurfaceZone,
} from "./continuous-surfaces";
import { type Vec3 } from "./types";

export type ComparisonBasis = "land" | "active";
export type ComparisonShapeKind = "plane" | "cube" | ContinuousSurfaceKind;
export type ComparisonLayoutMode = "independent" | "array";
export type ComparisonFootprintMode = "static" | "swept";
export type PlaneTrackingMode = "fixed" | "single-axis" | "dual-axis";

export const DEFAULT_COMPARISON_BASIS: ComparisonBasis = "land";
export const DEFAULT_LAND_AREA_M2 = 0.05 as const;
/**
 * Fair-comparison height envelope: the diameter of a sphere whose horizontal
 * projection is `landAreaM2`.  It deliberately scales with the land input;
 * using one unrelated dimensional constant would let a tall cylinder gain PV
 * area merely because the parcel was made smaller.
 */
export function commonMaximumHeightM(landAreaM2: number): number {
  return 2 * Math.sqrt(positiveFinite(landAreaM2, "토지면적") / Math.PI);
}

export const DEFAULT_MAX_HEIGHT_M = 2 * Math.sqrt(DEFAULT_LAND_AREA_M2 / Math.PI);
export const DEFAULT_MAXIMUM_ASPECT_RATIO = 4 as const;
export const DEFAULT_MAXIMUM_ACTIVE_AREA_M2 = 0.25 as const;
export const MAX_COMPARISON_PLANE_TILT_DEG = 75 as const;

export interface ComparisonSurfaceInput {
  basis?: ComparisonBasis;
  landAreaM2?: number;
  activeAreaM2?: number;
  maximumActiveAreaM2?: number;
  maxHeightM?: number;
  /** Maximum structure height / footprint diameter. */
  maximumAspectRatio?: number;
  layoutMode?: ComparisonLayoutMode;
  footprintMode?: ComparisonFootprintMode;
  /** Conservative full linear clearance between array allocations. */
  spacingM?: number;
  /** Additional full linear maintenance clearance around an array allocation. */
  maintenanceClearanceM?: number;
  /** Render-only parcel aspect metadata; native-footprint sizing is area based. */
  parcelAspectRatio?: number;
  planeTrackingMode?: PlaneTrackingMode;
  planeTiltDeg?: number;
  planeAzimuthDeg?: number;
  /** Plane width/slant-length. */
  planeAspectRatio?: number;
  cylinderHeightM?: number;
  coneHeightM?: number;
  groundClearanceM?: number;
  azimuthSamples?: number;
  /** Composite GL2 intervals. This is numerical resolution, not a panel count. */
  meridionalSegments?: number;
}

export interface ComparisonDimensions {
  widthM: number;
  depthM: number;
  heightM: number;
  radiusM?: number;
  slantHeightM?: number;
  planeTrackingMode?: PlaneTrackingMode;
  planeTiltDeg?: number;
  planeAzimuthDeg?: number;
  planeSlantLengthM?: number;
  /** Worst-case height attained over the requested tracking range. */
  trackingEnvelopeHeightM?: number;
  /** Circular XZ envelope radius attained by a horizontal tracking posture. */
  trackingEnvelopeRadiusM?: number;
}

export interface FootprintBreakdown {
  /** Exact union area of the structure's world-XZ orthogonal projection. */
  staticProjectedAreaM2: number;
  /** Axis-aligned bounds used to fit static plane/cube shapes in a parcel. */
  staticBoundsWidthM: number;
  staticBoundsDepthM: number;
  staticBoundsAreaM2: number;
  /** Radius/area occupied by a complete 360-degree world-Y sweep. */
  sweptRadiusM: number;
  sweptAreaM2: number;
  selectedMode: ComparisonFootprintMode;
  selectedStructureAreaM2: number;
  spacingAreaM2: number;
  maintenanceAreaM2: number;
  /** Actual parcel allocation after the documented Minkowski clearances. */
  parcelAreaM2: number;
}

export interface ComparisonConstraints {
  /** Formula value 2*sqrt(A_land/pi), independent of any tighter user limit. */
  commonMaximumHeightM: number;
  maxHeightM: number;
  maximumAspectRatio: number;
  maximumActiveAreaM2: number;
  requestedLandAreaM2: number;
  effectiveParcelAreaM2: number;
  requestedActiveAreaM2: number;
  effectiveActiveAreaM2: number;
  effectiveHeightM: number;
  effectiveAspectRatio: number;
  heightLimited: boolean;
  aspectLimited: boolean;
  activeAreaLimited: boolean;
  heightExceeded: boolean;
  landAreaExceeded: boolean;
  feasible: boolean;
  /** Eligible for the official equal-land/equal-height ranking. */
  officialComparisonEligible: boolean;
  officialComparisonExclusionReasons: readonly string[];
}

export interface ComparisonGeometry {
  shape: ComparisonShapeKind;
  basis: ComparisonBasis;
  layoutMode: ComparisonLayoutMode;
  requestedLandAreaM2: number;
  /** Actual union area of the vertical world-XZ projection. */
  landAreaM2: number;
  /** 100 * actual vertical projection / requested comparison land area. */
  footprintIndex: number;
  requestedActiveAreaM2: number;
  activeAreaM2: number;
  /** Geometric envelope volume; independent of the active PV skin area. */
  structureVolumeM3: number;
  dimensions: ComparisonDimensions;
  footprint: FootprintBreakdown;
  constraints: ComparisonConstraints;
  assumptions: readonly string[];
}

export interface ComparisonSurfaceModel extends SurfaceIntegrationModel {
  kind: ComparisonShapeKind;
  /** Every comparison shape is one contiguous ideal PV skin. */
  surfaceCount: 1;
  continuousSkinId: string;
  meridionalSegments: number;
  comparison: ComparisonGeometry;
}

interface NormalizedInput {
  basis: ComparisonBasis;
  landAreaM2: number;
  activeAreaM2: number;
  targetActiveAreaM2: number;
  maximumActiveAreaM2: number;
  maxHeightM: number;
  maximumAspectRatio: number;
  layoutMode: ComparisonLayoutMode;
  footprintMode: ComparisonFootprintMode;
  spacingM: number;
  maintenanceClearanceM: number;
  planeTrackingMode: PlaneTrackingMode;
  planeTiltDeg: number;
  planeAzimuthDeg: number;
  planeAspectRatio: number;
  planeAspectRatioExplicit: boolean;
  cylinderHeightM: number;
  coneHeightM: number;
  commonMaximumHeightM: number;
  groundClearanceM: number;
  azimuthSamples: number;
  meridionalSegments: number;
}

interface RawGeometry extends ComparisonDimensions {
  heightLimited: boolean;
  aspectLimited: boolean;
  activeAreaLimited: boolean;
}

const TWO_PI = 2 * Math.PI;
const GL2 = 1 / Math.sqrt(3);

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label}은(는) 0보다 큰 유한수여야 합니다.`);
  }
  return value;
}

function nonnegativeFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label}은(는) 0 이상의 유한수여야 합니다.`);
  }
  return value;
}

function normalizeInput(input: ComparisonSurfaceInput): NormalizedInput {
  const requestedLandAreaM2 = positiveFinite(
    input.landAreaM2 ?? DEFAULT_LAND_AREA_M2,
    "토지면적",
  );
  const fairMaximumHeightM = commonMaximumHeightM(requestedLandAreaM2);
  const maximumActiveAreaM2 = positiveFinite(
    input.maximumActiveAreaM2 ?? 5 * requestedLandAreaM2,
    "최대 활성면적",
  );
  // A caller may impose a tighter engineering envelope, but may never relax
  // the common fair-comparison envelope derived from A_land.
  const maxHeightM = Math.min(
    positiveFinite(input.maxHeightM ?? fairMaximumHeightM, "최대 높이"),
    fairMaximumHeightM,
  );
  const nativeRadiusM = Math.sqrt(requestedLandAreaM2 / Math.PI);
  const cylinderHeightM = positiveFinite(
    input.cylinderHeightM ?? 2 * nativeRadiusM,
    "원기둥 높이",
  );
  const coneHeightM = positiveFinite(
    input.coneHeightM ?? 2 * nativeRadiusM,
    "원뿔 높이",
  );
  const requestedPlaneTiltDeg = input.planeTiltDeg ?? 30;
  if (
    !Number.isFinite(requestedPlaneTiltDeg)
    || requestedPlaneTiltDeg < 0
    || requestedPlaneTiltDeg > MAX_COMPARISON_PLANE_TILT_DEG
  ) {
    throw new RangeError(`평면 경사각은 0~${MAX_COMPARISON_PLANE_TILT_DEG}도의 유한수여야 합니다.`);
  }
  const planeTiltDeg = requestedPlaneTiltDeg;
  const planeAzimuthDeg = input.planeAzimuthDeg ?? 180;
  if (!Number.isFinite(planeAzimuthDeg)) throw new RangeError("평면 방위각은 유한수여야 합니다.");
  const planeTrackingMode = input.planeTrackingMode ?? "fixed";
  if (!["fixed", "single-axis", "dual-axis"].includes(planeTrackingMode)) {
    throw new RangeError("평면 추적 모드는 fixed, single-axis, dual-axis 중 하나여야 합니다.");
  }
  return {
    basis: input.basis ?? DEFAULT_COMPARISON_BASIS,
    landAreaM2: requestedLandAreaM2,
    activeAreaM2: positiveFinite(input.activeAreaM2 ?? DEFAULT_LAND_AREA_M2, "활성면적"),
    targetActiveAreaM2: Math.min(
      positiveFinite(input.activeAreaM2 ?? DEFAULT_LAND_AREA_M2, "활성면적"),
      maximumActiveAreaM2,
    ),
    maximumActiveAreaM2,
    maxHeightM,
    maximumAspectRatio: positiveFinite(
      input.maximumAspectRatio ?? DEFAULT_MAXIMUM_ASPECT_RATIO,
      "최대 높이/직경비",
    ),
    layoutMode: input.layoutMode ?? "independent",
    footprintMode: input.footprintMode ?? "static",
    spacingM: nonnegativeFinite(input.spacingM ?? 0, "배열 간격"),
    maintenanceClearanceM: nonnegativeFinite(
      input.maintenanceClearanceM ?? 0,
      "정비 여유",
    ),
    planeTrackingMode,
    planeTiltDeg,
    planeAzimuthDeg: ((planeAzimuthDeg % 360) + 360) % 360,
    // With no advanced aspect override, the plane's orthogonal footprint is
    // exactly L × L while its slant length grows to L / cos(beta).
    planeAspectRatio: positiveFinite(
      input.planeAspectRatio ?? Math.cos(planeTiltDeg * Math.PI / 180),
      "평면 폭/경사길이 비",
    ),
    planeAspectRatioExplicit: input.planeAspectRatio !== undefined,
    cylinderHeightM,
    coneHeightM,
    commonMaximumHeightM: fairMaximumHeightM,
    groundClearanceM: nonnegativeFinite(input.groundClearanceM ?? 0.003, "지면 여유"),
    azimuthSamples: validateSurfaceAzimuthSamples(
      input.azimuthSamples ?? DEFAULT_SURFACE_AZIMUTH_SAMPLES,
    ),
    meridionalSegments: validateSurfaceMeridionalSegments(
      input.meridionalSegments ?? DEFAULT_SURFACE_MERIDIONAL_SEGMENTS,
    ),
  };
}

function planeGeometry(input: NormalizedInput): RawGeometry {
  let aspect = input.planeAspectRatio;
  let tilt = input.planeTiltDeg * Math.PI / 180;
  let heightLimited = false;
  let activeAreaLimited = input.basis === "active"
    && input.targetActiveAreaM2 < input.activeAreaM2;
  const projectedAreaM2 = input.basis === "land" ? input.landAreaM2 : null;
  if (projectedAreaM2 !== null) {
    if (input.maximumActiveAreaM2 + 1e-12 < projectedAreaM2) {
      throw new RangeError("Maximum active area is smaller than the required plane footprint.");
    }
    const activeTiltLimit = Math.acos(Math.min(1, projectedAreaM2 / input.maximumActiveAreaM2));
    if (tilt > activeTiltLimit) {
      tilt = activeTiltLimit;
      activeAreaLimited = true;
    }
    const heightAt = (candidate: number): number => {
      if (!input.planeAspectRatioExplicit) {
        return Math.sqrt(projectedAreaM2) * Math.tan(candidate);
      }
      const slant = Math.sqrt(projectedAreaM2 / (aspect * Math.max(Math.cos(candidate), 1e-15)));
      return slant * Math.sin(candidate);
    };
    if (heightAt(tilt) > input.maxHeightM) {
      let lower = 0;
      let upper = tilt;
      for (let iteration = 0; iteration < 80; iteration += 1) {
        const midpoint = (lower + upper) / 2;
        if (heightAt(midpoint) <= input.maxHeightM) lower = midpoint;
        else upper = midpoint;
      }
      tilt = lower;
      heightLimited = true;
    }
    // The default land-basis plane remains L × L in horizontal projection
    // after a height/area clamp. An explicit advanced aspect override remains
    // authoritative.
    if (!input.planeAspectRatioExplicit) aspect = Math.cos(tilt);
  }
  const cosineTilt = Math.max(Math.cos(tilt), 1e-15);
  const sineTilt = Math.sin(tilt);
  const slantLengthM = projectedAreaM2 === null
    ? Math.sqrt(input.targetActiveAreaM2 / aspect)
    : Math.sqrt(projectedAreaM2 / (aspect * cosineTilt));
  const widthM = aspect * slantLengthM;
  return {
    widthM,
    depthM: slantLengthM * cosineTilt,
    heightM: slantLengthM * sineTilt,
    planeSlantLengthM: slantLengthM,
    planeTrackingMode: input.planeTrackingMode,
    planeTiltDeg: tilt * 180 / Math.PI,
    planeAzimuthDeg: input.planeAzimuthDeg,
    ...(input.planeTrackingMode === "fixed"
      ? {}
      : {
          trackingEnvelopeHeightM: slantLengthM,
          trackingEnvelopeRadiusM: Math.hypot(widthM, slantLengthM) / 2,
        }),
    heightLimited,
    aspectLimited: false,
    activeAreaLimited,
  };
}

function cubeGeometry(input: NormalizedInput): RawGeometry {
  const sideM = input.basis === "active"
    ? Math.sqrt(input.targetActiveAreaM2 / 5)
    : Math.sqrt(input.landAreaM2);
  if (sideM > input.maxHeightM + 1e-12) {
    throw new RangeError("The cube footprint cannot fit inside maximum height without underfilling land.");
  }
  if (5 * sideM * sideM > input.maximumActiveAreaM2 + 1e-12) {
    throw new RangeError("Maximum active area is too small for the five-face cube skin.");
  }
  return {
    widthM: sideM,
    depthM: sideM,
    heightM: sideM,
    heightLimited: false,
    aspectLimited: false,
    activeAreaLimited: input.basis === "active"
      && input.targetActiveAreaM2 < input.activeAreaM2,
  };
}

function circularGeometry(
  shape: Extract<ComparisonShapeKind, "sphere" | "hemisphere" | "cylinder" | "cone">,
  input: NormalizedInput,
): RawGeometry {
  let radiusM: number;
  let heightM: number;
  let heightLimited = false;
  let aspectLimited = false;
  let activeAreaLimited = input.basis === "active"
    && input.targetActiveAreaM2 < input.activeAreaM2;

  if (input.basis === "land") {
    radiusM = Math.sqrt(input.landAreaM2 / Math.PI);
    if (shape === "sphere") {
      heightM = 2 * radiusM;
      if (heightM > input.maxHeightM + 1e-12) {
        throw new RangeError("The sphere footprint requires a diameter above maximum height.");
      }
      if (4 * input.landAreaM2 > input.maximumActiveAreaM2 + 1e-12) {
        throw new RangeError("Maximum active area is too small for the complete sphere skin.");
      }
    } else if (shape === "hemisphere") {
      heightM = radiusM;
      if (heightM > input.maxHeightM + 1e-12) {
        throw new RangeError("The hemisphere footprint requires a radius above maximum height.");
      }
      if (2 * input.landAreaM2 > input.maximumActiveAreaM2 + 1e-12) {
        throw new RangeError("Maximum active area is too small for the hemisphere skin.");
      }
    } else {
      const requestedHeightM = shape === "cylinder" ? input.cylinderHeightM : input.coneHeightM;
      if (requestedHeightM > input.maxHeightM + 1e-12) {
        throw new RangeError(
          `${shape} height must satisfy 0 < H <= H_max (${input.maxHeightM.toFixed(6)} m).`,
        );
      }
      const aspectHeightM = 2 * radiusM * input.maximumAspectRatio;
      let activeAreaHeightM: number;
      if (shape === "cylinder") {
        activeAreaHeightM = (
          input.maximumActiveAreaM2 - Math.PI * radiusM * radiusM
        ) / (2 * Math.PI * radiusM);
      } else {
        const maximumSlantM = input.maximumActiveAreaM2 / (Math.PI * radiusM);
        activeAreaHeightM = maximumSlantM >= radiusM
          ? Math.sqrt(maximumSlantM * maximumSlantM - radiusM * radiusM)
          : 0;
      }
      heightM = Math.max(0, Math.min(
        requestedHeightM,
        input.maxHeightM,
        aspectHeightM,
        activeAreaHeightM,
      ));
      heightLimited = requestedHeightM > input.maxHeightM;
      aspectLimited = requestedHeightM > aspectHeightM;
      activeAreaLimited = requestedHeightM > activeAreaHeightM;
    }
  } else if (shape === "sphere") {
    radiusM = Math.sqrt(input.targetActiveAreaM2 / (4 * Math.PI));
    heightM = 2 * radiusM;
  } else if (shape === "hemisphere") {
    radiusM = Math.sqrt(input.targetActiveAreaM2 / (2 * Math.PI));
    heightM = radiusM;
  } else if (shape === "cylinder") {
    if (input.cylinderHeightM > input.maxHeightM + 1e-12) {
      throw new RangeError(
        `cylinder height must satisfy 0 < H <= H_max (${input.maxHeightM.toFixed(6)} m).`,
      );
    }
    heightM = input.cylinderHeightM;
    // A = pi r^2 + 2 pi r h => r = sqrt(h^2 + A/pi) - h.
    radiusM = Math.sqrt(heightM * heightM + input.targetActiveAreaM2 / Math.PI) - heightM;
    if (heightM / (2 * radiusM) > input.maximumAspectRatio) {
      const heightToRadius = 2 * input.maximumAspectRatio;
      radiusM = Math.sqrt(
        input.targetActiveAreaM2 / (Math.PI * (1 + 2 * heightToRadius)),
      );
      heightM = heightToRadius * radiusM;
      aspectLimited = true;
    }
  } else {
    if (input.coneHeightM > input.maxHeightM + 1e-12) {
      throw new RangeError(
        `cone height must satisfy 0 < H <= H_max (${input.maxHeightM.toFixed(6)} m).`,
      );
    }
    heightM = input.coneHeightM;
    // A/pi = r sqrt(r^2+h^2); solve the quadratic in r^2.
    const areaRatio = input.targetActiveAreaM2 / Math.PI;
    radiusM = Math.sqrt(
      (-heightM * heightM + Math.sqrt(heightM ** 4 + 4 * areaRatio * areaRatio)) / 2,
    );
    if (heightM / (2 * radiusM) > input.maximumAspectRatio) {
      const heightToRadius = 2 * input.maximumAspectRatio;
      radiusM = Math.sqrt(
        input.targetActiveAreaM2 / (Math.PI * Math.sqrt(1 + heightToRadius ** 2)),
      );
      heightM = heightToRadius * radiusM;
      aspectLimited = true;
    }
  }

  return {
    radiusM,
    widthM: 2 * radiusM,
    depthM: 2 * radiusM,
    heightM,
    ...(shape === "cone" ? { slantHeightM: Math.hypot(radiusM, heightM) } : {}),
    heightLimited,
    aspectLimited,
    activeAreaLimited,
  };
}

function activeArea(shape: ComparisonShapeKind, dimensions: ComparisonDimensions): number {
  const radiusM = dimensions.radiusM ?? 0;
  switch (shape) {
    case "plane":
      return dimensions.widthM * (dimensions.planeSlantLengthM ?? 0);
    case "cube":
      return 5 * dimensions.widthM * dimensions.widthM;
    case "sphere":
      return 4 * Math.PI * radiusM * radiusM;
    case "hemisphere":
      return 2 * Math.PI * radiusM * radiusM;
    case "cylinder":
      return Math.PI * radiusM * radiusM + 2 * Math.PI * radiusM * dimensions.heightM;
    case "cone":
      return Math.PI * radiusM * (dimensions.slantHeightM ?? Math.hypot(radiusM, dimensions.heightM));
  }
}

function structureVolume(shape: ComparisonShapeKind, dimensions: ComparisonDimensions): number {
  const radiusM = dimensions.radiusM ?? 0;
  switch (shape) {
    case "plane":
      // The ideal PV sheet has no prescribed material thickness.
      return 0;
    case "cube":
      return dimensions.widthM ** 3;
    case "sphere":
      return 4 * Math.PI * radiusM ** 3 / 3;
    case "hemisphere":
      return 2 * Math.PI * radiusM ** 3 / 3;
    case "cylinder":
      return Math.PI * radiusM ** 2 * dimensions.heightM;
    case "cone":
      return Math.PI * radiusM ** 2 * dimensions.heightM / 3;
  }
}

function footprintBase(shape: ComparisonShapeKind, dimensions: ComparisonDimensions): {
  staticProjectedAreaM2: number;
  widthM: number;
  depthM: number;
  clearanceWidthM: number;
  clearanceDepthM: number;
  sweptRadiusM: number;
} {
  if (shape === "plane") {
    const tilt = (dimensions.planeTiltDeg ?? 0) * Math.PI / 180;
    const azimuth = (dimensions.planeAzimuthDeg ?? 0) * Math.PI / 180;
    const widthM = dimensions.widthM;
    const projectedDepthM = (dimensions.planeSlantLengthM ?? 0) * Math.abs(Math.cos(tilt));
    const boundsWidth = widthM * Math.abs(Math.cos(azimuth))
      + projectedDepthM * Math.abs(Math.sin(azimuth));
    const boundsDepth = widthM * Math.abs(Math.sin(azimuth))
      + projectedDepthM * Math.abs(Math.cos(azimuth));
    const tracking = dimensions.planeTrackingMode !== undefined
      && dimensions.planeTrackingMode !== "fixed";
    return {
      staticProjectedAreaM2: widthM * projectedDepthM,
      widthM: boundsWidth,
      depthM: boundsDepth,
      clearanceWidthM: widthM,
      clearanceDepthM: projectedDepthM,
      sweptRadiusM: tracking
        ? dimensions.trackingEnvelopeRadiusM
          ?? Math.hypot(widthM, dimensions.planeSlantLengthM ?? 0) / 2
        : Math.hypot(widthM, projectedDepthM) / 2,
    };
  }
  if (shape === "cube") {
    const sideM = dimensions.widthM;
    return {
      staticProjectedAreaM2: sideM * sideM,
      widthM: sideM,
      depthM: sideM,
      clearanceWidthM: sideM,
      clearanceDepthM: sideM,
      sweptRadiusM: sideM / Math.SQRT2,
    };
  }
  const radiusM = dimensions.radiusM ?? 0;
  return {
    staticProjectedAreaM2: Math.PI * radiusM * radiusM,
    widthM: 2 * radiusM,
    depthM: 2 * radiusM,
    clearanceWidthM: 2 * radiusM,
    clearanceDepthM: 2 * radiusM,
    sweptRadiusM: radiusM,
  };
}

function footprintBreakdown(
  shape: ComparisonShapeKind,
  dimensions: ComparisonDimensions,
  input: NormalizedInput,
): FootprintBreakdown {
  const base = footprintBase(shape, dimensions);
  const sweptAreaM2 = Math.PI * base.sweptRadiusM * base.sweptRadiusM;
  const trackingPlane = shape === "plane"
    && dimensions.planeTrackingMode !== undefined
    && dimensions.planeTrackingMode !== "fixed";
  const selectedMode: ComparisonFootprintMode = trackingPlane ? "swept" : input.footprintMode;
  const useCircle = selectedMode === "swept"
    || (shape !== "plane" && shape !== "cube");
  const selectedStructureAreaM2 = selectedMode === "swept"
    ? sweptAreaM2
    : base.staticProjectedAreaM2;
  const spacing = input.layoutMode === "array" ? input.spacingM : 0;
  const maintenance = input.layoutMode === "array" ? input.maintenanceClearanceM : 0;
  const afterSpacing = useCircle
    ? Math.PI * (base.sweptRadiusM + spacing) ** 2
    : (base.clearanceWidthM + 2 * spacing) * (base.clearanceDepthM + 2 * spacing);
  const afterMaintenance = useCircle
    ? Math.PI * (base.sweptRadiusM + spacing + maintenance) ** 2
    : (base.clearanceWidthM + 2 * (spacing + maintenance))
      * (base.clearanceDepthM + 2 * (spacing + maintenance));
  return {
    staticProjectedAreaM2: base.staticProjectedAreaM2,
    staticBoundsWidthM: base.widthM,
    staticBoundsDepthM: base.depthM,
    staticBoundsAreaM2: base.widthM * base.depthM,
    sweptRadiusM: base.sweptRadiusM,
    sweptAreaM2,
    selectedMode,
    selectedStructureAreaM2,
    spacingAreaM2: afterSpacing - selectedStructureAreaM2,
    maintenanceAreaM2: afterMaintenance - afterSpacing,
    parcelAreaM2: afterMaintenance,
  };
}

function scaleRawGeometry(raw: RawGeometry, scale: number): RawGeometry {
  if (!(scale > 0) || !Number.isFinite(scale)) {
    throw new RangeError("Swept-footprint geometry scale must be positive and finite.");
  }
  return {
    ...raw,
    widthM: raw.widthM * scale,
    depthM: raw.depthM * scale,
    heightM: raw.heightM * scale,
    ...(raw.radiusM === undefined ? {} : { radiusM: raw.radiusM * scale }),
    ...(raw.slantHeightM === undefined ? {} : { slantHeightM: raw.slantHeightM * scale }),
    ...(raw.planeSlantLengthM === undefined
      ? {}
      : { planeSlantLengthM: raw.planeSlantLengthM * scale }),
    ...(raw.trackingEnvelopeHeightM === undefined
      ? {}
      : { trackingEnvelopeHeightM: raw.trackingEnvelopeHeightM * scale }),
    ...(raw.trackingEnvelopeRadiusM === undefined
      ? {}
      : { trackingEnvelopeRadiusM: raw.trackingEnvelopeRadiusM * scale }),
  };
}

function calculateComparisonGeometryFromNormalized(
  shape: ComparisonShapeKind,
  input: NormalizedInput,
): ComparisonGeometry {
  let raw = shape === "plane"
    ? planeGeometry(input)
    : shape === "cube"
      ? cubeGeometry(input)
      : circularGeometry(shape, input);
  // A rotating non-axisymmetric body occupies its full 360-degree swept disk,
  // not its favourable instantaneous orthogonal projection.  Scale plane/cube
  // dimensions so that this disk (rather than the static rectangle) is exactly
  // A_land. Circular shapes already meet the same contract without scaling.
  const usesSweptFootprint = input.footprintMode === "swept"
    || (shape === "plane" && raw.planeTrackingMode !== undefined && raw.planeTrackingMode !== "fixed");
  if (input.basis === "land" && usesSweptFootprint && (shape === "plane" || shape === "cube")) {
    const rawSweptAreaM2 = footprintBreakdown(shape, raw, input).sweptAreaM2;
    raw = scaleRawGeometry(raw, Math.sqrt(input.landAreaM2 / rawSweptAreaM2));
  }
  const dimensions: ComparisonDimensions = { ...raw };
  const activeAreaM2 = activeArea(shape, dimensions);
  const structureVolumeM3 = structureVolume(shape, dimensions);
  const footprint = footprintBreakdown(shape, dimensions, input);
  // In rotating comparisons A_land(shape) is the maximum swept occupation;
  // in static comparisons it is the instantaneous orthogonal projection.
  const landAreaM2 = footprint.selectedStructureAreaM2;
  const effectiveConstraintHeightM = dimensions.trackingEnvelopeHeightM ?? dimensions.heightM;
  const heightExceeded = effectiveConstraintHeightM > input.maxHeightM + 1e-12;
  const landAreaExceeded = footprint.parcelAreaM2 > input.landAreaM2 + 1e-12;
  const officialComparisonExclusionReasons: string[] = [];
  if (heightExceeded) officialComparisonExclusionReasons.push("height-exceeds-common-envelope");
  if (landAreaExceeded) officialComparisonExclusionReasons.push("land-or-swept-footprint-exceeds-parcel");
  if (raw.activeAreaLimited) officialComparisonExclusionReasons.push("active-area-cap-altered-geometry");
  if (raw.aspectLimited) officialComparisonExclusionReasons.push("aspect-ratio-cap-altered-geometry");
  if (
    (shape === "cylinder" || shape === "cone")
    && Math.abs(dimensions.heightM - input.commonMaximumHeightM) > 1e-10
  ) {
    officialComparisonExclusionReasons.push("user-custom-height");
  }
  return {
    shape,
    basis: input.basis,
    layoutMode: input.layoutMode,
    requestedLandAreaM2: input.landAreaM2,
    landAreaM2,
    footprintIndex: 100 * landAreaM2 / input.landAreaM2,
    requestedActiveAreaM2: input.activeAreaM2,
    activeAreaM2,
    structureVolumeM3,
    dimensions,
    footprint,
    constraints: {
      commonMaximumHeightM: input.commonMaximumHeightM,
      maxHeightM: input.maxHeightM,
      maximumAspectRatio: input.maximumAspectRatio,
      maximumActiveAreaM2: input.maximumActiveAreaM2,
      requestedLandAreaM2: input.landAreaM2,
      effectiveParcelAreaM2: footprint.parcelAreaM2,
      requestedActiveAreaM2: input.activeAreaM2,
      effectiveActiveAreaM2: activeAreaM2,
      effectiveHeightM: effectiveConstraintHeightM,
      effectiveAspectRatio: effectiveConstraintHeightM
        / Math.max(dimensions.widthM, dimensions.depthM),
      heightLimited: raw.heightLimited,
      aspectLimited: raw.aspectLimited,
      activeAreaLimited: raw.activeAreaLimited,
      heightExceeded,
      landAreaExceeded,
      feasible: !heightExceeded && !landAreaExceeded,
      officialComparisonEligible: officialComparisonExclusionReasons.length === 0,
      officialComparisonExclusionReasons,
    },
    assumptions: [
      "A_land는 구조물의 월드 XZ 직교투영 또는 선택한 360도 Y축 swept footprint이다.",
      "독립 구조물은 간격을 더하지 않으며 배열 모드만 spacing과 maintenance를 전방향 선형 여유로 적용한다.",
      "배열 원형 footprint는 pi(r+m)^2, 직사각 footprint는 (w+2m)(d+2m)의 Minkowski 확장을 사용한다.",
      "추적 평면은 수평 자세의 전체 대각선 원형 envelope와 수직 자세 높이를 함께 제한한다.",
      "구조물 부피는 활성 PV 스킨 면적과 독립적인 이상 기하 envelope이며 무두께 평면은 0이다.",
      "원기둥 활성면은 위쪽 원판과 옆면이며 아래 원판은 제외한다.",
      "정육면체 활성면은 위쪽과 네 옆면의 5면이며 아래 면은 제외한다.",
    ],
  };
}

export function calculateComparisonGeometry(
  shape: ComparisonShapeKind,
  options: ComparisonSurfaceInput = {},
): ComparisonGeometry {
  return calculateComparisonGeometryFromNormalized(shape, normalizeInput(options));
}

function sample(
  point: SurfacePoint,
  zoneId: string,
  zoneIndex: number,
  areaM2: number,
  u: number,
  v: number,
): SurfaceSample {
  return { ...point, zoneId, zoneIndex, areaM2, u, v };
}

function analyticPoint(
  kind: ContinuousSurfaceKind,
  dimensions: ContinuousSurfaceDimensions,
  q: number,
  v: number,
): SurfacePoint {
  return pointOnContinuousSurface(kind, dimensions, q, v);
}

function analyticZones(
  kind: Extract<ContinuousSurfaceKind, "sphere" | "hemisphere" | "cone">,
  dimensions: ContinuousSurfaceDimensions,
  azimuthSamples: number,
  meridionalSegments: number,
): SurfaceZone[] {
  const zoneId = `${kind}-skin`;
  const samples: SurfaceSample[] = [];
  for (let segment = 0; segment < meridionalSegments; segment += 1) {
    const midpoint = (segment + 0.5) / meridionalSegments;
    const halfWidth = 0.5 / meridionalSegments;
    for (const node of [-GL2, GL2]) {
      const q = midpoint + halfWidth * node;
      for (let azimuthIndex = 0; azimuthIndex < azimuthSamples; azimuthIndex += 1) {
        const v = (azimuthIndex + 0.5) / azimuthSamples;
        samples.push(sample(
          analyticPoint(kind, dimensions, q, v),
          zoneId,
          0,
          dimensions.activeAreaM2 / (2 * meridionalSegments * azimuthSamples),
          q,
          v,
        ));
      }
    }
  }
  const representative = analyticPoint(kind, dimensions, 0.5, 0);
  return [{
    id: zoneId,
    index: 0,
    areaM2: dimensions.activeAreaM2,
    qMin: 0,
    qMax: 1,
    representativePosition: representative.position,
    representativeNormal: representative.normal,
    samples,
  }];
}

function cylinderPoint(
  dimensions: ContinuousSurfaceDimensions,
  q: number,
  v: number,
  topFraction: number,
): SurfacePoint {
  const angle = TWO_PI * v;
  const sine = Math.sin(angle);
  const cosine = Math.cos(angle);
  if (q < topFraction) {
    const radialFraction = Math.sqrt(q / topFraction);
    return {
      position: [
        dimensions.radiusM * radialFraction * sine,
        dimensions.centreY + dimensions.heightM / 2,
        dimensions.radiusM * radialFraction * cosine,
      ],
      normal: [0, 1, 0],
    };
  }
  const lateralQ = (q - topFraction) / (1 - topFraction);
  return {
    position: [
      dimensions.radiusM * sine,
      dimensions.centreY + (lateralQ - 0.5) * dimensions.heightM,
      dimensions.radiusM * cosine,
    ],
    normal: [sine, 0, cosine],
  };
}

function cylinderZones(
  dimensions: ContinuousSurfaceDimensions,
  azimuthSamples: number,
  meridionalSegments: number,
): SurfaceZone[] {
  const topAreaM2 = Math.PI * dimensions.radiusM ** 2;
  const topFraction = topAreaM2 / dimensions.activeAreaM2;
  const regions = [
    { id: "cylinder-top", qMin: 0, qMax: topFraction },
    { id: "cylinder-side", qMin: topFraction, qMax: 1 },
  ].filter((region) => region.qMax - region.qMin > 1e-15);
  return regions.map((region, index) => {
    const { qMin, qMax } = region;
    const zoneId = region.id;
    const samples: SurfaceSample[] = [];
    for (let segment = 0; segment < meridionalSegments; segment += 1) {
      const left = qMin + (qMax - qMin) * segment / meridionalSegments;
      const right = qMin + (qMax - qMin) * (segment + 1) / meridionalSegments;
      const midpoint = (left + right) / 2;
      const halfWidth = (right - left) / 2;
      const sampleAreaM2 = dimensions.activeAreaM2 * (right - left) / (2 * azimuthSamples);
      for (const node of [-GL2, GL2]) {
        const q = midpoint + halfWidth * node;
        for (let azimuthIndex = 0; azimuthIndex < azimuthSamples; azimuthIndex += 1) {
          const v = (azimuthIndex + 0.5) / azimuthSamples;
          samples.push(sample(
            cylinderPoint(dimensions, q, v, topFraction),
            zoneId,
            index,
            sampleAreaM2,
            q,
            v,
          ));
        }
      }
    }
    const midpoint = (qMin + qMax) / 2;
    const representative = cylinderPoint(dimensions, midpoint, 0, topFraction);
    return {
      id: zoneId,
      index,
      areaM2: dimensions.activeAreaM2 * (qMax - qMin),
      qMin,
      qMax,
      representativePosition: representative.position,
      representativeNormal: representative.normal,
      samples,
    };
  });
}

function planarPatchZone(args: {
  kind: "plane" | "cube";
  index: number;
  zoneAreaM2: number;
  centre: Vec3;
  normal: Vec3;
  axisU: Vec3;
  axisV: Vec3;
  widthM: number;
  heightM: number;
  azimuthSamples: number;
  meridionalSegments: number;
  qMin?: number;
  qMax?: number;
}): SurfaceZone {
  const zoneId = args.kind === "plane" ? "plane-skin" : `cube-face-${args.index + 1}`;
  const samples: SurfaceSample[] = [];
  for (let segment = 0; segment < args.meridionalSegments; segment += 1) {
    const midpoint = (segment + 0.5) / args.meridionalSegments;
    const halfWidth = 0.5 / args.meridionalSegments;
    for (const node of [-GL2, GL2]) {
      const verticalFraction = midpoint + halfWidth * node;
      const offsetV = (verticalFraction - 0.5) * args.heightM;
      for (let horizontalIndex = 0; horizontalIndex < args.azimuthSamples; horizontalIndex += 1) {
        const horizontalFraction = (horizontalIndex + 0.5) / args.azimuthSamples;
        const offsetU = (horizontalFraction - 0.5) * args.widthM;
        samples.push(sample({
          position: [
            args.centre[0] + args.axisU[0] * offsetU + args.axisV[0] * offsetV,
            args.centre[1] + args.axisU[1] * offsetU + args.axisV[1] * offsetV,
            args.centre[2] + args.axisU[2] * offsetU + args.axisV[2] * offsetV,
          ],
          normal: args.normal,
        }, zoneId, args.index,
        args.zoneAreaM2 / (2 * args.meridionalSegments * args.azimuthSamples),
        verticalFraction, horizontalFraction));
      }
    }
  }
  return {
    id: zoneId,
    index: args.index,
    areaM2: args.zoneAreaM2,
    qMin: args.qMin ?? 0,
    qMax: args.qMax ?? 1,
    representativePosition: args.centre,
    representativeNormal: args.normal,
    samples,
  };
}

function planeZones(
  geometry: ComparisonGeometry,
  clearanceM: number,
  azimuthSamples: number,
  meridionalSegments: number,
): SurfaceZone[] {
  const dimensions = geometry.dimensions;
  const tilt = (dimensions.planeTiltDeg ?? 0) * Math.PI / 180;
  const azimuth = (dimensions.planeAzimuthDeg ?? 0) * Math.PI / 180;
  const axisU: Vec3 = [Math.cos(azimuth), 0, -Math.sin(azimuth)];
  const axisV: Vec3 = [
    -Math.sin(azimuth) * Math.cos(tilt),
    Math.sin(tilt),
    -Math.cos(azimuth) * Math.cos(tilt),
  ];
  const normal: Vec3 = [
    Math.sin(azimuth) * Math.sin(tilt),
    Math.cos(tilt),
    Math.cos(azimuth) * Math.sin(tilt),
  ];
  const centreY = clearanceM + (
    dimensions.planeTrackingMode !== undefined && dimensions.planeTrackingMode !== "fixed"
      ? dimensions.trackingEnvelopeHeightM ?? dimensions.heightM
      : dimensions.heightM
  ) / 2;
  return [planarPatchZone({
      kind: "plane",
      index: 0,
      zoneAreaM2: geometry.activeAreaM2,
      centre: [0, centreY, 0],
      normal,
      axisU,
      axisV,
      widthM: dimensions.widthM,
      heightM: dimensions.planeSlantLengthM ?? 0,
      azimuthSamples,
      meridionalSegments,
    })];
}

function cubeZones(
  geometry: ComparisonGeometry,
  clearanceM: number,
  azimuthSamples: number,
  meridionalSegments: number,
): SurfaceZone[] {
  const sideM = geometry.dimensions.widthM;
  const half = sideM / 2;
  const centreY = clearanceM + half;
  const faces: { centre: Vec3; normal: Vec3; axisU: Vec3; axisV: Vec3 }[] = [
    { centre: [0, clearanceM + sideM, 0], normal: [0, 1, 0], axisU: [1, 0, 0], axisV: [0, 0, 1] },
    { centre: [half, centreY, 0], normal: [1, 0, 0], axisU: [0, 0, 1], axisV: [0, 1, 0] },
    { centre: [-half, centreY, 0], normal: [-1, 0, 0], axisU: [0, 0, -1], axisV: [0, 1, 0] },
    { centre: [0, centreY, half], normal: [0, 0, 1], axisU: [-1, 0, 0], axisV: [0, 1, 0] },
    { centre: [0, centreY, -half], normal: [0, 0, -1], axisU: [1, 0, 0], axisV: [0, 1, 0] },
  ];
  const zones: SurfaceZone[] = [];
  faces.forEach((face, index) => {
        zones.push(planarPatchZone({
          kind: "cube",
          index,
          zoneAreaM2: sideM * sideM,
          centre: face.centre,
          normal: face.normal,
          axisU: face.axisU,
          axisV: face.axisV,
          widthM: sideM,
          heightM: sideM,
          azimuthSamples,
          meridionalSegments,
          qMin: index / faces.length,
          qMax: (index + 1) / faces.length,
        }));
  });
  return zones;
}

function maximumProjectedArea(shape: ComparisonShapeKind, geometry: ComparisonGeometry): number {
  const dimensions = geometry.dimensions;
  const radiusM = dimensions.radiusM ?? 0;
  switch (shape) {
    case "plane": return geometry.activeAreaM2;
    case "cube": return dimensions.widthM ** 2 * Math.sqrt(3);
    case "sphere": return Math.PI * radiusM ** 2;
    case "hemisphere": return Math.PI * radiusM ** 2;
    case "cylinder": return Math.hypot(Math.PI * radiusM ** 2, 2 * radiusM * dimensions.heightM);
    case "cone": {
      return maximumConeProjectedArea({
        activeAreaM2: geometry.activeAreaM2,
        radiusM,
        heightM: dimensions.heightM,
        slantHeightM: dimensions.slantHeightM,
      });
    }
  }
}

export function createComparisonSurface(
  shape: ComparisonShapeKind,
  options: ComparisonSurfaceInput = {},
  azimuthSamplesInput?: number,
): ComparisonSurfaceModel {
  const normalized = normalizeInput({
    ...options,
    ...(azimuthSamplesInput === undefined ? {} : { azimuthSamples: azimuthSamplesInput }),
  });
  const comparison = calculateComparisonGeometryFromNormalized(shape, normalized);
  const azimuthSamples = normalized.azimuthSamples;
  const meridionalSegments = normalized.meridionalSegments;
  const radiusM = comparison.dimensions.radiusM;
  const trackingPlane = shape === "plane" && normalized.planeTrackingMode !== "fixed";
  const centreY = shape === "hemisphere"
    ? normalized.groundClearanceM
    : normalized.groundClearanceM + (
        trackingPlane
          ? comparison.dimensions.trackingEnvelopeHeightM ?? comparison.dimensions.heightM
          : comparison.dimensions.heightM
      ) / 2;
  const dimensions: ContinuousSurfaceDimensions = {
    kind: shape === "plane" || shape === "cube" ? "sphere" : shape,
    activeAreaM2: comparison.activeAreaM2,
    zoneAreaM2: comparison.activeAreaM2,
    radiusM: radiusM ?? 0,
    widthM: comparison.dimensions.widthM,
    depthM: comparison.dimensions.depthM,
    heightM: comparison.dimensions.heightM,
    slantHeightM: comparison.dimensions.slantHeightM,
    planeTrackingMode: comparison.dimensions.planeTrackingMode,
    trackingEnvelopeHeightM: comparison.dimensions.trackingEnvelopeHeightM,
    trackingEnvelopeRadiusM: comparison.dimensions.trackingEnvelopeRadiusM,
    footprintM2: comparison.landAreaM2,
    maximumProjectedAreaM2: maximumProjectedArea(shape, comparison),
    centreY,
    groundClearanceM: normalized.groundClearanceM,
    includesTopDisk: shape === "cylinder",
  };
  const zones = shape === "plane"
    ? planeZones(comparison, normalized.groundClearanceM, azimuthSamples, meridionalSegments)
    : shape === "cube"
      ? cubeZones(comparison, normalized.groundClearanceM, azimuthSamples, meridionalSegments)
      : shape === "cylinder"
        ? cylinderZones(dimensions, azimuthSamples, meridionalSegments)
        : analyticZones(shape, dimensions, azimuthSamples, meridionalSegments);
  return {
    kind: shape,
    surfaceCount: 1,
    continuousSkinId: `${shape}-continuous-skin`,
    dimensions: { ...dimensions, kind: shape },
    meridionalOrder: SURFACE_MERIDIONAL_ORDER,
    meridionalSegments,
    azimuthSamples,
    samplesPerAxis: azimuthSamples,
    zones,
    comparison,
  };
}
