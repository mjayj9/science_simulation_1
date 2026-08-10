import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PANEL_AREA_M2 } from "../src/lib/geometry";
import { rotateVector, simulateInstant, solarPosition } from "../src/lib/physics";
import { getOfflineWeather, type WeatherPoint } from "../src/lib/weather";
import {
  SIMULATION_WORKER_PROTOCOL_VERSION,
  SimulationCancelledError,
  SimulationWorkerRuntime,
  computePhysicsStep,
  createSimulationCancelRequest,
  createSimulationRunRequest,
  isSimulationEventStale,
  rotationIntervalSamples,
  rotationPhaseAngles,
  runSimulationKernel,
  rotatePanelPoseAroundY,
  simulationInputFingerprint,
  validateKernelInput,
  type SimulationKernelInput,
  type SimulationPhysicsStepResult,
  type SimulationProgressEvent,
  type SimulationWorkerEvent,
} from "../src/workers";

function weather(timeUtcMs: number, irradianceWm2 = 1000): WeatherPoint {
  return {
    timeUtcMs,
    ghiWm2: irradianceWm2,
    dniWm2: irradianceWm2,
    dhiWm2: 0,
    ambientC: 25,
    windSpeedMs: 0,
    windDirectionDeg: 0,
    gustMs: 0,
    cloudFraction: 0,
    precipitationMm: 0,
  };
}

function dotProduct(
  left: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number },
): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function baseInput(times: number[]): SimulationKernelInput {
  return {
    mode: "annual",
    maximumGapHours: 6,
    chunkSize: 1,
    variants: [
      {
        variantId: "plane",
        panelCount: 1,
        totalPanelAreaM2: PANEL_AREA_M2,
        referenceEfficiency: 0.2,
        inverter: false,
      },
    ],
    weather: times.map((time) => weather(time)),
    physics: {
      solarOverride: { azimuthDeg: 180, elevationDeg: 90 },
      panelDefaults: { soilingLossFraction: 0 },
    },
  };
}

describe("annual worker protocol", () => {
  it("creates a deterministic fingerprint and fingerprint-bound cancel request", () => {
    expect(SIMULATION_WORKER_PROTOCOL_VERSION).toBe(2);
    const start = Date.UTC(2026, 0, 1);
    const input = baseInput([start, start + 3_600_000]);
    const cloned = structuredClone(input);
    expect(simulationInputFingerprint(input)).toBe(simulationInputFingerprint(cloned));

    cloned.weather[1].ghiWm2 += 1;
    expect(simulationInputFingerprint(cloned)).not.toBe(simulationInputFingerprint(input));

    const run = createSimulationRunRequest("annual-1", input);
    const cancel = createSimulationCancelRequest(run, "사용자 취소");
    expect(cancel.fingerprint).toBe(run.fingerprint);
    expect(cancel.reason).toBe("사용자 취소");

    const currentEvent: SimulationWorkerEvent = {
      protocolVersion: SIMULATION_WORKER_PROTOCOL_VERSION,
      type: "simulation/accepted",
      requestId: run.requestId,
      fingerprint: run.fingerprint,
      mode: "annual",
    };
    expect(isSimulationEventStale(currentEvent, run)).toBe(false);
    expect(isSimulationEventStale({ ...currentEvent, fingerprint: "old" }, run)).toBe(true);
  });
});

describe("annual physics kernel", () => {
  it("gives supplied hourly GHI/DNI/DHI priority without synthesizing a daily curve", async () => {
    const start = Date.UTC(2026, 5, 21, 3);
    const input = baseInput([start, start + 3_600_000]);
    const supplied = { ghiWm2: 421, dniWm2: 731, dhiWm2: 37 };
    input.physics = {
      ...input.physics,
      solarOverride: { azimuthDeg: 180, elevationDeg: 30 },
    };
    input.weather = input.weather.map((point) => ({ ...point, ...supplied }));
    const originalWeather = structuredClone(input.weather);
    const rows: Array<{
      poaWm2: number;
      closure: { residualWm2: number; isClosed: boolean; policy: string };
    }> = [];
    const progress: SimulationProgressEvent[] = [];
    const complete = await runSimulationKernel(createSimulationRunRequest("components", input), {
      onChunk: (event) => {
        event.rows.forEach((row) => rows.push({
          poaWm2: row.poaWm2ByVariant.plane,
          closure: row.ghiClosureByVariant.plane,
        }));
      },
      onProgress: (event) => { progress.push(event); },
      yieldControl: async () => undefined,
    });

    const direct = simulateInstant({
      timestamp: start,
      solarOverride: { azimuthDeg: 180, elevationDeg: 30 },
      irradiance: supplied,
      panel: {
        normal: { x: 0, y: 1, z: 0 },
        areaM2: PANEL_AREA_M2,
        efficiency: 0.2,
        soilingLossFraction: 0,
      },
      weather: { ambientTemperatureC: 25, referenceWindSpeedMS: 0 },
      inverter: false,
    });

    expect(direct.irradiance).toMatchObject(supplied);
    expect(rows).toHaveLength(2);
    expect(rows[0].poaWm2).toBeCloseTo(direct.poa.totalWm2, 12);
    expect(rows[1].poaWm2).toBeCloseTo(direct.poa.totalWm2, 12);
    expect(rows[0].closure).toMatchObject({
      residualWm2: direct.irradiance.ghiClosure.residualWm2,
      isClosed: false,
      policy: "preserve-source-and-warn",
    });
    expect(progress.at(-1)?.ghiClosureWarningCount).toBe(2);
    expect(complete.ghiClosureWarningCount).toBe(2);
    expect(input.weather).toEqual(originalWeather);
  });

  it("uses the real POA, Faiman, electrical and inverter pipeline", async () => {
    const start = Date.UTC(2026, 5, 21, 12);
    const input = baseInput([start, start + 3_600_000]);
    const inverter = {
      ratedAcPowerW: 0.3,
      nominalEfficiency: 0.96,
      mpptMinVoltageV: 0,
      mpptMaxVoltageV: 1_000,
      maxDcVoltageV: 1_200,
      maxInputCurrentA: 100,
      startPowerW: 0,
      nightConsumptionW: 0,
      wiringLossFraction: 0.01,
    };
    input.variants[0].inverter = inverter;
    const run = createSimulationRunRequest("physics", input);
    const rows: Array<{
      dcPowerW: number;
      acPowerW: number;
      poaWm2: number;
      moduleTemperatureC: number;
      inverterStatus: string;
    }> = [];
    const complete = await runSimulationKernel(run, {
      onChunk: (event) => {
        event.rows.forEach((row) => rows.push({
          dcPowerW: row.dcPowerWByVariant.plane,
          acPowerW: row.acPowerWByVariant.plane,
          poaWm2: row.poaWm2ByVariant.plane,
          moduleTemperatureC: row.moduleTemperatureCByVariant.plane,
          inverterStatus: row.inverterStatusByVariant.plane,
        }));
      },
      yieldControl: async () => undefined,
    });

    const direct = simulateInstant({
      timestamp: start,
      solarOverride: { azimuthDeg: 180, elevationDeg: 90 },
      irradiance: { ghiWm2: 1000, dniWm2: 1000, dhiWm2: 0 },
      panel: {
        normal: { x: 0, y: 1, z: 0 },
        areaM2: PANEL_AREA_M2,
        efficiency: 0.2,
        soilingLossFraction: 0,
      },
      weather: { ambientTemperatureC: 25, referenceWindSpeedMS: 0 },
      inverter,
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].dcPowerW).toBeCloseTo(direct.dcPowerW, 12);
    expect(rows[0].acPowerW).toBeCloseTo(direct.inverter.acPowerW, 12);
    expect(rows[0].poaWm2).toBeCloseTo(direct.poa.totalWm2, 12);
    expect(rows[0].moduleTemperatureC).toBeCloseTo(direct.moduleTemperatureC, 12);
    expect(rows[0].inverterStatus).toBe(direct.inverter.status);
    expect(complete.dcEnergyWhByVariant.plane).toBeCloseTo(direct.dcPowerW, 12);
    expect(complete.acEnergyWhByVariant.plane).toBeCloseTo(direct.inverter.acPowerW, 12);
    expect(complete.energyWhByVariant).toEqual(complete.dcEnergyWhByVariant);
    expect(complete.mode).toBe("annual");
  });

  it("requirement 10: applies one world-Y rotation to position, quaternion, normal and both sample axes", () => {
    const pose = rotatePanelPoseAroundY({
      panelId: "pose-panel",
      positionM: { x: 1, y: 2, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      normal: { x: 0, y: 0, z: 1 },
      sampleAxisU: { x: 1, y: 0, z: 0 },
      sampleAxisV: { x: 0, y: 1, z: 0 },
    }, Math.PI / 2);

    expect(pose.positionM.x).toBeCloseTo(0, 12);
    expect(pose.positionM.y).toBeCloseTo(2, 12);
    expect(pose.positionM.z).toBeCloseTo(-1, 12);
    expect(pose.normal).toEqual(expect.objectContaining({ y: 0 }));
    expect(pose.normal.x).toBeCloseTo(1, 12);
    expect(pose.normal.z).toBeCloseTo(0, 12);
    expect(pose.sampleAxisU.x).toBeCloseTo(0, 12);
    expect(pose.sampleAxisU.z).toBeCloseTo(-1, 12);
    expect(pose.sampleAxisV).toEqual({ x: 0, y: 1, z: 0 });
    const quaternionNormal = rotateVector(pose.quaternion, { x: 0, y: 0, z: 1 });
    expect(quaternionNormal.x).toBeCloseTo(pose.normal.x, 12);
    expect(quaternionNormal.y).toBeCloseTo(pose.normal.y, 12);
    expect(quaternionNormal.z).toBeCloseTo(pose.normal.z, 12);
  });

  it("uses quaternion as pose authority and reconstructs a right-handed frame from explicit V", () => {
    expect(() => rotatePanelPoseAroundY({
      panelId: "conflicting-pose",
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      normal: { x: 1, y: 0, z: 0 },
    }, 0)).toThrow(/normal/);
    const invalidInput = baseInput([Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 1, 1)]);
    invalidInput.variants[0].panels = [{
      panelId: "conflicting-pose",
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      normal: { x: 1, y: 0, z: 0 },
      areaM2: PANEL_AREA_M2,
    }];
    expect(() => validateKernelInput(invalidInput)).toThrow(/normal/);

    const reconstructed = rotatePanelPoseAroundY({
      panelId: "v-authority",
      normal: { x: 0, y: 0, z: 1 },
      sampleAxisV: { x: 0, y: 1, z: 0 },
    }, 0);
    expect(reconstructed.sampleAxisU).toEqual({ x: 1, y: 0, z: 0 });
    expect(reconstructed.sampleAxisV).toEqual({ x: 0, y: 1, z: 0 });
    expect(dotProduct(reconstructed.sampleAxisU, reconstructed.sampleAxisV)).toBeCloseTo(0, 12);
    expect(dotProduct(reconstructed.sampleAxisU, reconstructed.normal)).toBeCloseTo(0, 12);
    expect(dotProduct(reconstructed.sampleAxisV, reconstructed.normal)).toBeCloseTo(0, 12);
    const quaternionU = rotateVector(reconstructed.quaternion, { x: 1, y: 0, z: 0 });
    const quaternionV = rotateVector(reconstructed.quaternion, { x: 0, y: 1, z: 0 });
    expect(quaternionU.x).toBeCloseTo(reconstructed.sampleAxisU.x, 12);
    expect(quaternionV.y).toBeCloseTo(reconstructed.sampleAxisV.y, 12);
  });

  it("advances fixed rotation from weather[0] when referenceTimestamp is omitted", () => {
    const start = Date.UTC(2026, 5, 21, 3);
    const input = baseInput([start, start + 60_000]);
    const variant = input.variants[0];
    variant.rotation = { mode: "fixed", rpm: 0.25, initialAngleRad: 0.2 };
    const first = rotationPhaseAngles({
      input,
      variant,
      weather: input.weather[0],
      stepIndex: 0,
    })[0];
    const second = rotationPhaseAngles({
      input,
      variant,
      weather: input.weather[1],
      stepIndex: 1,
    })[0];
    expect(first).toBeCloseTo(0.2, 12);
    expect(second).toBeCloseTo(0.2 + Math.PI / 2, 12);
  });

  it("keeps exact timestamp rotation when phase sampling is omitted", () => {
    const start = Date.UTC(2026, 5, 21, 3);
    const input = baseInput([start, start + 3_600_000]);
    input.physics = {
      ...input.physics,
      solarOverride: { azimuthDeg: 180, elevationDeg: 30 },
    };
    input.weather = input.weather.map((point) => ({
      ...point,
      ghiWm2: 450,
      dniWm2: 700,
      dhiWm2: 100,
    }));
    const variant = input.variants[0];
    variant.panels = [{
      panelId: "timestamp-panel",
      normal: { x: 0, y: 0, z: 1 },
      areaM2: PANEL_AREA_M2,
      efficiency: 0.2,
      soilingLossFraction: 0,
    }];
    variant.rotation = {
      mode: "fixed",
      rpm: 0.25,
      initialAngleRad: 0.3,
      referenceTimestamp: start - 15_000,
    };

    const workerResult = computePhysicsStep({
      input,
      variant,
      weather: input.weather[0],
      stepIndex: 0,
    }) as SimulationPhysicsStepResult;
    const direct = simulateInstant({
      timestamp: start,
      solarOverride: input.physics.solarOverride,
      irradiance: { ghiWm2: 450, dniWm2: 700, dhiWm2: 100 },
      panel: {
        normal: { x: 0, y: 0, z: 1 },
        areaM2: PANEL_AREA_M2,
        efficiency: 0.2,
        soilingLossFraction: 0,
      },
      weather: { ambientTemperatureC: 25, referenceWindSpeedMS: 0 },
      inverter: false,
      rotation: variant.rotation,
    });
    expect(workerResult.poaWm2).toBeCloseTo(direct.poa.totalWm2, 12);
    expect(workerResult.dcPowerW).toBeCloseTo(direct.dcPowerW, 12);
  });

  it("requirement 11: converges for full-day fixed-RPM energy across 24 weather intervals", async () => {
    const start = Date.UTC(2026, 5, 21);
    const end = start + 24 * 3_600_000;
    const weatherSeries = getOfflineWeather({
      latitudeDeg: 37.5665,
      longitudeDeg: 126.978,
      elevationM: 38,
      start,
      end,
      stepMinutes: 60,
      offlinePreset: "clear",
      seed: "requirement-11-full-day",
    }, { now: new Date(0) });
    expect(weatherSeries.points).toHaveLength(25);

    const energyForSamples = async (rotationPhaseSamples: number): Promise<number> => {
      const input = baseInput(weatherSeries.points.map((point) => point.timeUtcMs));
      input.weather = structuredClone(weatherSeries.points);
      input.physics = {
        location: { latitudeDeg: 37.5665, longitudeDeg: 126.978, elevationM: 38 },
        panelDefaults: { soilingLossFraction: 0 },
      };
      const variant = input.variants[0];
      variant.panels = [{
        panelId: "rotating-panel",
        positionM: { x: 0.25, y: 1, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        normal: { x: 0, y: 0, z: 1 },
        sampleAxisU: { x: 1, y: 0, z: 0 },
        sampleAxisV: { x: 0, y: 1, z: 0 },
        areaM2: PANEL_AREA_M2,
        efficiency: 0.2,
        iam: { model: "none" },
        diffuseModel: "isotropic",
        soilingLossFraction: 0,
      }];
      variant.rotation = {
        mode: "fixed",
        // 1.37 turns per interval exercises complete and residual arcs without phase locking.
        rpm: 1.37 / 60,
        initialAngleRad: 0,
        referenceTimestamp: start,
      };
      variant.rotationPhaseSamples = rotationPhaseSamples;
      const complete = await runSimulationKernel(
        createSimulationRunRequest(`full-day-${rotationPhaseSamples}`, input),
        { yieldControl: async () => undefined },
      );
      expect(complete.durationHours).toBe(24);
      expect(complete.intervals).toBe(24);
      return complete.dcEnergyWhByVariant.plane;
    };

    const reference = await energyForSamples(576);
    const energy12 = await energyForSamples(12);
    const energy24 = await energyForSamples(24);
    const energy72 = await energyForSamples(72);
    const error12 = Math.abs(energy12 - reference);
    const error24 = Math.abs(energy24 - reference);
    const error72 = Math.abs(energy72 - reference);
    expect(reference).toBeGreaterThan(0);
    expect(error24).toBeLessThan(error12);
    expect(error72).toBeLessThan(error24);
    expect(error72 / reference).toBeLessThan(0.001);
  });

  it("integrates 0.99, 1.0 and 1.25 turns without a threshold or discarded residual", () => {
    const start = Date.UTC(2026, 5, 21, 3);
    const samplesForTurns = (turns: number) => {
      const input = baseInput([start, start + turns * 60_000]);
      const variant = input.variants[0];
      variant.rotation = { mode: "fixed", rpm: 1, initialAngleRad: 0 };
      variant.rotationPhaseSamples = 12;
      return rotationIntervalSamples({
        input,
        variant,
        weather: input.weather[0],
        stepIndex: 0,
      });
    };

    const below = samplesForTurns(0.99);
    const exact = samplesForTurns(1);
    const residual = samplesForTurns(1.25);
    expect(below).toHaveLength(12);
    expect(exact).toHaveLength(12);
    expect(residual).toHaveLength(15);
    expect(below.reduce((sum, sample) => sum + sample.weight, 0)).toBeCloseTo(1, 12);
    expect(exact.reduce((sum, sample) => sum + sample.weight, 0)).toBeCloseTo(1, 12);
    expect(residual.reduce((sum, sample) => sum + sample.weight, 0)).toBeCloseTo(1, 12);
    expect(residual.slice(0, 12).reduce((sum, sample) => sum + sample.weight, 0)).toBeCloseTo(0.8, 12);
    expect(residual.slice(12).reduce((sum, sample) => sum + sample.weight, 0)).toBeCloseTo(0.2, 12);
  });

  it("uses the left interval rotation average directly for annual energy", async () => {
    const start = Date.UTC(2026, 5, 21, 3);
    const input = baseInput([start, start + 3_600_000]);
    input.physics = {
      ...input.physics,
      solarOverride: { azimuthDeg: 180, elevationDeg: 30 },
    };
    input.weather = input.weather.map((point) => ({
      ...point,
      ghiWm2: 450,
      dniWm2: 700,
      dhiWm2: 100,
    }));
    const variant = input.variants[0];
    variant.panels = [{
      panelId: "energy-panel",
      normal: { x: 0, y: 0, z: 1 },
      areaM2: PANEL_AREA_M2,
      efficiency: 0.2,
      iam: { model: "none" },
      diffuseModel: "isotropic",
      soilingLossFraction: 0,
    }];
    variant.rotation = { mode: "fixed", rpm: 1 / 60, initialAngleRad: 0 };
    variant.rotationPhaseSamples = 72;
    const firstInterval = computePhysicsStep({
      input,
      variant,
      weather: input.weather[0],
      stepIndex: 0,
    }) as SimulationPhysicsStepResult;
    const intervalFlags: boolean[] = [];
    const complete = await runSimulationKernel(createSimulationRunRequest("interval-energy", input), {
      onChunk: (event) => {
        event.rows.forEach((row) => {
          intervalFlags.push(row.rotationIntervalAveragedByVariant.plane);
        });
      },
      yieldControl: async () => undefined,
    });

    expect(firstInterval.rotationIntervalAveraged).toBe(true);
    expect(intervalFlags).toEqual([true, false]);
    expect(complete.dcEnergyWhByVariant.plane).toBeCloseTo(firstInterval.dcPowerW, 10);
  });

  it("integrates DC and AC across UTC month boundaries and reports real progress", async () => {
    const start = Date.UTC(2026, 0, 31, 23);
    const input = baseInput([start, start + 3_600_000, start + 7_200_000]);
    const run = createSimulationRunRequest("monthly", input);
    const progress: SimulationProgressEvent[] = [];
    const constantStep: SimulationPhysicsStepResult = {
      dcPowerW: 100,
      acPowerW: 80,
      poaWm2: 500,
      moduleTemperatureC: 30,
      mismatchLossFraction: 0,
      bypassActiveCount: 0,
      inverterStatus: "running",
      ghiClosure: {
        residualWm2: 0,
        relativeResidual: 0,
        toleranceWm2: 1,
        isClosed: true,
        policy: "not-evaluated",
      },
      rotationIntervalAveraged: false,
    };
    const complete = await runSimulationKernel(
      run,
      {
        onProgress: (event) => { progress.push(event); },
        yieldControl: async () => undefined,
      },
      () => constantStep,
    );

    expect(complete.dcEnergyWhByVariant.plane).toBeCloseTo(200, 12);
    expect(complete.acEnergyWhByVariant.plane).toBeCloseTo(160, 12);
    expect(complete.monthlyEnergy).toEqual([
      {
        monthUtc: "2026-01",
        dcEnergyWhByVariant: { plane: 100 },
        acEnergyWhByVariant: { plane: 80 },
      },
      {
        monthUtc: "2026-02",
        dcEnergyWhByVariant: { plane: 100 },
        acEnergyWhByVariant: { plane: 80 },
      },
    ]);
    expect(progress[0].fraction).toBe(0);
    expect(progress.at(-1)?.fraction).toBe(1);
    expect(progress.at(-1)?.completedWork).toBe(progress.at(-1)?.totalWork);
    expect(complete.intervals).toBe(2);
  });

  it("requires an annual hourly closing endpoint and accepts 8,761 point boundaries", () => {
    const start = Date.UTC(2026, 0, 1);
    const missingClosingPoint = baseInput(
      Array.from({ length: 8_760 }, (_, index) => start + index * 3_600_000),
    );
    expect(() => validateKernelInput(missingClosingPoint)).toThrow(/closing endpoint/);

    const completeBoundaries = baseInput(
      Array.from({ length: 8_761 }, (_, index) => start + index * 3_600_000),
    );
    expect(validateKernelInput(completeBoundaries)).toBe(completeBoundaries);
  });

  it("reports cumulative work from each step's effective phase count", async () => {
    const start = Date.UTC(2026, 0, 1);
    const input = baseInput([
      start,
      start + 10 * 60_000,
      start + 70 * 60_000,
    ]);
    input.chunkSize = 1;
    input.variants[0].rotation = {
      mode: "fixed",
      rpm: 0.05,
      referenceTimestamp: start,
    };
    input.variants[0].rotationPhaseSamples = 12;
    const progress: SimulationProgressEvent[] = [];
    await runSimulationKernel(createSimulationRunRequest("phase-progress", input), {
      onProgress: (event) => { progress.push(event); },
      yieldControl: async () => undefined,
    });

    expect(progress.map((event) => event.completedWork)).toEqual([0, 6, 18, 19]);
    expect(progress.every((event) => event.totalWork === 19)).toBe(true);
    expect(progress.every((event) =>
      event.fraction === event.completedWork / event.totalWork
    )).toBe(true);
  });

  it("checks cancellation after each yielded chunk", async () => {
    const start = Date.UTC(2026, 0, 1);
    const input = baseInput(Array.from({ length: 8 }, (_, index) => start + index * 3_600_000));
    const run = createSimulationRunRequest("cancel-kernel", input);
    let cancelled = false;
    let yields = 0;
    await expect(runSimulationKernel(run, {
      isCancelled: () => cancelled,
      yieldControl: async () => {
        yields += 1;
        cancelled = true;
      },
    })).rejects.toBeInstanceOf(SimulationCancelledError);
    expect(yields).toBe(1);
  });
});

describe("annual irradiance regression guards", () => {
  it("generates a closed Haurwitz clear-sky and Erbs offline triplet", () => {
    const series = getOfflineWeather({
      latitudeDeg: 37.5665,
      longitudeDeg: 126.978,
      elevationM: 38,
      start: "2026-06-21T00:00:00Z",
      end: "2026-06-21T09:00:00Z",
      stepMinutes: 60,
      offlinePreset: "clear",
    }, { now: new Date(0) });
    expect(series.provenance.spatialResolution).toContain("Haurwitz");
    expect(Math.max(...series.points.map((point) => point.ghiWm2))).toBeGreaterThan(0);
    for (const point of series.points) {
      const solar = solarPosition({
        timestamp: point.timeUtcMs,
        latitudeDeg: 37.5665,
        longitudeDeg: 126.978,
        elevationM: 38,
        applyRefraction: false,
      });
      const cosineZenith = Math.max(0, Math.cos(solar.zenithDeg * Math.PI / 180));
      expect(point.dniWm2 * cosineZenith + point.dhiWm2).toBeCloseTo(point.ghiWm2, 8);
    }
  });

  it("requirement 12: forbids legacy 800/850/120 irradiance literals and sin/sqrt reshaping", () => {
    const sources = [
      ["weather/offline", new URL("../src/lib/weather/offline.ts", import.meta.url)],
      ["workers/kernel", new URL("../src/workers/kernel.ts", import.meta.url)],
      ["ui/SimulatorClient", new URL("../src/ui/SimulatorClient.tsx", import.meta.url)],
      ["physics/pipeline", new URL("../src/lib/physics/pipeline.ts", import.meta.url)],
    ] as const;
    const legacyFixedTriplet =
      /\bghi(?:Wm2)?\b\s*[:=]\s*[^,;\n]*\b8_?00\b[\s\S]{0,240}?\bdni(?:Wm2)?\b\s*[:=]\s*[^,;\n]*\b8_?50\b[\s\S]{0,240}?\bdhi(?:Wm2)?\b\s*[:=]\s*[^,;\n]*\b1_?20\b/i;
    const directSinSqrtReshape =
      /\b(?:ghi|dni|dhi)(?:Wm2)?\b\s*[:=]\s*[^,;\n]{0,240}\bMath\.(?:sin|sqrt)\s*\(/i;
    const derivedElevationFactorReshape =
      /\b(?:ghi|dni|dhi)(?:Wm2)?\b\s*[:=]\s*[^,;\n]{0,240}\b(?:clearFactor|sineElevation|solarFactor|elevationFactor)\b/i;

    expect("ghiWm2: daylight ? 800 : 0, dniWm2: daylight ? 850 : 0, dhiWm2: daylight ? 120 : 0")
      .toMatch(legacyFixedTriplet);
    expect("dni: weather.dni * Math.sqrt(clearFactor)").toMatch(directSinSqrtReshape);
    expect("ghi: weather.ghi * clearFactor").toMatch(derivedElevationFactorReshape);

    for (const [label, url] of sources) {
      const source = readFileSync(fileURLToPath(url), "utf8");
      expect(source, `${label}: legacy fixed GHI/DNI/DHI triplet`).not.toMatch(legacyFixedTriplet);
      expect(source, `${label}: direct irradiance sin/sqrt reshaping`).not.toMatch(directSinSqrtReshape);
      expect(source, `${label}: derived elevation-factor reshaping`).not.toMatch(derivedElevationFactorReshape);
    }
  });
});

describe("worker runtime fingerprint safety", () => {
  it("rejects a stale cancel fingerprint and accepts the matching cancel", async () => {
    const start = Date.UTC(2026, 0, 1);
    const run = createSimulationRunRequest(
      "runtime-slot",
      baseInput(Array.from({ length: 4 }, (_, index) => start + index * 3_600_000)),
    );
    const events: SimulationWorkerEvent[] = [];
    const runtime = new SimulationWorkerRuntime((event) => events.push(event));
    const running = runtime.handleRequest(run);

    await runtime.handleRequest({
      protocolVersion: SIMULATION_WORKER_PROTOCOL_VERSION,
      type: "simulation/cancel",
      requestId: run.requestId,
      fingerprint: "stale-fingerprint",
    });
    await runtime.handleRequest(createSimulationCancelRequest(run, "테스트 취소"));
    await running;

    const stale = events.find((event) => event.type === "simulation/stale");
    const cancelled = events.find((event) => event.type === "simulation/cancelled");
    expect(stale).toMatchObject({
      type: "simulation/stale",
      fingerprint: "stale-fingerprint",
      currentFingerprint: run.fingerprint,
      reason: "cancel-fingerprint-mismatch",
    });
    expect(cancelled).toMatchObject({
      type: "simulation/cancelled",
      fingerprint: run.fingerprint,
      reason: "테스트 취소",
    });
    if (cancelled?.type === "simulation/cancelled") {
      expect(cancelled.fraction).toBe(cancelled.completedWork / cancelled.totalWork);
    }
    expect(events.some((event) => event.type === "simulation/complete")).toBe(false);
    expect(runtime.activeCount).toBe(0);
  });

  it("supersedes an older fingerprint without leaking its chunks or completion", async () => {
    const start = Date.UTC(2026, 0, 1);
    const first = createSimulationRunRequest(
      "replaceable-slot",
      baseInput(Array.from({ length: 4 }, (_, index) => start + index * 3_600_000)),
    );
    const replacementInput = structuredClone(first.input);
    replacementInput.variants[0].irradianceScale = 0.5;
    const replacement = createSimulationRunRequest("replaceable-slot", replacementInput);
    const events: SimulationWorkerEvent[] = [];
    const runtime = new SimulationWorkerRuntime((event) => events.push(event));

    await Promise.all([
      runtime.handleRequest(first),
      runtime.handleRequest(replacement),
    ]);

    expect(events).toContainEqual(expect.objectContaining({
      type: "simulation/stale",
      fingerprint: first.fingerprint,
      currentFingerprint: replacement.fingerprint,
      reason: "superseded",
    }));
    expect(events.filter((event) => event.type === "simulation/complete")).toEqual([
      expect.objectContaining({ fingerprint: replacement.fingerprint }),
    ]);
    expect(events.some((event) =>
      (event.type === "simulation/chunk" || event.type === "simulation/complete") &&
      event.fingerprint === first.fingerprint
    )).toBe(false);
    expect(runtime.activeCount).toBe(0);
  });
});
