import { describe, expect, it } from "vitest";
import { DEFAULT_ELECTRICAL } from "../src/lib/physics/electrical";
import {
  createEngineeringSurfaceCellLayout,
  OFFICIAL_ENGINEERING_SURFACE_CONNECTION,
  solveEngineeringSurfaceElectrical,
  type EngineeringSurfaceElectricalSample,
} from "../src/lib/physics/engineering-surface-electrical";

function deterministicSamples(): EngineeringSurfaceElectricalSample[] {
  const samples: EngineeringSurfaceElectricalSample[] = [];
  for (let uIndex = 0; uIndex < 4; uIndex += 1) {
    for (let vIndex = 0; vIndex < 2; vIndex += 1) {
      const u = (uIndex + 0.5) / 4;
      const v = (vIndex + 0.5) / 2;
      samples.push({
        id: `sample:${uIndex}:${vIndex}`,
        areaM2: 0.005,
        zoneId: "skin",
        zoneIndex: 0,
        u,
        v,
        positionM: { x: u, y: 0, z: v },
        poaWm2: 250 + 700 * u,
        cellTemperatureC: 20 + 25 * u,
      });
    }
  }
  return samples;
}

describe("stable electrical layout optimization", () => {
  it("produces exactly the same circuit result as rebuilding the layout for every solve", () => {
    const samples = deterministicSamples();
    const layout = createEngineeringSurfaceCellLayout(
      samples,
      OFFICIAL_ENGINEERING_SURFACE_CONNECTION,
      DEFAULT_ELECTRICAL.areaM2,
    );
    const withStableLayout = solveEngineeringSurfaceElectrical(
      samples,
      DEFAULT_ELECTRICAL,
      OFFICIAL_ENGINEERING_SURFACE_CONNECTION,
      layout,
    );
    const withRebuiltLayout = solveEngineeringSurfaceElectrical(
      samples,
      DEFAULT_ELECTRICAL,
      OFFICIAL_ENGINEERING_SURFACE_CONNECTION,
    );

    expect(withStableLayout).toEqual(withRebuiltLayout);
    expect(withStableLayout.layoutId).toBe(layout.layoutId);
    expect(withStableLayout.dcPowerW).toBeGreaterThan(0);
  });
});
