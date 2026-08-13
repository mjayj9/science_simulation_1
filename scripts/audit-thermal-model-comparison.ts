import { readFileSync, writeFileSync } from "node:fs";
import { createComparisonSurface } from "../src/lib/geometry/index";
import { DEFAULT_ELECTRICAL, DEFAULT_THERMAL } from "../src/lib/physics/index";
import type { WeatherPoint } from "../src/lib/weather/index";
import {
  createContinuousSurfaceWorkItem,
  createSimulationRunRequest,
  runSimulationKernel,
  type SimulationKernelInput,
} from "../src/workers/index";

const transientPath = process.argv[3] ?? "docs/annual-transient-audit-2026.json";
const jsonPath = process.argv[4] ?? "docs/thermal-model-comparison-audit-2026.json";
const markdownPath = process.argv[5] ?? "docs/thermal-model-comparison-audit-2026.md";
const transient = JSON.parse(readFileSync(transientPath, "utf8")) as {
  scenario: { year: number; shape: string; landAreaM2: number; rpm: number; weatherPoints: number };
  coverage: { intervals: number; durationHours: number; isFullCalendarYear: boolean };
  thermalModel: { model: string; labelKo: string };
  annualEnergyWh: { e00Wh: number; e11Wh: number };
};
if (transient.scenario.year !== 2025 || transient.scenario.shape !== "cylinder"
  || transient.scenario.landAreaM2 !== 0.05 || transient.scenario.rpm !== 2
  || transient.scenario.weatherPoints !== 8_761 || transient.coverage.intervals !== 8_760
  || transient.coverage.durationHours !== 8_760 || !transient.coverage.isFullCalendarYear) {
  throw new Error("Transient audit fixture does not match the thermal-comparison contract.");
}

const hourMs = 3_600_000;
const year = transient.scenario.year;
const startMs = Date.UTC(year, 0, 1);
const latitudeDeg = 37.5665;
const longitudeDeg = 126.978;
const weather: WeatherPoint[] = Array.from({ length: 8_761 }, (_, index) => {
  const timeUtcMs = startMs + index * hourMs;
  const date = new Date(timeUtcMs);
  const dayOfYear = Math.floor((timeUtcMs - startMs) / (24 * hourMs));
  const hour = date.getUTCHours();
  const seasonal = 0.78 + 0.22 * Math.sin(2 * Math.PI * (dayOfYear - 80) / 365);
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
  landAreaM2: transient.scenario.landAreaM2,
  azimuthSamples: 16,
  meridionalSegments: 4,
});
const electrical = {
  ...DEFAULT_ELECTRICAL,
  efficiency: 0.2,
  gammaPmpPerC: -0.004,
};
const surfaceItem = () => createContinuousSurfaceWorkItem(surface, {
  landAreaM2: transient.scenario.landAreaM2,
  meshVersion: "thermal-comparison-m4-a16",
});
const input: SimulationKernelInput = {
  variants: [
    {
      variantId: "quasi-static",
      referenceEfficiency: electrical.efficiency,
      continuousSurface: surfaceItem(),
      electrical: { mode: "simple", config: electrical },
      inverter: false,
      rotation: { mode: "static", angleRad: 0 },
    },
    {
      variantId: "quasi-rotating",
      referenceEfficiency: electrical.efficiency,
      continuousSurface: surfaceItem(),
      electrical: { mode: "simple", config: electrical },
      inverter: false,
      rotation: { mode: "fixed", rpm: transient.scenario.rpm, initialAngleRad: 0, referenceTimestamp: startMs },
      rotationPhaseSamples: 6,
    },
  ],
  weather,
  physics: {
    location: { latitudeDeg, longitudeDeg },
    electrical: { mode: "simple", config: electrical },
    thermal: DEFAULT_THERMAL,
    inverter: false,
  },
  mode: "annual",
  maximumGapHours: 2,
  reportingOffsetMinutes: 0,
  chunkSize: 744,
};
const request = createSimulationRunRequest("thermal-model-comparison", input);
const quasi = await runSimulationKernel(request, { yieldControl: async () => undefined });
const quasiStaticWh = quasi.acEnergyWhByVariant["quasi-static"];
const quasiRotatingWh = quasi.acEnergyWhByVariant["quasi-rotating"];
if (!(quasiStaticWh > 0) || !(quasiRotatingWh > 0) || quasi.intervals !== 8_760) {
  throw new Error("Quasi-steady audit failed full-year positive-energy acceptance.");
}
const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scenario: {
    ...transient.scenario,
    weatherSource: "same deterministic synthetic 8761-boundary fixture as annual transient audit",
    electricalModel: "local-mpp-area-integral",
    inverter: "unity bypass (AC=DC)",
  },
  integration: { steps: quasi.steps, intervals: quasi.intervals, durationHours: quasi.durationHours },
  quasiSteady: {
    model: quasi.thermalModelMetadataByVariant["quasi-static"],
    staticAcEnergyWh: quasiStaticWh,
    rotatingAcEnergyWh: quasiRotatingWh,
    rotatingMinusStaticWh: quasiRotatingWh - quasiStaticWh,
  },
  transient: {
    model: transient.thermalModel,
    staticAcEnergyWh: transient.annualEnergyWh.e00Wh,
    rotatingAcEnergyWh: transient.annualEnergyWh.e11Wh,
    rotatingMinusStaticWh: transient.annualEnergyWh.e11Wh - transient.annualEnergyWh.e00Wh,
  },
  differences: {
    staticTransientMinusQuasiWh: transient.annualEnergyWh.e00Wh - quasiStaticWh,
    staticTransientMinusQuasiPercent: 100 * (transient.annualEnergyWh.e00Wh - quasiStaticWh) / quasiStaticWh,
    rotatingTransientMinusQuasiWh: transient.annualEnergyWh.e11Wh - quasiRotatingWh,
    rotatingTransientMinusQuasiPercent: 100 * (transient.annualEnergyWh.e11Wh - quasiRotatingWh) / quasiRotatingWh,
  },
  requestFingerprint: request.fingerprint,
};
writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
writeFileSync(markdownPath, [
  "# Quasi-steady versus annual transient thermal audit",
  "",
  "Both rows use the same 8,760 actual hourly intervals and the same non-integrated closing endpoint.",
  "",
  "| Rotation | Quasi-steady AC (Wh) | Transient AC (Wh) | Transient - quasi (Wh) | Difference |",
  "|---|---:|---:|---:|---:|",
  `| Static | ${quasiStaticWh.toFixed(6)} | ${transient.annualEnergyWh.e00Wh.toFixed(6)} | ${result.differences.staticTransientMinusQuasiWh.toFixed(6)} | ${result.differences.staticTransientMinusQuasiPercent.toFixed(6)}% |`,
  `| Controlled ${transient.scenario.rpm} RPM | ${quasiRotatingWh.toFixed(6)} | ${transient.annualEnergyWh.e11Wh.toFixed(6)} | ${result.differences.rotatingTransientMinusQuasiWh.toFixed(6)} | ${result.differences.rotatingTransientMinusQuasiPercent.toFixed(6)}% |`,
  "",
].join("\n"), "utf8");
console.log(JSON.stringify(result));
