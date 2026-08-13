import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  advanceLocalDateTime,
  annualPlaneScenarioFingerprint,
  annualRunScopeLabelKo,
  annualRunCohortReady,
  omitAnnualVariantRecords,
  annualTransientResultReady,
  engineeringAnnualResultReady,
  annualTransientComparisonSupport,
  automaticDataModeFromSeries,
  comparisonAnnualVariantId,
  electricalConnectionDeltaKWh,
  resolveComparisonFootprintMode,
  partitionComparisonAnnualVariantStages,
  resolveAnnualComparisonRankEligibility,
  integrateWh,
  obstacleBounds,
} from "../src/ui/SimulatorClient";
import {
  rotationIntervalSamples,
  type SimulationKernelInput,
  type SimulationVariantWorkItem,
} from "../src/workers";
import type { WeatherPoint, WeatherSeries } from "../src/lib/weather";
import type { SceneObstacle } from "../src/ui/ThreeWorkspace";

function weatherPoint(timeUtcMs: number): WeatherPoint {
  return {
    timeUtcMs,
    ghiWm2: 600,
    dniWm2: 1_000,
    dhiWm2: 100,
    ambientC: 25,
    windSpeedMs: 0,
    windDirectionDeg: 0,
    gustMs: 0,
    cloudFraction: 0,
    precipitationMm: 0,
  };
}

function automaticSeries(provider: WeatherSeries["provenance"]["provider"]): WeatherSeries {
  return {
    points: [weatherPoint(0)],
    provenance: {
      provider,
      kind: provider === "manual" ? "manual" : provider === "offline" ? "model-estimate" : "tmy",
      labelKo: "테스트",
      fetchedAt: new Date(0).toISOString(),
      temporalResolution: "1 hour",
    },
  };
}

function oneDayPeriodicEnergy(samplesPerTurn: number): number {
  const start = Date.UTC(2026, 5, 21);
  const weather = Array.from({ length: 25 }, (_, index) => weatherPoint(start + index * 3_600_000));
  const variant: SimulationVariantWorkItem = {
    variantId: "ui-daily-test",
    panelCount: 1,
    totalPanelAreaM2: 1,
    referenceEfficiency: 1,
    rotation: { mode: "fixed", rpm: 1 / 60, initialAngleRad: 0, referenceTimestamp: start },
    rotationPhaseSamples: samplesPerTurn,
  };
  const input: SimulationKernelInput = { variants: [variant], weather };
  const points = weather.map((point, stepIndex) => {
    const samples = rotationIntervalSamples({ input, variant, weather: point, stepIndex });
    const ac = samples.reduce(
      (sum, sample) => sum + Math.max(0, Math.cos(sample.angleRad)) * 100 * sample.weight,
      0,
    );
    return {
      minute: stepIndex * 60,
      ac,
      intervalMean: samples[0]?.intervalAveraged ?? false,
    };
  });
  return integrateWh(points);
}

describe("SimulatorClient time and data-mode helpers", () => {
  it("preserves date/month/year rollover during playback", () => {
    expect(advanceLocalDateTime("2026-06-21T23:30", 60)).toBe("2026-06-22T00:30");
    expect(advanceLocalDateTime("2026-12-31T23:30", 60)).toBe("2027-01-01T00:30");
  });

  it("never resolves the automatic-source tab back to manual", () => {
    expect(automaticDataModeFromSeries(null)).toBe("offline");
    expect(automaticDataModeFromSeries(automaticSeries("manual"))).toBe("offline");
    expect(automaticDataModeFromSeries(automaticSeries("offline"))).toBe("offline");
    expect(automaticDataModeFromSeries(automaticSeries("pvgis"))).toBe("pvgis-file");
  });
});

describe("SimulatorClient obstacle render/physics alignment", () => {
  const wall: SceneObstacle = {
    id: "rotated-wall",
    type: "wall",
    label: "wall",
    position: [1, 2, 3],
    scale: [2, 1, 0.5],
  };

  it("uses the rendered primitive size and scale for an unrotated world AABB", () => {
    const bounds = obstacleBounds(wall);
    expect(bounds.min).toEqual([0.84, 1.955, 2.997]);
    expect(bounds.max).toEqual([1.16, 2.045, 3.003]);
  });

  it("rotates the scaled local bounds with Three's XYZ Euler pose", () => {
    const yawBounds = obstacleBounds({ ...wall, rotation: [0, Math.PI / 2, 0] });
    expect(yawBounds.min[0]).toBeCloseTo(0.997, 12);
    expect(yawBounds.max[0]).toBeCloseTo(1.003, 12);
    expect(yawBounds.min[1]).toBeCloseTo(1.955, 12);
    expect(yawBounds.max[1]).toBeCloseTo(2.045, 12);
    expect(yawBounds.min[2]).toBeCloseTo(2.84, 12);
    expect(yawBounds.max[2]).toBeCloseTo(3.16, 12);

    const rollBounds = obstacleBounds({ ...wall, rotation: [Math.PI / 2, 0, 0] });
    expect(rollBounds.min[0]).toBeCloseTo(0.84, 12);
    expect(rollBounds.max[0]).toBeCloseTo(1.16, 12);
    expect(rollBounds.min[1]).toBeCloseTo(1.997, 12);
    expect(rollBounds.max[1]).toBeCloseTo(2.003, 12);
    expect(rollBounds.min[2]).toBeCloseTo(2.955, 12);
    expect(rollBounds.max[2]).toBeCloseTo(3.045, 12);
  });

  it("uses full rendered cone extents for mountain and tree proxies", () => {
    const mountain = obstacleBounds({ ...wall, type: "mountain", position: [0, 0, 0], scale: [1, 1, 1] });
    expect(mountain.min).toEqual([-0.09, -0.09, -0.09]);
    expect(mountain.max).toEqual([0.09, 0.09, 0.09]);
    const tree = obstacleBounds({ ...wall, type: "tree", position: [0, 0, 0], scale: [1, 1, 1] });
    expect(tree.min).toEqual([-0.045, -0.06, -0.045]);
    expect(tree.max).toEqual([0.045, 0.06, 0.045]);
  });
});

describe("SimulatorClient fixed-RPM daily integration", () => {
  it("uses an interval mean once instead of trapezoid-averaging adjacent interval means", () => {
    expect(integrateWh([
      { minute: 0, ac: 10, intervalMean: true },
      { minute: 60, ac: 1_000, intervalMean: false },
    ])).toBe(10);
    expect(integrateWh([
      { minute: 0, ac: 10, intervalMean: false },
      { minute: 60, ac: 20, intervalMean: false },
    ])).toBe(15);
  });

  it("converges full-day energy as periodic phase density increases", () => {
    const analytic = 24 * 100 / Math.PI;
    const error12 = Math.abs(oneDayPeriodicEnergy(12) - analytic);
    const error24 = Math.abs(oneDayPeriodicEnergy(24) - analytic);
    const error72 = Math.abs(oneDayPeriodicEnergy(72) - analytic);
    expect(error24).toBeLessThan(error12);
    expect(error72).toBeLessThan(error24);
    expect(error72 / analytic).toBeLessThan(0.001);
  });

  it("keeps the production UI wired to periodic quadrature and selected-panel POA", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/ui/SimulatorClient.tsx", import.meta.url)),
      "utf8",
    );
    expect(source).toContain("rotationIntervalSamples({");
    expect(source).not.toContain("const phaseCap =");
    expect(source).not.toContain("const turnsInInterval =");
    expect(source).toContain("poa += (diagnosticPanel?.poaWm2 ?? 0) * phase.weight");
    expect(source).toContain("const daylight = solar.elevationDeg > 0;");
    expect(source).toContain("automaticWeatherSeries: safeStoredWeatherSeries(automaticWeatherSeries)");
    expect(source).toContain("selectedPanel.effectiveWm2 / 10)).toFixed(4)");
  });

  it("loads the annual browser worker through the Vite worker bundle", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/ui/SimulatorClient.tsx", import.meta.url)),
      "utf8",
    );
    expect(source).toContain('import SimulationWorker from "../workers/simulation.worker?worker";');
    expect(source).toContain("const worker = new SimulationWorker();");
    expect(source).not.toContain('new URL("../workers/simulation.worker.ts", import.meta.url)');
  });
});

describe("SimulatorClient equal-land comparison wiring", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/ui/SimulatorClient.tsx", import.meta.url)),
    "utf8",
  );

  it("offers all six shapes and keeps equal land as the default basis", () => {
    expect(source).toContain(
      'const COMPARISON_SHAPES = ["plane", "cube", "cylinder", "sphere", "hemisphere", "cone"]',
    );
    expect(source).toContain('basis: "land"');
    expect(source).toContain('const [screen, setScreen] = useState<Screen>("compare")');
    expect(source).toContain('useState<PresetName[]>([...COMPARISON_SHAPES])');
    expect(source).toContain('basis: "land",\n    landAreaM2: comparisonSettings.landAreaM2');
  });

  it("stages ideal quasi, actual transient E11, and engineering variants under the worker cap", () => {
    expect(comparisonAnnualVariantId("sphere", "ideal-quasi")).toBe("compare:sphere:ideal-quasi");
    expect(comparisonAnnualVariantId("sphere", "ideal-transient")).toBe("compare:sphere:ideal-transient");
    expect(comparisonAnnualVariantId("sphere", "engineering")).toBe("compare:sphere:engineering");
    expect(annualTransientComparisonSupport({ obstaclesIncluded: false, planeTrackingMode: "fixed" })).toEqual({ supported: true });
    expect(annualTransientComparisonSupport({ obstaclesIncluded: true, planeTrackingMode: "fixed" }).supported).toBe(false);
    expect(annualTransientComparisonSupport({ obstaclesIncluded: false, planeTrackingMode: "dual-axis" }).supported).toBe(false);
    const variants = (["plane", "cube", "cylinder", "sphere", "hemisphere", "cone"] as const)
      .flatMap((shape) => (["ideal-quasi", "engineering", "ideal-transient"] as const)
        .map((model) => ({ variantId: comparisonAnnualVariantId(shape, model) })));
    const stages = partitionComparisonAnnualVariantStages(variants);
    expect(stages.map((stage) => stage.length)).toEqual([12, 6]);
    expect(stages.flat().map((variant) => variant.variantId).sort()).toEqual(
      variants.map((variant) => variant.variantId).sort(),
    );
    expect(Math.max(...stages.map((stage) => stage.length))).toBeLessThanOrEqual(12);
    expect(() => partitionComparisonAnnualVariantStages(variants, 5)).toThrow(/상한 5개/);
    expect(source).toContain("const variants = shapeNames.flatMap");
    expect(source).toContain('comparisonAnnualVariantId(shapeName, "ideal-quasi")');
    expect(source).toContain('comparisonAnnualVariantId(shapeName, "ideal-transient")');
    expect(source).toContain('comparisonAnnualVariantId(shapeName, "engineering")');
    expect(source).toContain('electricalModel: "explicit-series-parallel-bypass"');
    expect(source).toContain("annualTransientThermal:");
    expect(source).toContain("obstacleBounds: undefined");
    expect(source).toContain("partitionComparisonAnnualVariantStages(variants)");
    expect(source).toContain("event.authoritativeEnergyPathByVariant");
    expect(source).toContain("event.annualTransientRotationByVariant ?? {}");
    expect(source).toContain("continuousSurface: createContinuousSurfaceWorkItem(annualSurface");
    expect(source).toContain("landAreaM2: landComparisonSurface.dimensions.footprintM2");
    expect(source).toContain("meshVersion: `comparison-surface-v2:");
    const continuousBranch = source.slice(
      source.indexOf('if (scope === "compare")'),
      source.indexOf('const variantId = scope === "current"'),
    );
    expect(continuousBranch).not.toContain("panelCount:");
    expect(continuousBranch).not.toContain("totalPanelAreaM2:");
    expect(continuousBranch).not.toContain("electricalFairnessMode:");
    expect(source).toContain("준정상 광학 회전·열이력 미포함");
    expect(source).toContain("<AnnualTransientDecompositionPanel");
    expect(source).toContain("공학적 전기 연결");
    expect(source).toContain("토지 생산성");
    expect(source).toContain("PV 면적당 생산성");
    expect(source).toContain("representative_day_values_excluded=true");
    expect(source).toContain("officialComparisonRankEligible");
    expect(source).toContain('"electrical_layout_id"');
    expect(source).toContain("annualElectricalLayoutIdByVariant[variantId]");
    expect(source).toContain("event.intervals.toLocaleString");
    expect(source).toContain("closing endpoint \uD3EC\uD568");
    expect(source).not.toContain("\uB300\uD45C \uC2E4\uC81C \uAE30\uC0C1\uC77C: \uBE44\uC815\uC0C1 \uC7AC\uB8CC\uC810 \uC5F4\uC774\uB825 \u00B7 \uC5F0\uAC04 Worker: \uC900\uC815\uC0C1 Faiman");
    expect(source).not.toContain("\uD45C\uBA74 \uAD6C\uC801\uC810 \uC0AC\uC774 \uC804\uB3C4\uB294 \uD604\uC7AC \uB2E8\uC5F4");
  });

  it("invalidates annual results when plane configuration changes", () => {
    const optimum = annualPlaneScenarioFingerprint({ mode: "annual-optimum", appliedTiltDeg: 28.6 });
    const custom = annualPlaneScenarioFingerprint({ mode: "custom", appliedTiltDeg: 28.6 });
    const customChanged = annualPlaneScenarioFingerprint({ mode: "custom", appliedTiltDeg: 30 });
    expect(custom).not.toBe(optimum);
    expect(customChanged).not.toBe(custom);
    expect(() => annualPlaneScenarioFingerprint({
      mode: "custom",
      appliedTiltDeg: Number.NaN,
    })).toThrow(/finite/);
  });

  it("uses one official-rank contract for transient and engineering results", () => {
    expect(resolveAnnualComparisonRankEligibility({
      transientReady: true,
      engineeringReady: true,
      naturalRotationEligible: true,
      officialHeight: true,
      geometryEligible: true,
      generalPreset: true,
    })).toEqual({ idealTransient: true, engineering: true });
    expect(resolveAnnualComparisonRankEligibility({
      transientReady: true,
      engineeringReady: true,
      naturalRotationEligible: true,
      officialHeight: false,
      geometryEligible: true,
      generalPreset: true,
    })).toEqual({ idealTransient: false, engineering: false });
    expect(resolveAnnualComparisonRankEligibility({
      transientReady: false,
      engineeringReady: true,
      naturalRotationEligible: true,
      officialHeight: true,
      geometryEligible: true,
      generalPreset: true,
    })).toEqual({ idealTransient: false, engineering: true });

    expect(resolveAnnualComparisonRankEligibility({
      transientReady: true,
      engineeringReady: true,
      naturalRotationEligible: true,
      officialHeight: true,
      generalPreset: true,
      geometryEligible: false,
    })).toEqual({ idealTransient: false, engineering: false });
  });

  it("uses static land geometry for natural no-CQ zero RPM and swept geometry only when rotation can occur", () => {
    expect(resolveComparisonFootprintMode({ mode: "static", selfStarting: "none" })).toBe("static");
    expect(resolveComparisonFootprintMode({ mode: "auto", selfStarting: "none" })).toBe("static");
    expect(resolveComparisonFootprintMode({ mode: "fixed", selfStarting: "none" })).toBe("swept");
    expect(resolveComparisonFootprintMode({ mode: "auto", selfStarting: "user-cq" })).toBe("swept");
    const comparisonSurfaceInputBlock = source.slice(
      source.indexOf("const comparisonSurfaceInput"),
      source.indexOf("const comparisonSurfaceByShape"),
    );
    expect(comparisonSurfaceInputBlock).toContain("comparisonRotation.selfStarting");
  });

  it("isolates electrical-connection delta on the shared quasi-steady path", () => {
    expect(electricalConnectionDeltaKWh({
      idealQuasiWh: 1200,
      engineeringQuasiWh: 900,
    })).toBeCloseTo(-0.3, 12);
    expect(() => electricalConnectionDeltaKWh({
      idealQuasiWh: Number.NaN,
      engineeringQuasiWh: 900,
    })).toThrow(/finite/);
  });

  it("distinguishes full-year intervals from the non-integrated closing endpoint", () => {
    expect(annualRunScopeLabelKo({
      steps: 8_761,
      intervals: 8_760,
      durationHours: 8_760,
      authoritativePath: "annual-transient-e11",
    })).toContain("8760\uAC1C \uC801\uBD84 \uAD6C\uAC04 \u00B7 closing endpoint \uD3EC\uD568 8761\uC810 \u00B7 \uACFC\uB3C4 \uC5F4 E11");
    expect(annualRunScopeLabelKo({
      steps: 8_785,
      intervals: 8_784,
      durationHours: 8_784,
      authoritativePath: "worker-quasi-steady",
    })).toContain("8784\uAC1C \uC801\uBD84 \uAD6C\uAC04 \u00B7 closing endpoint \uD3EC\uD568 8785\uC810 \u00B7 \uC900\uC815\uC0C1");
    expect(() => annualRunScopeLabelKo({
      steps: 8_760,
      intervals: 8_760,
      durationHours: 8_760,
      authoritativePath: "worker-quasi-steady",
    })).toThrow(/closing endpoint/);
    expect(() => annualRunScopeLabelKo({
      steps: 8_760,
      intervals: 8_759,
      durationHours: 8_760,
      authoritativePath: "worker-quasi-steady",
    })).toThrow(/one interval per integrated hour/);
  });

  it("requires one complete annual run cohort and removes stale targeted variants", () => {
    const complete = {
      runId: "run-a",
      steps: 8_761,
      intervals: 8_760,
      durationHours: 8_760,
      elapsedMs: 10,
    };
    expect(annualRunCohortReady({
      variantIds: ["quasi", "engineering", "transient"],
      metadataByVariant: {
        quasi: complete,
        engineering: { ...complete, elapsedMs: 20 },
        transient: { ...complete, elapsedMs: 30 },
      },
      expectedSteps: 8_761,
      expectedIntervals: 8_760,
      expectedDurationHours: 8_760,
    })).toBe(true);
    expect(annualRunCohortReady({
      variantIds: ["quasi", "transient"],
      metadataByVariant: {
        quasi: complete,
        transient: { ...complete, runId: "old-run" },
      },
      expectedSteps: 8_761,
      expectedIntervals: 8_760,
      expectedDurationHours: 8_760,
    })).toBe(false);
    expect(annualRunCohortReady({
      variantIds: ["quasi", "transient"],
      metadataByVariant: { quasi: complete },
      expectedSteps: 8_761,
      expectedIntervals: 8_760,
      expectedDurationHours: 8_760,
    })).toBe(false);
    expect(annualRunCohortReady({
      variantIds: ["quasi"],
      metadataByVariant: { quasi: { ...complete, steps: 8_760 } },
      expectedSteps: 8_760,
      expectedIntervals: 8_760,
      expectedDurationHours: 8_760,
    })).toBe(false);
    expect(omitAnnualVariantRecords({ quasi: 1, transient: 2, unrelated: 3 }, ["quasi", "transient"]))
      .toEqual({ unrelated: 3 });
  });

  it("requires production layout provenance and authoritative closed E11 before official ranking", () => {
    const layoutId = "surface-spatial-u-v-row-major-v1|zones=0:plane-skin|activeAreaM2=0.05|nominalCellAreaM2=0.0025|cells=20|parallel=2|bypass=10";
    expect(engineeringAnnualResultReady({ energyWh: 0, layoutId })).toBe(true);
    expect(engineeringAnnualResultReady({ energyWh: 900, layoutId: "legacy-layout" })).toBe(false);
    expect(engineeringAnnualResultReady({ energyWh: undefined, layoutId })).toBe(false);

    const closed = { annual: { e11Wh: 1_200, closureResidualWh: 1e-12 } };
    expect(annualTransientResultReady({
      energyWh: 1_200,
      authoritativePath: "annual-transient-e11",
      decomposition: closed,
    })).toBe(true);
    expect(annualTransientResultReady({
      energyWh: 1_200,
      authoritativePath: "worker-quasi-steady",
      decomposition: closed,
    })).toBe(false);
    expect(annualTransientResultReady({
      energyWh: 1_201,
      authoritativePath: "annual-transient-e11",
      decomposition: closed,
    })).toBe(false);
    expect(annualTransientResultReady({
      energyWh: 1_200,
      authoritativePath: "annual-transient-e11",
      decomposition: { annual: { e11Wh: 1_200, closureResidualWh: 0.1 } },
    })).toBe(false);
  });
  it("normalizes the same annual AC result by both actual land and active PV area", () => {
    expect(source).toContain(
      "normalizedAnnualEnergy(annualEnergy, actualLandAreaM2, activeAreaM2)",
    );
    expect(source).toContain('unit="kWh/m²-land/year"');
    expect(source).toContain('unit="kWh/m²-PV/year"');
    expect(source).toContain('unit="kWh/year"');
    expect(source).toContain("<LabelList dataKey={dataKey}");
    expect(source).toContain('<XAxis dataKey="name" interval={0} angle={-28}');
    expect(source).toContain("bestCompareEnergy) * 100 : 0).toFixed(4)");
  });

  it("keeps legacy panel language and mixed-unit charts out of the default comparison screen", () => {
    const compareScreen = source.slice(
      source.indexOf('{screen === "compare"'),
      source.indexOf('{screen === "evidence"'),
    );
    expect(compareScreen).toContain("단일 연속 PV 스킨");
    expect(compareScreen).toContain("토지 투영면적 A_land");
    expect(compareScreen).toContain("면적지수");
    expect(compareScreen).toContain("순간 태양 투영면적 A_sun(t)");
    expect(compareScreen).toContain("위에서 보기");
    expect(compareScreen).toContain("표면 법선");
    expect(compareScreen).toContain("적분 샘플");
    expect(compareScreen).not.toContain("N_eq");
    expect(compareScreen).not.toContain("20구역");
    expect(compareScreen).not.toContain("동일 PV 활성면적");
    expect(compareScreen).not.toContain("Mode A");
    expect(compareScreen).not.toContain("Mode B");
  });

  it("reapplies direct research-to-research changes from the saved general inputs", () => {
    expect(source).toMatch(
      /applyResearchComparisonInputs\(\s*normalizedNext\.researchPresetId,\s*generalComparisonSettings\.current,\s*\)/,
    );
    expect(source).toContain(
      'applied = { ...generalComparisonSettings.current, researchPresetId: "general" }',
    );
  });

  it("invalidates annual worker results when any manual weather input changes", () => {
    const annualKey = source.slice(
      source.indexOf("const annualScenarioKey = useMemo"),
      source.indexOf("useEffect(() => {", source.indexOf("const annualScenarioKey = useMemo")),
    );
    expect(annualKey).toContain(
      "weather: { dataMode, automaticWeatherSeries, seed, weatherPreset, manual: weather }",
    );
    expect(annualKey).toMatch(/weather,\s*environment,/);
  });

  it("commits numeric comparison drafts atomically and preserves the last feasible model", () => {
    const controls = readFileSync(
      fileURLToPath(new URL("../src/ui/LandComparisonControls.tsx", import.meta.url)),
      "utf8",
    );
    expect(controls).toContain('const [draft, setDraft] = useState(String(value))');
    expect(controls).toContain('draft.trim() === ""');
    expect(controls).toContain('onBlur={commit}');
    expect(controls).toContain('role="alert"');
    expect(source).toContain("validationShapes.forEach((shapeName) => createComparisonSurface(");
    expect(source).toContain("비교 입력 거부:");
    expect(source).toContain('disabled={comparisonSettings.researchPresetId !== "general"}');
    expect(controls).toContain("onChange: (next: LandComparisonSettings) => boolean");
    expect(controls).toContain('key={`land:${value.landAreaM2}`}');
  });

  it("keeps legacy plane-editor tilt inside the shared comparison contract", () => {
    expect(source).toContain(
      "const boundedTilt = clamp(tilt, 0, MAX_COMPARISON_PLANE_TILT_DEG)",
    );
    expect(source).toContain("setTiltDeg(boundedTilt)");
    expect(source).toContain('generatePreset("plane", boundedTilt, azimuth)');
  });

  it("uses interval quadrature for both fixed and frozen-auto rotation", () => {
    expect(source).toContain(
      'const phaseVariant: SimulationVariantWorkItem | null = targetRotation.mode !== "static"',
    );
    expect(source).toContain('rotationPhaseSamples: rotation.mode !== "static"');
    expect(source).toContain("rpm: targetRotation.rpm");
    expect(source).toContain("const rotationRpmAtRun = rotation.mode === \"auto\"");
    expect(source).toContain("setAnnualRotationRpmByVariant");
    expect(source).toContain("형상별 구간 토크 동역학 · 시간가중 평균");
  });

  it("renders the requested diagnosis, rotation, summer, methodology, and rank-explanation UI", () => {
    expect(source).toContain("<PreliminaryDiagnosisPanel");
    expect(source).toContain("<ComparisonRotationPanel");
    expect(source).toContain("<SummerAnalysisPanel");
    expect(source).toContain("<RankExplanationPanel");
    expect(source).toContain("<SimulationMethodology");
    const panels = readFileSync(
      fileURLToPath(new URL("../src/ui/ComparisonAnalysisPanels.tsx", import.meta.url)),
      "utf8",
    );
    expect(panels).toContain("선행 진단 · 순위보다 먼저 확인");
    expect(panels).toContain("형상별 자연 RPM");
    expect(panels).toContain("서울 여름철 · 정지와 회전 비교");
    expect(panels).toContain("왜 이 형상이 이 순위인가?");
    expect(panels).toContain("시뮬레이션 작동 원리 · 8단계");
    expect(panels).toContain('aria-expanded={open}');
    expect(panels).toContain('aria-pressed={mode === "simple"}');
  });

  it("wires fixed-RPM motor duty into annual net AC and exposes monthly audit results", () => {
    expect(source).toContain("motorTorqueNm: 0");
    expect(source).toContain("motorEfficiency: 0.8");
    expect(source).toContain('comparisonRotation.mode === "fixed" && comparisonRotation.motorTorqueNm > 0 && !trackedAnnualPlane');
    expect(source).toContain("motorDrive: {");
    expect(source).toContain("requiredTorqueNm: comparisonRotation.motorTorqueNm");
    expect(source).toContain("event.motorEnergyWhByVariant?.[variantId] ?? 0");
    expect(source).toContain("item.motorEnergyWhByVariant?.[variantId] ?? 0");
    expect(source).toContain("motorResult={comparisonMotorResult}");
    const panels = readFileSync(
      fileURLToPath(new URL("../src/ui/ComparisonAnalysisPanels.tsx", import.meta.url)),
      "utf8",
    );
    expect(panels).toContain('label="외부 모터 토크" unit="N·m"');
    expect(panels).toContain('label="모터 효율" unit="0–1"');
    expect(panels).toContain("P_motor = τ · |ω| / η_motor");
    expect(panels).toContain("연간 Worker가 각 시간점에서 모터 전력을 인버터 AC에서 실제 차감했습니다.");
    expect(panels).toContain("대표일 추정 경로는 모터 소비전력 차감을 지원하지 않습니다.");
  });

  it("wires shape-specific interval dynamics into the annual worker and audit UI", () => {
    const panels = readFileSync(
      fileURLToPath(new URL("../src/ui/ComparisonAnalysisPanels.tsx", import.meta.url)),
      "utf8",
    );
    expect(source).toContain("deriveAnalyticShapeRotationParameters({");
    expect(source).toContain("integrateNaturalRotationHistory({");
    expect(source).toContain("rotationRpmByWeatherStep: naturalHistory!.rpmByWeatherStep");
    expect(source).toContain("audit={comparisonRotationAuditWithMonthly}");
    expect(source).toContain("comparisonNaturalRotationByShape[shapeName]?.history");
    expect(source).not.toContain("solveMonthlyEnvironmentalAverageRpm({");
    expect(source).not.toContain('shape: "cylinder",\n      referenceHeightM');
    expect(panels).toContain("형상별 자연환경 RPM 입력·결과");
    expect(panels).toContain("월평균 풍속을 토크식에 한 번 넣지 않습니다.");
    expect(panels).toContain("풍력 전기는 포함하지 않습니다.");
  });

  it("makes the official comparison contract explicit and isolates optional obstacles", () => {
    expect(source).toContain("officialMaximumHeightM(DEFAULT_COMPARISON_LAND_AREA_M2)");
    expect(source).toContain("const [officialComparisonHeight, setOfficialComparisonHeight] = useState(true)");
    expect(source).toContain("const [comparisonObstaclesIncluded, setComparisonObstaclesIncluded] = useState(false)");
    expect(source).toContain("() => comparisonObstaclesIncluded ? obstacles : []");
    expect(source).toContain("selectSeoulSeasonalPeriods(seasonalWeatherSeries.points");
    expect(source).toContain("planeTiltDeg: appliedComparisonPlaneTiltDeg");
    const controls = readFileSync(
      fileURLToPath(new URL("../src/ui/LandComparisonControls.tsx", import.meta.url)),
      "utf8",
    );
    expect(controls).toContain("서울 연간 최적 고정 경사");
    expect(controls).toContain("공식 H_max = 2√(A_land/π) 잠금");
    expect(controls).toContain("D · 구/반구 비교");
  });
});
