import type {
  Aabb,
  EnvironmentPreset,
  EnvironmentPresetName,
  Obstacle,
  ObstacleType,
  Quaternion,
  Vec3,
} from "./types";
import { normalizeQuaternion, rotateVector } from "./math";

export const ENVIRONMENT_PRESETS: Readonly<Record<EnvironmentPresetName, EnvironmentPreset>> = {
  mountain: {
    id: "mountain",
    labelKo: "산악",
    roughnessLengthM: 0.3,
    turbulenceIntensity: 0.2,
    groundAlbedo: 0.2,
    defaultSoilingLossFraction: 0.025,
    saltExposureFactor: 0,
    wakeModel: "engineering-approximation",
    assumptionsKo: ["복잡지형 유동은 CFD가 아닌 거칠기·후류 근사입니다."],
  },
  coastal: {
    id: "coastal",
    labelKo: "바다·해안",
    roughnessLengthM: 0.003,
    turbulenceIntensity: 0.1,
    groundAlbedo: 0.12,
    defaultSoilingLossFraction: 0.018,
    saltExposureFactor: 1,
    wakeModel: "engineering-approximation",
    assumptionsKo: ["염분 계수는 오염 입력의 초기값이며 부식 수명 모델이 아닙니다."],
  },
  "open-plain": {
    id: "open-plain",
    labelKo: "평야·개방지",
    roughnessLengthM: 0.03,
    turbulenceIntensity: 0.12,
    groundAlbedo: 0.2,
    defaultSoilingLossFraction: 0.02,
    saltExposureFactor: 0,
    wakeModel: "engineering-approximation",
    assumptionsKo: ["균질한 개방 지표를 가정합니다."],
  },
  suburban: {
    id: "suburban",
    labelKo: "교외",
    roughnessLengthM: 0.3,
    turbulenceIntensity: 0.18,
    groundAlbedo: 0.18,
    defaultSoilingLossFraction: 0.03,
    saltExposureFactor: 0,
    wakeModel: "engineering-approximation",
    assumptionsKo: ["개별 건물 후류는 배치 장애물의 근사 감쇠로 계산합니다."],
  },
  urban: {
    id: "urban",
    labelKo: "도시",
    roughnessLengthM: 1,
    turbulenceIntensity: 0.25,
    groundAlbedo: 0.15,
    defaultSoilingLossFraction: 0.04,
    saltExposureFactor: 0,
    wakeModel: "engineering-approximation",
    assumptionsKo: ["도시 캐노피 유동은 CFD가 아닌 공학적 거칠기 근사입니다."],
  },
};

export function getEnvironmentPreset(name: EnvironmentPresetName): EnvironmentPreset {
  return structuredClone(ENVIRONMENT_PRESETS[name]);
}

const DEFAULT_OBSTACLE_SIZE: Record<ObstacleType, Vec3> = {
  mountain: [2, 1, 2],
  building: [0.4, 0.6, 0.4],
  tree: [0.3, 0.8, 0.3],
  wall: [1, 0.5, 0.1],
  ground: [10, 0.02, 10],
  water: [10, 0.01, 10],
  other: [0.3, 0.3, 0.3],
  gltf: [1, 1, 1],
};

let obstacleSequence = 0;
export function createObstacle(
  type: ObstacleType,
  patch: Partial<Omit<Obstacle, "type">> = {},
): Obstacle {
  obstacleSequence += 1;
  return {
    id: patch.id ?? `obstacle-${obstacleSequence}`,
    type,
    name: patch.name ?? type,
    position: patch.position ?? [0, 0, 0],
    quaternion: normalizeQuaternion(patch.quaternion ?? [0, 0, 0, 1]),
    sizeM: patch.sizeM ?? DEFAULT_OBSTACLE_SIZE[type],
    castsShadow: patch.castsShadow ?? !["water"].includes(type),
    ...(patch.assetId ? { assetId: patch.assetId } : {}),
  };
}

/** Conservative world AABB for a rotated local obstacle box. */
export function obstacleToAabb(obstacle: Obstacle): Aabb {
  const half: Vec3 = [obstacle.sizeM[0] / 2, obstacle.sizeM[1] / 2, obstacle.sizeM[2] / 2];
  const corners: Vec3[] = [];
  for (const x of [-half[0], half[0]]) {
    for (const y of [-half[1], half[1]]) {
      for (const z of [-half[2], half[2]]) {
        const rotated = rotateVector([x, y, z], obstacle.quaternion as Quaternion);
        corners.push([
          rotated[0] + obstacle.position[0],
          rotated[1] + obstacle.position[1],
          rotated[2] + obstacle.position[2],
        ]);
      }
    }
  }
  return {
    min: [
      Math.min(...corners.map((corner) => corner[0])),
      Math.min(...corners.map((corner) => corner[1])),
      Math.min(...corners.map((corner) => corner[2])),
    ],
    max: [
      Math.max(...corners.map((corner) => corner[0])),
      Math.max(...corners.map((corner) => corner[1])),
      Math.max(...corners.map((corner) => corner[2])),
    ],
  };
}
