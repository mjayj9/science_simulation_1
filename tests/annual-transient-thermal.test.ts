import { describe, expect, it } from "vitest";
import { createComparisonSurface } from "../src/lib/geometry";
import {
  ANNUAL_TRANSIENT_ROTATION_THERMAL_LABEL_KO,
  QUASI_STEADY_ROTATION_THERMAL_LABEL_KO,
  auditAnnualThermalMeshConvergence,
  createAnnualReducedThermalMesh,
  simulateAnnualRotationDecomposition,
  simulateAnnualTransientSurface,
  thermalModelMetadata,
} from "../src/lib/physics/annual-transient";
import type { WeatherPoint } from "../src/lib/weather";

const point = (
  timeUtcMs: number,
  patch: Partial<Omit<WeatherPoint, "timeUtcMs">> = {},
): WeatherPoint => ({
  timeUtcMs,
  ghiWm2: 0,
  dniWm2: 0,
  dhiWm2: 0,
  ambientC: 25,
  windSpeedMs: 0,
  windDirectionDeg: 180,
  gustMs: 0,
  cloudFraction: 0,
  precipitationMm: 0,
  ...patch,
});

const boundaries = (
  startMs: number,
  hours: number,
  patch: Partial<Omit<WeatherPoint, "timeUtcMs">> = {},
): WeatherPoint[] => Array.from(
  { length: hours + 1 },
  (_, index) => point(startMs + index * 3_600_000, patch),
);

const plane = () => createComparisonSurface("plane", {
  landAreaM2: 0.05,
  planeTiltDeg: 30,
  planeAzimuthDeg: 180,
  azimuthSamples: 16,
  meridionalSegments: 4,
});

const steadyThermalConfig = {
  arealHeatCapacityJm2K: 1e9,
  emissivity: 0,
  backConvectionFactor: 0,
  minimumConvectionWm2K: 0,
  maximumSubstepSeconds: 3_600,
} as const;

describe("actual-clock annual transient thermal integration", () => {
  it("exposes an unambiguous quasi-steady label contract", () => {
    expect(thermalModelMetadata("quasi-steady-faiman")).toEqual({
      model: "quasi-steady-faiman",
      labelKo: QUASI_STEADY_ROTATION_THERMAL_LABEL_KO,
      includesThermalHistory: false,
      periodIntegration: "pointwise-quasi-steady",
    });
    expect(thermalModelMetadata("annual-transient-material-state").labelKo)
      .toBe(ANNUAL_TRANSIENT_ROTATION_THERMAL_LABEL_KO);
  });

  it("uses a reduced thermal graph while retaining every optical quadrature sample", () => {
    const surface = createComparisonSurface("cylinder", {
      landAreaM2: 0.05,
      azimuthSamples: 16,
      meridionalSegments: 4,
    });
    const mesh = createAnnualReducedThermalMesh(surface, 25, {
      targetNodeCount: 6,
      neighboursPerNode: 2,
    });
    expect(mesh.thermalNodeCount).toBe(6);
    expect(mesh.opticalSampleCount).toBeGreaterThan(mesh.thermalNodeCount);
    expect(mesh.edges.length).toBeGreaterThanOrEqual(mesh.thermalNodeCount - 1);
    expect(mesh.nodes.reduce((sum, node) => sum + node.areaM2, 0))
      .toBeCloseTo(surface.dimensions.activeAreaM2, 12);
    expect(Object.values(mesh.opticalSamplesByNodeId).flat()).toHaveLength(mesh.opticalSampleCount);
    expect(mesh.edges.every((edge) => edge.conductanceWPerK > 0)).toBe(true);
  });

  it("removes initial-temperature influence with periodic warm-up and approaches steady ambient", () => {
    const start = Date.UTC(2026, 0, 1);
    const result = simulateAnnualTransientSurface({
      surface: plane(),
      weather: boundaries(start, 24),
      location: { latitudeDeg: 37.5665, longitudeDeg: 126.978 },
      rpm: 0,
      referenceEfficiency: 0.2,
      gammaPerC: -0.004,
      initialTemperatureC: 65,
      effectiveSkyTemperatureOffsetC: 0,
      radiativeSurfaceFactor: 0,
      inverter: false,
      thermalMesh: { targetNodeCount: 4 },
      thermalConfig: { maximumSubstepSeconds: 120 },
      warmup: {
        periodHours: 6,
        minimumCycles: 2,
        maximumCycles: 12,
        convergenceToleranceC: 0.02,
      },
    });
    expect(result.warmup.converged).toBe(true);
    expect(result.warmup.cycles).toBeGreaterThanOrEqual(2);
    expect(result.warmup.terminalMaximumDeltaC).toBeLessThanOrEqual(0.02);
    expect(Math.max(...Object.values(result.finalTemperatureCByNode))).toBeCloseTo(25, 3);
  });

  it("repeats the same non-integer-turn phase during every warm-up cycle", () => {
    const start = Date.UTC(2026, 5, 20, 1);
    const weather = boundaries(start, 3, {
      ghiWm2: 550,
      dniWm2: 0,
      dhiWm2: 550,
      ambientC: 25,
      windSpeedMs: 0.5,
      gustMs: 0.5,
    });
    const base = {
      surface: plane(),
      weather,
      location: { latitudeDeg: 37.5665, longitudeDeg: 126.978 },
      // 0.013 RPM is 0.78 turns/hour, so accumulated-cycle phase differs.
      rpm: 0.013,
      referenceEfficiency: 0.2,
      gammaPerC: -0.004,
      inverter: false as const,
      initialTemperatureC: 45,
      thermalMesh: { targetNodeCount: 2 },
      thermalConfig: { maximumSubstepSeconds: 120 },
      opticalPhaseSamples: 6,
      convectionPhaseSamples: 6,
    };
    const twoCycles = simulateAnnualTransientSurface({
      ...base,
      warmup: {
        periodHours: 1,
        minimumCycles: 2,
        maximumCycles: 2,
        convergenceToleranceC: 1e-12,
      },
    });
    const firstCycle = simulateAnnualTransientSurface({
      ...base,
      warmup: {
        periodHours: 1,
        minimumCycles: 1,
        maximumCycles: 1,
        convergenceToleranceC: 1e-12,
      },
    });
    expect(twoCycles.warmup.cycles).toBe(2);
    expect(firstCycle.warmup.cycles).toBe(1);
    expect(twoCycles.warmup.terminalMaximumDeltaC).toBeLessThan(
      firstCycle.warmup.terminalMaximumDeltaC,
    );
  });

  it("carries state across every interval and closes the heat-energy ledger", () => {
    const start = Date.UTC(2026, 5, 20);
    const weather = boundaries(start, 12).map((entry, index) => ({
      ...entry,
      ghiWm2: index >= 2 && index <= 10 ? 600 : 0,
      dniWm2: 0,
      dhiWm2: index >= 2 && index <= 10 ? 600 : 0,
      ambientC: 20 + 8 * Math.sin(Math.PI * index / 12),
      windSpeedMs: 1.5,
      gustMs: 1.5,
    }));
    const result = simulateAnnualTransientSurface({
      surface: plane(),
      weather,
      location: { latitudeDeg: 37.5665, longitudeDeg: 126.978 },
      rpm: 2,
      referenceEfficiency: 0.2,
      gammaPerC: -0.004,
      inverter: false,
      thermalMesh: { targetNodeCount: 6 },
      thermalConfig: { maximumSubstepSeconds: 120 },
      warmup: false,
    });
    expect(result.dcEnergyWh).toBeGreaterThan(0);
    expect(result.acEnergyWh).toBe(result.dcEnergyWh);
    expect(result.absorbedSolarEnergyWh).toBeGreaterThan(result.dcEnergyWh);
    expect(result.energyAudit.relativeEnergyResidual).toBeLessThan(1e-10);
    expect(Math.abs(result.energyAudit.conductionCancellationJ)).toBeLessThan(1e-8);
    expect(result.coverage.intervals).toBe(12);
    expect(result.coverage.durationHours).toBe(12);
    expect(result.monthly).toHaveLength(1);
  });

  it("computes monthly and period E00/E10/E01/E11 with exact factorial closure", () => {
    const start = Date.UTC(2026, 5, 20);
    const surface = createComparisonSurface("cylinder", {
      landAreaM2: 0.05,
      azimuthSamples: 16,
      meridionalSegments: 4,
    });
    const weather = boundaries(start, 24).map((entry, index) => ({
      ...entry,
      ghiWm2: index >= 4 && index <= 18 ? 550 : 0,
      dniWm2: 0,
      dhiWm2: index >= 4 && index <= 18 ? 550 : 0,
      ambientC: 23,
      windSpeedMs: 1,
      gustMs: 1,
    }));
    const result = simulateAnnualRotationDecomposition({
      surface,
      weather,
      location: { latitudeDeg: 37.5665, longitudeDeg: 126.978 },
      rpm: 2,
      referenceEfficiency: 0.2,
      gammaPerC: -0.004,
      inverter: false,
      diffuseModel: "isotropic",
      thermalMesh: { targetNodeCount: 4 },
      thermalConfig: { maximumSubstepSeconds: 300 },
      warmup: false,
      opticalPhaseSamples: 8,
      convectionPhaseSamples: 8,
    });
    expect(result.annual.closureResidualWh).toBeCloseTo(0, 12);
    expect(result.annual.opticalWh + result.annual.thermalWh + result.annual.interactionWh)
      .toBeCloseTo(result.annual.netWh, 12);
    expect(result.monthly).toHaveLength(1);
    expect(result.monthly[0].closureResidualWh).toBeCloseTo(0, 12);
    expect(result.e11.coverage.intervals).toBe(24);
  });

  it("makes all four histories identical when every interval has zero RPM", () => {
    const start = Date.UTC(2026, 0, 1);
    const result = simulateAnnualRotationDecomposition({
      surface: plane(),
      weather: boundaries(start, 6, { ghiWm2: 300, dniWm2: 0, dhiWm2: 300 }),
      location: { latitudeDeg: 0, longitudeDeg: 0 },
      rpm: 0,
      referenceEfficiency: 0.2,
      gammaPerC: -0.004,
      inverter: false,
      thermalMesh: { targetNodeCount: 2 },
      thermalConfig: { maximumSubstepSeconds: 300 },
      warmup: false,
    });
    expect(result.annual.e10Wh).toBe(result.annual.e00Wh);
    expect(result.annual.e01Wh).toBe(result.annual.e00Wh);
    expect(result.annual.e11Wh).toBe(result.annual.e00Wh);
    expect(Object.values(result.annual).every((value) => value === 0 || value === result.annual.e00Wh))
      .toBe(true);
  });

  it("recognizes 8760/8784-hour clocks only when the closing endpoint is supplied", () => {
    const runCalendar = (year: number, hours: 8760 | 8784) => simulateAnnualTransientSurface({
      surface: plane(),
      weather: boundaries(Date.UTC(year, 0, 1), hours),
      location: { latitudeDeg: 37.5665, longitudeDeg: 126.978 },
      rpm: 0,
      referenceEfficiency: 0.2,
      gammaPerC: -0.004,
      inverter: false,
      thermalMesh: { targetNodeCount: 1 },
      thermalConfig: steadyThermalConfig,
      warmup: false,
    });
    const common = runCalendar(2025, 8760);
    const leap = runCalendar(2024, 8784);
    expect(common.coverage).toMatchObject({
      steps: 8761,
      intervals: 8760,
      durationHours: 8760,
      expectedCalendarHours: 8760,
      isFullCalendarYear: true,
      closingEndpointPresent: true,
    });
    expect(leap.coverage).toMatchObject({
      steps: 8785,
      intervals: 8784,
      durationHours: 8784,
      expectedCalendarHours: 8784,
      isFullCalendarYear: true,
      closingEndpointPresent: true,
    });
  }, 30_000);

  it("reports deterministic thermal-mesh convergence with residuals", () => {
    const start = Date.UTC(2026, 5, 20, 3);
    const input = {
      surface: plane(),
      weather: boundaries(start, 4, { ghiWm2: 500, dniWm2: 0, dhiWm2: 500, windSpeedMs: 1 }),
      location: { latitudeDeg: 37.5665, longitudeDeg: 126.978 },
      rpm: 0,
      referenceEfficiency: 0.2,
      gammaPerC: -0.004,
      inverter: false as const,
      diffuseModel: "isotropic" as const,
      thermalConfig: { maximumSubstepSeconds: 120 },
      warmup: false as const,
    };
    const first = auditAnnualThermalMeshConvergence(input, [2, 4, 8], 0.02, 0.25);
    const second = auditAnnualThermalMeshConvergence(input, [2, 4, 8], 0.02, 0.25);
    expect(first).toEqual(second);
    expect(first.points).toHaveLength(3);
    expect(first.points.every((entry) => entry.relativeEnergyResidual < 1e-10)).toBe(true);
    expect(first.converged).toBe(true);
  }, 30_000);
});
