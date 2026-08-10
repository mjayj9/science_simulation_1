import { describe, expect, it } from "vitest";
import { PANEL_AREA_M2 } from "../src/lib/geometry";
import { simulateInstant } from "../src/lib/physics";
import type { WeatherPoint } from "../src/lib/weather";
import {
  SIMULATION_WORKER_PROTOCOL_VERSION,
  SimulationCancelledError,
  SimulationWorkerRuntime,
  createSimulationCancelRequest,
  createSimulationRunRequest,
  isSimulationEventStale,
  runSimulationKernel,
  simulationInputFingerprint,
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
