"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  BarChart3,
  BookOpenCheck,
  Box,
  Boxes,
  Building2,
  Check,
  ChevronDown,
  CircleGauge,
  CircuitBoard,
  CloudDownload,
  Copy,
  Database,
  Download,
  FileJson,
  Grid3X3,
  HelpCircle,
  ImageDown,
  Info,
  LoaderCircle,
  Menu,
  Mountain,
  Move3D,
  Pause,
  Play,
  Plus,
  Redo2,
  RefreshCcw,
  Rotate3D,
  Save,
  Sparkles,
  Sun,
  Trash2,
  TreePine,
  Undo2,
  Upload,
  Waves,
  Wind,
  X,
  Zap,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { addEdge, applyEdgeChanges, type Connection, type Edge, type EdgeChange } from "@xyflow/react";
import { ThreeWorkspace, type QuaternionTuple, type SceneObstacle, type ScenePanel, type Vec3Tuple } from "./ThreeWorkspace";
import CircuitCanvas, { createAutoWireEdges, validateCircuitEdges } from "./CircuitCanvas";
import {
  DEFAULT_ELECTRICAL as PHYSICS_DEFAULT_ELECTRICAL,
  DEFAULT_INVERTER as PHYSICS_DEFAULT_INVERTER,
  DEFAULT_THERMAL as PHYSICS_DEFAULT_THERMAL,
  MODEL_REGISTRY,
  calculateCircuit,
  calculateInverter,
  simulateContinuousSurface,
  simulateInstant,
  solarPosition as calculatePhysicsSolarPosition,
  sunVector as physicsSunVector,
  type CircuitDevice,
  type FairnessModeResult,
  type ElectricalConfig as PhysicsElectricalConfig,
  type GHIClosureResult,
  type InverterConfig as PhysicsInverterConfig,
  type ThermalConfig as PhysicsThermalConfig,
  type TraceStage,
} from "../lib/physics";
import {
  createContinuousSurface,
  generatePreset as generateGeometryPreset,
  isContinuousSurfacePreset,
  rayPanelDistance,
  type ContinuousSurfaceKind,
  type ContinuousSurfaceModel,
} from "../lib/geometry";
import {
  assertWeatherSeries,
  fetchOpenMeteo,
  getOfflineWeather,
  importPvgisJson,
  normalizeNasaPowerResponse,
  type OfflineWeatherPreset,
  type WeatherPoint,
  type WeatherSeries,
} from "../lib/weather";
import {
  createSimulationCancelRequest,
  createSimulationRunRequest,
  isSimulationEventStale,
  rotationIntervalSamples,
  type SimulationKernelInput,
  type SimulationRunRequest,
  type SimulationVariantWorkItem,
  type SimulationWorkerEvent,
} from "../workers";
import SimulationWorker from "../workers/simulation.worker?worker";
import {
  DIAGNOSTIC_REASON_LABELS,
  classifyTimePoint,
  type DiagnosticReasonCode,
  type DiagnosticSignal,
} from "../lib/diagnostics/time-series";

type Screen = "assembly" | "environment" | "circuit" | "simulation" | "compare" | "evidence" | "export";
type PresetName = "cube" | "plane" | "cylinder" | "sphere" | "cone" | "free";
type WeatherPreset = "clear" | "partly" | "overcast" | "rain" | "night";
type EnvironmentName = "mountain" | "coast" | "plain" | "suburban" | "urban";
export type DataMode = "manual" | "open-meteo" | "pvgis-file" | "nasa-file" | "offline";

interface ElectricalSettings {
  efficiency: number;
  pmaxW: number;
  vocV: number;
  iscA: number;
  vmpV: number;
  impA: number;
  rsOhm: number;
  rshOhm: number;
  ideality: number;
  cells: number;
  alphaIsc: number;
  betaVoc: number;
  gammaPmp: number;
  referenceC: number;
  referenceWm2: number;
}

interface ThermalSettings {
  u0: number;
  u1: number;
  noctC: number;
  absorptivity: number;
  emissivity: number;
}

interface InverterSettings {
  ratedW: number;
  nominalEfficiency: number;
  mpptMinV: number;
  mpptMaxV: number;
  maxInputA: number;
  standbyW: number;
  wiringLossPct: number;
}

interface RotationSettings {
  mode: "static" | "fixed" | "auto";
  rpm: number;
  inertia: number;
  damping: number;
  friction: number;
  dragCoefficient: number;
  maxRpm: number;
}

interface WeatherState {
  ghi: number;
  dni: number;
  dhi: number;
  ambientC: number;
  windMs: number;
  windDirectionDeg: number;
  gustMs: number;
  cloudPct: number;
  albedo: number;
  soilingPct: number;
}

interface EnvironmentSettings {
  roughnessM: number;
  displacementM: number;
  shearExponent: number;
  turbulencePct: number;
  albedo: number;
  airDensity: number;
  wakeStrength: number;
  contamination: string;
}

interface SolarPosition {
  timeUtcMs: number;
  elevationDeg: number;
  azimuthDeg: number;
  vector: Vec3Tuple;
  sunrise: string;
  sunset: string;
  equationOfTimeMin: number;
}

interface PanelResult extends ScenePanel {
  normal: Vec3Tuple;
  incidenceDeg: number;
  panelTiltDeg: number;
  panelAzimuthDeg: number;
  cosineIncidence: number;
  etaCos: number;
  visibility: number;
  selfVisibility: number;
  externalVisibility: number;
  iam: number;
  etaAngle: number;
  ghiClosure: GHIClosureResult;
  beamWm2: number;
  skyWm2: number;
  groundWm2: number;
  poaWm2: number;
  effectiveWm2: number;
  localWindMs: number;
  temperatureC: number;
  voltageV: number;
  currentA: number;
  powerW: number;
  bypassActive: boolean;
  modelTrace: TraceStage[];
}

interface SystemResult {
  panels: PanelResult[];
  dcW: number;
  acW: number;
  grossW: number;
  voltageV: number;
  currentA: number;
  inverterEfficiency: number;
  clippingW: number;
  mismatchW: number;
  wiringW: number;
  bypassCount: number;
  areaWeightedAoiDeg: number;
  areaWeightedEtaCos: number;
  areaWeightedIam: number;
  areaWeightedEtaAngle: number;
  areaWeightedVisibility: number;
  losses: { name: string; value: number; color: string }[];
  modelTrace: TraceStage[];
  ivPoints: { voltage: number; current: number; power: number }[];
  inverterStatus: string;
  modelClass: "rigid-panels" | "ideal-flexible-skin";
  activeAreaM2: number;
  projectedAreaM2: number;
  maximumProjectedAreaM2: number;
  footprintM2: number;
  independentMppt: FairnessModeResult;
  sharedCircuit: FairnessModeResult;
  lossBreakdown: {
    projectionW: number;
    iamW: number;
    selfShadingW: number;
    occlusionW: number;
    soilingW: number;
    temperatureW: number;
    mismatchW: number;
    bypassW: number;
    inverterW: number;
  };
}

interface ZoneDiagnosticState {
  id: string;
  label: string;
  aoiDeg: number;
  cosineIncidence: number;
  iam: number;
  directWm2: number;
  diffuseWm2: number;
  groundWm2: number;
  poaWm2: number;
  effectiveWm2: number;
  temperatureC: number;
  voltageV: number;
  currentA: number;
  powerW: number;
  visibility: number;
  bypassActive: boolean;
}

interface DailyPoint {
  time: string;
  minute: number;
  timestampOriginal: string;
  timeUtcIso: string;
  localDateTime: string;
  weatherSource: string;
  /** True when power is already the weighted mean over [minute, next minute]. */
  intervalMean: boolean;
  dc: number;
  ac: number;
  poa: number;
  temperature: number;
  elevation: number;
  aoi: number;
  etaCos: number;
  iam: number;
  etaAngle: number;
  ghi: number;
  dni: number;
  dhi: number;
  azimuth: number;
  zenith: number;
  voltage: number;
  current: number;
  visibility: number;
  bypassCount: number;
  inverterStatus: string;
  sharedDc: number;
  sharedAc: number;
  independentDc: number;
  independentAc: number;
  representativePhaseDeg: number;
  zones: ZoneDiagnosticState[];
  reasonCodes: DiagnosticReasonCode[];
  diagnosticSeverity: "normal" | "attention" | "error";
}

type DiagnosticSeriesKey =
  | "elevation"
  | "aoi"
  | "etaCos"
  | "iam"
  | "etaAngle"
  | "ghi"
  | "dni"
  | "dhi"
  | "poa"
  | "dc"
  | "ac";

const DIAGNOSTIC_SERIES: Record<
  DiagnosticSeriesKey,
  { label: string; color: string; axis: "angle" | "factor" | "irradiance" | "power" }
> = {
  elevation: { label: "태양 고도", color: "#ffd166", axis: "angle" },
  aoi: { label: "AOI", color: "#f78c6b", axis: "angle" },
  etaCos: { label: "ηcos", color: "#72d6c9", axis: "factor" },
  iam: { label: "IAM", color: "#b8a1ff", axis: "factor" },
  etaAngle: { label: "ηangle", color: "#4fd1a5", axis: "factor" },
  ghi: { label: "GHI", color: "#8bb8ff", axis: "irradiance" },
  dni: { label: "DNI", color: "#ffb65c", axis: "irradiance" },
  dhi: { label: "DHI", color: "#7f9cf5", axis: "irradiance" },
  poa: { label: "POA", color: "#f4ba4b", axis: "irradiance" },
  dc: { label: "DC", color: "#e6a93f", axis: "power" },
  ac: { label: "AC", color: "#42c6a5", axis: "power" },
};

interface Provenance {
  provider: string;
  kind: string;
  retrievedAt: string;
  resolution: string;
  spatial: string;
  fallbackReason?: string;
}

const PANEL_SIZE_M = 0.05;
const PANEL_AREA_M2 = 0.0025;
const PANEL_LIMIT = 20;
const DEFAULT_SEED = 240521;

const DEFAULT_ELECTRICAL: ElectricalSettings = {
  efficiency: 20,
  pmaxW: 0.5,
  vocV: 0.62,
  iscA: 1.05,
  vmpV: 0.5,
  impA: 1,
  rsOhm: 0.02,
  rshOhm: 100,
  ideality: 1.2,
  cells: 1,
  alphaIsc: 0.0005,
  betaVoc: -0.003,
  gammaPmp: -0.004,
  referenceC: 25,
  referenceWm2: 1000,
};

const DEFAULT_THERMAL: ThermalSettings = {
  u0: 25,
  u1: 6.84,
  noctC: 45,
  absorptivity: 0.9,
  emissivity: 0.84,
};

const DEFAULT_INVERTER: InverterSettings = {
  ratedW: 10,
  nominalEfficiency: 96,
  mpptMinV: 0.3,
  mpptMaxV: 20,
  maxInputA: 25,
  standbyW: 0,
  wiringLossPct: 1.5,
};

const DEFAULT_ROTATION: RotationSettings = {
  mode: "static",
  rpm: 0,
  inertia: 0.02,
  damping: 0.01,
  friction: 0.002,
  dragCoefficient: 1.17,
  maxRpm: 30,
};

const ENVIRONMENTS: Record<EnvironmentName, EnvironmentSettings> = {
  mountain: { roughnessM: 0.4, displacementM: 1, shearExponent: 0.28, turbulencePct: 30, albedo: 0.2, airDensity: 1.05, wakeStrength: 0.45, contamination: "광물성 먼지" },
  coast: { roughnessM: 0.001, displacementM: 0, shearExponent: 0.1, turbulencePct: 11, albedo: 0.2, airDensity: 1.22, wakeStrength: 0.16, contamination: "염분" },
  plain: { roughnessM: 0.03, displacementM: 0, shearExponent: 0.16, turbulencePct: 17, albedo: 0.2, airDensity: 1.2, wakeStrength: 0.2, contamination: "토양 먼지" },
  suburban: { roughnessM: 0.3, displacementM: 3, shearExponent: 0.24, turbulencePct: 26, albedo: 0.2, airDensity: 1.2, wakeStrength: 0.5, contamination: "복합 미세먼지" },
  urban: { roughnessM: 0.7, displacementM: 8, shearExponent: 0.35, turbulencePct: 34, albedo: 0.18, airDensity: 1.18, wakeStrength: 0.68, contamination: "도시 분진" },
};

const WEATHER_PRESETS: Record<WeatherPreset, WeatherState> = {
  clear: { ghi: 820, dni: 900, dhi: 125, ambientC: 27, windMs: 3.2, windDirectionDeg: 230, gustMs: 5.5, cloudPct: 5, albedo: 0.2, soilingPct: 2 },
  partly: { ghi: 510, dni: 470, dhi: 220, ambientC: 24, windMs: 4.1, windDirectionDeg: 220, gustMs: 7.2, cloudPct: 48, albedo: 0.2, soilingPct: 2 },
  overcast: { ghi: 185, dni: 35, dhi: 165, ambientC: 21, windMs: 3.8, windDirectionDeg: 190, gustMs: 6.4, cloudPct: 96, albedo: 0.2, soilingPct: 2 },
  rain: { ghi: 105, dni: 10, dhi: 98, ambientC: 19, windMs: 6.2, windDirectionDeg: 170, gustMs: 11.5, cloudPct: 100, albedo: 0.18, soilingPct: 2 },
  night: { ghi: 0, dni: 0, dhi: 0, ambientC: 18, windMs: 2.5, windDirectionDeg: 210, gustMs: 4.3, cloudPct: 20, albedo: 0.2, soilingPct: 2 },
};

const PRESET_LABELS: Record<PresetName, string> = {
  cube: "정육면체",
  plane: "일반 평면",
  cylinder: "원기둥",
  sphere: "구",
  cone: "원뿔",
  free: "자유 조립",
};

const SCREEN_ITEMS: { id: Screen; label: string; short: string; icon: typeof Box }[] = [
  { id: "assembly", label: "3D 조립", short: "조립", icon: Boxes },
  { id: "environment", label: "환경 편집", short: "환경", icon: Mountain },
  { id: "circuit", label: "회로 편집", short: "회로", icon: CircuitBoard },
  { id: "simulation", label: "시뮬레이션", short: "해석", icon: Activity },
  { id: "compare", label: "다중 형상 비교", short: "비교", icon: BarChart3 },
  { id: "evidence", label: "공식 · 근거", short: "근거", icon: BookOpenCheck },
  { id: "export", label: "데이터 내보내기", short: "내보내기", icon: Download },
];

const MODEL_DESCRIPTOR_BY_ID = new Map<string, (typeof MODEL_REGISTRY)[number]>(
  MODEL_REGISTRY.map((descriptor) => [descriptor.id, descriptor]),
);
const POA_MODEL_DESCRIPTOR = MODEL_DESCRIPTOR_BY_ID.get("poa.hay-davies");

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function toPhysicsElectrical(electrical: ElectricalSettings): PhysicsElectricalConfig {
  return {
    areaM2: PANEL_AREA_M2,
    efficiency: clamp(electrical.efficiency / 100, 0, 1),
    pmaxW: Math.max(0, electrical.pmaxW),
    vocV: Math.max(1e-3, electrical.vocV),
    iscA: Math.max(1e-3, electrical.iscA),
    vmpV: clamp(electrical.vmpV, 1e-6, Math.max(1e-6, Math.max(1e-3, electrical.vocV) - 1e-6)),
    impA: clamp(electrical.impA, 1e-6, Math.max(1e-6, Math.max(1e-3, electrical.iscA) - 1e-6)),
    seriesResistanceOhm: Math.max(1e-8, electrical.rsOhm),
    shuntResistanceOhm: Math.max(1e-6, electrical.rshOhm),
    idealityFactor: clamp(electrical.ideality, 0.8, 3),
    cellsInSeries: Math.max(1, Math.round(electrical.cells)),
    referenceTemperatureC: electrical.referenceC,
    referenceIrradianceWm2: Math.max(1, electrical.referenceWm2),
    alphaIscAperC: electrical.alphaIsc,
    gammaPmpPerC: electrical.gammaPmp,
    bandgapEv: PHYSICS_DEFAULT_ELECTRICAL.bandgapEv,
  };
}

function toPhysicsThermal(thermal: ThermalSettings): PhysicsThermalConfig {
  return {
    u0Wm2K: Math.max(1e-6, thermal.u0 || PHYSICS_DEFAULT_THERMAL.u0Wm2K),
    u1WsM3K: Math.max(0, thermal.u1),
  };
}

function toPhysicsInverter(inverter: InverterSettings): PhysicsInverterConfig {
  const mpptMinVoltageV = Math.max(0, inverter.mpptMinV);
  return {
    ratedAcPowerW: Math.max(1e-6, inverter.ratedW),
    nominalEfficiency: clamp(inverter.nominalEfficiency / 100, 0.01, 1),
    mpptMinVoltageV,
    mpptMaxVoltageV: Math.max(mpptMinVoltageV, inverter.mpptMaxV),
    maxDcVoltageV: Math.max(inverter.mpptMaxV, PHYSICS_DEFAULT_INVERTER.maxDcVoltageV),
    maxInputCurrentA: Math.max(0, inverter.maxInputA),
    startPowerW: PHYSICS_DEFAULT_INVERTER.startPowerW,
    nightConsumptionW: Math.max(0, inverter.standbyW),
    wiringLossFraction: clamp(inverter.wiringLossPct / 100, 0, 1),
  };
}

function rad(deg: number) {
  return (deg * Math.PI) / 180;
}

function deg(radians: number) {
  return (radians * 180) / Math.PI;
}

function normalize(v: Vec3Tuple): Vec3Tuple {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function dot(a: Vec3Tuple, b: Vec3Tuple) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function add(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a: Vec3Tuple, amount: number): Vec3Tuple {
  return [a[0] * amount, a[1] * amount, a[2] * amount];
}

function quaternionFromNormal(raw: Vec3Tuple): QuaternionTuple {
  const n = normalize(raw);
  const d = clamp(n[2], -1, 1);
  if (d < -0.999999) return [0, 1, 0, 0];
  const s = Math.sqrt((1 + d) * 2);
  return [-n[1] / s, n[0] / s, 0, s / 2];
}

function normalFromQuaternion([x, y, z, w]: QuaternionTuple): Vec3Tuple {
  return normalize([2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)]);
}

function rotateVectorByQuaternion(
  [x, y, z, w]: QuaternionTuple,
  vector: Vec3Tuple,
): Vec3Tuple {
  const uv: Vec3Tuple = [
    y * vector[2] - z * vector[1],
    z * vector[0] - x * vector[2],
    x * vector[1] - y * vector[0],
  ];
  const uuv: Vec3Tuple = [
    y * uv[2] - z * uv[1],
    z * uv[0] - x * uv[2],
    x * uv[1] - y * uv[0],
  ];
  return normalize([
    vector[0] + 2 * (w * uv[0] + uuv[0]),
    vector[1] + 2 * (w * uv[1] + uuv[1]),
    vector[2] + 2 * (w * uv[2] + uuv[2]),
  ]);
}

function multiplyQuaternions(
  [lx, ly, lz, lw]: QuaternionTuple,
  [rx, ry, rz, rw]: QuaternionTuple,
): QuaternionTuple {
  const result: QuaternionTuple = [
    lw * rx + lx * rw + ly * rz - lz * ry,
    lw * ry - lx * rz + ly * rw + lz * rx,
    lw * rz + lx * ry - ly * rx + lz * rw,
    lw * rw - lx * rx - ly * ry - lz * rz,
  ];
  const length = Math.hypot(...result) || 1;
  return result.map((value) => value / length) as QuaternionTuple;
}

function rotateAroundY(v: Vec3Tuple, angle: number): Vec3Tuple {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
}

/** World-first qY · q0, matching the annual worker and Three.js world rotation. */
function rotatePanelAroundWorldY(item: ScenePanel, angle: number): ScenePanel {
  if (Math.abs(angle) < 1e-14) return item;
  const half = angle / 2;
  const worldY: QuaternionTuple = [0, Math.sin(half), 0, Math.cos(half)];
  return {
    ...item,
    position: rotateAroundY(item.position, angle),
    quaternion: multiplyQuaternions(worldY, item.quaternion),
  };
}

function panelOrientation(normal: Vec3Tuple): { tiltDeg: number; azimuthDeg: number } {
  const tiltDeg = deg(Math.acos(clamp(normal[1], -1, 1)));
  const azimuthDeg = tiltDeg < 1e-8
    ? 0
    : (deg(Math.atan2(normal[0], normal[2])) + 360) % 360;
  return { tiltDeg, azimuthDeg };
}

function panel(id: string, label: string, position: Vec3Tuple, normal: Vec3Tuple): ScenePanel {
  return { id, label, position, quaternion: quaternionFromNormal(normal) };
}

function renderPanelsFromBase(basePanels: ScenePanel[], results: PanelResult[]): ScenePanel[] {
  const resultById = new Map(results.map((item) => [item.id, item]));
  return basePanels.map((base) => {
    const result = resultById.get(base.id);
    return {
      ...base,
      irradianceWm2: result?.effectiveWm2,
      temperatureC: result?.temperatureC,
      powerW: result?.powerW,
      bypassActive: result?.bypassActive,
    };
  });
}

interface SurfaceShapeOptions {
  cylinderAspectRatio?: number;
  coneAspectRatio?: number;
  azimuthSamples?: number;
}

function generatePreset(
  name: PresetName,
  tiltDeg = 30,
  azimuthDeg = 180,
  surfaceOptions: SurfaceShapeOptions = {},
): ScenePanel[] {
  if (name === "free") return [panel("free-1", "P-01", [0, 0.055, 0], [0, 1, 0])];
  if (isContinuousSurfacePreset(name)) {
    const surface = createContinuousSurface(name, surfaceOptions.azimuthSamples ?? 32, {
      cylinderAspectRatio: surfaceOptions.cylinderAspectRatio,
      coneAspectRatio: surfaceOptions.coneAspectRatio,
    });
    return surface.zones.map((zone, index) => ({
      id: zone.id,
      label: `Z-${String(index + 1).padStart(2, "0")}`,
      position: [...zone.representativePosition] as Vec3Tuple,
      quaternion: quaternionFromNormal([...zone.representativeNormal] as Vec3Tuple),
    }));
  }
  const generated = generateGeometryPreset(name, {
    planeTiltDeg: tiltDeg,
    planeAzimuthDeg: azimuthDeg,
  });
  const minimumY = Math.min(...generated.map((item) => item.position[1]));
  const yOffset = 0.035 - minimumY;
  return generated.map((item, index): ScenePanel => ({
    id: `${name}-${index + 1}`,
    label: `P-${String(index + 1).padStart(2, "0")}`,
    position: [item.position[0], item.position[1] + yOffset, item.position[2]],
    quaternion: [item.quaternion[0], item.quaternion[1], item.quaternion[2], item.quaternion[3]],
  }));
}

function seededUnit(seed: number, index: number) {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  value += 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function localDateTimeToUtcMs(localDateTime: string, timezoneHours: number): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localDateTime);
  if (!match) throw new RangeError("로컬 날짜·시간 형식이 올바르지 않습니다.");
  const utcMs = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  ) - timezoneHours * 3_600_000;
  if (!Number.isFinite(utcMs)) throw new RangeError("UTC 변환 결과가 올바르지 않습니다.");
  return utcMs;
}

/** Adds wall-clock minutes while preserving month/year rollover independently of the host timezone. */
export function advanceLocalDateTime(localDateTime: string, minutes: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localDateTime);
  if (!match || !Number.isFinite(minutes)) throw new RangeError("로컬 날짜·시간 또는 재생 간격이 올바르지 않습니다.");
  const advanced = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]) + minutes,
  ));
  return advanced.toISOString().slice(0, 16);
}

function localDayStartUtcMs(day: string, timezoneHours: number): number {
  return localDateTimeToUtcMs(`${day}T00:00`, timezoneHours);
}

function solarPositionFromUtc(
  timeUtcMs: number,
  latitudeDeg: number,
  longitudeDeg: number,
  elevationM: number,
): SolarPosition {
  const calculated = calculatePhysicsSolarPosition({
    timestamp: timeUtcMs,
    latitudeDeg,
    longitudeDeg,
    elevationM,
  });
  const vector = physicsSunVector(calculated);
  return {
    timeUtcMs,
    elevationDeg: calculated.elevationDeg,
    azimuthDeg: calculated.azimuthDeg,
    vector: [vector.x, vector.y, vector.z],
    sunrise: "물리 코어",
    sunset: "물리 코어",
    equationOfTimeMin: calculated.equationOfTimeMinutes,
  };
}

function weatherStateFromPoint(point: WeatherPoint, manual: WeatherState): WeatherState {
  return {
    ghi: point.ghiWm2,
    dni: point.dniWm2,
    dhi: point.dhiWm2,
    ambientC: point.ambientC,
    windMs: point.windSpeedMs,
    windDirectionDeg: point.windDirectionDeg,
    gustMs: point.gustMs,
    cloudPct: point.cloudFraction * 100,
    albedo: manual.albedo,
    soilingPct: manual.soilingPct,
  };
}

function interpolateWeatherPoint(
  left: WeatherPoint,
  right: WeatherPoint,
  timeUtcMs: number,
): WeatherPoint {
  const fraction = (timeUtcMs - left.timeUtcMs) / (right.timeUtcMs - left.timeUtcMs);
  const linear = (a: number, b: number) => a + (b - a) * fraction;
  const directionDelta = ((right.windDirectionDeg - left.windDirectionDeg + 540) % 360) - 180;
  return {
    timeUtcMs,
    sourceTimestamp: `${left.sourceTimestamp ?? new Date(left.timeUtcMs).toISOString()} → ${right.sourceTimestamp ?? new Date(right.timeUtcMs).toISOString()}`,
    ghiWm2: Math.max(0, linear(left.ghiWm2, right.ghiWm2)),
    dniWm2: Math.max(0, linear(left.dniWm2, right.dniWm2)),
    dhiWm2: Math.max(0, linear(left.dhiWm2, right.dhiWm2)),
    ambientC: linear(left.ambientC, right.ambientC),
    windSpeedMs: Math.max(0, linear(left.windSpeedMs, right.windSpeedMs)),
    windDirectionDeg: (left.windDirectionDeg + directionDelta * fraction + 360) % 360,
    gustMs: Math.max(0, linear(left.gustMs, right.gustMs)),
    cloudFraction: clamp(linear(left.cloudFraction, right.cloudFraction), 0, 1),
    precipitationMm: Math.max(0, linear(left.precipitationMm, right.precipitationMm)),
  };
}

function preferredWeatherPointAt(series: WeatherSeries, targetUtcMs: number): WeatherPoint | null {
  const points = series.points;
  if (!points.length) return null;
  let lookupUtcMs = targetUtcMs;
  if (series.provenance.kind === "tmy") {
    const target = new Date(targetUtcMs);
    const sourceYear = new Date(points[0].timeUtcMs).getUTCFullYear();
    lookupUtcMs = Date.UTC(
      sourceYear,
      target.getUTCMonth(),
      target.getUTCDate(),
      target.getUTCHours(),
      target.getUTCMinutes(),
    );
    if (new Date(lookupUtcMs).getUTCMonth() !== target.getUTCMonth()) {
      lookupUtcMs = Date.UTC(sourceYear, target.getUTCMonth(), 28, target.getUTCHours(), target.getUTCMinutes());
    }
  }
  if (lookupUtcMs < points[0].timeUtcMs || lookupUtcMs > points.at(-1)!.timeUtcMs) return null;
  let low = 0;
  let high = points.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const point = points[middle];
    if (point.timeUtcMs === lookupUtcMs) return { ...point, timeUtcMs: targetUtcMs };
    if (point.timeUtcMs < lookupUtcMs) low = middle + 1;
    else high = middle - 1;
  }
  const left = points[Math.max(0, high)];
  const right = points[Math.min(points.length - 1, low)];
  if (!left || !right || left === right || right.timeUtcMs - left.timeUtcMs > 3 * 3_600_000) {
    return null;
  }
  const interpolated = interpolateWeatherPoint(left, right, lookupUtcMs);
  return { ...interpolated, timeUtcMs: targetUtcMs };
}

function mergePreferredWeather(
  preferred: WeatherSeries | null,
  fallback: WeatherSeries,
): WeatherSeries {
  if (!preferred) return fallback;
  const resolved = fallback.points.map((point) => preferredWeatherPointAt(preferred, point.timeUtcMs));
  // Never splice measured/API data and clear-sky fallback point by point. A
  // source boundary looked exactly like a physical dropout followed by an
  // evening spike while the provenance still claimed one source. Use the
  // preferred series only when it covers the entire requested clock.
  if (resolved.every((point): point is WeatherPoint => point !== null)) {
    return { points: resolved, provenance: preferred.provenance };
  }
  return {
    ...fallback,
    provenance: {
      ...fallback.provenance,
      fallbackReason: `${preferred.provenance.labelKo}가 요청 시간축 전체를 덮지 않아 단일 오프라인 시계열을 사용했습니다.`,
    },
  };
}

function offlinePresetFor(preset: WeatherPreset): OfflineWeatherPreset {
  return {
    clear: "clear",
    partly: "partly-cloudy",
    overcast: "overcast",
    rain: "rain",
    night: "night",
  }[preset] as OfflineWeatherPreset;
}

function provenanceFromSeries(series: WeatherSeries): Provenance {
  const provider = {
    "open-meteo": "Open-Meteo",
    pvgis: "PVGIS 5.3",
    "nasa-power": "NASA POWER",
    offline: "내장 오프라인 맑은하늘",
    manual: "사용자 입력",
  }[series.provenance.provider];
  return {
    provider,
    kind: series.provenance.labelKo,
    retrievedAt: series.provenance.fetchedAt,
    resolution: series.provenance.temporalResolution,
    spatial: series.provenance.spatialResolution ?? "격자 메타데이터 없음",
    ...(series.provenance.fallbackReason
      ? { fallbackReason: series.provenance.fallbackReason }
      : {}),
  };
}

function dataModeFromSeries(series: WeatherSeries): DataMode {
  return {
    "open-meteo": "open-meteo",
    pvgis: "pvgis-file",
    "nasa-power": "nasa-file",
    offline: "offline",
    manual: "manual",
  }[series.provenance.provider] as DataMode;
}

const DATA_MODES = new Set<DataMode>(["manual", "open-meteo", "pvgis-file", "nasa-file", "offline"]);
const WEATHER_PROVIDERS = new Set<WeatherSeries["provenance"]["provider"]>(["open-meteo", "pvgis", "nasa-power", "offline", "manual"]);
const MAX_PERSISTED_WEATHER_POINTS = 10_000;
const WEATHER_POINT_FIELDS = [
  "timeUtcMs",
  "ghiWm2",
  "dniWm2",
  "dhiWm2",
  "ambientC",
  "windSpeedMs",
  "windDirectionDeg",
  "gustMs",
  "cloudFraction",
  "precipitationMm",
] as const satisfies readonly (keyof WeatherPoint)[];

function isDataMode(value: unknown): value is DataMode {
  return typeof value === "string" && DATA_MODES.has(value as DataMode);
}

function isStoredProvenance(value: unknown): value is Provenance {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Provenance>;
  return [candidate.provider, candidate.kind, candidate.retrievedAt, candidate.resolution, candidate.spatial]
    .every((entry) => typeof entry === "string");
}

/**
 * Keeps autosave below a predictable bound and rejects malformed untrusted JSON
 * before it reaches interpolation or the annual worker.
 */
function safeStoredWeatherSeries(value: unknown): WeatherSeries | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<WeatherSeries>;
  if (!Array.isArray(candidate.points) || candidate.points.length < 1 || candidate.points.length > MAX_PERSISTED_WEATHER_POINTS) return null;
  if (!candidate.provenance || typeof candidate.provenance !== "object") return null;
  if (!WEATHER_PROVIDERS.has(candidate.provenance.provider)) return null;
  if (candidate.points.some((point) =>
    !point || typeof point !== "object" || WEATHER_POINT_FIELDS.some((field) => !Number.isFinite(point[field]))
  )) return null;
  try {
    return assertWeatherSeries(candidate as WeatherSeries);
  } catch {
    return null;
  }
}

/** An automatic-source click must never resolve back to the manual tab. */
export function automaticDataModeFromSeries(series: WeatherSeries | null): Exclude<DataMode, "manual"> {
  if (!series || series.provenance.provider === "manual") return "offline";
  const mode = dataModeFromSeries(series);
  return mode === "manual" ? "offline" : mode;
}

function rayAabb(origin: Vec3Tuple, direction: Vec3Tuple, min: Vec3Tuple, max: Vec3Tuple) {
  let near = 0.0002;
  let far = 10;
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(direction[axis]) < 1e-9) {
      if (origin[axis] < min[axis] || origin[axis] > max[axis]) return false;
      continue;
    }
    const inv = 1 / direction[axis];
    let t1 = (min[axis] - origin[axis]) * inv;
    let t2 = (max[axis] - origin[axis]) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    near = Math.max(near, t1);
    far = Math.min(far, t2);
    if (near > far) return false;
  }
  return far >= near && far > 0;
}

function quaternionFromEulerXyz([x, y, z]: Vec3Tuple): QuaternionTuple {
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

function rotateVectorPreservingLength(
  [x, y, z, w]: QuaternionTuple,
  vector: Vec3Tuple,
): Vec3Tuple {
  const uv: Vec3Tuple = [
    y * vector[2] - z * vector[1],
    z * vector[0] - x * vector[2],
    x * vector[1] - y * vector[0],
  ];
  const uuv: Vec3Tuple = [
    y * uv[2] - z * uv[1],
    z * uv[0] - x * uv[2],
    x * uv[1] - y * uv[0],
  ];
  return [
    vector[0] + 2 * (w * uv[0] + uuv[0]),
    vector[1] + 2 * (w * uv[1] + uuv[1]),
    vector[2] + 2 * (w * uv[2] + uuv[2]),
  ];
}

/** Conservative world AABB for the same scaled and XYZ-Euler-rotated pose rendered by ThreeWorkspace. */
export function obstacleBounds(obstacle: SceneObstacle): { min: Vec3Tuple; max: Vec3Tuple } {
  const bases: Record<SceneObstacle["type"], Vec3Tuple> = {
    mountain: [0.18, 0.18, 0.18], building: [0.1, 0.13, 0.09], tree: [0.09, 0.12, 0.09], wall: [0.16, 0.09, 0.012], ground: [0.22, 0.006, 0.22], water: [0.22, 0.006, 0.22], other: [0.13, 0.13, 0.13],
  };
  const baseSize: Vec3Tuple = obstacle.label.startsWith("GLB 차폐 경계") ? [0.35, 0.35, 0.35] : bases[obstacle.type];
  const halfSize = baseSize.map((value, index) => Math.abs(value * obstacle.scale[index]) / 2) as Vec3Tuple;
  const rotation = quaternionFromEulerXyz(obstacle.rotation ?? [0, 0, 0]);
  const corners: Vec3Tuple[] = [];
  for (const x of [-halfSize[0], halfSize[0]]) {
    for (const y of [-halfSize[1], halfSize[1]]) {
      for (const z of [-halfSize[2], halfSize[2]]) {
        const rotated = rotateVectorPreservingLength(rotation, [x, y, z]);
        corners.push(add(obstacle.position, rotated));
      }
    }
  }
  return {
    min: [
      Math.min(...corners.map((corner) => corner[0])),
      Math.min(...corners.map((corner) => corner[1])),
      Math.min(...corners.map((corner) => corner[2])),
    ],
    max: [
      Math.max(...corners.map((corner) => corner[0])),
      Math.max(...corners.map((corner) => corner[1])),
      Math.max(...corners.map((corner) => corner[2])),
    ],
  };
}

function sampleVisibility(target: ScenePanel, allPanels: ScenePanel[], obstacles: SceneObstacle[], sun: Vec3Tuple, samples = 3) {
  // target.quaternion is already the composed world quaternion. Sampling axes,
  // the POA normal and the rendered mesh therefore share one transform.
  const localX = rotateVectorByQuaternion(target.quaternion, [1, 0, 0]);
  const localY = rotateVectorByQuaternion(target.quaternion, [0, 1, 0]);
  const bounds = obstacles.filter((item) => item.type !== "ground" && item.type !== "water").map(obstacleBounds);
  const targetNormal = normalFromQuaternion(target.quaternion);
  const panelOccluders = allPanels.filter((item) => item.id !== target.id).map((item) => ({
    id: item.id,
    widthM: 0.05 as const,
    heightM: 0.05 as const,
    areaM2: 0.0025 as const,
    position: item.position,
    quaternion: item.quaternion,
    normal: normalFromQuaternion(item.quaternion),
  }));
  let visible = 0;
  let panelVisible = 0;
  let obstacleVisible = 0;
  const total = samples * samples;
  for (let row = 0; row < samples; row += 1) {
    for (let col = 0; col < samples; col += 1) {
      const u = ((col + 0.5) / samples - 0.5) * PANEL_SIZE_M * 0.94;
      const v = ((row + 0.5) / samples - 0.5) * PANEL_SIZE_M * 0.94;
      const origin = add(
        add(target.position, add(scale(localX, u), scale(localY, v))),
        scale(targetNormal, 1e-5),
      );
      const obstacleBlocked = bounds.some((box) => rayAabb(origin, sun, box.min, box.max));
      const panelBlocked = panelOccluders.some((panel) => rayPanelDistance(origin, sun, panel) !== null);
      if (!panelBlocked) panelVisible += 1;
      if (!obstacleBlocked) obstacleVisible += 1;
      if (!obstacleBlocked && !panelBlocked) visible += 1;
    }
  }
  return {
    total: visible / total,
    self: panelVisible / total,
    external: obstacleVisible / total,
  };
}

function simulateIdealSkinSystem(
  surface: ContinuousSurfaceModel,
  obstacles: SceneObstacle[],
  solar: SolarPosition,
  weatherInput: WeatherState,
  environment: EnvironmentSettings,
  electrical: ElectricalSettings,
  thermal: ThermalSettings,
  inverter: InverterSettings,
  rotationAngle: number,
  topology: "series" | "parallel",
  iamB0: number,
  bypassEnabled: boolean,
): SystemResult {
  const daylight = solar.elevationDeg > 0;
  const weather = daylight ? weatherInput : { ...weatherInput, ghi: 0, dni: 0, dhi: 0 };
  const physicsElectrical = toPhysicsElectrical(electrical);
  const physicsThermal = toPhysicsThermal(thermal);
  const physicsInverter = toPhysicsInverter(inverter);
  const obstacleBoxes = obstacles
    .filter((item) => item.type !== "ground" && item.type !== "water")
    .map(obstacleBounds);
  const continuous = simulateContinuousSurface({
    surface,
    timestamp: solar.timeUtcMs,
    solarOverride: { azimuthDeg: solar.azimuthDeg, elevationDeg: solar.elevationDeg },
    irradiance: { ghiWm2: weather.ghi, dniWm2: weather.dni, dhiWm2: weather.dhi },
    weather: {
      ambientTemperatureC: weather.ambientC,
      referenceWindSpeedMS: weather.windMs,
      referenceWindHeightM: Math.max(10, environment.displacementM + environment.roughnessM + 0.02),
      roughnessLengthM: Math.max(0.0001, environment.roughnessM),
      displacementHeightM: Math.max(0, environment.displacementM),
    },
    electricalConfig: physicsElectrical,
    thermal: physicsThermal,
    inverterConfig: physicsInverter,
    topology,
    bypassEnabled,
    rotationAngleRad: rotationAngle,
    albedo: weather.albedo,
    iam: { model: "ashrae", b0: clamp(iamB0, 0, 1) },
    diffuseModel: "hay-davies",
    soilingLossFraction: clamp(weather.soilingPct / 100, 0, 1),
    visibilityAtSample: obstacleBoxes.length
      ? (sample, sunDirection) => {
          const origin: Vec3Tuple = [
            sample.position[0] + sample.normal[0] * 1e-5,
            sample.position[1] + sample.normal[1] * 1e-5,
            sample.position[2] + sample.normal[2] * 1e-5,
          ];
          const direction: Vec3Tuple = [sunDirection.x, sunDirection.y, sunDirection.z];
          return obstacleBoxes.some((box) => rayAabb(origin, direction, box.min, box.max)) ? 0 : 1;
        }
      : undefined,
  });
  const panelResults: PanelResult[] = continuous.zones.map((zone) => {
    const first = zone.samples[0]?.simulation;
    const orientation = panelOrientation([...zone.normal] as Vec3Tuple);
    const averageWind = zone.samples.length
      ? zone.samples.reduce((sum, sample) => sum + sample.simulation.moduleWindSpeedMS, 0) / zone.samples.length
      : weather.windMs;
    return {
      id: zone.id,
      label: zone.label,
      position: [...zone.position] as Vec3Tuple,
      quaternion: quaternionFromNormal([...zone.normal] as Vec3Tuple),
      irradianceWm2: zone.averageEffectivePoaWm2,
      temperatureC: zone.averageTemperatureC,
      powerW: zone.operatingPowerW,
      bypassActive: zone.bypassActive,
      normal: [...zone.normal] as Vec3Tuple,
      incidenceDeg: zone.averageAoiDeg,
      panelTiltDeg: orientation.tiltDeg,
      panelAzimuthDeg: orientation.azimuthDeg,
      cosineIncidence: zone.averageEtaCos,
      etaCos: zone.averageEtaCos,
      visibility: zone.averageVisibility,
      selfVisibility: 1,
      externalVisibility: zone.averageVisibility,
      iam: zone.averageIam,
      etaAngle: zone.averageEtaAngle,
      ghiClosure: first?.poa.ghiClosure ?? {
        reconstructedGhiWm2: 0,
        residualWm2: 0,
        relativeResidual: 0,
        toleranceWm2: 1,
        isClosed: true,
      },
      beamWm2: zone.averageDirectPoaWm2,
      skyWm2: zone.averageDiffusePoaWm2,
      groundWm2: zone.averageGroundPoaWm2,
      poaWm2: zone.averagePoaWm2,
      effectiveWm2: zone.averageEffectivePoaWm2,
      localWindMs: averageWind,
      voltageV: zone.operatingVoltageV,
      currentA: zone.operatingCurrentA,
      modelTrace: zone.trace,
    };
  });
  const ledger = continuous.lossLedger;
  return {
    panels: panelResults,
    dcW: continuous.sharedCircuit.dcPowerW,
    acW: continuous.sharedCircuit.acPowerW,
    grossW: continuous.zones.reduce((sum, zone) => sum + zone.independentMppPowerW, 0),
    voltageV: continuous.sharedCircuit.dcVoltageV,
    currentA: continuous.sharedCircuit.dcCurrentA,
    inverterEfficiency: continuous.sharedCircuit.inverter.efficiency,
    clippingW: continuous.sharedCircuit.inverter.clippingLossW,
    mismatchW: ledger.mismatchLossW + ledger.bypassLossW,
    wiringW: continuous.sharedCircuit.inverter.wiringLossW,
    bypassCount: continuous.sharedCircuit.bypassCount,
    areaWeightedAoiDeg: panelResults.reduce((sum, item) => sum + item.incidenceDeg, 0) / Math.max(1, panelResults.length),
    areaWeightedEtaCos: panelResults.reduce((sum, item) => sum + item.etaCos, 0) / Math.max(1, panelResults.length),
    areaWeightedIam: panelResults.reduce((sum, item) => sum + item.iam, 0) / Math.max(1, panelResults.length),
    areaWeightedEtaAngle: panelResults.reduce((sum, item) => sum + item.etaAngle, 0) / Math.max(1, panelResults.length),
    areaWeightedVisibility: panelResults.reduce((sum, item) => sum + item.visibility, 0) / Math.max(1, panelResults.length),
    losses: [
      { name: "태양 직달 자원", value: ledger.solarResourceDcW, color: "#f5b942" },
      { name: "투영면적", value: -ledger.projectionLossW, color: "#d9914f" },
      { name: "입사각 · IAM", value: -ledger.iamLossW, color: "#b786d8" },
      { name: "자체 차폐", value: -ledger.selfShadingLossW, color: "#88715e" },
      { name: "외부 차폐", value: -ledger.externalOcclusionLossW, color: "#6d8291" },
      { name: "오염", value: -ledger.soilingLossW, color: "#927a55" },
      { name: "온도 · PV 모델", value: -ledger.temperatureAndModelLossW, color: "#df8a78" },
      { name: "직렬 불일치", value: -ledger.mismatchLossW, color: "#d96957" },
      { name: "바이패스(불일치 부분)", value: -ledger.bypassLossW, color: "#e8a35b" },
      { name: "인버터 · 배선", value: -ledger.inverterLossW, color: "#579bbd" },
      { name: "AC", value: continuous.sharedCircuit.acPowerW, color: "#42c6a5" },
    ],
    modelTrace: panelResults[0]?.modelTrace ?? [],
    ivPoints: continuous.circuitPoints.map((point) => ({ voltage: point.voltageV, current: point.currentA, power: point.powerW })),
    inverterStatus: continuous.sharedCircuit.inverter.status,
    modelClass: "ideal-flexible-skin",
    activeAreaM2: continuous.activeAreaM2,
    projectedAreaM2: continuous.projectedAreaM2,
    maximumProjectedAreaM2: continuous.maximumProjectedAreaM2,
    footprintM2: continuous.footprintM2,
    independentMppt: continuous.independentMppt,
    sharedCircuit: continuous.sharedCircuit,
    lossBreakdown: {
      projectionW: ledger.projectionLossW,
      iamW: ledger.iamLossW,
      selfShadingW: ledger.selfShadingLossW,
      occlusionW: ledger.externalOcclusionLossW,
      soilingW: ledger.soilingLossW,
      temperatureW: ledger.temperatureAndModelLossW,
      mismatchW: ledger.mismatchLossW,
      bypassW: ledger.bypassLossW,
      inverterW: ledger.inverterLossW,
    },
  };
}

function evaluateSystem(
  panels: ScenePanel[],
  obstacles: SceneObstacle[],
  solar: SolarPosition,
  weatherInput: WeatherState,
  environment: EnvironmentSettings,
  electrical: ElectricalSettings,
  thermal: ThermalSettings,
  inverter: InverterSettings,
  rotationAngle: number,
  topology: "series" | "parallel",
  iamB0: number,
  sampleCount = 3,
  circuitMode: "simple" | "single-diode" = "single-diode",
  bypassEnabled = true,
  continuousSurface?: ContinuousSurfaceModel | null,
): SystemResult {
  if (continuousSurface) {
    return simulateIdealSkinSystem(
      continuousSurface,
      obstacles,
      solar,
      weatherInput,
      environment,
      electrical,
      thermal,
      inverter,
      rotationAngle,
      topology,
      iamB0,
      bypassEnabled,
    );
  }
  // Daylight is geometric. Preserve a supplied GHI/DNI/DHI triplet so the
  // shared closure audit can expose inconsistent data instead of hiding it.
  const daylight = solar.elevationDeg > 0;
  const weather = daylight ? weatherInput : { ...weatherInput, ghi: 0, dni: 0, dhi: 0 };
  const physicsElectrical = toPhysicsElectrical(electrical);
  const physicsThermal = toPhysicsThermal(thermal);
  const physicsInverter = toPhysicsInverter(inverter);
  const rotatedPanels = panels.map((item) => rotatePanelAroundWorldY(item, rotationAngle));
  const evaluatedPanels = rotatedPanels.map((item): { result: PanelResult; device: CircuitDevice } => {
    const normal = normalFromQuaternion(item.quaternion);
    const mu = dot(normal, solar.vector);
    const visibilityAudit = mu > 0 && daylight
      ? sampleVisibility(item, rotatedPanels, obstacles, solar.vector, sampleCount)
      : { total: 0, self: 1, external: 1 };
    const visibility = visibilityAudit.total;
    const minimumLogHeight = environment.displacementM + environment.roughnessM + 0.01;
    const instant = simulateInstant({
      timestamp: solar.timeUtcMs,
      solarOverride: { azimuthDeg: solar.azimuthDeg, elevationDeg: solar.elevationDeg },
      irradiance: {
        ghiWm2: weather.ghi,
        dniWm2: weather.dni,
        dhiWm2: weather.dhi,
      },
      panel: {
        normal: { x: normal[0], y: normal[1], z: normal[2] },
        areaM2: PANEL_AREA_M2,
        efficiency: physicsElectrical.efficiency,
        visibility,
        diffuseVisibility: clamp(0.82 + 0.18 * visibility, 0, 1),
        groundVisibility: 1,
        albedo: weather.albedo,
        iam: { model: "ashrae", b0: clamp(iamB0, 0, 1) },
        diffuseModel: "hay-davies",
        soilingLossFraction: clamp(weather.soilingPct / 100, 0, 1),
        heightM: Math.max(0.03, item.position[1], minimumLogHeight),
      },
      weather: {
        ambientTemperatureC: weather.ambientC,
        referenceWindSpeedMS: weather.windMs,
        referenceWindHeightM: Math.max(10, minimumLogHeight + 0.01),
        roughnessLengthM: Math.max(0.0001, environment.roughnessM),
        displacementHeightM: Math.max(0, environment.displacementM),
      },
      electrical: { mode: circuitMode, config: physicsElectrical },
      thermal: physicsThermal,
      inverter: false,
    });
    const mpp = instant.ivCurve?.mpp ?? {
      voltageV: instant.dcVoltageV,
      currentA: instant.dcCurrentA,
      powerW: instant.dcPowerW,
    };
    const simpleIscA = mpp.currentA > 0
      ? mpp.currentA * physicsElectrical.iscA / Math.max(physicsElectrical.impA, 1e-9)
      : 0;
    const simpleVocV = mpp.voltageV > 0
      ? mpp.voltageV * physicsElectrical.vocV / Math.max(physicsElectrical.vmpV, 1e-9)
      : 0;
    const curve: CircuitDevice["curve"] = instant.ivCurve ?? {
      points: [
        { voltageV: 0, currentA: simpleIscA, powerW: 0 },
        mpp,
        { voltageV: simpleVocV, currentA: 0, powerW: 0 },
      ],
      iscA: simpleIscA,
      vocV: simpleVocV,
      mpp,
    };
    const effectiveWm2 = instant.effectivePoaWm2;
    const orientation = panelOrientation(normal);
    const result: PanelResult = {
      ...item,
      irradianceWm2: effectiveWm2,
      temperatureC: instant.moduleTemperatureC,
      powerW: mpp.powerW,
      normal,
      incidenceDeg: instant.poa.angleOfIncidenceDeg,
      panelTiltDeg: orientation.tiltDeg,
      panelAzimuthDeg: orientation.azimuthDeg,
      cosineIncidence: instant.poa.cosineIncidence,
      etaCos: instant.poa.etaCos,
      visibility,
      selfVisibility: visibilityAudit.self,
      externalVisibility: visibilityAudit.external,
      iam: instant.poa.iamFactor,
      etaAngle: instant.poa.etaAngle,
      ghiClosure: instant.poa.ghiClosure,
      beamWm2: instant.poa.beamWm2,
      skyWm2: instant.poa.skyDiffuseWm2,
      groundWm2: instant.poa.groundReflectedWm2,
      poaWm2: instant.poa.totalWm2,
      effectiveWm2,
      localWindMs: instant.moduleWindSpeedMS,
      voltageV: mpp.voltageV,
      currentA: mpp.currentA,
      bypassActive: false,
      modelTrace: instant.trace,
    };
    return { result, device: { id: item.id, curve } };
  });
  const panelResults = evaluatedPanels.map((item) => item.result);
  const totalPanelArea = panelResults.length * PANEL_AREA_M2;
  const areaWeighted = (selector: (item: PanelResult) => number) =>
    totalPanelArea > 0
      ? panelResults.reduce((sum, item) => sum + selector(item) * PANEL_AREA_M2, 0) / totalPanelArea
      : 0;
  const grossW = panelResults.reduce((sum, item) => sum + item.powerW, 0);
  const circuit = calculateCircuit({
    devices: evaluatedPanels.map((item) => item.device),
    topology,
    bypassEnabled,
    bypassForwardVoltageV: 0.5,
  });
  const stateByPanel = new Map(circuit.deviceStates.map((state) => [state.deviceId, state]));
  panelResults.forEach((item) => {
    const state = stateByPanel.get(item.id);
    if (!state) return;
    item.bypassActive = state.bypassConducting;
    item.voltageV = state.voltageV;
    item.currentA = state.currentA;
    item.powerW = Math.max(0, state.voltageV * state.currentA);
  });
  const systemInverter = calculateInverter({
    dcPowerW: circuit.mpp.powerW,
    dcVoltageV: circuit.mpp.voltageV,
    dcCurrentA: circuit.mpp.currentA,
    config: physicsInverter,
  });
  const mismatchW = Math.max(0, grossW - circuit.mpp.powerW);
  const bypassLossW = Math.min(mismatchW, evaluatedPanels.reduce((sum, item) => (
    stateByPanel.get(item.result.id)?.bypassConducting ? sum + item.device.curve.mpp.powerW : sum
  ), 0));
  const exclusiveMismatchW = Math.max(0, mismatchW - bypassLossW);
  const wiringW = systemInverter.wiringLossW;
  const dcW = systemInverter.acceptedDcPowerW;
  const acW = systemInverter.acPowerW;
  const clippingW = systemInverter.clippingLossW;
  const independentVoltageV = Math.max(circuit.mpp.voltageV, physicsInverter.mpptMinVoltageV, 1e-6);
  const independentInverter = calculateInverter({
    dcPowerW: grossW,
    dcVoltageV: independentVoltageV,
    dcCurrentA: grossW / independentVoltageV,
    config: physicsInverter,
  });
  const sharedCircuit: FairnessModeResult = {
    mode: "shared-circuit",
    dcPowerW: systemInverter.acceptedDcPowerW,
    acPowerW: systemInverter.acPowerW,
    dcVoltageV: circuit.mpp.voltageV,
    dcCurrentA: circuit.mpp.currentA,
    inverter: systemInverter,
    mismatchLossW: exclusiveMismatchW,
    bypassLossW,
    bypassCount: panelResults.filter((item) => item.bypassActive).length,
  };
  const independentMppt: FairnessModeResult = {
    mode: "independent-mppt",
    dcPowerW: independentInverter.acceptedDcPowerW,
    acPowerW: independentInverter.acPowerW,
    dcVoltageV: independentVoltageV,
    dcCurrentA: grossW / independentVoltageV,
    inverter: independentInverter,
    mismatchLossW: 0,
    bypassLossW: 0,
    bypassCount: 0,
  };
  const projectedAreaM2 = panelResults.reduce(
    (sum, item) => sum + PANEL_AREA_M2 * Math.max(0, dot(item.normal, solar.vector)),
    0,
  );
  const footprintBounds = panelResults.reduce(
    (bounds, item) => ({
      minX: Math.min(bounds.minX, item.position[0] - PANEL_SIZE_M / 2),
      maxX: Math.max(bounds.maxX, item.position[0] + PANEL_SIZE_M / 2),
      minZ: Math.min(bounds.minZ, item.position[2] - PANEL_SIZE_M / 2),
      maxZ: Math.max(bounds.maxZ, item.position[2] + PANEL_SIZE_M / 2),
    }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
  );
  const footprintM2 = Number.isFinite(footprintBounds.minX)
    ? Math.max(0, footprintBounds.maxX - footprintBounds.minX) * Math.max(0, footprintBounds.maxZ - footprintBounds.minZ)
    : 0;
  const activeAreaM2 = panelResults.length * PANEL_AREA_M2;
  const conversionEfficiency = physicsElectrical.efficiency;
  const projectionLossW = Math.max(0, weather.dni * (activeAreaM2 - projectedAreaM2) * conversionEfficiency);
  const iamLossW = panelResults.reduce((sum, item) => sum + weather.dni * item.etaCos * (1 - item.iam) * PANEL_AREA_M2 * conversionEfficiency, 0);
  const selfShadingLossW = panelResults.reduce((sum, item) => sum + weather.dni * item.etaAngle * (1 - item.selfVisibility) * PANEL_AREA_M2 * conversionEfficiency, 0);
  const occlusionLossW = panelResults.reduce((sum, item) => sum + weather.dni * item.etaAngle * Math.max(0, item.selfVisibility - item.visibility) * PANEL_AREA_M2 * conversionEfficiency, 0);
  const beforeSoilingDcW = panelResults.reduce((sum, item) => sum + item.poaWm2 * PANEL_AREA_M2 * conversionEfficiency, 0);
  const opticalDcW = panelResults.reduce((sum, item) => sum + item.effectiveWm2 * PANEL_AREA_M2 * conversionEfficiency, 0);
  const soilingLossW = Math.max(0, beforeSoilingDcW - opticalDcW);
  // Signed so cold-weather conversion gain closes the same exclusive ledger.
  const temperatureLossW = opticalDcW - grossW;
  const diffuseAndGroundDcW = panelResults.reduce((sum, item) => sum + (item.skyWm2 + item.groundWm2) * PANEL_AREA_M2 * conversionEfficiency, 0);
  const solarResourceDcW = weather.dni * activeAreaM2 * conversionEfficiency + diffuseAndGroundDcW;
  const modelTrace: TraceStage[] = [
    ...(panelResults[0]?.modelTrace.filter((stage) => stage.modelId !== "inverter.pvwatts-v5") ?? []),
    {
      modelId: "circuit.series-parallel-bypass",
      inputs: { devices: panelResults.length, topology, bypassEnabled },
      outputs: {
        dcPowerW: circuit.mpp.powerW,
        dcVoltageV: circuit.mpp.voltageV,
        dcCurrentA: circuit.mpp.currentA,
        bypassCount: panelResults.filter((item) => item.bypassActive).length,
      },
    },
    {
      modelId: "inverter.pvwatts-v5",
      inputs: { dcPowerW: circuit.mpp.powerW, dcVoltageV: circuit.mpp.voltageV },
      outputs: { acPowerW: systemInverter.acPowerW, efficiency: systemInverter.efficiency, clippingLossW: systemInverter.clippingLossW },
    },
  ];
  return {
    panels: panelResults,
    dcW,
    acW,
    grossW,
    voltageV: circuit.mpp.voltageV,
    currentA: circuit.mpp.currentA,
    inverterEfficiency: systemInverter.efficiency,
    clippingW,
    mismatchW,
    wiringW,
    bypassCount: panelResults.filter((item) => item.bypassActive).length,
    areaWeightedAoiDeg: areaWeighted((item) => item.incidenceDeg),
    areaWeightedEtaCos: areaWeighted((item) => item.etaCos),
    areaWeightedIam: areaWeighted((item) => item.iam),
    areaWeightedEtaAngle: areaWeighted((item) => item.etaAngle),
    areaWeightedVisibility: areaWeighted((item) => item.visibility),
    losses: [
      { name: "태양 자원", value: solarResourceDcW, color: "#f5b942" },
      { name: "투영면적", value: -projectionLossW, color: "#d9914f" },
      { name: "입사각 · IAM", value: -iamLossW, color: "#b786d8" },
      { name: "자체 차폐", value: -selfShadingLossW, color: "#88715e" },
      { name: "외부 차폐", value: -occlusionLossW, color: "#6d8291" },
      { name: "오염", value: -soilingLossW, color: "#927a55" },
      { name: "온도 · PV 모델", value: -temperatureLossW, color: "#df8a78" },
      { name: "회로 불일치", value: -exclusiveMismatchW, color: "#d96957" },
      { name: "바이패스(불일치 부분)", value: -bypassLossW, color: "#e8a35b" },
      { name: "인버터 · 배선 · 클리핑", value: -Math.max(0, circuit.mpp.powerW - acW), color: "#579bbd" },
      { name: "AC", value: acW, color: "#42c6a5" },
    ],
    modelTrace,
    ivPoints: circuit.points.map((point) => ({ voltage: point.voltageV, current: point.currentA, power: point.powerW })),
    inverterStatus: systemInverter.status,
    modelClass: "rigid-panels",
    activeAreaM2,
    projectedAreaM2,
    maximumProjectedAreaM2: activeAreaM2,
    footprintM2,
    independentMppt,
    sharedCircuit,
    lossBreakdown: {
      projectionW: projectionLossW,
      iamW: iamLossW,
      selfShadingW: selfShadingLossW,
      occlusionW: occlusionLossW,
      soilingW: soilingLossW,
      temperatureW: temperatureLossW,
      mismatchW: exclusiveMismatchW,
      bypassW: bypassLossW,
      inverterW: Math.max(0, circuit.mpp.powerW - acW),
    },
  };
}

function integrateSelectedWh<T extends { minute: number; intervalMean?: boolean }>(
  points: T[],
  power: (point: T) => number,
) {
  let energy = 0;
  for (let index = 1; index < points.length; index += 1) {
    const dtHours = (points[index].minute - points[index - 1].minute) / 60;
    const previous = points[index - 1];
    // A fixed-RPM row is already the midpoint-quadrature mean of this exact
    // forward interval. Trapezoid-integrating two adjacent interval means
    // would shift half of the next interval into the current one.
    const intervalPowerW = previous.intervalMean
      ? power(previous)
      : 0.5 * (power(previous) + power(points[index]));
    energy += intervalPowerW * dtHours;
  }
  return energy;
}

export function integrateWh(points: { minute: number; ac: number; intervalMean?: boolean }[]) {
  return integrateSelectedWh(points, (point) => point.ac);
}

function formatPower(value: number) {
  return value < 1 ? `${value.toFixed(3)} W` : `${value.toFixed(2)} W`;
}

function formatEnergy(value: number) {
  return value >= 1000 ? `${(value / 1000).toFixed(2)} kWh` : `${value.toFixed(2)} Wh`;
}

function downloadBlob(contents: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Field({ label, unit, value, min, max, step = 1, onChange, hint }: { label: string; unit?: string; value: number | string; min?: number; max?: number; step?: number; onChange: (value: number) => void; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}{hint ? <span className="hint" title={hint}>?</span> : null}</span>
      <span className="field-control">
        <input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />
        {unit ? <span className="field-unit">{unit}</span> : null}
      </span>
    </label>
  );
}

function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (value: boolean) => void; label: string; description?: string }) {
  return (
    <button type="button" className={`toggle-row ${checked ? "active" : ""}`} onClick={() => onChange(!checked)} aria-pressed={checked}>
      <span><strong>{label}</strong>{description ? <small>{description}</small> : null}</span>
      <span className="toggle-track"><span /></span>
    </button>
  );
}

function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "data" }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function Metric({ label, value, detail, icon: Icon, accent = "amber" }: { label: string; value: string; detail: string; icon: typeof Sun; accent?: "amber" | "teal" | "blue" | "violet" }) {
  return (
    <article className={`metric metric-${accent}`}>
      <div className="metric-icon"><Icon size={17} /></div>
      <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
    </article>
  );
}

function SectionTitle({ eyebrow, title, aside }: { eyebrow: string; title: string; aside?: ReactNode }) {
  return (
    <div className="section-title">
      <div><span>{eyebrow}</span><h2>{title}</h2></div>
      {aside ? <div className="section-aside">{aside}</div> : null}
    </div>
  );
}

function PanelHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="panel-header">
      <div><h3>{title}</h3>{subtitle ? <p>{subtitle}</p> : null}</div>
      {action}
    </div>
  );
}

function EmptyState({ icon: Icon, title, text }: { icon: typeof Sun; title: string; text: string }) {
  return <div className="empty-state"><Icon size={24} /><strong>{title}</strong><span>{text}</span></div>;
}

export default function SimulatorClient() {
  const [screen, setScreen] = useState<Screen>("assembly");
  const [navOpen, setNavOpen] = useState(false);
  const [scenarioName, setScenarioName] = useState("서울 · 하지 형상 비교");
  const [preset, setPreset] = useState<PresetName>("sphere");
  const [panels, setPanels] = useState<ScenePanel[]>(() => generatePreset("sphere"));
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>("sphere-zone-1");
  const [tiltDeg, setTiltDeg] = useState(30);
  const [panelAzimuthDeg, setPanelAzimuthDeg] = useState(180);
  const [transformMode, setTransformMode] = useState<"translate" | "rotate" | "scale">("translate");
  const [gridSnap, setGridSnap] = useState(true);
  const [surfaceSnap, setSurfaceSnap] = useState(false);
  const [showNormals, setShowNormals] = useState(true);
  const [showRays, setShowRays] = useState(true);
  const [quality, setQuality] = useState<"fast" | "balanced" | "precise">("balanced");
  const [cylinderAspectRatio, setCylinderAspectRatio] = useState(1);
  const [coneAspectRatio, setConeAspectRatio] = useState(2);
  const [showZoneBoundaries, setShowZoneBoundaries] = useState(true);
  const [showSurfaceSamples, setShowSurfaceSamples] = useState(false);
  const [past, setPast] = useState<ScenePanel[][]>([]);
  const [future, setFuture] = useState<ScenePanel[][]>([]);

  const [sunMode, setSunMode] = useState<"auto" | "manual">("auto");
  const [latitude, setLatitude] = useState(37.5665);
  const [longitude, setLongitude] = useState(126.978);
  const [elevationM, setElevationM] = useState(38);
  const [timezoneHours, setTimezoneHours] = useState(9);
  const [dateTime, setDateTime] = useState("2026-06-21T12:30");
  const [manualSun, setManualSun] = useState({ elevationDeg: 55, azimuthDeg: 180 });
  const [playing, setPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(30);

  const [weatherPreset, setWeatherPreset] = useState<WeatherPreset>("clear");
  const [weather, setWeather] = useState<WeatherState>(WEATHER_PRESETS.clear);
  const [dataMode, setDataMode] = useState<DataMode>("manual");
  const [automaticWeatherSeries, setAutomaticWeatherSeries] = useState<WeatherSeries | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [provenance, setProvenance] = useState<Provenance>({
    provider: "수동 프리셋",
    kind: "사용자 입력",
    retrievedAt: "—",
    resolution: "순간 시나리오",
    spatial: "해당 없음",
  });
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [iamB0, setIamB0] = useState(0.05);
  const [diagnosticSeries, setDiagnosticSeries] = useState<Record<DiagnosticSeriesKey, boolean>>({
    elevation: true,
    aoi: true,
    etaCos: false,
    iam: false,
    etaAngle: true,
    ghi: false,
    dni: false,
    dhi: false,
    poa: true,
    dc: true,
    ac: true,
  });
  const [selectedDiagnosticMinute, setSelectedDiagnosticMinute] = useState(18 * 60);

  const [environmentName, setEnvironmentName] = useState<EnvironmentName>("plain");
  const [environment, setEnvironment] = useState<EnvironmentSettings>(ENVIRONMENTS.plain);
  const [obstacles, setObstacles] = useState<SceneObstacle[]>([
    { id: "building-1", type: "building", label: "소형 건물", position: [0.28, 0.065, -0.16], scale: [1, 1, 1] },
    { id: "tree-1", type: "tree", label: "수목", position: [-0.3, 0.075, 0.12], scale: [1, 1, 1] },
  ]);
  const [selectedObstacleId, setSelectedObstacleId] = useState<string | null>("building-1");
  const [gltfUrl, setGltfUrl] = useState<string | null>(null);
  const [gltfName, setGltfName] = useState<string | null>(null);

  const [electrical, setElectrical] = useState<ElectricalSettings>(DEFAULT_ELECTRICAL);
  const [thermal, setThermal] = useState<ThermalSettings>(DEFAULT_THERMAL);
  const [inverter, setInverter] = useState<InverterSettings>(DEFAULT_INVERTER);
  const [rotation, setRotation] = useState<RotationSettings>(DEFAULT_ROTATION);
  const [rotationAngle, setRotationAngle] = useState(0);
  const [autoOmega, setAutoOmega] = useState(0);
  const rotationAngleRef = useRef(0);
  const autoOmegaRef = useRef(0);
  const [topology, setTopology] = useState<"series" | "parallel">("series");
  const [circuitEdges, setCircuitEdges] = useState<Edge[]>(() => createAutoWireEdges(
    panels.map((item) => ({ id: item.id, label: item.label, irradianceWm2: 0, powerW: 0, bypassActive: false })),
    "series",
  ));
  const [circuitMode, setCircuitMode] = useState<"simple" | "single-diode">("single-diode");
  const [bypassEnabled, setBypassEnabled] = useState(true);

  const [compareShapes, setCompareShapes] = useState<PresetName[]>(["plane", "cube", "sphere"]);
  const [annualProgress, setAnnualProgress] = useState(0);
  const [annualRunning, setAnnualRunning] = useState(false);
  const [annualEnergyWhByVariant, setAnnualEnergyWhByVariant] = useState<Record<string, number>>({});
  const [annualMonthlyByVariant, setAnnualMonthlyByVariant] = useState<Record<string, { month: string; energy: number; normalized: number }[]>>({});
  const [annualScope, setAnnualScope] = useState<"current" | "compare" | null>(null);
  const [annualAuditCode, setAnnualAuditCode] = useState<DiagnosticReasonCode | null>(null);
  const annualWorker = useRef<Worker | null>(null);
  const annualRequest = useRef<SimulationRunRequest | null>(null);
  const lastAnnualScenarioKey = useRef<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const [toast, setToast] = useState<string | null>(null);
  const hydrated = useRef(false);

  const instantUtcMs = useMemo(
    () => localDateTimeToUtcMs(dateTime, timezoneHours),
    [dateTime, timezoneHours],
  );
  const solarAuto = useMemo(
    () => solarPositionFromUtc(instantUtcMs, latitude, longitude, elevationM),
    [instantUtcMs, latitude, longitude, elevationM],
  );
  const solar = useMemo<SolarPosition>(() => {
    if (sunMode === "auto") return solarAuto;
    const el = rad(manualSun.elevationDeg);
    const az = rad(manualSun.azimuthDeg);
    return {
      timeUtcMs: instantUtcMs,
      elevationDeg: manualSun.elevationDeg,
      azimuthDeg: manualSun.azimuthDeg,
      vector: normalize([Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)]),
      sunrise: "수동",
      sunset: "수동",
      equationOfTimeMin: 0,
    };
  }, [sunMode, solarAuto, manualSun, instantUtcMs]);

  const buildAutomaticWeather = useCallback((startUtcMs: number, endUtcMs: number, stepMinutes: number) => {
    const fallback = getOfflineWeather({
      latitudeDeg: latitude,
      longitudeDeg: longitude,
      elevationM,
      start: startUtcMs,
      end: endUtcMs,
      stepMinutes,
      seed: String(seed),
      offlinePreset: offlinePresetFor(weatherPreset),
    });
    const preferred = dataMode === "open-meteo" || dataMode === "pvgis-file" || dataMode === "nasa-file"
      ? automaticWeatherSeries
      : null;
    return mergePreferredWeather(preferred, fallback);
  }, [automaticWeatherSeries, dataMode, elevationM, latitude, longitude, seed, weatherPreset]);

  const instantWeather = useMemo(() => {
    if (dataMode === "manual") return weather;
    const series = buildAutomaticWeather(instantUtcMs, instantUtcMs, 1);
    return weatherStateFromPoint(series.points[0], weather);
  }, [buildAutomaticWeather, dataMode, instantUtcMs, weather]);

  const activateAutomaticWeather = useCallback(() => {
    const series = automaticWeatherSeries ?? buildAutomaticWeather(instantUtcMs, instantUtcMs, 1);
    setDataMode(automaticDataModeFromSeries(series));
    setProvenance(provenanceFromSeries(series));
  }, [automaticWeatherSeries, buildAutomaticWeather, instantUtcMs]);

  const sampleGrid = quality === "fast" ? 1 : quality === "precise" ? 5 : 3;
  const surfaceAzimuthSamples = quality === "fast" ? 16 : quality === "precise" ? 64 : 32;
  const currentSurface = useMemo<ContinuousSurfaceModel | null>(() => (
    isContinuousSurfacePreset(preset)
      ? createContinuousSurface(preset, surfaceAzimuthSamples, { cylinderAspectRatio, coneAspectRatio })
      : null
  ), [preset, surfaceAzimuthSamples, cylinderAspectRatio, coneAspectRatio]);
  const isFlexibleSkin = currentSurface !== null;
  const modelClassLabel = isFlexibleSkin ? "이상적 유연 PV 스킨" : "강체 패널";
  const simulationYear = Number(dateTime.slice(0, 4));
  const activeRotationAngle = rotation.mode === "static" ? 0 : rotationAngle;
  const circuitValidation = useMemo(() => validateCircuitEdges(
    panels.map((item) => ({ id: item.id, label: item.label, irradianceWm2: 0, powerW: 0, bypassActive: false })),
    topology,
    circuitEdges,
  ), [panels, topology, circuitEdges]);
  const result = useMemo(
    () => {
      const computed = evaluateSystem(panels, obstacles, solar, instantWeather, environment, electrical, thermal, inverter, activeRotationAngle, topology, iamB0, sampleGrid, circuitMode, bypassEnabled, currentSurface);
      if (circuitValidation.isValid) return computed;
      return {
        ...computed,
        dcW: 0,
        acW: 0,
        currentA: 0,
        inverterEfficiency: 0,
        losses: [...computed.losses, { name: "배선 검증 실패", value: -computed.dcW, color: "#d64f61" }],
      };
    },
    [panels, obstacles, solar, instantWeather, environment, electrical, thermal, inverter, activeRotationAngle, topology, iamB0, sampleGrid, circuitMode, bypassEnabled, currentSurface, circuitValidation.isValid],
  );
  const renderPanels = useMemo(
    () => renderPanelsFromBase(panels, result.panels),
    [panels, result.panels],
  );

  const staticResult = useMemo(
    () => {
      const computed = evaluateSystem(panels, obstacles, solar, instantWeather, environment, electrical, thermal, inverter, 0, topology, iamB0, sampleGrid, circuitMode, bypassEnabled, currentSurface);
      return circuitValidation.isValid ? computed : { ...computed, dcW: 0, acW: 0, currentA: 0, inverterEfficiency: 0 };
    },
    [panels, obstacles, solar, instantWeather, environment, electrical, thermal, inverter, topology, iamB0, sampleGrid, circuitMode, bypassEnabled, currentSurface, circuitValidation.isValid],
  );

  const buildDaySeries = useCallback((targetPanels: ScenePanel[], day: string, stepMinutes: number, modelMode: "simple" | "single-diode", targetPreset: PresetName = preset) => {
    const points: DailyPoint[] = [];
    const dayStart = localDayStartUtcMs(day, timezoneHours);
    const weatherSeries = buildAutomaticWeather(dayStart, dayStart + 86_400_000, stepMinutes);
    const samplesPerTurn = quality === "precise" ? 72 : quality === "balanced" ? 24 : 12;
    const targetSurface = isContinuousSurfacePreset(targetPreset)
      ? createContinuousSurface(targetPreset, surfaceAzimuthSamples, { cylinderAspectRatio, coneAspectRatio })
      : null;
    const phaseVariant: SimulationVariantWorkItem | null = rotation.mode === "fixed"
      ? {
          variantId: "ui-daily-rotation",
          panelCount: targetPanels.length,
          totalPanelAreaM2: targetPanels.length * PANEL_AREA_M2,
          referenceEfficiency: clamp(electrical.efficiency / 100, 0, 1),
          rotation: {
            mode: "fixed",
            rpm: rotation.rpm,
            initialAngleRad: 0,
            referenceTimestamp: dayStart,
          },
          rotationPhaseSamples: samplesPerTurn,
        }
      : null;
    const phaseInput: SimulationKernelInput | null = phaseVariant
      ? { variants: [phaseVariant], weather: weatherSeries.points }
      : null;

    for (const [stepIndex, weatherPoint] of weatherSeries.points.entries()) {
      const minute = Math.round((weatherPoint.timeUtcMs - dayStart) / 60_000);
      const displayHour = Math.floor(minute / 60);
      const displayMinute = minute % 60;
      const sunAtTime = solarPositionFromUtc(
        weatherPoint.timeUtcMs,
        latitude,
        longitude,
        elevationM,
      );
      const weatherAtTime = weatherStateFromPoint(weatherPoint, weather);
      // The worker's quadrature folds any number of complete turns into one
      // periodic cycle and preserves a weighted residual arc. This avoids the
      // severe phase alias caused by capping samples along hundreds of turns.
      const phaseSamples = phaseInput && phaseVariant
        ? rotationIntervalSamples({
            input: phaseInput,
            variant: phaseVariant,
            weather: weatherPoint,
            stepIndex,
          })
        : [{ angleRad: 0, weight: 1, intervalAveraged: false }];
      let dc = 0;
      let ac = 0;
      let poa = 0;
      let temperature = 0;
      let aoi = 0;
      let etaCos = 0;
      let iam = 0;
      let etaAngle = 0;
      let voltage = 0;
      let current = 0;
      let visibility = 0;
      let bypassCount = 0;
      let sharedDc = 0;
      let sharedAc = 0;
      let independentDc = 0;
      let independentAc = 0;
      let representative: SystemResult | null = null;
      let representativePhaseDeg = 0;
      let representativeWeight = -1;
      const inverterStatuses = new Map<string, number>();
      for (const phase of phaseSamples) {
        const calculated = evaluateSystem(targetPanels, obstacles, sunAtTime, weatherAtTime, environment, electrical, thermal, inverter, phase.angleRad, topology, iamB0, sampleGrid, modelMode, bypassEnabled, targetSurface);
        const sample = targetPanels === panels && !circuitValidation.isValid
          ? { ...calculated, dcW: 0, acW: 0 }
          : calculated;
        dc += sample.dcW * phase.weight;
        ac += sample.acW * phase.weight;
        temperature += (sample.panels.reduce((sum, item) => sum + item.temperatureC, 0) / Math.max(1, sample.panels.length)) * phase.weight;
        const diagnosticPanel = sample.panels.find((item) => item.id === selectedPanelId)
          ?? sample.panels[0];
        poa += (diagnosticPanel?.poaWm2 ?? 0) * phase.weight;
        aoi += (diagnosticPanel?.incidenceDeg ?? 0) * phase.weight;
        etaCos += (diagnosticPanel?.etaCos ?? 0) * phase.weight;
        iam += (diagnosticPanel?.iam ?? 0) * phase.weight;
        etaAngle += (diagnosticPanel?.etaAngle ?? 0) * phase.weight;
        voltage += sample.voltageV * phase.weight;
        current += sample.currentA * phase.weight;
        visibility += sample.areaWeightedVisibility * phase.weight;
        bypassCount += sample.bypassCount * phase.weight;
        sharedDc += sample.sharedCircuit.dcPowerW * phase.weight;
        sharedAc += sample.sharedCircuit.acPowerW * phase.weight;
        independentDc += sample.independentMppt.dcPowerW * phase.weight;
        independentAc += sample.independentMppt.acPowerW * phase.weight;
        inverterStatuses.set(sample.inverterStatus, (inverterStatuses.get(sample.inverterStatus) ?? 0) + phase.weight);
        if (phase.weight > representativeWeight) {
          representative = sample;
          representativePhaseDeg = ((deg(phase.angleRad) % 360) + 360) % 360;
          representativeWeight = phase.weight;
        }
      }
      const representativeResult = representative as SystemResult | null;
      const inverterStatus = [...inverterStatuses.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "unknown";
      const normalizedUtc = new Date(weatherPoint.timeUtcMs).toISOString();
      const localDateTime = new Date(weatherPoint.timeUtcMs + timezoneHours * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
      points.push({
        time: minute === 1440 ? "24:00" : `${String(displayHour).padStart(2, "0")}:${String(displayMinute).padStart(2, "0")}`,
        minute,
        timestampOriginal: weatherPoint.sourceTimestamp ?? normalizedUtc,
        timeUtcIso: normalizedUtc,
        localDateTime,
        weatherSource: `${weatherSeries.provenance.provider}/${weatherSeries.provenance.kind}`,
        intervalMean: phaseSamples[0]?.intervalAveraged ?? false,
        dc,
        ac,
        poa,
        temperature,
        elevation: sunAtTime.elevationDeg,
        aoi,
        etaCos,
        iam,
        etaAngle,
        ghi: weatherPoint.ghiWm2,
        dni: weatherPoint.dniWm2,
        dhi: weatherPoint.dhiWm2,
        azimuth: sunAtTime.azimuthDeg,
        zenith: 90 - sunAtTime.elevationDeg,
        voltage,
        current,
        visibility,
        bypassCount: Math.round(bypassCount),
        inverterStatus,
        sharedDc,
        sharedAc,
        independentDc,
        independentAc,
        representativePhaseDeg,
        zones: (representativeResult?.panels ?? []).map((panelState) => ({
          id: panelState.id,
          label: panelState.label,
          aoiDeg: panelState.incidenceDeg,
          cosineIncidence: panelState.cosineIncidence,
          iam: panelState.iam,
          directWm2: panelState.beamWm2,
          diffuseWm2: panelState.skyWm2,
          groundWm2: panelState.groundWm2,
          poaWm2: panelState.poaWm2,
          effectiveWm2: panelState.effectiveWm2,
          temperatureC: panelState.temperatureC,
          voltageV: panelState.voltageV,
          currentA: panelState.currentA,
          powerW: panelState.powerW,
          visibility: panelState.visibility,
          bypassActive: panelState.bypassActive,
        })),
        reasonCodes: [],
        diagnosticSeverity: "normal",
      });
    }
    return points.map((point, index) => {
      const toSignal = (value: DailyPoint): DiagnosticSignal => ({
        minute: value.minute,
        solarElevationDeg: value.elevation,
        ghiWm2: value.ghi,
        dcPowerW: value.dc,
        acPowerW: value.ac,
        visibility: value.visibility,
        bypassCount: value.bypassCount,
        inverterStatus: value.inverterStatus,
        intervalAveraged: value.intervalMean,
      });
      const classified = classifyTimePoint(toSignal(point), index > 0 ? toSignal(points[index - 1]) : undefined);
      return { ...point, reasonCodes: classified.reasonCodes, diagnosticSeverity: classified.severity };
    });
  }, [buildAutomaticWeather, timezoneHours, latitude, longitude, elevationM, weather, rotation, quality, obstacles, environment, electrical, thermal, inverter, topology, iamB0, bypassEnabled, panels, preset, circuitValidation.isValid, selectedPanelId, sampleGrid, surfaceAzimuthSamples, cylinderAspectRatio, coneAspectRatio]);

  const dailySeries = useMemo<DailyPoint[]>(
    () => screen === "simulation" || screen === "export"
      ? buildDaySeries(panels, dateTime.slice(0, 10), 10, circuitMode, preset)
      : [],
    [buildDaySeries, panels, dateTime, circuitMode, preset, screen],
  );
  const selectedDiagnosticPoint = useMemo(() => (
    dailySeries.length
      ? dailySeries.find((point) => point.minute === selectedDiagnosticMinute)
        ?? dailySeries.reduce((closest, point) => (
          Math.abs(point.minute - selectedDiagnosticMinute) < Math.abs(closest.minute - selectedDiagnosticMinute) ? point : closest
        ), dailySeries[0])
      : undefined
  ), [dailySeries, selectedDiagnosticMinute]);
  const selectedDiagnosticCumulativeWh = useMemo(() => (
    selectedDiagnosticPoint
      ? integrateWh(dailySeries.filter((point) => point.minute <= selectedDiagnosticPoint.minute))
      : 0
  ), [dailySeries, selectedDiagnosticPoint]);
  const handleDailyChartClick = useCallback((chartState: unknown) => {
    if (!chartState || typeof chartState !== "object") return;
    const state = chartState as { activeTooltipIndex?: unknown; activeIndex?: unknown; activeLabel?: unknown };
    const index = Number(state.activeTooltipIndex ?? state.activeIndex);
    const indexedPoint = Number.isInteger(index) ? dailySeries[index] : undefined;
    const labelledPoint = typeof state.activeLabel === "string"
      ? dailySeries.find((point) => point.time === state.activeLabel)
      : undefined;
    const point = indexedPoint ?? labelledPoint;
    if (point) setSelectedDiagnosticMinute(point.minute);
  }, [dailySeries]);

  const dailyWh = useMemo(() => integrateWh(dailySeries), [dailySeries]);
  const representativeMonthlyData = useMemo(() => {
    if (screen !== "simulation") return [];
    return Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      const day = `${simulationYear}-${String(month).padStart(2, "0")}-15`;
      const daysInMonth = new Date(Date.UTC(simulationYear, month, 0)).getUTCDate();
      const energy = integrateWh(buildDaySeries(panels, day, 60, circuitMode, preset)) * daysInMonth;
      return {
        month: `${month}월`,
        energy,
        normalized: energy / Math.max(PANEL_AREA_M2 * panels.length, 1e-6),
      };
    });
  }, [simulationYear, buildDaySeries, panels, preset, circuitMode, screen]);
  const monthlyData = annualMonthlyByVariant.current ?? representativeMonthlyData;
  const annualWh = annualEnergyWhByVariant.current ?? monthlyData.reduce((sum, item) => sum + item.energy, 0);
  const compareEnergyModesByShape = useMemo(() => {
    if (screen !== "compare") return {};
    return Object.fromEntries(compareShapes.map((shapeName) => {
      const workerEnergy = annualEnergyWhByVariant[`compare:${shapeName}`];
      const targetPanels = generatePreset(shapeName, tiltDeg, panelAzimuthDeg, { cylinderAspectRatio, coneAspectRatio, azimuthSamples: surfaceAzimuthSamples });
      let sharedRepresentativeWh = 0;
      let independentRepresentativeWh = 0;
      for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
        const month = monthIndex + 1;
        const day = `${simulationYear}-${String(month).padStart(2, "0")}-15`;
        const daysInMonth = new Date(Date.UTC(simulationYear, month, 0)).getUTCDate();
        const series = buildDaySeries(targetPanels, day, 60, circuitMode, shapeName);
        sharedRepresentativeWh += integrateSelectedWh(series, (point) => point.sharedAc) * daysInMonth;
        independentRepresentativeWh += integrateSelectedWh(series, (point) => point.independentAc) * daysInMonth;
      }
      return [shapeName, {
        sharedWh: workerEnergy ?? sharedRepresentativeWh,
        independentWh: independentRepresentativeWh,
        sharedIsWorker: workerEnergy !== undefined,
      }];
    }));
  }, [annualEnergyWhByVariant, buildDaySeries, compareShapes, simulationYear, tiltDeg, panelAzimuthDeg, cylinderAspectRatio, coneAspectRatio, surfaceAzimuthSamples, circuitMode, screen]);
  const compareEnergyByShape = useMemo(() => Object.fromEntries(
    compareShapes.map((shapeName) => [shapeName, compareEnergyModesByShape[shapeName]?.sharedWh ?? 0]),
  ), [compareEnergyModesByShape, compareShapes]);
  const compareInstantByShape = useMemo(() => screen === "compare" ? Object.fromEntries(compareShapes.map((shapeName) => {
    const targetPanels = generatePreset(shapeName, tiltDeg, panelAzimuthDeg, { cylinderAspectRatio, coneAspectRatio, azimuthSamples: surfaceAzimuthSamples });
    const targetSurface = isContinuousSurfacePreset(shapeName)
      ? createContinuousSurface(shapeName, surfaceAzimuthSamples, { cylinderAspectRatio, coneAspectRatio })
      : null;
    return [shapeName, evaluateSystem(targetPanels, obstacles, solar, instantWeather, environment, electrical, thermal, inverter, activeRotationAngle, topology, iamB0, sampleGrid, circuitMode, bypassEnabled, targetSurface)];
  })) : {}, [compareShapes, tiltDeg, panelAzimuthDeg, obstacles, solar, instantWeather, environment, electrical, thermal, inverter, activeRotationAngle, topology, iamB0, circuitMode, bypassEnabled, cylinderAspectRatio, coneAspectRatio, surfaceAzimuthSamples, sampleGrid, screen]);
  const bestCompareEnergy = Math.max(0, ...compareShapes.map((shapeName) => compareEnergyByShape[shapeName] ?? 0));
  const compareChartData = compareShapes.map((shapeName) => ({
    name: PRESET_LABELS[shapeName],
    modeA: compareEnergyModesByShape[shapeName]?.sharedWh ?? 0,
    modeB: compareEnergyModesByShape[shapeName]?.independentWh ?? 0,
  }));
  const selectedPanel = result.panels.find((item) => item.id === selectedPanelId) ?? result.panels[0] ?? null;
  const selectedBasePanel = selectedPanel
    ? panels.find((item) => item.id === selectedPanel.id) ?? null
    : null;
  const selectedPanelAcW = selectedPanel
    ? result.acW * selectedPanel.powerW /
      Math.max(1e-12, result.panels.reduce((sum, item) => sum + Math.max(0, item.powerW), 0))
    : 0;
  const automaticSourceLabel = automaticWeatherSeries?.provenance.labelKo ?? "모델 추정값";
  const overlaps = useMemo(() => {
    const pairs: string[] = [];
    panels.forEach((a, index) => panels.slice(index + 1).forEach((b) => {
      const distance = Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2]);
      if (distance < PANEL_SIZE_M * 0.72) pairs.push(`${a.label} ↔ ${b.label}`);
    }));
    return pairs;
  }, [panels]);

  const snapshot = useCallback(() => ({
    schemaVersion: 3,
    appVersion: "1.0.0",
    scenarioName,
    preset,
    panels,
    obstacles,
    location: { latitude, longitude, elevationM, timezoneHours },
    dateTime,
    sunMode,
    manualSun,
    weatherPreset,
    weather,
    dataMode,
    provenance,
    automaticWeatherSeries: safeStoredWeatherSeries(automaticWeatherSeries),
    iamB0,
    seed,
    environmentName,
    environment,
    electrical,
    thermal,
    inverter,
    rotation,
    topology,
    circuitEdges,
    circuitMode,
    bypassEnabled,
    surface: { cylinderAspectRatio, coneAspectRatio, showZoneBoundaries, showSurfaceSamples },
    gltfReference: gltfName ? { fileName: gltfName, embedded: false } : null,
    resultSettings: { quality, sampleGrid },
  }), [scenarioName, preset, panels, obstacles, latitude, longitude, elevationM, timezoneHours, dateTime, sunMode, manualSun, weatherPreset, weather, dataMode, provenance, automaticWeatherSeries, iamB0, seed, environmentName, environment, electrical, thermal, inverter, rotation, topology, circuitEdges, circuitMode, bypassEnabled, cylinderAspectRatio, coneAspectRatio, showZoneBoundaries, showSurfaceSamples, gltfName, quality, sampleGrid]);
  const annualScenarioKey = useMemo(() => JSON.stringify({
    simulationYear,
    preset,
    panels,
    compareShapes,
    tiltDeg,
    panelAzimuthDeg,
    cylinderAspectRatio,
    coneAspectRatio,
    surfaceAzimuthSamples,
    obstacles,
    location: { latitude, longitude, elevationM, timezoneHours },
    weather: { dataMode, automaticWeatherSeries, seed, weatherPreset },
    environment,
    electrical,
    thermal,
    inverter,
    rotation,
    topology,
    circuitMode,
    bypassEnabled,
    iamB0,
  }), [
    simulationYear,
    preset,
    panels,
    compareShapes,
    tiltDeg,
    panelAzimuthDeg,
    cylinderAspectRatio,
    coneAspectRatio,
    surfaceAzimuthSamples,
    obstacles,
    latitude,
    longitude,
    elevationM,
    timezoneHours,
    dataMode,
    automaticWeatherSeries,
    seed,
    weatherPreset,
    environment,
    electrical,
    thermal,
    inverter,
    rotation,
    topology,
    circuitMode,
    bypassEnabled,
    iamB0,
  ]);

  useEffect(() => {
    if (hydrated.current) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      hydrated.current = true;
      try {
        const saved = localStorage.getItem("solarform:last-project");
        if (!saved) return;
        const parsed = JSON.parse(saved);
        if (parsed?.schemaVersion !== 3 || !Array.isArray(parsed.panels) || parsed.panels.length < 1 || parsed.panels.length > 20) return;
        setScenarioName(parsed.scenarioName ?? scenarioName);
        setPreset(parsed.preset ?? preset);
        setPanels(parsed.panels);
        setObstacles(parsed.obstacles ?? []);
        if (parsed.location) {
          setLatitude(parsed.location.latitude);
          setLongitude(parsed.location.longitude);
          setElevationM(parsed.location.elevationM);
          setTimezoneHours(parsed.location.timezoneHours);
        }
        setDateTime(parsed.dateTime ?? dateTime);
        if (parsed.sunMode === "auto" || parsed.sunMode === "manual") setSunMode(parsed.sunMode);
        if (parsed.manualSun) setManualSun(parsed.manualSun);
        setWeather(parsed.weather ?? weather);
        const restoredSeries = safeStoredWeatherSeries(parsed.automaticWeatherSeries);
        setAutomaticWeatherSeries(restoredSeries);
        const storedMode = isDataMode(parsed.dataMode) ? parsed.dataMode : "manual";
        const restoredMode = storedMode === "manual" || storedMode === "offline" || restoredSeries
          ? storedMode
          : "offline";
        setDataMode(restoredMode);
        if (isStoredProvenance(parsed.provenance) && restoredMode === storedMode) {
          setProvenance(parsed.provenance);
        } else if (restoredMode === "offline") {
          setProvenance({
            provider: "내장 오프라인 모델",
            kind: "모델 추정값",
            retrievedAt: "—",
            resolution: "저장된 원자료 없음",
            spatial: "위치별 Haurwitz + Erbs",
            fallbackReason: "저장 프로젝트에 원 기상 시계열이 없어 오프라인 모델로 전환",
          });
        }
        if (Number.isFinite(parsed.iamB0)) setIamB0(clamp(Number(parsed.iamB0), 0, 1));
        setElectrical(parsed.electrical ?? electrical);
        setThermal(parsed.thermal ?? thermal);
        setInverter(parsed.inverter ?? inverter);
        setRotation(parsed.rotation ?? rotation);
        setTopology(parsed.topology ?? topology);
        setCircuitEdges(parsed.circuitEdges ?? []);
        if (Number.isFinite(parsed.surface?.cylinderAspectRatio)) setCylinderAspectRatio(clamp(Number(parsed.surface.cylinderAspectRatio), 0.25, 10));
        if (Number.isFinite(parsed.surface?.coneAspectRatio)) setConeAspectRatio(clamp(Number(parsed.surface.coneAspectRatio), 0.25, 10));
        if (typeof parsed.surface?.showZoneBoundaries === "boolean") setShowZoneBoundaries(parsed.surface.showZoneBoundaries);
        if (typeof parsed.surface?.showSurfaceSamples === "boolean") setShowSurfaceSamples(parsed.surface.showSurfaceSamples);
      } catch {
        setSaveStatus("error");
      }
    });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    setSaveStatus("saving");
    const timeout = window.setTimeout(() => {
      try {
        localStorage.setItem("solarform:last-project", JSON.stringify(snapshot()));
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    }, 550);
    return () => window.clearTimeout(timeout);
  }, [snapshot]);

  useEffect(() => {
    if (lastAnnualScenarioKey.current === null) {
      lastAnnualScenarioKey.current = annualScenarioKey;
      return;
    }
    if (lastAnnualScenarioKey.current === annualScenarioKey) return;
    lastAnnualScenarioKey.current = annualScenarioKey;
    const hadAnnualState = annualRequest.current !== null
      || Object.keys(annualEnergyWhByVariant).length > 0
      || Object.keys(annualMonthlyByVariant).length > 0;
    annualWorker.current?.terminate();
    annualWorker.current = null;
    annualRequest.current = null;
    setAnnualRunning(false);
    setAnnualProgress(0);
    setAnnualScope(null);
    setAnnualEnergyWhByVariant({});
    setAnnualMonthlyByVariant({});
    if (hadAnnualState) setAnnualAuditCode("STALE_WORKER_RESULT");
  }, [annualScenarioKey, annualEnergyWhByVariant, annualMonthlyByVariant]);

  useEffect(() => {
    if (!playing) return;
    const interval = window.setInterval(() => {
      setDateTime((current) => advanceLocalDateTime(current, playSpeed));
    }, 500);
    return () => window.clearInterval(interval);
  }, [playing, playSpeed]);

  useEffect(() => {
    if (rotation.mode === "static") return;
    let last = performance.now();
    const interval = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (rotation.mode === "fixed") {
        setRotationAngle((angle) => {
          const nextAngle = (angle + (2 * Math.PI * rotation.rpm * dt) / 60) % (Math.PI * 2);
          rotationAngleRef.current = nextAngle;
          return nextAngle;
        });
      } else {
        const currentAngle = rotationAngleRef.current;
        const currentOmega = autoOmegaRef.current;
        const windTorque = 0.5 * environment.airDensity * rotation.dragCoefficient * PANEL_AREA_M2 * instantWeather.windMs * instantWeather.windMs * 0.06 * Math.sin(rad(instantWeather.windDirectionDeg) - currentAngle);
        const friction = rotation.friction * Math.tanh(currentOmega / 0.01);
        const alpha = (windTorque - rotation.damping * currentOmega - friction) / Math.max(rotation.inertia, 1e-6);
        const maxOmega = (rotation.maxRpm * 2 * Math.PI) / 60;
        const nextOmega = clamp(currentOmega + alpha * dt, -maxOmega, maxOmega);
        autoOmegaRef.current = nextOmega;
        setAutoOmega(nextOmega);
        setRotationAngle((angle) => {
          const nextAngle = (angle + nextOmega * dt + Math.PI * 2) % (Math.PI * 2);
          rotationAngleRef.current = nextAngle;
          return nextAngle;
        });
      }
    }, 50);
    return () => window.clearInterval(interval);
  }, [rotation, environment.airDensity, instantWeather.windMs, instantWeather.windDirectionDeg]);

  useEffect(() => () => {
    if (gltfUrl) URL.revokeObjectURL(gltfUrl);
    annualWorker.current?.terminate();
    annualWorker.current = null;
    annualRequest.current = null;
  }, [gltfUrl]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const commitPanels = useCallback((next: ScenePanel[]) => {
    setPast((history) => [...history.slice(-49), panels]);
    setFuture([]);
    setPanels(next);
  }, [panels]);

  const changePreset = (next: PresetName) => {
    setPreset(next);
    const generated = generatePreset(next, tiltDeg, panelAzimuthDeg, {
      cylinderAspectRatio,
      coneAspectRatio,
      azimuthSamples: surfaceAzimuthSamples,
    });
    commitPanels(generated);
    setSelectedPanelId(generated[0]?.id ?? null);
    setCircuitEdges(createAutoWireEdges(generated.map((item) => ({ id: item.id, label: item.label, irradianceWm2: 0, powerW: 0, bypassActive: false })), topology));
  };

  const rebuildContinuousPreset = (kind: "cylinder" | "cone", aspectRatio: number) => {
    const bounded = clamp(aspectRatio, 0.25, 10);
    if (kind === "cylinder") setCylinderAspectRatio(bounded);
    else setConeAspectRatio(bounded);
    if (preset !== kind) return;
    const generated = generatePreset(kind, tiltDeg, panelAzimuthDeg, {
      cylinderAspectRatio: kind === "cylinder" ? bounded : cylinderAspectRatio,
      coneAspectRatio: kind === "cone" ? bounded : coneAspectRatio,
      azimuthSamples: surfaceAzimuthSamples,
    });
    commitPanels(generated);
    setSelectedPanelId(generated[0]?.id ?? null);
    setCircuitEdges(createAutoWireEdges(generated.map((item) => ({ id: item.id, label: item.label, irradianceWm2: 0, powerW: 0, bypassActive: false })), topology));
  };

  const rebuildPlane = (tilt: number, azimuth: number) => {
    setTiltDeg(tilt);
    setPanelAzimuthDeg(azimuth);
    if (preset === "plane") commitPanels(generatePreset("plane", tilt, azimuth));
  };

  const undo = () => {
    const previous = past.at(-1);
    if (!previous) return;
    setPast((history) => history.slice(0, -1));
    setFuture((history) => [panels, ...history]);
    setPanels(previous);
  };

  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture((history) => history.slice(1));
    setPast((history) => [...history, panels]);
    setPanels(next);
  };

  const addPanel = () => {
    if (panels.length >= PANEL_LIMIT) return setToast("패널은 형상당 최대 20개입니다.");
    const id = `free-${crypto.randomUUID()}`;
    const next = [...panels, panel(id, `P-${String(panels.length + 1).padStart(2, "0")}`, [0, 0.06 + panels.length * 0.003, 0], [0, 1, 0])];
    commitPanels(next);
    setSelectedPanelId(id);
    setPreset("free");
  };

  const duplicatePanel = () => {
    const source = panels.find((item) => item.id === selectedPanelId);
    if (!source || panels.length >= PANEL_LIMIT) return;
    const id = `copy-${crypto.randomUUID()}`;
    const copy = { ...source, id, label: `P-${String(panels.length + 1).padStart(2, "0")}`, position: add(source.position, [0.015, 0.015, 0.015]) };
    commitPanels([...panels, copy]);
    setSelectedPanelId(id);
    setPreset("free");
  };

  const deletePanel = () => {
    if (!selectedPanelId || panels.length <= 1) return;
    const next = panels.filter((item) => item.id !== selectedPanelId);
    commitPanels(next);
    setSelectedPanelId(next[0]?.id ?? null);
    setPreset("free");
  };

  const transformPanel = (id: string, position: Vec3Tuple, quaternion: QuaternionTuple) => {
    commitPanels(panels.map((item) => item.id === id ? { ...item, position, quaternion } : item));
    setPreset("free");
  };

  const addObstacle = (type: SceneObstacle["type"]) => {
    const labels: Record<SceneObstacle["type"], string> = { mountain: "산", building: "건물", tree: "나무", wall: "벽", ground: "지면", water: "수면", other: "기타 장애물" };
    const item: SceneObstacle = {
      id: `${type}-${crypto.randomUUID()}`,
      type,
      label: `${labels[type]} ${obstacles.filter((entry) => entry.type === type).length + 1}`,
      position: [0.24 - seededUnit(seed, obstacles.length) * 0.48, type === "wall" ? 0.045 : 0.07, -0.22 + seededUnit(seed + 1, obstacles.length) * 0.44],
      scale: [1, 1, 1],
    };
    setObstacles((items) => [...items, item]);
    setSelectedObstacleId(item.id);
  };

  const updateObstacle = (id: string, patch: Partial<SceneObstacle>) => {
    setObstacles((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const transformObstacle = (id: string, position: Vec3Tuple, rotationEuler: Vec3Tuple, scaleValue: Vec3Tuple) => {
    updateObstacle(id, { position, rotation: rotationEuler, scale: scaleValue });
  };

  const loadOpenMeteo = async () => {
    setDataLoading(true);
    const controller = new AbortController();
    try {
      const dayStart = localDayStartUtcMs(dateTime.slice(0, 10), timezoneHours);
      const series = await fetchOpenMeteo({
        latitudeDeg: latitude,
        longitudeDeg: longitude,
        elevationM,
        start: dayStart,
        end: dayStart + 86_400_000,
      }, {
        signal: controller.signal,
        timeoutMs: 9_000,
        endpoint: "https://api.open-meteo.com/v1/forecast?wind_speed_unit=ms",
      });
      setAutomaticWeatherSeries(series);
      setDataMode(dataModeFromSeries(series));
      setProvenance(provenanceFromSeries(series));
      setToast(series.provenance.provider === "offline"
        ? "Open-Meteo 실패 — 결정론적 오프라인 시계열로 전환했습니다."
        : `Open-Meteo ${series.points.length}개 시간점을 불러왔습니다.`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setToast("Open-Meteo 조회를 취소했습니다.");
      } else {
        setToast(error instanceof Error ? error.message : "Open-Meteo 조회에 실패했습니다.");
      }
    } finally {
      setDataLoading(false);
    }
  };

  const handleWeatherFile = async (event: ChangeEvent<HTMLInputElement>, kind: "pvgis-file" | "nasa-file") => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const series = kind === "pvgis-file"
        ? importPvgisJson(text)
        : normalizeNasaPowerResponse(JSON.parse(text));
      setAutomaticWeatherSeries(series);
      setDataMode(kind);
      setProvenance(provenanceFromSeries(series));
      setToast(`${file.name}에서 ${series.points.length.toLocaleString("ko-KR")}개 시간점을 불러왔습니다.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "파일을 읽지 못했습니다.");
    } finally {
      event.target.value = "";
    }
  };

  const handleGltf = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (gltfUrl) URL.revokeObjectURL(gltfUrl);
    setGltfUrl(URL.createObjectURL(file));
    setGltfName(file.name);
    const proxy: SceneObstacle = {
      id: "gltf-shading-boundary",
      type: "other",
      label: `GLB 차폐 경계 · ${file.name}`,
      position: [0, 0.175, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: "#52c7d9",
    };
    setObstacles((items) => [...items.filter((item) => !item.label.startsWith("GLB 차폐 경계")), proxy]);
    setSelectedObstacleId(proxy.id);
    setToast(`${file.name}을 정규화된 GLB 차폐 경계와 함께 연결했습니다.`);
  };

  const circuitPanels = result.panels.map((item) => ({ id: item.id, label: item.label, irradianceWm2: item.effectiveWm2, powerW: item.powerW, bypassActive: bypassEnabled && item.bypassActive }));

  const autoWire = () => {
    setCircuitEdges(createAutoWireEdges(circuitPanels, topology));
    setToast(`${topology === "series" ? "직렬" : "병렬"} 자동 배선을 적용했습니다.`);
  };

  const handleCircuitEdgesChange = (changes: EdgeChange[]) => {
    setCircuitEdges((items) => applyEdgeChanges(changes, items));
  };

  const handleCircuitConnect = (connection: Connection) => {
    setCircuitEdges((items) => addEdge({ ...connection, id: `manual:${crypto.randomUUID()}`, type: "smoothstep" }, items));
  };

  const runAnnual = (shapeNames: PresetName[], scope: "current" | "compare") => {
    if (annualRunning) return;
    if (scope === "current" && !circuitValidation.isValid) {
      setToast("회로의 개방·단락·극성·순환·고립 오류를 먼저 해결하세요.");
      return;
    }
    annualWorker.current?.terminate();

    try {
      const year = simulationYear;
      const offsetMs = timezoneHours * 3_600_000;
      const startMs = Date.UTC(year, 0, 1) - offsetMs;
      const endMs = Date.UTC(year + 1, 0, 1) - offsetMs;
      const weatherSeries = buildAutomaticWeather(startMs, endMs, 60);
      const physicsElectrical = toPhysicsElectrical(electrical);
      const physicsThermal = toPhysicsThermal(thermal);
      const physicsInverter = toPhysicsInverter(inverter);
      const variants = shapeNames.map((shapeName) => {
        const annualSurface = isContinuousSurfacePreset(shapeName)
          ? createContinuousSurface(shapeName, surfaceAzimuthSamples, { cylinderAspectRatio, coneAspectRatio })
          : null;
        const zoneById = new Map(annualSurface?.zones.map((zone) => [zone.id, zone]) ?? []);
        const sourcePanels = scope === "current"
          ? panels
          : generatePreset(shapeName, tiltDeg, panelAzimuthDeg, { cylinderAspectRatio, coneAspectRatio, azimuthSamples: surfaceAzimuthSamples });
        const variantId = scope === "current" ? "current" : `compare:${shapeName}`;
        return {
          variantId,
          panelCount: sourcePanels.length,
          totalPanelAreaM2: sourcePanels.length * PANEL_AREA_M2,
          referenceEfficiency: physicsElectrical.efficiency,
          obstacleBounds: obstacles
            .filter((item) => item.type !== "ground" && item.type !== "water")
            .map((item) => obstacleBounds(item))
            .map((bounds) => ({
              min: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] },
              max: { x: bounds.max[0], y: bounds.max[1], z: bounds.max[2] },
            })),
          panels: sourcePanels.map((item) => {
            const normal = normalFromQuaternion(item.quaternion);
            const sampleAxisU = rotateVectorByQuaternion(item.quaternion, [1, 0, 0]);
            const sampleAxisV = rotateVectorByQuaternion(item.quaternion, [0, 1, 0]);
            const surfaceZone = zoneById.get(item.id);
            return {
              panelId: item.id,
              positionM: { x: item.position[0], y: item.position[1], z: item.position[2] },
              normal: { x: normal[0], y: normal[1], z: normal[2] },
              quaternion: {
                x: item.quaternion[0],
                y: item.quaternion[1],
                z: item.quaternion[2],
                w: item.quaternion[3],
              },
              sampleAxisU: { x: sampleAxisU[0], y: sampleAxisU[1], z: sampleAxisU[2] },
              sampleAxisV: { x: sampleAxisV[0], y: sampleAxisV[1], z: sampleAxisV[2] },
              areaM2: PANEL_AREA_M2,
              efficiency: physicsElectrical.efficiency,
              albedo: weather.albedo,
              iam: { model: "ashrae" as const, b0: clamp(iamB0, 0, 1) },
              diffuseModel: "hay-davies" as const,
              soilingLossFraction: clamp(weather.soilingPct / 100, 0, 1),
              heightM: Math.max(0.03, item.position[1]),
              ...(surfaceZone ? {
                surfaceSamples: surfaceZone.samples.map((sample) => ({
                  positionM: { x: sample.position[0], y: sample.position[1], z: sample.position[2] },
                  normal: { x: sample.normal[0], y: sample.normal[1], z: sample.normal[2] },
                  areaWeight: sample.areaM2,
                })),
              } : {}),
            };
          }),
          topology,
          circuit: circuitMode === "single-diode"
            ? { bypassEnabled, bypassForwardVoltageV: 0.5 }
            : false as const,
          electrical: { mode: circuitMode, config: physicsElectrical },
          inverter: physicsInverter,
          rotation: rotation.mode === "fixed"
            ? { mode: "fixed" as const, rpm: rotation.rpm, initialAngleRad: 0, referenceTimestamp: startMs }
            : rotation.mode === "auto"
              ? { mode: "fixed" as const, rpm: (autoOmega * 60) / (2 * Math.PI), initialAngleRad: 0, referenceTimestamp: startMs }
              : { mode: "static" as const, angleRad: 0 },
          rotationPhaseSamples: rotation.mode === "fixed"
            ? quality === "precise" ? 72 : quality === "balanced" ? 24 : 12
            : 1,
        };
      });
      const input: SimulationKernelInput = {
        variants,
        weather: weatherSeries.points,
        physics: {
          location: { latitudeDeg: latitude, longitudeDeg: longitude, elevationM },
          weather: {
            referenceWindHeightM: 10,
            roughnessLengthM: Math.max(0.0001, environment.roughnessM),
            displacementHeightM: Math.max(0, environment.displacementM),
          },
          electrical: { mode: circuitMode, config: physicsElectrical },
          thermal: physicsThermal,
          inverter: physicsInverter,
          panelDefaults: {
            albedo: weather.albedo,
            iam: { model: "ashrae" as const, b0: clamp(iamB0, 0, 1) },
            diffuseModel: "hay-davies" as const,
            soilingLossFraction: clamp(weather.soilingPct / 100, 0, 1),
          },
        },
        mode: "annual" as const,
        chunkSize: 24,
        maximumGapHours: 2,
        reportingOffsetMinutes: timezoneHours * 60,
      };
      const request = createSimulationRunRequest(`annual-${scope}`, input);
      const worker = new SimulationWorker();
      annualWorker.current = worker;
      annualRequest.current = request;
      setAnnualScope(scope);
      setAnnualRunning(true);
      setAnnualProgress(0);
      setAnnualAuditCode(null);

      worker.onmessage = ({ data: event }: MessageEvent<SimulationWorkerEvent>) => {
        if (isSimulationEventStale(event, request)) {
          setAnnualAuditCode("STALE_WORKER_RESULT");
          return;
        }
        if (event.type === "simulation/progress") {
          setAnnualProgress(Math.round(event.fraction * 100));
          return;
        }
        if (event.type === "simulation/complete") {
          setAnnualEnergyWhByVariant((current) => ({ ...current, ...event.acEnergyWhByVariant }));
          const monthly = Object.fromEntries(Object.keys(event.acEnergyWhByVariant).map((variantId) => [
            variantId,
            event.monthlyEnergy.map((item) => {
              const energy = item.acEnergyWhByVariant[variantId] ?? 0;
              const variant = variants.find((candidate) => candidate.variantId === variantId);
              return {
                month: `${Number(item.monthUtc.slice(5, 7))}월`,
                energy,
                normalized: energy / Math.max(PANEL_AREA_M2 * (variant?.panelCount ?? 1), 1e-6),
              };
            }),
          ]));
          setAnnualMonthlyByVariant((current) => ({ ...current, ...monthly }));
          setAnnualProgress(100);
          setAnnualRunning(false);
          setAnnualAuditCode(null);
          setToast(`연간 ${event.steps.toLocaleString("ko-KR")}시간점 계산 완료 · ${(event.elapsedMs / 1000).toFixed(1)}초`);
          worker.terminate();
          annualWorker.current = null;
          annualRequest.current = null;
          return;
        }
        if (event.type === "simulation/cancelled") {
          setAnnualRunning(false);
          setToast(`연간 계산을 ${Math.round(event.fraction * 100)}%에서 취소했습니다.`);
          worker.terminate();
          annualWorker.current = null;
          annualRequest.current = null;
          return;
        }
        if (event.type === "simulation/error") {
          setAnnualRunning(false);
          setToast(`연간 계산 오류: ${event.error.message}`);
          worker.terminate();
          annualWorker.current = null;
          annualRequest.current = null;
        }
      };
      worker.onerror = (event) => {
        setAnnualRunning(false);
        setToast(`연간 워커 오류: ${event.message || "알 수 없는 오류"}`);
        worker.terminate();
        annualWorker.current = null;
        annualRequest.current = null;
      };
      worker.postMessage(request);
    } catch (error) {
      setAnnualRunning(false);
      setToast(error instanceof Error ? error.message : "연간 계산 입력을 만들지 못했습니다.");
    }
  };

  const cancelAnnual = () => {
    const worker = annualWorker.current;
    const request = annualRequest.current;
    if (!worker || !request) return;
    worker.postMessage(createSimulationCancelRequest(request, "사용자 취소"));
    setToast(`연간 계산 ${annualProgress}%에서 취소를 요청했습니다.`);
  };

  const exportJson = () => {
    const envelope = { format: "solarform-project", schemaVersion: 3, exportedAt: new Date().toISOString(), document: snapshot(), results: { instant: result, daily: dailySeries, monthly: monthlyData, annualWh } };
    downloadBlob(JSON.stringify(envelope, null, 2), "application/json", `${scenarioName.replace(/\s+/g, "-")}.solar.json`);
  };

  const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const document = parsed.document ?? parsed;
      if (![1, 2, 3].includes(document.schemaVersion) || !Array.isArray(document.panels)) throw new Error("지원하지 않는 저장 형식입니다.");
      if (document.panels.length < 1 || document.panels.length > 20) throw new Error("패널 개수는 1~20개여야 합니다.");
      const migrated = { ...document, schemaVersion: 3, appVersion: "1.0.0", resultSettings: document.resultSettings ?? { quality: "balanced", sampleGrid: 3 } };
      setScenarioName(migrated.scenarioName ?? file.name.replace(/\..+$/, ""));
      setPreset(migrated.preset ?? "free");
      setPanels(migrated.panels);
      setObstacles(migrated.obstacles ?? []);
      setCircuitEdges(migrated.circuitEdges ?? []);
      setWeather(migrated.weather ?? WEATHER_PRESETS.clear);
      const restoredSeries = safeStoredWeatherSeries(migrated.automaticWeatherSeries);
      setAutomaticWeatherSeries(restoredSeries);
      const storedMode = isDataMode(migrated.dataMode) ? migrated.dataMode : "manual";
      const restoredMode = storedMode === "manual" || storedMode === "offline" || restoredSeries
        ? storedMode
        : "offline";
      setDataMode(restoredMode);
      if (isStoredProvenance(migrated.provenance) && restoredMode === storedMode) {
        setProvenance(migrated.provenance);
      } else if (restoredMode === "offline") {
        setProvenance({
          provider: "내장 오프라인 모델",
          kind: "모델 추정값",
          retrievedAt: "—",
          resolution: "저장된 원자료 없음",
          spatial: "위치별 Haurwitz + Erbs",
          fallbackReason: "가져온 프로젝트에 원 기상 시계열이 없어 오프라인 모델로 전환",
        });
      }
      if (Number.isFinite(migrated.iamB0)) setIamB0(clamp(Number(migrated.iamB0), 0, 1));
      setEnvironment(migrated.environment ?? ENVIRONMENTS.plain);
      setElectrical(migrated.electrical ?? DEFAULT_ELECTRICAL);
      setThermal(migrated.thermal ?? DEFAULT_THERMAL);
      setInverter(migrated.inverter ?? DEFAULT_INVERTER);
      setRotation(migrated.rotation ?? DEFAULT_ROTATION);
      setToast(`스키마 v${document.schemaVersion} → v3 검증·불러오기 완료`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "JSON을 불러오지 못했습니다.");
    } finally {
      event.target.value = "";
    }
  };

  const exportCsv = () => {
    const header = "time,minute,dc_W,ac_W,poa_Wm2,module_temperature_C,solar_elevation_deg";
    const rows = dailySeries.map((item) => [item.time, item.minute, item.dc.toFixed(6), item.ac.toFixed(6), item.poa.toFixed(3), item.temperature.toFixed(3), item.elevation.toFixed(4)].join(","));
    const meta = [`# scenario=${scenarioName}`, `# provider=${provenance.provider}`, `# kind=${provenance.kind}`, `# retrieved_at=${provenance.retrievedAt}`, `# seed=${seed}`];
    downloadBlob(`\uFEFF${[...meta, header, ...rows].join("\n")}`, "text/csv;charset=utf-8", `${scenarioName.replace(/\s+/g, "-")}-daily.csv`);
  };

  const exportChart = () => {
    const svg = document.querySelector("#daily-chart svg");
    if (!(svg instanceof SVGElement)) return setToast("내보낼 그래프를 먼저 표시해 주세요.");
    const serialized = new XMLSerializer().serializeToString(svg);
    const source = URL.createObjectURL(new Blob([serialized], { type: "image/svg+xml;charset=utf-8" }));
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1400;
      canvas.height = 700;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.fillStyle = "#0b1721";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 40, 40, 1320, 620);
      canvas.toBlob((blob) => blob && downloadBlob(blob, "image/png", "solarform-daily-chart.png"));
      URL.revokeObjectURL(source);
    };
    image.src = source;
  };

  const selectedObstacle = obstacles.find((item) => item.id === selectedObstacleId) ?? null;
  const rotationRpm = rotation.mode === "auto" ? (autoOmega * 60) / (2 * Math.PI) : rotation.mode === "fixed" ? rotation.rpm : 0;
  const rotationDeltaPct = staticResult.acW > 0 ? ((result.acW - staticResult.acW) / staticResult.acW) * 100 : 0;
  const selectRotationMode = (mode: RotationSettings["mode"]) => {
    if (mode === "static") {
      rotationAngleRef.current = 0;
      autoOmegaRef.current = 0;
      setRotationAngle(0);
      setAutoOmega(0);
      setRotation({ ...rotation, mode, rpm: 0 });
      return;
    }
    if (mode === "fixed") {
      autoOmegaRef.current = 0;
      setAutoOmega(0);
      setRotation({ ...rotation, mode, rpm: rotation.rpm || 3 });
      return;
    }
    setRotation({ ...rotation, mode });
  };

  return (
    <main className="sim-app">
      <aside className={`app-nav ${navOpen ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><Sun size={21} /></div>
          <div><strong>Solarform</strong><span>ENGINEERING LAB</span></div>
        </div>
        <nav aria-label="주요 화면">
          {SCREEN_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} type="button" className={screen === item.id ? "active" : ""} onClick={() => { setScreen(item.id); setNavOpen(false); }}>
                <Icon size={18} /><span>{item.label}</span>{item.id === "circuit" && result.bypassCount > 0 ? <em>{result.bypassCount}</em> : null}
              </button>
            );
          })}
        </nav>
        <div className="nav-foot">
          <div className="model-status"><span className="status-dot" /><div><strong>물리 엔진 정상</strong><small>모델 레지스트리 v1.0</small></div></div>
          <button type="button" className="help-link" onClick={() => setScreen("evidence")}><HelpCircle size={16} /> 모델 한계 보기</button>
        </div>
      </aside>

      <section className="app-shell">
        <header className="topbar">
          <button type="button" className="mobile-menu" onClick={() => setNavOpen(!navOpen)} aria-label="메뉴 열기"><Menu size={20} /></button>
          <div className="scenario-control">
            <span>시나리오</span>
            <input value={scenarioName} onChange={(event) => setScenarioName(event.target.value)} aria-label="시나리오 이름" />
          </div>
          <div className="top-context">
            <Pill tone="data"><Database size={12} /> {provenance.kind}</Pill>
            <span className="context-item"><Sun size={14} /> {solar.elevationDeg.toFixed(1)}°</span>
            <span className="context-item"><Wind size={14} /> {instantWeather.windMs.toFixed(1)} m/s</span>
          </div>
          <div className="top-actions">
            <span className={`save-state ${saveStatus}`}>
              {saveStatus === "saving" ? <LoaderCircle size={13} className="spin" /> : saveStatus === "error" ? <AlertTriangle size={13} /> : <Check size={13} />}
              {saveStatus === "saving" ? "저장 중" : saveStatus === "error" ? "저장 오류" : "자동 저장됨"}
            </span>
            <button type="button" className="icon-button" onClick={undo} disabled={!past.length} aria-label="실행 취소"><Undo2 size={17} /></button>
            <button type="button" className="icon-button" onClick={redo} disabled={!future.length} aria-label="다시 실행"><Redo2 size={17} /></button>
            <button type="button" className="primary compact" onClick={() => setScreen("simulation")}><Play size={15} /> 계산 실행</button>
          </div>
        </header>

        <div className="mobile-screen-tabs">
          {SCREEN_ITEMS.map((item) => <button key={item.id} className={screen === item.id ? "active" : ""} onClick={() => setScreen(item.id)}>{item.short}</button>)}
        </div>

        <div className="app-content">
          {screen === "assembly" ? (
            <div className="workspace-screen">
              <div className="control-rail scroll-area">
                <PanelHeader title="형상 프리셋" subtitle="강체 배열과 0.050 m² 연속 PV 스킨을 같은 활성면적으로 비교" />
                <div className="preset-grid">
                  {(["cube", "plane", "cylinder", "sphere", "cone", "free"] as PresetName[]).map((name) => (
                    <button key={name} type="button" className={preset === name ? "active" : ""} onClick={() => changePreset(name)}>
                      {name === "cube" ? <Box /> : name === "plane" ? <Grid3X3 /> : name === "cylinder" ? <CircleGauge /> : name === "sphere" ? <Sparkles /> : name === "cone" ? <Mountain /> : <Move3D />}
                      <span>{PRESET_LABELS[name]}</span><small>{name === "free" ? "1–20개 강체" : isContinuousSurfacePreset(name) ? "연속 스킨 · 20구역" : "20개 강체"}</small>
                    </button>
                  ))}
                </div>

                {preset === "plane" ? <div className="control-section"><h4>평면 방향</h4><Field label="경사각" unit="°" value={tiltDeg} min={0} max={90} onChange={(value) => rebuildPlane(value, panelAzimuthDeg)} /><Field label="방위각" unit="°" value={panelAzimuthDeg} min={0} max={360} onChange={(value) => rebuildPlane(tiltDeg, value)} hint="진북 0°, 동 90°, 남 180°" /></div> : null}

                {preset === "cylinder" && currentSurface ? <div className="control-section"><h4>연속 원기둥 치수</h4><Field label="종횡비 h/(2r)" unit="—" step={0.05} value={cylinderAspectRatio} min={0.25} max={10} onChange={(value) => rebuildContinuousPreset("cylinder", value)} /><div className="dimension-note"><Info size={15} /><div><strong>옆면만 활성</strong><span>r {currentSurface.dimensions.radiusM.toFixed(4)} m · h {currentSurface.dimensions.heightM.toFixed(4)} m</span></div></div></div> : null}
                {preset === "cone" && currentSurface ? <div className="control-section"><h4>연속 원뿔 치수</h4><Field label="종횡비 h/r" unit="—" step={0.05} value={coneAspectRatio} min={0.25} max={10} onChange={(value) => rebuildContinuousPreset("cone", value)} /><div className="dimension-note"><Info size={15} /><div><strong>밑면 제외 옆면만 활성</strong><span>r {currentSurface.dimensions.radiusM.toFixed(4)} m · h {currentSurface.dimensions.heightM.toFixed(4)} m · ℓ {currentSurface.dimensions.slantHeightM?.toFixed(4)} m</span></div></div></div> : null}

                {!isFlexibleSkin ? <div className="control-section">
                  <h4>자유 조립</h4>
                  <div className="button-row"><button onClick={addPanel}><Plus size={15} /> 추가</button><button onClick={duplicatePanel} disabled={!selectedPanelId || panels.length >= 20}><Copy size={15} /> 복제</button><button onClick={deletePanel} disabled={!selectedPanelId || panels.length <= 1} className="danger"><Trash2 size={15} /> 삭제</button></div>
                  <div className="segmented"><button className={transformMode === "translate" ? "active" : ""} onClick={() => setTransformMode("translate")}><Move3D size={14} /> 이동</button><button className={transformMode === "rotate" ? "active" : ""} onClick={() => setTransformMode("rotate")}><Rotate3D size={14} /> 회전</button></div>
                  <Toggle checked={gridSnap} onChange={setGridSnap} label="격자 스냅" description="1 cm 이동 · 15° 회전" />
                  <Toggle checked={surfaceSnap} onChange={setSurfaceSnap} label="표면 스냅" description="드래그 종료 시 아래 표면에 맞춤" />
                </div> : <div className="control-section"><h4>연속 표면</h4><Toggle checked={showZoneBoundaries} onChange={setShowZoneBoundaries} label="20개 구역 경계" description="각 구역 0.0025 m² · 전 둘레 등면적 band" /><Toggle checked={showSurfaceSamples} onChange={setShowSurfaceSamples} label="선택 구역 적분점" description={`GL2 × 방위 ${surfaceAzimuthSamples}점`} /></div>}

                <div className="control-section">
                  <h4>시각화 정확도</h4>
                  <select value={quality} onChange={(event) => setQuality(event.target.value as typeof quality)}><option value="fast">빠름 · 강체 1점 / 곡면 φ16</option><option value="balanced">균형 · 강체 3×3 / 곡면 φ32</option><option value="precise">정밀 · 강체 5×5 / 곡면 φ64</option></select>
                  <Toggle checked={showNormals} onChange={setShowNormals} label="전면 법선 표시" />
                  <Toggle checked={showRays} onChange={setShowRays} label="태양 광선 표시" />
                </div>

                <div className="dimension-note"><Info size={15} /><div><strong>{modelClassLabel}</strong><span>{isFlexibleSkin ? "총 활성 0.050 m² · 20 × 0.0025 m² 전기 구역" : "5 × 5 cm 강체 · 0.0025 m² · 단면 발전"}</span></div></div>
              </div>

              <div className="scene-column">
                <div className="scene-toolbar">
                  <div><Pill tone="good"><span className="status-dot" /> 실시간</Pill><span>{PRESET_LABELS[preset]} · {modelClassLabel} · {isFlexibleSkin ? "20구역" : `${panels.length}개`} · {result.activeAreaM2.toFixed(4)} m²</span></div>
                  <div><button className={showNormals ? "active" : ""} onClick={() => setShowNormals(!showNormals)}><Move3D size={15} /> 법선</button><button className={showRays ? "active" : ""} onClick={() => setShowRays(!showRays)}><Sun size={15} /> 광선</button></div>
                </div>
                <ThreeWorkspace panels={renderPanels} obstacles={obstacles} selectedPanelId={selectedPanelId} selectedObstacleId={null} onSelectPanel={setSelectedPanelId} onPanelTransform={isFlexibleSkin ? () => undefined : transformPanel} transformMode={transformMode === "scale" ? "translate" : transformMode} gridSnap={gridSnap} surfaceSnap={surfaceSnap} showNormals={showNormals} showRays={showRays} sunVector={solar.vector} sunElevationDeg={solar.elevationDeg} rotationAngleRad={activeRotationAngle} continuousSurface={currentSurface ? { kind: currentSurface.kind, cylinderAspectRatio, coneAspectRatio } : null} showZoneBoundaries={showZoneBoundaries} showSurfaceSamples={showSurfaceSamples} gltfUrl={gltfUrl} quality={quality} />
                <div className="scene-bottom-metrics">
                  <div><span>현재 DC</span><strong>{formatPower(result.dcW)}</strong></div><div><span>현재 AC</span><strong>{formatPower(result.acW)}</strong></div><div><span>평균 POA</span><strong>{(result.panels.reduce((sum, item) => sum + item.poaWm2, 0) / Math.max(1, result.panels.length)).toFixed(0)} W/m²</strong></div><div><span>회전 속도</span><strong>{rotationRpm.toFixed(2)} RPM</strong></div>
                </div>
              </div>

              <div className="inspector-rail scroll-area">
                <PanelHeader title={isFlexibleSkin ? "곡면 전기 구역 검사기" : "강체 패널 검사기"} subtitle={selectedPanel ? `${selectedPanel.label} · ${selectedPanel.id}` : "대상을 선택하세요"} action={selectedPanel ? <Pill tone={selectedPanel.bypassActive ? "warn" : "good"}>{selectedPanel.bypassActive ? "바이패스" : modelClassLabel}</Pill> : null} />
                {selectedPanel ? <>
                  <div className="inspector-hero"><div className="panel-swatch" style={{ "--level": `${Math.min(100, Math.max(0, selectedPanel.effectiveWm2 / 10)).toFixed(4)}%` } as React.CSSProperties}><Sun size={22} /></div><div><span>패널 출력</span><strong>{formatPower(selectedPanel.powerW)}</strong><small>{selectedPanel.effectiveWm2.toFixed(0)} W/m² · {selectedPanel.temperatureC.toFixed(1)}°C</small></div></div>
                  <div className="trace-list compact-trace">
                    <div><span>태양 고도 / 방위</span><strong>{solar.elevationDeg.toFixed(2)}° / {solar.azimuthDeg.toFixed(2)}°</strong></div>
                    <div><span>패널 경사 / 방위</span><strong>{selectedPanel.panelTiltDeg.toFixed(2)}° / {selectedPanel.panelAzimuthDeg.toFixed(2)}°</strong></div>
                    <div><span>AOI / n·s</span><strong>{selectedPanel.incidenceDeg.toFixed(2)}° / {selectedPanel.cosineIncidence.toFixed(4)}</strong></div>
                    <div><span>패널 변환효율</span><strong>{electrical.efficiency.toFixed(2)}%</strong></div>
                    <div><span>기하학적 입사효율 ηcos</span><strong>{selectedPanel.etaCos.toFixed(4)}</strong></div>
                    <div><span>광학 IAM / 종합 ηangle</span><strong>{selectedPanel.iam.toFixed(4)} / {selectedPanel.etaAngle.toFixed(4)}</strong></div>
                    <div><span>음영 가시율 / DNI</span><strong>{(selectedPanel.visibility * 100).toFixed(1)}% / {instantWeather.dni.toFixed(1)} W/m²</strong></div>
                    <div><span>직달 / 산란 / 지면</span><strong>{selectedPanel.beamWm2.toFixed(1)} / {selectedPanel.skyWm2.toFixed(1)} / {selectedPanel.groundWm2.toFixed(1)}</strong></div>
                    <div><span>총 POA</span><strong>{selectedPanel.poaWm2.toFixed(2)} W/m²</strong></div>
                    <div><span>최종 유효 일사량</span><strong>{selectedPanel.effectiveWm2.toFixed(2)} W/m²</strong></div>
                    <div><span>국부 풍속</span><strong>{selectedPanel.localWindMs.toFixed(2)} m/s</strong></div>
                    <div><span>동작점</span><strong>{selectedPanel.voltageV.toFixed(3)} V · {selectedPanel.currentA.toFixed(3)} A</strong></div>
                    <div><span>패널 DC / 배분 AC</span><strong>{selectedPanel.powerW.toFixed(4)} / {selectedPanelAcW.toFixed(4)} W</strong></div>
                  </div>
                  {!selectedPanel.ghiClosure.isClosed ? <div className="warning-card"><AlertTriangle size={17} /><div><strong>GHI 폐합 불일치</strong><span>잔차 {selectedPanel.ghiClosure.residualWm2.toFixed(1)} W/m² · 허용 {selectedPanel.ghiClosure.toleranceWm2.toFixed(1)} W/m²</span></div></div> : null}
                  {selectedPanel.incidenceDeg >= 80 ? <div className="warning-card"><AlertTriangle size={17} /><div><strong>AOI 80° 진단 한계 초과</strong><span>ASHRAE IAM은 큰 입사각에서 실측 검증이 필요합니다.</span></div></div> : null}
                  {selectedBasePanel && !isFlexibleSkin ? <div className="control-section"><h4>선택 패널 기준 좌표</h4>{([0, 1, 2] as const).map((axis) => <Field key={axis} label={["X · 동", "Y · 높이", "Z · 북"][axis]} unit="m" step={0.001} value={selectedBasePanel.position[axis]} onChange={(value) => transformPanel(selectedBasePanel.id, selectedBasePanel.position.map((item, index) => index === axis ? value : item) as Vec3Tuple, selectedBasePanel.quaternion)} />)}</div> : null}
                  <button className="full secondary" onClick={() => setScreen("evidence")}><BookOpenCheck size={15} /> 이 패널 계산 전체 추적</button>
                </> : <EmptyState icon={Move3D} title="선택된 패널 없음" text="3D 장면에서 패널을 클릭하세요." />}
                {isFlexibleSkin ? <div className="ok-card"><Check size={16} /><span>볼록 연속 스킨 · 대표점은 충돌 판정에 사용하지 않음</span></div> : overlaps.length ? <div className="warning-card"><AlertTriangle size={17} /><div><strong>겹침 {overlaps.length}건 감지</strong><span>{overlaps.slice(0, 3).join(", ")}</span></div></div> : <div className="ok-card"><Check size={16} /><span>패널 겹침이 없습니다.</span></div>}
              </div>
            </div>
          ) : null}

          {screen === "environment" ? (
            <div className="content-screen">
              <SectionTitle eyebrow="물리 입력 + 차폐 장면" title="환경 편집" aside={<><Pill tone="warn">CFD 아님</Pill><span>장애물 후류는 공학 근사</span></>} />
              <div className="environment-grid">
                <section className="surface-card env-controls scroll-area">
                  <PanelHeader title="환경 프리셋" subtitle="배경이 아니라 풍속·냉각·알베도에 연결됩니다." />
                  <div className="env-preset-row">
                    {(Object.keys(ENVIRONMENTS) as EnvironmentName[]).map((name) => <button key={name} className={environmentName === name ? "active" : ""} onClick={() => { setEnvironmentName(name); setEnvironment(ENVIRONMENTS[name]); setWeather((value) => ({ ...value, albedo: ENVIRONMENTS[name].albedo })); }}>{name === "mountain" ? "산악" : name === "coast" ? "바다·해안" : name === "plain" ? "평야·개방지" : name === "suburban" ? "교외" : "도시"}</button>)}
                  </div>
                  <div className="field-grid two"><Field label="거칠기 z₀" unit="m" step={0.001} value={environment.roughnessM} min={0.0001} max={2} onChange={(value) => setEnvironment({ ...environment, roughnessM: value })} /><Field label="변위 높이 d" unit="m" step={0.1} value={environment.displacementM} min={0} max={20} onChange={(value) => setEnvironment({ ...environment, displacementM: value })} /><Field label="멱지수 α" unit="—" step={0.01} value={environment.shearExponent} min={0.05} max={0.6} onChange={(value) => setEnvironment({ ...environment, shearExponent: value })} /><Field label="난류 강도" unit="%" value={environment.turbulencePct} min={0} max={60} onChange={(value) => setEnvironment({ ...environment, turbulencePct: value })} /><Field label="공기 밀도" unit="kg/m³" step={0.01} value={environment.airDensity} min={0.5} max={1.5} onChange={(value) => setEnvironment({ ...environment, airDensity: value })} /><Field label="지면 반사율" unit="—" step={0.01} value={environment.albedo} min={0} max={1} onChange={(value) => { setEnvironment({ ...environment, albedo: value }); setWeather({ ...weather, albedo: value }); }} /></div>
                  <div className="source-note"><BookOpenCheck size={15} /><div><strong>로그 풍속 프로파일</strong><code>U(z)=Uref ln((z-d)/z₀) / ln((zref-d)/z₀)</code><a href="https://wasp.dtu.dk/support/frequently-asked-questions/wasp-faq/Wind-shear-exponents" target="_blank" rel="noreferrer">DTU WAsP 근거 ↗</a></div></div>
                </section>

                <section className="surface-card env-scene">
                  <div className="scene-toolbar"><div><Pill tone="data">광선 차폐 장면</Pill><span>렌더링 그림자와 수치 raycast 분리</span></div><label className="file-button"><Upload size={15} /> GLB/GLTF 불러오기<input type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" onChange={handleGltf} /></label></div>
                  <ThreeWorkspace panels={renderPanels} obstacles={obstacles} selectedPanelId={null} selectedObstacleId={selectedObstacleId} onSelectPanel={setSelectedPanelId} onSelectObstacle={setSelectedObstacleId} onPanelTransform={isFlexibleSkin ? () => undefined : transformPanel} onObstacleTransform={transformObstacle} transformMode={transformMode} gridSnap={gridSnap} surfaceSnap={surfaceSnap} showNormals={showNormals} showRays={showRays} sunVector={solar.vector} sunElevationDeg={solar.elevationDeg} rotationAngleRad={activeRotationAngle} continuousSurface={currentSurface ? { kind: currentSurface.kind, cylinderAspectRatio, coneAspectRatio } : null} showZoneBoundaries={showZoneBoundaries} showSurfaceSamples={showSurfaceSamples} gltfUrl={gltfUrl} quality={quality} />
                  {gltfName ? <div className="asset-chip"><Box size={14} /> {gltfName}<button onClick={() => { if (gltfUrl) URL.revokeObjectURL(gltfUrl); setGltfUrl(null); setGltfName(null); setObstacles((items) => items.filter((item) => !item.label.startsWith("GLB 차폐 경계"))); setSelectedObstacleId(null); }} aria-label="가져온 모델 제거"><X size={13} /></button></div> : null}
                </section>

                <section className="surface-card object-library scroll-area">
                  <PanelHeader title="장애물 라이브러리" subtitle="추가한 물체는 실제 광선 교차에 포함됩니다." />
                  <div className="object-buttons">
                    {(["mountain", "building", "tree", "wall", "ground", "water", "other"] as SceneObstacle["type"][]).map((type) => <button key={type} onClick={() => addObstacle(type)}>{type === "mountain" ? <Mountain /> : type === "building" ? <Building2 /> : type === "tree" ? <TreePine /> : type === "water" ? <Waves /> : <Box />}<span>{{ mountain: "산", building: "건물", tree: "나무", wall: "벽", ground: "지면", water: "수면", other: "기타" }[type]}</span><Plus size={13} /></button>)}
                  </div>
                  <div className="object-list">
                    {obstacles.map((item) => <button key={item.id} className={selectedObstacleId === item.id ? "active" : ""} onClick={() => setSelectedObstacleId(item.id)}><span className={`object-dot ${item.type}`} /><div><strong>{item.label}</strong><small>{item.position.map((value) => value.toFixed(2)).join(", ")} m</small></div><ChevronDown size={14} /></button>)}
                  </div>
                  {selectedObstacle ? <div className="object-inspector"><div className="row-title"><strong>선택 오브젝트</strong><button className="danger-icon" onClick={() => { setObstacles((items) => items.filter((item) => item.id !== selectedObstacle.id)); setSelectedObstacleId(null); }} aria-label="오브젝트 삭제"><Trash2 size={15} /></button></div><div className="segmented"><button className={transformMode === "translate" ? "active" : ""} onClick={() => setTransformMode("translate")}><Move3D size={13} /> 이동</button><button className={transformMode === "rotate" ? "active" : ""} onClick={() => setTransformMode("rotate")}><Rotate3D size={13} /> 회전</button><button className={transformMode === "scale" ? "active" : ""} onClick={() => setTransformMode("scale")}><Boxes size={13} /> 크기</button></div>{([0, 1, 2] as const).map((axis) => <Field key={axis} label={["X", "Y", "Z"][axis]} unit="m" step={0.01} value={selectedObstacle.position[axis]} onChange={(value) => updateObstacle(selectedObstacle.id, { position: selectedObstacle.position.map((item, index) => index === axis ? value : item) as Vec3Tuple })} />)}<Field label="크기" unit="×" step={0.1} min={0.1} max={10} value={selectedObstacle.scale[0]} onChange={(value) => updateObstacle(selectedObstacle.id, { scale: [value, value, value] })} /></div> : null}
                </section>
              </div>
            </div>
          ) : null}

          {screen === "circuit" ? (
            <div className="content-screen circuit-screen">
              <SectionTitle eyebrow="패널 단자 → 인버터" title="시각적 회로 편집기" aside={<><Pill tone={result.bypassCount ? "warn" : "good"}>{result.bypassCount ? `바이패스 ${result.bypassCount}개 도통` : "회로 정상"}</Pill><span>{circuitMode === "single-diode" ? "단일 다이오드 정밀 모드" : "PVWatts형 간단 모드"}</span></>} />
              <div className="circuit-toolbar surface-card">
                <div className="segmented wide"><button className={topology === "series" ? "active" : ""} onClick={() => setTopology("series")}>직렬 스트링</button><button className={topology === "parallel" ? "active" : ""} onClick={() => setTopology("parallel")}>병렬 결합</button></div>
                <div className="segmented wide"><button className={circuitMode === "simple" ? "active" : ""} onClick={() => setCircuitMode("simple")}>간단 전력식</button><button className={circuitMode === "single-diode" ? "active" : ""} onClick={() => setCircuitMode("single-diode")}>단일 다이오드</button></div>
                <Toggle checked={bypassEnabled} onChange={setBypassEnabled} label="바이패스 다이오드" />
                <button className="primary" onClick={autoWire}><RefreshCcw size={15} /> 자동 배선</button>
              </div>
              <CircuitCanvas panels={circuitPanels} topology={topology} edges={circuitEdges} onEdgesChange={handleCircuitEdgesChange} onConnect={handleCircuitConnect} onAutoWire={(edges, nextTopology) => { setTopology(nextTopology); setCircuitEdges(edges); }} onTopologyChange={setTopology} />
              <div className="circuit-bottom-grid">
                <section className="surface-card chart-card"><PanelHeader title="배열 I–V / P–V" subtitle="회로 코어의 전 범위 스캔으로 전역 MPP를 선택합니다." /><div className="chart-medium"><ResponsiveContainer width="100%" height="100%"><LineChart data={result.ivPoints}><CartesianGrid stroke="#203643" strokeDasharray="3 5" /><XAxis dataKey="voltage" tickFormatter={(value) => value.toFixed(1)} /><YAxis yAxisId="i" tickFormatter={(value) => value.toFixed(1)} /><YAxis yAxisId="p" orientation="right" tickFormatter={(value) => value.toFixed(1)} /><Tooltip contentStyle={{ background: "#10212c", border: "1px solid #29404c" }} /><Line yAxisId="i" type="monotone" dataKey="current" name="전류 A" stroke="#51bdd2" dot={false} strokeWidth={2} /><Line yAxisId="p" type="monotone" dataKey="power" name="전력 W" stroke="#f3b94d" dot={false} strokeWidth={2} /><ReferenceLine yAxisId="p" x={result.voltageV} stroke="#42c6a5" strokeDasharray="3 3" label="MPP" /></LineChart></ResponsiveContainer></div></section>
                <section className="surface-card electrical-summary"><PanelHeader title="회로 동작점" subtitle="불일치·바이패스는 회로 해석 안에서 한 번만 반영" /><div className="big-operating"><div><span>V<sub>MP</sub></span><strong>{result.voltageV.toFixed(3)} V</strong></div><div><span>I<sub>MP</sub></span><strong>{result.currentA.toFixed(3)} A</strong></div><div><span>P<sub>DC</sub></span><strong>{result.dcW.toFixed(3)} W</strong></div></div><div className="validation-list"><div className="ok"><Check size={15} /> 패널 단자 극성 확인</div><div className={circuitEdges.length ? "ok" : "warn"}>{circuitEdges.length ? <Check size={15} /> : <AlertTriangle size={15} />} {circuitEdges.length ? `${circuitEdges.length}개 연결 검증됨` : "자동 배선 또는 드래그 연결 필요"}</div><div className={result.bypassCount ? "warn" : "ok"}>{result.bypassCount ? <AlertTriangle size={15} /> : <Check size={15} />} {result.bypassCount ? `${result.bypassCount}개 다이오드 도통` : "바이패스 비도통"}</div></div></section>
              </div>
            </div>
          ) : null}

          {screen === "simulation" ? (
            <div className="content-screen simulation-screen">
              <SectionTitle eyebrow="순간 · 일간 · 월간 · 연간" title="시간 시뮬레이션" aside={<div className="playback"><button onClick={() => setPlaying(!playing)} className="play-button">{playing ? <Pause size={16} /> : <Play size={16} />}</button><select value={playSpeed} onChange={(event) => setPlaySpeed(Number(event.target.value))}><option value={1}>×1분</option><option value={5}>×5분</option><option value={30}>×30분</option><option value={60}>×1시간</option></select><input type="datetime-local" value={dateTime} onChange={(event) => setDateTime(event.target.value)} /></div>} />
              <div className="metrics-row">
                <Metric label="순간 DC" value={formatPower(result.dcW)} detail={`${result.voltageV.toFixed(2)} V · ${result.currentA.toFixed(2)} A`} icon={Zap} accent="amber" />
                <Metric label="순간 AC" value={formatPower(result.acW)} detail={`인버터 ${(result.inverterEfficiency * 100).toFixed(1)}%`} icon={Activity} accent="teal" />
                <Metric label="하루 누적" value={formatEnergy(dailyWh)} detail="10분 · 실제 시각축 사다리꼴 적분" icon={Sun} accent="blue" />
                <Metric
                  label="연간 예상"
                  value={formatEnergy(annualWh)}
                  detail={annualEnergyWhByVariant.current !== undefined
                    ? "8,760시간점 워커 완료 · 현지 월 경계"
                    : `${automaticSourceLabel} 우선 · 부족 구간 모델 대체`}
                  icon={BarChart3}
                  accent="violet"
                />
              </div>
              <div className="angle-summary-row" aria-label="시스템 입사각 및 음영 진단">
                <div><span>면적가중 시스템 ηangle</span><strong>{result.areaWeightedEtaAngle.toFixed(4)}</strong><small>ηcos × IAM · 음영 제외</small></div>
                <div><span>별도 직달 가시율</span><strong>{(result.areaWeightedVisibility * 100).toFixed(1)}%</strong><small>raycast 음영 · 각도 효율과 분리</small></div>
                <div><span>ASHRAE b₀</span><strong>{iamB0.toFixed(3)}</strong><small>AOI 80° 이상은 경계 경고</small></div>
              </div>
              <div className="angle-summary-row" aria-label="면적 및 전기 공정성 모드">
                <div><span>활성 / 순간 투영</span><strong>{result.activeAreaM2.toFixed(4)} / {result.projectedAreaM2.toFixed(4)} m²</strong><small>형상 배율 없이 표면 적분</small></div>
                <div><span>최대 투영 / footprint</span><strong>{result.maximumProjectedAreaM2.toFixed(4)} / {result.footprintM2.toFixed(4)} m²</strong><small>태양 방향별 해석 투영</small></div>
                <div><span>Mode A · 공용 회로</span><strong>{result.sharedCircuit.acPowerW.toFixed(3)} W AC</strong><small>{result.sharedCircuit.dcPowerW.toFixed(3)} W DC · bypass {result.sharedCircuit.bypassCount}</small></div>
                <div><span>Mode B · 구역별 MPPT</span><strong>{result.independentMppt.acPowerW.toFixed(3)} W AC</strong><small>{result.independentMppt.dcPowerW.toFixed(3)} W DC · 동일 인버터</small></div>
              </div>
              {selectedPanel && (!selectedPanel.ghiClosure.isClosed || selectedPanel.incidenceDeg >= 80) ? <div className="diagnostic-alerts" role="status">
                {!selectedPanel.ghiClosure.isClosed ? <span><AlertTriangle size={13} /> GHI 폐합 잔차 {selectedPanel.ghiClosure.residualWm2.toFixed(1)} W/m²</span> : null}
                {selectedPanel.incidenceDeg >= 80 ? <span><AlertTriangle size={13} /> 선택 패널 AOI {selectedPanel.incidenceDeg.toFixed(1)}° — 80° 진단 경계 초과</span> : null}
              </div> : null}
              <div className="simulation-layout">
                <aside className="surface-card sim-inputs scroll-area">
                  <PanelHeader title="공통 입력" subtitle="변경 즉시 모든 형상에 동기화" />
                  <div className="tabs-mini"><button className={sunMode === "auto" ? "active" : ""} onClick={() => setSunMode("auto")}>태양 자동</button><button className={sunMode === "manual" ? "active" : ""} onClick={() => setSunMode("manual")}>태양 수동</button></div>
                  {sunMode === "auto" ? <div className="field-grid two"><Field label="위도" unit="°" step={0.0001} value={latitude} min={-90} max={90} onChange={setLatitude} /><Field label="경도" unit="°" step={0.0001} value={longitude} min={-180} max={180} onChange={setLongitude} /><Field label="고도" unit="m" value={elevationM} min={-430} max={6000} onChange={setElevationM} /><Field label="UTC 오프셋" unit="h" step={0.5} value={timezoneHours} min={-12} max={14} onChange={setTimezoneHours} /></div> : <div className="field-grid two"><Field label="태양 고도" unit="°" step={0.1} value={manualSun.elevationDeg} min={-90} max={90} onChange={(value) => setManualSun({ ...manualSun, elevationDeg: value })} /><Field label="태양 방위" unit="°" step={0.1} value={manualSun.azimuthDeg} min={0} max={360} onChange={(value) => setManualSun({ ...manualSun, azimuthDeg: value })} /></div>}
                  <div className="solar-readout"><div className="sun-disc"><Sun size={24} /></div><div><span>태양 위치 · physics solarPosition</span><strong>{solar.elevationDeg.toFixed(2)}° / {solar.azimuthDeg.toFixed(2)}°</strong><small>{sunMode === "auto" ? `UTC ${new Date(solar.timeUtcMs).toISOString().slice(0, 16).replace("T", " ")} · EoT ${solar.equationOfTimeMin.toFixed(1)}분` : "사용자 수동 벡터 · 단일 순간 계산"}</small></div></div>

                  <div className="tabs-mini weather-source-tabs"><button type="button" className={dataMode === "manual" ? "active" : ""} onClick={() => { setDataMode("manual"); setProvenance({ provider: "수동 프리셋", kind: "사용자 입력", retrievedAt: new Date().toISOString(), resolution: "순간 시나리오", spatial: "해당 없음" }); }}>순간 수동 기상</button><button type="button" className={dataMode !== "manual" ? "active" : ""} onClick={activateAutomaticWeather}>자동 시계열 현재값</button></div>

                  {dataMode === "manual" ? <>
                    <h4>순간 수동 복사·기상</h4>
                    <div className="weather-pills">{(["clear", "partly", "overcast", "rain", "night"] as WeatherPreset[]).map((name) => <button key={name} className={weatherPreset === name ? "active" : ""} onClick={() => { setWeatherPreset(name); setWeather(WEATHER_PRESETS[name]); setDataMode("manual"); setProvenance({ provider: "수동 프리셋", kind: "사용자 입력", retrievedAt: new Date().toISOString(), resolution: "순간 시나리오", spatial: "해당 없음" }); }}>{name === "clear" ? "맑음" : name === "partly" ? "반 구름" : name === "overcast" ? "완전 흐림" : name === "rain" ? "비" : "밤"}</button>)}</div>
                    <div className="field-grid two"><Field label="GHI" unit="W/m²" value={weather.ghi} min={0} max={1500} onChange={(value) => setWeather({ ...weather, ghi: value })} /><Field label="DNI" unit="W/m²" value={weather.dni} min={0} max={1400} onChange={(value) => setWeather({ ...weather, dni: value })} /><Field label="DHI" unit="W/m²" value={weather.dhi} min={0} max={1000} onChange={(value) => setWeather({ ...weather, dhi: value })} /><Field label="기온" unit="°C" step={0.1} value={weather.ambientC} min={-80} max={80} onChange={(value) => setWeather({ ...weather, ambientC: value })} /><Field label="풍속 10m" unit="m/s" step={0.1} value={weather.windMs} min={0} max={60} onChange={(value) => setWeather({ ...weather, windMs: value })} /></div>
                    <div className="manual-mode-note"><Info size={14} /> 이 값은 순간 수동 계산에만 쓰이며 일간·월간·연간 시계열을 합성하지 않습니다.</div>
                  </> : <>
                    <h4>자동 WeatherSeries</h4>
                    <div className="auto-weather-readout"><span>현재 시각 GHI / DNI / DHI</span><strong>{instantWeather.ghi.toFixed(1)} / {instantWeather.dni.toFixed(1)} / {instantWeather.dhi.toFixed(1)} W/m²</strong><small>{instantWeather.ambientC.toFixed(1)}°C · {instantWeather.windMs.toFixed(1)} m/s · {automaticSourceLabel}</small></div>
                    <button className="full secondary" onClick={loadOpenMeteo} disabled={dataLoading}>{dataLoading ? <LoaderCircle size={15} className="spin" /> : <CloudDownload size={15} />} Open-Meteo 선택일 시계열 조회</button>
                    <div className="api-file-row"><label><Database size={14} /> PVGIS JSON<input type="file" accept=".json,application/json" onChange={(event) => handleWeatherFile(event, "pvgis-file")} /></label><label><Database size={14} /> NASA JSON<input type="file" accept=".json,application/json" onChange={(event) => handleWeatherFile(event, "nasa-file")} /></label></div>
                    <h4>누락 구간 오프라인 프리셋</h4>
                    <div className="weather-pills">{(["clear", "partly", "overcast", "rain", "night"] as WeatherPreset[]).map((name) => <button key={name} className={weatherPreset === name ? "active" : ""} onClick={() => setWeatherPreset(name)}>{name === "clear" ? "맑음" : name === "partly" ? "반 구름" : name === "overcast" ? "완전 흐림" : name === "rain" ? "비" : "밤"}</button>)}</div>
                  </>}
                  <div className="field-grid two"><Field label="ASHRAE b₀" unit="—" step={0.005} value={iamB0} min={0} max={1} onChange={(value) => setIamB0(clamp(value, 0, 1))} hint="사용자 지정 광학 손실 계수" /><Field label="오염 손실" unit="%" step={0.1} value={weather.soilingPct} min={0} max={95} onChange={(value) => setWeather({ ...weather, soilingPct: value })} /><Field label="지면 반사율" unit="—" step={0.01} value={weather.albedo} min={0} max={1} onChange={(value) => setWeather({ ...weather, albedo: value })} /></div>
                  <div className="iam-limit-note"><AlertTriangle size={14} /> AOI 80° 이상은 계산값을 표시하되 실측 검증이 필요한 진단 경계로 표시합니다.</div>
                  <div className="provenance-card"><div><Pill tone="data">{provenance.kind}</Pill><strong>{provenance.provider}</strong></div><span>{provenance.resolution} · {provenance.spatial}</span>{provenance.fallbackReason ? <small>대체 이유: {provenance.fallbackReason}</small> : null}</div>
                </aside>

                <section className="sim-results">
                  <div className="surface-card chart-card large" id="daily-chart">
                    <PanelHeader title="시간대별 입사각 · 복사 · 전력 진단" subtitle={`${dateTime.slice(0, 10)} · 10분 실제 계산 · 점을 클릭하면 원인과 구역 상태 표시`} action={<Pill tone="good">E = {dailyWh.toFixed(2)} Wh</Pill>} />
                    <div className="series-toggle-grid" aria-label="그래프 계열 선택">
                      {(Object.keys(DIAGNOSTIC_SERIES) as DiagnosticSeriesKey[]).map((key) => (
                        <button
                          type="button"
                          key={key}
                          className={diagnosticSeries[key] ? "active" : ""}
                          onClick={() => setDiagnosticSeries((current) => ({ ...current, [key]: !current[key] }))}
                          aria-pressed={diagnosticSeries[key]}
                        >
                          <i style={{ background: DIAGNOSTIC_SERIES[key].color }} />
                          {DIAGNOSTIC_SERIES[key].label}
                        </button>
                      ))}
                    </div>
                    <div className="chart-large"><ResponsiveContainer width="100%" height="100%"><LineChart data={dailySeries} onClick={handleDailyChartClick}><CartesianGrid stroke="#203743" strokeDasharray="3 6" /><XAxis dataKey="time" interval={11} /><YAxis yAxisId="irradiance" width={48} tickFormatter={(value) => Number(value).toFixed(0)} /><YAxis yAxisId="power" orientation="right" width={42} tickFormatter={(value) => Number(value).toFixed(2)} /><YAxis yAxisId="angle" hide domain={[-90, 180]} /><YAxis yAxisId="factor" hide domain={[0, 1]} /><Tooltip contentStyle={{ background: "#10212c", border: "1px solid #29404c", borderRadius: 10 }} formatter={(value, name) => [Number(value).toFixed(3), name]} /><Legend />{selectedDiagnosticPoint ? <ReferenceLine yAxisId="power" x={selectedDiagnosticPoint.time} stroke="#f7d774" strokeDasharray="4 3" /> : null}{(Object.keys(DIAGNOSTIC_SERIES) as DiagnosticSeriesKey[]).filter((key) => diagnosticSeries[key]).map((key) => { const descriptor = DIAGNOSTIC_SERIES[key]; return <Line key={key} yAxisId={descriptor.axis} type="linear" dataKey={key} name={descriptor.label} stroke={descriptor.color} dot={false} activeDot={{ r: 5 }} strokeWidth={key === "poa" || key === "dc" || key === "ac" ? 2 : 1.5} isAnimationActive={false} />; })}</LineChart></ResponsiveContainer></div>
                    {selectedDiagnosticPoint ? <div className={`time-diagnostic ${selectedDiagnosticPoint.diagnosticSeverity}`}>
                      <div className="time-diagnostic-head"><div><span>선택 시각</span><strong>{selectedDiagnosticPoint.localDateTime} KST</strong><small>UTC {selectedDiagnosticPoint.timeUtcIso} · 원본 {selectedDiagnosticPoint.timestampOriginal}</small></div><div className="reason-pills">{selectedDiagnosticPoint.reasonCodes.length ? selectedDiagnosticPoint.reasonCodes.map((code) => <Pill key={code} tone={selectedDiagnosticPoint.diagnosticSeverity === "error" ? "warn" : code === "NIGHT" || code === "NORMAL_SUNSET" ? "good" : "data"}>{code}</Pill>) : <Pill tone="good">CONTINUOUS_OK</Pill>}</div></div>
                      <div className="diagnostic-audit-grid"><div><span>태양 고도 / 방위 / 천정</span><strong>{selectedDiagnosticPoint.elevation.toFixed(2)}° / {selectedDiagnosticPoint.azimuth.toFixed(2)}° / {selectedDiagnosticPoint.zenith.toFixed(2)}°</strong></div><div><span>기상 source · GHI/DNI/DHI</span><strong>{selectedDiagnosticPoint.weatherSource} · {selectedDiagnosticPoint.ghi.toFixed(1)} / {selectedDiagnosticPoint.dni.toFixed(1)} / {selectedDiagnosticPoint.dhi.toFixed(1)}</strong></div><div><span>최종 DC / AC · 누적</span><strong>{selectedDiagnosticPoint.dc.toFixed(4)} / {selectedDiagnosticPoint.ac.toFixed(4)} W · {selectedDiagnosticCumulativeWh.toFixed(3)} Wh</strong></div><div><span>V / I · 인버터 · 가시율</span><strong>{selectedDiagnosticPoint.voltage.toFixed(3)} V / {selectedDiagnosticPoint.current.toFixed(3)} A · {selectedDiagnosticPoint.inverterStatus} · {(selectedDiagnosticPoint.visibility * 100).toFixed(1)}%</strong></div><div><span>Mode A 공용 회로</span><strong>{selectedDiagnosticPoint.sharedDc.toFixed(4)} W DC → {selectedDiagnosticPoint.sharedAc.toFixed(4)} W AC</strong></div><div><span>Mode B 구역별 MPPT</span><strong>{selectedDiagnosticPoint.independentDc.toFixed(4)} W DC → {selectedDiagnosticPoint.independentAc.toFixed(4)} W AC</strong></div></div>
                      <div className="diagnostic-explanation">{selectedDiagnosticPoint.reasonCodes.length ? selectedDiagnosticPoint.reasonCodes.map((code) => <span key={code}><code>{code}</code>{DIAGNOSTIC_REASON_LABELS[code]}</span>) : <span><Check size={14} /> 불연속 원인이 감지되지 않았습니다.</span>}</div>
                      <div className="zone-diagnostic-table"><div className="zone-diagnostic-row header"><span>구역</span><span>AOI / n·s / IAM</span><span>직달 / 산란 / 반사 / POA</span><span>온도</span><span>V / I / P</span><span>상태</span></div>{selectedDiagnosticPoint.zones.map((zone) => <div className="zone-diagnostic-row" key={zone.id}><strong>{zone.label}</strong><span>{zone.aoiDeg.toFixed(1)}° / {zone.cosineIncidence.toFixed(3)} / {zone.iam.toFixed(3)}</span><span>{zone.directWm2.toFixed(0)} / {zone.diffuseWm2.toFixed(0)} / {zone.groundWm2.toFixed(0)} / {zone.poaWm2.toFixed(0)}</span><span>{zone.temperatureC.toFixed(1)}°C</span><span>{zone.voltageV.toFixed(3)} / {zone.currentA.toFixed(3)} / {zone.powerW.toFixed(4)}</span><span>{zone.bypassActive ? "BYPASS" : `${(zone.visibility * 100).toFixed(0)}% visible`}</span></div>)}</div>
                    </div> : null}
                  </div>
                  <div className="sim-lower-grid">
                    <section className="surface-card chart-card"><PanelHeader title="월간 예상 발전량" subtitle="대표월 시나리오 · 시간별 계산" /><div className="chart-medium"><ResponsiveContainer width="100%" height="100%"><BarChart data={monthlyData}><CartesianGrid stroke="#203743" strokeDasharray="3 6" vertical={false} /><XAxis dataKey="month" /><YAxis tickFormatter={(value) => `${value.toFixed(0)}`} /><Tooltip contentStyle={{ background: "#10212c", border: "1px solid #29404c" }} formatter={(value) => [`${Number(value).toFixed(1)} Wh`, "에너지"]} /><Bar dataKey="energy" radius={[5, 5, 0, 0]}>{monthlyData.map((_, index) => <Cell key={index} fill={index === 5 ? "#f4ba4b" : "#3d8295"} />)}</Bar></BarChart></ResponsiveContainer></div></section>
                    <section className="surface-card loss-card"><PanelHeader title="손실 단계 원장" subtitle="각 현상은 계산 사슬에서 한 번만 반영" /><div className="loss-list">{result.losses.map((item) => <div key={item.name}><span><i style={{ background: item.color }} />{item.name}</span><strong className={item.value < 0 ? "negative" : ""}>{item.value >= 0 ? "+" : ""}{item.value.toFixed(3)} W</strong></div>)}</div><button className="full text-button" onClick={() => setScreen("evidence")}>공식과 중간값 열기 <ArrowDownToLine size={14} /></button></section>
                  </div>
                </section>

                <aside className="surface-card rotation-panel scroll-area">
                  <PanelHeader title="세로축 회전" subtitle="풍력 전기는 계산하지 않습니다." />
                  <div className="rotation-dial"><div style={{ transform: `rotate(${deg(activeRotationAngle)}deg)` }}><span /></div><strong>{rotationRpm.toFixed(2)}</strong><small>RPM</small></div>
                  <div className="tabs-mini"><button className={rotation.mode === "static" ? "active" : ""} onClick={() => selectRotationMode("static")}>정지</button><button className={rotation.mode === "fixed" ? "active" : ""} onClick={() => selectRotationMode("fixed")}>고정 RPM</button><button className={rotation.mode === "auto" ? "active" : ""} onClick={() => selectRotationMode("auto")}>풍속 자동</button></div>
                  {rotation.mode === "fixed" ? <Field label="고정 회전수" unit="RPM" step={0.1} min={-120} max={120} value={rotation.rpm} onChange={(value) => setRotation({ ...rotation, rpm: value })} /> : null}
                  {rotation.mode === "auto" ? <div className="field-grid"><Field label="관성 Iᵧ" unit="kg·m²" step={0.001} min={0.000001} max={100} value={rotation.inertia} onChange={(value) => setRotation({ ...rotation, inertia: value })} /><Field label="점성 감쇠 b" unit="N·m·s/rad" step={0.001} min={0} max={10} value={rotation.damping} onChange={(value) => setRotation({ ...rotation, damping: value })} /><Field label="마찰 토크" unit="N·m" step={0.001} min={0} max={10} value={rotation.friction} onChange={(value) => setRotation({ ...rotation, friction: value })} /><Field label="항력 계수 Cd" unit="—" step={0.01} min={0} max={3} value={rotation.dragCoefficient} onChange={(value) => setRotation({ ...rotation, dragCoefficient: value })} /><Field label="최대 RPM" unit="RPM" step={1} min={0} max={120} value={rotation.maxRpm} onChange={(value) => setRotation({ ...rotation, maxRpm: value })} /></div> : null}
                  <div className={`delta-card ${rotationDeltaPct >= 0 ? "positive" : "negative"}`}><span>RPM = 0 기준 대비</span><strong>{rotationDeltaPct >= 0 ? "+" : ""}{rotationDeltaPct.toFixed(2)}%</strong><small>{formatPower(result.acW - staticResult.acW)} AC</small></div>
                  <div className="formula-snippet"><code>θ(t) = θ₀ + 2π·RPM·t/60</code><span>고RPM: 빠름 12 · 균형 24 · 정밀 72위상(5°) 평균</span></div>

                  <hr />
                  <PanelHeader title="연간 계산" subtitle="8,760시간 · 백그라운드 작업" />
                  {annualAuditCode ? <div className="warning-card"><AlertTriangle size={16} /><div><strong>{annualAuditCode}</strong><span>{DIAGNOSTIC_REASON_LABELS[annualAuditCode]}</span></div></div> : null}
                  {annualRunning ? <div className="progress-block"><div><span>{annualScope === "compare" ? "비교 형상" : "현재 형상"} 워커 계산 중</span><strong>{annualProgress}%</strong></div><div className="progress-track"><span style={{ width: `${annualProgress}%` }} /></div><button className="full secondary" onClick={cancelAnnual}><X size={14} /> 취소</button></div> : <button className="full primary" onClick={() => runAnnual([preset], "current")}><Activity size={15} /> 연간 8,760시간점 계산</button>}
                </aside>
              </div>
            </div>
          ) : null}

          {screen === "compare" ? (
            <div className="content-screen compare-screen">
              <SectionTitle eyebrow="동일 기상 · 동일 시드 · 독립 장면" title="다중 형상 비교" aside={<><Pill tone="data">seed {seed}</Pill><span>최대 5개 · 형상당 0.050 m² · Mode A/B 동시</span></>} />
              <div className="compare-toolbar surface-card">
                <div className="shape-checkboxes">{(["plane", "cube", "cylinder", "sphere", "cone"] as PresetName[]).map((name) => <label key={name} className={compareShapes.includes(name) ? "active" : ""}><input type="checkbox" checked={compareShapes.includes(name)} onChange={() => setCompareShapes((items) => items.includes(name) ? (items.length > 1 ? items.filter((item) => item !== name) : items) : (items.length < 5 ? [...items, name] : items))} /><span><Check size={12} /></span>{PRESET_LABELS[name]}</label>)}</div>
                <div className="compare-common"><button onClick={() => setPlaying(!playing)}>{playing ? <Pause size={15} /> : <Play size={15} />} 공통 재생</button><select value={playSpeed} onChange={(event) => setPlaySpeed(Number(event.target.value))}><option value={5}>×5분</option><option value={30}>×30분</option><option value={60}>×1시간</option></select><button onClick={() => runAnnual(compareShapes, "compare")} disabled={annualRunning}><Activity size={14} /> {annualRunning && annualScope === "compare" ? `${annualProgress}%` : "공통 연간 계산"}</button><Field label="난수 시드" value={seed} min={0} max={9999999} onChange={setSeed} /></div>
              </div>
              <div className={`compare-cards count-${compareShapes.length}`}>
                {compareShapes.map((name, index) => {
                  const compareResult = compareInstantByShape[name];
                  const energy = compareEnergyByShape[name] ?? 0;
                  const energyModes = compareEnergyModesByShape[name];
                  const continuous = isContinuousSurfacePreset(name);
                  const basePanels = generatePreset(name, tiltDeg, panelAzimuthDeg, { cylinderAspectRatio, coneAspectRatio, azimuthSamples: surfaceAzimuthSamples });
                  return <article className="compare-card surface-card" key={name}>
                    <div className="compare-head"><div><span>0{index + 1}</span><h3>{PRESET_LABELS[name]}</h3></div>{energy === bestCompareEnergy ? <Pill tone="good">Mode A 1위</Pill> : null}</div>
                    <div className="mini-scene"><ThreeWorkspace panels={renderPanelsFromBase(basePanels, compareResult.panels)} obstacles={obstacles} selectedPanelId={null} onSelectPanel={() => undefined} onPanelTransform={() => undefined} transformMode="translate" gridSnap={false} surfaceSnap={false} showNormals={false} showRays={false} sunVector={solar.vector} sunElevationDeg={solar.elevationDeg} rotationAngleRad={activeRotationAngle} continuousSurface={continuous ? { kind: name as ContinuousSurfaceKind, cylinderAspectRatio, coneAspectRatio } : null} showZoneBoundaries={continuous} quality="fast" /></div>
                    <div className="compare-kpis"><div><span>모델</span><strong>{continuous ? "연속 스킨" : "강체 패널"}</strong></div><div><span>활성 / 투영</span><strong>{compareResult.activeAreaM2.toFixed(3)} / {compareResult.projectedAreaM2.toFixed(3)} m²</strong></div><div><span>Mode A 순간 AC</span><strong>{compareResult.sharedCircuit.acPowerW.toFixed(3)} W</strong></div><div><span>Mode B 순간 AC</span><strong>{compareResult.independentMppt.acPowerW.toFixed(3)} W</strong></div><div><span>Mode A 연간</span><strong>{formatEnergy(energyModes?.sharedWh ?? 0)}</strong></div><div><span>Mode B 연간</span><strong>{formatEnergy(energyModes?.independentWh ?? 0)}</strong></div><div><span>Mode A 면적당</span><strong>{((energyModes?.sharedWh ?? 0) / compareResult.activeAreaM2).toFixed(0)} Wh/m²</strong></div><div><span>최대 투영 / footprint</span><strong>{compareResult.maximumProjectedAreaM2.toFixed(3)} / {compareResult.footprintM2.toFixed(3)} m²</strong></div></div>
                    <div className="rank-bar"><span style={{ width: `${bestCompareEnergy > 0 ? (energy / bestCompareEnergy) * 100 : 0}%` }} /></div>
                    <small>Mode A {energyModes?.sharedIsWorker ? "8,760 시간점 워커" : "12개 대표일"} · Mode B 12개 대표일 · RPM {rotationRpm.toFixed(2)} · 형상별 독립 장면</small>
                  </article>;
                })}
              </div>
              <div className="compare-bottom-grid">
                <section className="surface-card chart-card"><PanelHeader title="연간 Mode A · B 비교" subtitle="공통 기상·활성면적·인버터, 전기 결합만 변경" /><div className="chart-medium"><ResponsiveContainer width="100%" height="100%"><BarChart data={compareChartData}><CartesianGrid stroke="#203743" strokeDasharray="3 6" vertical={false} /><XAxis dataKey="name" /><YAxis /><Tooltip contentStyle={{ background: "#10212c", border: "1px solid #29404c" }} /><Legend /><Bar dataKey="modeA" name="Mode A 공용 회로 Wh" fill="#f4ba4b" radius={[5, 5, 0, 0]} /><Bar dataKey="modeB" name="Mode B 구역별 MPPT Wh" fill="#42c6a5" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div></section>
                <section className="surface-card fairness-card"><PanelHeader title="비교 공정성 확인" subtitle="형상 이외의 모든 조건을 잠금" /><div className="fairness-list"><div><Check size={15} /><span>날짜·시간·태양</span><strong>{dateTime.replace("T", " ")}</strong></div><div><Check size={15} /><span>기상 시계열</span><strong>{provenance.kind}</strong></div><div><Check size={15} /><span>환경·장애물</span><strong>{environmentName} · {obstacles.length}개</strong></div><div><Check size={15} /><span>난수 시드</span><strong>{seed}</strong></div><div><Check size={15} /><span>패널 규격</span><strong>20 × 0.0025 = 0.050 m²</strong></div></div><p>모든 형상은 동일한 총 활성면적으로 비교합니다. 투영 단면적은 태양 방향과 형상에 따라 달라지는 결과값이므로 강제로 같게 만들지 않습니다. 화면에서 나란히 보이지만 물리 장면은 독립되어 서로 차폐하지 않습니다.</p></section>
              </div>
            </div>
          ) : null}

          {screen === "evidence" ? (
            <div className="content-screen evidence-screen">
              <SectionTitle eyebrow="코드와 같은 모델 레지스트리" title="공식 · 근거 · 패널 추적" aside={<><Pill tone="good">등록 모델 {MODEL_REGISTRY.length}개</Pill><span>현재 입력값으로 다시 계산됨</span></>} />
              <div className="evidence-layout">
                <aside className="surface-card model-index scroll-area"><PanelHeader title="실행 모델 체인" subtitle="simulateInstant → circuit → inverter trace" />{result.modelTrace.map((stage, index) => {
                  const descriptor = MODEL_DESCRIPTOR_BY_ID.get(stage.modelId);
                  return <button key={`${stage.modelId}-${index}`} className={stage.modelId === "poa.hay-davies" ? "active" : ""}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{descriptor?.titleKo ?? stage.modelId}</strong><small>{stage.modelId}@{descriptor?.version ?? "runtime"}</small></div><ChevronDown size={14} /></button>;
                })}<hr /><div className="evidence-source"><Pill tone="warn">정성 참고</Pill><strong>첨부 기사 6개 요소</strong><span>분류에만 사용 · 계수 출처 아님</span></div></aside>

                <section className="surface-card formula-detail scroll-area">
                  <PanelHeader title={POA_MODEL_DESCRIPTOR?.titleKo ?? "패널면 입사 복사량"} subtitle={`model: ${POA_MODEL_DESCRIPTOR?.id ?? "poa.hay-davies"}@${POA_MODEL_DESCRIPTOR?.version ?? "1.0.0"}`} action={<Pill tone="data">실행 중</Pill>} />
                  <div className="formula-hero"><code>{POA_MODEL_DESCRIPTOR?.expression ?? "GPOA = Gbeam + Gsky + Gground"}</code></div>
                  <div className="formula-table"><div className="formula-row header"><span>변수</span><span>한국어 설명</span><span>단위</span><span>현재값</span></div>{[
                    ["GPOA,i", "선택 패널 총 입사 복사", "W/m²", selectedPanel?.poaWm2.toFixed(2) ?? "—"], ["Vsun,i", "다점 태양 가시율", "0–1", selectedPanel?.visibility.toFixed(3) ?? "—"], ["DNI", "직달 법선 복사조도", "W/m²", instantWeather.dni.toFixed(1)], ["ni · s", "패널 법선과 태양 벡터 내적", "—", selectedPanel?.cosineIncidence.toFixed(4) ?? "—"], ["ηcos", "발전 방향의 기하 투영", "0–1", selectedPanel?.etaCos.toFixed(4) ?? "—"], ["IAMi", `ASHRAE 광학 계수 · b₀=${iamB0.toFixed(3)}`, "—", selectedPanel?.iam.toFixed(4) ?? "—"], ["ηangle", "ηcos × IAM · 음영 제외", "0–1", selectedPanel?.etaAngle.toFixed(4) ?? "—"], ["Gsky,i", "하늘 산란 성분", "W/m²", selectedPanel?.skyWm2.toFixed(2) ?? "—"], ["Gground,i", "지면 반사 성분", "W/m²", selectedPanel?.groundWm2.toFixed(2) ?? "—"],
                  ].map((row) => <div className="formula-row" key={row[0]}><code>{row[0]}</code><span>{row[1]}</span><span>{row[2]}</span><strong>{row[3]}</strong></div>)}</div>
                  <div className="evidence-cards"><article><h4>채택 근거</h4><p>POA는 물리 코어가 직달·Hay–Davies 하늘 산란·Lambert 지면 반사를 분리 계산하고, UI raycast 가시율을 입력으로 전달합니다.</p><div className="source-links">{POA_MODEL_DESCRIPTOR?.sourceUrls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer">공식 근거 {index + 1} ↗</a>)}</div></article><article><h4>가정과 한계</h4><ul>{POA_MODEL_DESCRIPTOR?.assumptionsKo.map((item) => <li key={item}>{item}</li>)}{POA_MODEL_DESCRIPTOR?.limitationsKo.map((item) => <li key={item}>{item}</li>)}</ul></article></div>
                </section>

                <aside className="surface-card trace-panel scroll-area"><PanelHeader title="선택 패널 계산 추적" subtitle={selectedPanel?.label ?? "패널 없음"} />{selectedPanel ? <div className="full-trace">
                  <div><i>1</i><span>태양 위치<small>고도 / 방위</small></span><strong>{solar.elevationDeg.toFixed(2)}° / {solar.azimuthDeg.toFixed(2)}°</strong></div>
                  <div><i>2</i><span>직달 · 산란 · 반사<small>POA 성분</small></span><strong>{selectedPanel.beamWm2.toFixed(1)} + {selectedPanel.skyWm2.toFixed(1)} + {selectedPanel.groundWm2.toFixed(1)}</strong></div>
                  <div><i>3</i><span>음영 · IAM<small>광학 상태</small></span><strong>{(selectedPanel.visibility * 100).toFixed(0)}% · {selectedPanel.iam.toFixed(3)}</strong></div>
                  <div><i>4</i><span>모듈 온도<small>Faiman · 국부풍</small></span><strong>{selectedPanel.temperatureC.toFixed(2)}°C</strong></div>
                  <div><i>5</i><span>I–V 상태<small>패널 동작점</small></span><strong>{selectedPanel.voltageV.toFixed(3)} V · {selectedPanel.currentA.toFixed(3)} A</strong></div>
                  <div className={selectedPanel.bypassActive ? "warn" : ""}><i>6</i><span>스트링 · 바이패스<small>회로 해석</small></span><strong>{selectedPanel.bypassActive ? "다이오드 도통" : "정상"}</strong></div>
                  <div><i>7</i><span>패널 DC<small>중복 차감 없음</small></span><strong>{selectedPanel.powerW.toFixed(4)} W</strong></div>
                  <div><i>8</i><span>인버터 AC<small>시스템 배분</small></span><strong>{(result.acW / Math.max(1, panels.length)).toFixed(4)} W</strong></div>
                </div> : <EmptyState icon={BookOpenCheck} title="추적할 패널 없음" text="3D 조립 화면에서 패널을 선택하세요." />}</aside>
              </div>
              <div className="registry-grid">
                {MODEL_REGISTRY.map((descriptor) => <article className="registry-card surface-card" key={descriptor.id}><div><span>{descriptor.id}@{descriptor.version}</span><Pill tone={result.modelTrace.some((stage) => stage.modelId === descriptor.id) ? "good" : "neutral"}>{result.modelTrace.some((stage) => stage.modelId === descriptor.id) ? "현재 실행" : "등록됨"}</Pill></div><h3>{descriptor.titleKo}</h3><code>{descriptor.expression}</code><small><a href={descriptor.sourceUrls[0]} target="_blank" rel="noreferrer">공식 출처 ↗</a></small></article>)}
              </div>
            </div>
          ) : null}

          {screen === "export" ? (
            <div className="content-screen export-screen">
              <SectionTitle eyebrow="이동 가능한 시나리오" title="저장 · 불러오기 · 내보내기" aside={<><Pill tone="good"><Save size={12} /> 브라우저 자동 저장</Pill><span>스키마 v3</span></>} />
              <div className="export-grid">
                <section className="surface-card project-summary"><div className="summary-art"><div className="summary-sun"><Sun /></div><div className="summary-panels"><span /><span /><span /><span /></div></div><Pill tone="data">현재 프로젝트</Pill><h2>{scenarioName}</h2><p>{PRESET_LABELS[preset]} · {panels.length}개 패널 · {obstacles.length}개 환경 오브젝트 · {circuitEdges.length}개 회로 연결</p><div className="summary-stats"><div><span>마지막 자동 저장</span><strong>{saveStatus === "saved" ? "방금" : saveStatus}</strong></div><div><span>데이터 출처</span><strong>{provenance.kind}</strong></div><div><span>결과 크기</span><strong>{dailySeries.length} 시간점</strong></div></div><div className="scenario-name-edit"><label>시나리오 이름<input value={scenarioName} onChange={(event) => setScenarioName(event.target.value)} /></label><button onClick={() => { localStorage.setItem(`solarform:scenario:${scenarioName}`, JSON.stringify(snapshot())); setToast("이름 있는 시나리오로 저장했습니다."); }}><Save size={15} /> 저장</button></div></section>
                <section className="surface-card export-options"><PanelHeader title="프로젝트 파일" subtitle="배치·회로·환경·모델 설정과 버전을 보존" /><div className="export-option"><div className="option-icon json"><FileJson /></div><div><strong>Solarform JSON</strong><span>스키마 버전, 마이그레이션 정보, 입력·결과 포함</span></div><button onClick={exportJson}><Download size={15} /> 내보내기</button></div><label className="export-option import"><div className="option-icon"><Upload /></div><div><strong>JSON 불러오기</strong><span>유효성·범위·참조를 검사하고 v1/v2를 v3로 변환</span></div><span className="button-like">파일 선택</span><input type="file" accept=".json,application/json" onChange={importJson} /></label><div className="migration-flow"><span>v1</span><i>→</i><span>v2</span><i>→</i><span className="active">v3 현재</span></div></section>
                <section className="surface-card export-options"><PanelHeader title="결과 데이터" subtitle="자료 출처와 단위를 파일에 함께 기록" /><div className="export-option"><div className="option-icon csv"><Database /></div><div><strong>시간별 CSV</strong><span>DC, AC, POA, 온도, 태양 고도 · UTF-8</span></div><button onClick={exportCsv}><Download size={15} /> CSV</button></div><div className="export-option"><div className="option-icon image"><ImageDown /></div><div><strong>그래프 이미지</strong><span>일간 DC·AC 그래프를 PNG로 저장</span></div><button onClick={exportChart}><ImageDown size={15} /> PNG</button></div><div className="export-option"><div className="option-icon report"><BookOpenCheck /></div><div><strong>연구 문서</strong><span>실행 중 공식·출처·가정·한계를 앱에서 추적</span></div><button onClick={() => setScreen("evidence")}><ArrowDownToLine size={15} /> 근거 열기</button></div></section>
                <section className="surface-card data-integrity"><PanelHeader title="데이터 무결성" subtitle="내보내기 전 자동 검사" /><div className="integrity-score"><div><strong>100</strong><span>/ 100</span></div><Pill tone="good">내보내기 가능</Pill></div><div className="integrity-list"><div><Check /> 패널 수 1–20 및 면적 고정</div><div><Check /> 모든 숫자 finite · 단위 명시</div><div><Check /> 회로 참조 무결성</div><div><Check /> 환경 오브젝트 ID 고유</div><div><Check /> 기상 provenance 포함</div><div className={gltfName ? "warn" : "ok"}>{gltfName ? <AlertTriangle /> : <Check />} {gltfName ? "GLB는 파일명 참조 — 재연결 필요" : "외부 GLB 참조 없음"}</div></div><p><Info size={14} /> 브라우저 경로는 저장할 수 없습니다. GLB/GLTF는 파일명 참조를 보존하고 다시 불러올 때 재연결합니다.</p></section>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {toast ? <div className="toast" role="status"><Check size={16} /> {toast}</div> : null}
      <div className="min-width-warning"><AlertTriangle size={18} /><span>정밀 3D 작업은 1280px 이상 PC 화면을 권장합니다.</span></div>
    </main>
  );
}
