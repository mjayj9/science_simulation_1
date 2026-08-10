export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const BOLTZMANN_J_K = 1.380649e-23;
export const ELEMENTARY_CHARGE_C = 1.602176634e-19;
export const BOLTZMANN_EV_K = 8.617333262145e-5;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface ModelDescriptor {
  id: string;
  version: string;
  titleKo: string;
  expression: string;
  variables: Array<{ symbol: string; labelKo: string; unit: string }>;
  sourceUrls: string[];
  assumptionsKo: string[];
  limitationsKo: string[];
}

export interface TraceStage {
  modelId: string;
  inputs: Record<string, number | string | boolean>;
  outputs: Record<string, number | string | boolean>;
}

export function assertFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite`);
  }
  return value;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

export function nearlyEqual(a: number, b: number, tolerance = 1e-9): boolean {
  return Math.abs(a - b) <= tolerance;
}
