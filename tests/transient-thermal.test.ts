import { describe, expect, it } from "vitest";
import {
  DEFAULT_INVERTER,
  advanceMaterialThermalState,
  createMaterialThermalNodes,
  externalConvectionCoefficient,
  materialPoseAtWorldYPhase,
  relativeSurfaceWindSpeedMS,
  simulateTransientSurfaceHistory,
  simulateRotationEffectDecomposition,
  summarizeThermalHistory,
  temperatureAdjustedEfficiency,
  thermalHistoryFrame,
  type MaterialThermalNode,
} from "../src/lib/physics";
import { createComparisonSurface } from "../src/lib/geometry";
import { getOfflineWeather, type WeatherPoint } from "../src/lib/weather";

const node = (id: string, temperatureC = 25, x = 0.1): MaterialThermalNode => ({
  id,
  areaM2: 0.01,
  bodyPositionM: { x, y: 0.1, z: 0 },
  bodyNormal: { x: 1, y: 0, z: 0 },
  characteristicLengthM: 0.1,
  shape: "cylinder",
  temperatureC,
});

const syntheticWeatherPoint = (
  timeUtcMs: number,
  patch: Partial<Omit<WeatherPoint, "timeUtcMs">> = {},
): WeatherPoint => ({
  timeUtcMs,
  ghiWm2: 0,
  dniWm2: 0,
  dhiWm2: 0,
  ambientC: 25,
  windSpeedMs: 1.5,
  windDirectionDeg: 180,
  gustMs: 1.5,
  cloudFraction: 0,
  precipitationMm: 0,
  ...patch,
});

describe("rotating material-node transient heat balance", () => {
  it("rotates material position and normal with the same world-Y phase", () => {
    const pose = materialPoseAtWorldYPhase(node("a"), Math.PI / 2);
    expect(pose.positionM.x).toBeCloseTo(0, 12);
    expect(pose.positionM.z).toBeCloseTo(-0.1, 12);
    expect(pose.normal.x).toBeCloseTo(0, 12);
    expect(pose.normal.z).toBeCloseTo(-1, 12);
  });

  it("uses |u-w x r| rather than an RPM cooling multiplier", () => {
    expect(relativeSurfaceWindSpeedMS({ x: 0, y: 0, z: 0 }, 10, { x: 0.1, y: 0, z: 0 })).toBeCloseTo(1, 12);
    expect(relativeSurfaceWindSpeedMS({ x: 0, y: 0, z: -1 }, 10, { x: 0.1, y: 0, z: 0 })).toBeCloseTo(0, 12);
  });

  it("selects published shape correlations and permits negligible low-Re improvement", () => {
    const still = externalConvectionCoefficient("cylinder", 0, 0.2);
    const moving = externalConvectionCoefficient("cylinder", 0.01, 0.2);
    const sphere = externalConvectionCoefficient("sphere", 1, 0.2);
    expect(still.correlation).toBe("churchill-bernstein-cylinder");
    expect(moving.coefficientWm2K - still.coefficientWm2K).toBeLessThan(1);
    expect(sphere.correlation).toBe("whitaker-sphere");
    expect(sphere.sourceUrl).toContain("10.1002/aic.690180219");
  });

  it("conserves paired conduction energy and closes the node energy ledger", () => {
    const result = advanceMaterialThermalState({
      nodes: [node("hot", 60, -0.1), node("cold", 20, 0.1)],
      edges: [{ firstNodeId: "hot", secondNodeId: "cold", conductanceWPerK: 0.8 }],
      durationSeconds: 60,
      environment: {
        ambientTemperatureC: 40,
        effectiveSkyTemperatureC: 40,
        windVelocityMS: { x: 0, y: 0, z: 0 },
        angularVelocityRadS: 0,
        rotationAngleRad: 0,
      },
      fluxAt: () => ({ absorbedSolarWm2: 0, electricalPowerWm2: 0 }),
      config: {
        emissivity: 0,
        minimumConvectionWm2K: 0,
        backConvectionFactor: 0,
        maximumSubstepSeconds: 1,
      },
    });
    expect(result.nodes[0].temperatureC).toBeLessThan(60);
    expect(result.nodes[1].temperatureC).toBeGreaterThan(20);
    expect(result.conductionCancellationJ).toBeCloseTo(0, 9);
    expect(result.storedEnergyChangeJ).toBeCloseTo(0, 7);
    expect(result.energyResidualJ).toBeCloseTo(0, 7);
  });

  it("heats under absorbed sun, extracts electrical energy, and converges with halved outer timestep", () => {
    const input = (nodes: MaterialThermalNode[], durationSeconds: number, rotationAngleRad = 0) => advanceMaterialThermalState({
      nodes,
      durationSeconds,
      environment: {
        ambientTemperatureC: 30,
        effectiveSkyTemperatureC: 20,
        windVelocityMS: { x: 2, y: 0, z: 0 },
        angularVelocityRadS: 2,
        rotationAngleRad,
      },
      fluxAt: ({ node: current }) => ({
        absorbedSolarWm2: 800,
        electricalPowerWm2: 800 * temperatureAdjustedEfficiency(0.2, -0.004, current.temperatureC),
      }),
      config: { maximumSubstepSeconds: 2 },
    });
    const one = input([node("pv", 30)], 600);
    const halfA = input([node("pv", 30)], 300);
    const halfB = input(halfA.nodes, 300, 2 * 300);
    expect(one.nodes[0].temperatureC).toBeGreaterThan(30);
    expect(one.nodes[0].temperatureC).toBeCloseTo(halfB.nodes[0].temperatureC, 3);
    expect(Math.abs(one.energyResidualJ)).toBeLessThan(1e-6 * Math.max(1, Math.abs(one.netBoundaryEnergyJ)));
  });

  it("reports finite 45 C duration and hotspot persistence without smoothing", () => {
    const frames = [
      thermalHistoryFrame(0, [node("a", 40), node("b", 42)]),
      thermalHistoryFrame(3600, [node("a", 46), node("b", 50)]),
      thermalHistoryFrame(7200, [node("a", 48), node("b", 52)]),
      thermalHistoryFrame(10_800, [node("a", 40), node("b", 41)]),
    ];
    const summary = summarizeThermalHistory(frames, 45);
    expect(summary.maximumTemperatureC).toBe(52);
    expect(summary.hoursAboveThreshold).toBe(1);
    expect(summary.hotspotPersistenceHours).toBe(1);
    expect(summary.maximumStandardDeviationC).toBeGreaterThan(0);
  });

  it("runs a persistent rotating material history on exact continuous-skin area", () => {
    const surface = createComparisonSurface("cylinder", {
      landAreaM2: 0.05,
      azimuthSamples: 16,
      meridionalSegments: 4,
    });
    const material = createMaterialThermalNodes(surface, 25);
    expect(material.nodes.reduce((sum, item) => sum + item.areaM2, 0))
      .toBeCloseTo(surface.dimensions.activeAreaM2, 12);
    expect(material.conductionAssumption).toBe("adiabatic-between-quadrature-nodes");
    const start = Date.UTC(2026, 5, 20, 15);
    const weather = getOfflineWeather({
      latitudeDeg: 37.5665,
      longitudeDeg: 126.978,
      elevationM: 38,
      start,
      end: start + 24 * 3_600_000,
      stepMinutes: 60,
      offlinePreset: "clear",
      seed: "material-history",
    }, { now: new Date(0) }).points;
    const historyInput = {
      surface,
      weather,
      location: { latitudeDeg: 37.5665, longitudeDeg: 126.978, elevationM: 38 },
      rpm: 3,
      referenceEfficiency: 0.2,
      gammaPerC: -0.004,
      config: { maximumSubstepSeconds: 60 },
    } as const;
    const result = simulateTransientSurfaceHistory({
      ...historyInput,
      inverter: {
        ...DEFAULT_INVERTER,
        ratedAcPowerW: 8,
        startPowerW: 0.1,
        wiringLossFraction: 0.04,
      },
    });
    const dcBypass = simulateTransientSurfaceHistory({
      ...historyInput,
      inverter: false,
    });

    expect(result.frames).toHaveLength(weather.length);
    for (const frame of result.frames) {
      const nodeTemperatures = Object.values(frame.temperaturesCByNode);
      expect(nodeTemperatures).toHaveLength(material.nodes.length);
      expect([
        frame.timeSeconds,
        frame.averageTemperatureC,
        frame.minimumTemperatureC,
        frame.maximumTemperatureC,
        frame.standardDeviationC,
        ...nodeTemperatures,
      ].every(Number.isFinite)).toBe(true);
      expect(frame.minimumTemperatureC).toBeGreaterThan(-20);
      expect(frame.maximumTemperatureC).toBeLessThan(120);
      expect(frame.averageTemperatureC + 1e-10).toBeGreaterThanOrEqual(frame.minimumTemperatureC);
      expect(frame.averageTemperatureC - 1e-10).toBeLessThanOrEqual(frame.maximumTemperatureC);
      expect(nodeTemperatures.every((temperatureC) => temperatureC > -20 && temperatureC < 120))
        .toBe(true);
    }
    expect(result.summary.maximumTemperatureC).toBeGreaterThan(result.summary.averageTemperatureC);
    expect(result.summary.maximumTemperatureC).toBeLessThan(180);
    expect(result.dcElectricalEnergyWh).toBeGreaterThan(0);
    expect(result.electricalEnergyWh).toBeCloseTo(result.dcElectricalEnergyWh, 12);
    expect(result.acEnergyWh).toBeGreaterThan(0);
    expect(result.acEnergyWh).toBeLessThanOrEqual(result.dcElectricalEnergyWh);
    expect(result.inverterLossWh).toBeCloseTo(
      result.dcElectricalEnergyWh - result.acEnergyWh,
      10,
    );
    expect(result.inverterLossWh).toBeGreaterThan(0);
    expect(result.absorbedSolarEnergyWh).toBeGreaterThan(result.dcElectricalEnergyWh);
    expect(Math.abs(result.energyResidualJ)).toBeLessThan(1e-6);
    expect(dcBypass.acEnergyWh).toBeCloseTo(dcBypass.dcElectricalEnergyWh, 12);
    expect(dcBypass.inverterLossWh).toBeCloseTo(0, 12);
    expect(dcBypass.dcElectricalEnergyWh).toBeCloseTo(result.dcElectricalEnergyWh, 12);
    expect(dcBypass.absorbedSolarEnergyWh).toBeCloseTo(result.absorbedSolarEnergyWh, 12);
    expect(dcBypass.energyResidualJ).toBeCloseTo(result.energyResidualJ, 12);
    expect(dcBypass.frames.at(-1)?.averageTemperatureC)
      .toBeCloseTo(result.frames.at(-1)?.averageTemperatureC ?? Number.NaN, 12);
  }, 30_000);

  it("converges in material temperature and AC energy as the weather timestep is halved", () => {
    const surface = createComparisonSurface("plane", {
      landAreaM2: 0.05,
      planeTiltDeg: 30,
      planeAzimuthDeg: 180,
      azimuthSamples: 16,
      meridionalSegments: 4,
    });
    const start = Date.UTC(2026, 5, 20, 0);
    const durationMinutes = 4 * 60;
    const weatherAtResolution = (stepMinutes: number): WeatherPoint[] => Array.from(
      { length: durationMinutes / stepMinutes + 1 },
      (_, index) => {
        const elapsedMinutes = index * stepMinutes;
        const fraction = elapsedMinutes / durationMinutes;
        const daylightShape = 0.65 + 0.35 * Math.sin(Math.PI * fraction);
        return syntheticWeatherPoint(start + elapsedMinutes * 60_000, {
          ghiWm2: 680 * daylightShape,
          dniWm2: 760 * daylightShape,
          dhiWm2: 90 + 35 * daylightShape,
          ambientC: 25 + 7 * Math.sin(Math.PI * fraction),
          windSpeedMs: 1.5 + 0.35 * Math.cos(2 * Math.PI * fraction),
          gustMs: 2.2,
        });
      },
    );
    const run = (stepMinutes: number) => simulateTransientSurfaceHistory({
      surface,
      weather: weatherAtResolution(stepMinutes),
      location: { latitudeDeg: 37.5665, longitudeDeg: 126.978, elevationM: 38 },
      rpm: 0,
      referenceEfficiency: 0.2,
      gammaPerC: -0.004,
      inverter: {
        ...DEFAULT_INVERTER,
        ratedAcPowerW: 20,
      },
      config: { maximumSubstepSeconds: 2 },
    });
    const coarse = run(20);
    const medium = run(10);
    const fine = run(5);
    const terminalTemperatureC = (result: typeof fine) => result.frames.at(-1)!.averageTemperatureC;
    const successiveDifferences = (select: (result: typeof fine) => number) => ({
      coarseToMedium: Math.abs(select(coarse) - select(medium)),
      mediumToFine: Math.abs(select(medium) - select(fine)),
    });
    const terminalTemperatureDifference = successiveDifferences(terminalTemperatureC);
    const averageTemperatureDifference = successiveDifferences(
      (result) => result.summary.averageTemperatureC,
    );
    const acEnergyDifference = successiveDifferences((result) => result.acEnergyWh);

    expect(terminalTemperatureDifference.mediumToFine)
      .toBeLessThan(terminalTemperatureDifference.coarseToMedium);
    expect(averageTemperatureDifference.mediumToFine)
      .toBeLessThan(averageTemperatureDifference.coarseToMedium);
    expect(acEnergyDifference.mediumToFine).toBeLessThan(acEnergyDifference.coarseToMedium);
    expect(terminalTemperatureDifference.mediumToFine).toBeLessThan(0.25);
    expect(averageTemperatureDifference.mediumToFine).toBeLessThan(0.15);
    expect(acEnergyDifference.mediumToFine / fine.acEnergyWh).toBeLessThan(0.01);
  }, 30_000);

  it("increases temperature-coefficient DC and AC loss at higher summer ambient temperature", () => {
    const surface = createComparisonSurface("plane", {
      landAreaM2: 0.05,
      planeTiltDeg: 0,
      planeAzimuthDeg: 180,
      azimuthSamples: 16,
      meridionalSegments: 4,
    });
    const start = Date.UTC(2026, 5, 20, 2);
    const weatherAtAmbient = (ambientC: number): WeatherPoint[] => Array.from(
      { length: 25 },
      (_, index) => syntheticWeatherPoint(start + index * 10 * 60_000, {
        ghiWm2: 600,
        dniWm2: 0,
        dhiWm2: 600,
        ambientC,
        windSpeedMs: 1.5,
        gustMs: 2,
      }),
    );
    const run = (ambientC: number, gammaPerC: number) => simulateTransientSurfaceHistory({
      surface,
      weather: weatherAtAmbient(ambientC),
      location: { latitudeDeg: 37.5665, longitudeDeg: 126.978, elevationM: 38 },
      rpm: 0,
      referenceEfficiency: 0.2,
      gammaPerC,
      diffuseModel: "isotropic",
      inverter: {
        ...DEFAULT_INVERTER,
        ratedAcPowerW: 20,
      },
      config: { maximumSubstepSeconds: 2 },
    });
    const coolReference = run(20, 0);
    const hotReference = run(40, 0);
    const coolDerated = run(20, -0.004);
    const hotDerated = run(40, -0.004);
    const relativeLoss = (
      reference: typeof coolReference,
      derated: typeof coolReference,
      energy: "dcElectricalEnergyWh" | "acEnergyWh",
    ) => 1 - derated[energy] / reference[energy];
    const coolDcLoss = relativeLoss(coolReference, coolDerated, "dcElectricalEnergyWh");
    const hotDcLoss = relativeLoss(hotReference, hotDerated, "dcElectricalEnergyWh");
    const coolAcLoss = relativeLoss(coolReference, coolDerated, "acEnergyWh");
    const hotAcLoss = relativeLoss(hotReference, hotDerated, "acEnergyWh");

    expect(hotReference.dcElectricalEnergyWh).toBeCloseTo(coolReference.dcElectricalEnergyWh, 10);
    expect(hotReference.acEnergyWh).toBeCloseTo(coolReference.acEnergyWh, 10);
    expect(hotDerated.summary.averageTemperatureC - coolDerated.summary.averageTemperatureC)
      .toBeGreaterThan(15);
    expect(hotDcLoss).toBeGreaterThan(coolDcLoss + 0.05);
    expect(hotAcLoss).toBeGreaterThan(coolAcLoss + 0.05);
    expect(hotDerated.dcElectricalEnergyWh).toBeLessThan(coolDerated.dcElectricalEnergyWh);
    expect(hotDerated.acEnergyWh).toBeLessThan(coolDerated.acEnergyWh);
  }, 30_000);

  it("interpolates wind across north without reversing it at the 359-to-1-degree wrap", () => {
    const surface = createComparisonSurface("plane", {
      landAreaM2: 0.05,
      planeTiltDeg: 0,
      azimuthSamples: 16,
      meridionalSegments: 4,
    });
    const start = Date.UTC(2026, 5, 20, 2);
    const run = (leftDirectionDeg: number, rightDirectionDeg: number) =>
      simulateTransientSurfaceHistory({
        surface,
        weather: [leftDirectionDeg, rightDirectionDeg].map((windDirectionDeg, index) =>
          syntheticWeatherPoint(start + index * 3_600_000, {
            ambientC: 45,
            windSpeedMs: 4,
            windDirectionDeg,
            gustMs: 4,
          })),
        location: { latitudeDeg: 37.5665, longitudeDeg: 126.978 },
        rpm: 6,
        referenceEfficiency: 0.2,
        gammaPerC: -0.004,
        inverter: false,
        initialTemperatureC: 20,
        config: { maximumSubstepSeconds: 2 },
      });
    const wrapped = run(359, 1);
    const north = run(0, 0);
    const reversedByLinearMean = run(180, 180);
    const terminalTemperatures = (result: typeof wrapped) =>
      Object.values(result.frames.at(-1)!.temperaturesCByNode);
    const maximumNodeDifferenceC = (first: typeof wrapped, second: typeof wrapped) =>
      Math.max(...terminalTemperatures(first).map((temperatureC, index) =>
        Math.abs(temperatureC - terminalTemperatures(second)[index])));
    const wrappedToNorthC = maximumNodeDifferenceC(wrapped, north);
    const northToReversedC = maximumNodeDifferenceC(north, reversedByLinearMean);

    expect(northToReversedC).toBeGreaterThan(1e-6);
    expect(wrappedToNorthC / northToReversedC).toBeLessThan(0.2);
  }, 30_000);

  it("closes the four-run optical/thermal rotation factorial decomposition", () => {
    const surface = createComparisonSurface("cylinder", {
      landAreaM2: 0.05,
      azimuthSamples: 16,
      meridionalSegments: 4,
    });
    const start = Date.UTC(2026, 5, 20, 15);
    const weather = getOfflineWeather({
      latitudeDeg: 37.5665,
      longitudeDeg: 126.978,
      elevationM: 38,
      start,
      end: start + 24 * 3_600_000,
      stepMinutes: 120,
      offlinePreset: "clear",
      seed: "rotation-decomposition",
    }, { now: new Date(0) }).points;
    const result = simulateRotationEffectDecomposition({
      surface,
      weather,
      location: { latitudeDeg: 37.5665, longitudeDeg: 126.978, elevationM: 38 },
      rpm: 2,
      referenceEfficiency: 0.2,
      gammaPerC: -0.004,
      inverter: false,
      config: { maximumSubstepSeconds: 120 },
    });
    const deltas = result.acEnergyDeltasWh;
    expect(deltas.opticalOnly + deltas.thermalOnly + deltas.interaction)
      .toBeCloseTo(deltas.net, 10);
    // An axisymmetric cylinder has invariant area-integrated optics in a
    // uniform unobstructed field; only quadrature tolerance remains.
    expect(Math.abs(deltas.opticalOnly))
      .toBeLessThan(0.005 * result.staticFull.acEnergyWh);
    expect(Object.values(result.temperatureDeltas).every(Number.isFinite)).toBe(true);
  }, 30_000);

  it("makes all four counterfactual histories identical at zero RPM", () => {
    const surface = createComparisonSurface("sphere", {
      landAreaM2: 0.05,
      azimuthSamples: 16,
      meridionalSegments: 4,
    });
    const start = Date.UTC(2026, 5, 20, 15);
    const weather = getOfflineWeather({
      latitudeDeg: 37.5665,
      longitudeDeg: 126.978,
      start,
      end: start + 6 * 3_600_000,
      stepMinutes: 120,
      offlinePreset: "clear",
      seed: "zero-decomposition",
    }, { now: new Date(0) }).points;
    const result = simulateRotationEffectDecomposition({
      surface,
      weather,
      location: { latitudeDeg: 37.5665, longitudeDeg: 126.978 },
      rpm: 0,
      referenceEfficiency: 0.2,
      gammaPerC: -0.004,
      inverter: false,
      config: { maximumSubstepSeconds: 120 },
    });
    expect(result.rotatingOpticalOnly.acEnergyWh).toBe(result.staticFull.acEnergyWh);
    expect(result.rotatingThermalOnly.acEnergyWh).toBe(result.staticFull.acEnergyWh);
    expect(result.rotatingFull.acEnergyWh).toBe(result.staticFull.acEnergyWh);
    expect(Object.values(result.acEnergyDeltasWh).every((deltaWh) => Math.abs(deltaWh) < 1e-12))
      .toBe(true);
  }, 30_000);
});
