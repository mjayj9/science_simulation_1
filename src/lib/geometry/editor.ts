import {
  MAX_PANELS_PER_VARIANT,
  PANEL_AREA_M2,
  PANEL_HEIGHT_M,
  PANEL_WIDTH_M,
  type Panel,
  type Vec3,
} from "./types";
import {
  add3,
  dot3,
  isFiniteVec3,
  normalFromQuaternion,
  normalizeQuaternion,
  tangentAxes,
} from "./math";

export type PanelIdFactory = () => string;

let fallbackId = 0;
function defaultIdFactory(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  fallbackId += 1;
  return `panel-${Date.now().toString(36)}-${fallbackId.toString(36)}`;
}

export function createPanel(
  input: Partial<Pick<Panel, "id" | "position" | "quaternion">> = {},
  idFactory: PanelIdFactory = defaultIdFactory,
): Panel {
  const position = input.position ?? [0, 0, 0];
  const quaternion = normalizeQuaternion(input.quaternion ?? [0, 0, 0, 1]);
  if (!isFiniteVec3(position)) {
    throw new RangeError("패널 위치는 유한한 값이어야 합니다.");
  }
  return {
    id: input.id ?? idFactory(),
    widthM: PANEL_WIDTH_M,
    heightM: PANEL_HEIGHT_M,
    areaM2: PANEL_AREA_M2,
    position,
    quaternion,
    normal: normalFromQuaternion(quaternion),
  };
}

function assertUniqueIds(panels: readonly Panel[]): void {
  if (new Set(panels.map((panel) => panel.id)).size !== panels.length) {
    throw new Error("패널 ID가 중복되었습니다.");
  }
}

export function addPanel(
  panels: readonly Panel[],
  input: Partial<Pick<Panel, "id" | "position" | "quaternion">> = {},
  idFactory?: PanelIdFactory,
): Panel[] {
  if (panels.length >= MAX_PANELS_PER_VARIANT) {
    throw new RangeError(`형상 하나에는 최대 ${MAX_PANELS_PER_VARIANT}개 패널만 배치할 수 있습니다.`);
  }
  const next = [...panels, createPanel(input, idFactory)];
  assertUniqueIds(next);
  return next;
}

export function deletePanel(panels: readonly Panel[], panelId: string): Panel[] {
  const next = panels.filter((panel) => panel.id !== panelId);
  if (next.length === panels.length) {
    throw new RangeError(`삭제할 패널을 찾지 못했습니다: ${panelId}`);
  }
  if (next.length < 1) {
    throw new RangeError("형상에는 패널이 최소 1개 있어야 합니다.");
  }
  return next;
}

export function duplicatePanel(
  panels: readonly Panel[],
  panelId: string,
  offset: Vec3 = [PANEL_WIDTH_M + 0.01, 0, 0],
  idFactory?: PanelIdFactory,
): Panel[] {
  const source = panels.find((panel) => panel.id === panelId);
  if (!source) {
    throw new RangeError(`복제할 패널을 찾지 못했습니다: ${panelId}`);
  }
  return addPanel(
    panels,
    {
      position: add3(source.position, offset),
      quaternion: source.quaternion,
    },
    idFactory,
  );
}

export function updatePanel(
  panels: readonly Panel[],
  panelId: string,
  patch: Partial<Pick<Panel, "position" | "quaternion">>,
): Panel[] {
  let found = false;
  const next = panels.map((panel) => {
    if (panel.id !== panelId) return panel;
    found = true;
    const position = patch.position ?? panel.position;
    const quaternion = normalizeQuaternion(patch.quaternion ?? panel.quaternion);
    if (!isFiniteVec3(position)) {
      throw new RangeError("패널 위치는 유한한 값이어야 합니다.");
    }
    return {
      ...panel,
      position,
      quaternion,
      normal: normalFromQuaternion(quaternion),
    };
  });
  if (!found) throw new RangeError(`수정할 패널을 찾지 못했습니다: ${panelId}`);
  return next;
}

interface Obb {
  centre: Vec3;
  axes: readonly [Vec3, Vec3, Vec3];
  half: readonly [number, number, number];
}

function panelObb(panel: Panel, thicknessM: number): Obb {
  return {
    centre: panel.position,
    axes: tangentAxes(panel.quaternion),
    half: [panel.widthM / 2, panel.heightM / 2, thicknessM / 2],
  };
}

/** Full 15-axis separating-axis test for thin oriented panel boxes. */
function intersectsObb(a: Obb, b: Obb, toleranceM: number): boolean {
  const rotation = Array.from({ length: 3 }, () => [0, 0, 0]);
  const absolute = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      rotation[i][j] = dot3(a.axes[i], b.axes[j]);
      absolute[i][j] = Math.abs(rotation[i][j]) + 1e-10;
    }
  }

  const delta: Vec3 = [
    b.centre[0] - a.centre[0],
    b.centre[1] - a.centre[1],
    b.centre[2] - a.centre[2],
  ];
  const translated = a.axes.map((axis) => dot3(delta, axis));

  const separated = (distance: number, ra: number, rb: number) =>
    Math.abs(distance) >= Math.max(0, ra + rb - toleranceM);

  for (let i = 0; i < 3; i += 1) {
    const rb = b.half[0] * absolute[i][0] + b.half[1] * absolute[i][1] + b.half[2] * absolute[i][2];
    if (separated(translated[i], a.half[i], rb)) return false;
  }
  for (let j = 0; j < 3; j += 1) {
    const ra = a.half[0] * absolute[0][j] + a.half[1] * absolute[1][j] + a.half[2] * absolute[2][j];
    const distance = translated[0] * rotation[0][j] + translated[1] * rotation[1][j] + translated[2] * rotation[2][j];
    if (separated(distance, ra, b.half[j])) return false;
  }

  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      // Parallel basis vectors have a zero cross-product and therefore do not
      // define a usable separating axis.
      if (1 - rotation[i][j] * rotation[i][j] < 1e-12) continue;
      const i1 = (i + 1) % 3;
      const i2 = (i + 2) % 3;
      const j1 = (j + 1) % 3;
      const j2 = (j + 2) % 3;
      const ra = a.half[i1] * absolute[i2][j] + a.half[i2] * absolute[i1][j];
      const rb = b.half[j1] * absolute[i][j2] + b.half[j2] * absolute[i][j1];
      const distance = translated[i2] * rotation[i1][j] - translated[i1] * rotation[i2][j];
      if (separated(distance, ra, rb)) return false;
    }
  }
  return true;
}

export interface PanelOverlap {
  aId: string;
  bId: string;
}

export function detectOverlaps(
  panels: readonly Panel[],
  options: { thicknessM?: number; toleranceM?: number } = {},
): PanelOverlap[] {
  const thicknessM = options.thicknessM ?? 0.0005;
  const toleranceM = options.toleranceM ?? 1e-6;
  const overlaps: PanelOverlap[] = [];
  for (let i = 0; i < panels.length; i += 1) {
    const a = panelObb(panels[i], thicknessM);
    for (let j = i + 1; j < panels.length; j += 1) {
      if (intersectsObb(a, panelObb(panels[j], thicknessM), toleranceM)) {
        overlaps.push({ aId: panels[i].id, bId: panels[j].id });
      }
    }
  }
  return overlaps;
}

export const transformPanel = updatePanel;
