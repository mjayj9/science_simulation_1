import { clamp, type Vec3 } from "./types";
import { magnitude, rotateAroundY, subtract } from "./vector";
import type { IdealSurfaceModel } from "../geometry";
import type { WeatherPoint } from "../weather";
import { calculatePOA, type IAMConfig } from "./irradiance";
import { calculateInverter, type InverterConfig } from "./inverter";
import { solarPosition, sunVector } from "./solar";

const STEFAN_BOLTZMANN_W_M2_K4 = 5.670_374_419e-8;

export type ThermalCorrelationShape =
  | "plane"
  | "cube"
  | "cylinder"
  | "sphere"
  | "hemisphere"
  | "cone"
  | "rotating-disk";

export interface AirProperties {
  thermalConductivityWmK: number;
  kinematicViscosityM2s: number;
  prandtl: number;
  /** Whitaker's optional surface/free-stream viscosity correction. */
  viscosityRatio?: number;
}

export const DEFAULT_AIR_PROPERTIES: Readonly<AirProperties> = Object.freeze({
  thermalConductivityWmK: 0.0263,
  kinematicViscosityM2s: 15.89e-6,
  prandtl: 0.707,
  viscosityRatio: 1,
});

export interface ConvectionCorrelationResult {
  shape: ThermalCorrelationShape;
  correlation:
    | "churchill-bernstein-cylinder"
    | "whitaker-sphere"
    | "mixed-flat-plate"
    | "whitaker-hemisphere-approximation"
    | "flat-plate-cone-approximation"
    | "cati-laminar-rotating-disk";
  reynolds: number;
  nusselt: number;
  coefficientWm2K: number;
  applicability: "direct" | "geometry-approximation";
  sourceUrl: string;
}

export interface MaterialThermalNode {
  id: string;
  areaM2: number;
  /** Position and normal in the rotating material/body coordinate system. */
  bodyPositionM: Vec3;
  bodyNormal: Vec3;
  characteristicLengthM: number;
  shape: ThermalCorrelationShape;
  temperatureC: number;
}

export interface MaterialThermalEdge {
  firstNodeId: string;
  secondNodeId: string;
  /** Symmetric physical conductance. Pair heat is equal and opposite. */
  conductanceWPerK: number;
}

export interface MaterialThermalEnvironment {
  ambientTemperatureC: number;
  effectiveSkyTemperatureC: number;
  windVelocityMS: Vec3;
  angularVelocityRadS: number;
  /** World-Y phase at the beginning of this integration interval. */
  rotationAngleRad: number;
}

export interface MaterialThermalFlux {
  absorbedSolarWm2: number;
  electricalPowerWm2: number;
}

export interface MaterialThermalConfig {
  arealHeatCapacityJm2K: number;
  emissivity: number;
  /** Back-side convection relative to the correlation evaluated at the node. */
  backConvectionFactor: number;
  /** Natural/mixed-convection floor, independent of RPM. */
  minimumConvectionWm2K: number;
  maximumSubstepSeconds: number;
  minimumTemperatureC: number;
  maximumTemperatureC: number;
  air: AirProperties;
}

export const DEFAULT_TRANSIENT_THERMAL_CONFIG: Readonly<MaterialThermalConfig> = Object.freeze({
  // A configurable engineering assumption for a laminated PV skin; it is not
  // a shape multiplier and should be replaced by measured laminate data.
  arealHeatCapacityJm2K: 11_000,
  emissivity: 0.84,
  backConvectionFactor: 0.65,
  minimumConvectionWm2K: 2.8,
  maximumSubstepSeconds: 10,
  minimumTemperatureC: -80,
  maximumTemperatureC: 180,
  air: DEFAULT_AIR_PROPERTIES,
});

export interface MaterialPose {
  positionM: Vec3;
  normal: Vec3;
}

export interface MaterialThermalForcingContext {
  elapsedSeconds: number;
  node: Readonly<MaterialThermalNode>;
  pose: MaterialPose;
  environment: Readonly<MaterialThermalEnvironment>;
  relativeWindSpeedMS: number;
  convection: ConvectionCorrelationResult;
}

export interface MaterialThermalStepInput {
  nodes: readonly MaterialThermalNode[];
  edges?: readonly MaterialThermalEdge[];
  durationSeconds: number;
  environment: MaterialThermalEnvironment;
  fluxAt: (context: MaterialThermalForcingContext) => MaterialThermalFlux;
  /**
   * Called once after every internal thermal substep. Powers are the exact
   * area-integrals of the node fluxes evaluated for that substep. This keeps
   * downstream electrical conversion synchronized with the thermal clock
   * without feeding inverter losses back into the PV laminate heat balance.
   */
  onSubstep?: (summary: Readonly<MaterialThermalSubstepSummary>) => void;
  config?: Partial<Omit<MaterialThermalConfig, "air">> & { air?: Partial<AirProperties> };
}

export interface MaterialThermalSubstepSummary {
  elapsedSeconds: number;
  durationSeconds: number;
  absorbedSolarPowerW: number;
  dcElectricalPowerW: number;
}

export interface MaterialThermalNodeBalance {
  id: string;
  temperatureC: number;
  averageAbsorbedSolarWm2: number;
  averageElectricalPowerWm2: number;
  averageConvectionLossWm2: number;
  averageRadiationLossWm2: number;
  averageConductionWm2: number;
  averageRelativeWindSpeedMS: number;
  averageFrontConvectionWm2K: number;
  averageBackConvectionWm2K: number;
}

export interface MaterialThermalStepResult {
  nodes: MaterialThermalNode[];
  balances: MaterialThermalNodeBalance[];
  substeps: number;
  storedEnergyChangeJ: number;
  netBoundaryEnergyJ: number;
  conductionCancellationJ: number;
  energyResidualJ: number;
}

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number.`);
  }
  return value;
}

function nonnegativeFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a nonnegative finite number.`);
  }
  return value;
}

function normalizedConfig(
  patch: MaterialThermalStepInput["config"],
): MaterialThermalConfig {
  const config = {
    ...DEFAULT_TRANSIENT_THERMAL_CONFIG,
    ...patch,
    air: { ...DEFAULT_AIR_PROPERTIES, ...patch?.air },
  };
  positiveFinite(config.arealHeatCapacityJm2K, "Areal heat capacity");
  if (!Number.isFinite(config.emissivity) || config.emissivity < 0 || config.emissivity > 1) {
    throw new RangeError("Emissivity must be between zero and one.");
  }
  nonnegativeFinite(config.backConvectionFactor, "Back convection factor");
  nonnegativeFinite(config.minimumConvectionWm2K, "Minimum convection coefficient");
  positiveFinite(config.maximumSubstepSeconds, "Maximum thermal substep");
  if (!(config.maximumTemperatureC > config.minimumTemperatureC)) {
    throw new RangeError("Maximum temperature must exceed minimum temperature.");
  }
  positiveFinite(config.air.thermalConductivityWmK, "Air thermal conductivity");
  positiveFinite(config.air.kinematicViscosityM2s, "Air kinematic viscosity");
  positiveFinite(config.air.prandtl, "Air Prandtl number");
  positiveFinite(config.air.viscosityRatio ?? 1, "Air viscosity ratio");
  return config;
}

export function materialPoseAtWorldYPhase(
  node: Pick<MaterialThermalNode, "bodyPositionM" | "bodyNormal">,
  phaseRad: number,
): MaterialPose {
  if (!Number.isFinite(phaseRad)) throw new RangeError("Material phase must be finite.");
  return {
    positionM: rotateAroundY(node.bodyPositionM, phaseRad),
    normal: rotateAroundY(node.bodyNormal, phaseRad),
  };
}

/** |u_wind - omega x r| for a world +Y angular-velocity vector. */
export function relativeSurfaceWindSpeedMS(
  windVelocityMS: Vec3,
  angularVelocityRadS: number,
  worldPositionM: Vec3,
): number {
  if (!Number.isFinite(angularVelocityRadS)) throw new RangeError("Angular velocity must be finite.");
  const surfaceVelocityMS: Vec3 = {
    x: angularVelocityRadS * worldPositionM.z,
    y: 0,
    z: -angularVelocityRadS * worldPositionM.x,
  };
  return magnitude(subtract(windVelocityMS, surfaceVelocityMS));
}

/**
 * Shape-aware external forced-convection correlation. Rotation enters only
 * through the resolved relative speed; there is no RPM cooling multiplier.
 */
export function externalConvectionCoefficient(
  shape: ThermalCorrelationShape,
  relativeSpeedMS: number,
  characteristicLengthM: number,
  air: AirProperties = DEFAULT_AIR_PROPERTIES,
): ConvectionCorrelationResult {
  const speed = nonnegativeFinite(relativeSpeedMS, "Relative air speed");
  const length = positiveFinite(characteristicLengthM, "Characteristic length");
  const conductivity = positiveFinite(air.thermalConductivityWmK, "Air thermal conductivity");
  const viscosity = positiveFinite(air.kinematicViscosityM2s, "Air kinematic viscosity");
  const prandtl = positiveFinite(air.prandtl, "Air Prandtl number");
  const reynolds = speed * length / viscosity;
  let nusselt: number;
  let correlation: ConvectionCorrelationResult["correlation"];
  let applicability: ConvectionCorrelationResult["applicability"] = "direct";
  let sourceUrl: string;

  if (shape === "rotating-disk") {
    nusselt = 0.36 * Math.sqrt(reynolds);
    correlation = "cati-laminar-rotating-disk";
    sourceUrl = "https://doi.org/10.3390/fluids9070167";
  } else if (shape === "cylinder") {
    const first = 0.62 * Math.sqrt(reynolds) * Math.cbrt(prandtl)
      / Math.pow(1 + Math.pow(0.4 / prandtl, 2 / 3), 1 / 4);
    const highRe = Math.pow(1 + Math.pow(reynolds / 282_000, 5 / 8), 4 / 5);
    nusselt = 0.3 + first * highRe;
    correlation = "churchill-bernstein-cylinder";
    sourceUrl = "https://doi.org/10.1115/1.3450685";
  } else if (shape === "sphere" || shape === "hemisphere") {
    nusselt = 2 + (
      0.4 * Math.sqrt(reynolds) + 0.06 * Math.pow(reynolds, 2 / 3)
    ) * Math.pow(prandtl, 0.4) * Math.pow(air.viscosityRatio ?? 1, 1 / 4);
    correlation = shape === "sphere"
      ? "whitaker-sphere"
      : "whitaker-hemisphere-approximation";
    applicability = shape === "sphere" ? "direct" : "geometry-approximation";
    sourceUrl = "https://doi.org/10.1002/aic.690180219";
  } else {
    const laminar = 0.664 * Math.sqrt(reynolds) * Math.cbrt(prandtl);
    const mixed = (0.037 * Math.pow(reynolds, 0.8) - 871) * Math.cbrt(prandtl);
    nusselt = reynolds <= 500_000 ? laminar : Math.max(laminar, mixed);
    correlation = shape === "cone"
      ? "flat-plate-cone-approximation"
      : "mixed-flat-plate";
    applicability = shape === "cone" ? "geometry-approximation" : "direct";
    sourceUrl = "https://doi.org/10.1002/aic.690220207";
  }

  nusselt = Math.max(0, nusselt);
  return {
    shape,
    correlation,
    reynolds,
    nusselt,
    coefficientWm2K: nusselt * conductivity / length,
    applicability,
    sourceUrl,
  };
}

export function temperatureAdjustedEfficiency(
  referenceEfficiency: number,
  gammaPerC: number,
  temperatureC: number,
  referenceTemperatureC = 25,
): number {
  if (![referenceEfficiency, gammaPerC, temperatureC, referenceTemperatureC].every(Number.isFinite)) {
    throw new RangeError("PV efficiency inputs must be finite.");
  }
  return clamp(
    referenceEfficiency * (1 + gammaPerC * (temperatureC - referenceTemperatureC)),
    0,
    1,
  );
}

function validateTopology(
  nodes: readonly MaterialThermalNode[],
  edges: readonly MaterialThermalEdge[],
): Map<string, number> {
  if (nodes.length === 0) throw new RangeError("At least one thermal material node is required.");
  const indexById = new Map<string, number>();
  nodes.forEach((node, index) => {
    if (!node.id.trim() || indexById.has(node.id)) throw new TypeError("Thermal node IDs must be nonempty and unique.");
    indexById.set(node.id, index);
    positiveFinite(node.areaM2, `${node.id} area`);
    positiveFinite(node.characteristicLengthM, `${node.id} characteristic length`);
    if (!Number.isFinite(node.temperatureC)) throw new RangeError(`${node.id} temperature must be finite.`);
  });
  edges.forEach((edge) => {
    if (edge.firstNodeId === edge.secondNodeId) throw new TypeError("A conduction edge cannot connect a node to itself.");
    if (!indexById.has(edge.firstNodeId) || !indexById.has(edge.secondNodeId)) {
      throw new TypeError("Every conduction edge must reference two existing nodes.");
    }
    nonnegativeFinite(edge.conductanceWPerK, "Conduction edge conductance");
  });
  return indexById;
}

function stableSubstepSeconds(
  nodes: readonly MaterialThermalNode[],
  edges: readonly MaterialThermalEdge[],
  indexById: ReadonlyMap<string, number>,
  config: MaterialThermalConfig,
): number {
  const conductanceByNode = Array(nodes.length).fill(0) as number[];
  edges.forEach((edge) => {
    const first = indexById.get(edge.firstNodeId)!;
    const second = indexById.get(edge.secondNodeId)!;
    conductanceByNode[first] += edge.conductanceWPerK;
    conductanceByNode[second] += edge.conductanceWPerK;
  });
  let stable = config.maximumSubstepSeconds;
  nodes.forEach((node, index) => {
    if (conductanceByNode[index] > 0) {
      const capacitanceJK = config.arealHeatCapacityJm2K * node.areaM2;
      stable = Math.min(stable, 0.25 * capacitanceJK / conductanceByNode[index]);
    }
  });
  return Math.max(1e-6, stable);
}

export function advanceMaterialThermalState(
  input: MaterialThermalStepInput,
): MaterialThermalStepResult {
  const durationSeconds = nonnegativeFinite(input.durationSeconds, "Thermal interval duration");
  const edges = input.edges ?? [];
  const config = normalizedConfig(input.config);
  const indexById = validateTopology(input.nodes, edges);
  const environment = input.environment;
  if (![environment.ambientTemperatureC, environment.effectiveSkyTemperatureC,
    environment.angularVelocityRadS, environment.rotationAngleRad].every(Number.isFinite)) {
    throw new RangeError("Thermal environment values must be finite.");
  }
  const nodes = input.nodes.map((node) => ({ ...node }));
  if (durationSeconds === 0) {
    return {
      nodes,
      balances: nodes.map((node) => ({
        id: node.id,
        temperatureC: node.temperatureC,
        averageAbsorbedSolarWm2: 0,
        averageElectricalPowerWm2: 0,
        averageConvectionLossWm2: 0,
        averageRadiationLossWm2: 0,
        averageConductionWm2: 0,
        averageRelativeWindSpeedMS: 0,
        averageFrontConvectionWm2K: 0,
        averageBackConvectionWm2K: 0,
      })),
      substeps: 0,
      storedEnergyChangeJ: 0,
      netBoundaryEnergyJ: 0,
      conductionCancellationJ: 0,
      energyResidualJ: 0,
    };
  }

  const initialTemperatures = nodes.map((node) => node.temperatureC);
  const maxDt = stableSubstepSeconds(nodes, edges, indexById, config);
  const substeps = Math.max(1, Math.ceil(durationSeconds / maxDt));
  const dt = durationSeconds / substeps;
  const sums = nodes.map(() => ({
    absorbed: 0,
    electrical: 0,
    convection: 0,
    radiation: 0,
    conduction: 0,
    relativeWind: 0,
    hFront: 0,
    hBack: 0,
  }));
  let netBoundaryEnergyJ = 0;
  let conductionCancellationJ = 0;

  for (let step = 0; step < substeps; step += 1) {
    const elapsedSeconds = (step + 0.5) * dt;
    const phase = environment.rotationAngleRad + environment.angularVelocityRadS * elapsedSeconds;
    const conductionW = Array(nodes.length).fill(0) as number[];
    edges.forEach((edge) => {
      const firstIndex = indexById.get(edge.firstNodeId)!;
      const secondIndex = indexById.get(edge.secondNodeId)!;
      const heatIntoFirstW = edge.conductanceWPerK
        * (nodes[secondIndex].temperatureC - nodes[firstIndex].temperatureC);
      conductionW[firstIndex] += heatIntoFirstW;
      conductionW[secondIndex] -= heatIntoFirstW;
    });
    conductionCancellationJ += conductionW.reduce((sum, value) => sum + value, 0) * dt;

    let substepAbsorbedSolarPowerW = 0;
    let substepDcElectricalPowerW = 0;
    const nextTemperatures = nodes.map((node, index) => {
      const pose = materialPoseAtWorldYPhase(node, phase);
      const relativeWindSpeedMS = relativeSurfaceWindSpeedMS(
        environment.windVelocityMS,
        environment.angularVelocityRadS,
        pose.positionM,
      );
      const convection = externalConvectionCoefficient(
        node.shape,
        relativeWindSpeedMS,
        node.characteristicLengthM,
        config.air,
      );
      const frontH = Math.max(config.minimumConvectionWm2K, convection.coefficientWm2K);
      const backH = frontH * config.backConvectionFactor;
      const flux = input.fluxAt({
        elapsedSeconds,
        node,
        pose,
        environment,
        relativeWindSpeedMS,
        convection,
      });
      const absorbed = nonnegativeFinite(flux.absorbedSolarWm2, `${node.id} absorbed solar flux`);
      const electrical = nonnegativeFinite(flux.electricalPowerWm2, `${node.id} electrical flux`);
      if (electrical > absorbed + 1e-9) {
        throw new RangeError(`${node.id} electrical extraction cannot exceed absorbed solar flux.`);
      }
      const convectionLoss = (frontH + backH) * (node.temperatureC - environment.ambientTemperatureC);
      const temperatureK = node.temperatureC + 273.15;
      const skyK = environment.effectiveSkyTemperatureC + 273.15;
      if (!(temperatureK > 0) || !(skyK > 0)) throw new RangeError("Absolute thermal temperatures must be positive.");
      const radiationLoss = config.emissivity * STEFAN_BOLTZMANN_W_M2_K4
        * (temperatureK ** 4 - skyK ** 4);
      const conduction = conductionW[index] / node.areaM2;
      const netFluxWm2 = absorbed - electrical - convectionLoss - radiationLoss + conduction;
      const nextTemperature = node.temperatureC
        + netFluxWm2 * dt / config.arealHeatCapacityJm2K;
      if (
        !Number.isFinite(nextTemperature)
        || nextTemperature < config.minimumTemperatureC
        || nextTemperature > config.maximumTemperatureC
      ) {
        throw new RangeError(`${node.id} temperature left the configured physical range.`);
      }
      sums[index].absorbed += absorbed * dt;
      sums[index].electrical += electrical * dt;
      sums[index].convection += convectionLoss * dt;
      sums[index].radiation += radiationLoss * dt;
      sums[index].conduction += conduction * dt;
      sums[index].relativeWind += relativeWindSpeedMS * dt;
      sums[index].hFront += frontH * dt;
      sums[index].hBack += backH * dt;
      substepAbsorbedSolarPowerW += absorbed * node.areaM2;
      substepDcElectricalPowerW += electrical * node.areaM2;
      netBoundaryEnergyJ += (
        absorbed - electrical - convectionLoss - radiationLoss
      ) * node.areaM2 * dt;
      return nextTemperature;
    });
    input.onSubstep?.({
      elapsedSeconds,
      durationSeconds: dt,
      absorbedSolarPowerW: substepAbsorbedSolarPowerW,
      dcElectricalPowerW: substepDcElectricalPowerW,
    });
    nextTemperatures.forEach((temperatureC, index) => {
      nodes[index].temperatureC = temperatureC;
    });
  }

  const storedEnergyChangeJ = nodes.reduce((sum, node, index) => sum
    + (node.temperatureC - initialTemperatures[index])
      * config.arealHeatCapacityJm2K * node.areaM2, 0);
  return {
    nodes,
    balances: nodes.map((node, index) => ({
      id: node.id,
      temperatureC: node.temperatureC,
      averageAbsorbedSolarWm2: sums[index].absorbed / durationSeconds,
      averageElectricalPowerWm2: sums[index].electrical / durationSeconds,
      averageConvectionLossWm2: sums[index].convection / durationSeconds,
      averageRadiationLossWm2: sums[index].radiation / durationSeconds,
      averageConductionWm2: sums[index].conduction / durationSeconds,
      averageRelativeWindSpeedMS: sums[index].relativeWind / durationSeconds,
      averageFrontConvectionWm2K: sums[index].hFront / durationSeconds,
      averageBackConvectionWm2K: sums[index].hBack / durationSeconds,
    })),
    substeps,
    storedEnergyChangeJ,
    netBoundaryEnergyJ,
    conductionCancellationJ,
    energyResidualJ: storedEnergyChangeJ - netBoundaryEnergyJ,
  };
}

export interface ThermalHistoryFrame {
  timeSeconds: number;
  averageTemperatureC: number;
  maximumTemperatureC: number;
  minimumTemperatureC: number;
  standardDeviationC: number;
  temperaturesCByNode: Record<string, number>;
}

export interface ThermalHistorySummary {
  averageTemperatureC: number;
  maximumTemperatureC: number;
  maximumStandardDeviationC: number;
  hoursAboveThreshold: number;
  hotspotPersistenceHours: number;
}

export interface MaterialNodeSet {
  nodes: MaterialThermalNode[];
  edges: MaterialThermalEdge[];
  /** Explicit audit note when no in-plane conduction graph is supplied. */
  conductionAssumption: "adiabatic-between-quadrature-nodes";
}

/**
 * Converts numerical surface quadrature into persistent material coordinates.
 * Samples are thermal integration nodes, never PV modules or panel counts.
 */
export function createMaterialThermalNodes(
  surface: IdealSurfaceModel,
  initialTemperatureC: number,
): MaterialNodeSet {
  if (!Number.isFinite(initialTemperatureC)) throw new RangeError("Initial material temperature must be finite.");
  const fallbackLength = Math.max(
    1e-4,
    surface.dimensions.radiusM
      ?? surface.dimensions.widthM
      ?? surface.dimensions.depthM
      ?? Math.sqrt(surface.dimensions.activeAreaM2),
  );
  const shape: ThermalCorrelationShape = surface.kind;
  const nodes = surface.zones.flatMap((zone) => zone.samples.map((sample, index) => ({
    id: `${zone.id}:${index}`,
    areaM2: sample.areaM2,
    bodyPositionM: { x: sample.position[0], y: sample.position[1], z: sample.position[2] },
    bodyNormal: { x: sample.normal[0], y: sample.normal[1], z: sample.normal[2] },
    characteristicLengthM: fallbackLength,
    shape,
    temperatureC: initialTemperatureC,
  })));
  const area = nodes.reduce((sum, node) => sum + node.areaM2, 0);
  if (Math.abs(area - surface.dimensions.activeAreaM2) > Math.max(1e-10, area * 1e-8)) {
    throw new RangeError("Thermal material-node area does not close to the analytic PV skin area.");
  }
  return {
    nodes,
    edges: [],
    conductionAssumption: "adiabatic-between-quadrature-nodes",
  };
}

export interface TransientSurfaceLocation {
  latitudeDeg: number;
  longitudeDeg: number;
  elevationM?: number;
}

export interface TransientSurfaceHistoryInput {
  surface: IdealSurfaceModel;
  weather: readonly WeatherPoint[];
  location: TransientSurfaceLocation;
  rpm: number;
  /** Optional counterfactual optical-body RPM; defaults to `rpm`. */
  opticalRpm?: number;
  /** Optional counterfactual material/convection RPM; defaults to `rpm`. */
  convectionRpm?: number;
  initialPhaseRad?: number;
  referenceEfficiency: number;
  gammaPerC: number;
  referenceTemperatureC?: number;
  absorptivity?: number;
  soilingLossFraction?: number;
  albedo?: number;
  iam?: IAMConfig;
  diffuseModel?: "hay-davies" | "isotropic";
  initialTemperatureC?: number;
  effectiveSkyTemperatureOffsetC?: number;
  /**
   * PVWatts-style inverter configuration. Omit for DEFAULT_INVERTER; false is
   * an explicit unity-efficiency DC=AC bypass for component-isolation runs.
   */
  inverter?: InverterConfig | false;
  config?: MaterialThermalStepInput["config"];
}

export interface TransientSurfaceHistoryResult {
  frames: ThermalHistoryFrame[];
  summary: ThermalHistorySummary;
  /** Temperature-adjusted PV-terminal DC energy extracted from the laminate. */
  dcElectricalEnergyWh: number;
  /**
   * @deprecated Backward-compatible alias of dcElectricalEnergyWh. It is not
   * inverter AC energy; consumers should migrate to the explicit fields.
   */
  electricalEnergyWh: number;
  /** Net inverter AC energy, or DC energy when inverter:false is requested. */
  acEnergyWh: number;
  /** DC minus AC, including wiring, conversion, cutoff and clipping losses. */
  inverterLossWh: number;
  absorbedSolarEnergyWh: number;
  energyResidualJ: number;
  conductionAssumption: MaterialNodeSet["conductionAssumption"];
}

export interface RotationEffectDecompositionResult {
  /** E00: static optical pose and static convection/material pose. */
  staticFull: TransientSurfaceHistoryResult;
  /** E10: rotating optical pose with the static thermal/convection kinematics. */
  rotatingOpticalOnly: TransientSurfaceHistoryResult;
  /** E01: static optical pose with rotating material/convection kinematics. */
  rotatingThermalOnly: TransientSurfaceHistoryResult;
  /** E11: rotating optical and rotating material/convection kinematics. */
  rotatingFull: TransientSurfaceHistoryResult;
  acEnergyDeltasWh: {
    opticalOnly: number;
    thermalOnly: number;
    interaction: number;
    net: number;
  };
  temperatureDeltas: {
    averageC: number;
    maximumC: number;
    maximumStandardDeviationC: number;
    hotspotPersistenceHours: number;
  };
}

/**
 * Runs one persistent material-node history over an observed/modelled weather
 * clock. The same body point sees the time-varying rotated normal and
 * |u_wind - omega x r|. This path is intended for representative-day thermal
 * analysis; the annual worker retains its separately labelled steady model.
 */
export function simulateTransientSurfaceHistory(
  input: TransientSurfaceHistoryInput,
): TransientSurfaceHistoryResult {
  if (input.weather.length < 2) throw new RangeError("Transient history requires at least two weather points.");
  if (![input.rpm, input.opticalRpm ?? input.rpm, input.convectionRpm ?? input.rpm,
    input.referenceEfficiency, input.gammaPerC].every(Number.isFinite)) {
    throw new RangeError("Transient rotation and electrical inputs must be finite.");
  }
  for (let index = 1; index < input.weather.length; index += 1) {
    if (!(input.weather[index].timeUtcMs > input.weather[index - 1].timeUtcMs)) {
      throw new RangeError("Transient weather timestamps must be strictly increasing.");
    }
  }
  const absorptivity = clamp(input.absorptivity ?? 0.9, 0, 1);
  const soilingFactor = 1 - clamp(input.soilingLossFraction ?? 0, 0, 1);
  const albedo = clamp(input.albedo ?? 0.2, 0, 1);
  const opticalOmega = (input.opticalRpm ?? input.rpm) * 2 * Math.PI / 60;
  const convectionOmega = (input.convectionRpm ?? input.rpm) * 2 * Math.PI / 60;
  const firstWeather = input.weather[0];
  const material = createMaterialThermalNodes(
    input.surface,
    input.initialTemperatureC ?? firstWeather.ambientC,
  );
  let nodes = material.nodes;
  const frames: ThermalHistoryFrame[] = [thermalHistoryFrame(0, nodes)];
  let dcElectricalEnergyWh = 0;
  let acEnergyWh = 0;
  let inverterLossWh = 0;
  let absorbedSolarEnergyWh = 0;
  let energyResidualJ = 0;
  const referenceTimeMs = firstWeather.timeUtcMs;

  for (let index = 1; index < input.weather.length; index += 1) {
    const left = input.weather[index - 1];
    const right = input.weather[index];
    const durationSeconds = (right.timeUtcMs - left.timeUtcMs) / 1_000;
    const midpointTimeMs = (left.timeUtcMs + right.timeUtcMs) / 2;
    const mean = (a: number, b: number) => (a + b) / 2;
    const weather = {
      ghiWm2: mean(left.ghiWm2, right.ghiWm2),
      dniWm2: mean(left.dniWm2, right.dniWm2),
      dhiWm2: mean(left.dhiWm2, right.dhiWm2),
      ambientC: mean(left.ambientC, right.ambientC),
    };
    const solar = solarPosition({ timestamp: midpointTimeMs, ...input.location, temperatureC: weather.ambientC });
    const solarVector = sunVector(solar);
    const windVector = (point: WeatherPoint): Vec3 => {
      const directionRad = point.windDirectionDeg * Math.PI / 180;
      // Meteorological direction is where wind comes from; velocity points away.
      return {
        x: -point.windSpeedMs * Math.sin(directionRad),
        y: 0,
        z: -point.windSpeedMs * Math.cos(directionRad),
      };
    };
    const leftWind = windVector(left);
    const rightWind = windVector(right);
    const windVelocityMS: Vec3 = {
      x: mean(leftWind.x, rightWind.x),
      y: 0,
      z: mean(leftWind.z, rightWind.z),
    };
    const step = advanceMaterialThermalState({
      nodes,
      edges: material.edges,
      durationSeconds,
      environment: {
        ambientTemperatureC: weather.ambientC,
        effectiveSkyTemperatureC: weather.ambientC + (input.effectiveSkyTemperatureOffsetC ?? -6),
        windVelocityMS,
        angularVelocityRadS: convectionOmega,
        rotationAngleRad: (input.initialPhaseRad ?? 0) + convectionOmega * (left.timeUtcMs - referenceTimeMs) / 1_000,
      },
      config: input.config,
      onSubstep: ({
        durationSeconds: substepSeconds,
        absorbedSolarPowerW,
        dcElectricalPowerW,
      }) => {
        const acPowerW = input.inverter === false
          ? dcElectricalPowerW
          : calculateInverter({
              dcPowerW: dcElectricalPowerW,
              ...(input.inverter === undefined ? {} : { config: input.inverter }),
            }).acPowerW;
        const durationHours = substepSeconds / 3_600;
        dcElectricalEnergyWh += dcElectricalPowerW * durationHours;
        acEnergyWh += acPowerW * durationHours;
        inverterLossWh += Math.max(0, dcElectricalPowerW - acPowerW) * durationHours;
        absorbedSolarEnergyWh += absorbedSolarPowerW * durationHours;
      },
      fluxAt: ({ elapsedSeconds, node }) => {
        const absoluteElapsedSeconds = (left.timeUtcMs - referenceTimeMs) / 1_000 + elapsedSeconds;
        const opticalPose = materialPoseAtWorldYPhase(
          node,
          (input.initialPhaseRad ?? 0) + opticalOmega * absoluteElapsedSeconds,
        );
        const poa = solar.elevationDeg > 0
          ? calculatePOA({
              ghiWm2: weather.ghiWm2,
              dniWm2: weather.dniWm2,
              dhiWm2: weather.dhiWm2,
              solarZenithDeg: 90 - solar.elevationDeg,
              sunDirection: solarVector,
              panelNormal: opticalPose.normal,
              albedo,
              iam: input.iam ?? { model: "ashrae", b0: 0.05 },
              diffuseModel: input.diffuseModel ?? "hay-davies",
            }).totalWm2
          : 0;
        const effectivePoaWm2 = poa * soilingFactor;
        const absorbedSolarWm2 = absorptivity * effectivePoaWm2;
        const electricalPowerWm2 = Math.min(
          absorbedSolarWm2,
          effectivePoaWm2 * temperatureAdjustedEfficiency(
            input.referenceEfficiency,
            input.gammaPerC,
            node.temperatureC,
            input.referenceTemperatureC ?? 25,
          ),
        );
        return { absorbedSolarWm2, electricalPowerWm2 };
      },
    });
    nodes = step.nodes;
    energyResidualJ += step.energyResidualJ;
    frames.push(thermalHistoryFrame((right.timeUtcMs - referenceTimeMs) / 1_000, nodes));
  }
  return {
    frames,
    summary: summarizeThermalHistory(frames),
    dcElectricalEnergyWh,
    electricalEnergyWh: dcElectricalEnergyWh,
    acEnergyWh,
    inverterLossWh,
    absorbedSolarEnergyWh,
    energyResidualJ,
    conductionAssumption: material.conductionAssumption,
  };
}

/**
 * A 2×2 counterfactual decomposition of rotation. E10 changes only the
 * material normal used by POA, E01 changes only material/convection kinematics,
 * and E11 changes both. The interaction term closes the exact factorial energy
 * identity; it must not be hidden inside either main effect.
 */
export function simulateRotationEffectDecomposition(
  input: TransientSurfaceHistoryInput,
): RotationEffectDecompositionResult {
  const targetRpm = input.rpm;
  const run = (opticalRpm: number, convectionRpm: number) => simulateTransientSurfaceHistory({
    ...input,
    opticalRpm,
    convectionRpm,
  });
  const staticFull = run(0, 0);
  const rotatingOpticalOnly = run(targetRpm, 0);
  const rotatingThermalOnly = run(0, targetRpm);
  const rotatingFull = run(targetRpm, targetRpm);
  const e00 = staticFull.acEnergyWh;
  const e10 = rotatingOpticalOnly.acEnergyWh;
  const e01 = rotatingThermalOnly.acEnergyWh;
  const e11 = rotatingFull.acEnergyWh;
  return {
    staticFull,
    rotatingOpticalOnly,
    rotatingThermalOnly,
    rotatingFull,
    acEnergyDeltasWh: {
      opticalOnly: e10 - e00,
      thermalOnly: e01 - e00,
      interaction: e11 - e10 - e01 + e00,
      net: e11 - e00,
    },
    temperatureDeltas: {
      averageC: rotatingFull.summary.averageTemperatureC - staticFull.summary.averageTemperatureC,
      maximumC: rotatingFull.summary.maximumTemperatureC - staticFull.summary.maximumTemperatureC,
      maximumStandardDeviationC: rotatingFull.summary.maximumStandardDeviationC
        - staticFull.summary.maximumStandardDeviationC,
      hotspotPersistenceHours: rotatingFull.summary.hotspotPersistenceHours
        - staticFull.summary.hotspotPersistenceHours,
    },
  };
}

export function thermalHistoryFrame(
  timeSeconds: number,
  nodes: readonly MaterialThermalNode[],
): ThermalHistoryFrame {
  if (!Number.isFinite(timeSeconds) || nodes.length === 0) throw new RangeError("A finite time and nodes are required.");
  const area = nodes.reduce((sum, node) => sum + positiveFinite(node.areaM2, `${node.id} area`), 0);
  const average = nodes.reduce((sum, node) => sum + node.temperatureC * node.areaM2, 0) / area;
  const variance = nodes.reduce((sum, node) => sum
    + (node.temperatureC - average) ** 2 * node.areaM2, 0) / area;
  return {
    timeSeconds,
    averageTemperatureC: average,
    maximumTemperatureC: Math.max(...nodes.map((node) => node.temperatureC)),
    minimumTemperatureC: Math.min(...nodes.map((node) => node.temperatureC)),
    standardDeviationC: Math.sqrt(Math.max(0, variance)),
    temperaturesCByNode: Object.fromEntries(nodes.map((node) => [node.id, node.temperatureC])),
  };
}

export function summarizeThermalHistory(
  frames: readonly ThermalHistoryFrame[],
  thresholdC = 45,
): ThermalHistorySummary {
  if (frames.length === 0 || !Number.isFinite(thresholdC)) throw new RangeError("Thermal history and threshold are required.");
  for (let index = 1; index < frames.length; index += 1) {
    if (!(frames[index].timeSeconds > frames[index - 1].timeSeconds)) {
      throw new RangeError("Thermal history times must be strictly increasing.");
    }
  }
  let averageIntegral = 0;
  let duration = 0;
  let aboveSeconds = 0;
  let longestAboveSeconds = 0;
  let currentAboveSeconds = 0;
  for (let index = 1; index < frames.length; index += 1) {
    const left = frames[index - 1];
    const right = frames[index];
    const dt = right.timeSeconds - left.timeSeconds;
    duration += dt;
    averageIntegral += (left.averageTemperatureC + right.averageTemperatureC) / 2 * dt;
    const intervalAbove = left.maximumTemperatureC > thresholdC && right.maximumTemperatureC > thresholdC;
    if (intervalAbove) {
      aboveSeconds += dt;
      currentAboveSeconds += dt;
      longestAboveSeconds = Math.max(longestAboveSeconds, currentAboveSeconds);
    } else {
      currentAboveSeconds = 0;
    }
  }
  return {
    averageTemperatureC: duration > 0 ? averageIntegral / duration : frames[0].averageTemperatureC,
    maximumTemperatureC: Math.max(...frames.map((frame) => frame.maximumTemperatureC)),
    maximumStandardDeviationC: Math.max(...frames.map((frame) => frame.standardDeviationC)),
    hoursAboveThreshold: aboveSeconds / 3600,
    hotspotPersistenceHours: longestAboveSeconds / 3600,
  };
}
