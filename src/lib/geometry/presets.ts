import {
  PANEL_AREA_M2,
  PANEL_HEIGHT_M,
  PANEL_WIDTH_M,
  type Panel,
  type PresetName,
  type Vec3,
} from "./types";
import {
  add3,
  cross3,
  normalize3,
  quaternionFromNormal,
  scale3,
} from "./math";

export interface PresetOptions {
  planeRows?: 4 | 5;
  planeTiltDeg?: number;
  planeAzimuthDeg?: number;
  gapM?: number;
}

function panel(id: string, position: Vec3, normal: Vec3): Panel {
  const unitNormal = normalize3(normal);
  return {
    id,
    widthM: PANEL_WIDTH_M,
    heightM: PANEL_HEIGHT_M,
    areaM2: PANEL_AREA_M2,
    position,
    quaternion: quaternionFromNormal(unitNormal),
    normal: unitNormal,
  };
}

function planeBasis(normal: Vec3): readonly [Vec3, Vec3] {
  const reference: Vec3 = Math.abs(normal[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
  const horizontal = normalize3(cross3(reference, normal));
  const vertical = normalize3(cross3(normal, horizontal));
  return [horizontal, vertical];
}

function generateCube(gapM: number): Panel[] {
  const sideM = 2 * PANEL_WIDTH_M + gapM * 3;
  const half = sideM / 2;
  const offset = (PANEL_WIDTH_M + gapM) / 2;
  const faces: { normal: Vec3; center: Vec3 }[] = [
    { normal: [0, 1, 0], center: [0, half, 0] },
    { normal: [1, 0, 0], center: [half, 0, 0] },
    { normal: [-1, 0, 0], center: [-half, 0, 0] },
    { normal: [0, 0, 1], center: [0, 0, half] },
    { normal: [0, 0, -1], center: [0, 0, -half] },
  ];

  const panels: Panel[] = [];
  faces.forEach((face, faceIndex) => {
    const [u, v] = planeBasis(face.normal);
    for (const row of [-1, 1]) {
      for (const column of [-1, 1]) {
        const position = add3(
          face.center,
          add3(scale3(u, column * offset), scale3(v, row * offset)),
        );
        panels.push(panel(`cube-panel-${faceIndex * 4 + panels.length % 4 + 1}`, position, face.normal));
      }
    }
  });
  return panels;
}

function generatePlane(options: PresetOptions, gapM: number): Panel[] {
  const rows = options.planeRows ?? 4;
  const columns = 20 / rows;
  const tilt = ((options.planeTiltDeg ?? 30) * Math.PI) / 180;
  const azimuth = ((options.planeAzimuthDeg ?? 180) * Math.PI) / 180;
  const normal: Vec3 = normalize3([
    Math.sin(azimuth) * Math.sin(tilt),
    Math.cos(tilt),
    Math.cos(azimuth) * Math.sin(tilt),
  ]);
  const [u, v] = planeBasis(normal);
  const pitch = PANEL_WIDTH_M + gapM;
  const panels: Panel[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const du = (column - (columns - 1) / 2) * pitch;
      const dv = (row - (rows - 1) / 2) * pitch;
      panels.push(panel(`plane-panel-${panels.length + 1}`, add3(scale3(u, du), scale3(v, dv)), normal));
    }
  }
  return panels;
}

function generateCylinder(gapM: number): Panel[] {
  const radius = 0.12;
  const verticalPitch = PANEL_HEIGHT_M + gapM;
  const panels: Panel[] = [];
  for (let ring = 0; ring < 4; ring += 1) {
    const y = (ring - 1.5) * verticalPitch;
    for (let column = 0; column < 5; column += 1) {
      const angle = (column / 5) * Math.PI * 2;
      const normal: Vec3 = [Math.sin(angle), 0, Math.cos(angle)];
      panels.push(panel(`cylinder-panel-${panels.length + 1}`, [normal[0] * radius, y, normal[2] * radius], normal));
    }
  }
  return panels;
}

function generateSphere(): Panel[] {
  const count = 20;
  const radius = 0.18;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, index) => {
    const y = 1 - (2 * (index + 0.5)) / count;
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = index * goldenAngle;
    const normal: Vec3 = [Math.cos(angle) * radial, y, Math.sin(angle) * radial];
    return panel(`sphere-panel-${index + 1}`, scale3(normal, radius), normal);
  });
}

function generateCone(): Panel[] {
  const ringCounts = [8, 6, 4, 2] as const;
  const baseRadius = 0.18;
  const height = 0.28;
  const slope = baseRadius / height;
  const panels: Panel[] = [];

  ringCounts.forEach((count, ringIndex) => {
    const y = 0.035 + ringIndex * 0.065;
    const radius = baseRadius * (1 - y / height);
    for (let column = 0; column < count; column += 1) {
      const angle = (column / count) * Math.PI * 2 + (ringIndex % 2 ? Math.PI / count : 0);
      const normal = normalize3([Math.sin(angle), slope, Math.cos(angle)]);
      panels.push(
        panel(
          `cone-panel-${panels.length + 1}`,
          [Math.sin(angle) * radius, y - height / 2, Math.cos(angle) * radius],
          normal,
        ),
      );
    }
  });
  return panels;
}

export function generatePreset(name: PresetName, options: PresetOptions = {}): Panel[] {
  const gapM = options.gapM ?? 0.01;
  if (!Number.isFinite(gapM) || gapM < 0) {
    throw new RangeError("패널 간격은 0 이상의 유한한 값이어야 합니다.");
  }

  let panels: Panel[];
  switch (name) {
    case "cube":
      panels = generateCube(gapM);
      break;
    case "plane":
      panels = generatePlane(options, gapM);
      break;
    case "cylinder":
      panels = generateCylinder(gapM);
      break;
    case "sphere":
      panels = generateSphere();
      break;
    case "cone":
      panels = generateCone();
      break;
    case "free":
      panels = generatePlane({ ...options, planeRows: 4 }, gapM);
      break;
    default: {
      const exhaustive: never = name;
      throw new RangeError(`지원하지 않는 프리셋: ${String(exhaustive)}`);
    }
  }

  if (panels.length !== 20) {
    throw new Error(`${name} 프리셋은 정확히 20개 패널이어야 합니다.`);
  }
  return panels;
}
