import { describe, expect, it } from "vitest";
import { createContinuousSurface, type ContinuousSurfaceKind } from "../src/lib/geometry";
import {
  DEFAULT_ELECTRICAL,
  DEFAULT_INVERTER,
  DEFAULT_THERMAL,
  simulateContinuousSurface,
  solarPosition,
} from "../src/lib/physics";
import { getOfflineWeather, type WeatherPoint } from "../src/lib/weather";

const KINDS: ContinuousSurfaceKind[] = ["sphere", "cylinder", "cone"];
const SEOUL = {
  latitudeDeg: 37.5665,
  longitudeDeg: 126.978,
  elevationM: 38,
} as const;
const CLEAR_DAYS = [
  {
    label: "summer-solstice",
    start: "2026-06-21T00:00:00+09:00",
    end: "2026-06-22T00:00:00+09:00",
  },
] as const;
const DAILY_INVERTER = {
  ...DEFAULT_INVERTER,
  ratedAcPowerW: 10,
  mpptMinVoltageV: 0.3,
  mpptMaxVoltageV: 20,
};

function run(
  kind: ContinuousSurfaceKind,
  patch: {
    elevationDeg?: number;
    azimuthDeg?: number;
    ghiWm2?: number;
    dniWm2?: number;
    dhiWm2?: number;
    rotationAngleRad?: number;
    azimuthSamples?: number;
    ambientTemperatureC?: number;
    windSpeedMS?: number;
  } = {},
) {
  return simulateContinuousSurface({
    surface: createContinuousSurface(kind, patch.azimuthSamples ?? 32),
    timestamp: "2026-06-21T03:30:00.000Z",
    solarOverride: {
      elevationDeg: patch.elevationDeg ?? 45,
      azimuthDeg: patch.azimuthDeg ?? 180,
    },
    irradiance: {
      ghiWm2: patch.ghiWm2 ?? 665.685,
      dniWm2: patch.dniWm2 ?? 800,
      dhiWm2: patch.dhiWm2 ?? 100,
    },
    weather: {
      ambientTemperatureC: patch.ambientTemperatureC ?? 25,
      referenceWindSpeedMS: patch.windSpeedMS ?? 2,
      referenceWindHeightM: 10,
      roughnessLengthM: 0.03,
      displacementHeightM: 0,
    },
    electricalConfig: DEFAULT_ELECTRICAL,
    thermal: DEFAULT_THERMAL,
    inverterConfig: { ...DEFAULT_INVERTER, ratedAcPowerW: 10, mpptMinVoltageV: 0.3, mpptMaxVoltageV: 20 },
    topology: "series",
    bypassEnabled: true,
    rotationAngleRad: patch.rotationAngleRad ?? 0,
    albedo: 0.2,
    iam: { model: "ashrae", b0: 0.05 },
    diffuseModel: "hay-davies",
    soilingLossFraction: 0.02,
  });
}

function trapezoidEnergyWh(series: readonly { timeUtcMs: number; powerW: number }[]): number {
  let energyWh = 0;
  for (let index = 1; index < series.length; index += 1) {
    const previous = series[index - 1];
    const current = series[index];
    const intervalHours = (current.timeUtcMs - previous.timeUtcMs) / 3_600_000;
    energyWh += (previous.powerW + current.powerW) * intervalHours / 2;
  }
  return energyWh;
}

function clearDayAcEnergyWh(
  kind: ContinuousSurfaceKind,
  azimuthSamples: number,
  weather: readonly WeatherPoint[],
): number {
  const surface = createContinuousSurface(kind, azimuthSamples);
  const powerSeries = weather.map((point) => {
    if (point.ghiWm2 === 0 && point.dniWm2 === 0 && point.dhiWm2 === 0) {
      return { timeUtcMs: point.timeUtcMs, powerW: 0 };
    }
    // Compute the shared Seoul ephemeris once per timestamp. Passing the
    // resulting angles through the public override avoids recalculating it at
    // every surface quadrature node while retaining the production optical and
    // electrical path below.
    const solar = solarPosition({
      timestamp: point.timeUtcMs,
      ...SEOUL,
      temperatureC: point.ambientC,
      applyRefraction: false,
    });
    const result = simulateContinuousSurface({
      surface,
      timestamp: point.timeUtcMs,
      solarOverride: {
        elevationDeg: solar.elevationDeg,
        azimuthDeg: solar.azimuthDeg,
      },
      irradiance: {
        ghiWm2: point.ghiWm2,
        dniWm2: point.dniWm2,
        dhiWm2: point.dhiWm2,
      },
      weather: {
        ambientTemperatureC: point.ambientC,
        referenceWindSpeedMS: point.windSpeedMs,
        referenceWindHeightM: 10,
        roughnessLengthM: 0.03,
        displacementHeightM: 0,
      },
      electricalConfig: DEFAULT_ELECTRICAL,
      thermal: DEFAULT_THERMAL,
      inverterConfig: DAILY_INVERTER,
      topology: "series",
      bypassEnabled: true,
      rotationAngleRad: 0,
      albedo: 0.2,
      iam: { model: "ashrae", b0: 0.05 },
      diffuseModel: "hay-davies",
      soilingLossFraction: 0.02,
    });
    return { timeUtcMs: point.timeUtcMs, powerW: result.sharedCircuit.acPowerW };
  });
  return trapezoidEnergyWh(powerSeries);
}

describe("continuous-surface optical/electrical integration", () => {
  it.each(KINDS)("returns finite nonnegative 20-zone results for %s", (kind) => {
    const result = run(kind);
    expect(result.zones).toHaveLength(20);
    expect(result.activeAreaM2).toBeCloseTo(0.05, 14);
    const values = [
      result.sharedCircuit.dcPowerW,
      result.sharedCircuit.acPowerW,
      result.independentMppt.dcPowerW,
      result.independentMppt.acPowerW,
      result.projectedAreaM2,
      ...result.zones.flatMap((zone) => [zone.averagePoaWm2, zone.averageTemperatureC, zone.operatingPowerW]),
    ];
    expect(values.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
    expect(result.independentMppt.dcPowerW + 1e-12).toBeGreaterThanOrEqual(result.sharedCircuit.dcPowerW);
    expect(result.independentMppt.mismatchLossW).toBe(0);
    expect(result.independentMppt.bypassLossW).toBe(0);
  });

  it.each(KINDS)("is exactly off at zero irradiance for %s", (kind) => {
    const result = run(kind, { ghiWm2: 0, dniWm2: 0, dhiWm2: 0 });
    expect(result.sharedCircuit.dcPowerW).toBe(0);
    expect(result.sharedCircuit.acPowerW).toBe(0);
    expect(result.independentMppt.dcPowerW).toBe(0);
    expect(result.independentMppt.acPowerW).toBe(0);
  });

  it.each(KINDS)("has zero direct POA below the horizon for %s", (kind) => {
    const result = run(kind, { elevationDeg: -1 });
    expect(result.zones.every((zone) => zone.averageDirectPoaWm2 === 0)).toBe(true);
  });

  it.each(KINDS)("closes the exclusive loss ledger to shared AC for %s", (kind) => {
    const result = run(kind);
    const ledger = result.lossLedger;
    const closed = ledger.solarResourceDcW
      - ledger.projectionLossW
      - ledger.iamLossW
      - ledger.externalOcclusionLossW
      - ledger.selfShadingLossW
      - ledger.soilingLossW
      - ledger.temperatureAndModelLossW
      - ledger.mismatchLossW
      - ledger.bypassLossW
      - ledger.inverterLossW;
    expect(closed).toBeCloseTo(result.sharedCircuit.acPowerW, 7);
  });

  it.each(KINDS)("keeps cold-cell gain signed while closing the %s loss ledger", (kind) => {
    const result = run(kind, {
      ambientTemperatureC: -20,
      windSpeedMS: 25,
    });
    const ledger = result.lossLedger;
    const closed = ledger.solarResourceDcW
      - ledger.projectionLossW
      - ledger.iamLossW
      - ledger.externalOcclusionLossW
      - ledger.selfShadingLossW
      - ledger.soilingLossW
      - ledger.temperatureAndModelLossW
      - ledger.mismatchLossW
      - ledger.bypassLossW
      - ledger.inverterLossW;

    expect(Math.max(...result.zones.map((zone) => zone.averageTemperatureC))).toBeLessThan(25);
    expect(ledger.temperatureAndModelLossW).toBeLessThan(0);
    expect(closed).toBeCloseTo(result.sharedCircuit.acPowerW, 7);
  });

  it.each(KINDS)("keeps total optical/electrical output within 0.5% under Y rotation for %s", (kind) => {
    const base = run(kind, { azimuthSamples: 64, rotationAngleRad: 0, azimuthDeg: 37 });
    const rotated = run(kind, { azimuthSamples: 64, rotationAngleRad: 1.234, azimuthDeg: 37 });
    expect(Math.abs(rotated.sharedCircuit.acPowerW - base.sharedCircuit.acPowerW) / Math.max(base.sharedCircuit.acPowerW, 1e-12)).toBeLessThan(0.005);
    expect(rotated.projectedAreaM2).toBeCloseTo(base.projectedAreaM2, 14);
  });

  it.each(KINDS)("converges %s clear-day AC energy within 0.5% from Nphi=32 to 64", (kind) => {
    for (const day of CLEAR_DAYS) {
      const weather = getOfflineWeather({
        ...SEOUL,
        start: day.start,
        end: day.end,
        stepMinutes: 10,
        seed: `continuous-surface-${day.label}`,
        offlinePreset: "clear",
      }, { now: new Date("2026-01-01T00:00:00.000Z") }).points;
      expect(weather).toHaveLength(145);
      expect(weather[1].timeUtcMs - weather[0].timeUtcMs).toBe(10 * 60_000);

      const coarseEnergyWh = clearDayAcEnergyWh(kind, 32, weather);
      const refinedEnergyWh = clearDayAcEnergyWh(kind, 64, weather);
      const relativeChange = Math.abs(refinedEnergyWh - coarseEnergyWh)
        / Math.max(refinedEnergyWh, coarseEnergyWh, 1e-12);

      expect(refinedEnergyWh, `${kind} ${day.label} 일일 AC 발전량`).toBeGreaterThan(0);
      expect(
        relativeChange,
        `${kind} ${day.label}: Nphi 32=${coarseEnergyWh} Wh, 64=${refinedEnergyWh} Wh`,
      ).toBeLessThan(0.005);
    }
  }, 30_000);
});
