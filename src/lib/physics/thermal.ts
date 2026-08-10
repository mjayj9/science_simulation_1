import { clamp } from "./types";

export interface ThermalConfig {
  u0Wm2K: number;
  u1WsM3K: number;
}

export const DEFAULT_THERMAL: Readonly<ThermalConfig> = Object.freeze({
  u0Wm2K: 25,
  u1WsM3K: 6.84,
});

export function faimanTemperature(
  ambientTemperatureC: number,
  poaIrradianceWm2: number,
  windSpeedMS: number,
  config: ThermalConfig = DEFAULT_THERMAL,
): number {
  const denominator = config.u0Wm2K + config.u1WsM3K * Math.max(0, windSpeedMS);
  if (!(denominator > 0) || !Number.isFinite(denominator)) {
    throw new RangeError("Faiman heat-transfer denominator must be positive");
  }
  return clamp(ambientTemperatureC + Math.max(0, poaIrradianceWm2) / denominator, -100, 200);
}
