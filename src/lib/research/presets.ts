import type { PresetName } from "../geometry";

export const RESEARCH_PRESET_IDS = ["research:A", "research:B", "research:C"] as const;

export type ResearchPresetId = typeof RESEARCH_PRESET_IDS[number];
export type ResearchStudyMode = "simulation" | "indoor-experiment" | "outdoor-experiment";
export type ResearchComparisonBasis =
  | "same-footprint-area"
  | "same-ground-area"
  | "same-projected-area"
  | "same-active-cell-area";

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

export interface ResearchPreset {
  readonly schemaVersion: 1;
  readonly namespace: "research";
  readonly id: ResearchPresetId;
  readonly label: "A" | "B" | "C";
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

const DOI_A = "https://doi.org/10.1039/C2EE21170J";
const RSC_A = "https://pubs.rsc.org/en/content/articlelanding/2012/ee/c2ee21170j";
const RSC_A_SUPPLEMENT = "https://www.rsc.org/suppdata/ee/c2/c2ee21170j/c2ee21170j.pdf";
const DOI_B = "https://doi.org/10.1557/mrc.2020.44";
const CAMBRIDGE_B = "https://www.cambridge.org/core/journals/mrs-communications/article/natureinspired-spherical-silicon-solar-cell-for-three-dimensional-light-harvesting-improved-dust-and-thermal-management/0EE382BEDC3D233365B27E4C3777FDC4";
const DOI_C = "https://doi.org/10.1002/ese3.1717";
const WILEY_C = "https://scijournals.onlinelibrary.wiley.com/doi/full/10.1002/ese3.1717";

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
    doi: "10.1039/C2EE21170J",
    title: "Solar energy generation in three dimensions",
    publisherUrl: RSC_A,
    primarySourceUrls: [DOI_A, RSC_A, RSC_A_SUPPLEMENT],
    geometryClass: "arbitrary assemblies of flat silicon panels, including a cube",
    studyModes: ["simulation", "indoor-experiment", "outdoor-experiment"],
    comparisonBases: ["same-footprint-area", "same-active-cell-area"],
    conditions: [
      {
        key: "cell-model-and-size",
        value: "Solarbotics SCC3733 monocrystalline silicon; 37 x 33",
        unit: "mm",
        note: "The supplement reports nominal Voc 6.7 V, Isc 20 mA, and independently verified AM1.5 conversion efficiency of 10%.",
        sourceUrl: RSC_A_SUPPLEMENT,
      },
      {
        key: "cell-cover-optics",
        value: "1 mm epoxy cover, refractive index 1.6, approximately 14% normal-incidence reflectivity",
        sourceUrl: RSC_A_SUPPLEMENT,
      },
      {
        key: "indoor-illumination",
        value: "1300 W xenon arc lamp with global AM1.5 filter, calibrated irradiance 1000",
        unit: "W/m2",
        sourceUrl: RSC_A_SUPPLEMENT,
      },
      {
        key: "indoor-comparator-geometry",
        value: "35 mm cube versus a 33 x 37 mm flat cell",
        note: "This is the paper's indoor geometry; footprint and active-cell area are distinct denominators.",
        sourceUrl: RSC_A_SUPPLEMENT,
      },
      {
        key: "outdoor-site-and-period",
        value: "MIT building 13 roof, Cambridge, Massachusetts; June through December 2011",
        sourceUrl: RSC_A_SUPPLEMENT,
      },
      {
        key: "outdoor-acquisition",
        value: "Simultaneous 3D structures and flat reference; current-voltage sweeps every 12-15 minutes",
        sourceUrl: RSC_A_SUPPLEMENT,
      },
      {
        key: "numerical-quadrature",
        value: 10_000,
        unit: "surface grid points per cell",
        note: "The supplement says optimization used a coarser 100-point grid, followed by 10,000-point evaluation.",
        sourceUrl: RSC_A_SUPPLEMENT,
      },
      {
        key: "solar-and-weather-envelope",
        value: "Reda solar-position trajectory with empirical air-mass correction; clear-weather interpretation",
        note: "Dispersion and weather corrections were not included in the cited simulation.",
        sourceUrl: RSC_A_SUPPLEMENT,
      },
    ],
    executableCaseId: "indoor-cube-validation",
    executableInputs: [
      { key: "geometry.kind", value: "cube", status: "reported", sourceUrl: RSC_A_SUPPLEMENT },
      { key: "geometry.heightM", value: 0.035, unit: "m", status: "reported", sourceUrl: RSC_A_SUPPLEMENT },
      {
        key: "comparison.landAreaM2",
        value: 0.001225,
        unit: "m2",
        status: "derived-exact",
        sourceUrl: RSC_A_SUPPLEMENT,
        note: "Exact 0.035 m x 0.035 m cube-base area; no output was fitted to obtain it.",
      },
      { key: "comparison.projectedAreaM2", value: null, unit: "m2", status: "missing", sourceUrl: null },
      { key: "pv.activeAreaM2", value: null, unit: "m2", status: "missing", sourceUrl: null },
      { key: "support.footprintM2", value: null, unit: "m2", status: "missing", sourceUrl: null },
      { key: "optics.groundAlbedo", value: null, status: "missing", sourceUrl: null },
      { key: "optics.background", value: null, status: "missing", sourceUrl: null },
      { key: "irradiance.globalWm2", value: 1000, unit: "W/m2", status: "reported", sourceUrl: RSC_A_SUPPLEMENT },
      { key: "pv.cellNormalReflectivity", value: 0.14, status: "reported", sourceUrl: RSC_A_SUPPLEMENT },
    ],
    missingInputs: [
      "comparison.projectedAreaM2",
      "pv.activeAreaM2",
      "support.footprintM2",
      "optics.groundAlbedo",
      "optics.background",
    ],
    limitations: [
      "The cited simulation does not model measured cloud/weather time series or spectral dispersion.",
      "Reported energy gains depend on footprint, PV material area, latitude, season, and comparator; they are not transferable output targets.",
      "The paper-specific optical bookkeeping is not installed as a calibration coefficient in the production model.",
    ],
    policy: POLICY,
  },
  "research:B": {
    schemaVersion: 1,
    namespace: "research",
    id: "research:B",
    label: "B",
    doi: "10.1557/mrc.2020.44",
    title: "Nature-inspired spherical silicon solar cell for three-dimensional light harvesting, improved dust and thermal management",
    publisherUrl: CAMBRIDGE_B,
    primarySourceUrls: [DOI_B, CAMBRIDGE_B],
    geometryClass: "grooved and folded interdigitated-back-contact silicon cell forming a sphere",
    studyModes: ["simulation", "indoor-experiment"],
    comparisonBases: ["same-projected-area", "same-ground-area"],
    conditions: [
      {
        key: "starting-cell",
        value: "commercial 25 square-inch single-crystal silicon interdigitated-back-contact cell",
        note: "The article reports 19% starting efficiency.",
        sourceUrl: CAMBRIDGE_B,
      },
      {
        key: "folding-process",
        value: "138 micrometre-wide grooves; PDMS hard mask and encapsulation",
        note: "The article reports 5.6% silicon-area removal by grooving.",
        sourceUrl: CAMBRIDGE_B,
      },
      {
        key: "geometry-denominators",
        value: "10.7 cm2 projection area and 11.34 cm2 ground/comparator area",
        note: "Do not substitute equal active-cell area: the thermal model reports 42.8 cm2 spherical versus 11.34 cm2 flat surface area at equal ground area.",
        sourceUrl: CAMBRIDGE_B,
      },
      {
        key: "illumination",
        value: "AM1.5G at 1000 W/m2 in air at room temperature, with spectral-mismatch correction",
        sourceUrl: CAMBRIDGE_B,
      },
      {
        key: "electrical-instrumentation",
        value: "Newport Oriel Class A Sol3A solar simulator and Keithley 2420-C source meter",
        sourceUrl: CAMBRIDGE_B,
      },
      {
        key: "backgrounds",
        value: "black, white, sand, and aluminium backgrounds",
        note: "Reported reflectance was approximately 3% diffuse black, 85% white, 25% sand, and 88% specular aluminium.",
        sourceUrl: CAMBRIDGE_B,
      },
      {
        key: "background-distance-sweep",
        value: [0, 10],
        unit: "cm",
        note: "The source varies sphere/background height across this interval; angular tests use white background at 1 cm.",
        sourceUrl: CAMBRIDGE_B,
      },
      {
        key: "thermal-test",
        value: "continuous one-sun exposure; temperature samples approximately every 1.5 minutes",
        sourceUrl: CAMBRIDGE_B,
      },
    ],
    executableCaseId: "white-background-angle-test",
    executableInputs: [
      { key: "geometry.kind", value: "sphere", status: "reported", sourceUrl: CAMBRIDGE_B },
      { key: "geometry.heightM", value: null, unit: "m", status: "missing", sourceUrl: null },
      { key: "comparison.landAreaM2", value: 0.001134, unit: "m2", status: "reported", sourceUrl: CAMBRIDGE_B },
      { key: "comparison.projectedAreaM2", value: 0.00107, unit: "m2", status: "reported", sourceUrl: CAMBRIDGE_B },
      {
        key: "pv.activeAreaM2",
        value: 0.00428,
        unit: "m2",
        status: "reported",
        sourceUrl: CAMBRIDGE_B,
        note: "Spherical surface used in the equal-ground-area thermal comparison, not a flat equal-cell-area denominator.",
      },
      { key: "support.footprintM2", value: null, unit: "m2", status: "missing", sourceUrl: null },
      { key: "optics.groundAlbedo", value: 0.85, status: "reported", sourceUrl: CAMBRIDGE_B },
      { key: "optics.background", value: "white diffuse paper", status: "reported", sourceUrl: CAMBRIDGE_B },
      { key: "optics.backgroundGapM", value: 0.01, unit: "m", status: "reported", sourceUrl: CAMBRIDGE_B },
      { key: "irradiance.globalWm2", value: 1000, unit: "W/m2", status: "reported", sourceUrl: CAMBRIDGE_B },
    ],
    missingInputs: ["geometry.heightM", "support.footprintM2"],
    limitations: [
      "The sphere and flat reference do not have equal active silicon area, so area-normalized and ground-area-normalized claims must remain separate.",
      "Background reflectance and sphere height are experimental inputs, not universal albedo defaults.",
      "Reported power, dust, and temperature outcomes are validation observations, not solver targets.",
    ],
    policy: POLICY,
  },
  "research:C": {
    schemaVersion: 1,
    namespace: "research",
    id: "research:C",
    label: "C",
    doi: "10.1002/ese3.1717",
    title: "Harnessing solar power with aesthetic innovation: An in-depth study on spherical and hemispherical photovoltaic configurations",
    publisherUrl: WILEY_C,
    primarySourceUrls: [DOI_C, WILEY_C],
    geometryClass: "flexible rectangular PV modules tiled on 0.3 m spherical and hemispherical supports",
    studyModes: ["outdoor-experiment"],
    comparisonBases: ["same-active-cell-area", "same-footprint-area"],
    conditions: [
      {
        key: "flexible-module",
        value: "Zhuhai Bro Renewable Energy Technology flexible module, 30 x 110 x 2 mm",
        note: "Provider ratings in the article are Pmax 0.1 W, Vmp 1.5 V, Voc 1.65 V, Imp 0.07 A, Isc 0.09 A, and 11% cell efficiency.",
        sourceUrl: WILEY_C,
      },
      {
        key: "sphere-diameter",
        value: 0.3,
        unit: "m",
        sourceUrl: WILEY_C,
      },
      {
        key: "module-count",
        value: "30 modules per hemisphere; 60 modules per sphere",
        sourceUrl: WILEY_C,
      },
      {
        key: "active-coverage",
        value: "0.099 m2 module area on a 0.1414 m2 hemisphere (70% coverage); 0.198 m2 on a full sphere",
        sourceUrl: WILEY_C,
      },
      {
        key: "single-module-iv-condition",
        value: 890,
        unit: "W/m2 global solar irradiance",
        sourceUrl: WILEY_C,
      },
      {
        key: "three-sphere-spacing",
        value: "two sphere centres 40 cm apart on one axis; third on a parallel axis 55 cm away and centred between them",
        sourceUrl: WILEY_C,
      },
      {
        key: "hemisphere-spacing",
        value: "two-hemisphere spacing 40 cm; three-hemisphere spacing 30 cm",
        sourceUrl: WILEY_C,
      },
      {
        key: "sphere-support-footprint",
        value: "10 x 10 cm wooden support pole",
        note: "Footprint comparisons in the paper use the support footprint, whereas cell-area comparisons use 0.198 m2 of flexible modules.",
        sourceUrl: WILEY_C,
      },
    ],
    executableCaseId: "single-sphere-outdoor",
    executableInputs: [
      { key: "geometry.kind", value: "sphere", status: "reported", sourceUrl: WILEY_C },
      { key: "geometry.diameterM", value: 0.3, unit: "m", status: "reported", sourceUrl: WILEY_C },
      {
        key: "geometry.heightM",
        value: 0.3,
        unit: "m",
        status: "derived-exact",
        sourceUrl: WILEY_C,
        note: "A sphere's height equals its reported diameter.",
      },
      {
        key: "comparison.landAreaM2",
        value: 0.01,
        unit: "m2",
        status: "derived-exact",
        sourceUrl: WILEY_C,
        note: "The paper's land-use comparison uses the 0.10 m x 0.10 m wooden support, not the swept spherical projection.",
      },
      { key: "comparison.projectedAreaM2", value: 0.07, unit: "m2", status: "reported", sourceUrl: WILEY_C },
      { key: "pv.activeAreaM2", value: 0.198, unit: "m2", status: "reported", sourceUrl: WILEY_C },
      { key: "pv.moduleCount", value: 60, status: "reported", sourceUrl: WILEY_C },
      { key: "pv.coverageFraction", value: 0.7, status: "reported", sourceUrl: WILEY_C },
      { key: "support.footprintM2", value: 0.01, unit: "m2", status: "derived-exact", sourceUrl: WILEY_C },
      { key: "optics.groundAlbedo", value: null, status: "missing", sourceUrl: null },
      { key: "optics.background", value: null, status: "missing", sourceUrl: null },
      {
        key: "irradiance.timeSeries",
        value: null,
        status: "missing",
        sourceUrl: null,
        note: "The 890 W/m2 condition is a single-module IV point, not the sphere's daily weather series.",
      },
    ],
    missingInputs: ["optics.groundAlbedo", "optics.background", "irradiance.timeSeries"],
    limitations: [
      "Rectangular-module packing leaves 30% of the ideal spherical surface inactive and must be represented geometrically.",
      "Equal-cell-area capacity and support-footprint comparisons are different experiments and cannot share a denominator.",
      "The publisher article does not provide a machine-readable raw weather/IV time series; exact time-series replication needs the authors' data.",
      "The reported spherical/hemispherical gains are not applied as shape multipliers.",
    ],
    policy: POLICY,
  },
} as const satisfies Record<ResearchPresetId, ResearchPreset>;

const FORBIDDEN_EXECUTABLE_KEYS: ReadonlySet<string> = new Set([
  "calibrationFactor",
  "calibrationCoefficient",
  "shapeMultiplier",
  "powerMultiplier",
  "forcedOutput",
  "targetGain",
  "targetPower",
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
  }
  const nullKeys = preset.executableInputs
    .filter((input) => input.value === null)
    .map((input) => input.key);
  if (nullKeys.join("\u0000") !== [...preset.missingInputs].join("\u0000")) {
    throw new RangeError(`${preset.id} missingInputs must exactly match null executable inputs.`);
  }
}

Object.values(presets).forEach((preset) => assertResearchPresetInvariant(preset));

export const RESEARCH_PRESETS: DeepReadonly<typeof presets> = deepFreeze(presets);
export const RESEARCH_PRESET_A = RESEARCH_PRESETS["research:A"];
export const RESEARCH_PRESET_B = RESEARCH_PRESETS["research:B"];
export const RESEARCH_PRESET_C = RESEARCH_PRESETS["research:C"];

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
