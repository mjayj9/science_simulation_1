import { describe, expect, it } from "vitest";
import {
  DEFAULT_ELECTRICAL,
  MODEL_BY_ID,
  adaptiveRotationStep,
  ashraeIAM,
  calculateCircuit,
  calculateInverter,
  calculatePOA,
  checkGHIClosure,
  createPanelFrame,
  erbsDecomposition,
  extraterrestrialNormalIrradiance,
  faimanTemperature,
  fixedRotation,
  generateDailySeries,
  generateWeatherPreset,
  integrateTrapezoid,
  phaseAverage,
  physicalIAM,
  rotatePanelFrameAroundY,
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
    expect(sunVector(180, 0).z).toBeCloseTo(-1, 12);
    expect(sunVector(270, 0).x).toBeCloseTo(-1, 12);
    expect(sunVector(180, 90).y).toBeCloseTo(1, 12);
    for (const azimuthDeg of [0, 90, 180, 270]) {
      const direction = sunVector(azimuthDeg, 37);
      expect(Math.hypot(direction.x, direction.y, direction.z)).toBeCloseTo(1, 12);
    }
  });

  it("keeps Seoul UTC/KST conversion exact across solstice and equinox fixtures", () => {
    const location = { latitudeDeg: 37.5665, longitudeDeg: 126.978, elevationM: 38 };
    const fromUtc = solarPosition({ timestamp: "2026-06-21T03:30:00.000Z", ...location });
    const fromKst = solarPosition({ timestamp: "2026-06-21T12:30:00+09:00", ...location });
    expect(fromKst.elevationDeg).toBeCloseTo(fromUtc.elevationDeg, 12);
    expect(fromKst.azimuthDeg).toBeCloseTo(fromUtc.azimuthDeg, 12);

    const summer = fromUtc.elevationDeg;
    const equinox = solarPosition({ timestamp: "2026-03-20T03:30:00.000Z", ...location }).elevationDeg;
    const winter = solarPosition({ timestamp: "2026-12-21T03:30:00.000Z", ...location }).elevationDeg;
    expect(summer).toBeGreaterThan(equinox);
    expect(equinox).toBeGreaterThan(winter);
    expect(summer).toBeGreaterThan(70);
    expect(winter).toBeGreaterThan(20);
  });

  it("shows that 18:00 KST at Seoul summer solstice is daylight, followed by a normal night transition", () => {
    const location = { latitudeDeg: 37.5665, longitudeDeg: 126.978, elevationM: 38 };
    const at1800 = solarPosition({ timestamp: "2026-06-21T18:00:00+09:00", ...location });
    const at2030 = solarPosition({ timestamp: "2026-06-21T20:30:00+09:00", ...location });
    expect(at1800.elevationDeg).toBeGreaterThan(15);
    expect(at1800.isDaylight).toBe(true);
    expect(at2030.elevationDeg).toBeLessThan(0);
    expect(at2030.isDaylight).toBe(false);
  });
});

describe("incident-angle diagnosis contract 1-10", () => {
  const directOnlyAtAoi = (angleDeg: number, dniWm2 = 1000) => {
    const angle = angleDeg * Math.PI / 180;
    return calculatePOA({
      ghiWm2: dniWm2,
      dniWm2,
      dhiWm2: 0,
      solarZenithDeg: 0,
      sunDirection: { x: 0, y: 1, z: 0 },
      panelNormal: { x: Math.sin(angle), y: Math.cos(angle), z: 0 },
      albedo: 0,
      iam: { model: "ashrae", b0: 0.05 },
    });
  };

  it("1: exposes etaCos=1, IAM=1 and 1000 W/m² direct POA at AOI 0°", () => {
    const result = directOnlyAtAoi(0);
    expect(result.etaCos).toBe(1);
    expect(result.iamFactor).toBe(1);
    expect(result.etaAngle).toBe(1);
    expect(result.directPoaWm2).toBe(1000);
    expect(result.beamWm2).toBe(result.directPoaWm2);
  });

  it("2: applies cosine and IAM exactly once at AOI 60°", () => {
    const result = directOnlyAtAoi(60);
    const iam60 = ashraeIAM(60, 0.05);
    expect(result.etaCos).toBeCloseTo(0.5, 12);
    expect(result.iamFactor).toBeCloseTo(iam60, 12);
    expect(result.etaAngle).toBeCloseTo(0.5 * iam60, 12);
    expect(result.directPoaWm2).toBeCloseTo(500 * iam60, 9);
  });

  it("3: returns zero direct POA at AOI 90°", () => {
    const result = directOnlyAtAoi(90);
    expect(result.etaCos).toBe(0);
    expect(result.etaAngle).toBe(0);
    expect(result.directPoaWm2).toBe(0);
  });

  it("4: rejects back-face direct irradiance above AOI 90°", () => {
    const result = directOnlyAtAoi(120);
    expect(result.cosineIncidence).toBeLessThan(0);
    expect(result.etaCos).toBe(0);
    expect(result.directPoaWm2).toBe(0);
  });

  it("5: gives AOI 60° and 500 W/m² on a horizontal panel at 30° solar elevation", () => {
    const direction = sunVector(180, 30);
    const result = calculatePOA({
      ghiWm2: 500,
      dniWm2: 1000,
      dhiWm2: 0,
      solarZenithDeg: 60,
      sunDirection: direction,
      panelNormal: { x: 0, y: 1, z: 0 },
      albedo: 0,
      iam: { model: "none" },
    });
    expect(result.angleOfIncidenceDeg).toBeCloseTo(60, 12);
    expect(result.etaCos).toBeCloseTo(0.5, 12);
    expect(result.directPoaWm2).toBeCloseTo(500, 9);
  });

  it("6: changes output with sun direction through AOI at fixed DNI", () => {
    const evaluate = (elevationDeg: number) => calculatePOA({
      ghiWm2: 1000 * Math.sin(elevationDeg * Math.PI / 180),
      dniWm2: 1000,
      dhiWm2: 0,
      solarZenithDeg: 90 - elevationDeg,
      sunDirection: sunVector(180, elevationDeg),
      panelNormal: { x: 0, y: 1, z: 0 },
      albedo: 0,
      iam: { model: "none" },
    });
    const lowSun = evaluate(30);
    const highSun = evaluate(60);
    expect(lowSun.angleOfIncidenceDeg).toBeGreaterThan(highSun.angleOfIncidenceDeg);
    expect(lowSun.directPoaWm2).toBeLessThan(highSun.directPoaWm2);
  });

  it("7: is linear in DNI when AOI and all other factors are fixed", () => {
    const low = directOnlyAtAoi(30, 500);
    const high = directOnlyAtAoi(30, 1000);
    expect(high.etaAngle).toBeCloseTo(low.etaAngle, 12);
    expect(high.directPoaWm2).toBeCloseTo(2 * low.directPoaWm2, 9);
  });

  it("8: audits GHI = DNI cos(zenith) + DHI closure", () => {
    const closed = checkGHIClosure({
      ghiWm2: 600,
      dniWm2: 1000,
      dhiWm2: 100,
      solarZenithDeg: 60,
    });
    expect(closed.reconstructedGhiWm2).toBeCloseTo(600, 9);
    expect(closed.residualWm2).toBeCloseTo(0, 9);
    expect(closed.isClosed).toBe(true);
    expect(checkGHIClosure({ ghiWm2: 700, dniWm2: 1000, dhiWm2: 100, solarZenithDeg: 60 }).isClosed).toBe(false);
    const poa = calculatePOA({
      ghiWm2: 600,
      dniWm2: 1000,
      dhiWm2: 100,
      solarZenithDeg: 60,
      sunDirection: sunVector(180, 30),
      panelNormal: { x: 0, y: 1, z: 0 },
    });
    expect(poa.ghiClosure.isClosed).toBe(true);
  });

  it("9: does not multiply etaCos again in the DC model after POA", () => {
    const angle = 60 * Math.PI / 180;
    const commonInput = {
      timestamp: 0,
      solarOverride: { azimuthDeg: 180, elevationDeg: 90 },
      irradiance: { ghiWm2: 1000, dniWm2: 1000, dhiWm2: 0 },
      panel: {
        normal: { x: Math.sin(angle), y: Math.cos(angle), z: 0 },
        albedo: 0,
        iam: { model: "none" as const },
      },
      weather: { ambientTemperatureC: 25, referenceWindSpeedMS: 0 },
      inverter: false as const,
    };
    const result = simulateInstant({
      ...commonInput,
      electrical: {
        mode: "simple",
        config: { ...DEFAULT_ELECTRICAL, gammaPmpPerC: 0 },
      },
    });
    expect(result.poa.etaCos).toBeCloseTo(0.5, 12);
    expect(result.effectivePoaWm2).toBeCloseTo(500, 9);
    expect(result.dcPowerW).toBeCloseTo(0.25, 12);

    const precise = simulateInstant({
      ...commonInput,
      electrical: { mode: "single-diode", config: DEFAULT_ELECTRICAL },
    });
    const directReference = singleDiodeCurve({
      irradianceWm2: 500,
      cellTemperatureC: precise.moduleTemperatureC,
      config: DEFAULT_ELECTRICAL,
    });
    expect(precise.effectivePoaWm2).toBeCloseTo(500, 9);
    expect(precise.dcPowerW).toBeCloseTo(directReference.mpp.powerW, 10);
  });

  it("10: rotates the world normal and both sampling axes with one +Y transform", () => {
    const base = createPanelFrame({
      normal: { x: 0, y: 0, z: 1 },
      sampleAxisU: { x: 1, y: 0, z: 0 },
    });
    const expected = rotatePanelFrameAroundY(base, Math.PI / 2);
    const result = simulateInstant({
      timestamp: 0,
      solarOverride: { azimuthDeg: 90, elevationDeg: 30 },
      irradiance: { ghiWm2: 500, dniWm2: 1000, dhiWm2: 0 },
      panel: {
        normal: base.normal,
        sampleAxisU: base.sampleAxisU,
        iam: { model: "none" },
      },
      rotation: { mode: "static", angleRad: Math.PI / 2 },
      inverter: false,
    });
    expect(result.panelFrame).toEqual(expected);
    expect(result.panelNormal).toEqual(expected.normal);
    expect(result.panelFrame.normal.x).toBeCloseTo(1, 12);
    expect(result.panelFrame.normal.y).toBeCloseTo(0, 12);
    expect(result.panelFrame.normal.z).toBeCloseTo(0, 12);
    expect(result.panelFrame.sampleAxisU.x).toBeCloseTo(0, 12);
    expect(result.panelFrame.sampleAxisU.y).toBeCloseTo(0, 12);
    expect(result.panelFrame.sampleAxisU.z).toBeCloseTo(-1, 12);
    expect(result.panelFrame.sampleAxisV.x).toBeCloseTo(0, 12);
    expect(result.panelFrame.sampleAxisV.y).toBeCloseTo(1, 12);
    expect(result.panelFrame.sampleAxisV.z).toBeCloseTo(0, 12);
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

  it("recovers parallel device states at the internal bus when array wiring resistance is nonzero", () => {
    const wiringResistanceOhm = 0.2;
    const result = calculateCircuit({
      devices: [syntheticCurve("parallel-a"), syntheticCurve("parallel-b", 0.75)],
      topology: "parallel",
      wiringResistanceOhm,
      samples: 512,
    });
    const internalBusVoltageV = result.mpp.voltageV + result.mpp.currentA * wiringResistanceOhm;
    expect(result.deviceStates.every((state) =>
      Math.abs(state.voltageV - internalBusVoltageV) < 1e-12)).toBe(true);
    expect(result.deviceStates.reduce((sum, state) => sum + state.currentA, 0))
      .toBeCloseTo(result.mpp.currentA, 12);
    expect(result.mpp.voltageV)
      .toBeCloseTo(internalBusVoltageV - result.mpp.currentA * wiringResistanceOhm, 12);
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

  it("labels a positive-DC PVWatts zero-output point as a low-load cutoff", () => {
    const result = calculateInverter({
      dcPowerW: 0.06,
      dcVoltageV: 9,
      dcCurrentA: 0.06 / 9,
      config: {
        ratedAcPowerW: 10,
        nominalEfficiency: 0.96,
        mpptMinVoltageV: 0.3,
        mpptMaxVoltageV: 20,
        maxDcVoltageV: 1_200,
        maxInputCurrentA: 25,
        startPowerW: 0,
        nightConsumptionW: 0,
        wiringLossFraction: 0.015,
      },
    });

    expect(result.acceptedDcPowerW).toBeGreaterThan(0);
    expect(result.grossAcPowerW).toBe(0);
    expect(result.acPowerW).toBe(0);
    expect(result.status).toBe("low-load-cutoff");
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

  it("uses Haurwitz plus Erbs defaults instead of a fixed daily irradiance triplet", () => {
    const input = {
      startTimestamp: "2024-03-20T00:00:00Z",
      durationHours: 24,
      stepMinutes: 60,
      baseInput: {
        location: { latitudeDeg: 0, longitudeDeg: 0, elevationM: 0 },
        panel: { normal: { x: 0, y: 1, z: 0 }, albedo: 0, iam: { model: "none" as const } },
        weather: { ambientTemperatureC: 25, referenceWindSpeedMS: 0 },
        electrical: {
          mode: "simple" as const,
          config: { ...DEFAULT_ELECTRICAL, gammaPmpPerC: 0 },
        },
        inverter: false as const,
      },
    };
    const first = generateDailySeries(input);
    const second = generateDailySeries(input);
    const daylight = first.samples.filter((sample) => sample.solar.isDaylight);

    expect(daylight.length).toBeGreaterThan(8);
    expect(second.samples.map((sample) => sample.irradiance)).toEqual(
      first.samples.map((sample) => sample.irradiance),
    );
    expect(new Set(daylight.map((sample) => sample.irradiance.ghiWm2.toFixed(6))).size).toBeGreaterThan(4);

    for (const sample of daylight) {
      const cosineZenith = Math.max(
        0,
        Math.cos(sample.solar.zenithDeg * Math.PI / 180),
      );
      const expectedGhiWm2 = 1_098 * cosineZenith * Math.exp(-0.059 / cosineZenith);
      const expected = erbsDecomposition({
        ghiWm2: expectedGhiWm2,
        solarZenithDeg: sample.solar.zenithDeg,
        extraterrestrialNormalWm2: extraterrestrialNormalIrradiance(sample.solar),
      });

      expect(sample.irradiance.ghiWm2).toBeCloseTo(expectedGhiWm2, 9);
      expect(sample.irradiance.dniWm2).toBeCloseTo(expected.dniWm2, 9);
      expect(sample.irradiance.dhiWm2).toBeCloseTo(expected.dhiWm2, 9);
      expect(sample.irradiance.ghiClosure.isClosed).toBe(true);
      expect(
        sample.irradiance.dhiWm2 + sample.irradiance.dniWm2 * cosineZenith,
      ).toBeCloseTo(sample.irradiance.ghiWm2, 9);
      expect(
        Math.abs(sample.irradiance.ghiWm2 - 800) < 1e-9
          && Math.abs(sample.irradiance.dniWm2 - 850) < 1e-9
          && Math.abs(sample.irradiance.dhiWm2 - 120) < 1e-9,
      ).toBe(false);
    }
  });

  it("keeps explicit daily irradiance and irradianceAt resolver precedence", () => {
    const baseInput = {
      solarOverride: { azimuthDeg: 180, elevationDeg: 30 },
      irradiance: { ghiWm2: 600, dniWm2: 1000, dhiWm2: 100 },
      panel: { normal: { x: 0, y: 1, z: 0 }, albedo: 0, iam: { model: "none" as const } },
      inverter: false as const,
    };
    const explicit = generateDailySeries({
      startTimestamp: 0,
      durationHours: 0,
      baseInput,
    });
    expect(explicit.samples[0].irradiance.ghiWm2).toBe(600);
    expect(explicit.samples[0].irradiance.dniWm2).toBe(1000);
    expect(explicit.samples[0].irradiance.dhiWm2).toBe(100);
    expect(explicit.samples[0].irradiance.ghiClosure.isClosed).toBe(true);

    const resolved = generateDailySeries({
      startTimestamp: 0,
      durationHours: 0,
      baseInput,
      irradianceAt: () => ({ ghiWm2: 400, dniWm2: 600, dhiWm2: 100 }),
    });
    expect(resolved.samples[0].irradiance.ghiWm2).toBe(400);
    expect(resolved.samples[0].irradiance.dniWm2).toBe(600);
    expect(resolved.samples[0].irradiance.dhiWm2).toBe(100);
    expect(resolved.samples[0].irradiance.ghiClosure.isClosed).toBe(true);
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
