import type { Quaternion, Vec3 } from "./types";
import { cross, dot, normalize, scale } from "./vector";

export const IDENTITY_QUATERNION: Readonly<Quaternion> = Object.freeze({
  x: 0,
  y: 0,
  z: 0,
  w: 1,
});

export function normalizeQuaternion(q: Quaternion): Quaternion {
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  if (!(length > 0) || !Number.isFinite(length)) {
    throw new RangeError("Cannot normalize a zero or non-finite quaternion");
  }
  return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
}

export function quaternionFromAxisAngle(axis: Vec3, angleRad: number): Quaternion {
  const unit = normalize(axis);
  const half = angleRad / 2;
  const s = Math.sin(half);
  return { x: unit.x * s, y: unit.y * s, z: unit.z * s, w: Math.cos(half) };
}

export function multiplyQuaternion(a: Quaternion, b: Quaternion): Quaternion {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function conjugateQuaternion(q: Quaternion): Quaternion {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

export function rotateVector(qInput: Quaternion, v: Vec3): Vec3 {
  const q = normalizeQuaternion(qInput);
  const qv = { x: q.x, y: q.y, z: q.z };
  const t = scale(cross(qv, v), 2);
  return {
    x: v.x + q.w * t.x + cross(qv, t).x,
    y: v.y + q.w * t.y + cross(qv, t).y,
    z: v.z + q.w * t.z + cross(qv, t).z,
  };
}

export function quaternionBetween(from: Vec3, to: Vec3): Quaternion {
  const a = normalize(from);
  const b = normalize(to);
  const cosine = dot(a, b);
  if (cosine < -0.999999) {
    const axis = Math.abs(a.x) < 0.9 ? cross(a, { x: 1, y: 0, z: 0 }) : cross(a, { x: 0, y: 1, z: 0 });
    return quaternionFromAxisAngle(axis, Math.PI);
  }
  const axis = cross(a, b);
  return normalizeQuaternion({ x: axis.x, y: axis.y, z: axis.z, w: 1 + cosine });
}
