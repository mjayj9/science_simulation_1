import { PANEL_AREA_M2, type PresetName, type Vec3 } from "./types";

export const ELECTRICAL_ZONE_COUNT = 20 as const;
export const TOTAL_ACTIVE_AREA_M2 = ELECTRICAL_ZONE_COUNT * PANEL_AREA_M2;
export const SURFACE_MERIDIONAL_ORDER = 2 as const;
export const DEFAULT_SURFACE_AZIMUTH_SAMPLES = 32 as const;
export const MIN_SURFACE_AZIMUTH_SAMPLES = 16 as const;
export const MAX_SURFACE_AZIMUTH_SAMPLES = 128 as const;

export type ContinuousSurfaceKind = Extract<PresetName, "sphere" | "cylinder" | "cone">;

export interface ContinuousSurfaceOptions {
  /** Cylinder h / (2r). The default is a balanced height-to-diameter ratio of 1. */
  cylinderAspectRatio?: number;
  /** Cone h / r. The default is 2. */
  coneAspectRatio?: number;
  /** Keeps the mathematical surface just above the visual ground plane. */
  groundClearanceM?: number;
}

export interface ContinuousSurfaceDimensions {
  kind: ContinuousSurfaceKind;
  activeAreaM2: number;
  zoneAreaM2: number;
  radiusM: number;
  heightM: number;
  slantHeightM?: number;
  footprintM2: number;
  maximumProjectedAreaM2: number;
  centreY: number;
}

export interface SurfacePoint {
  position: Vec3;
  normal: Vec3;
}

export interface SurfaceSample extends SurfacePoint {
  zoneId: string;
  zoneIndex: number;
  /** Area quadrature weight, not a render-triangle area. */
  areaM2: number;
  /** Normalized cumulative-area coordinate q in (0,1). */
  u: number;
  /** Normalized azimuth in (0,1). */
  v: number;
}

export interface SurfaceZone {
  id: string;
  index: number;
  areaM2: number;
  /** Half-open cumulative-area interval, except that the final zone includes q=1. */
  qMin: number;
  qMax: number;
  /** Diagnostic anchor only. Curved-surface optics must integrate the samples. */
  representativePosition: Vec3;
  /** Diagnostic anchor only. It is never a replacement for sample normals. */
  representativeNormal: Vec3;
  samples: SurfaceSample[];
}

export interface ContinuousSurfaceModel {
  kind: ContinuousSurfaceKind;
  dimensions: ContinuousSurfaceDimensions;
  meridionalOrder: typeof SURFACE_MERIDIONAL_ORDER;
  azimuthSamples: number;
  /** @deprecated Compatibility alias. This now means azimuthSamples, not a square grid. */
  samplesPerAxis: number;
  zones: SurfaceZone[];
}

const TWO_PI = 2 * Math.PI;
const GL2_ABSCISSA = 1 / Math.sqrt(3);
const MAXIMUM_SEARCH_SEGMENTS = 512;
const MAXIMUM_SEARCH_ITERATIONS = 80;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label}은(는) 0보다 큰 유한수여야 합니다.`);
  }
  return value;
}

function azimuthSampleCount(value: number): number {
  if (
    !Number.isInteger(value) ||
    value < MIN_SURFACE_AZIMUTH_SAMPLES ||
    value > MAX_SURFACE_AZIMUTH_SAMPLES
  ) {
    throw new RangeError(
      `곡면 방위 적분 표본 수는 ${MIN_SURFACE_AZIMUTH_SAMPLES}~${MAX_SURFACE_AZIMUTH_SAMPLES}의 정수여야 합니다.`,
    );
  }
  return value;
}

export function isContinuousSurfacePreset(
  preset: PresetName,
): preset is ContinuousSurfaceKind {
  return preset === "sphere" || preset === "cylinder" || preset === "cone";
}

function coneProjectedAreaFromComponents(
  dimensions: Pick<ContinuousSurfaceDimensions, "activeAreaM2" | "radiusM" | "heightM" | "slantHeightM">,
  horizontalComponent: number,
  verticalComponent: number,
): number {
  const slantHeightM = dimensions.slantHeightM ?? Math.hypot(dimensions.radiusM, dimensions.heightM);
  const horizontalTerm = dimensions.heightM / slantHeightM * Math.max(0, horizontalComponent);
  const verticalTerm = dimensions.radiusM / slantHeightM * verticalComponent;

  if (horizontalTerm <= 1e-15) {
    return verticalTerm > 0 ? dimensions.activeAreaM2 * verticalTerm : 0;
  }
  if (verticalTerm >= horizontalTerm) {
    return dimensions.activeAreaM2 * verticalTerm;
  }
  if (verticalTerm <= -horizontalTerm) return 0;

  const visibleHalfAngle = Math.acos(
    Math.min(1, Math.max(-1, -verticalTerm / horizontalTerm)),
  );
  return dimensions.activeAreaM2 / Math.PI * (
    horizontalTerm * Math.sin(visibleHalfAngle) +
    verticalTerm * visibleHalfAngle
  );
}

/** Exact one-sided lateral-cone projected area for a unit direction. */
export function coneProjectedAreaForDirection(
  dimensions: Pick<ContinuousSurfaceDimensions, "activeAreaM2" | "radiusM" | "heightM" | "slantHeightM">,
  direction: Vec3,
): number {
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (!(length > 0) || !Number.isFinite(length)) return 0;
  return coneProjectedAreaFromComponents(
    dimensions,
    Math.hypot(direction[0], direction[2]) / length,
    direction[1] / length,
  );
}

/**
 * Deterministic maximum of the analytic cone projection over solar elevation
 * 0..90 degrees. A coarse global bracket avoids assuming a particular aspect
 * ratio; golden-section refinement then converges inside the best bracket.
 */
export function maximumConeProjectedArea(
  dimensions: Pick<ContinuousSurfaceDimensions, "activeAreaM2" | "radiusM" | "heightM" | "slantHeightM">,
): number {
  const evaluate = (elevationRad: number): number => coneProjectedAreaFromComponents(
    dimensions,
    Math.cos(elevationRad),
    Math.sin(elevationRad),
  );
  const upper = Math.PI / 2;
  let bestIndex = 0;
  let best = evaluate(0);
  for (let index = 1; index <= MAXIMUM_SEARCH_SEGMENTS; index += 1) {
    const value = evaluate(upper * index / MAXIMUM_SEARCH_SEGMENTS);
    if (value > best) {
      best = value;
      bestIndex = index;
    }
  }

  let left = upper * Math.max(0, bestIndex - 1) / MAXIMUM_SEARCH_SEGMENTS;
  let right = upper * Math.min(MAXIMUM_SEARCH_SEGMENTS, bestIndex + 1) / MAXIMUM_SEARCH_SEGMENTS;
  const ratio = (Math.sqrt(5) - 1) / 2;
  let first = right - ratio * (right - left);
  let second = left + ratio * (right - left);
  let firstValue = evaluate(first);
  let secondValue = evaluate(second);
  for (let iteration = 0; iteration < MAXIMUM_SEARCH_ITERATIONS; iteration += 1) {
    if (firstValue > secondValue) {
      right = second;
      second = first;
      secondValue = firstValue;
      first = right - ratio * (right - left);
      firstValue = evaluate(first);
    } else {
      left = first;
      first = second;
      firstValue = secondValue;
      second = left + ratio * (right - left);
      secondValue = evaluate(second);
    }
  }
  return Math.max(best, evaluate(0), evaluate(upper), evaluate((left + right) / 2));
}

/**
 * Exact dimensions under the common active-area contract.
 *
 * Sphere: A = 4 pi r^2
 * Cylinder side: A = 2 pi r h, h = 2 r k
 * Cone side: A = pi r l, l = sqrt(r^2 + h^2), h = k r
 */
export function continuousSurfaceDimensions(
  kind: ContinuousSurfaceKind,
  options: ContinuousSurfaceOptions = {},
): ContinuousSurfaceDimensions {
  const clearance = Math.max(0, options.groundClearanceM ?? 0.003);
  if (kind === "sphere") {
    const radiusM = Math.sqrt(TOTAL_ACTIVE_AREA_M2 / (4 * Math.PI));
    return {
      kind,
      activeAreaM2: TOTAL_ACTIVE_AREA_M2,
      zoneAreaM2: PANEL_AREA_M2,
      radiusM,
      heightM: 2 * radiusM,
      footprintM2: Math.PI * radiusM * radiusM,
      maximumProjectedAreaM2: TOTAL_ACTIVE_AREA_M2 / 4,
      centreY: clearance + radiusM,
    };
  }

  if (kind === "cylinder") {
    const aspect = positiveFinite(options.cylinderAspectRatio ?? 1, "원기둥 세로비 h/(2r)");
    const radiusM = Math.sqrt(TOTAL_ACTIVE_AREA_M2 / (4 * Math.PI * aspect));
    const heightM = 2 * radiusM * aspect;
    return {
      kind,
      activeAreaM2: TOTAL_ACTIVE_AREA_M2,
      zoneAreaM2: PANEL_AREA_M2,
      radiusM,
      heightM,
      footprintM2: Math.PI * radiusM * radiusM,
      maximumProjectedAreaM2: 2 * radiusM * heightM,
      centreY: clearance + heightM / 2,
    };
  }

  const aspect = positiveFinite(options.coneAspectRatio ?? 2, "원뿔 세로비 h/r");
  const slantRatio = Math.sqrt(1 + aspect * aspect);
  const radiusM = Math.sqrt(TOTAL_ACTIVE_AREA_M2 / (Math.PI * slantRatio));
  const heightM = aspect * radiusM;
  const slantHeightM = radiusM * slantRatio;
  const base = {
    kind,
    activeAreaM2: TOTAL_ACTIVE_AREA_M2,
    zoneAreaM2: PANEL_AREA_M2,
    radiusM,
    heightM,
    slantHeightM,
    footprintM2: Math.PI * radiusM * radiusM,
    centreY: clearance + heightM / 2,
  };
  return {
    ...base,
    maximumProjectedAreaM2: maximumConeProjectedArea(base),
  };
}

/**
 * Maps the common cumulative-area coordinate q and normalized azimuth v to an
 * analytic point and normal. All three shapes satisfy dA=A/(2pi)dq dphi.
 */
export function pointOnContinuousSurface(
  kind: ContinuousSurfaceKind,
  dimensions: ContinuousSurfaceDimensions,
  qInput: number,
  vInput: number,
): SurfacePoint {
  const q = clamp01(qInput);
  const v = ((vInput % 1) + 1) % 1;
  const azimuthRad = TWO_PI * v;
  const sine = Math.sin(azimuthRad);
  const cosine = Math.cos(azimuthRad);

  if (kind === "sphere") {
    const equalAreaY = 2 * q - 1;
    const radial = Math.sqrt(Math.max(0, 1 - equalAreaY * equalAreaY));
    const normal: Vec3 = [radial * sine, equalAreaY, radial * cosine];
    return {
      position: [
        dimensions.radiusM * normal[0],
        dimensions.centreY + dimensions.radiusM * normal[1],
        dimensions.radiusM * normal[2],
      ],
      normal,
    };
  }

  if (kind === "cylinder") {
    const normal: Vec3 = [sine, 0, cosine];
    return {
      position: [
        dimensions.radiusM * normal[0],
        dimensions.centreY + (q - 0.5) * dimensions.heightM,
        dimensions.radiusM * normal[2],
      ],
      normal,
    };
  }

  // Lateral-cone cumulative area grows with slant fraction squared.
  const slantFraction = Math.sqrt(q);
  const radial = dimensions.radiusM * slantFraction;
  const slantHeightM = dimensions.slantHeightM ?? Math.hypot(dimensions.radiusM, dimensions.heightM);
  return {
    position: [
      radial * sine,
      dimensions.centreY + dimensions.heightM / 2 - dimensions.heightM * slantFraction,
      radial * cosine,
    ],
    normal: [
      dimensions.heightM * sine / slantHeightM,
      dimensions.radiusM / slantHeightM,
      dimensions.heightM * cosine / slantHeightM,
    ],
  };
}

function createZone(
  kind: ContinuousSurfaceKind,
  dimensions: ContinuousSurfaceDimensions,
  index: number,
  azimuthSamples: number,
): SurfaceZone {
  const qMin = index / ELECTRICAL_ZONE_COUNT;
  const qMax = (index + 1) / ELECTRICAL_ZONE_COUNT;
  const qMidpoint = (qMin + qMax) / 2;
  const qHalfWidth = (qMax - qMin) / 2;
  const zoneId = `${kind}-zone-${index + 1}`;
  const sampleAreaM2 = PANEL_AREA_M2 / (SURFACE_MERIDIONAL_ORDER * azimuthSamples);
  const samples: SurfaceSample[] = [];

  for (const abscissa of [-GL2_ABSCISSA, GL2_ABSCISSA]) {
    const q = qMidpoint + qHalfWidth * abscissa;
    for (let azimuthIndex = 0; azimuthIndex < azimuthSamples; azimuthIndex += 1) {
      const v = (azimuthIndex + 0.5) / azimuthSamples;
      const point = pointOnContinuousSurface(kind, dimensions, q, v);
      samples.push({
        ...point,
        zoneId,
        zoneIndex: index,
        areaM2: sampleAreaM2,
        u: q,
        v,
      });
    }
  }

  const representative = pointOnContinuousSurface(kind, dimensions, qMidpoint, 0);
  return {
    id: zoneId,
    index,
    areaM2: PANEL_AREA_M2,
    qMin,
    qMax,
    representativePosition: representative.position,
    representativeNormal: representative.normal,
    samples,
  };
}

/**
 * Creates 20 full-azimuth, exactly equal-area electrical bands. GL2 is used in
 * each q interval and periodic midpoint quadrature is used in azimuth. Physics
 * samples are independent of render tessellation.
 */
export function createContinuousSurface(
  kind: ContinuousSurfaceKind,
  azimuthSamplesInput: number = DEFAULT_SURFACE_AZIMUTH_SAMPLES,
  options: ContinuousSurfaceOptions = {},
): ContinuousSurfaceModel {
  const azimuthSamples = azimuthSampleCount(azimuthSamplesInput);
  const dimensions = continuousSurfaceDimensions(kind, options);
  const zones = Array.from(
    { length: ELECTRICAL_ZONE_COUNT },
    (_, index) => createZone(kind, dimensions, index, azimuthSamples),
  );
  return {
    kind,
    dimensions,
    meridionalOrder: SURFACE_MERIDIONAL_ORDER,
    azimuthSamples,
    samplesPerAxis: azimuthSamples,
    zones,
  };
}

export function surfaceSamples(model: ContinuousSurfaceModel): SurfaceSample[] {
  return model.zones.flatMap((zone) => zone.samples);
}

/** Exact axisymmetric projected area; independent of the finite physics lattice. */
export function projectedAreaForDirection(
  model: ContinuousSurfaceModel,
  direction: Vec3,
): number {
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (!(length > 0) || !Number.isFinite(length)) return 0;
  const horizontal = Math.hypot(direction[0], direction[2]) / length;
  if (model.kind === "sphere") return model.dimensions.activeAreaM2 / 4;
  if (model.kind === "cylinder") {
    return 2 * model.dimensions.radiusM * model.dimensions.heightM * horizontal;
  }
  return coneProjectedAreaForDirection(model.dimensions, direction);
}

export function rotateSurfaceSampleAroundY(sample: SurfaceSample, angleRad: number): SurfaceSample {
  if (!Number.isFinite(angleRad)) throw new RangeError("곡면 회전각은 유한수여야 합니다.");
  const cosine = Math.cos(angleRad);
  const sine = Math.sin(angleRad);
  const rotate = ([x, y, z]: Vec3): Vec3 => [cosine * x + sine * z, y, -sine * x + cosine * z];
  return {
    ...sample,
    position: rotate(sample.position),
    normal: rotate(sample.normal),
  };
}
