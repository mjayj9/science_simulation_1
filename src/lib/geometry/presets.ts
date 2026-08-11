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
  dot3,
  multiplyQuaternion,
  normalize3,
  quaternionFromAxisAngle,
  quaternionFromNormal,
  scale3,
  tangentAxes,
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

function alignPanelVertical(generated: Panel, vertical: Vec3): Panel {
  const [localHorizontal, localVertical] = tangentAxes(generated.quaternion);
  const unitVertical = normalize3(vertical);
  const roll = Math.atan2(
    -dot3(unitVertical, localHorizontal),
    dot3(unitVertical, localVertical),
  );
  return {
    ...generated,
    quaternion: multiplyQuaternion(
      generated.quaternion,
      quaternionFromAxisAngle([0, 0, 1], roll),
    ),
  };
}

function planeBasis(normal: Vec3): readonly [Vec3, Vec3] {
  const reference: Vec3 = Math.abs(normal[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
  const horizontal = normalize3(cross3(reference, normal));
  const vertical = normalize3(cross3(normal, horizontal));
  return [horizontal, vertical];
}

function generateCube(gapM: number): Panel[] {
  const sideM = 2 * PANEL_WIDTH_M + gapM;
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
  const columns = 10;
  const rings = 2;
  const circumferentialPitch = PANEL_WIDTH_M + gapM;
  const radius = circumferentialPitch / (2 * Math.tan(Math.PI / columns));
  const verticalPitch = PANEL_HEIGHT_M + gapM;
  const panels: Panel[] = [];
  for (let ring = 0; ring < rings; ring += 1) {
    const y = (ring - (rings - 1) / 2) * verticalPitch;
    for (let column = 0; column < columns; column += 1) {
      const angle = (column / columns) * Math.PI * 2;
      const normal: Vec3 = [Math.sin(angle), 0, Math.cos(angle)];
      panels.push(panel(`cylinder-panel-${panels.length + 1}`, [normal[0] * radius, y, normal[2] * radius], normal));
    }
  }
  return panels;
}

function generateSphere(gapM: number): Panel[] {
  const phi = (1 + Math.sqrt(5)) / 2;
  const inversePhi = 1 / phi;
  const rawDirections: Vec3[] = [];

  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) rawDirections.push([x, y, z]);
    }
  }
  for (const y of [-inversePhi, inversePhi]) {
    for (const z of [-phi, phi]) rawDirections.push([0, y, z]);
  }
  for (const x of [-inversePhi, inversePhi]) {
    for (const y of [-phi, phi]) rawDirections.push([x, y, 0]);
  }
  for (const x of [-phi, phi]) {
    for (const z of [-inversePhi, inversePhi]) rawDirections.push([x, 0, z]);
  }

  // 정십이면체 꼭짓점 사이의 최소 각도에 패널 pitch를 맞춘다. 구면은
  // 정사각형으로 완전 타일링할 수 없으므로 작은 대각선 여유만 남긴다.
  const minimumAngularSeparation = Math.acos(Math.sqrt(5) / 3);
  const pitch = PANEL_WIDTH_M + gapM;
  const radius = (pitch / (2 * Math.sin(minimumAngularSeparation / 2))) * 1.05;
  // 정사각형 모서리가 이웃 접평면을 침범하지 않도록 계산한 결정적 면내 회전값.
  const rollDegrees = [
    46.9, 14.3, 71.2, 24.7, 70.2, 25.3, 53.9, 19.7, 38.7, 74.1,
    20.7, 59.0, 45.6, 7.1, 85.0, 26.3, 33.4, 15.2, 64.1, 4.8,
  ] as const;
  return rawDirections.map((direction, index) => {
    const normal = normalize3(direction);
    const generated = panel(`sphere-panel-${index + 1}`, scale3(normal, radius), normal);
    return {
      ...generated,
      quaternion: multiplyQuaternion(
        generated.quaternion,
        quaternionFromAxisAngle([0, 0, 1], rollDegrees[index] * Math.PI / 180),
      ),
    };
  });
}

function generateCone(gapM: number): Panel[] {
  const ringCounts = [8, 6, 4, 2] as const;
  // 위쪽 모서리가 더 작은 원주로 모이는 정사각형의 특성상 단순 pitch만
  // 쓰면 패널이 겹친다. 최소 무충돌 배율을 적용해 taper 여유를 확보한다.
  const taperPackingScale = 1.3;
  const slantPitch = (PANEL_HEIGHT_M + gapM) * taperPackingScale;
  const slantHeight = ringCounts.length * slantPitch;
  const firstRingRadius = ((PANEL_WIDTH_M + gapM) * taperPackingScale)
    / (2 * Math.tan(Math.PI / ringCounts[0]));
  const baseRadius = firstRingRadius / (1 - 0.5 / ringCounts.length);
  const height = Math.sqrt(Math.max(0, slantHeight * slantHeight - baseRadius * baseRadius));
  const slope = baseRadius / height;
  const panels: Panel[] = [];

  ringCounts.forEach((count, ringIndex) => {
    const slantDistance = (ringIndex + 0.5) * slantPitch;
    const radius = baseRadius * (1 - slantDistance / slantHeight);
    const y = -height / 2 + slantDistance * (height / slantHeight);
    for (let column = 0; column < count; column += 1) {
      const angle = (column / count) * Math.PI * 2 + (ringIndex % 2 ? Math.PI / count : 0);
      const normal = normalize3([Math.sin(angle), slope, Math.cos(angle)]);
      const vertical = normalize3([
        -Math.sin(angle) * baseRadius,
        height,
        -Math.cos(angle) * baseRadius,
      ]);
      panels.push(
        alignPanelVertical(
          panel(
            `cone-panel-${panels.length + 1}`,
            [Math.sin(angle) * radius, y, Math.cos(angle) * radius],
            normal,
          ),
          vertical,
        ),
      );
    }
  });
  return panels;
}

export function generatePreset(name: PresetName, options: PresetOptions = {}): Panel[] {
  const gapM = options.gapM ?? 0.001;
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
      panels = generateSphere(gapM);
      break;
    case "cone":
      panels = generateCone(gapM);
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
