import { describe, expect, expectTypeOf, it } from "vitest";
import type { PresetName } from "../src/lib/geometry";
import {
  RESEARCH_PRESET_IDS,
  RESEARCH_PRESETS,
  assertResearchPresetInvariant,
  createResearchInputApplication,
  getResearchPreset,
  selectGeneralPreset,
  selectResearchPreset,
  type ResearchGeneralPresetOverlap,
  type ResearchPreset,
  type ResearchPresetId,
} from "../src/lib/research";
import { calculatePOA, hemisphereViewFactors } from "../src/lib/physics";

const GENERAL_PRESET_IDS: readonly PresetName[] = [
  "cube",
  "plane",
  "cylinder",
  "sphere",
  "hemisphere",
  "cone",
  "free",
];

function allObjects(value: unknown): object[] {
  if (!value || typeof value !== "object") return [];
  return [value, ...Object.values(value).flatMap(allObjects)];
}

describe("research-only source presets", () => {
  it("defines DOI-identified A/B/C presets without ordinary-preset overlap", () => {
    expectTypeOf<ResearchGeneralPresetOverlap>().toEqualTypeOf<never>();
    expectTypeOf<ResearchPresetId>().not.toEqualTypeOf<PresetName>();
    expect(RESEARCH_PRESET_IDS).toEqual(["research:A", "research:B", "research:C"]);
    expect(RESEARCH_PRESET_IDS.some((id) => GENERAL_PRESET_IDS.includes(id as PresetName))).toBe(false);
    expect(Object.values(RESEARCH_PRESETS).map((preset) => preset.doi)).toEqual([
      "10.1039/C2EE21170J",
      "10.1557/mrc.2020.44",
      "10.1002/ese3.1717",
    ]);
  });

  it("keeps every canonical preset and nested condition immutable", () => {
    for (const preset of Object.values(RESEARCH_PRESETS)) {
      expect(preset.namespace).toBe("research");
      expect(() => assertResearchPresetInvariant(preset)).not.toThrow();
      expect(preset.policy.application).toBe("explicit-research-run-only");
      expect(preset.policy.forbiddenTransformations).toEqual([
        "calibration-factor",
        "shape-multiplier",
        "reported-output-target",
      ]);
      expect(allObjects(preset).every(Object.isFrozen)).toBe(true);
      expect(preset.conditions.length).toBeGreaterThanOrEqual(8);
      const primarySourceUrls: readonly string[] = preset.primarySourceUrls;
      expect(preset.conditions.every((condition) => primarySourceUrls.includes(condition.sourceUrl))).toBe(true);
      expect(preset.executableInputs.every((input) => (
        input.value === null
          ? input.status === "missing" && input.sourceUrl === null
          : input.sourceUrl !== null
      ))).toBe(true);
      expect(preset.executableInputs.filter((input) => input.value === null).map((input) => input.key)).toEqual(
        preset.missingInputs,
      );
    }
  });

  it("does not expose hidden executable calibration, multiplier, or target settings", () => {
    const forbiddenKeys = new Set([
      "calibrationFactor",
      "calibrationCoefficient",
      "shapeMultiplier",
      "powerMultiplier",
      "forcedOutput",
      "targetGain",
      "targetPower",
    ]);
    for (const preset of Object.values(RESEARCH_PRESETS)) {
      for (const object of allObjects(preset)) {
        expect(Object.keys(object).some((key) => forbiddenKeys.has(key))).toBe(false);
      }
    }
    const invalid = structuredClone(RESEARCH_PRESETS["research:A"]) as unknown as Record<string, unknown>;
    invalid.shapeMultiplier = 2;
    expect(() => assertResearchPresetInvariant(invalid as unknown as ResearchPreset)).toThrow(/forbidden/);
  });

  it("returns only the canonical frozen research definition", () => {
    const preset = getResearchPreset("research:B");
    expect(preset).toBe(RESEARCH_PRESETS["research:B"]);
    expect(Object.isFrozen(preset)).toBe(true);
    expect(() => getResearchPreset("sphere" as ResearchPresetId)).toThrow(/Unknown research preset/);
  });

  it("exposes only explicit values for application and retains null source gaps", () => {
    const a = createResearchInputApplication("research:A");
    const b = createResearchInputApplication("research:B");
    const c = createResearchInputApplication("research:C");

    expect(a.appliedInputs.some((input) => input.key === "comparison.landAreaM2" && input.value === 0.001225)).toBe(true);
    expect(a.missingInputs).toContain("pv.activeAreaM2");
    expect(b.appliedInputs.some((input) => input.key === "optics.groundAlbedo" && input.value === 0.85)).toBe(true);
    expect(b.missingInputs).toEqual(["geometry.heightM", "support.footprintM2"]);
    expect(c.appliedInputs.some((input) => input.key === "pv.activeAreaM2" && input.value === 0.198)).toBe(true);
    expect(c.missingInputs).toContain("irradiance.timeSeries");
    expect([a, b, c].every((application) => (
      application.appliedInputs.every((input) => input.value !== null)
      && allObjects(application).every(Object.isFrozen)
    ))).toBe(true);
  });

  it("drops the complete research application when returning to a general preset", () => {
    const selected = selectResearchPreset("research:C");
    expect(selected.researchApplication.appliedInputs.length).toBeGreaterThan(0);

    const reverted = selectGeneralPreset("sphere");
    expect(reverted).toEqual({
      namespace: "general",
      presetId: "sphere",
      researchApplication: null,
    });
    expect(JSON.stringify(reverted)).not.toMatch(/research:C|ese3\.1717|activeAreaM2|groundAlbedo/);
    expect(selectGeneralPreset("hemisphere").researchApplication).toBeNull();
  });
});

describe("surface-sample view factors and irradiance bounds", () => {
  it("uses F_sky/F_ground=(1 +/- n_y)/2 for normalized arbitrary normals", () => {
    expect(hemisphereViewFactors({ x: 0, y: 4, z: 0 })).toEqual({ sky: 1, ground: 0 });
    expect(hemisphereViewFactors({ x: 0, y: -3, z: 0 })).toEqual({ sky: 0, ground: 1 });
    expect(hemisphereViewFactors({ x: 9, y: 0, z: 0 })).toEqual({ sky: 0.5, ground: 0.5 });
    const tilted = hemisphereViewFactors({ x: Math.sqrt(3), y: 1, z: 0 });
    expect(tilted.sky).toBeCloseTo(0.75, 14);
    expect(tilted.ground).toBeCloseTo(0.25, 14);
    expect(tilted.sky + tilted.ground).toBeCloseTo(1, 14);
  });

  it("decomposes direct/diffuse/ground POA and caps albedo energy", () => {
    const poa = calculatePOA({
      ghiWm2: 800,
      dniWm2: 700,
      dhiWm2: 150,
      solarZenithDeg: 30,
      sunDirection: { x: 0, y: Math.cos(Math.PI / 6), z: Math.sin(Math.PI / 6) },
      panelNormal: { x: 0, y: 0, z: 1 },
      visibility: 0.7,
      diffuseVisibility: 0.6,
      groundVisibility: 0.4,
      albedo: 0.3,
      diffuseModel: "isotropic",
      iam: { model: "none" },
    });

    expect(poa.skyViewFactor).toBeCloseTo(0.5, 14);
    expect(poa.groundViewFactor).toBeCloseTo(0.5, 14);
    expect(poa.groundReflectedUpperBoundWm2).toBeCloseTo(800 * 0.3 * 0.4, 14);
    expect(poa.groundPoaWm2).toBeCloseTo(poa.groundReflectedUpperBoundWm2 * 0.5, 14);
    expect(poa.groundPoaWm2).toBeLessThanOrEqual(poa.groundReflectedUpperBoundWm2);
    expect(poa.totalWm2).toBeCloseTo(
      poa.directPoaWm2 + poa.diffusePoaWm2 + poa.groundPoaWm2,
      14,
    );
  });
});
