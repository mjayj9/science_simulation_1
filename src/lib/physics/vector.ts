import { assertFinite, clamp, type Vec3 } from "./types";

export const ZERO_VEC3: Readonly<Vec3> = Object.freeze({ x: 0, y: 0, z: 0 });
export const UP_VEC3: Readonly<Vec3> = Object.freeze({ x: 0, y: 1, z: 0 });

export function vec3(x: number, y: number, z: number): Vec3 {
  return {
    x: assertFinite(x, "x"),
    y: assertFinite(y, "y"),
    z: assertFinite(z, "z"),
  };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(v: Vec3, factor: number): Vec3 {
  return { x: v.x * factor, y: v.y * factor, z: v.z * factor };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function magnitudeSquared(v: Vec3): number {
  return dot(v, v);
}

export function magnitude(v: Vec3): number {
  return Math.sqrt(magnitudeSquared(v));
}

export function normalize(v: Vec3): Vec3 {
  const length = magnitude(v);
  if (!(length > 0) || !Number.isFinite(length)) {
    throw new RangeError("Cannot normalize a zero or non-finite vector");
  }
  return scale(v, 1 / length);
}

export function safeNormalize(v: Vec3, fallback: Vec3 = { x: 0, y: 1, z: 0 }): Vec3 {
  const length = magnitude(v);
  return length > 1e-15 && Number.isFinite(length) ? scale(v, 1 / length) : { ...fallback };
}

export function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(clamp(dot(normalize(a), normalize(b)), -1, 1));
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export function rotateAroundY(v: Vec3, angleRad: number): Vec3 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return { x: c * v.x + s * v.z, y: v.y, z: -s * v.x + c * v.z };
}
