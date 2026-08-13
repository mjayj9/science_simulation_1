import {
  createComparisonSurface,
  projectedAreaForDirection,
} from "../geometry";
import { RESEARCH_PRESET_IDS, RESEARCH_PRESETS } from "./presets";

export type ResearchBenchmarkVerdict = "pass" | "partial" | "fail" | "not-evaluated";

export interface ResearchConditionMatrixRow {
  readonly studyId: string;
  readonly title: string;
  readonly geometry: string;
  readonly areaBasis: string;
  readonly sourceAndSpectrum: string;
  readonly incidence: string;
  readonly weather: string;
  readonly albedoAndReflector: string;
  readonly thermalAndConvection: string;
  readonly electricalConnection: string;
  readonly measuredQuantity: string;
  readonly primarySourceUrls: readonly string[];
}

export interface ResearchMetricResult {
  readonly metric: string;
  readonly unit: string;
  readonly reportedValue: number;
  readonly simulatedValue: number;
  readonly absoluteError: number;
  readonly relativeErrorPercent: number;
  readonly tolerancePercent: number;
  readonly toleranceBasis: string;
  readonly verdict: Exclude<ResearchBenchmarkVerdict, "not-evaluated">;
}

export interface ResearchSensitivityResult {
  readonly parameter: string;
  readonly lowerCase: string;
  readonly lowerValue: number;
  readonly baselineCase: string;
  readonly baselineValue: number;
  readonly upperCase: string;
  readonly upperValue: number;
  readonly unit: string;
}

export interface ResearchBenchmarkResult {
  readonly benchmarkId: string;
  readonly studyId: string;
  readonly title: string;
  readonly scope: string;
  readonly verdict: ResearchBenchmarkVerdict;
  readonly reportedTrend: string;
  readonly simulationResult: string;
  readonly metrics: readonly ResearchMetricResult[];
  readonly matchedConditions: readonly string[];
  readonly unmatchedConditions: readonly string[];
  readonly possibleDifferenceCauses: readonly string[];
  readonly sensitivity: readonly ResearchSensitivityResult[];
  readonly primarySourceUrls: readonly string[];
}

const AIP_CONVEX_DOI = "https://doi.org/10.1063/5.0161277";
const AIP_CONVEX_AUTHOR_COPY = "https://www.researchgate.net/publication/375023238_Evaluation_of_direct_beam_energy_received_by_convex_solar_collectors_and_their_optimal_orientations";
const PYSOLORIE_SOURCE = "https://github.com/aaghamohammadi/pysolorie";
const ROTATING_DISK_DOI = "https://doi.org/10.3390/fluids9070167";
const ROTATING_DISK_ARTICLE = "https://www.mdpi.com/2311-5521/9/7/167";

export const RESEARCH_CONDITION_MATRIX: readonly ResearchConditionMatrixRow[] = Object.freeze([
  {
    studyId: "research:A",
    title: RESEARCH_PRESETS["research:A"].title,
    geometry: "GA-optimized open-box/funnel assemblies of 64 double-sided triangular cells",
    areaBasis: "fixed 10 m x 10 m bounding footprint; heights 2, 4, 6, 8, 10 m; active area not tabulated as one reusable value",
    sourceAndSpectrum: "clear parallel p-polarized rays; refractive index 1.505; normal reflectance 4.1%; no spectral weather series",
    incidence: "solar trajectory over a summer day; 12 min time step; source does not identify one executable calendar date",
    weather: "San Francisco summer day; clouds and external obstructions neglected; source-equivalent irradiance series unavailable",
    albedoAndReflector: "no ground reflection; at most one specular reflection among structure triangles",
    thermalAndConvection: "not modeled in the reported optical optimization",
    electricalConnection: "6% conversion efficiency applied to independently illuminated double-sided triangles; full circuit topology not reported",
    measuredQuantity: "simulated one-day generated energy relative to a flat comparator",
    primarySourceUrls: RESEARCH_PRESETS["research:A"].primarySourceUrls,
  },
  {
    studyId: "research:B",
    title: RESEARCH_PRESETS["research:B"].title,
    geometry: "flat silicon cells and mirrors assembled as open cubes and funnels; 35 mm indoor cube case",
    areaBasis: "paper separately uses base area, bounding volume, cell area and flat-cell comparator area",
    sourceAndSpectrum: "1300 W xenon arc lamp with AM1.5 filter at 1000 W/m2 indoors; clear-sky solar trajectory outdoors",
    incidence: "lamp/structure geometry is not published as a complete machine-readable fixture; outdoor I-V sweeps every 12-15 min",
    weather: "MIT roof, Cambridge MA, June-December 2011; raw weather/I-V series not bundled",
    albedoAndReflector: "paper-specific cell/mirror ray tracing; exact indoor background and ground albedo unavailable",
    thermalAndConvection: "temperature/convection boundary conditions are not a complete executable source case",
    electricalConnection: "cells in parallel, one blocking diode in series with each cell",
    measuredQuantity: "energy per base area, instantaneous I-V curves and indoor/outdoor relative output",
    primarySourceUrls: RESEARCH_PRESETS["research:B"].primarySourceUrls,
  },
  {
    studyId: "research:C",
    title: RESEARCH_PRESETS["research:C"].title,
    geometry: "corrugated interdigitated-back-contact monocrystalline silicon cell folded into a sphere",
    areaBasis: "10.7 cm2 projection, 11.34 cm2 ground area; 42.8 cm2 spherical area in the equal-ground thermal comparison",
    sourceAndSpectrum: "AM1.5G solar simulator, 1000 W/m2 with spectral mismatch correction",
    incidence: "angle sweep with white background at 1 cm; separate background-height sweeps from 0 to 10 cm",
    weather: "indoor room-temperature solar-simulator tests",
    albedoAndReflector: "black 3% diffuse, sand 25% diffuse, white 85% diffuse, aluminium 88% specular, and a separate 45 degree cup",
    thermalAndConvection: "continuous one-sun exposure; temperatures sampled about every 1.5 min; sphere apex measured by IR sensor",
    electricalConnection: "corrugated IBC cell; complete spatial electrical network is not public as an executable circuit",
    measuredQuantity: "maximum power, angular response, surface temperature and power degradation from 21 C",
    primarySourceUrls: RESEARCH_PRESETS["research:C"].primarySourceUrls,
  },
  {
    studyId: "research:D",
    title: RESEARCH_PRESETS["research:D"].title,
    geometry: "0.3 m sphere/hemisphere supports tiled with rectangular flexible PV modules at 70% coverage",
    areaBasis: "0.07 m2 circular projection, 0.01 m2 support footprint, 0.099/0.198 m2 module area kept as distinct denominators",
    sourceAndSpectrum: "outdoor global irradiance; 890 W/m2 is only a single-module I-V condition, not a daily series",
    incidence: "modules occupy discrete orientations; rear low-light modules are material to the comparison",
    weather: "outdoor daylight air temperature about 25-30 C; source raw irradiance/temperature series unavailable",
    albedoAndReflector: "ground reflection is not reported as a machine-readable albedo",
    thermalAndConvection: "configuration-specific module temperatures reported; convection coefficients and full histories unavailable",
    electricalConnection: "series/parallel arrangements vary by configuration; complete topology and bypass behavior unavailable",
    measuredQuantity: "outdoor power/energy, module temperature and spacing-dependent shadow losses",
    primarySourceUrls: RESEARCH_PRESETS["research:D"].primarySourceUrls,
  },
  {
    studyId: "source:E",
    title: "Evaluation of direct beam energy received by convex solar collectors and their optimal orientations",
    geometry: "convex sphere; analytic projected area pi R2",
    areaBasis: "unit spherical surface area and unit ground-occupied area are reported separately (4:1 ratio)",
    sourceAndSpectrum: "broadband direct-normal beam only; Gsc=1367 W/m2 and Hottel clear-sky transmittance",
    incidence: "day 81 sunrise-to-sunset hour-angle integration; sphere projection is independent of beam direction",
    weather: "Tehran latitude 35.69 N; 1200 m and midlatitude-summer Hottel inputs from the authors' public implementation",
    albedoAndReflector: "sky diffuse and ground-reflected irradiance explicitly excluded",
    thermalAndConvection: "outside the study scope",
    electricalConnection: "outside the study scope; benchmark is intercepted optical beam energy",
    measuredQuantity: "daily direct beam energy per m2 sphere surface and per m2 ground-occupied area",
    primarySourceUrls: [AIP_CONVEX_DOI, AIP_CONVEX_AUTHOR_COPY, PYSOLORIE_SOURCE],
  },
  {
    studyId: "source:F",
    title: "Investigation of Convective Heat Transfer and Stability on a Rotating Disk: A Novel Experimental Method and Thermal Modeling",
    geometry: "0.2 m radius, 0.01 m thick polished aluminium disk rotating in still air",
    areaBasis: "disk face area 0.1256 m2; experiment 1 radial evaluation line 0.005-0.194 m",
    sourceAndSpectrum: "electrical uniform heat flux; no solar spectrum",
    incidence: "not an optical experiment",
    weather: "quiescent laboratory air; experiment 1 ambient 22.2 C",
    albedoAndReflector: "not applicable; emissivity 0.04 in energy balance and 0.07 for camera calibration",
    thermalAndConvection: "initial wall 52.1 C; 34.55 rad/s; local Nu=h r/k; Sutherland air properties; 100 s run",
    electricalConnection: "heater supplies uniform heat flux; rear losses reported below 1% through insulation",
    measuredQuantity: "transient IR temperature-derived local heat-transfer coefficient, Reynolds and Nusselt numbers",
    primarySourceUrls: [ROTATING_DISK_DOI, ROTATING_DISK_ARTICLE],
  },
]);

interface OpticalSphereFixture {
  readonly dayOfYear: number;
  readonly latitudeDeg: number;
  readonly altitudeM: number;
  readonly solarConstantWm2: number;
  readonly orbitalCorrection: number;
  readonly earthRotationRadS: number;
  readonly climateCorrection: readonly [number, number, number];
  readonly reportedSurfaceEnergyMJm2: number;
  readonly reportedLandEnergyMJm2: number;
}

interface RotatingDiskFixture {
  readonly angularVelocityRadS: number;
  readonly evaluationRadiusM: number;
  readonly initialWallTemperatureC: number;
  readonly ambientTemperatureC: number;
  readonly referenceTemperatureK: number;
  readonly referenceKinematicViscosityM2s: number;
  readonly sutherlandViscosityK: number;
  readonly reportedReynolds: number;
  readonly laminarNusseltCoefficient: number;
}

/** Every numeric fixture field is printed in a cited primary source or author-maintained source. */
export const OPTICAL_SPHERE_FIXTURE: Readonly<OpticalSphereFixture> = Object.freeze({
  dayOfYear: 81,
  latitudeDeg: 35.69,
  altitudeM: 1200,
  solarConstantWm2: 1367,
  orbitalCorrection: 0.033,
  earthRotationRadS: 7.15e-5,
  climateCorrection: [0.97, 0.99, 1.02] as const,
  reportedSurfaceEnergyMJm2: 8.36,
  reportedLandEnergyMJm2: 33.44,
});

export const ROTATING_DISK_FIXTURE: Readonly<RotatingDiskFixture> = Object.freeze({
  angularVelocityRadS: 34.55,
  evaluationRadiusM: 0.194,
  initialWallTemperatureC: 52.1,
  ambientTemperatureC: 22.2,
  referenceTemperatureK: 273.15,
  referenceKinematicViscosityM2s: 1.42e-5,
  sutherlandViscosityK: 110.4,
  reportedReynolds: 83_908,
  laminarNusseltCoefficient: 0.36,
});

function metricResult(
  metric: string,
  unit: string,
  reportedValue: number,
  simulatedValue: number,
  tolerancePercent: number,
  toleranceBasis: string,
): ResearchMetricResult {
  const absoluteError = Math.abs(simulatedValue - reportedValue);
  const relativeErrorPercent = reportedValue === 0 ? (absoluteError === 0 ? 0 : Infinity) : absoluteError / Math.abs(reportedValue) * 100;
  return {
    metric,
    unit,
    reportedValue,
    simulatedValue,
    absoluteError,
    relativeErrorPercent,
    tolerancePercent,
    toleranceBasis,
    verdict: relativeErrorPercent <= tolerancePercent ? "pass" : "fail",
  };
}

function hottelTransmittanceCoefficients(
  altitudeM: number,
  corrections: readonly [number, number, number],
): readonly [number, number, number] {
  const altitudeKm = altitudeM / 1000;
  const a0Star = 0.4237 - 0.00821 * (6 - altitudeKm) ** 2;
  const a1Star = 0.5055 + 0.00595 * (6.5 - altitudeKm) ** 2;
  const kStar = 0.2711 + 0.01858 * (2.5 - altitudeKm) ** 2;
  return [corrections[0] * a0Star, corrections[1] * a1Star, corrections[2] * kStar];
}

function opticalSphereDailyEnergy(
  fixture: OpticalSphereFixture,
  integrationIntervals: number,
): { surfaceMJm2: number; landMJm2: number } {
  if (integrationIntervals < 2 || integrationIntervals % 2 !== 0) {
    throw new RangeError("Optical benchmark requires a positive even Simpson interval count.");
  }
  const sphere = createComparisonSurface("sphere", {
    landAreaM2: 1,
    maxHeightM: 2,
    maximumActiveAreaM2: 10,
    maximumAspectRatio: 4,
  });
  const latitude = fixture.latitudeDeg * Math.PI / 180;
  const declination = 23.45 * Math.PI / 180
    * Math.sin(2 * Math.PI * (284 + fixture.dayOfYear) / 365);
  const sunriseHourAngle = -Math.acos(-Math.tan(latitude) * Math.tan(declination));
  const sunsetHourAngle = -sunriseHourAngle;
  const [a0, a1, k] = hottelTransmittanceCoefficients(fixture.altitudeM, fixture.climateCorrection);
  const extraterrestrial = fixture.solarConstantWm2 * (
    1 + fixture.orbitalCorrection * Math.cos(2 * Math.PI * fixture.dayOfYear / 365)
  );
  const step = (sunsetHourAngle - sunriseHourAngle) / integrationIntervals;
  let weightedPowerW = 0;
  for (let index = 0; index <= integrationIntervals; index += 1) {
    const hourAngle = sunriseHourAngle + index * step;
    const cosineZenith = Math.max(0, (
      Math.sin(latitude) * Math.sin(declination)
      + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle)
    ));
    const transmission = cosineZenith > 0 ? a0 + a1 * Math.exp(-k / cosineZenith) : 0;
    const horizontal = Math.sqrt(Math.max(0, 1 - cosineZenith ** 2));
    const projectedAreaM2 = projectedAreaForDirection(sphere, [horizontal, cosineZenith, 0]);
    const powerW = extraterrestrial * transmission * projectedAreaM2;
    weightedPowerW += (index === 0 || index === integrationIntervals ? 1 : index % 2 === 0 ? 2 : 4) * powerW;
  }
  const energyJ = weightedPowerW * step / 3 / fixture.earthRotationRadS;
  return {
    surfaceMJm2: energyJ / sphere.dimensions.activeAreaM2 / 1e6,
    landMJm2: energyJ / sphere.dimensions.footprintM2 / 1e6,
  };
}

function sutherlandKinematicViscosity(
  temperatureK: number,
  fixture: RotatingDiskFixture,
): number {
  return fixture.referenceKinematicViscosityM2s
    * (temperatureK / fixture.referenceTemperatureK) ** 1.5
    * (fixture.referenceTemperatureK + fixture.sutherlandViscosityK)
    / (temperatureK + fixture.sutherlandViscosityK);
}

function rotatingDiskDimensionless(fixture: RotatingDiskFixture, propertyTemperatureK: number) {
  const viscosity = sutherlandKinematicViscosity(propertyTemperatureK, fixture);
  const reynolds = fixture.angularVelocityRadS * fixture.evaluationRadiusM ** 2 / viscosity;
  return {
    viscosity,
    reynolds,
    nusselt: fixture.laminarNusseltCoefficient * Math.sqrt(reynolds),
  };
}

export function runOpticalGeometryBenchmark(): ResearchBenchmarkResult {
  const fine = opticalSphereDailyEnergy(OPTICAL_SPHERE_FIXTURE, 14_400);
  const coarse = opticalSphereDailyEnergy(OPTICAL_SPHERE_FIXTURE, 1_440);
  const surfaceMetric = metricResult(
    "daily direct beam energy per sphere surface area",
    "MJ/m2-surface/day",
    OPTICAL_SPHERE_FIXTURE.reportedSurfaceEnergyMJm2,
    fine.surfaceMJm2,
    1,
    "pre-registered 1% numerical tolerance; source values are rounded to 0.01 MJ/m2",
  );
  const landMetric = metricResult(
    "daily direct beam energy per ground-occupied area",
    "MJ/m2-land/day",
    OPTICAL_SPHERE_FIXTURE.reportedLandEnergyMJm2,
    fine.landMJm2,
    1,
    "pre-registered 1% numerical tolerance; source values are rounded to 0.01 MJ/m2",
  );
  const metrics = [surfaceMetric, landMetric];
  return {
    benchmarkId: "source-equivalent:optical-sphere-day81",
    studyId: "source:E",
    title: RESEARCH_CONDITION_MATRIX.find((row) => row.studyId === "source:E")?.title ?? "source:E",
    scope: "source-equivalent direct-beam geometry and Hottel clear-sky integration; not a PV electrical validation",
    verdict: metrics.every((metric) => metric.verdict === "pass") ? "pass" : "fail",
    reportedTrend: "A sphere receives 8.36 MJ/m2 of its surface and 33.44 MJ/m2 of ground-occupied area on day 81 at Tehran.",
    simulationResult: `Independent Simpson integration with the simulator's exact sphere projection produced ${fine.surfaceMJm2.toFixed(6)} and ${fine.landMJm2.toFixed(6)} MJ/m2.`,
    metrics,
    matchedConditions: [
      "sphere projection pi R2 and 4 pi R2 active surface",
      "Tehran latitude 35.69 N and day-of-year 81",
      "author-published 1200 m midlatitude-summer Hottel inputs",
      "Gsc=1367 W/m2, 0.033 orbital correction and 7.15e-5 rad/s hour-angle rate",
      "direct beam only; diffuse and ground reflection disabled",
    ],
    unmatchedConditions: [
      "the study computes intercepted optical energy, not spectral PV conversion, temperature or a circuit",
      "the paper does not publish its original numerical integration mesh",
    ],
    possibleDifferenceCauses: [
      "rounding of the two-decimal reported values",
      "integration quadrature resolution",
      "using a different astronomical or clear-sky convention would no longer be source-equivalent",
    ],
    sensitivity: [{
      parameter: "Simpson interval count",
      lowerCase: "1,440 intervals",
      lowerValue: coarse.surfaceMJm2,
      baselineCase: "14,400 intervals",
      baselineValue: fine.surfaceMJm2,
      upperCase: "reported rounded value",
      upperValue: OPTICAL_SPHERE_FIXTURE.reportedSurfaceEnergyMJm2,
      unit: "MJ/m2-surface/day",
    }],
    primarySourceUrls: [AIP_CONVEX_DOI, AIP_CONVEX_AUTHOR_COPY, PYSOLORIE_SOURCE],
  };
}

export function runRotatingThermalBenchmark(): ResearchBenchmarkResult {
  const filmTemperatureK = (
    ROTATING_DISK_FIXTURE.initialWallTemperatureC
    + ROTATING_DISK_FIXTURE.ambientTemperatureC
  ) / 2 + 273.15;
  const baseline = rotatingDiskDimensionless(ROTATING_DISK_FIXTURE, filmTemperatureK);
  const ambientPropertyCase = rotatingDiskDimensionless(
    ROTATING_DISK_FIXTURE,
    ROTATING_DISK_FIXTURE.ambientTemperatureC + 273.15,
  );
  const reportedNu = ROTATING_DISK_FIXTURE.laminarNusseltCoefficient
    * Math.sqrt(ROTATING_DISK_FIXTURE.reportedReynolds);
  const reynoldsMetric = metricResult(
    "local rotational Reynolds number at r=0.194 m",
    "dimensionless",
    ROTATING_DISK_FIXTURE.reportedReynolds,
    baseline.reynolds,
    1.72,
    "pre-registered from the paper's Table 2 Reynolds relative uncertainty (1.72%)",
  );
  const nusseltMetric = metricResult(
    "laminar local Nusselt number Nu=0.36 sqrt(Re_omega)",
    "dimensionless",
    reportedNu,
    baseline.nusselt,
    2.16,
    "pre-registered conservative end of the paper's Table 2 Nusselt uncertainty (2.10-2.16%)",
  );
  const metrics = [reynoldsMetric, nusseltMetric];
  return {
    benchmarkId: "source-equivalent:rotating-disk-laminar-exp1",
    studyId: "source:F",
    title: RESEARCH_CONDITION_MATRIX.find((row) => row.studyId === "source:F")?.title ?? "source:F",
    scope: "source-equivalent experiment-1 rotating-flow heat-transfer dimensionless benchmark; not a PV module calibration",
    verdict: metrics.every((metric) => metric.verdict === "pass") ? "pass" : "fail",
    reportedTrend: "Experiment 1 remains laminar over the evaluated radius and follows Nu=0.36 sqrt(Re_omega); Table 5 reports Re_omega=83,908.",
    simulationResult: `Sutherland air properties at the reported film temperature give Re=${baseline.reynolds.toFixed(3)} and Nu=${baseline.nusselt.toFixed(6)}.`,
    metrics,
    matchedConditions: [
      "experiment 1 omega=34.55 rad/s and outer evaluated radius 0.194 m",
      "reported wall 52.1 C and ambient 22.2 C film-temperature method",
      "reported Sutherland reference viscosity, temperature and constant",
      "paper's laminar coefficient K=0.36",
      "paper uncertainty is used as the pre-registered tolerance, not as a fitted multiplier",
    ],
    unmatchedConditions: [
      "raw IR pixel temperatures and fitted local h(r) data are not published as machine-readable data",
      "uniform heater heat flux magnitude is not tabulated for experiment 1",
      "this heated aluminium disk is not a PV laminate and has no optical or electrical conversion",
    ],
    possibleDifferenceCauses: [
      "Table 5 Reynolds is rounded and may use spatially varying film properties",
      "OCR-rendered air-property precision is limited to the digits printed in Table 4",
      "ambient-property evaluation instead of the reported film-temperature method changes the result",
    ],
    sensitivity: [{
      parameter: "air-property evaluation temperature",
      lowerCase: "film temperature (paper method)",
      lowerValue: baseline.reynolds,
      baselineCase: "reported Table 5",
      baselineValue: ROTATING_DISK_FIXTURE.reportedReynolds,
      upperCase: "ambient temperature only",
      upperValue: ambientPropertyCase.reynolds,
      unit: "Re_omega",
    }],
    primarySourceUrls: [ROTATING_DISK_DOI, ROTATING_DISK_ARTICLE],
  };
}

export function runResearchReproductionAudit(): readonly ResearchBenchmarkResult[] {
  const notEvaluated = RESEARCH_PRESET_IDS.map((id): ResearchBenchmarkResult => {
    const preset = RESEARCH_PRESETS[id];
    return {
      benchmarkId: `${id}:incomplete-source-case`,
      studyId: id,
      title: preset.title,
      scope: "original A-D source case",
      verdict: "not-evaluated",
      reportedTrend: preset.validationAudit.reportedTrend,
      simulationResult: preset.validationAudit.simulationResult,
      metrics: [],
      matchedConditions: preset.validationAudit.matchedConditions,
      unmatchedConditions: preset.validationAudit.unmatchedConditions,
      possibleDifferenceCauses: preset.validationAudit.possibleDifferenceCauses,
      sensitivity: [],
      primarySourceUrls: preset.primarySourceUrls,
    };
  });
  return Object.freeze([
    ...notEvaluated,
    runOpticalGeometryBenchmark(),
    runRotatingThermalBenchmark(),
  ]);
}
