import type { Quaternion, Vec3 } from "./types";

const EPSILON = 1e-12;

export function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale3(v: Vec3, scale: number): Vec3 {
  return [v[0] * scale, v[1] * scale, v[2] * scale];
}

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length3(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function normalize3(v: Vec3): Vec3 {
  const length = length3(v);
  if (!Number.isFinite(length) || length <= EPSILON) {
    throw new RangeError("0 또는 비유한 벡터는 정규화할 수 없습니다.");
  }
  return scale3(v, 1 / length);
}

export function normalizeQuaternion(q: Quaternion): Quaternion {
  const length = Math.hypot(q[0], q[1], q[2], q[3]);
  if (!Number.isFinite(length) || length <= EPSILON) {
    throw new RangeError("0 또는 비유한 쿼터니언은 정규화할 수 없습니다.");
  }
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

export function multiplyQuaternion(a: Quaternion, b: Quaternion): Quaternion {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return normalizeQuaternion([
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]);
}

export function quaternionFromAxisAngle(axis: Vec3, angleRad: number): Quaternion {
  const unit = normalize3(axis);
  const half = angleRad / 2;
  const sine = Math.sin(half);
  return normalizeQuaternion([
    unit[0] * sine,
    unit[1] * sine,
    unit[2] * sine,
    Math.cos(half),
  ]);
}

export function quaternionFromUnitVectors(from: Vec3, to: Vec3): Quaternion {
  const a = normalize3(from);
  const b = normalize3(to);
  const cosine = dot3(a, b);

  if (cosine < -1 + 1e-10) {
    const fallback: Vec3 = Math.abs(a[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
    return quaternionFromAxisAngle(normalize3(cross3(a, fallback)), Math.PI);
  }

  const axis = cross3(a, b);
  return normalizeQuaternion([axis[0], axis[1], axis[2], 1 + cosine]);
}

export function rotateVector(v: Vec3, quaternion: Quaternion): Vec3 {
  const q = normalizeQuaternion(quaternion);
  const u: Vec3 = [q[0], q[1], q[2]];
  const s = q[3];
  const uv = cross3(u, v);
  const uuv = cross3(u, uv);
  return add3(v, add3(scale3(uv, 2 * s), scale3(uuv, 2)));
}

export function quaternionFromNormal(normal: Vec3): Quaternion {
  return quaternionFromUnitVectors([0, 0, 1], normalize3(normal));
}

export function normalFromQuaternion(quaternion: Quaternion): Vec3 {
  return normalize3(rotateVector([0, 0, 1], quaternion));
}

export function tangentAxes(quaternion: Quaternion): readonly [Vec3, Vec3, Vec3] {
  return [
    normalize3(rotateVector([1, 0, 0], quaternion)),
    normalize3(rotateVector([0, 1, 0], quaternion)),
    normalFromQuaternion(quaternion),
  ];
}

export function isFiniteVec3(value: Vec3): boolean {
  return value.every(Number.isFinite);
}
