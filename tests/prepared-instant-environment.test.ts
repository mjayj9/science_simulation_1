import { describe, expect, it } from "vitest";
import {
  DEFAULT_ELECTRICAL,
  prepareInstantEnvironment,
  simulateInstant,
  simulateSimplePanelAtPreparedEnvironment,
} from "../src/lib/physics/index";

describe("prepared instant environment", () => {
  it("matches simulateInstant at machine precision across material samples", () => {
    const timestamps = [
      Date.UTC(2025, 0, 15, 3),
      Date.UTC(2025, 5, 21, 0),
      Date.UTC(2025, 5, 21, 12),
    ];
    for (const timestamp of timestamps) {
      const common = {
        timestamp,
        location: { latitudeDeg: 37.5665, longitudeDeg: 126.978, elevationM: 38 },
        irradiance: { ghiWm2: 713, dniWm2: 624, dhiWm2: 177 },
        weather: {
          ambientTemperatureC: 17.5,
          referenceWindSpeedMS: 3.2,
          referenceWindHeightM: 10,
          roughnessLengthM: 0.03,
          displacementHeightM: 0,
        },
      };
      const prepared = prepareInstantEnvironment(common);
      for (let index = 0; index < 24; index += 1) {
        const angle = 2 * Math.PI * (index + 0.5) / 24;
        const elevation = -0.8 + 1.6 * ((index % 7) / 6);
        const radial = Math.sqrt(Math.max(0, 1 - elevation * elevation));
        const panel = {
          normal: { x: radial * Math.sin(angle), y: elevation, z: radial * Math.cos(angle) },
          areaM2: 0.001 + index * 0.0001,
          efficiency: 0.2,
          heightM: index % 3 === 0 ? 0.005 : 0.02 + index * 0.01,
          visibility: index % 4 === 0 ? 0.7 : 1,
          diffuseVisibility: index % 5 === 0 ? 0.8 : 1,
          groundVisibility: index % 6 === 0 ? 0.6 : 1,
          albedo: 0.2,
          iam: { model: "ashrae" as const, b0: 0.05 },
          diffuseModel: "hay-davies" as const,
          soilingLossFraction: 0.02,
        };
        const electrical = {
          mode: "simple" as const,
          config: { ...DEFAULT_ELECTRICAL, cellsInSeries: 1 },
          aggregateLossFraction: 0.013,
        };
        const direct = simulateInstant({ ...common, panel, electrical, inverter: false });
        const batched = simulateSimplePanelAtPreparedEnvironment(prepared, { panel, electrical });
        expect(batched.solar).toEqual(direct.solar);
        expect(batched.irradiance).toEqual(direct.irradiance);
        expect(batched.poa).toEqual(direct.poa);
        expect(batched.moduleWindSpeedMS).toBe(direct.moduleWindSpeedMS);
        expect(batched.moduleTemperatureC).toBe(direct.moduleTemperatureC);
        expect(batched.effectivePoaWm2).toBe(direct.effectivePoaWm2);
        expect(batched.dcPowerW).toBe(direct.dcPowerW);
      }
    }
  });
});
