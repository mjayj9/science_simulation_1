import { describe, expect, it } from "vitest";
import {
  createComparisonSurface,
  projectedAreaForDirection,
  type ComparisonShapeKind,
  type ComparisonSurfaceModel,
} from "../src/lib/geometry";
import {
  DEFAULT_ELECTRICAL,
  DEFAULT_INVERTER,
  DEFAULT_THERMAL,
  simulateContinuousSurface,
  solarPosition,
} from "../src/lib/physics";
import { getOfflineWeather, type WeatherPoint } from "../src/lib/weather";

const SHAPES: readonly ComparisonShapeKind[] = [
  "plane",
  "cube",
  "sphere",
  "hemisphere",
  "cylinder",
  "cone",
];

const SEOUL = {
  latitudeDeg: 37.5665,
  longitudeDeg: 126.978,
  elevationM: 38,
} as const;

const LAND_INPUT = {
  basis: "land" as const,
  landAreaM2: 0.05,
  maxHeightM: 1,
  maximumAspectRatio: 10,
  maximumActiveAreaM2: 1,
  cylinderHeightM: 0.2,
  coneHeightM: 0.2,
  groundClearanceM: 0.01,
};

function runSurface(
  surface: ComparisonSurfaceModel,
  patch: {
    timestamp?: number;
    elevationDeg?: number;
    azimuthDeg?: number;
    ghiWm2?: number;
    dniWm2?: number;
    dhiWm2?: number;
    albedo?: number;
    capGroundToParcel?: boolean;
    topology?: "series" | "parallel";
    bypassEnabled?: boolean;
  } = {},
) {
  const elevationDeg = patch.elevationDeg ?? 35;
  const dniWm2 = patch.dniWm2 ?? 800;
  const dhiWm2 = patch.dhiWm2 ?? 100;
  const ghiWm2 = patch.ghiWm2
    ?? dniWm2 * Math.max(0, Math.sin(elevationDeg * Math.PI / 180)) + dhiWm2;
  return simulateContinuousSurface({
    surface,
    timestamp: patch.timestamp ?? Date.UTC(2026, 5, 21, 3),
    solarOverride: {
      elevationDeg,
      azimuthDeg: patch.azimuthDeg ?? 145,
    },
    irradiance: { ghiWm2, dniWm2, dhiWm2 },
    weather: {
      ambientTemperatureC: 25,
      referenceWindSpeedMS: 2,
      referenceWindHeightM: 10,
      roughnessLengthM: 0.03,
      displacementHeightM: 0,
    },
    electricalConfig: DEFAULT_ELECTRICAL,
    thermal: DEFAULT_THERMAL,
    inverterConfig: DEFAULT_INVERTER,
    topology: patch.topology ?? "series",
    bypassEnabled: patch.bypassEnabled ?? true,
    albedo: patch.albedo ?? 0.2,
    iam: { model: "none" },
    diffuseModel: "isotropic",
    soilingLossFraction: 0,
    groundReflectorAreaM2: patch.capGroundToParcel === false
      ? undefined
      : surface.comparison.requestedLandAreaM2,
  });
}

function trapezoidWh(points: readonly { timeUtcMs: number; powerW: number }[]): number {
  let energyWh = 0;
  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1];
    const right = points[index];
    energyWh += (left.powerW + right.powerW) / 2
      * (right.timeUtcMs - left.timeUtcMs) / 3_600_000;
  }
  return energyWh;
}

function representativeYearWeather(): readonly {
  daysInMonth: number;
  points: readonly WeatherPoint[];
}[] {
  return Array.from({ length: 12 }, (_, month) => {
    const start = Date.UTC(2026, month, 14, 15); // 15th 00:00 in Asia/Seoul.
    const end = start + 24 * 3_600_000;
    return {
      daysInMonth: new Date(Date.UTC(2026, month + 1, 0)).getUTCDate(),
      points: getOfflineWeather({
        ...SEOUL,
        start,
        end,
        stepMinutes: 180,
        offlinePreset: "clear",
        seed: `land-area-convergence-${month + 1}`,
      }, { now: new Date(0) }).points,
    };
  });
}

function representativeYearAcWh(
  shape: ComparisonShapeKind,
  azimuthSamples: number,
  weather: ReturnType<typeof representativeYearWeather>,
): number {
  const surface = createComparisonSurface(shape, {
    ...LAND_INPUT,
    azimuthSamples,
  });
  return weather.reduce((annualWh, month) => {
    const points = month.points.map((point) => {
      if (point.ghiWm2 === 0 && point.dniWm2 === 0 && point.dhiWm2 === 0) {
        return { timeUtcMs: point.timeUtcMs, powerW: 0 };
      }
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
        inverterConfig: DEFAULT_INVERTER,
        topology: "series",
        bypassEnabled: true,
        albedo: 0.2,
        iam: { model: "ashrae", b0: 0.05 },
        diffuseModel: "hay-davies",
        soilingLossFraction: 0.02,
        groundReflectorAreaM2: surface.comparison.requestedLandAreaM2,
      });
      return { timeUtcMs: point.timeUtcMs, powerW: result.sharedCircuit.acPowerW };
    });
    return annualWh + trapezoidWh(points) * month.daysInMonth;
  }, 0);
}

describe("equal-land mandatory acceptance gaps", () => {
  it("uses the maximum swept occupation as A_land for rotating comparisons", () => {
    const requestedLandAreaM2 = 0.2;
    for (const shape of SHAPES) {
      const surface = createComparisonSurface(shape, {
        ...LAND_INPUT,
        landAreaM2: requestedLandAreaM2,
        footprintMode: "swept",
      });
      const geometry = surface.comparison;
      expect(geometry.requestedLandAreaM2, shape).toBe(requestedLandAreaM2);
      expect(geometry.footprint.selectedMode, shape).toBe("swept");
      expect(geometry.landAreaM2, shape).toBeCloseTo(requestedLandAreaM2, 13);
      expect(geometry.footprint.staticProjectedAreaM2, shape)
        .toBeLessThanOrEqual(requestedLandAreaM2 + 1e-12);
      expect(geometry.footprint.sweptAreaM2, shape)
        .toBeCloseTo(requestedLandAreaM2, 13);
      expect(geometry.footprintIndex, shape).toBeCloseTo(100, 11);
      expect(Number.isFinite(geometry.footprint.sweptAreaM2), shape).toBe(true);
      expect(geometry.footprint.sweptAreaM2, shape).toBeCloseTo(geometry.landAreaM2, 13);
    }
  });

  it("closes the no-reflector complete-sphere direct optical budget at A_land", () => {
    const surface = createComparisonSurface("sphere", {
      ...LAND_INPUT,
      azimuthSamples: 64,
    });
    const elevationDeg = 41;
    const azimuthDeg = 133;
    const dniWm2 = 900;
    const direction = [
      Math.sin(azimuthDeg * Math.PI / 180) * Math.cos(elevationDeg * Math.PI / 180),
      Math.sin(elevationDeg * Math.PI / 180),
      Math.cos(azimuthDeg * Math.PI / 180) * Math.cos(elevationDeg * Math.PI / 180),
    ] as const;
    const result = runSurface(surface, {
      elevationDeg,
      azimuthDeg,
      dniWm2,
      dhiWm2: 0,
      albedo: 0,
      capGroundToParcel: false,
    });
    const directOpticalW = result.zones.reduce(
      (sum, zone) => sum + zone.averageDirectPoaWm2 * zone.areaM2,
      0,
    );

    expect(projectedAreaForDirection(surface, [...direction])).toBeCloseTo(
      surface.comparison.requestedLandAreaM2,
      14,
    );
    const expectedDirectOpticalW = dniWm2 * surface.comparison.requestedLandAreaM2;
    expect(Math.abs(directOpticalW - expectedDirectOpticalW) / expectedDirectOpticalW)
      .toBeLessThan(0.001);
    expect(result.zones.every((zone) => (
      zone.averageDiffusePoaWm2 === 0 && zone.averageGroundPoaWm2 === 0
    ))).toBe(true);
  });

  it.each(SHAPES)("keeps %s night output exact-zero, daytime output finite, and reruns deterministic", (shape) => {
    const surface = createComparisonSurface(shape, LAND_INPUT);
    const night = runSurface(surface, {
      elevationDeg: -5,
      ghiWm2: 900,
      dniWm2: 800,
      dhiWm2: 100,
    });
    expect([
      night.sharedCircuit.dcPowerW,
      night.sharedCircuit.acPowerW,
      night.independentMppt.dcPowerW,
      night.independentMppt.acPowerW,
      ...night.zones.flatMap((zone) => [
        zone.averagePoaWm2,
        zone.averageDirectPoaWm2,
        zone.averageDiffusePoaWm2,
        zone.averageGroundPoaWm2,
      ]),
    ].every((value) => value === 0)).toBe(true);

    const first = runSurface(surface);
    const second = runSurface(surface);
    const outputs = [
      first.sharedCircuit.dcPowerW,
      first.sharedCircuit.acPowerW,
      first.independentMppt.dcPowerW,
      first.independentMppt.acPowerW,
      first.projectedAreaM2,
      first.activeAreaM2,
      ...first.zones.flatMap((zone) => [
        zone.averagePoaWm2,
        zone.averageDirectPoaWm2,
        zone.averageDiffusePoaWm2,
        zone.averageGroundPoaWm2,
        zone.operatingPowerW,
      ]),
    ];
    expect(outputs.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
    expect(second).toEqual(first);
  });

  it("keeps the 12-representative-day annual AC estimate within 0.5% for Nphi=32 to 64", () => {
    const weather = representativeYearWeather();
    for (const shape of SHAPES) {
      const coarseWh = representativeYearAcWh(shape, 32, weather);
      const refinedWh = representativeYearAcWh(shape, 64, weather);
      const relativeChange = Math.abs(refinedWh - coarseWh)
        / Math.max(refinedWh, coarseWh, 1e-12);
      expect(refinedWh, `${shape} representative-year AC`).toBeGreaterThan(0);
      expect(
        relativeChange,
        `${shape}: Nphi 32=${coarseWh} Wh, 64=${refinedWh} Wh`,
      ).toBeLessThan(0.005);
    }
  }, 120_000);

  it.each(["sphere", "hemisphere"] as const)(
    "does not manufacture panel-series mismatch on one continuous %s skin",
    (shape) => {
      const result = runSurface(createComparisonSurface(shape, LAND_INPUT), {
        elevationDeg: 22,
        azimuthDeg: 105,
        ghiWm2: 360,
        dniWm2: 700,
        dhiWm2: 100,
      });
      expect(result.sharedCircuit.mode).toBe("independent-mppt");
      expect(result.independentMppt.mode).toBe("independent-mppt");
      expect(result.sharedCircuit).toEqual(result.independentMppt);
      expect(result.sharedCircuit.mismatchLossW).toBe(0);
      expect(result.sharedCircuit.bypassLossW).toBe(0);
      expect(result.independentMppt.mismatchLossW).toBe(0);
      expect(result.independentMppt.bypassLossW).toBe(0);
    },
  );

  it.each(SHAPES)("ignores legacy topology and bypass settings for the ideal %s skin", (shape) => {
    const surface = createComparisonSurface(shape, LAND_INPUT);
    const seriesWithBypass = runSurface(surface, {
      elevationDeg: 22,
      azimuthDeg: 105,
      ghiWm2: 360,
      dniWm2: 700,
      dhiWm2: 100,
      topology: "series",
      bypassEnabled: true,
    });
    const parallelWithoutBypass = runSurface(surface, {
      elevationDeg: 22,
      azimuthDeg: 105,
      ghiWm2: 360,
      dniWm2: 700,
      dhiWm2: 100,
      topology: "parallel",
      bypassEnabled: false,
    });

    expect(parallelWithoutBypass.independentMppt).toEqual(seriesWithBypass.independentMppt);
    expect(parallelWithoutBypass.sharedCircuit).toEqual(seriesWithBypass.sharedCircuit);
    expect(parallelWithoutBypass.zones.every((zone) => !zone.bypassActive)).toBe(true);
  });

  it.each(SHAPES)("has no isolated physical-series spike or dropout for %s", (shape) => {
    const surface = createComparisonSurface(shape, LAND_INPUT);
    const series = Array.from({ length: 37 }, (_, index) => {
      const phase = index / 36;
      const elevationDeg = 2 + 65 * Math.sin(Math.PI * phase);
      const azimuthDeg = 90 + 180 * phase;
      const result = runSurface(surface, {
        elevationDeg,
        azimuthDeg,
        dniWm2: 800,
        dhiWm2: 100,
      });
      return {
        sharedAcW: result.sharedCircuit.acPowerW,
        independentAcW: result.independentMppt.acPowerW,
        opticalW: result.zones.reduce(
          (sum, zone) => sum + zone.averagePoaWm2 * zone.areaM2,
          0,
        ),
      };
    });

    expect(series.flatMap(Object.values).every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
    for (const key of ["sharedAcW", "independentAcW", "opticalW"] as const) {
      for (let index = 1; index < series.length - 1; index += 1) {
        const previous = series[index - 1][key];
        const current = series[index][key];
        const next = series[index + 1][key];
        expect(current === 0 && previous > 1e-9 && next > 1e-9, `${shape}.${key}[${index}] dropout`).toBe(false);
        expect(
          current,
          `${shape}.${key}[${index}] spike: ${previous}, ${current}, ${next}`,
        ).toBeLessThanOrEqual(Math.max(previous, next) * 1.25 + 1e-9);
      }
    }
  }, 30_000);
});
