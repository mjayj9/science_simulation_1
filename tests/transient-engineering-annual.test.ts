import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createComparisonSurface } from "../src/lib/geometry";
import {
  DEFAULT_ELECTRICAL,
  OFFICIAL_ENGINEERING_SURFACE_CONNECTION,
  calculatePOA,
  createEngineeringSurfaceCellLayout,
  engineeringSurfaceSpatialKey,
  materialPoseAtWorldYPhase,
  annualTransientPhaseAtInterval,
  mergeAnnualTransientSurfaceSegments,
  simulateAnnualRotationDecomposition,
  simulateAnnualTransientSurface,
  solarPosition,
  solveEngineeringSurfaceElectrical,
  sunVector,
  type AnnualTransientSurfaceInput,
} from "../src/lib/physics";
import type { WeatherPoint } from "../src/lib/weather";
import {
  createContinuousSurfaceWorkItem,
  createSimulationRunRequest,
  runSimulationKernel,
  type SimulationKernelInput,
} from "../src/workers";

const HOUR_MS = 3_600_000;

function weatherBoundaries(hours: number): WeatherPoint[] {
  const start = Date.UTC(2026, 2, 20, 10);
  return Array.from({ length: hours + 1 }, (_, index) => ({
    timeUtcMs: start + index * HOUR_MS,
    ghiWm2: 800,
    dniWm2: 700,
    dhiWm2: 100,
    ambientC: 25,
    windSpeedMs: 1,
    windDirectionDeg: 180,
    gustMs: 1,
    cloudFraction: 0,
    precipitationMm: 0,
  }));
}

function coupledInput(hours = 2): AnnualTransientSurfaceInput {
  const surface = createComparisonSurface("cylinder", {
    landAreaM2: 0.05,
    azimuthSamples: 16,
    meridionalSegments: 8,
  });
  return {
    surface,
    weather: weatherBoundaries(hours),
    location: { latitudeDeg: 0, longitudeDeg: 0 },
    rpm: 0,
    referenceEfficiency: 0.2,
    gammaPerC: -0.004,
    referenceTemperatureC: 25,
    absorptivity: 0.9,
    electricalAvailabilityFactor: 1,
    albedo: 0.2,
    iam: { model: "none" },
    diffuseModel: "isotropic",
    inverter: false,
    engineeringElectrical: {
      referenceCell: {
        ...DEFAULT_ELECTRICAL,
        efficiency: 0.2,
        pmaxW: DEFAULT_ELECTRICAL.areaM2 * 0.2
          * DEFAULT_ELECTRICAL.referenceIrradianceWm2,
        gammaPmpPerC: -0.004,
        cellsInSeries: 1,
      },
      connection: OFFICIAL_ENGINEERING_SURFACE_CONNECTION,
      maximumCouplingStepSeconds: 900,
    },
    thermalMesh: { targetNodeCount: 4 },
    thermalConfig: {
      arealHeatCapacityJm2K: 1e12,
      emissivity: 0,
      backConvectionFactor: 0,
      minimumConvectionWm2K: 0,
      maximumSubstepSeconds: 300,
    },
    opticalPhaseSamples: 4,
    convectionPhaseSamples: 4,
    warmup: false,
  };
}

describe("actual-clock transient thermal + engineering circuit", () => {
  it("feeds persistent thermal-node temperatures into cell I-V and closes terminal extraction", () => {
    const cold = simulateAnnualTransientSurface({
      ...coupledInput(),
      initialTemperatureC: 5,
    });
    const hot = simulateAnnualTransientSurface({
      ...coupledInput(),
      initialTemperatureC: 65,
    });

    expect(cold.electricalModel).toBe("explicit-series-parallel-bypass");
    expect(cold.engineeringCircuit).toBeDefined();
    expect(cold.engineeringCircuit?.cellCount).toBeGreaterThan(0);
    expect(cold.engineeringCircuit?.parallelStringCount)
      .toBe(OFFICIAL_ENGINEERING_SURFACE_CONNECTION.parallelStrings);
    expect(cold.engineeringCircuit?.maximumCouplingStepSeconds).toBe(900);
    expect(cold.engineeringCircuit?.circuitSolveCount).toBe(8);
    expect(cold.engineeringCircuit?.maximumElectricalExtractionClosureErrorW)
      .toBeLessThan(1e-9);
    expect(cold.idealLocalMppDcEnergyWh).toBeGreaterThanOrEqual(cold.dcEnergyWh);
    expect(cold.mismatchAndWiringLossEnergyWh)
      .toBeCloseTo(cold.idealLocalMppDcEnergyWh - cold.dcEnergyWh, 9);
    expect(cold.monthly[0].dcEnergyWh).toBeCloseTo(cold.dcEnergyWh, 10);
    expect(cold.monthly[0].idealLocalMppDcEnergyWh)
      .toBeCloseTo(cold.idealLocalMppDcEnergyWh, 10);
    expect(cold.energyAudit.relativeEnergyResidual).toBeLessThan(1e-9);
    expect(hot.dcEnergyWh).toBeLessThan(cold.dcEnergyWh);
  }, 30_000);

  it("carries the engineering thermal state across intervals and supports exact chunk restart", () => {
    const continuousInput: AnnualTransientSurfaceInput = {
      ...coupledInput(2),
      initialTemperatureC: 25,
      thermalConfig: {
        arealHeatCapacityJm2K: 100_000,
        emissivity: 0,
        backConvectionFactor: 0,
        minimumConvectionWm2K: 0,
        maximumSubstepSeconds: 60,
      },
    };
    const continuous = simulateAnnualTransientSurface(continuousInput);
    const first = simulateAnnualTransientSurface({
      ...continuousInput,
      weather: continuousInput.weather.slice(0, 2),
    });
    const restartedSecond = simulateAnnualTransientSurface({
      ...continuousInput,
      weather: continuousInput.weather.slice(1, 3),
      initialTemperatureCByNode: first.finalTemperatureCByNode,
    });
    const resetSecond = simulateAnnualTransientSurface({
      ...continuousInput,
      weather: continuousInput.weather.slice(1, 3),
    });

    expect(first.dcEnergyWh + restartedSecond.dcEnergyWh)
      .toBeCloseTo(continuous.dcEnergyWh, 10);
    expect(first.acEnergyWh + restartedSecond.acEnergyWh)
      .toBeCloseTo(continuous.acEnergyWh, 10);
    expect(first.absorbedSolarEnergyWh + restartedSecond.absorbedSolarEnergyWh)
      .toBeCloseTo(continuous.absorbedSolarEnergyWh, 10);
    expect(restartedSecond.finalTemperatureCByNode)
      .toEqual(continuous.finalTemperatureCByNode);
    expect(Math.abs(
      first.dcEnergyWh + resetSecond.dcEnergyWh - continuous.dcEnergyWh,
    )).toBeGreaterThan(1e-5);
    expect(() => simulateAnnualTransientSurface({
      ...continuousInput,
      weather: continuousInput.weather.slice(1, 3),
      initialTemperatureCByNode: { unknown: 25 },
    })).toThrow(/checkpoint keys must exactly match/);
  }, 30_000);

  it("matches a 48 h monolith across exact phase/state segments and rejects tampering", () => {
    const base: AnnualTransientSurfaceInput = {
      ...coupledInput(48),
      surface: createComparisonSurface("plane", {
        landAreaM2: 0.05,
        planeTiltDeg: 35,
        planeAzimuthDeg: 180,
        azimuthSamples: 16,
        meridionalSegments: 8,
      }),
      rpm: 0.013,
      initialPhaseRad: 0.37,
      opticalPhaseSamples: 8,
      convectionPhaseSamples: 8,
      engineeringElectrical: {
        ...coupledInput(48).engineeringElectrical!,
        maximumCouplingStepSeconds: 3_600,
      },
      thermalConfig: {
        arealHeatCapacityJm2K: 100_000,
        emissivity: 0,
        backConvectionFactor: 0,
        minimumConvectionWm2K: 0,
        maximumSubstepSeconds: 300,
      },
      warmup: false,
    };
    const monolithic = simulateAnnualTransientSurface(base);
    const first = simulateAnnualTransientSurface({
      ...base,
      weather: base.weather.slice(0, 25),
    });
    const initialOpticalPhaseRad = annualTransientPhaseAtInterval(base, 24, "optical");
    const initialConvectionPhaseRad = annualTransientPhaseAtInterval(base, 24, "convection");
    const secondInput: AnnualTransientSurfaceInput = {
      ...base,
      weather: base.weather.slice(24),
      initialTemperatureCByNode: first.finalTemperatureCByNode,
      initialOpticalPhaseRad,
      initialConvectionPhaseRad,
      warmup: false,
    };
    const second = simulateAnnualTransientSurface(secondInput);
    const merged = mergeAnnualTransientSurfaceSegments([first, second], base.weather);

    expect(merged.electricalLayoutId).toBe(monolithic.electricalLayoutId);
    expect(merged.dcEnergyWh).toBeCloseTo(monolithic.dcEnergyWh, 10);
    expect(merged.acEnergyWh).toBeCloseTo(monolithic.acEnergyWh, 10);
    expect(merged.absorbedSolarEnergyWh).toBeCloseTo(monolithic.absorbedSolarEnergyWh, 10);
    expect(merged.averageTemperatureC).toBeCloseTo(monolithic.averageTemperatureC, 10);
    expect(merged.minimumTemperatureC).toBeCloseTo(monolithic.minimumTemperatureC, 10);
    expect(merged.maximumTemperatureC).toBeCloseTo(monolithic.maximumTemperatureC, 10);
    expect(merged.finalTemperatureCByNode).toEqual(monolithic.finalTemperatureCByNode);
    expect(merged.terminalOpticalPhaseRad).toBe(monolithic.terminalOpticalPhaseRad);
    expect(merged.terminalConvectionPhaseRad).toBe(monolithic.terminalConvectionPhaseRad);
    expect(merged.monthly).toHaveLength(monolithic.monthly.length);
    merged.monthly.forEach((entry, index) => {
      expect(entry.month).toBe(monolithic.monthly[index].month);
      expect(entry.dcEnergyWh).toBeCloseTo(monolithic.monthly[index].dcEnergyWh, 10);
      expect(entry.acEnergyWh).toBeCloseTo(monolithic.monthly[index].acEnergyWh, 10);
    });

    const resetPhaseSecond = simulateAnnualTransientSurface({
      ...secondInput,
      initialOpticalPhaseRad: base.initialPhaseRad,
      initialConvectionPhaseRad: base.initialPhaseRad,
    });
    expect(Math.abs(
      first.dcEnergyWh + resetPhaseSecond.dcEnergyWh - monolithic.dcEnergyWh,
    )).toBeGreaterThan(1e-6);
    expect(() => mergeAnnualTransientSurfaceSegments([first, resetPhaseSecond], base.weather))
      .toThrow(/phase handoff/);

    const gap = {
      ...second,
      coverage: { ...second.coverage, startTimeUtcMs: second.coverage.startTimeUtcMs + HOUR_MS },
    };
    const overlap = {
      ...second,
      coverage: { ...second.coverage, startTimeUtcMs: second.coverage.startTimeUtcMs - HOUR_MS },
    };
    expect(() => mergeAnnualTransientSurfaceSegments([first, gap], base.weather))
      .toThrow(/clocks must be exactly adjacent/);
    expect(() => mergeAnnualTransientSurfaceSegments([first, overlap], base.weather))
      .toThrow(/clocks must be exactly adjacent/);
    const firstNodeId = Object.keys(second.initialTemperatureCByNode)[0];
    const stateTamper = {
      ...second,
      initialTemperatureCByNode: {
        ...second.initialTemperatureCByNode,
        [firstNodeId]: second.initialTemperatureCByNode[firstNodeId] + 1e-6,
      },
    };
    expect(() => mergeAnnualTransientSurfaceSegments([first, stateTamper], base.weather))
      .toThrow(/thermal checkpoint handoff/);
    const phaseTamper = { ...second, initialOpticalPhaseRad: second.initialOpticalPhaseRad + 1e-9 };
    expect(() => mergeAnnualTransientSurfaceSegments([first, phaseTamper], base.weather))
      .toThrow(/phase handoff/);
  }, 60_000);

  it("uses mean of phase circuit solutions, not a circuit solve at mean POA", () => {
    const input: AnnualTransientSurfaceInput = {
      ...coupledInput(1),
      rpm: 1 / 60,
      initialTemperatureC: 25,
      engineeringElectrical: {
        ...coupledInput(1).engineeringElectrical!,
        maximumCouplingStepSeconds: 3_600,
      },
      thermalConfig: {
        arealHeatCapacityJm2K: 1e12,
        emissivity: 0,
        backConvectionFactor: 0,
        minimumConvectionWm2K: 0,
        maximumSubstepSeconds: 300,
      },
    };
    const production = simulateAnnualTransientSurface(input);
    const left = input.weather[0];
    const right = input.weather[1];
    const midpointTimeMs = (left.timeUtcMs + right.timeUtcMs) / 2;
    const ambientC = (left.ambientC + right.ambientC) / 2;
    const solar = solarPosition({ timestamp: midpointTimeMs, ...input.location, temperatureC: ambientC });
    const direction = sunVector(solar);
    const allSamples = input.surface.zones.flatMap((zone) => zone.samples).map((sample) => {
      const positionM = {
        x: sample.position[0],
        y: sample.position[1],
        z: sample.position[2],
      };
      return {
        id: engineeringSurfaceSpatialKey({
          zoneId: sample.zoneId,
          zoneIndex: sample.zoneIndex,
          u: sample.u,
          v: sample.v,
          positionM,
        }),
        areaM2: sample.areaM2,
        zoneId: sample.zoneId,
        zoneIndex: sample.zoneIndex,
        u: sample.u,
        v: sample.v,
        positionM,
        bodyNormal: {
          x: sample.normal[0],
          y: sample.normal[1],
          z: sample.normal[2],
        },
      };
    });
    const layout = createEngineeringSurfaceCellLayout(
      allSamples,
      input.engineeringElectrical!.connection,
      input.engineeringElectrical!.referenceCell.areaM2,
    );
    const phaseAngles = Array.from({ length: 4 }, (_, index) =>
      2 * Math.PI * (index + 0.5) / 4);
    const poaByPhase = phaseAngles.map((angleRad) => Object.fromEntries(allSamples.map((sample) => {
      const normal = materialPoseAtWorldYPhase({
        bodyPositionM: sample.positionM,
        bodyNormal: sample.bodyNormal,
      }, angleRad).normal;
      return [sample.id, calculatePOA({
        ghiWm2: (left.ghiWm2 + right.ghiWm2) / 2,
        dniWm2: (left.dniWm2 + right.dniWm2) / 2,
        dhiWm2: (left.dhiWm2 + right.dhiWm2) / 2,
        solarZenithDeg: 90 - solar.elevationDeg,
        sunDirection: direction,
        panelNormal: normal,
        albedo: input.albedo ?? 0.2,
        iam: input.iam ?? { model: "ashrae", b0: 0.05 },
        diffuseModel: input.diffuseModel ?? "hay-davies",
      }).totalWm2];
    })));
    const solve = (poaBySampleId: Record<string, number>) =>
      solveEngineeringSurfaceElectrical(allSamples.map((sample) => ({
        id: sample.id,
        areaM2: sample.areaM2,
        zoneId: sample.zoneId,
        zoneIndex: sample.zoneIndex,
        u: sample.u,
        v: sample.v,
        positionM: sample.positionM,
        poaWm2: poaBySampleId[sample.id],
        cellTemperatureC: 25,
      })), input.engineeringElectrical!.referenceCell,
      input.engineeringElectrical!.connection, layout);
    const phaseResults = poaByPhase.map((poa) => solve(poa));
    const weightedPhaseDcW = phaseResults.reduce(
      (sum, result) => sum + result.dcPowerW / phaseResults.length,
      0,
    );
    const averagedPoa = Object.fromEntries(allSamples.map((sample) => [
      sample.id,
      poaByPhase.reduce((sum, phase) => sum + phase[sample.id] / poaByPhase.length, 0),
    ]));
    const circuitAtMeanPoaW = solve(averagedPoa).dcPowerW;

    expect(production.engineeringCircuit?.circuitSolveCount).toBe(4);
    expect(production.dcEnergyWh).toBeCloseTo(weightedPhaseDcW, 9);
    expect(Math.abs(weightedPhaseDcW - circuitAtMeanPoaW)).toBeGreaterThan(1e-4);
    expect(Math.abs(production.dcEnergyWh - circuitAtMeanPoaW)).toBeGreaterThan(1e-4);
    expect(phaseResults.every((result) => result.layoutId === layout.layoutId)).toBe(true);
  }, 30_000);

  it("solves every optical phase on one immutable topology before averaging", () => {
    const input = {
      ...coupledInput(1),
      // Exactly one material revolution per one-hour weather interval.
      rpm: 1 / 60,
    };
    const first = simulateAnnualTransientSurface(input);
    const replay = simulateAnnualTransientSurface(input);

    // Four 15-minute coupling epochs times four phase quadrature points.
    expect(first.engineeringCircuit?.circuitSolveCount).toBe(16);
    expect(first.electricalLayoutId).not.toBe("local-mpp-no-cell-layout");
    expect(first).toEqual(replay);
    expect(first.engineeringCircuit?.maximumElectricalExtractionClosureErrorW)
      .toBeLessThan(1e-9);
  }, 30_000);

  it("makes E00/E10/E01/E11 exactly identical at zero RPM with the same cell layout", () => {
    const result = simulateAnnualRotationDecomposition(coupledInput(1));
    const histories = [result.e00, result.e10, result.e01, result.e11];

    expect(new Set(histories.map((history) => history.electricalLayoutId)).size).toBe(1);
    expect(result.annual.e10Wh).toBe(result.annual.e00Wh);
    expect(result.annual.e01Wh).toBe(result.annual.e00Wh);
    expect(result.annual.e11Wh).toBe(result.annual.e00Wh);
    expect(result.annual.closureResidualWh).toBe(0);
    expect(histories.every((history) => history.engineeringCircuit?.circuitSolveCount === 4))
      .toBe(true);
  }, 30_000);

  it("publishes only the coupled E11 ledger as the Worker's authoritative engineering result", async () => {
    const direct = coupledInput(1);
    const continuousSurface = createContinuousSurfaceWorkItem(direct.surface, {
      landAreaM2: 0.05,
      electricalModel: "explicit-series-parallel-bypass",
      engineeringConnection: OFFICIAL_ENGINEERING_SURFACE_CONNECTION,
      surfaceOptions: {
        albedo: direct.albedo,
        iam: direct.iam,
        diffuseModel: direct.diffuseModel,
        soilingLossFraction: direct.soilingLossFraction,
      },
    });
    const input: SimulationKernelInput = {
      mode: "annual",
      weather: [...direct.weather],
      variants: [
        {
          variantId: "engineering-quasi",
          referenceEfficiency: direct.referenceEfficiency,
          continuousSurface,
          rotation: { mode: "fixed", rpm: 0, initialAngleRad: 0 },
          rotationPhaseSamples: 4,
          inverter: false,
        },
        {
        variantId: "engineering-transient",
        referenceEfficiency: direct.referenceEfficiency,
        continuousSurface,
        rotation: { mode: "fixed", rpm: 0, initialAngleRad: 0 },
        rotationPhaseSamples: 4,
        inverter: false,
        annualTransientThermal: {
          surface: direct.surface,
          gammaPerC: direct.gammaPerC,
          referenceTemperatureC: direct.referenceTemperatureC,
          absorptivity: direct.absorptivity,
          thermalNodeCount: 4,
          maximumThermalSubstepSeconds: 300,
          maximumElectricalCouplingStepSeconds: 900,
          warmupPeriodHours: 1,
          warmupConvergenceToleranceC: 1_000,
        },
        },
      ],
      physics: {
        location: direct.location,
        electrical: { mode: "simple", config: DEFAULT_ELECTRICAL },
        inverter: false,
      },
    };
    const complete = await runSimulationKernel(createSimulationRunRequest(
      "engineering-transient-authoritative",
      input,
    ));
    const decomposition = complete.annualTransientRotationByVariant?.["engineering-transient"];
    const audit = complete.annualEngineeringElectricalAuditByVariant?.["engineering-transient"];
    const quasiMetadata = complete.thermalModelMetadataByVariant["engineering-quasi"];

    expect(decomposition).toBeDefined();
    expect(audit).toBeDefined();
    expect(complete.authoritativeEnergyPathByVariant["engineering-transient"])
      .toBe("annual-transient-engineering-e11");
    expect(complete.surfaceRegionEnergyWhByVariant["engineering-transient"]).toEqual({});
    expect(audit?.electricalLayoutId).toBe(decomposition?.e11.electricalLayoutId);
    expect(audit?.annual.engineeringDcEnergyWh).toBe(decomposition?.e11.dcEnergyWh);
    expect(audit?.annual.netAcEnergyWh).toBe(decomposition?.e11.acEnergyWh);
    expect(audit?.coupling.maximumStepSeconds).toBe(900);
    expect(audit?.coupling.maximumElectricalExtractionClosureErrorW).toBeLessThan(1e-9);
    expect(audit?.monthly.reduce((sum, month) => sum + month.engineeringDcEnergyWh, 0))
      .toBeCloseTo(audit!.annual.engineeringDcEnergyWh, 10);
    expect(complete.authoritativeEnergyPathByVariant["engineering-quasi"])
      .toBe("worker-quasi-steady");
    expect(quasiMetadata).toMatchObject({
      model: "quasi-steady-faiman",
      includesThermalHistory: false,
      periodIntegration: "pointwise-quasi-steady",
    });
    expect(complete.thermalModelMetadataByVariant["engineering-transient"]).toMatchObject({
      model: "annual-transient-material-state",
      includesThermalHistory: true,
      periodIntegration: "actual-weather-clock",
    });
    expect(complete.electricalLayoutIdByVariant["engineering-quasi"])
      .toBe(complete.electricalLayoutIdByVariant["engineering-transient"]);
    expect(complete.dcEnergyWhByVariant["engineering-quasi"])
      .not.toBeCloseTo(complete.dcEnergyWhByVariant["engineering-transient"], 6);
  }, 30_000);
});

describe("immutable d9ff14a ideal annual baseline fixture", () => {
  it("pins a complete source checksum and a predeclared strict tolerance", () => {
    const fixture = JSON.parse(readFileSync(
      new URL("./fixtures/d9ff14a-ideal-annual-baseline.json", import.meta.url),
      "utf8",
    )) as Record<string, unknown>;
    expect(fixture.baselineCommit).toBe("d9ff14abc6c4bec6217ca38ef45f1f499377d83c");
    expect(fixture.sourceArtifactSha256AtBaseline).toMatch(/^[0-9a-f]{64}$/);
    expect(fixture.relativeTolerance).toBe(0.001);
    expect(Object.keys(fixture.staticLandMatchedAcKWhYear as object)).toHaveLength(6);
    expect(Object.keys(fixture.controlledMotorNetAcKWhYear as object)).toHaveLength(6);
  });
});
