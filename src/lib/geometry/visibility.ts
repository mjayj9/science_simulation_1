import type {
  Aabb,
  Obstacle,
  Panel,
  Vec3,
  VisibilityOccluder,
  VisibilityOptions,
  VisibilityResult,
} from "./types";
import {
  add3,
  dot3,
  normalize3,
  scale3,
  sub3,
  tangentAxes,
} from "./math";
import { obstacleToAabb } from "./environment";

export function rayAabbDistance(
  origin: Vec3,
  directionInput: Vec3,
  bounds: Aabb,
  maxDistanceM = Number.POSITIVE_INFINITY,
): number | null {
  const direction = normalize3(directionInput);
  let near = 0;
  let far = maxDistanceM;

  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(direction[axis]) < 1e-12) {
      if (origin[axis] < bounds.min[axis] || origin[axis] > bounds.max[axis]) return null;
      continue;
    }
    const inverse = 1 / direction[axis];
    let first = (bounds.min[axis] - origin[axis]) * inverse;
    let second = (bounds.max[axis] - origin[axis]) * inverse;
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (near > far) return null;
  }
  return far >= 0 && near <= maxDistanceM ? Math.max(0, near) : null;
}

export function rayPanelDistance(
  origin: Vec3,
  directionInput: Vec3,
  panel: Panel,
  maxDistanceM = Number.POSITIVE_INFINITY,
): number | null {
  const direction = normalize3(directionInput);
  const [axisX, axisY, normal] = tangentAxes(panel.quaternion);
  const denominator = dot3(direction, normal);
  if (Math.abs(denominator) < 1e-10) return null;
  const distance = dot3(sub3(panel.position, origin), normal) / denominator;
  if (distance <= 1e-8 || distance > maxDistanceM) return null;
  const hit = add3(origin, scale3(direction, distance));
  const relative = sub3(hit, panel.position);
  return Math.abs(dot3(relative, axisX)) <= panel.widthM / 2 + 1e-9 &&
    Math.abs(dot3(relative, axisY)) <= panel.heightM / 2 + 1e-9
    ? distance
    : null;
}

export function obstaclesToOccluders(obstacles: readonly Obstacle[]): VisibilityOccluder[] {
  return obstacles
    .filter((obstacle) => obstacle.castsShadow)
    .map((obstacle) => ({ kind: "aabb" as const, id: obstacle.id, bounds: obstacleToAabb(obstacle) }));
}

function firstBlocker(
  origin: Vec3,
  direction: Vec3,
  sourcePanelId: string,
  occluders: readonly VisibilityOccluder[],
  maxDistanceM: number,
): string | null {
  let closest = maxDistanceM;
  let blocker: string | null = null;
  for (const occluder of occluders) {
    if (occluder.id === sourcePanelId) continue;
    const distance = occluder.kind === "aabb"
      ? rayAabbDistance(origin, direction, occluder.bounds, closest)
      : rayPanelDistance(origin, direction, occluder.panel, closest);
    if (distance !== null && distance < closest) {
      closest = distance;
      blocker = occluder.id;
    }
  }
  return blocker;
}

export function visibility(
  panel: Panel,
  sunDirectionInput: Vec3,
  occluders: readonly VisibilityOccluder[],
  options: VisibilityOptions = {},
): VisibilityResult {
  const sunDirection = normalize3(sunDirectionInput);
  const frontFacing = dot3(panel.normal, sunDirection) > 0;
  const requestedSamples = Math.round(options.samplesPerSide ?? 3);
  const samplesPerSide = Math.min(15, Math.max(1, requestedSamples));
  const totalSamples = samplesPerSide ** 2;
  if (!frontFacing) {
    return { panelId: panel.id, visibility: 0, visibleSamples: 0, totalSamples, frontFacing, blockedBy: {} };
  }

  const epsilonM = options.epsilonM ?? 1e-5;
  const maxDistanceM = options.maxDistanceM ?? 1e7;
  const [axisX, axisY, normal] = tangentAxes(panel.quaternion);
  let visibleSamples = 0;
  const blockedBy: Record<string, number> = {};

  for (let row = 0; row < samplesPerSide; row += 1) {
    for (let column = 0; column < samplesPerSide; column += 1) {
      const x = ((column + 0.5) / samplesPerSide - 0.5) * panel.widthM;
      const y = ((row + 0.5) / samplesPerSide - 0.5) * panel.heightM;
      const origin = add3(
        add3(panel.position, add3(scale3(axisX, x), scale3(axisY, y))),
        scale3(normal, epsilonM),
      );
      const blocker = firstBlocker(origin, sunDirection, panel.id, occluders, maxDistanceM);
      if (blocker === null) visibleSamples += 1;
      else blockedBy[blocker] = (blockedBy[blocker] ?? 0) + 1;
    }
  }

  return {
    panelId: panel.id,
    visibility: visibleSamples / totalSamples,
    visibleSamples,
    totalSamples,
    frontFacing,
    blockedBy,
  };
}

export function computeVisibilities(
  panels: readonly Panel[],
  sunDirection: Vec3,
  obstacles: readonly Obstacle[] = [],
  options: VisibilityOptions = {},
): VisibilityResult[] {
  const occluders: VisibilityOccluder[] = [
    ...panels.map((panel) => ({ kind: "panel" as const, id: panel.id, panel })),
    ...obstaclesToOccluders(obstacles),
  ];
  return panels.map((panel) => visibility(panel, sunDirection, occluders, options));
}
