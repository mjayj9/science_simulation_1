import type { PresetName } from "../geometry";

export const RESEARCH_PRESET_IDS = [
  "research:A",
  "research:B",
  "research:C",
  "research:D",
] as const;

export type ResearchPresetId = typeof RESEARCH_PRESET_IDS[number];
export type ResearchStudyMode = "simulation" | "indoor-experiment" | "outdoor-experiment";
export type ResearchComparisonBasis =
  | "same-footprint-area"
  | "same-ground-area"
  | "same-projected-area"
  | "same-active-cell-area"
  | "same-bounding-volume";
export type ResearchTrendJudgement =
  | "trend-match"
  | "partial-match"
  | "mismatch"
  | "not-evaluated";
export type ResearchConfidenceGrade = "high" | "medium" | "low" | "not-rated";

export interface ResearchCondition {
  /** Stable descriptive key. It is evidence metadata, never an executable config path. */
  readonly key: string;
  readonly value: string | number | readonly number[];
  readonly unit?: string;
  readonly note?: string;
  readonly sourceUrl: string;
}

export type ResearchExecutableInputValue = string | number | boolean | null;
export type ResearchExecutableInputStatus = "reported" | "derived-exact" | "missing";

export interface ResearchExecutableInput {
  /** Stable UI/adapter key. Null values must never be inferred automatically. */
  readonly key: string;
  readonly value: ResearchExecutableInputValue;
  readonly unit?: string;
  readonly status: ResearchExecutableInputStatus;
  readonly sourceUrl: string | null;
  readonly note?: string;
}

export interface ResearchValidationAudit {
  /** A source observation, never an executable target or calibration datum. */
  readonly reportedTrend: string;
  /** Confidence in the condition transcription, independent of reproduction status. */
  readonly sourceEvidenceGrade: Exclude<ResearchConfidenceGrade, "not-rated">;
  readonly matchedConditions: readonly string[];
  readonly unmatchedConditions: readonly string[];
  readonly simulationResult: string;
  readonly judgement: ResearchTrendJudgement;
  readonly quantitativeErrorPercent: number | null;
  readonly confidenceGrade: ResearchConfidenceGrade;
  readonly possibleDifferenceCauses: readonly string[];
}

export interface ResearchPreset {
  readonly schemaVersion: 1;
  readonly namespace: "research";
  readonly id: ResearchPresetId;
  readonly label: "A" | "B" | "C" | "D";
  readonly doi: string;
  readonly title: string;
  readonly publisherUrl: string;
  readonly primarySourceUrls: readonly string[];
  readonly geometryClass: string;
  readonly studyModes: readonly ResearchStudyMode[];
  readonly comparisonBases: readonly ResearchComparisonBasis[];
  /** Conditions transcribed from the cited primary source; they are not applied globally. */
  readonly conditions: readonly ResearchCondition[];
  /** One coherent, opt-in case. Only non-null entries may be applied by an adapter. */
  readonly executableCaseId: string;
  readonly executableInputs: readonly ResearchExecutableInput[];
  /** Required values absent from the source or deliberately awaiting a user choice. */
  readonly missingInputs: readonly string[];
  readonly validationAudit: ResearchValidationAudit;
  readonly limitations: readonly string[];
  readonly policy: {
    readonly application: "explicit-research-run-only";
    readonly forbiddenTransformations: readonly (
      | "calibration-factor"
      | "shape-multiplier"
      | "reported-output-target"
    )[];
  };
}

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

const DOI_A = "https://doi.org/10.1063/1.3308490";
const CALTECH_A = "https://authors.library.caltech.edu/records/7bv9y-j0563";
const CALTECH_A_PDF = "https://authors.library.caltech.edu/records/7bv9y-j0563/files/1.3308490.pdf";
const DOI_B = "https://doi.org/10.1039/C2EE21170J";
const RSC_B = "https://pubs.rsc.org/en/content/articlelanding/2012/ee/c2ee21170j";
const RSC_B_SUPPLEMENT = "https://www.rsc.org/suppdata/ee/c2/c2ee21170j/c2ee21170j.pdf";
const DOI_C = "https://doi.org/10.1557/mrc.2020.44";
const CAMBRIDGE_C = "https://www.cambridge.org/core/journals/mrs-communications/article/natureinspired-spherical-silicon-solar-cell-for-three-dimensional-light-harvesting-improved-dust-and-thermal-management/0EE382BEDC3D233365B27E4C3777FDC4";
const CAMBRIDGE_C_PDF = "https://www.cambridge.org/core/services/aop-cambridge-core/content/view/0EE382BEDC3D233365B27E4C3777FDC4/S2159685920000440a.pdf/natureinspired_spherical_silicon_solar_cell_for_threedimensional_light_harvesting_improved_dust_and_thermal_management.pdf";
const DOI_D = "https://doi.org/10.1002/ese3.1717";
const WILEY_D = "https://scijournals.onlinelibrary.wiley.com/doi/full/10.1002/ese3.1717";

const POLICY = {
  application: "explicit-research-run-only",
  forbiddenTransformations: [
    "calibration-factor",
    "shape-multiplier",
    "reported-output-target",
  ],
} as const;

const presets = {
  "research:A": {
    schemaVersion: 1,
    namespace: "research",
    id: "research:A",
    label: "A",
    doi: "10.1063/1.3308490",
    title: "Three-dimensional photovoltaics",
    publisherUrl: DOI_A,
    primarySourceUrls: [DOI_A, CALTECH_A, CALTECH_A_PDF],
    geometryClass: "GA-optimized assemblies of 64 double-sided triangular flat PV cells",
    studyModes: ["simulation"],
    comparisonBases: ["same-footprint-area", "same-bounding-volume"],
    conditions: [
      {
        key: "bounding-footprint",
        value: "10 x 10",
        unit: "m",
        note: "Every candidate at a given height is confined to the same rectangular bounding box.",
        sourceUrl: CALTECH_A_PDF,
      },
      {
        key: "height-sweep",
        value: [2, 4, 6, 8, 10],
        unit: "m",
        sourceUrl: CALTECH_A_PDF,
      },
      {
        key: "surface-discretization",
        value: "64 independently movable, double-sided triangular flat cells",
        note: "Tests up to 1000 triangles did not materially change the reported optimized shape or energy.",
        sourceUrl: CALTECH_A_PDF,
      },
      {
        key: "optimization-objective",
        value: "maximize one-day generated energy with a genetic algorithm",
        sourceUrl: CALTECH_A_PDF,
      },
      {
        key: "solar-scenario",
        value: "summer day in San Francisco; clear parallel-ray source",
        note: "Cloud cover and all obstructions other than the structure's own triangles were neglected.",
        sourceUrl: CALTECH_A_PDF,
      },
      {
        key: "solar-time-step",
        value: 12,
        unit: "min",
        sourceUrl: CALTECH_A_PDF,
      },
      {
        key: "cell-optics-and-efficiency",
        value: "p-polarized light; refractive index 1.505; 4.1% normal reflectance; 6% conversion efficiency",
        sourceUrl: CALTECH_A_PDF,
      },
      {
        key: "reflection-and-ground",
        value: "one specular reflection per ray; no ground reflection",
        note: "The paper calls the resulting 3D energy a lower bound under its optical approximation.",
        sourceUrl: CALTECH_A_PDF,
      },
      {
        key: "ray-quadrature",
        value: "100 ray traces per triangle during optimization; 10,000 for final values",
        note: "The reported final energy convergence was better than 0.01% within that source model.",
        sourceUrl: CALTECH_A_PDF,
      },
      {
        key: "reported-height-series",
        value: "open box 1.29, 1.56, 1.83, 2.11, 2.38; funnel 1.29, 1.58, 1.87, 2.15, 2.43 relative to flat",
        note: "These are observations for the five reported heights, not targets for another geometry or climate.",
        sourceUrl: CALTECH_A_PDF,
      },
      {
        key: "reported-time-profile",
        value: "3D output is more evenly distributed, with the height benefit strongest in morning and afternoon",
        sourceUrl: CALTECH_A,
      },
    ],
    executableCaseId: "ten-metre-bounding-box-metadata",
    executableInputs: [
      {
        key: "geometry.kind",
        value: null,
        status: "missing",
        sourceUrl: null,
        note: "The app has no canonical mapping for the paper's optimized 64-triangle funnel coordinates.",
      },
      { key: "geometry.heightM", value: 10, unit: "m", status: "reported", sourceUrl: CALTECH_A_PDF },
      {
        key: "comparison.landAreaM2",
        value: 100,
        unit: "m2",
        status: "derived-exact",
        sourceUrl: CALTECH_A_PDF,
        note: "Exact 10 m x 10 m source bounding-box base.",
      },
      {
        key: "comparison.boundingVolumeM3",
        value: 1000,
        unit: "m3",
        status: "derived-exact",
        sourceUrl: CALTECH_A_PDF,
        note: "The selected table case uses a 10 m height in the 10 m x 10 m base.",
      },
      { key: "comparison.projectedAreaM2", value: 100, unit: "m2", status: "reported", sourceUrl: CALTECH_A_PDF },
      { key: "pv.activeAreaM2", value: null, unit: "m2", status: "missing", sourceUrl: null },
      { key: "pv.surfaceSidedness", value: "double-sided", status: "reported", sourceUrl: CALTECH_A_PDF },
      { key: "pv.conversionEfficiency", value: 0.06, status: "reported", sourceUrl: CALTECH_A_PDF },
      { key: "pv.cellNormalReflectivity", value: 0.041, status: "reported", sourceUrl: CALTECH_A_PDF },
      { key: "site.scenario", value: "summer day in San Francisco", status: "reported", sourceUrl: CALTECH_A_PDF },
      { key: "site.latitudeDeg", value: null, unit: "deg", status: "missing", sourceUrl: null },
      { key: "site.date", value: null, status: "missing", sourceUrl: null },
      { key: "irradiance.weatherSeries", value: null, status: "missing", sourceUrl: null },
      { key: "numerics.timeStepMinutes", value: 12, unit: "min", status: "reported", sourceUrl: CALTECH_A_PDF },
      { key: "optics.groundReflectionEnabled", value: false, status: "reported", sourceUrl: CALTECH_A_PDF },
      { key: "optics.maxReflectionBounces", value: 1, status: "reported", sourceUrl: CALTECH_A_PDF },
      { key: "optics.reflectionModel", value: "specular-p-polarized", status: "reported", sourceUrl: CALTECH_A_PDF },
    ],
    missingInputs: [
      "geometry.kind",
      "pv.activeAreaM2",
      "site.latitudeDeg",
      "site.date",
      "irradiance.weatherSeries",
    ],
    validationAudit: {
      reportedTrend: "At fixed 10 m x 10 m footprint, optimized one-day energy increases approximately linearly across the 2-10 m height sweep and the daily curve is flatter than the flat comparator.",
      sourceEvidenceGrade: "high",
      matchedConditions: [
        "The research namespace preserves the 100 m2 footprint, 10 m selected height, optical constants, and 12 minute source time step.",
      ],
      unmatchedConditions: [
        "No source 64-triangle coordinates or GA optimizer are implemented by the preset adapter.",
        "The exact San Francisco date/latitude and a source-equivalent irradiance series are not reported as executable inputs.",
        "The general continuous-skin geometries are not the paper's double-sided triangular open-box/funnel structures.",
      ],
      simulationResult: "Not run under a complete source-equivalent case; the ordinary Seoul six-shape comparison is not evidence for this study.",
      judgement: "not-evaluated",
      quantitativeErrorPercent: null,
      confidenceGrade: "not-rated",
      possibleDifferenceCauses: [
        "different geometry and active material area",
        "different weather, latitude, date, and diffuse-radiation treatment",
        "different reflection order, polarization, and electrical topology",
      ],
    },
    limitations: [
      "The height trend belongs to optimized open-box/funnel assemblies, not to spheres, cylinders, cones, or the app's common-H_max ranking.",
      "The active PV area changes with optimized triangle geometry and is not tabulated as one reusable value for the selected case.",
      "Reported ratios are observations only and are never installed as output scaling or a shape correction.",
    ],
    policy: POLICY,
  },
  "research:B": {
    schemaVersion: 1,
    namespace: "research",
    id: "research:B",
    label: "B",
    doi: "10.1039/C2EE21170J",
    title: "Solar energy generation in three dimensions",
    publisherUrl: RSC_B,
    primarySourceUrls: [DOI_B, RSC_B, RSC_B_SUPPLEMENT],
    geometryClass: "assemblies of flat silicon cells and mirrors, including open-cube and funnel structures",
    studyModes: ["simulation", "indoor-experiment", "outdoor-experiment"],
    comparisonBases: ["same-footprint-area", "same-active-cell-area", "same-bounding-volume"],
    conditions: [
      {
        key: "reported-energy-density-trend",
        value: "2-20 times stationary flat-panel energy per base area for the structures and cases studied",
        note: "The 20x case is a 50 m building in Boston winter using 21x the PV material of its rooftop comparator; it is not a generic 3D gain.",
        sourceUrl: RSC_B,
      },
      {
        key: "reported-material-intensity",
        value: "1.5-4 times larger solar-cell area per generated energy than flat panels under the reported conditions",
        note: "This is area per generated energy, not a universal 1.5-4x active-area ratio.",
        sourceUrl: RSC_B,
      },
      {
        key: "cell-model-and-size",
        value: "Solarbotics SCC3733 monocrystalline silicon; 37 x 33",
        unit: "mm",
        note: "Nominal Voc 6.7 V, Isc 20 mA, and independently verified AM1.5 efficiency of 10%.",
        sourceUrl: RSC_B_SUPPLEMENT,
      },
      {
        key: "cell-cover-optics",
        value: "1 mm epoxy cover, refractive index 1.6, approximately 14% normal-incidence reflectivity",
        sourceUrl: RSC_B_SUPPLEMENT,
      },
      {
        key: "indoor-illumination",
        value: "1300 W xenon arc lamp with global AM1.5 filter, calibrated irradiance 1000",
        unit: "W/m2",
        sourceUrl: RSC_B_SUPPLEMENT,
      },
      {
        key: "indoor-comparator-geometry",
        value: "35 mm cube versus a 33 x 37 mm flat cell",
        note: "Cube base, flat-cell area, active area, and support footprint are distinct denominators.",
        sourceUrl: RSC_B_SUPPLEMENT,
      },
      {
        key: "outdoor-site-and-period",
        value: "MIT building 13 roof, Cambridge, Massachusetts; June through December 2011",
        sourceUrl: RSC_B_SUPPLEMENT,
      },
      {
        key: "outdoor-acquisition",
        value: "simultaneous 3D structures and flat reference; current-voltage sweeps every 12-15 minutes",
        sourceUrl: RSC_B_SUPPLEMENT,
      },
      {
        key: "electrical-topology",
        value: "cells connected in parallel through a main bus with one blocking diode in series per cell",
        note: "The blocking diodes substantially reduced masked-cell imbalance in the source tests.",
        sourceUrl: RSC_B_SUPPLEMENT,
      },
      {
        key: "numerical-quadrature",
        value: 10_000,
        unit: "surface grid points per cell",
        note: "Optimization used a coarser 100-point grid, followed by 10,000-point evaluation.",
        sourceUrl: RSC_B_SUPPLEMENT,
      },
      {
        key: "solar-and-weather-envelope",
        value: "Reda solar trajectory with empirical air-mass and 1.1 diffuse factor; clear-weather interpretation",
        note: "Spectral dispersion and weather corrections were not included in the cited simulations.",
        sourceUrl: RSC_B_SUPPLEMENT,
      },
      {
        key: "annual-open-cube-trend",
        value: "2.1-3.8 times horizontal flat energy per footprint from low to high latitude in source clear-weather simulations",
        note: "The comparator is horizontal and the source cube has 1 m2 base; an optimal fixed plane is a different baseline.",
        sourceUrl: RSC_B_SUPPLEMENT,
      },
    ],
    executableCaseId: "indoor-cube-validation",
    executableInputs: [
      { key: "geometry.kind", value: "cube", status: "reported", sourceUrl: RSC_B_SUPPLEMENT },
      { key: "geometry.heightM", value: 0.035, unit: "m", status: "reported", sourceUrl: RSC_B_SUPPLEMENT },
      {
        key: "comparison.landAreaM2",
        value: 0.001225,
        unit: "m2",
        status: "derived-exact",
        sourceUrl: RSC_B_SUPPLEMENT,
        note: "Exact 0.035 m x 0.035 m cube-base area; no output was fitted to obtain it.",
      },
      { key: "comparison.projectedAreaM2", value: null, unit: "m2", status: "missing", sourceUrl: null },
      { key: "pv.activeAreaM2", value: null, unit: "m2", status: "missing", sourceUrl: null },
      { key: "support.footprintM2", value: null, unit: "m2", status: "missing", sourceUrl: null },
      { key: "electrical.connection", value: "parallel-with-cell-blocking-diodes", status: "reported", sourceUrl: RSC_B_SUPPLEMENT },
      { key: "optics.groundAlbedo", value: null, status: "missing", sourceUrl: null },
      { key: "optics.background", value: null, status: "missing", sourceUrl: null },
      { key: "irradiance.globalWm2", value: 1000, unit: "W/m2", status: "reported", sourceUrl: RSC_B_SUPPLEMENT },
      { key: "pv.cellNormalReflectivity", value: 0.14, status: "reported", sourceUrl: RSC_B_SUPPLEMENT },
    ],
    missingInputs: [
      "comparison.projectedAreaM2",
      "pv.activeAreaM2",
      "support.footprintM2",
      "optics.groundAlbedo",
      "optics.background",
    ],
    validationAudit: {
      reportedTrend: "The reported structures increase energy per footprint and flatten daily/seasonal output, while generally using more PV material per generated energy than a flat panel.",
      sourceEvidenceGrade: "high",
      matchedConditions: [
        "The indoor metadata preserves the 35 mm cube base/height, 1000 W/m2 lamp, 14% cover reflectivity, and isolated research namespace.",
      ],
      unmatchedConditions: [
        "The exact five-cell placement, active cell area, support, lamp geometry, and blocking-diode I-V behavior are not represented by the continuous-skin comparison.",
        "The reported 2-20x cases span different structures, heights, latitudes, seasons, mirror areas, and flat comparator poses.",
        "No source outdoor raw weather and I-V time series is bundled.",
      ],
      simulationResult: "Not run under a complete source-equivalent case; the ordinary Seoul cube result uses a different continuous active area and comparator.",
      judgement: "not-evaluated",
      quantitativeErrorPercent: null,
      confidenceGrade: "not-rated",
      possibleDifferenceCauses: [
        "active-area and denominator mismatch",
        "continuous local-MPP skin versus parallel discrete cells and blocking diodes",
        "different reflector, latitude, season, weather, and flat-panel orientation",
      ],
    },
    limitations: [
      "The 2-20x range is not a target interval and cannot be transferred to the app's six ideal skins.",
      "The source's 1.5-4x statement concerns cell area per generated energy, not a single active-area multiplier.",
      "Paper-specific optical or electrical bookkeeping is not installed as a calibration coefficient.",
    ],
    policy: POLICY,
  },
  "research:C": {
    schemaVersion: 1,
    namespace: "research",
    id: "research:C",
    label: "C",
    doi: "10.1557/mrc.2020.44",
    title: "Nature-inspired spherical silicon solar cell for three-dimensional light harvesting, improved dust and thermal management",
    publisherUrl: CAMBRIDGE_C,
    primarySourceUrls: [DOI_C, CAMBRIDGE_C, CAMBRIDGE_C_PDF],
    geometryClass: "grooved and folded interdigitated-back-contact silicon cell forming a sphere",
    studyModes: ["simulation", "indoor-experiment"],
    comparisonBases: ["same-projected-area", "same-ground-area", "same-active-cell-area"],
    conditions: [
      {
        key: "starting-cell",
        value: "commercial 25 square-inch single-crystal silicon IBC cell; 19% starting efficiency",
        sourceUrl: CAMBRIDGE_C_PDF,
      },
      {
        key: "folding-process",
        value: "138 micrometre-wide grooves; PDMS hard mask and encapsulation",
        note: "The article reports 5.6% silicon-area removal by grooving.",
        sourceUrl: CAMBRIDGE_C_PDF,
      },
      {
        key: "geometry-denominators",
        value: "10.7 cm2 projection, 11.34 cm2 ground/comparator, and 42.8 cm2 spherical surface in the equal-ground thermal comparison",
        note: "Equal projection, equal ground, and similar total surface area are separate comparisons in the article.",
        sourceUrl: CAMBRIDGE_C_PDF,
      },
      {
        key: "illumination",
        value: "AM1.5G at 1000 W/m2 in air at room temperature, with spectral-mismatch correction",
        sourceUrl: CAMBRIDGE_C_PDF,
      },
      {
        key: "no-reflective-background",
        value: "sphere and flat reference measured without a reflective background",
        note: "This is the baseline; no reflector gain is assigned to the spherical geometry.",
        sourceUrl: CAMBRIDGE_C_PDF,
      },
      {
        key: "black-background",
        value: "black paper, approximately 3% diffuse reflectance",
        sourceUrl: CAMBRIDGE_C_PDF,
      },
      {
        key: "white-diffuse-background",
        value: "white paper, approximately 85% diffuse reflectance; reported maximum +39.7% at 2 cm versus equal-ground flat cell",
        note: "The percentage is a source observation, not an executable target.",
        sourceUrl: CAMBRIDGE_C_PDF,
      },
      {
        key: "sand-background",
        value: "sand, approximately 25% diffuse reflectance; reported maximum +14.8% at 2 cm",
        note: "The percentage is a source observation, not an executable target.",
        sourceUrl: CAMBRIDGE_C_PDF,
      },
      {
        key: "aluminium-paper-background",
        value: "aluminium paper, approximately 88% specular reflectance; reported maximum +20.25% at 7 cm",
        note: "Specular aluminium must not be represented as an 0.88 Lambertian ground albedo.",
        sourceUrl: CAMBRIDGE_C_PDF,
      },
      {
        key: "aluminium-cup-background",
        value: "45 degree-sided hexagonal aluminium cup; reported +101% at 1 cm",
        note: "This is reflector/concentrator geometry gain, not pure spherical-shape gain.",
        sourceUrl: CAMBRIDGE_C_PDF,
      },
      {
        key: "angular-test",
        value: "white background at 1 cm; Newport Oriel Class A Sol3A and Keithley 2420-C",
        note: "The 1 cm angular case is distinct from the 2 cm white-background maximum-output case.",
        sourceUrl: CAMBRIDGE_C_PDF,
      },
      {
        key: "thermal-test",
        value: "continuous one-sun exposure; samples about every 1.5 minutes; highest sphere point measured by infrared sensor",
        sourceUrl: CAMBRIDGE_C_PDF,
      },
      {
        key: "thermal-observation",
        value: "measured maxima 41.2 C sphere and 47 C flat; sphere power degradation 5.87% and flat 14.13% from 21 C",
        note: "The source also reports a 10% FEM average-temperature reduction for similar total surface area and a separate equal-ground comparison with much larger spherical area.",
        sourceUrl: CAMBRIDGE_C_PDF,
      },
    ],
    executableCaseId: "white-background-angle-test",
    executableInputs: [
      { key: "geometry.kind", value: "sphere", status: "reported", sourceUrl: CAMBRIDGE_C_PDF },
      { key: "geometry.heightM", value: null, unit: "m", status: "missing", sourceUrl: null },
      { key: "comparison.landAreaM2", value: 0.001134, unit: "m2", status: "reported", sourceUrl: CAMBRIDGE_C_PDF },
      { key: "comparison.projectedAreaM2", value: 0.00107, unit: "m2", status: "reported", sourceUrl: CAMBRIDGE_C_PDF },
      {
        key: "pv.activeAreaM2",
        value: 0.00428,
        unit: "m2",
        status: "reported",
        sourceUrl: CAMBRIDGE_C_PDF,
        note: "Spherical surface in the equal-ground thermal comparison; it is not the flat comparator's active area.",
      },
      { key: "support.footprintM2", value: null, unit: "m2", status: "missing", sourceUrl: null },
      { key: "optics.backgroundReflectance", value: 0.85, status: "reported", sourceUrl: CAMBRIDGE_C_PDF },
      { key: "optics.backgroundScattering", value: "diffuse", status: "reported", sourceUrl: CAMBRIDGE_C_PDF },
      { key: "optics.background", value: "white paper", status: "reported", sourceUrl: CAMBRIDGE_C_PDF },
      { key: "optics.backgroundGapM", value: 0.01, unit: "m", status: "reported", sourceUrl: CAMBRIDGE_C_PDF },
      { key: "optics.groundAlbedo", value: null, status: "missing", sourceUrl: null, note: "Close white paper is not an ordinary infinite ground-albedo input." },
      { key: "irradiance.globalWm2", value: 1000, unit: "W/m2", status: "reported", sourceUrl: CAMBRIDGE_C_PDF },
    ],
    missingInputs: ["geometry.heightM", "support.footprintM2", "optics.groundAlbedo"],
    validationAudit: {
      reportedTrend: "The sphere is angularly insensitive and captures more reflected light for the tested backgrounds; the strongest +101% observation occurs only with the 1 cm aluminium cup, while measured maximum temperature is below the flat comparator.",
      sourceEvidenceGrade: "high",
      matchedConditions: [
        "The selected metadata preserves equal-ground/equal-projection denominators, 1000 W/m2 AM1.5G, white diffuse reflectance, and the 1 cm angular-test gap.",
        "Black, white, sand, aluminium paper, aluminium cup, and no-reflector observations remain separate source conditions.",
      ],
      unmatchedConditions: [
        "The corrugated IBC sphere, etched area, exact diameter, electrical network, lamp geometry, cup geometry, and spectral mismatch are not fully represented.",
        "The app's diffuse ground model is not a substitute for a finite close background or a specular/concentrating cup.",
        "The source thermal comparisons use different area denominators and measurement definitions.",
      ],
      simulationResult: "Not run under a complete source-equivalent case; no general sphere result is labelled as reproducing a reflector or thermal observation.",
      judgement: "not-evaluated",
      quantitativeErrorPercent: null,
      confidenceGrade: "not-rated",
      possibleDifferenceCauses: [
        "finite background/cup geometry and scattering mismatch",
        "active-area, corrugation, and comparator-denominator mismatch",
        "different convection boundary conditions and temperature measurement definitions",
      ],
    },
    limitations: [
      "Reflector-assisted gains are never reported as pure spherical geometry gains.",
      "The equal-ground sphere has substantially more active surface than the flat comparator, so ground- and PV-area-normalized claims must remain separate.",
      "Reported power, dust, and temperature outcomes are observations, not solver targets.",
    ],
    policy: POLICY,
  },
  "research:D": {
    schemaVersion: 1,
    namespace: "research",
    id: "research:D",
    label: "D",
    doi: "10.1002/ese3.1717",
    title: "Harnessing solar power with aesthetic innovation: An in-depth study on spherical and hemispherical photovoltaic configurations",
    publisherUrl: WILEY_D,
    primarySourceUrls: [DOI_D, WILEY_D],
    geometryClass: "rectangular flexible PV modules tiled at 70% coverage on 0.3 m spherical and hemispherical supports",
    studyModes: ["outdoor-experiment"],
    comparisonBases: ["same-active-cell-area", "same-footprint-area", "same-projected-area"],
    conditions: [
      {
        key: "flexible-module",
        value: "Zhuhai Bro Renewable Energy Technology module, 30 x 110 x 2 mm",
        note: "Provider ratings: Pmax 0.1 W, Vmp 1.5 V, Voc 1.65 V, Imp 0.07 A, Isc 0.09 A, and 11% cell efficiency.",
        sourceUrl: WILEY_D,
      },
      { key: "sphere-diameter", value: 0.3, unit: "m", sourceUrl: WILEY_D },
      { key: "module-count", value: "30 modules per hemisphere; 60 modules per full sphere", sourceUrl: WILEY_D },
      {
        key: "active-coverage",
        value: "0.099 m2 module area on a 0.1414 m2 hemisphere; 0.198 m2 on a full sphere; 70% coverage",
        note: "The uncovered 30% and rectangular-module gaps are part of the experimental geometry.",
        sourceUrl: WILEY_D,
      },
      { key: "single-module-iv-condition", value: 890, unit: "W/m2 global solar irradiance", sourceUrl: WILEY_D },
      {
        key: "reported-sphere-hemisphere-trend",
        value: "a single hemisphere produced 32% more energy than the sphere comparison described with a similar number of modules",
        note: "The source attributes the difference to cells facing away from sunlight. The percentage is not a universal efficiency or shape target.",
        sourceUrl: WILEY_D,
      },
      {
        key: "wiring-dependence",
        value: "series and parallel interconnections vary by single/multiple configuration",
        note: "Rear low-light modules and wiring mismatch must be reproduced rather than replaced by a continuous local-MPP skin.",
        sourceUrl: WILEY_D,
      },
      {
        key: "single-hemisphere-projected-footprint",
        value: 0.07,
        unit: "m2",
        note: "The article uses the 0.3 m diameter circular area and excludes its stand in this calculation.",
        sourceUrl: WILEY_D,
      },
      {
        key: "sphere-support-footprint",
        value: "10 x 10 cm wooden support pole",
        note: "The article's sphere land-saving comparison uses support footprint, not the 0.07 m2 spherical horizontal projection.",
        sourceUrl: WILEY_D,
      },
      {
        key: "three-sphere-spacing",
        value: "two centres 40 cm apart; third on a parallel axis 55 cm away and centred between them",
        sourceUrl: WILEY_D,
      },
      {
        key: "hemisphere-spacing",
        value: "two-hemisphere spacing 40 cm; three-hemisphere spacing 30 cm",
        note: "The source reports non-proportional output and attributes it to inter-structure shadowing.",
        sourceUrl: WILEY_D,
      },
      {
        key: "temperature-envelope",
        value: "daylight air temperature about 25-30 C; example two-hemisphere peak module 46.6 C and daily maximum average 38.2 C",
        note: "Temperature observations are configuration- and day-specific.",
        sourceUrl: WILEY_D,
      },
      {
        key: "ground-reflection",
        value: "not specified as a machine-readable albedo input in the article",
        sourceUrl: WILEY_D,
      },
    ],
    executableCaseId: "single-sphere-outdoor-metadata",
    executableInputs: [
      { key: "geometry.kind", value: "sphere", status: "reported", sourceUrl: WILEY_D },
      { key: "geometry.diameterM", value: 0.3, unit: "m", status: "reported", sourceUrl: WILEY_D },
      {
        key: "geometry.heightM",
        value: 0.3,
        unit: "m",
        status: "derived-exact",
        sourceUrl: WILEY_D,
        note: "A full sphere's height equals its reported diameter.",
      },
      {
        key: "comparison.landAreaM2",
        value: Math.PI * 0.15 ** 2,
        unit: "m2",
        status: "derived-exact",
        sourceUrl: WILEY_D,
        note: "Exact swept circular projection derived from the reported 0.3 m diameter; the article rounds this to 0.07 m2. The 0.01 m2 pole support remains a different denominator.",
      },
      { key: "comparison.projectedAreaM2", value: 0.07, unit: "m2", status: "reported", sourceUrl: WILEY_D },
      { key: "pv.activeAreaM2", value: 0.198, unit: "m2", status: "reported", sourceUrl: WILEY_D },
      { key: "pv.moduleCount", value: 60, status: "reported", sourceUrl: WILEY_D },
      { key: "pv.coverageFraction", value: 0.7, status: "reported", sourceUrl: WILEY_D },
      { key: "support.footprintM2", value: 0.01, unit: "m2", status: "derived-exact", sourceUrl: WILEY_D },
      { key: "electrical.wiringTopology", value: null, status: "missing", sourceUrl: null },
      { key: "electrical.rearLowLightBehavior", value: null, status: "missing", sourceUrl: null },
      { key: "optics.groundAlbedo", value: null, status: "missing", sourceUrl: null },
      { key: "optics.background", value: null, status: "missing", sourceUrl: null },
      {
        key: "irradiance.timeSeries",
        value: null,
        status: "missing",
        sourceUrl: null,
        note: "The 890 W/m2 point is a single-module IV condition, not the sphere's daily weather series.",
      },
      { key: "temperature.timeSeries", value: null, status: "missing", sourceUrl: null },
    ],
    missingInputs: [
      "electrical.wiringTopology",
      "electrical.rearLowLightBehavior",
      "optics.groundAlbedo",
      "optics.background",
      "irradiance.timeSeries",
      "temperature.timeSeries",
    ],
    validationAudit: {
      reportedTrend: "The source reports a hemisphere producing 32% more energy than its sphere comparison and links the difference to oppositely oriented low-light modules; multiple structures incur spacing-dependent shadow losses.",
      sourceEvidenceGrade: "high",
      matchedConditions: [
        "The metadata preserves 0.3 m diameter, module counts, 70% coverage, active areas, projected area, and support footprint as separate fields.",
      ],
      unmatchedConditions: [
        "The ordinary ideal sphere/hemisphere skins have 100% continuous coverage and local MPP rather than the source's rectangular modules, gaps, and wiring.",
        "The article's 0.01 m2 support denominator and 0.07 m2 projected footprint cannot be merged into one land-area comparison.",
        "Raw irradiance, module temperature, I-V, albedo, rear low-light response, and full wiring time series are unavailable as executable inputs.",
      ],
      simulationResult: "Not run under a complete source-equivalent case; approximately 32% is not forced and the ordinary sphere/hemisphere ranking is not a reproduction.",
      judgement: "not-evaluated",
      quantitativeErrorPercent: null,
      confidenceGrade: "not-rated",
      possibleDifferenceCauses: [
        "active coverage and PV-area mismatch",
        "series/parallel mismatch from rear low-light modules",
        "self-shading, inter-structure shadows, ground reflection, and temperature differences",
        "support-footprint versus swept-projection denominator",
      ],
    },
    limitations: [
      "The 32% observation is configuration-specific and is never applied as a hemisphere multiplier.",
      "An exact quantitative reproduction requires the authors' time-resolved weather, I-V, wiring, temperature, and albedo data.",
      "The paper's discrete 70%-coverage assemblies are not equivalent to the app's ideal gap-free continuous skins.",
    ],
    policy: POLICY,
  },
} as const satisfies Record<ResearchPresetId, ResearchPreset>;

const FORBIDDEN_EXECUTABLE_KEYS: ReadonlySet<string> = new Set([
  "calibrationFactor",
  "calibrationCoefficient",
  "shapeCorrectionFactor",
  "researchCorrectionFactor",
  "shapeMultiplier",
  "gainMultiplier",
  "powerMultiplier",
  "outputScale",
  "forcedOutput",
  "targetGain",
  "targetPower",
  "reportedOutputTarget",
]);

function containsForbiddenKey(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => (
    FORBIDDEN_EXECUTABLE_KEYS.has(key) || containsForbiddenKey(child)
  ));
}

export function assertResearchPresetInvariant(preset: ResearchPreset): void {
  if (preset.namespace !== "research" || !preset.id.startsWith("research:")) {
    throw new RangeError("Research presets must use the isolated research namespace.");
  }
  if (!preset.primarySourceUrls.includes(`https://doi.org/${preset.doi}`)) {
    throw new RangeError(`${preset.id} must include its canonical DOI resolver URL.`);
  }
  if (preset.primarySourceUrls.some((url) => !url.startsWith("https://"))) {
    throw new RangeError(`${preset.id} contains a non-HTTPS primary-source URL.`);
  }
  if (containsForbiddenKey(preset)) {
    throw new RangeError(`${preset.id} contains a forbidden calibration, multiplier, or output target.`);
  }
  if (
    preset.policy.application !== "explicit-research-run-only" ||
    preset.policy.forbiddenTransformations.join("\u0000") !== POLICY.forbiddenTransformations.join("\u0000")
  ) {
    throw new RangeError(`${preset.id} must retain the research-only no-calibration policy.`);
  }
  const sourceUrls: readonly string[] = preset.primarySourceUrls;
  if (preset.conditions.some((condition) => !sourceUrls.includes(condition.sourceUrl))) {
    throw new RangeError(`${preset.id} contains a condition without a primary-source URL.`);
  }
  const keys = preset.executableInputs.map((input) => input.key);
  if (new Set(keys).size !== keys.length) {
    throw new RangeError(`${preset.id} contains duplicate executable input keys.`);
  }
  for (const input of preset.executableInputs) {
    const missing = input.value === null;
    if (
      (missing && (input.status !== "missing" || input.sourceUrl !== null)) ||
      (!missing && (input.status === "missing" || input.sourceUrl === null))
    ) {
      throw new RangeError(`${preset.id}.${input.key} has inconsistent source/missing state.`);
    }
    if (input.sourceUrl !== null && !sourceUrls.includes(input.sourceUrl)) {
      throw new RangeError(`${preset.id}.${input.key} cites a URL outside primarySourceUrls.`);
    }
  }
  const nullKeys = preset.executableInputs
    .filter((input) => input.value === null)
    .map((input) => input.key);
  if (nullKeys.join("\u0000") !== [...preset.missingInputs].join("\u0000")) {
    throw new RangeError(`${preset.id} missingInputs must exactly match null executable inputs.`);
  }
  if (
    preset.validationAudit.matchedConditions.length === 0 ||
    preset.validationAudit.unmatchedConditions.length === 0 ||
    preset.validationAudit.possibleDifferenceCauses.length === 0
  ) {
    throw new RangeError(`${preset.id} must disclose matched, unmatched, and possible difference causes.`);
  }
  if (
    preset.validationAudit.judgement === "not-evaluated" &&
    (preset.validationAudit.quantitativeErrorPercent !== null || preset.validationAudit.confidenceGrade !== "not-rated")
  ) {
    throw new RangeError(`${preset.id} cannot report an error or confidence grade before evaluation.`);
  }
}

Object.values(presets).forEach((preset) => assertResearchPresetInvariant(preset));

export const RESEARCH_PRESETS: DeepReadonly<typeof presets> = deepFreeze(presets);
export const RESEARCH_PRESET_A = RESEARCH_PRESETS["research:A"];
export const RESEARCH_PRESET_B = RESEARCH_PRESETS["research:B"];
export const RESEARCH_PRESET_C = RESEARCH_PRESETS["research:C"];
export const RESEARCH_PRESET_D = RESEARCH_PRESETS["research:D"];

const RESEARCH_PRESET_ID_SET: ReadonlySet<string> = new Set(RESEARCH_PRESET_IDS);

export function isResearchPresetId(value: unknown): value is ResearchPresetId {
  return typeof value === "string" && RESEARCH_PRESET_ID_SET.has(value);
}

export function getResearchPreset(id: ResearchPresetId): DeepReadonly<ResearchPreset> {
  if (!isResearchPresetId(id)) throw new RangeError(`Unknown research preset: ${String(id)}`);
  return RESEARCH_PRESETS[id];
}

export function listResearchPresets(): readonly DeepReadonly<ResearchPreset>[] {
  return RESEARCH_PRESET_IDS.map((id) => RESEARCH_PRESETS[id]);
}

export interface ResearchInputApplication {
  readonly namespace: "research";
  readonly presetId: ResearchPresetId;
  readonly caseId: string;
  /** Full source contract, including explicit nulls that require user input. */
  readonly executableInputs: readonly DeepReadonly<ResearchExecutableInput>[];
  /** Exact non-null source inputs only. */
  readonly appliedInputs: readonly DeepReadonly<ResearchExecutableInput>[];
  readonly missingInputs: readonly string[];
}

export interface GeneralPresetSelection {
  readonly namespace: "general";
  readonly presetId: PresetName;
  /** Always null so a general selection cannot retain research-only state. */
  readonly researchApplication: null;
}

export interface ResearchPresetSelection {
  readonly namespace: "research";
  readonly presetId: ResearchPresetId;
  readonly researchApplication: DeepReadonly<ResearchInputApplication>;
}

export type IsolatedPresetSelection = GeneralPresetSelection | ResearchPresetSelection;

export function createResearchInputApplication(id: ResearchPresetId): DeepReadonly<ResearchInputApplication> {
  const preset = getResearchPreset(id);
  return deepFreeze({
    namespace: "research",
    presetId: preset.id,
    caseId: preset.executableCaseId,
    executableInputs: preset.executableInputs,
    appliedInputs: preset.executableInputs.filter((input) => input.value !== null),
    missingInputs: [...preset.missingInputs],
  });
}

export function selectResearchPreset(id: ResearchPresetId): DeepReadonly<ResearchPresetSelection> {
  return deepFreeze({
    namespace: "research",
    presetId: id,
    researchApplication: createResearchInputApplication(id),
  });
}

const GENERAL_PRESET_ID_SET: ReadonlySet<string> = new Set([
  "cube",
  "plane",
  "cylinder",
  "sphere",
  "hemisphere",
  "cone",
  "free",
]);

export function selectGeneralPreset(id: PresetName): DeepReadonly<GeneralPresetSelection> {
  if (!GENERAL_PRESET_ID_SET.has(id)) throw new RangeError(`Unknown general preset: ${String(id)}`);
  return deepFreeze({ namespace: "general", presetId: id, researchApplication: null });
}

/** Compile-time proof that research IDs cannot enter the ordinary geometry preset union. */
export type ResearchGeneralPresetOverlap = Extract<ResearchPresetId, PresetName>;
