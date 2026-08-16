import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import {
  commonMaximumHeightM,
  createComparisonSurface,
  surfaceSamples,
  type ComparisonShapeKind,
  type SurfaceSample,
} from "../src/lib/geometry/index";
import { calculatePOA } from "../src/lib/physics/irradiance";
import { DEFAULT_ELECTRICAL } from "../src/lib/physics/electrical";
import { calculateInverter, DEFAULT_INVERTER } from "../src/lib/physics/inverter";
import {
  createEngineeringSurfaceCellLayout,
  ENGINEERING_OFFICIAL_MINIMUM_RESOLUTION,
  ENGINEERING_SURFACE_SPATIAL_LAYOUT_VERSION,
  OFFICIAL_ENGINEERING_SURFACE_CONNECTION,
  solveEngineeringSurfaceElectrical,
  type EngineeringSurfaceCellLayout,
  type EngineeringSurfaceElectricalSample,
} from "../src/lib/physics/engineering-surface-electrical";
import { invalidEngineeringMeshValidationGate } from "../src/lib/physics/engineering-mesh-validation-gate";
import { computeSourceClosure } from "./source-closure";

const jsonPath = process.argv[3] ?? "docs/engineering-mesh-convergence-audit-2026.json";
const markdownPath = process.argv[4] ?? "docs/engineering-mesh-convergence-audit-2026.md";
const gatePath = process.argv[5] ?? "src/lib/physics/engineering-mesh-validation.generated.json";
const schemaVersion = 2;
const toleranceFraction = 0.02;
const requiredConsecutivePairs = 2;
const landAreaM2 = 0.05;
const maximumHeightM = commonMaximumHeightM(landAreaM2);
const shapes: readonly ComparisonShapeKind[] = [
  "plane", "cube", "sphere", "hemisphere", "cylinder", "cone",
];
const geometryContractDefinitions = [
  {
    contractId: "static-land-matched",
    footprintMode: "static",
    rotationModel: "stationary-rpm0",
    phaseGateRequired: false,
    opticalPhaseSamples: 1,
  },
  {
    contractId: "swept-rotation-envelope",
    footprintMode: "swept",
    rotationModel: "controlled-y-axis-phase-quadrature",
    phaseGateRequired: true,
    // Bound to the production minimum so the optical-mesh table is measured at
    // the resolution official runs use, not a separately drifting literal.
    opticalPhaseSamples: ENGINEERING_OFFICIAL_MINIMUM_RESOLUTION.phaseSamples,
  },
] as const;
const levels = [
  { id: "L0-coarse", azimuthSamples: 16, meridionalSegments: 8, circuitSamples: 256 },
  { id: "L1-validated-minimum", azimuthSamples: 32, meridionalSegments: 16, circuitSamples: 256 },
  { id: "L2-reference", azimuthSamples: 64, meridionalSegments: 32, circuitSamples: 256 },
] as const;
/**
 * Brackets the official minimum with one coarser and one finer level, matching
 * the azimuth and circuit ladders.
 *
 * The superseded ladder was [4, 8, 16] around a minimum of 8. Four midpoint
 * samples sit exactly one quarter-turn apart, which is the cube's own symmetry
 * period, so every sample saw an identical orientation and that level could
 * never converge for any tolerance. Dropping to [8, 16, 32] around a minimum of
 * 16 removes only the degenerate level: 8 is genuinely coarse rather than
 * aliased, so it still demonstrates that refinement matters.
 */
const phaseConvergenceLevels = [8, 16, 32] as const;
const circuitConvergenceLevels = [128, 256, 512] as const;
/**
 * Derived, not hand-listed. Convergence AC values run through `calculatePOA`
 * and `calculateInverter`, so a literal list naming only the cell/layout
 * modules would certify this table against optical and inverter sources it had
 * never hashed.
 */
const sourceFiles = computeSourceClosure({
  entryPoints: ["scripts/audit-engineering-mesh-convergence.ts"],
  rootDir: process.cwd(),
  label: "engineeringMesh.implementation",
});
const solarStates = [
  { id: "winter-morning", elevationDeg: 18, azimuthDeg: -65, dniWm2: 520, dhiWm2: 95, ambientC: 2, durationHours: 1.5 },
  { id: "winter-noon", elevationDeg: 31, azimuthDeg: 0, dniWm2: 720, dhiWm2: 110, ambientC: 7, durationHours: 2 },
  { id: "spring-morning", elevationDeg: 37, azimuthDeg: -45, dniWm2: 690, dhiWm2: 145, ambientC: 15, durationHours: 1.5 },
  { id: "summer-noon", elevationDeg: 68, azimuthDeg: 5, dniWm2: 790, dhiWm2: 180, ambientC: 29, durationHours: 2 },
  { id: "summer-afternoon", elevationDeg: 42, azimuthDeg: 58, dniWm2: 640, dhiWm2: 165, ambientC: 31, durationHours: 1.5 },
  { id: "autumn-afternoon", elevationDeg: 25, azimuthDeg: 72, dniWm2: 560, dhiWm2: 120, ambientC: 18, durationHours: 1.5 },
] as const;
const inverter = Object.freeze({ ...DEFAULT_INVERTER, ratedAcPowerW: 100 });

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("Audit configuration is not JSON serializable.");
  return serialized;
}

function sunVector(elevationDeg: number, azimuthDeg: number) {
  const elevation = elevationDeg * Math.PI / 180;
  const azimuth = azimuthDeg * Math.PI / 180;
  const horizontal = Math.cos(elevation);
  return {
    x: horizontal * Math.sin(azimuth),
    y: Math.sin(elevation),
    z: horizontal * Math.cos(azimuth),
  };
}
function atomicWriteFile(path: string, contents: string): void {
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, contents, "utf8");
  renameSync(temporaryPath, path);
}


function rotateY(vector: readonly [number, number, number], angleRad: number) {
  const cosine = Math.cos(angleRad);
  const sine = Math.sin(angleRad);
  return {
    x: cosine * vector[0] + sine * vector[2],
    y: vector[1],
    z: -sine * vector[0] + cosine * vector[2],
  };
}

function surfaceFor(
  shape: ComparisonShapeKind,
  azimuthSamples: number,
  meridionalSegments: number,
  footprintMode: "static" | "swept",
) {
  return createComparisonSurface(shape, {
    basis: "land",
    landAreaM2,
    maxHeightM: maximumHeightM,
    cylinderHeightM: maximumHeightM,
    coneHeightM: maximumHeightM,
    planeTiltDeg: 30,
    groundClearanceM: 0,
    maximumActiveAreaM2: 1,
    maximumAspectRatio: 4,
    footprintMode,
    azimuthSamples,
    meridionalSegments,
  });
}

function layoutSamples(shape: ComparisonShapeKind, samples: readonly SurfaceSample[]) {
  return samples.map((sample, index) => ({
    id: `${shape}:material:${index}`,
    areaM2: sample.areaM2,
    zoneId: sample.zoneId,
    zoneIndex: sample.zoneIndex,
    u: sample.u,
    v: sample.v,
    positionM: { x: sample.position[0], y: sample.position[1], z: sample.position[2] },
  }));
}

function electricalSamples(
  shape: ComparisonShapeKind,
  samples: readonly SurfaceSample[],
  phaseRad: number,
  state: typeof solarStates[number],
): EngineeringSurfaceElectricalSample[] {
  const sun = sunVector(state.elevationDeg, state.azimuthDeg);
  const ghiWm2 = state.dniWm2 * sun.y + state.dhiWm2;
  return samples.map((sample, index) => {
    const normal = rotateY(sample.normal, phaseRad);
    const positionM = rotateY(sample.position, phaseRad);
    const poaWm2 = calculatePOA({
      ghiWm2,
      dniWm2: state.dniWm2,
      dhiWm2: state.dhiWm2,
      solarZenithDeg: 90 - state.elevationDeg,
      sunDirection: sun,
      panelNormal: normal,
      albedo: 0.2,
      iam: { model: "ashrae", b0: 0.05 },
      diffuseModel: "hay-davies",
    }).totalWm2 * 0.98;
    return {
      id: `${shape}:material:${index}`,
      areaM2: sample.areaM2,
      zoneId: sample.zoneId,
      zoneIndex: sample.zoneIndex,
      u: sample.u,
      v: sample.v,
      positionM,
      poaWm2,
      cellTemperatureC: state.ambientC + 0.03 * poaWm2,
    };
  });
}

function projectionAreas(layout: EngineeringSurfaceCellLayout): number[] {
  const areas = Array(layout.cells.length).fill(0) as number[];
  Object.values(layout.sampleProjectionBySpatialKey).forEach((projection) => {
    projection.overlaps.forEach((overlap) => { areas[overlap.cellIndex] += overlap.areaM2; });
  });
  return areas;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function relativeDifference(left: number, right: number): number {
  return Math.abs(left - right) / Math.max(1e-12, Math.abs(right));
}

function topologyFingerprint(layout: EngineeringSurfaceCellLayout): string {
  return sha256(JSON.stringify(layout.cells.map((cell) => ({
    id: cell.id,
    areaM2: cell.areaM2,
    zoneId: cell.zoneId,
    zoneIndex: cell.zoneIndex,
    uMin: cell.uMin,
    uMax: cell.uMax,
    vMin: cell.vMin,
    vMax: cell.vMax,
    stringId: cell.stringId,
    substringId: cell.substringId,
  }))));
}

function runFixedMeshEnergy(
  shape: ComparisonShapeKind,
  samples: readonly SurfaceSample[],
  layout: EngineeringSurfaceCellLayout,
  phaseSamples: number,
  circuitSamples: number,
  rotatePhases: boolean,
) {
  const startedAt = performance.now();
  const config = { ...OFFICIAL_ENGINEERING_SURFACE_CONNECTION, circuitSamples };
  let dcWh = 0;
  let acWh = 0;
  let idealLocalMppDcWh = 0;
  let bypassActivationWeightedHours = 0;
  let maximumExtractionClosureErrorW = 0;
  let topologyInvariant = true;
  let solveCount = 0;
  for (const state of solarStates) {
    for (let phaseIndex = 0; phaseIndex < phaseSamples; phaseIndex += 1) {
      const phaseRad = rotatePhases
        ? 2 * Math.PI * (phaseIndex + 0.5) / phaseSamples : 0;
      const result = solveEngineeringSurfaceElectrical(
        electricalSamples(shape, samples, phaseRad, state),
        DEFAULT_ELECTRICAL,
        config,
        layout,
      );
      topologyInvariant = topologyInvariant
        && result.layoutId === layout.layoutId
        && result.cells.length === layout.cells.length
        && result.cells.every((cell, index) => cell.id === layout.cells[index].id
          && cell.stringId === layout.cells[index].stringId
          && cell.substringId === layout.cells[index].substringId);
      const phaseWeightHours = state.durationHours / phaseSamples;
      const inverterResult = calculateInverter({
        dcPowerW: result.dcPowerW,
        dcVoltageV: result.dcVoltageV,
        dcCurrentA: result.dcCurrentA,
        config: inverter,
      });
      const extractionW = Object.values(result.electricalExtractionWBySampleId)
        .reduce((sum, powerW) => sum + powerW, 0);
      maximumExtractionClosureErrorW = Math.max(
        maximumExtractionClosureErrorW, Math.abs(extractionW - result.dcPowerW),
      );
      dcWh += result.dcPowerW * phaseWeightHours;
      acWh += inverterResult.acPowerW * phaseWeightHours;
      idealLocalMppDcWh += result.idealLocalMppDcPowerW * phaseWeightHours;
      bypassActivationWeightedHours += result.bypassActiveCount * phaseWeightHours;
      solveCount += 1;
    }
  }
  return {
    dcWh,
    acWh,
    idealLocalMppDcWh,
    bypassActivationWeightedHours,
    maximumExtractionClosureErrorW,
    topologyInvariant,
    solveCount,
    repeatedSolveMs: performance.now() - startedAt,
  };
}
atomicWriteFile(gatePath, `${JSON.stringify(invalidEngineeringMeshValidationGate({
  generatedAt: new Date().toISOString(),
  artifactSchemaVersion: schemaVersion,
  artifactPath: jsonPath.replaceAll("\\", "/"),
  shapes,
}), null, 2)}\n`);


const auditStartedAt = performance.now();
const geometryContractReports = geometryContractDefinitions.map((geometryContract) => {
  const shapeReports = shapes.map((shape) => {
  const levelReports = levels.map((level) => {
    const levelStartedAt = performance.now();
    const surface = surfaceFor(
      shape, level.azimuthSamples, level.meridionalSegments, geometryContract.footprintMode,
    );
    const samples = surfaceSamples(surface);
    const layoutStartedAt = performance.now();
    const layout = createEngineeringSurfaceCellLayout(
      layoutSamples(shape, samples),
      { ...OFFICIAL_ENGINEERING_SURFACE_CONNECTION, circuitSamples: level.circuitSamples },
      OFFICIAL_ENGINEERING_SURFACE_CONNECTION.nominalCellAreaM2,
    );
    const layoutBuildMs = performance.now() - layoutStartedAt;
    let dcWh = 0;
    let acWh = 0;
    let idealLocalMppDcWh = 0;
    let bypassActivationWeightedHours = 0;
    let maximumExtractionClosureErrorW = 0;
    let solveCount = 0;
    const solveStartedAt = performance.now();
    for (const state of solarStates) {
      for (let phaseIndex = 0; phaseIndex < geometryContract.opticalPhaseSamples; phaseIndex += 1) {
        const phaseRad = geometryContract.phaseGateRequired
          ? 2 * Math.PI * (phaseIndex + 0.5) / geometryContract.opticalPhaseSamples : 0;
        const result = solveEngineeringSurfaceElectrical(
          electricalSamples(shape, samples, phaseRad, state),
          DEFAULT_ELECTRICAL,
          { ...OFFICIAL_ENGINEERING_SURFACE_CONNECTION, circuitSamples: level.circuitSamples },
          layout,
        );
        const phaseWeightHours = state.durationHours / geometryContract.opticalPhaseSamples;
        const inverterResult = calculateInverter({
          dcPowerW: result.dcPowerW,
          dcVoltageV: result.dcVoltageV,
          dcCurrentA: result.dcCurrentA,
          config: inverter,
        });
        const extractionW = Object.values(result.electricalExtractionWBySampleId)
          .reduce((sum, powerW) => sum + powerW, 0);
        maximumExtractionClosureErrorW = Math.max(
          maximumExtractionClosureErrorW, Math.abs(extractionW - result.dcPowerW),
        );
        dcWh += result.dcPowerW * phaseWeightHours;
        acWh += inverterResult.acPowerW * phaseWeightHours;
        idealLocalMppDcWh += result.idealLocalMppDcPowerW * phaseWeightHours;
        bypassActivationWeightedHours += result.bypassActiveCount * phaseWeightHours;
        solveCount += 1;
      }
    }
    const repeatedSolveMs = performance.now() - solveStartedAt;
    const projectedAreas = projectionAreas(layout);
    const clippedAreaM2 = projectedAreas.reduce((sum, areaM2) => sum + areaM2, 0);
    const cellAreaClosureErrorM2 = Math.max(...projectedAreas.map(
      (areaM2, index) => Math.abs(areaM2 - layout.cells[index].areaM2),
    ));
    return {
      levelId: level.id,
      resolution: {
        azimuthSamples: level.azimuthSamples,
        meridionalSegments: level.meridionalSegments,
        phaseSamples: geometryContract.opticalPhaseSamples,
        circuitSamples: level.circuitSamples,
      },
      sampleCount: samples.length,
      activeAreaM2: layout.activeAreaM2,
      clippedAreaM2,
      areaClosureErrorM2: clippedAreaM2 - layout.activeAreaM2,
      maximumCellAreaClosureErrorM2: cellAreaClosureErrorM2,
      cellCount: layout.cells.length,
      cellIds: layout.cells.map((cell) => cell.id),
      cellTopologyFingerprint: topologyFingerprint(layout),
      trimmedCellCount: layout.trimmedCellCount,
      trimmedCellAreaM2: layout.trimmedCellAreaM2,
      parallelStringCount: layout.parallelStringCount,
      stringIds: unique(layout.cells.map((cell) => cell.stringId)),
      seriesCellCountByString: layout.seriesCellCountByString,
      bypassSubstringCount: layout.bypassSubstringCount,
      bypassSubstringIds: unique(layout.cells.map((cell) => cell.substringId)),
      layoutId: layout.layoutId,
      projectionFingerprint: layout.sampleProjectionFingerprint,
      projectionCount: layout.sampleProjectionCount,
      dcWh,
      acWh,
      idealLocalMppDcWh,
      bypassActivationWeightedHours,
      maximumExtractionClosureErrorW,
      solveCount,
      layoutBuildMs,
      repeatedSolveMs,
      elapsedMs: performance.now() - levelStartedAt,
    };
  });
  const consecutiveDeltas = levelReports.slice(1).map((fine, index) => {
    const coarse = levelReports[index];
    const delta = relativeDifference(coarse.acWh, fine.acWh);
    return {
      coarseLevelId: coarse.levelId,
      fineLevelId: fine.levelId,
      relativeDifference: delta,
      toleranceFraction,
      pass: delta <= toleranceFraction,
    };
  });
  const finestLevel = levels[levels.length - 1];
  const fixedSurface = surfaceFor(
    shape, finestLevel.azimuthSamples, finestLevel.meridionalSegments,
    geometryContract.footprintMode,
  );
  const fixedSamples = surfaceSamples(fixedSurface);
  const fixedLayout = createEngineeringSurfaceCellLayout(
    layoutSamples(shape, fixedSamples),
    { ...OFFICIAL_ENGINEERING_SURFACE_CONNECTION, circuitSamples: finestLevel.circuitSamples },
    OFFICIAL_ENGINEERING_SURFACE_CONNECTION.nominalCellAreaM2,
  );
  const fixedCellIds = fixedLayout.cells.map((cell) => cell.id);
  const fixedStringIds = unique(fixedLayout.cells.map((cell) => cell.stringId));
  const fixedBypassSubstringIds = unique(fixedLayout.cells.map((cell) => cell.substringId));
  const fixedTopologyFingerprint = topologyFingerprint(fixedLayout);
  const phaseLevelReports = geometryContract.phaseGateRequired ? phaseConvergenceLevels.map((phaseSamples, index) => ({
    levelId: `P${index}-${phaseSamples}-phases`,
    phaseSamples,
    circuitSamples: ENGINEERING_OFFICIAL_MINIMUM_RESOLUTION.circuitSamples,
    layoutId: fixedLayout.layoutId,
    cellIds: fixedCellIds,
    stringIds: fixedStringIds,
    bypassSubstringIds: fixedBypassSubstringIds,
    cellTopologyFingerprint: fixedTopologyFingerprint,
    ...runFixedMeshEnergy(
      shape, fixedSamples, fixedLayout, phaseSamples,
      ENGINEERING_OFFICIAL_MINIMUM_RESOLUTION.circuitSamples, true,
    ),
  })) : [];
  const phaseDeltas = phaseLevelReports.slice(1).map((fine, index) => {
    const coarse = phaseLevelReports[index];
    const delta = relativeDifference(coarse.acWh, fine.acWh);
    return {
      coarseLevelId: coarse.levelId,
      fineLevelId: fine.levelId,
      coarsePhaseSamples: coarse.phaseSamples,
      finePhaseSamples: fine.phaseSamples,
      relativeDifference: delta,
      toleranceFraction,
      pass: delta <= toleranceFraction,
    };
  });
  const phaseTopologyInvariant = !geometryContract.phaseGateRequired
    || phaseLevelReports.every((level) => level.topologyInvariant
      && level.layoutId === fixedLayout.layoutId
      && level.cellTopologyFingerprint === fixedTopologyFingerprint
      && JSON.stringify(level.cellIds) === JSON.stringify(fixedCellIds));
  const phasePass = !geometryContract.phaseGateRequired
    || (phaseTopologyInvariant
      && phaseDeltas.length === requiredConsecutivePairs
      && phaseDeltas.every((delta) => delta.pass));
  const circuitLevelReports = circuitConvergenceLevels.map((circuitSamples, index) => ({
    levelId: `C${index}-${circuitSamples}-samples`,
    phaseSamples: geometryContract.opticalPhaseSamples,
    circuitSamples,
    layoutId: fixedLayout.layoutId,
    cellIds: fixedCellIds,
    stringIds: fixedStringIds,
    bypassSubstringIds: fixedBypassSubstringIds,
    cellTopologyFingerprint: fixedTopologyFingerprint,
    ...runFixedMeshEnergy(
      shape, fixedSamples, fixedLayout,
      geometryContract.opticalPhaseSamples, circuitSamples,
      geometryContract.phaseGateRequired,
    ),
  }));
  const circuitDeltas = circuitLevelReports.slice(1).map((fine, index) => {
    const coarse = circuitLevelReports[index];
    const delta = relativeDifference(coarse.acWh, fine.acWh);
    return {
      coarseLevelId: coarse.levelId,
      fineLevelId: fine.levelId,
      coarseCircuitSamples: coarse.circuitSamples,
      fineCircuitSamples: fine.circuitSamples,
      relativeDifference: delta,
      toleranceFraction,
      pass: delta <= toleranceFraction,
    };
  });
  const circuitTopologyInvariant = circuitLevelReports.every((level) =>
    level.topologyInvariant
    && level.layoutId === fixedLayout.layoutId
    && level.cellTopologyFingerprint === fixedTopologyFingerprint
    && JSON.stringify(level.cellIds) === JSON.stringify(fixedCellIds));
  const circuitPass = circuitTopologyInvariant
    && circuitDeltas.length === requiredConsecutivePairs
    && circuitDeltas.every((delta) => delta.pass);
  const topologyInvariant = levelReports.every((level) =>
    level.layoutId === levelReports[0].layoutId
    && level.cellTopologyFingerprint === levelReports[0].cellTopologyFingerprint
    && JSON.stringify(level.seriesCellCountByString)
      === JSON.stringify(levelReports[0].seriesCellCountByString));
  const cellAreaInvariant = levelReports.every((level) =>
    Math.abs(level.activeAreaM2 - levelReports[0].activeAreaM2) <= 1e-10
    && Math.abs(level.areaClosureErrorM2) <= 1e-10
    && level.maximumCellAreaClosureErrorM2 <= 1e-9);
  const opticalMeshPass = topologyInvariant && cellAreaInvariant
    && consecutiveDeltas.length === requiredConsecutivePairs
    && consecutiveDeltas.every((delta) => delta.pass);
  const pass = opticalMeshPass && phasePass && circuitPass;
  return {
    shape,
    pass,
    officialEligible: pass,
    activeAreaM2: levelReports[0].activeAreaM2,
    layoutId: levelReports[0].layoutId,
    topologyInvariant,
    cellAreaInvariant,
    opticalMeshPass,
    levels: levelReports,
    consecutiveDeltas,
    phaseConvergence: {
      required: geometryContract.phaseGateRequired,
      status: geometryContract.phaseGateRequired ? "evaluated" : "not-applicable-stationary-rpm0",
      pass: phasePass,
      topologyInvariant: phaseTopologyInvariant,
      fixedOpticalResolution: {
        azimuthSamples: finestLevel.azimuthSamples,
        meridionalSegments: finestLevel.meridionalSegments,
      },
      levels: phaseLevelReports,
      consecutiveDeltas: phaseDeltas,
    },
    circuitConvergence: {
      pass: circuitPass,
      topologyInvariant: circuitTopologyInvariant,
      fixedOpticalResolution: {
        azimuthSamples: finestLevel.azimuthSamples,
        meridionalSegments: finestLevel.meridionalSegments,
      },
      fixedPhaseSamples: geometryContract.opticalPhaseSamples,
      levels: circuitLevelReports,
      consecutiveDeltas: circuitDeltas,
    },
  };
});
  const pass = shapeReports.length === shapes.length && shapeReports.every((shape) => shape.pass);
  return {
    contractId: geometryContract.contractId,
    footprintMode: geometryContract.footprintMode,
    rotationModel: geometryContract.rotationModel,
    phaseGateRequired: geometryContract.phaseGateRequired,
    shapes: shapeReports,
    pass,
    officialEligible: pass,
  };
});

function performanceReuseCheck() {
  const shape = "cylinder" as const;
  const level = levels[0];
  const surface = surfaceFor(
    shape, level.azimuthSamples, level.meridionalSegments, "swept",
  );
  const samples = surfaceSamples(surface);
  const input = electricalSamples(shape, samples, Math.PI / 4, solarStates[2]);
  const config = { ...OFFICIAL_ENGINEERING_SURFACE_CONNECTION, circuitSamples: level.circuitSamples };
  const layout = createEngineeringSurfaceCellLayout(
    layoutSamples(shape, samples), config, DEFAULT_ELECTRICAL.areaM2,
  );
  solveEngineeringSurfaceElectrical(input, DEFAULT_ELECTRICAL, config, layout);
  solveEngineeringSurfaceElectrical(input, DEFAULT_ELECTRICAL, config);
  const repetitions = 3;
  const prebuiltStartedAt = performance.now();
  let prebuiltPowerW = 0;
  for (let index = 0; index < repetitions; index += 1) {
    prebuiltPowerW = solveEngineeringSurfaceElectrical(
      input, DEFAULT_ELECTRICAL, config, layout,
    ).dcPowerW;
  }
  const prebuiltElapsedMs = performance.now() - prebuiltStartedAt;
  const rebuildStartedAt = performance.now();
  let rebuildPowerW = 0;
  for (let index = 0; index < repetitions; index += 1) {
    rebuildPowerW = solveEngineeringSurfaceElectrical(input, DEFAULT_ELECTRICAL, config).dcPowerW;
  }
  const rebuildElapsedMs = performance.now() - rebuildStartedAt;
  return {
    shape,
    resolution: level,
    repetitions,
    prebuiltLayoutRepeatedSolveElapsedMs: prebuiltElapsedMs,
    rebuildLayoutEverySolveElapsedMs: rebuildElapsedMs,
    speedup: rebuildElapsedMs / Math.max(1e-12, prebuiltElapsedMs),
    relativeResultDifference: relativeDifference(prebuiltPowerW, rebuildPowerW),
    resultInvariant: relativeDifference(prebuiltPowerW, rebuildPowerW) <= 1e-12,
  };
}

const pass = geometryContractReports.length === geometryContractDefinitions.length
  && geometryContractReports.every((contract) => contract.pass);
const performanceReuse = performanceReuseCheck();
const implementationSha256 = sha256(sourceFiles.map((path) =>
  `${path}\n${readFileSync(path, "utf8")}`).join("\n---\n"));
const configuration = {
  fixtureVersion: 2,
  shapes,
  landAreaM2,
  maximumHeightM,
  geometryContracts: geometryContractDefinitions,
  albedo: 0.2,
  soilingLossFraction: 0.02,
  solarStates,
  levels,
  phaseConvergenceLevels,
  circuitConvergenceLevels,
  topology: OFFICIAL_ENGINEERING_SURFACE_CONNECTION,
  inverter,
  toleranceFraction,
  requiredConsecutivePairs,
} as const;
const configurationSha256 = sha256(canonicalJson(configuration));
const report = {
  schemaVersion,
  generatedAt: new Date().toISOString(),
  implementation: { sourceFiles, sha256: implementationSha256 },
  fixture: {
    name: "six deterministic clear-sky states under static-land and swept-rotation geometry contracts",
    purpose: "engineering optical-mesh/cell-mapping/circuit convergence; never annual-scaled",
    configuration,
    configurationSha256,
    implementationSha256,
    implementationSourceFiles: sourceFiles,
    weatherProvenance: "deterministic audit fixture, not measured weather and not Seoul TMY",
    landAreaM2,
    maximumHeightM,
    geometryContracts: geometryContractDefinitions,
    albedo: 0.2,
    soilingLossFraction: 0.02,
    thermalModel: "explicit deterministic cell temperature fixture T=ambient+0.03*POA; not annual transient",
    rotationModel: "per-contract stationary RPM=0 or controlled phase quadrature; wind energy excluded",
    solarStates,
  },
  topology: {
    layoutVersion: ENGINEERING_SURFACE_SPATIAL_LAYOUT_VERSION,
    ...OFFICIAL_ENGINEERING_SURFACE_CONNECTION,
  },
  convergence: {
    toleranceFraction,
    requiredConsecutivePairs,
    officialMinimumResolution: ENGINEERING_OFFICIAL_MINIMUM_RESOLUTION,
    opticalMeshLevels: levels,
    phaseLevels: phaseConvergenceLevels,
    circuitLevels: circuitConvergenceLevels,
  },
  performanceBaseline: {
    previousCommit: "d9ff14abc6c4bec6217ca38ef45f1f499377d83c",
    previousFixture: "four independent seasonal actual-weather 24 h cylinder runs",
    previousConfig: {
      selected: { azimuthSamples: 64, meridionalSegments: 16, phaseSamples: 4, circuitSamples: 128 },
      reference: { azimuthSamples: 128, meridionalSegments: 32, phaseSamples: 4, circuitSamples: 128 },
      nominalCellAreaM2: 0.01,
      parallelStrings: 2,
      cellsPerBypassSubstring: 5,
    },
    oldElapsedMs: 186_698.0292,
    currentFixtureComparable: false,
    comparisonReason: "The RC audit covers six shapes, three meshes, six deterministic states and the production 0.0025 m2 topology; elapsed times must not be presented as a speedup over the old cylinder-only seasonal Worker fixture.",
    currentTotalElapsedMs: performance.now() - auditStartedAt,
    repeatedSolve: performanceReuse,
    endToEndWorker: {
      previousElapsedMs: 186_698.0292,
      currentElapsedMs: null,
      comparable: false,
      status: "measured separately by the full-year Worker audit",
    },
  },
  rootCause: {
    observedOldCylinderRelativeDifference: 0.06527334,
    oldMapping: "lexicographic quadrature-point samples were poured into one-dimensional nominal-area buckets, so optical refinement moved physical cell support and could cross a surface-zone seam",
    fixedMapping: "immutable per-zone two-dimensional material-space cell rectangles with exact boundary clipping and a precomputed sparse optical-support projection; topology/layout IDs are independent of optical mesh and phase",
    gaussSupportFix: "each equal-weight GL2 node owns its own half segment (left:[lower,mid], right:[mid,upper]), preserving linear-u means instead of flattening both nodes over the full segment",
    arrayBusVoltageBug: "parallel circuit MPP reports terminal V after array I*R, while diagnostics formerly evaluated branches at that terminal V",
    fixedArrayBusVoltage: "device/string states are evaluated at V_bus=V_terminal+I_array*R_array and string currents close to array current",
    oldCellSizing: "the remainder of zone area / nominal cell area became one sliver cell; because a bypass substring wires its cells in series with no per-cell diode, that sliver's area-proportional photocurrent throttled the whole substring, and an odd cell count also left the two parallel strings with unequal series length. Under uniform illumination, where only resistive wiring should be lost, that cost 21.9% (static plane), 21.1% (swept cube), 14.2% (swept plane) and 11.0% (cone) while cube, sphere, hemisphere and cylinder — whose areas divide exactly at this land area — lost only 0.26-0.38%",
    fixedCellSizing: "each zone is tiled with uniform cells at or below the nominal area, with the count raised to a multiple of the parallel string count, so no cell throttles its series string and every string carries the same series length; the uniform-illumination spread across all six shapes falls from 20.8 to 0.38 percentage points",
    oldPhaseLadder: "rotation-phase convergence was demonstrated over 4/8/16 samples, but the cube repeats every quarter turn, so 4 midpoint samples land one full symmetry period apart and alias onto a single orientation. The large phase-independent sliver loss dominated the ratio and made those degenerate levels appear converged",
    fixedPhaseLadder: "the official minimum phase resolution is 16, bracketed by 8/16/32 like the azimuth and circuit ladders; only the aliased 4-sample level is dropped. The measured cube sequence is 3.059% (4->8), 1.100% (8->16), 0.092% (16->32) and 0.032% (32->64), so the answer has settled by 16",
  },
  geometryContracts: geometryContractReports,
  pass,
  officialRankingEligible: pass,
  elapsedMs: performance.now() - auditStartedAt,
};

const markdownShapeReports = geometryContractReports.flatMap((contract) =>
  contract.shapes.map((shape) => ({ contractId: contract.contractId, ...shape })));

const markdown = [
  "# Engineering electrical mesh convergence audit (2026)",
  "",
  `- Verdict: **${pass ? "PASS" : "FAIL"}**`,
  `- Official engineering ranking eligible: **${pass ? "yes" : "no"}**`,
  `- Predeclared tolerance: ${(toleranceFraction * 100).toFixed(2)}% for ${requiredConsecutivePairs} consecutive mesh pairs`,
  `- Fixed topology: ${OFFICIAL_ENGINEERING_SURFACE_CONNECTION.nominalCellAreaM2} m²/cell, ${OFFICIAL_ENGINEERING_SURFACE_CONNECTION.parallelStrings} parallel strings, ${OFFICIAL_ENGINEERING_SURFACE_CONNECTION.cellsPerBypassSubstring} cells/bypass substring`,
  `- Fixture: ${report.fixture.name}; ${report.fixture.purpose}.`,
  "",
  "| Contract | Shape | Level | Samples | A_PV (m²) | Cells | Strings | Bypass groups | AC (Wh) | Δ from prior | Pass | Layout build (ms) | Repeated solve (ms) |",
  "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|:---:|---:|---:|",
  ...markdownShapeReports.flatMap((shape) => shape.levels.map((level, index) => {
    const delta = index === 0 ? undefined : shape.consecutiveDeltas[index - 1];
    return `| ${shape.contractId} | ${shape.shape} | ${level.levelId} | ${level.sampleCount} | ${level.activeAreaM2.toFixed(9)} | ${level.cellCount} | ${level.parallelStringCount} | ${level.bypassSubstringCount} | ${level.acWh.toFixed(9)} | ${delta ? `${(delta.relativeDifference * 100).toFixed(6)}%` : "—"} | ${delta ? (delta.pass ? "PASS" : "FAIL") : "—"} | ${level.layoutBuildMs.toFixed(3)} | ${level.repeatedSolveMs.toFixed(3)} |`;
  })),
  "",
  "| Contract / shape | Topology invariant | Cell-area invariant | Pair deltas | Official eligible |",
  "|---|:---:|:---:|---|:---:|",
  ...markdownShapeReports.map((shape) => `| ${shape.contractId} / ${shape.shape} | ${shape.topologyInvariant ? "PASS" : "FAIL"} | ${shape.cellAreaInvariant ? "PASS" : "FAIL"} | ${shape.consecutiveDeltas.map((delta) => `${(delta.relativeDifference * 100).toFixed(6)}%`).join(", ")} | ${shape.officialEligible ? "yes" : "no"} |`),
  "",
  "## Independent rotation-phase convergence (finest optical mesh)",
  "",
  "| Shape | Phase levels | Consecutive AC deltas | Topology invariant | Pass |",
  "|---|---|---|:---:|:---:|",
  ...markdownShapeReports.map((shape) => `| ${shape.contractId} / ${shape.shape} | ${shape.phaseConvergence.required ? shape.phaseConvergence.levels.map((level) => level.phaseSamples).join(" / ") : shape.phaseConvergence.status} | ${shape.phaseConvergence.consecutiveDeltas.map((delta) => `${(delta.relativeDifference * 100).toFixed(6)}%`).join(", ") || "N/A"} | ${shape.phaseConvergence.topologyInvariant ? "PASS" : "FAIL"} | ${shape.phaseConvergence.pass ? "PASS" : "FAIL"} |`),
  "",
  "## Independent circuit-coordinate convergence (finest optical mesh, selected phase)",
  "",
  "| Shape | Circuit levels | Consecutive AC deltas | Topology invariant | Pass |",
  "|---|---|---|:---:|:---:|",
  ...markdownShapeReports.map((shape) => `| ${shape.contractId} / ${shape.shape} | ${shape.circuitConvergence.levels.map((level) => level.circuitSamples).join(" / ")} | ${shape.circuitConvergence.consecutiveDeltas.map((delta) => `${(delta.relativeDifference * 100).toFixed(6)}%`).join(", ")} | ${shape.circuitConvergence.topologyInvariant ? "PASS" : "FAIL"} | ${shape.circuitConvergence.pass ? "PASS" : "FAIL"} |`),
  "",
  "## Root cause and fix",
  "",
  `- Old mapping: ${report.rootCause.oldMapping}.`,
  `- Fixed mapping: ${report.rootCause.fixedMapping}.`,
  `- GL2 support: ${report.rootCause.gaussSupportFix}.`,
  `- Circuit diagnostic: ${report.rootCause.fixedArrayBusVoltage}.`,
  `- Old cell sizing: ${report.rootCause.oldCellSizing}.`,
  `- Fixed cell sizing: ${report.rootCause.fixedCellSizing}.`,
  `- Old phase ladder: ${report.rootCause.oldPhaseLadder}.`,
  `- Fixed phase ladder: ${report.rootCause.fixedPhaseLadder}.`,
  "",
  "## Performance provenance",
  "",
  `The old ${report.performanceBaseline.oldElapsedMs.toFixed(4)} ms result is **not comparable** to this audit because the fixture, shape count, and production cell topology changed.`,
  `For the same current cylinder input, ${performanceReuse.repetitions} repeated solves took ${performanceReuse.prebuiltLayoutRepeatedSolveElapsedMs.toFixed(3)} ms with a prebuilt layout versus ${performanceReuse.rebuildLayoutEverySolveElapsedMs.toFixed(3)} ms rebuilding it each time; result relative difference=${performanceReuse.relativeResultDifference}.`,
  "End-to-end full-year Worker runtime is reported by the separate full-year audit.",
  "",
  `Implementation SHA-256: \`${implementationSha256}\``,
  "",
].join("\n");

const reportJson = `${JSON.stringify(report, null, 2)}\n`;
const artifactSha256 = sha256(reportJson);
const validationGate = {
  schemaVersion: 1,
  status: pass ? "pass" : "running-or-failed",
  generatedAt: report.generatedAt,
  artifactSchemaVersion: schemaVersion,
  artifactPath: jsonPath.replaceAll("\\", "/"),
  artifactSha256,
  configurationSha256,
  implementationSha256,
  officialMinimumResolution: ENGINEERING_OFFICIAL_MINIMUM_RESOLUTION,
  layoutVersion: ENGINEERING_SURFACE_SPATIAL_LAYOUT_VERSION,
  contracts: geometryContractReports.map((contract) => ({
    contractId: contract.contractId,
    footprintMode: contract.footprintMode,
    phaseGateRequired: contract.phaseGateRequired,
    pass: contract.pass,
    shapes: contract.shapes.map((shape) => ({
      shape: shape.shape,
      pass: shape.pass,
    })),
  })),
  officialRankingEligible: pass,
};
const gateJson = `${JSON.stringify(validationGate, null, 2)}\n`;
const markdownOutput = `${markdown}\n`;
atomicWriteFile(jsonPath, reportJson);
atomicWriteFile(markdownPath, markdownOutput);
atomicWriteFile(gatePath, gateJson);
// Keep validation artifacts newer than the generated source gate while preserving exact bytes.
atomicWriteFile(jsonPath, reportJson);
atomicWriteFile(markdownPath, markdownOutput);
console.log(JSON.stringify({
  pass,
  officialRankingEligible: pass,
  geometryContracts: geometryContractReports.map((contract) => ({
    contractId: contract.contractId,
    pass: contract.pass,
    shapes: contract.shapes.map((shape) => ({
      shape: shape.shape,
      pass: shape.pass,
      deltas: shape.consecutiveDeltas.map((delta) => delta.relativeDifference),
    })),
  })),
  elapsedMs: report.elapsedMs,
  jsonPath,
  markdownPath,
  gatePath,
}, null, 2));
if (!pass) process.exitCode = 1;
