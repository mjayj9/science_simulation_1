import { writeFileSync } from "node:fs";
import {
  commonMaximumHeightM,
  createComparisonSurface,
  type ComparisonShapeKind,
} from "../src/lib/geometry/index";

const jsonPath = process.argv[3] ?? "docs/fair-geometry-audit-2026.json";
const markdownPath = process.argv[4] ?? "docs/fair-geometry-audit-2026.md";
const landAreasM2 = [0.0125, 0.05, 0.2] as const;
const shapes: readonly ComparisonShapeKind[] = [
  "plane", "cube", "cylinder", "sphere", "hemisphere", "cone",
];
const toleranceM2 = 1e-10;
const toleranceM = 1e-10;

const rows = landAreasM2.flatMap((landAreaM2) => {
  const maximumHeightM = commonMaximumHeightM(landAreaM2);
  return shapes.map((shape) => {
    const surface = createComparisonSurface(shape, {
      landAreaM2,
      maxHeightM: maximumHeightM,
      cylinderHeightM: maximumHeightM,
      coneHeightM: maximumHeightM,
      planeTiltDeg: 30,
      footprintMode: "swept",
      groundClearanceM: 0.01,
      maximumActiveAreaM2: 100_000,
      maximumAspectRatio: 4,
      azimuthSamples: 16,
      meridionalSegments: 4,
    });
    const projectedAreaM2 = surface.comparison.landAreaM2;
    const projectionErrorM2 = projectedAreaM2 - landAreaM2;
    const heightM = surface.comparison.dimensions.heightM;
    return {
      shape,
      requestedLandAreaM2: landAreaM2,
      horizontalProjectedAreaM2: projectedAreaM2,
      projectionErrorM2,
      projectionPass: Math.abs(projectionErrorM2) <= toleranceM2,
      maximumHeightM,
      heightM,
      heightMarginM: maximumHeightM - heightM,
      heightPass: heightM <= maximumHeightM + toleranceM,
      activePvAreaM2: surface.comparison.activeAreaM2,
      pvLandRatio: surface.comparison.activeAreaM2 / landAreaM2,
      footprintIndex: surface.comparison.footprintIndex,
      officialComparisonEligible: surface.comparison.constraints.officialComparisonEligible,
      exclusionReasons: surface.comparison.constraints.officialComparisonExclusionReasons,
    };
  });
});
if (rows.some((row) => !row.projectionPass || !row.heightPass)) {
  throw new Error(`Fair-geometry projection or height acceptance failed: ${JSON.stringify(
    rows.filter((row) => !row.projectionPass || !row.heightPass),
  )}`);
}
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  tolerances: { projectedAreaM2: toleranceM2, heightM: toleranceM },
  rows,
};
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(markdownPath, [
  "# Fair-geometry audit",
  "",
  "| A_land | Shape | Horizontal projection | Error | H | H_max | A_PV | A_PV/A_land | Pass |",
  "|---:|---|---:|---:|---:|---:|---:|---:|---|",
  ...rows.map((row) => `| ${row.requestedLandAreaM2.toFixed(6)} | ${row.shape} | ${row.horizontalProjectedAreaM2.toFixed(12)} | ${row.projectionErrorM2.toExponential(3)} | ${row.heightM.toFixed(9)} | ${row.maximumHeightM.toFixed(9)} | ${row.activePvAreaM2.toFixed(9)} | ${row.pvLandRatio.toFixed(6)} | ${row.projectionPass && row.heightPass ? "pass" : "fail"} |`),
  "",
].join("\n"), "utf8");
console.log(JSON.stringify({ jsonPath, markdownPath, rowCount: rows.length, passCount: rows.filter((row) => row.projectionPass && row.heightPass).length }));
