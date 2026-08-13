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
    const commonInput = {
      landAreaM2,
      maxHeightM: maximumHeightM,
      cylinderHeightM: maximumHeightM,
      coneHeightM: maximumHeightM,
      planeTiltDeg: 30,
      groundClearanceM: 0,
      maximumActiveAreaM2: 100_000,
      maximumAspectRatio: 4,
      azimuthSamples: 16,
      meridionalSegments: 4,
    } as const;
    const staticSurface = createComparisonSurface(shape, { ...commonInput, footprintMode: "static" });
    const sweptSurface = createComparisonSurface(shape, { ...commonInput, footprintMode: "swept" });
    const staticProjectedAreaM2 = staticSurface.comparison.footprint.staticProjectedAreaM2;
    const sweptOccupationM2 = sweptSurface.comparison.footprint.sweptAreaM2;
    const staticProjectionErrorM2 = staticProjectedAreaM2 - landAreaM2;
    const sweptOccupationErrorM2 = sweptOccupationM2 - landAreaM2;
    const maximumWorldSampleYM = Math.max(
      ...[staticSurface, sweptSurface].flatMap((surface) => surface.zones.flatMap(
        (zone) => zone.samples.map((sample) => sample.position[1]),
      )),
    );
    const bodyHeightM = staticSurface.comparison.dimensions.heightM;
    return {
      shape,
      requestedLandAreaM2: landAreaM2,
      instantaneousHorizontalProjectionM2: staticProjectedAreaM2,
      staticProjectionErrorM2,
      staticProjectionPass: Math.abs(staticProjectionErrorM2) <= toleranceM2,
      sweptOccupationM2,
      sweptOccupationErrorM2,
      sweptOccupationPass: Math.abs(sweptOccupationErrorM2) <= toleranceM2,
      maximumHeightM,
      bodyHeightM,
      maximumWorldSampleYM,
      installedHeightMarginM: maximumHeightM - maximumWorldSampleYM,
      heightPass: maximumWorldSampleYM <= maximumHeightM + toleranceM,
      activePvAreaM2Static: staticSurface.comparison.activeAreaM2,
      activePvAreaM2Swept: sweptSurface.comparison.activeAreaM2,
      pvLandRatioStatic: staticSurface.comparison.activeAreaM2 / landAreaM2,
      pvLandRatioSwept: sweptSurface.comparison.activeAreaM2 / landAreaM2,
      staticFootprintIndex: staticSurface.comparison.footprintIndex,
      sweptFootprintIndex: sweptSurface.comparison.footprintIndex,
      officialComparisonEligible: staticSurface.comparison.constraints.officialComparisonEligible
        && sweptSurface.comparison.constraints.officialComparisonEligible,
      exclusionReasons: [...new Set([
        ...staticSurface.comparison.constraints.officialComparisonExclusionReasons,
        ...sweptSurface.comparison.constraints.officialComparisonExclusionReasons,
      ])],
    };
  });
});
if (rows.some((row) => !row.staticProjectionPass || !row.sweptOccupationPass || !row.heightPass)) {
  throw new Error(`Fair-geometry projection or height acceptance failed: ${JSON.stringify(
    rows.filter((row) => !row.staticProjectionPass || !row.sweptOccupationPass || !row.heightPass),
  )}`);
}
const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  contract: "static uses instantaneous horizontal projection; controlled rotation uses 360-degree swept occupation; H_max is installed world height including support clearance",
  tolerances: { areaM2: toleranceM2, installedHeightM: toleranceM },
  rows,
};
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(markdownPath, [
  "# Fair-geometry audit",
  "",
  "| A_land | Shape | Static horizontal projection | Swept occupation | World top | H_max | A_PV static | A_PV swept | Pass |",
  "|---:|---|---:|---:|---:|---:|---:|---:|---|",
  ...rows.map((row) => `| ${row.requestedLandAreaM2.toFixed(6)} | ${row.shape} | ${row.instantaneousHorizontalProjectionM2.toFixed(12)} | ${row.sweptOccupationM2.toFixed(12)} | ${row.maximumWorldSampleYM.toFixed(9)} | ${row.maximumHeightM.toFixed(9)} | ${row.activePvAreaM2Static.toFixed(9)} | ${row.activePvAreaM2Swept.toFixed(9)} | ${row.staticProjectionPass && row.sweptOccupationPass && row.heightPass ? "pass" : "fail"} |`),
  "",
].join("\n"), "utf8");
console.log(JSON.stringify({ jsonPath, markdownPath, rowCount: rows.length, passCount: rows.filter((row) => row.staticProjectionPass && row.sweptOccupationPass && row.heightPass).length }));
