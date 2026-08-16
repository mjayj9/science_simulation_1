"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  ACESFilmicToneMapping,
  ArrowHelper,
  Box3,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DodecahedronGeometry,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  FogExp2,
  GridHelper,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineLoop,
  LineSegments,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  Raycaster,
  RingGeometry,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Uint16BufferAttribute,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import {
  createContinuousSurface,
  continuousSurfaceDimensions,
  pointOnContinuousSurface as geometryPointOnContinuousSurface,
  type ContinuousSurfaceDimensions,
  type ContinuousSurfaceKind,
  type IdealSurfaceKind,
  type IdealSurfaceModel,
  type SurfaceModelDimensions,
  type SurfaceZone,
} from "../lib/geometry/continuous-surfaces";
import type {
  ComparisonGeometry,
  ComparisonShapeKind,
} from "../lib/geometry/comparison-surfaces";

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
  /** Authoritative comparison model; regions are numerical integration groups, not panels. */
  idealSurfaceModel?: IdealSurfaceModel | null;
  showZoneBoundaries?: boolean;
  showSurfaceSamples?: boolean;
  /** Synchronized camera preset used by side-by-side footprint comparison. */
  cameraView?: "perspective" | "top";
  /** Horizontal land allocation shown as a translucent parcel. */
  parcelAreaM2?: number;
  /** Parcel width/depth ratio. Defaults to a square parcel. */
  parcelAspectRatio?: number;
  /** Authoritative parcel outline. Rectangle remains the legacy fallback. */
  parcelShape?: "rectangle" | "circle";
  parcelWidthM?: number;
  parcelDepthM?: number;
  parcelRotationRad?: number;
  showParcelBoundary?: boolean;
  /** Optional authoritative swept footprint. Falls back to the rendered geometry. */
  sweptFootprintM2?: number;
  showSweptFootprint?: boolean;
  /** Target world-space ground clearance; authoritative models may already embed it. */
  supportHeightM?: number;
  /** Optional structural envelope height, visualized without distorting the PV surface. */
  structureHeightM?: number;
  showHeightGuide?: boolean;
  gltfUrl?: string | null;
  quality?: "fast" | "balanced" | "precise";
}

const PANEL_SIZE = 0.05;
const PANEL_DEPTH = 0.0022;
const TWO_PI = 2 * Math.PI;

interface ContinuousSurfaceHitData {
  kind: IdealSurfaceKind;
  dimensions: SurfaceModelDimensions;
  panelIds: string[];
  qRanges: Array<{ qMin: number; qMax: number }>;
}

export interface SurfacePoint {
  position: Vec3Tuple;
  normal: Vec3Tuple;
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
  // A_land is always the instantaneous/static vertical projection. Rotation's
  // swept disk is rendered by the separate amber overlay; using it here would
  // replace the green A_land parcel and draw the same swept area twice.
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

export function continuousRenderFootprintAreaM2(dimensions: ContinuousSurfaceDimensions) {
  return Math.PI * dimensions.radiusM * dimensions.radiusM;
}

export function rigidSweptFootprintAreaM2(panels: readonly ScenePanel[]) {
  let radiusM = 0;
  const halfSize = PANEL_SIZE / 2;
  const halfDepth = PANEL_DEPTH / 2;
  panels.forEach((panel) => {
    const quaternion = new Quaternion(...panel.quaternion).normalize();
    for (const x of [-halfSize, halfSize]) {
      for (const y of [-halfSize, halfSize]) {
        for (const z of [-halfDepth, halfDepth]) {
          const corner = new Vector3(x, y, z)
            .applyQuaternion(quaternion)
            .add(new Vector3(...panel.position));
          radiusM = Math.max(radiusM, Math.hypot(corner.x, corner.z));
        }
      }
    }
  });
  return Math.PI * radiusM * radiusM;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function isCurvedSurfaceKind(kind: IdealSurfaceKind): kind is ContinuousSurfaceKind {
  return kind === "sphere" || kind === "hemisphere" || kind === "cylinder" || kind === "cone";
}

/** q is the normalized equal-area coordinate and v is normalized azimuth. */
export function pointOnContinuousSurface(
  kind: ContinuousSurfaceKind,
  dimensions: ContinuousSurfaceDimensions,
  q: number,
  v: number,
): SurfacePoint {
  const point = geometryPointOnContinuousSurface(kind, dimensions, q, v);
  return {
    position: [...point.position],
    normal: [...point.normal],
  };
}

export function pointOnSurfaceModel(
  model: IdealSurfaceModel,
  qInput: number,
  v: number,
  cylinderRegion?: "top" | "lateral",
): SurfacePoint {
  if (model.kind !== "cylinder" || !model.dimensions.includesTopDisk) {
    return pointOnContinuousSurface(
      model.kind as ContinuousSurfaceKind,
      model.dimensions as ContinuousSurfaceDimensions,
      qInput,
      v,
    );
  }
  const dimensions = model.dimensions as ContinuousSurfaceDimensions;
  const topAreaM2 = Math.PI * dimensions.radiusM ** 2;
  const topFraction = topAreaM2 / dimensions.activeAreaM2;
  const q = clamp01(qInput);
  const angle = TWO_PI * v;
  const sine = Math.sin(angle);
  const cosine = Math.cos(angle);
  const region = cylinderRegion ?? (q < topFraction ? "top" : "lateral");
  if (region === "top") {
    const radialFraction = Math.sqrt(clamp01(q / topFraction));
    return {
      position: [
        dimensions.radiusM * radialFraction * sine,
        dimensions.centreY + dimensions.heightM / 2,
        dimensions.radiusM * radialFraction * cosine,
      ],
      normal: [0, 1, 0],
    };
  }
  const lateralQ = clamp01((q - topFraction) / (1 - topFraction));
  return {
    position: [
      dimensions.radiusM * sine,
      dimensions.centreY + (lateralQ - 0.5) * dimensions.heightM,
      dimensions.radiusM * cosine,
    ],
    normal: [sine, 0, cosine],
  };
}

function panelForZone(panels: ScenePanel[], model: IdealSurfaceModel, zoneIndex: number) {
  const zone = model.zones[zoneIndex];
  return panels.find((panel) => panel.id === zone?.id) ?? panels[zoneIndex];
}

function selectedZoneIndex(
  panels: ScenePanel[],
  model: IdealSurfaceModel,
  selectedPanelId: string | null,
) {
  if (!selectedPanelId) return -1;
  const modelIndex = model.zones.findIndex((zone) => zone.id === selectedPanelId);
  if (modelIndex >= 0) return modelIndex;
  const panelIndex = panels.findIndex((panel) => panel.id === selectedPanelId);
  return panelIndex >= 0 && panelIndex < model.zones.length ? panelIndex : -1;
}

function zoneIndexAtSurfacePoint(
  data: ContinuousSurfaceHitData,
  point: Vector3,
) {
  if (data.kind === "plane" || data.kind === "cube") return 0;
  const radiusM = data.dimensions.radiusM ?? 1;
  let q = 0;
  if (data.kind === "hemisphere") {
    q = (point.y - data.dimensions.centreY) / radiusM;
  } else if (data.kind === "sphere") {
    const equalAreaY = (point.y - data.dimensions.centreY) / radiusM;
    q = (equalAreaY + 1) / 2;
  } else if (data.kind === "cylinder") {
    q = (point.y - (data.dimensions.centreY - data.dimensions.heightM / 2))
      / data.dimensions.heightM;
  } else {
    const radialFraction = Math.hypot(point.x, point.z) / radiusM;
    q = radialFraction * radialFraction;
  }
  const azimuth = (Math.atan2(point.x, point.z) + TWO_PI) % TWO_PI;
  void azimuth;
  const clampedQ = clamp01(q);
  const match = data.qRanges.findIndex(({ qMin, qMax }, index) => (
    clampedQ >= qMin - 1e-12
    && (clampedQ < qMax - 1e-12 || (index === data.qRanges.length - 1 && clampedQ <= qMax + 1e-12))
  ));
  return match >= 0 ? match : 0;
}

function colorForIrradiance(value = 0) {
  const t = MathUtils.clamp(value / 1000, 0, 1);
  const low = new Color("#17334a");
  const high = new Color("#f7bb38");
  return low.lerp(high, Math.pow(t, 0.72));
}

function colorForSurfaceZone(panel: ScenePanel | undefined, selected: boolean) {
  const color = colorForIrradiance(panel?.irradianceWm2);
  if (panel?.bypassActive) color.lerp(new Color("#d9683b"), 0.58);
  if (selected) color.lerp(new Color("#fff0a6"), 0.52);
  return color;
}

function pushSurfaceTriangle(
  positions: number[],
  normals: number[],
  colors: number[],
  zoneIndices: number[],
  a: SurfacePoint,
  b: SurfacePoint,
  c: SurfacePoint,
  color: Color,
  zoneIndex: number,
) {
  for (const point of [a, b, c]) {
    positions.push(...point.position);
    normals.push(...point.normal);
    colors.push(color.r, color.g, color.b);
    zoneIndices.push(zoneIndex);
  }
}

export interface PlanarZonePatch {
  corners: [SurfacePoint, SurfacePoint, SurfacePoint, SurfacePoint];
}

export function planarZonePatch(zone: SurfaceZone): PlanarZonePatch {
  const normal = new Vector3(...zone.representativeNormal).normalize();
  const averages = new Map<number, { position: Vector3; count: number }>();
  zone.samples.forEach((sample) => {
    const current = averages.get(sample.v) ?? { position: new Vector3(), count: 0 };
    current.position.add(new Vector3(...sample.position));
    current.count += 1;
    averages.set(sample.v, current);
  });
  const columns = [...averages.entries()]
    .map(([v, value]) => ({ v, position: value.position.multiplyScalar(1 / value.count) }))
    .sort((left, right) => left.v - right.v);
  let axisU: Vector3;
  let widthM: number;
  if (columns.length >= 2 && columns.at(-1)!.v > columns[0].v) {
    const span = columns.at(-1)!.position.clone().sub(columns[0].position);
    widthM = span.length() / (columns.at(-1)!.v - columns[0].v);
    axisU = span.normalize();
  } else {
    axisU = Math.abs(normal.y) < 0.9
      ? new Vector3(0, 1, 0).cross(normal).normalize()
      : new Vector3(1, 0, 0);
    widthM = Math.sqrt(zone.areaM2);
  }
  const heightM = zone.areaM2 / Math.max(widthM, 1e-12);
  const axisV = normal.clone().cross(axisU).normalize();
  const centre = new Vector3(...zone.representativePosition);
  const point = (u: number, v: number): SurfacePoint => ({
    position: centre.clone().addScaledVector(axisU, u).addScaledVector(axisV, v).toArray() as Vec3Tuple,
    normal: normal.toArray() as Vec3Tuple,
  });
  return {
    corners: [
      point(-widthM / 2, -heightM / 2),
      point(widthM / 2, -heightM / 2),
      point(widthM / 2, heightM / 2),
      point(-widthM / 2, heightM / 2),
    ],
  };
}

function createContinuousSurfaceGeometry(
  model: IdealSurfaceModel,
  dimensions: SurfaceModelDimensions,
  panels: ScenePanel[],
  selectedPanelId: string | null,
  quality: "fast" | "balanced" | "precise",
) {
  const qSegments = quality === "precise" ? 64 : quality === "balanced" ? 32 : 16;
  const vSegments = quality === "precise" ? 96 : quality === "balanced" ? 64 : 32;
  const selectedIndex = selectedZoneIndex(panels, model, selectedPanelId);
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const zoneIndices: number[] = [];

  if (model.kind === "plane" || model.kind === "cube") {
    model.zones.forEach((zone, zoneIndex) => {
      const color = colorForSurfaceZone(
        panelForZone(panels, model, zoneIndex),
        zoneIndex === selectedIndex,
      );
      const [p00, p10, p11, p01] = planarZonePatch(zone).corners;
      pushSurfaceTriangle(positions, normals, colors, zoneIndices, p00, p10, p11, color, zoneIndex);
      pushSurfaceTriangle(positions, normals, colors, zoneIndices, p00, p11, p01, color, zoneIndex);
    });
  } else {
    const renderRegion = (
      qStart: number,
      qEnd: number,
      rowCount: number,
      cylinderRegion?: "top" | "lateral",
    ) => {
      for (let row = 0; row < rowCount; row += 1) {
        const q0 = qStart + (qEnd - qStart) * row / rowCount;
        const q1 = qStart + (qEnd - qStart) * (row + 1) / rowCount;
        const qMid = (q0 + q1) / 2;
        const zoneIndex = Math.max(0, model.zones.findIndex((zone, zoneIndex) => (
          qMid >= zone.qMin - 1e-12
          && (qMid < zone.qMax - 1e-12 || zoneIndex === model.zones.length - 1)
        )));
        for (let column = 0; column < vSegments; column += 1) {
          const v0 = column / vSegments;
          const v1 = (column + 1) / vSegments;
          const color = colorForSurfaceZone(
            panelForZone(panels, model, zoneIndex),
            zoneIndex === selectedIndex,
          );
          if (model.kind === "cylinder" && dimensions.includesTopDisk) {
            color.lerp(new Color(cylinderRegion === "top" ? "#f0b84c" : "#34b998"), 0.18);
          }
          const p00 = pointOnSurfaceModel(model, q0, v0, cylinderRegion);
          const p01 = pointOnSurfaceModel(model, q0, v1, cylinderRegion);
          const p10 = pointOnSurfaceModel(model, q1, v0, cylinderRegion);
          const p11 = pointOnSurfaceModel(model, q1, v1, cylinderRegion);
          const reverseWinding = model.kind === "cone" || cylinderRegion === "top";
          if (reverseWinding) {
            pushSurfaceTriangle(positions, normals, colors, zoneIndices, p00, p10, p11, color, zoneIndex);
            pushSurfaceTriangle(positions, normals, colors, zoneIndices, p00, p11, p01, color, zoneIndex);
          } else {
            pushSurfaceTriangle(positions, normals, colors, zoneIndices, p00, p01, p11, color, zoneIndex);
            pushSurfaceTriangle(positions, normals, colors, zoneIndices, p00, p11, p10, color, zoneIndex);
          }
        }
      }
    };
    if (model.kind === "cylinder" && dimensions.includesTopDisk) {
      const radiusM = dimensions.radiusM ?? 0;
      const topFraction = Math.PI * radiusM ** 2 / dimensions.activeAreaM2;
      renderRegion(0, topFraction, Math.max(1, Math.ceil(qSegments * topFraction)), "top");
      renderRegion(topFraction, 1, Math.max(1, Math.ceil(qSegments * (1 - topFraction))), "lateral");
    } else {
      renderRegion(0, 1, qSegments);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setAttribute("zoneIndex", new Uint16BufferAttribute(zoneIndices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function offsetSurfacePoint(point: SurfacePoint, distance = 0.00045) {
  return new Vector3(...point.position).addScaledVector(
    new Vector3(...point.normal),
    distance,
  );
}

function createZoneBoundaryGroup(model: IdealSurfaceModel) {
  const group = new Group();
  group.name = `${model.kind}-integration-region-boundaries`;
  const material = new LineBasicMaterial({
    color: "#9de7d7",
    transparent: true,
    opacity: 0.76,
    depthWrite: false,
  });
  if (model.kind === "plane" || model.kind === "cube") {
    model.zones.forEach((zone) => {
      const points = planarZonePatch(zone).corners.map((point) => offsetSurfacePoint(point));
      const line = new LineLoop(new BufferGeometry().setFromPoints(points), material);
      line.raycast = () => {};
      group.add(line);
    });
    return group;
  }
  if (!isCurvedSurfaceKind(model.kind)) return group;
  const azimuthSegments = 128;
  const boundaries = [...new Set(model.zones.flatMap((zone) => [zone.qMin, zone.qMax]))]
    .sort((left, right) => left - right);

  for (const q of boundaries) {
    const points = Array.from({ length: azimuthSegments }, (_, index) =>
      offsetSurfacePoint(pointOnSurfaceModel(model, q, index / azimuthSegments))
    );
    const radius = Math.max(...points.map((point) => Math.hypot(point.x, point.z)));
    if (radius < 0.0001) continue;
    const line = new LineLoop(new BufferGeometry().setFromPoints(points), material);
    line.raycast = () => {};
    group.add(line);
  }

  return group;
}

function addSunRay(
  group: Group,
  origin: Vector3,
  sunDirection: Vector3,
  length = 0.22,
  opacity = 0.45,
) {
  const start = origin.clone().addScaledVector(sunDirection, length);
  const geometry = new BufferGeometry().setFromPoints([start, origin]);
  const line = new Line(
    geometry,
    new LineDashedMaterial({
      color: "#ffd76a",
      dashSize: 0.012,
      gapSize: 0.008,
      opacity,
      transparent: true,
    }),
  );
  line.computeLineDistances();
  group.add(line);
}

function addAoiArc(
  group: Group,
  origin: Vector3,
  normal: Vector3,
  sunDirection: Vector3,
) {
  const cosine = MathUtils.clamp(normal.dot(sunDirection), -1, 1);
  const angle = Math.acos(cosine);
  if (angle < 1e-4) return;
  const tangent = sunDirection.clone().addScaledVector(normal, -cosine);
  if (tangent.lengthSq() < 1e-12) {
    tangent.copy(Math.abs(normal.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0));
    tangent.addScaledVector(normal, -tangent.dot(normal));
  }
  tangent.normalize();
  const segments = Math.max(12, Math.ceil(32 * angle / Math.PI));
  const radius = 0.026;
  const points = Array.from({ length: segments + 1 }, (_, index) => {
    const theta = angle * index / segments;
    return origin.clone()
      .addScaledVector(normal, radius * Math.cos(theta))
      .addScaledVector(tangent, radius * Math.sin(theta));
  });
  const arc = new Line(
    new BufferGeometry().setFromPoints(points),
    new LineBasicMaterial({ color: "#ff8fc7", depthTest: false }),
  );
  arc.renderOrder = 5;
  group.add(arc);
}

function obstacleGeometry(type: SceneObstacle["type"]): BufferGeometry {
  switch (type) {
    case "mountain":
      return new ConeGeometry(0.09, 0.18, 9);
    case "tree":
      return new ConeGeometry(0.045, 0.12, 10);
    case "wall":
      return new BoxGeometry(0.16, 0.09, 0.012);
    case "ground":
    case "water":
      return new BoxGeometry(0.22, 0.006, 0.22);
    case "other":
      return new DodecahedronGeometry(0.065, 0);
    default:
      return new BoxGeometry(0.1, 0.13, 0.09);
  }
}

function obstacleColor(item: SceneObstacle) {
  if (item.color) return item.color;
  return {
    mountain: "#596750",
    building: "#46556b",
    tree: "#2f7455",
    wall: "#6f6257",
    ground: "#50594d",
    water: "#1f7188",
    other: "#795f86",
  }[item.type];
}

function disposeObject3D(root: Object3D) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  root.traverse((object) => {
    if (!(object instanceof Mesh || object instanceof Line || object instanceof Points)) return;
    geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    objectMaterials.forEach((material) => materials.add(material));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

function clearAndDispose(group: Group) {
  group.children.forEach((child) => disposeObject3D(child));
  group.clear();
}

function rotateAroundY([x, y, z]: Vec3Tuple, angleRad: number): Vec3Tuple {
  const cosine = Math.cos(angleRad);
  const sine = Math.sin(angleRad);
  return [cosine * x + sine * z, y, -sine * x + cosine * z];
}

export function cameraPoseForView(
  view: "perspective" | "top",
  distance: number,
  target: Vec3Tuple = [0, 0.075, 0],
) {
  const safeDistance = Number.isFinite(distance) ? Math.max(0.16, distance) : 0.72;
  if (view === "top") {
    return {
      position: [target[0], target[1] + safeDistance, target[2] + 1e-6] as Vec3Tuple,
      up: [0, 0, -1] as Vec3Tuple,
      target,
    };
  }
  const direction = new Vector3(0.48, 0.36, 0.56).normalize().multiplyScalar(safeDistance);
  return {
    position: [target[0] + direction.x, target[1] + direction.y, target[2] + direction.z] as Vec3Tuple,
    up: [0, 1, 0] as Vec3Tuple,
    target,
  };
}

export interface SurfacePlacement {
  /** Extra scene transform after accounting for clearance already in sample coordinates. */
  translationY: number;
  /** Final world-space clearance at the bottom of the PV skin. */
  groundClearanceM: number;
  /** Requested support visualization height (zero hides the support). */
  displayedSupportHeightM: number;
}

/**
 * Surface samples are authoritative world coordinates. Comparison geometry
 * embeds groundClearanceM, so a matching UI support value must not lift them a
 * second time. A larger requested value contributes only the missing delta.
 */
export function resolveSurfacePlacement(
  dimensions: Pick<SurfaceModelDimensions, "groundClearanceM"> | null | undefined,
  requestedSupportHeightM: number,
): SurfacePlacement {
  const requested = Number.isFinite(requestedSupportHeightM)
    ? Math.max(0, requestedSupportHeightM)
    : 0;
  const embedded = Number.isFinite(dimensions?.groundClearanceM)
    ? Math.max(0, dimensions?.groundClearanceM ?? 0)
    : 0;
  const groundClearanceM = Math.max(embedded, requested);
  return {
    translationY: groundClearanceM - embedded,
    groundClearanceM,
    displayedSupportHeightM: requested > 0 ? groundClearanceM : 0,
  };
}

export function ThreeWorkspace({
  panels,
  obstacles,
  selectedPanelId,
  selectedObstacleId = null,
  onSelectPanel,
  onSelectObstacle,
  onPanelTransform,
  onObstacleTransform,
  transformMode,
  gridSnap,
  surfaceSnap,
  showNormals,
  showRays,
  sunVector,
  sunElevationDeg,
  rotationAngleRad,
  continuousSurface = null,
  idealSurfaceModel = null,
  showZoneBoundaries = false,
  showSurfaceSamples = false,
  cameraView = "perspective",
  parcelAreaM2,
  parcelAspectRatio = 1,
  parcelShape = "rectangle",
  parcelWidthM,
  parcelDepthM,
  parcelRotationRad = 0,
  showParcelBoundary = true,
  sweptFootprintM2,
  showSweptFootprint = false,
  supportHeightM = 0,
  structureHeightM,
  showHeightGuide = false,
  gltfUrl,
  quality = "balanced",
}: ThreeWorkspaceProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    scene: Scene;
    camera: PerspectiveCamera;
    renderer: WebGLRenderer;
    orbit: OrbitControls;
    transform: TransformControls;
    panelGroup: Group;
    obstacleGroup: Group;
    helperGroup: Group;
    rayGroup: Group;
    siteOverlayGroup: Group;
    supportGroup: Group;
    importedGroup: Group;
    sunLight: DirectionalLight;
    sunOrb: Mesh;
    meshById: Map<string, Mesh>;
    obstacleMeshById: Map<string, Mesh>;
    raf: number;
    resizeObserver: ResizeObserver;
  } | null>(null);
  const callbacksRef = useRef({ onSelectPanel, onSelectObstacle, onPanelTransform, onObstacleTransform });
  const surfaceSnapRef = useRef(surfaceSnap);
  useEffect(() => {
    callbacksRef.current = { onSelectPanel, onSelectObstacle, onPanelTransform, onObstacleTransform };
  }, [onSelectPanel, onSelectObstacle, onPanelTransform, onObstacleTransform]);
  useEffect(() => {
    surfaceSnapRef.current = surfaceSnap;
  }, [surfaceSnap]);

  const [sunX, sunY, sunZ] = sunVector;
  const normalizedSun = useMemo(() => {
    const v = new Vector3(sunX, sunY, sunZ);
    return v.lengthSq() > 0 ? v.normalize() : new Vector3(0, 1, 0);
  }, [sunX, sunY, sunZ]);
  const continuousKind = continuousSurface?.kind;
  const cylinderAspectRatio = continuousSurface?.cylinderAspectRatio;
  const coneAspectRatio = continuousSurface?.coneAspectRatio;
  const suppliedSurfaceModel = idealSurfaceModel ?? continuousSurface?.model ?? null;
  const suppliedSurfaceKey = suppliedSurfaceModel
    ? [
        suppliedSurfaceModel.kind,
        suppliedSurfaceModel.dimensions.activeAreaM2,
        suppliedSurfaceModel.dimensions.heightM,
        suppliedSurfaceModel.dimensions.footprintM2,
        suppliedSurfaceModel.dimensions.radiusM ?? "",
        suppliedSurfaceModel.dimensions.widthM ?? "",
        suppliedSurfaceModel.dimensions.depthM ?? "",
        ...suppliedSurfaceModel.zones.flatMap((zone) => [
          zone.id,
          ...zone.representativePosition,
          ...zone.representativeNormal,
          zone.areaM2,
          zone.samples.length,
        ]),
      ].join(":")
    : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableSuppliedSurfaceModel = useMemo(() => suppliedSurfaceModel, [suppliedSurfaceKey]);
  const continuousSurfaceState = useMemo(() => {
    if (stableSuppliedSurfaceModel) {
      return {
        model: stableSuppliedSurfaceModel,
        dimensions: stableSuppliedSurfaceModel.dimensions,
      };
    }
    if (!continuousKind || !isCurvedSurfaceKind(continuousKind)) return null;
    const options = {
      ...(cylinderAspectRatio !== undefined
        ? { cylinderAspectRatio }
        : {}),
      ...(coneAspectRatio !== undefined
        ? { coneAspectRatio }
        : {}),
    };
    const samplesPerAxis = quality === "precise" ? 64 : quality === "balanced" ? 32 : 16;
    return {
      model: createContinuousSurface(continuousKind, samplesPerAxis, options),
      dimensions: continuousSurfaceDimensions(continuousKind, options),
    };
  }, [continuousKind, cylinderAspectRatio, coneAspectRatio, quality, stableSuppliedSurfaceModel]);
  const panelRenderKey = panels.map((panel) => [
    panel.id,
    ...panel.position,
    ...panel.quaternion,
    panel.irradianceWm2 ?? 0,
    panel.bypassActive ? 1 : 0,
  ].join(":" )).join("|");
  const obstacleRenderKey = obstacles.map((obstacle) => [
    obstacle.id,
    obstacle.type,
    obstacle.label,
    ...obstacle.position,
    ...(obstacle.rotation ?? [0, 0, 0]),
    ...obstacle.scale,
    obstacle.color ?? "",
  ].join(":" )).join("|");
  // The scalar signatures intentionally stabilize semantically identical arrays supplied by the parent.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stablePanels = useMemo(() => panels, [panelRenderKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableObstacles = useMemo(() => obstacles, [obstacleRenderKey]);
  const renderedSweptFootprintM2 = useMemo(
    () => continuousSurfaceState
      ? continuousSurfaceState.dimensions.footprintM2
      : rigidSweptFootprintAreaM2(stablePanels),
    [continuousSurfaceState, stablePanels],
  );
  const displayedSweptFootprintM2 = Number.isFinite(sweptFootprintM2)
    ? Math.max(0, sweptFootprintM2 ?? 0)
    : renderedSweptFootprintM2;
  const surfacePlacement = resolveSurfacePlacement(
    continuousSurfaceState?.dimensions,
    supportHeightM,
  );
  const assemblyLiftM = surfacePlacement.translationY;
  const assemblyGroundClearanceM = surfacePlacement.groundClearanceM;
  const displayedSupportHeightM = surfacePlacement.displayedSupportHeightM;
  const displayedStructureHeightM = Number.isFinite(structureHeightM)
    ? Math.max(0, structureHeightM ?? 0)
    : continuousSurfaceState?.dimensions.heightM ?? 0;
  const parcelGeometry = useMemo(
    () => resolveParcelRenderGeometry({
      shape: parcelShape,
      areaM2: parcelAreaM2,
      aspectRatio: parcelAspectRatio,
      widthM: parcelWidthM,
      depthM: parcelDepthM,
      rotationRad: parcelRotationRad,
    }),
    [parcelAreaM2, parcelAspectRatio, parcelDepthM, parcelRotationRad, parcelShape, parcelWidthM],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host || stateRef.current) return;

    const scene = new Scene();
    scene.background = new Color("#08131d");
    scene.fog = new FogExp2("#08131d", 1.15);

    const camera = new PerspectiveCamera(40, 1, 0.003, 50);
    camera.position.set(0.48, 0.36, 0.56);
    camera.lookAt(0, 0.08, 0);

    const renderer = new WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.domElement.setAttribute("aria-label", "3D 연속 PV 형상과 토지 투영면적 장면");
    renderer.domElement.setAttribute("role", "img");
    host.appendChild(renderer.domElement);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.07;
    orbit.target.set(0, 0.075, 0);
    orbit.minDistance = 0.16;
    orbit.maxDistance = 2.8;

    const ambient = new HemisphereLight("#bde7ff", "#1c251f", 1.35);
    scene.add(ambient);
    const fill = new DirectionalLight("#8db7ff", 1.1);
    fill.position.set(-0.4, 0.6, 0.35);
    scene.add(fill);

    const sunLight = new DirectionalLight("#fff0bd", 3.2);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(1024, 1024);
    sunLight.shadow.camera.left = -0.5;
    sunLight.shadow.camera.right = 0.5;
    sunLight.shadow.camera.top = 0.5;
    sunLight.shadow.camera.bottom = -0.5;
    scene.add(sunLight);
    scene.add(sunLight.target);

    const sunOrb = new Mesh(
      new SphereGeometry(0.025, 24, 16),
      new MeshBasicMaterial({ color: "#ffd266", toneMapped: false }),
    );
    scene.add(sunOrb);

    const ground = new Mesh(
      new CircleGeometry(0.65, 96),
      new MeshStandardMaterial({ color: "#16241f", roughness: 0.92, metalness: 0.02 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.name = "simulation-ground";
    scene.add(ground);

    const grid = new GridHelper(1.15, 58, "#2c5362", "#18343e");
    grid.position.y = 0.0005;
    (grid.material as Material).opacity = 0.62;
    (grid.material as Material).transparent = true;
    scene.add(grid);

    const compassMaterial = new LineBasicMaterial({ color: "#5f8290", transparent: true, opacity: 0.7 });
    const compassGeometry = new BufferGeometry().setFromPoints([
      new Vector3(0, 0.002, -0.42),
      new Vector3(0, 0.002, 0.42),
      new Vector3(-0.42, 0.002, 0),
      new Vector3(0.42, 0.002, 0),
    ]);
    scene.add(new LineSegments(compassGeometry, compassMaterial));

    const panelGroup = new Group();
    const obstacleGroup = new Group();
    const helperGroup = new Group();
    const rayGroup = new Group();
    const siteOverlayGroup = new Group();
    const supportGroup = new Group();
    const importedGroup = new Group();
    scene.add(siteOverlayGroup, supportGroup, panelGroup, obstacleGroup, helperGroup, rayGroup, importedGroup);

    const transform = new TransformControls(camera, renderer.domElement);
    transform.setSize(0.7);
    scene.add(transform.getHelper());
    transform.addEventListener("dragging-changed", (event) => {
      orbit.enabled = !event.value;
      if (!event.value && transform.object?.userData.panelId) {
        const object = transform.object;
        if (surfaceSnapRef.current) {
          const ray = new Raycaster(
            new Vector3(object.position.x, 2, object.position.z),
            new Vector3(0, -1, 0),
            0,
            4,
          );
          const surfaces = [ground, ...obstacleGroup.children.filter((item) => item !== object)];
          const hit = ray.intersectObjects(surfaces, true)[0];
          if (hit) object.position.y = hit.point.y + PANEL_DEPTH * 0.6;
        }
        callbacksRef.current.onPanelTransform(
          object.userData.panelId,
          [object.position.x, object.position.y, object.position.z],
          [object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w],
        );
      } else if (!event.value && transform.object?.userData.obstacleId) {
        const object = transform.object;
        callbacksRef.current.onObstacleTransform?.(
          object.userData.obstacleId,
          [object.position.x, object.position.y, object.position.z],
          [object.rotation.x, object.rotation.y, object.rotation.z],
          [object.scale.x, object.scale.y, object.scale.z],
        );
      }
    });

    const raycaster = new Raycaster();
    const pointer = new Vector2();
    const handlePointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects([...panelGroup.children, ...obstacleGroup.children], false);
      const hit = hits.find((candidate) =>
        candidate.object.userData.panelId ||
        candidate.object.userData.obstacleId ||
        candidate.object.userData.continuousSurface
      );
      let panelId = hit?.object.userData.panelId as string | undefined;
      const surfaceData = hit?.object.userData.continuousSurface as ContinuousSurfaceHitData | undefined;
      if (!panelId && hit && surfaceData) {
        const geometry = hit.object instanceof Mesh ? hit.object.geometry : undefined;
        const zoneAttribute = geometry?.getAttribute("zoneIndex");
        const zoneFromTriangle = hit.face && zoneAttribute
          ? Math.round(zoneAttribute.getX(hit.face.a))
          : undefined;
        const localPoint = hit.object.worldToLocal(hit.point.clone());
        const zoneIndex = zoneFromTriangle ?? zoneIndexAtSurfacePoint(surfaceData, localPoint);
        panelId = surfaceData.panelIds[zoneIndex];
      }
      const obstacleId = hit?.object.userData.obstacleId as string | undefined;
      callbacksRef.current.onSelectPanel(panelId ?? null);
      callbacksRef.current.onSelectObstacle?.(obstacleId ?? null);
    };
    renderer.domElement.addEventListener("pointerdown", handlePointer);

    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    const meshById = new Map<string, Mesh>();
    const obstacleMeshById = new Map<string, Mesh>();
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      orbit.update();
      renderer.render(scene, camera);
    };
    animate();

    stateRef.current = {
      scene,
      camera,
      renderer,
      orbit,
      transform,
      panelGroup,
      obstacleGroup,
      helperGroup,
      rayGroup,
      siteOverlayGroup,
      supportGroup,
      importedGroup,
      sunLight,
      sunOrb,
      meshById,
      obstacleMeshById,
      raf,
      resizeObserver,
    };

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointer);
      transform.detach();
      transform.dispose();
      orbit.dispose();
      disposeObject3D(scene);
      renderer.dispose();
      renderer.domElement.remove();
      stateRef.current = null;
    };
  }, []);

  useEffect(() => {
    const state = stateRef.current;
    const host = hostRef.current;
    if (!state || !host) return;
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === "precise" ? 2 : 1.5));
    const { width, height } = host.getBoundingClientRect();
    if (width && height) state.renderer.setSize(width, height, false);
  }, [quality]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    const { panelGroup, meshById, transform } = state;
    transform.detach();
    clearAndDispose(panelGroup);
    meshById.clear();

    if (continuousSurfaceState) {
      const { model, dimensions } = continuousSurfaceState;
      const geometry = createContinuousSurfaceGeometry(
        model,
        dimensions,
        stablePanels,
        selectedPanelId,
        quality,
      );
      const material = new MeshPhysicalMaterial({
        vertexColors: true,
        roughness: 0.28,
        metalness: 0.12,
        clearcoat: 0.7,
        clearcoatRoughness: 0.18,
        emissive: new Color("#06131b"),
        emissiveIntensity: 0.1,
        side: DoubleSide,
      });
      const mesh = new Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `${model.kind}-continuous-pv-skin`;
      mesh.userData.continuousSurface = {
        kind: model.kind,
        dimensions,
        panelIds: model.zones.map((zone, index) => panelForZone(stablePanels, model, index)?.id ?? zone.id),
        qRanges: model.zones.map((zone) => ({ qMin: zone.qMin, qMax: zone.qMax })),
      } satisfies ContinuousSurfaceHitData;
      panelGroup.add(mesh);
      if (showZoneBoundaries) panelGroup.add(createZoneBoundaryGroup(model));
    } else {
      const geometry = new BoxGeometry(PANEL_SIZE, PANEL_SIZE, PANEL_DEPTH);
      stablePanels.forEach((panel) => {
        const material = new MeshPhysicalMaterial({
          color: colorForIrradiance(panel.irradianceWm2),
          roughness: 0.28,
          metalness: 0.12,
          clearcoat: 0.7,
          clearcoatRoughness: 0.18,
          emissive: panel.bypassActive ? new Color("#c6512c") : new Color("#06131b"),
          emissiveIntensity: panel.bypassActive ? 0.45 : 0.1,
        });
        const mesh = new Mesh(geometry, material);
        mesh.position.set(...panel.position);
        mesh.quaternion.set(...panel.quaternion).normalize();
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.panelId = panel.id;
        mesh.name = panel.label;
        panelGroup.add(mesh);
        meshById.set(panel.id, mesh);
      });
    }
  }, [continuousSurfaceState, stablePanels, quality, selectedPanelId, showZoneBoundaries]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    // The render skin and static local helpers receive the mechanical world-Y rotation once.
    state.panelGroup.rotation.y = rotationAngleRad;
    state.helperGroup.rotation.y = rotationAngleRad;
  }, [rotationAngleRad]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    state.panelGroup.position.y = assemblyLiftM;
    state.helperGroup.position.y = assemblyLiftM;
    clearAndDispose(state.supportGroup);
    if (displayedSupportHeightM > 1e-6) {
      const pole = new Mesh(
        new CylinderGeometry(0.004, 0.0055, displayedSupportHeightM, 16),
        new MeshStandardMaterial({ color: "#6f8791", roughness: 0.55, metalness: 0.62 }),
      );
      pole.position.y = displayedSupportHeightM / 2;
      pole.castShadow = true;
      pole.receiveShadow = true;
      pole.name = "pv-support-height";
      state.supportGroup.add(pole);
    }
    if (showHeightGuide && displayedStructureHeightM > 0) {
      const guideX = Math.sqrt(displayedSweptFootprintM2 / Math.PI) + 0.018;
      const bottom = assemblyGroundClearanceM;
      const top = assemblyGroundClearanceM + displayedStructureHeightM;
      const guide = new Line(
        new BufferGeometry().setFromPoints([
          new Vector3(guideX, bottom, 0),
          new Vector3(guideX, top, 0),
        ]),
        new LineDashedMaterial({
          color: "#9fc8d7",
          dashSize: 0.008,
          gapSize: 0.005,
          transparent: true,
          opacity: 0.9,
          depthTest: false,
        }),
      );
      guide.computeLineDistances();
      guide.renderOrder = 5;
      guide.name = "pv-structure-height-guide";
      guide.raycast = () => {};
      state.supportGroup.add(guide);
    }
  }, [assemblyGroundClearanceM, assemblyLiftM, displayedStructureHeightM, displayedSupportHeightM, displayedSweptFootprintM2, showHeightGuide]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    clearAndDispose(state.siteOverlayGroup);

    if (showParcelBoundary && parcelGeometry.areaM2 > 0) {
      const parcelMaterial = new MeshBasicMaterial({
        color: "#55b98d",
        transparent: true,
        opacity: 0.095,
        depthWrite: false,
        side: DoubleSide,
      });
      if (parcelGeometry.shape === "circle") {
        const parcel = new Mesh(
          new CircleGeometry(parcelGeometry.radiusM, 128),
          parcelMaterial,
        );
        parcel.rotation.x = -Math.PI / 2;
        parcel.position.y = 0.0012;
        parcel.renderOrder = 1;
        parcel.name = "land-parcel-circle-area";
        parcel.raycast = () => {};
        state.siteOverlayGroup.add(parcel);

        const ringWidthM = Math.max(0.001, parcelGeometry.radiusM * 0.012);
        const boundary = new Mesh(
          new RingGeometry(
            Math.max(0, parcelGeometry.radiusM - ringWidthM),
            parcelGeometry.radiusM,
            128,
          ),
          new MeshBasicMaterial({
            color: "#78d8ad",
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
            side: DoubleSide,
          }),
        );
        boundary.rotation.x = -Math.PI / 2;
        boundary.position.y = 0.0015;
        boundary.renderOrder = 2;
        boundary.name = "land-parcel-circle-boundary";
        boundary.raycast = () => {};
        state.siteOverlayGroup.add(boundary);
      } else {
        const parcelGroup = new Group();
        parcelGroup.rotation.y = parcelGeometry.rotationRad;
        parcelGroup.name = "land-parcel-rectangle";
        const rectangleGeometry = new PlaneGeometry(parcelGeometry.widthM, parcelGeometry.depthM);
        const parcel = new Mesh(rectangleGeometry, parcelMaterial);
        parcel.rotation.x = -Math.PI / 2;
        parcel.position.y = 0.0012;
        parcel.renderOrder = 1;
        parcel.name = "land-parcel-rectangle-area";
        parcel.raycast = () => {};
        parcelGroup.add(parcel);

        const boundary = new LineSegments(
          new EdgesGeometry(rectangleGeometry),
          new LineBasicMaterial({ color: "#78d8ad", transparent: true, opacity: 0.9 }),
        );
        boundary.rotation.x = -Math.PI / 2;
        boundary.position.y = 0.0015;
        boundary.renderOrder = 2;
        boundary.name = "land-parcel-rectangle-boundary";
        boundary.raycast = () => {};
        parcelGroup.add(boundary);
        state.siteOverlayGroup.add(parcelGroup);
      }
    }

    if (showSweptFootprint && displayedSweptFootprintM2 > 0) {
      const radiusM = Math.sqrt(displayedSweptFootprintM2 / Math.PI);
      const footprint = new Mesh(
        new RingGeometry(Math.max(0, radiusM - Math.max(0.0015, radiusM * 0.025)), radiusM, 128),
        new MeshBasicMaterial({
          color: "#f2b95f",
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
          side: DoubleSide,
        }),
      );
      footprint.rotation.x = -Math.PI / 2;
      footprint.position.y = 0.0021;
      footprint.renderOrder = 3;
      footprint.name = "pv-swept-footprint";
      footprint.raycast = () => {};
      state.siteOverlayGroup.add(footprint);
    }
  }, [displayedSweptFootprintM2, parcelGeometry, showParcelBoundary, showSweptFootprint]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state || !showParcelBoundary || parcelGeometry.areaM2 <= 0) return;
    const cosine = Math.abs(Math.cos(parcelGeometry.rotationRad));
    const sine = Math.abs(Math.sin(parcelGeometry.rotationRad));
    const boundsWidthM = parcelGeometry.shape === "circle"
      ? parcelGeometry.widthM
      : parcelGeometry.widthM * cosine + parcelGeometry.depthM * sine;
    const boundsDepthM = parcelGeometry.shape === "circle"
      ? parcelGeometry.depthM
      : parcelGeometry.widthM * sine + parcelGeometry.depthM * cosine;
    const horizontalSpan = Math.max(boundsWidthM, boundsDepthM);
    const verticalSpan = assemblyGroundClearanceM + displayedStructureHeightM;
    const requiredDistance = Math.max(0.72, horizontalSpan * 1.85, verticalSpan * 2.2);
    state.orbit.maxDistance = Math.max(2.8, requiredDistance * 2.5);
    state.camera.far = Math.max(50, requiredDistance * 8);
    state.camera.updateProjectionMatrix();
    const currentDistance = state.camera.position.distanceTo(state.orbit.target);
    if (currentDistance >= requiredDistance) return;
    const direction = state.camera.position.clone().sub(state.orbit.target).normalize();
    state.camera.position.copy(state.orbit.target).addScaledVector(direction, requiredDistance);
    state.orbit.update();
  }, [assemblyGroundClearanceM, displayedStructureHeightM, parcelGeometry, showParcelBoundary]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    const distance = Math.max(
      0.72,
      state.camera.position.distanceTo(state.orbit.target),
      Math.max(parcelGeometry.widthM, parcelGeometry.depthM) * 1.85,
      (assemblyGroundClearanceM + displayedStructureHeightM) * 2.2,
    );
    const target = state.orbit.target.toArray() as Vec3Tuple;
    const pose = cameraPoseForView(cameraView, distance, target);
    state.camera.position.set(...pose.position);
    state.camera.up.set(...pose.up);
    state.camera.lookAt(...pose.target);
    state.orbit.update();
  }, [assemblyGroundClearanceM, cameraView, displayedStructureHeightM, parcelGeometry.depthM, parcelGeometry.widthM]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    state.transform.setMode(transformMode);
    state.transform.setTranslationSnap(gridSnap ? 0.01 : null);
    state.transform.setRotationSnap(gridSnap ? MathUtils.degToRad(15) : null);
  }, [transformMode, gridSnap]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    clearAndDispose(state.obstacleGroup);
    state.obstacleMeshById.clear();
    stableObstacles.forEach((item) => {
      const isGltfBoundary = item.label.startsWith("GLB 차폐 경계");
      const material = new MeshStandardMaterial({
        color: obstacleColor(item),
        roughness: item.type === "water" ? 0.15 : 0.86,
        metalness: item.type === "water" ? 0.22 : 0.02,
        transparent: item.type === "water" || isGltfBoundary,
        opacity: isGltfBoundary ? 0.16 : item.type === "water" ? 0.72 : 1,
        wireframe: isGltfBoundary,
      });
      const geometry = isGltfBoundary ? new BoxGeometry(0.35, 0.35, 0.35) : obstacleGeometry(item.type);
      const mesh = new Mesh(geometry, material);
      mesh.position.set(...item.position);
      if (item.rotation) mesh.rotation.set(...item.rotation);
      mesh.scale.set(...item.scale);
      mesh.castShadow = item.type !== "water";
      mesh.receiveShadow = true;
      mesh.userData.obstacleId = item.id;
      mesh.name = item.label;
      state.obstacleGroup.add(mesh);
      state.obstacleMeshById.set(item.id, mesh);
    });
  }, [stableObstacles]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    const boundary = stableObstacles.find((item) => item.label.startsWith("GLB 차폐 경계"));
    if (!boundary) {
      state.importedGroup.position.set(0, 0, 0);
      state.importedGroup.rotation.set(0, 0, 0);
      state.importedGroup.scale.set(1, 1, 1);
      return;
    }
    state.importedGroup.position.set(boundary.position[0], boundary.position[1] - 0.175, boundary.position[2]);
    state.importedGroup.rotation.set(...(boundary.rotation ?? [0, 0, 0]));
    state.importedGroup.scale.set(...boundary.scale);
  }, [stableObstacles]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    state.transform.detach();
    const panel = selectedPanelId ? state.meshById.get(selectedPanelId) : undefined;
    const obstacle = selectedObstacleId ? state.obstacleMeshById.get(selectedObstacleId) : undefined;
    if (obstacle) state.transform.attach(obstacle);
    else if (panel) state.transform.attach(panel);
  }, [stablePanels, stableObstacles, selectedPanelId, selectedObstacleId]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    clearAndDispose(state.helperGroup);
    if (continuousSurfaceState) {
      const { model } = continuousSurfaceState;
      const selection = selectedZoneIndex(stablePanels, model, selectedPanelId);
      model.zones.forEach((zone, zoneIndex) => {
        const localNormal = new Vector3(...zone.representativeNormal).normalize();
        const origin = new Vector3(...zone.representativePosition);
        const isSelected = zoneIndex === selection;
        if (showNormals || isSelected) {
          state.helperGroup.add(
            new ArrowHelper(
              localNormal,
              origin,
              isSelected ? 0.052 : 0.035,
              isSelected ? "#fff0a6" : "#5eead4",
              isSelected ? 0.014 : 0.011,
              isSelected ? 0.008 : 0.006,
            ),
          );
        }
      });

      const selectedZone = selection >= 0 ? model.zones[selection] : undefined;
      if (showSurfaceSamples) {
        const sourceSamples = selectedZone
          ? selectedZone.samples
          : model.zones.flatMap((zone) => zone.samples);
        const sampleStride = Math.max(1, Math.ceil(sourceSamples.length / 320));
        const visibleSamples = sourceSamples.filter((_, index) => index % sampleStride === 0);
        const samplePositions: number[] = [];
        visibleSamples.forEach((sample) => {
          const localPosition = new Vector3(...sample.position);
          const localNormal = new Vector3(...sample.normal).normalize();
          localPosition.addScaledVector(localNormal, 0.001);
          samplePositions.push(localPosition.x, localPosition.y, localPosition.z);
          if (selectedZone) {
            state.helperGroup.add(
              new ArrowHelper(localNormal, localPosition, 0.014, "#73e6ff", 0.004, 0.0025),
            );
          }
        });
        const points = new Points(
          new BufferGeometry().setAttribute(
            "position",
            new Float32BufferAttribute(samplePositions, 3),
          ),
          new PointsMaterial({
            color: "#f9f871",
            size: 0.006,
            sizeAttenuation: true,
            depthTest: false,
          }),
        );
        points.renderOrder = 6;
        state.helperGroup.add(points);

        if (!selectedZone) return;
        const diagnosticSample = selectedZone.samples.reduce((nearest, sample) => {
          const distance = sample.position.reduce((sum, value, axis) => {
            const delta = value - selectedZone.representativePosition[axis];
            return sum + delta * delta;
          }, 0);
          const nearestDistance = nearest.position.reduce((sum, value, axis) => {
            const delta = value - selectedZone.representativePosition[axis];
            return sum + delta * delta;
          }, 0);
          return distance < nearestDistance ? sample : nearest;
        });
        const diagnosticOrigin = new Vector3(...diagnosticSample.position);
        const diagnosticNormal = new Vector3(...diagnosticSample.normal).normalize();
        diagnosticOrigin.addScaledVector(diagnosticNormal, 0.0012);
        state.helperGroup.add(
          new ArrowHelper(diagnosticNormal, diagnosticOrigin, 0.048, "#fff0a6", 0.012, 0.007),
        );
      }
      return;
    }

    stablePanels.forEach((panel) => {
      if (showNormals || panel.id === selectedPanelId) {
        const normal = new Vector3(0, 0, 1).applyQuaternion(new Quaternion(...panel.quaternion));
        const isSelected = panel.id === selectedPanelId;
        state.helperGroup.add(
          new ArrowHelper(
            normal,
            new Vector3(...panel.position),
            isSelected ? 0.052 : 0.035,
            isSelected ? "#fff0a6" : "#5eead4",
            isSelected ? 0.014 : 0.011,
            isSelected ? 0.008 : 0.006,
          ),
        );
      }
    });
  }, [continuousSurfaceState, stablePanels, selectedPanelId, showNormals, showSurfaceSamples]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    clearAndDispose(state.rayGroup);
    if (!showRays || sunElevationDeg <= 0) return;

    if (continuousSurfaceState) {
      const { model } = continuousSurfaceState;
      model.zones.forEach((zone) => {
        const origin = new Vector3(
          ...rotateAroundY([...zone.representativePosition] as Vec3Tuple, rotationAngleRad),
        );
        origin.y += assemblyLiftM;
        addSunRay(state.rayGroup, origin, normalizedSun);
      });
      const selection = selectedZoneIndex(stablePanels, model, selectedPanelId);
      const selectedZone = selection >= 0 ? model.zones[selection] : undefined;
      if (showSurfaceSamples && selectedZone) {
        const diagnosticSample = selectedZone.samples.reduce((nearest, sample) => {
          const distance = sample.position.reduce((sum, value, axis) => {
            const delta = value - selectedZone.representativePosition[axis];
            return sum + delta * delta;
          }, 0);
          const nearestDistance = nearest.position.reduce((sum, value, axis) => {
            const delta = value - selectedZone.representativePosition[axis];
            return sum + delta * delta;
          }, 0);
          return distance < nearestDistance ? sample : nearest;
        });
        const diagnosticOrigin = new Vector3(
          ...rotateAroundY([...diagnosticSample.position] as Vec3Tuple, rotationAngleRad),
        );
        const diagnosticNormal = new Vector3(
          ...rotateAroundY([...diagnosticSample.normal] as Vec3Tuple, rotationAngleRad),
        ).normalize();
        diagnosticOrigin.y += assemblyLiftM;
        diagnosticOrigin.addScaledVector(diagnosticNormal, 0.0012);
        addSunRay(state.rayGroup, diagnosticOrigin, normalizedSun, 0.09, 0.95);
        addAoiArc(state.rayGroup, diagnosticOrigin, diagnosticNormal, normalizedSun);
      }
      return;
    }

    stablePanels.forEach((panel) => {
      const origin = new Vector3(...rotateAroundY(panel.position, rotationAngleRad));
      origin.y += assemblyLiftM;
      addSunRay(state.rayGroup, origin, normalizedSun);
    });
  }, [assemblyLiftM, continuousSurfaceState, stablePanels, rotationAngleRad, selectedPanelId, showRays, showSurfaceSamples, normalizedSun, sunElevationDeg]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    const distance = 0.46;
    const pos = normalizedSun.clone().multiplyScalar(distance).add(new Vector3(0, 0.09, 0));
    state.sunOrb.visible = sunElevationDeg > -6;
    state.sunOrb.position.copy(pos);
    state.sunLight.position.copy(pos);
    state.sunLight.target.position.set(0, 0.07, 0);
    state.sunLight.intensity = sunElevationDeg > 0 ? 3.2 : 0;
  }, [normalizedSun, sunElevationDeg]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    clearAndDispose(state.importedGroup);
    if (!gltfUrl) return;
    let active = true;
    void import("three/examples/jsm/loaders/GLTFLoader.js").then(({ GLTFLoader }) => {
      if (!active) return;
      const loader = new GLTFLoader();
      loader.load(
        gltfUrl,
        (gltf) => {
          if (!active) {
            disposeObject3D(gltf.scene);
            return;
          }
          const box = new Box3().setFromObject(gltf.scene);
          const size = box.getSize(new Vector3());
          const maxSize = Math.max(size.x, size.y, size.z, 0.001);
          gltf.scene.scale.setScalar(0.35 / maxSize);
          const normalizedBox = new Box3().setFromObject(gltf.scene);
          const center = normalizedBox.getCenter(new Vector3());
          gltf.scene.position.set(-center.x, -normalizedBox.min.y + 0.002, -center.z);
          gltf.scene.traverse((object) => {
            if (object instanceof Mesh) {
              object.castShadow = true;
              object.receiveShadow = true;
            }
          });
          state.importedGroup.add(gltf.scene);
        },
        undefined,
        () => undefined,
      );
    });
    return () => {
      active = false;
    };
  }, [gltfUrl]);

  return (
    <div className="three-workspace" ref={hostRef}>
      <div className="scene-compass" aria-hidden="true">
        <span className="north">N</span><span className="east">E</span><span className="south">S</span><span className="west">W</span>
      </div>
      <div className="scene-scale">
        {continuousSurfaceState ? "단일 연속 PV 스킨 · 격자 1칸 = 1 cm" : "강체 자유편집 · 격자 1칸 = 1 cm"}
      </div>
      {parcelGeometry.areaM2 > 0 ? <div className="scene-land-label">A_land {parcelGeometry.areaM2.toFixed(4)} m²</div> : null}
      <div className="scene-view-label">{cameraView === "top" ? "TOP · XZ 투영" : "3D"}</div>
    </div>
  );
}
