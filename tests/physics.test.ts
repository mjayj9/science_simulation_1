import { describe, expect, it } from "vitest";
import {
  DEFAULT_ELECTRICAL,
  MODEL_BY_ID,
  adaptiveRotationStep,
  ashraeIAM,
  calculateCircuit,
  calculateInverter,
  calculatePOA,
  erbsDecomposition,
  faimanTemperature,
  fixedRotation,
  generateWeatherPreset,
  integrateTrapezoid,
  phaseAverage,
  physicalIAM,
  simpleDcPower,
  simulateInstant,
  singleDiodeCurve,
  solarPosition,
  sunVector,
  type CircuitDevice,
} from "../src/lib/physics";

function syntheticCurve(id: string, irradianceFactor = 1): CircuitDevice {
  const iscA = 1.05 * irradianceFactor;
  const impA = 1 * irradianceFactor;
  const points = [
    { voltageV: 0, currentA: iscA, powerW: 0 },
    { voltageV: 0.5, currentA: impA, powerW: 0.5 * impA },
    { voltageV: 0.62, currentA: 0, powerW: 0 },
  ];
  return {
    id,
    curve: {
      points,
      iscA,
      vocV: 0.62,
      mpp: points[1],
    },
  };
}

describe("solar position and vectors", () => {
  it("matches the NREL 2003 SPA fixture within the documented browser-core tolerance", () => {
    const result = solarPosition({
      timestamp: new Date(Date.UTC(2003, 9, 17, 19, 30, 30)),
      latitudeDeg: 39.742476,
      longitudeDeg: -105.1786,
      elevationM: 1830.14,
      pressureHPa: 820,
      temperatureC: 11,
      deltaTSeconds: 67,
      deltaUt1Seconds: 0,
    });
    // SPA: zenith 50.11162°, azimuth 194.34024°. This compact
    // Meeus/NOAA implementation omits the full SPA periodic series.
    expect(result.zenithDeg).toBeCloseTo(50.11162, 1);
    expect(result.azimuthDeg).toBeCloseTo(194.34024, 1);
  });

  it("uses +X east, +Y up, +Z north", () => {
    expect(sunVector(0, 0)).toEqual({ x: 0, y: 0, z: 1 });
    expect(sunVector(90, 0).x).toBeCloseTo(1, 12);
    expect(sunVector(180, 90).y).toBeCloseTo(1, 12);
  });
});

describe("irradiance and temperature", () => {
  it("keeps the Erbs components closed", () => {
    const result = erbsDecomposition({ ghiWm2: 700, solarZenithDeg: 35 });
    expect(result.dhiWm2 + result.dniWm2 * Math.cos(35 * Math.PI / 180)).toBeCloseTo(700, 9);
  });

  it.each([0, 30, 60])("applies cosine and ASHRAE IAM at %s°", (angleDeg) => {
    const angle = angleDeg * Math.PI / 180;
    const result = calculatePOA({
      ghiWm2: 1000,
      dniWm2: 1000,
      dhiWm2: 0,
      solarZenithDeg: 0,
      sunDirection: { x: 0, y: 1, z: 0 },
      panelNormal: { x: Math.sin(angle), y: Math.cos(angle), z: 0 },
      albedo: 0,
      iam: { model: "ashrae", b0: 0.05 },
    });
    expect(result.beamWm2).toBeCloseTo(1000 * Math.cos(angle) * ashraeIAM(angleDeg, 0.05), 6);
  });

  it("returns no front beam on the back face", () => {
    const result = calculatePOA({
      ghiWm2: 1000,
      dniWm2: 1000,
      dhiWm2: 0,
      solarZenithDeg: 0,
      sunDirection: { x: 0, y: 1, z: 0 },
      panelNormal: { x: 0, y: -1, z: 0 },
      albedo: 0,
    });
    expect(result.beamWm2).toBe(0);
    expect(result.totalWm2).toBe(0);
  });

  it("keeps physical IAM normalized and finite", () => {
    expect(physicalIAM(0)).toBeCloseTo(1, 12);
    expect(physicalIAM(60)).toBeGreaterThan(0);
    expect(physicalIAM(89.999)).toBeGreaterThanOrEqual(0);
    expect(physicalIAM(90)).toBe(0);
  });

  it("reproduces the Faiman zero-wind fixture", () => {
    expect(faimanTemperature(25, 1000, 0)).toBeCloseTo(65, 12);
    expect(faimanTemperature(25, 1000, 5)).toBeLessThan(65);
  });
});

describe("PV and circuit models", () => {
  it("produces exactly 0.5 W for the ideal 5 cm panel in simple mode", () => {
    expect(simpleDcPower(1000, 25)).toBeCloseTo(0.5, 12);
  });

  it("generates a finite monotone single-diode curve and an STC MPP near nameplate", () => {
    const curve = singleDiodeCurve({ irradianceWm2: 1000, cellTemperatureC: 25, points: 192 });
    expect(curve.converged).toBe(true);
    expect(curve.points.every((point) => Number.isFinite(point.currentA + point.voltageV + point.powerW))).toBe(true);
    for (let index = 1; index < curve.points.length; index += 1) {
      expect(curve.points[index].currentA).toBeLessThanOrEqual(curve.points[index - 1].currentA + 1e-8);
    }
    expect(curve.mpp.powerW).toBeCloseTo(DEFAULT_ELECTRICAL.pmaxW, 2);
  });

  it("combines twenty identical series devices to approximately 10 W", () => {
    const devices = Array.from({ length: 20 }, (_, index) => syntheticCurve(`p${index}`));
    const result = calculateCircuit({ devices, topology: "series", bypassEnabled: true });
    expect(result.mpp.powerW).toBeCloseTo(10, 2);
    expect(new Set(result.deviceStates.map((state) => state.deviceId)).size).toBe(20);
  });

  it("activates a bypass diode and improves a strongly shaded string", () => {
    const devices = [syntheticCurve("a"), syntheticCurve("shade", 0.1), syntheticCurve("b")];
    const bypassed = calculateCircuit({ devices, topology: "series", bypassEnabled: true, bypassForwardVoltageV: 0.5 });
    const unbypassed = calculateCircuit({ devices, topology: "series", bypassEnabled: false });
    expect(bypassed.deviceStates.find((state) => state.deviceId === "shade")?.bypassConducting).toBe(true);
    expect(bypassed.mpp.currentA).toBeGreaterThan(unbypassed.mpp.currentA);
    expect(bypassed.mpp.powerW).toBeGreaterThan(unbypassed.mpp.powerW);
  });
});

describe("inverter, rotation, integration and deterministic pipeline", () => {
  it("clips PVWatts V5 AC power at the nameplate", () => {
    const result = calculateInverter({
      dcPowerW: 30,
      dcVoltageV: 10,
      dcCurrentA: 3,
      config: {
        ratedAcPowerW: 10,
        nominalEfficiency: 0.96,
        mpptMinVoltageV: 0,
        mpptMaxVoltageV: 100,
        maxDcVoltageV: 120,
        maxInputCurrentA: 10,
        startPowerW: 0,
        nightConsumptionW: 0,
        wiringLossFraction: 0,
      },
    });
    expect(result.acPowerW).toBe(10);
    expect(result.status).toBe("clipped");
    expect(result.clippingLossW).toBeGreaterThan(0);
  });

  it("makes fixed RPM=0 identical to static rotation", () => {
    const staticState = fixedRotation(1.234, 0, 0);
    const laterState = fixedRotation(1.234, 0, 86_400);
    expect(laterState).toEqual(staticState);
  });

  it("uses adaptive rotation stepping and stable phase averaging at high RPM", () => {
    const dynamics = {
      inertiaKgM2: 0.02,
      viscousFrictionNmPerRadS: 0.01,
      coulombFrictionNm: 0,
      maximumRpm: 120,
    };
    const initial = { angleRad: 0, angularVelocityRadS: 0 };
    const coarse = adaptiveRotationStep(initial, 10, 0.01, dynamics);
    let fine = initial;
    for (let index = 0; index < 20; index += 1) fine = adaptiveRotationStep(fine, 0.5, 0.01, dynamics);
    expect(coarse.angularVelocityRadS).toBeCloseTo(fine.angularVelocityRadS, 3);
    expect(phaseAverage((angle) => Math.max(0, Math.cos(angle)), 720, 0)).toBeCloseTo(1 / Math.PI, 4);
    expect(phaseAverage((angle) => Math.max(0, Math.cos(angle)), 720, 1.7)).toBeCloseTo(1 / Math.PI, 4);
  });

  it("integrates the triangular 2 W profile to exactly 2 Wh", () => {
    expect(integrateTrapezoid([0, 3600, 7200], [0, 2, 0])).toBeCloseTo(2, 12);
  });

  it("forces night output to zero despite invalid nonzero irradiance input", () => {
    const result = simulateInstant({
      timestamp: 0,
      solarOverride: { azimuthDeg: 180, elevationDeg: -0.1 },
      irradiance: { ghiWm2: 1000, dniWm2: 1000, dhiWm2: 100 },
    });
    expect(result.poa.totalWm2).toBe(0);
    expect(result.dcPowerW).toBe(0);
    expect(result.inverter.acPowerW).toBe(0);
  });

  it("is byte-for-byte deterministic for a shared seed", () => {
    const input = {
      timestampsMs: [0, 60_000, 120_000, 180_000],
      clearGhiWm2: [800, 800, 800, 800],
      clearDniWm2: [850, 850, 850, 850],
      clearDhiWm2: [120, 120, 120, 120],
      preset: "partly-cloudy" as const,
      seed: "same-seed",
    };
    const first = generateWeatherPreset(input);
    const second = generateWeatherPreset(input);
    const different = generateWeatherPreset({ ...input, seed: "different-seed" });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(first)).not.toBe(JSON.stringify(different));
  });

  it("returns trace model IDs that all resolve through the registry", () => {
    const result = simulateInstant({
      timestamp: 0,
      solarOverride: { azimuthDeg: 180, elevationDeg: 90 },
      irradiance: { ghiWm2: 1000, dniWm2: 1000, dhiWm2: 0 },
      panel: { normal: { x: 0, y: 1, z: 0 }, iam: { model: "none" } },
      weather: { ambientTemperatureC: 25, referenceWindSpeedMS: 0 },
      electrical: { config: { ...DEFAULT_ELECTRICAL, gammaPmpPerC: 0 } },
    });
    expect(result.dcPowerW).toBeCloseTo(0.5, 12);
    for (const stage of result.trace) expect(MODEL_BY_ID.has(stage.modelId)).toBe(true);
  });
});
