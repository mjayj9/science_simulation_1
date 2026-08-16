import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createComparisonSurface } from "../src/lib/geometry/index";
import {
  auditAnnualThermalMeshConvergence,
  simulateAnnualRotationDecomposition,
} from "../src/lib/physics/annual-transient";
import type { WeatherPoint } from "../src/lib/weather/index";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = resolve(scriptDirectory, "..");
const reportPath = resolve(workspaceDirectory, "docs", "annual-transient-audit-2026.json");
const hourMs = 3_600_000;
const year = 2025;
const startMs = Date.UTC(year, 0, 1);
const latitudeDeg = 37.5665;
const longitudeDeg = 126.978;

const weather: WeatherPoint[] = Array.from({ length: 8_761 }, (_, index) => {
  const timeUtcMs = startMs + index * hourMs;
  const date = new Date(timeUtcMs);
  const dayOfYear = Math.floor((timeUtcMs - startMs) / (24 * hourMs));
  const hour = date.getUTCHours();
  const seasonal = 0.78 + 0.22 * Math.sin(2 * Math.PI * (dayOfYear - 80) / 365);
  // Seoul local solar noon is near 03 UTC. Keep this deterministic audit
  // fixture on the same UTC clock used by solarPosition.
  const daylight = Math.max(0, Math.cos(Math.PI * (hour - 3) / 14));
  const ghiWm2 = 720 * seasonal * daylight;
  const diffuseFraction = 0.18 + 0.08 * (1 - daylight);
  return {
    timeUtcMs,
    ghiWm2,
    dniWm2: daylight > 0 ? ghiWm2 * (1 - diffuseFraction) / Math.max(0.2, daylight) : 0,
    dhiWm2: ghiWm2 * diffuseFraction,
    ambientC: 14 + 12 * Math.sin(2 * Math.PI * (dayOfYear - 105) / 365)
      + 3 * Math.cos(2 * Math.PI * (hour - 5) / 24),
    windSpeedMs: 2.4 + 1.1 * Math.sin(2 * Math.PI * (dayOfYear + hour / 24) / 9),
    windDirectionDeg: (190 + 35 * Math.sin(2 * Math.PI * dayOfYear / 17) + 360) % 360,
    gustMs: 4,
    cloudFraction: 0.2,
    precipitationMm: 0,
  };
});

const surface = createComparisonSurface("cylinder", {
  landAreaM2: 0.05,
  azimuthSamples: 16,
  meridionalSegments: 4,
});
const commonInput = {
  surface,
  weather,
  location: { latitudeDeg, longitudeDeg },
  rpm: 2,
  referenceEfficiency: 0.2,
  gammaPerC: -0.004,
  inverter: false as const,
  thermalMesh: { targetNodeCount: 6 },
  thermalConfig: { maximumSubstepSeconds: 900 },
  warmup: {
    periodHours: 24,
    minimumCycles: 2,
    maximumCycles: 8,
    convergenceToleranceC: 0.05,
  },
  opticalPhaseSamples: 6,
  convectionPhaseSamples: 6,
} as const;

const startedAtMs = Date.now();
const decomposition = simulateAnnualRotationDecomposition(commonInput);
// A 14-day actual-clock window keeps the three-resolution audit fast while
// exercising the same stateful solver, mesh construction and heat ledger.
const convergence = auditAnnualThermalMeshConvergence({
  ...commonInput,
  weather: weather.slice(0, 14 * 24 + 1),
  warmup: false,
}, [3, 6, 12], 0.01, 0.2);
if (!decomposition.e11.coverage.isFullCalendarYear
  || decomposition.e11.coverage.intervals !== 8760
  || !decomposition.e11.coverage.closingEndpointPresent) {
  throw new Error("Annual transient audit did not integrate the complete 8760-hour clock.");
}
if (!(decomposition.annual.e00Wh > 0) || !(decomposition.annual.e11Wh > 0)) {
  throw new Error("Annual transient audit requires positive E00 and E11 energy.");
}
if (Math.abs(decomposition.annual.closureResidualWh) > 1e-9) {
  throw new Error("Annual transient 2x2 decomposition failed its closure tolerance.");
}
if (decomposition.e11.energyAudit.relativeEnergyResidual > 1e-8) {
  throw new Error("Annual transient heat ledger failed its residual tolerance.");
}
if (!convergence.converged) {
  throw new Error("Annual transient reduced thermal mesh failed its convergence tolerance.");
}
const report = {
  schemaVersion: 1,
  pass: true,
  generatedAtUtc: new Date().toISOString(),
  acceptance: {
    heatResidualToleranceFraction: 1e-8,
    thermalMeshEnergyToleranceFraction: 0.01,
    thermalMeshTemperatureToleranceC: 0.2,
  },
  scenario: {
    weatherSource: "deterministic synthetic audit fixture; not a research benchmark",
    year,
    latitudeDeg,
    longitudeDeg,
    shape: surface.kind,
    landAreaM2: 0.05,
    activePvAreaM2: surface.dimensions.activeAreaM2,
    rpm: commonInput.rpm,
    weatherPoints: weather.length,
    expectedIntervals: 8760,
    thermalNodes: commonInput.thermalMesh.targetNodeCount,
    opticalSamples: surface.zones.flatMap((zone) => zone.samples).length,
  },
  coverage: decomposition.e11.coverage,
  thermalModel: decomposition.thermalModel,
  annualEnergyWh: decomposition.annual,
  monthlyEnergyWh: decomposition.monthly,
  temperature: {
    e00AverageC: decomposition.e00.averageTemperatureC,
    e11AverageC: decomposition.e11.averageTemperatureC,
    e00MaximumC: decomposition.e00.maximumTemperatureC,
    e11MaximumC: decomposition.e11.maximumTemperatureC,
  },
  warmup: decomposition.e11.warmup,
  energyAudit: decomposition.e11.energyAudit,
  thermalMesh: decomposition.e11.mesh,
  meshConvergence14Day: convergence,
  elapsedMs: Date.now() - startedAtMs,
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
