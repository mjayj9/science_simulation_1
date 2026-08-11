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
import {
  createContinuousSurface,
  isContinuousSurfacePreset,
  type ContinuousSurfaceOptions,
  type ContinuousSurfaceKind,
} from "./continuous-surfaces";

export interface PresetOptions extends ContinuousSurfaceOptions {
  planeRows?: 4 | 5;
  planeTiltDeg?: number;
  planeAzimuthDeg?: number;
  gapM?: number;
  /** Physics quadrature density for continuous curved skins; render tessellation is independent. */
  azimuthSamples?: number;
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

function generateContinuousSkinPreset(
  kind: ContinuousSurfaceKind,
  options: PresetOptions,
): Panel[] {
  const surface = createContinuousSurface(kind, options.azimuthSamples, {
    cylinderAspectRatio: options.cylinderAspectRatio,
    coneAspectRatio: options.coneAspectRatio,
    groundClearanceM: options.groundClearanceM,
  });
  // These are electrical/scene anchors, not 5 cm facets. The legacy Panel
  // dimensions remain compatibility metadata while optics uses zone samples.
  return surface.zones.map((zone) => panel(
    zone.id,
    zone.representativePosition,
    zone.representativeNormal,
  ));
}

export function generatePreset(name: PresetName, options: PresetOptions = {}): Panel[] {
  const gapM = options.gapM ?? 0.001;
  if (!Number.isFinite(gapM) || gapM < 0) {
    throw new RangeError("패널 간격은 0 이상의 유한한 값이어야 합니다.");
  }

  let panels: Panel[];
  if (isContinuousSurfacePreset(name)) {
    panels = generateContinuousSkinPreset(name, options);
  } else {
    switch (name) {
      case "cube":
        panels = generateCube(gapM);
        break;
      case "plane":
        panels = generatePlane(options, gapM);
        break;
      case "free":
        panels = generatePlane({ ...options, planeRows: 4 }, gapM);
        break;
      default: {
        const exhaustive: never = name;
        throw new RangeError(`지원하지 않는 프리셋: ${String(exhaustive)}`);
      }
    }
  }

  if (panels.length !== 20) {
    throw new Error(`${name} 프리셋은 정확히 20개 PV 전기 구역이어야 합니다.`);
  }
  return panels;
}
