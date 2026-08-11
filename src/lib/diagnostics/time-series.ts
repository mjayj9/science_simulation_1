export const DIAGNOSTIC_REASON_CODES = [
  "NIGHT",
  "NORMAL_SUNSET",
  "MISSING_DATA",
  "INVERTER_CUTOFF",
  "BYPASS_SWITCH",
  "STRING_CURRENT_LIMIT",
  "WEATHER_STEP",
  "OCCLUSION_CHANGE",
  "ROTATION_PHASE",
  "NUMERIC_ERROR",
  "STALE_WORKER_RESULT",
] as const;

export type DiagnosticReasonCode = (typeof DIAGNOSTIC_REASON_CODES)[number];

export interface DiagnosticSignal {
  minute: number;
  solarElevationDeg: number;
  ghiWm2: number;
  dcPowerW: number;
  acPowerW: number;
  visibility: number;
  bypassCount: number;
  inverterStatus: string;
  intervalAveraged: boolean;
  /**
   * True only when this plotted point has no valid value. A complete
   * whole-source offline fallback is valid data and records the rejected
   * provider in WeatherProvenance.fallbackReason instead.
   */
  missingData?: boolean;
  staleWorkerResult?: boolean;
}

export interface ClassifiedDiagnostic {
  reasonCodes: DiagnosticReasonCode[];
  severity: "normal" | "attention" | "error";
}

function finiteSignal(signal: DiagnosticSignal): boolean {
  return [
    signal.minute,
    signal.solarElevationDeg,
    signal.ghiWm2,
    signal.dcPowerW,
    signal.acPowerW,
    signal.visibility,
    signal.bypassCount,
  ].every(Number.isFinite);
}

/**
 * Classifies transitions without changing or smoothing the underlying values.
 * Thresholds only decide which audit label to show; they never affect energy.
 */
export function classifyTimePoint(
  current: DiagnosticSignal,
  previous?: DiagnosticSignal,
): ClassifiedDiagnostic {
  const codes: DiagnosticReasonCode[] = [];
  if (!finiteSignal(current)) codes.push("NUMERIC_ERROR");
  if (current.missingData) codes.push("MISSING_DATA");
  if (current.staleWorkerResult) codes.push("STALE_WORKER_RESULT");

  if (current.solarElevationDeg <= 0) {
    codes.push("NIGHT");
  } else if (
    previous
    && current.minute >= 12 * 60
    && current.solarElevationDeg <= 25
    && current.solarElevationDeg < previous.solarElevationDeg
    && current.ghiWm2 <= previous.ghiWm2
    && current.acPowerW <= previous.acPowerW + 1e-9
  ) {
    codes.push("NORMAL_SUNSET");
  }

  const inverterStatus = current.inverterStatus.toLowerCase();
  if (
    current.dcPowerW > 1e-9
    && current.acPowerW <= 1e-9
    && (inverterStatus.includes("cutoff") || inverterStatus.includes("off") || inverterStatus.includes("mppt"))
  ) codes.push("INVERTER_CUTOFF");
  if (inverterStatus.includes("current-limit")) codes.push("STRING_CURRENT_LIMIT");

  if (previous) {
    if (current.bypassCount !== previous.bypassCount) codes.push("BYPASS_SWITCH");
    if (Math.abs(current.visibility - previous.visibility) >= 0.2) codes.push("OCCLUSION_CHANGE");
    const irradianceStep = Math.abs(current.ghiWm2 - previous.ghiWm2);
    const irradianceScale = Math.max(current.ghiWm2, previous.ghiWm2, 1);
    if (irradianceStep >= 120 && irradianceStep / irradianceScale >= 0.35) codes.push("WEATHER_STEP");
  }
  if (current.intervalAveraged) codes.push("ROTATION_PHASE");

  const severe = codes.some((code) => code === "NUMERIC_ERROR" || code === "MISSING_DATA" || code === "STALE_WORKER_RESULT");
  const attention = codes.some((code) => !["NIGHT", "NORMAL_SUNSET", "ROTATION_PHASE"].includes(code));
  return {
    reasonCodes: [...new Set(codes)],
    severity: severe ? "error" : attention ? "attention" : "normal",
  };
}

export const DIAGNOSTIC_REASON_LABELS: Readonly<Record<DiagnosticReasonCode, string>> = {
  NIGHT: "태양 고도 0° 이하",
  NORMAL_SUNSET: "정상 일몰 감소",
  MISSING_DATA: "원본 기상 누락",
  INVERTER_CUTOFF: "인버터 저부하 차단",
  BYPASS_SWITCH: "바이패스 상태 전환",
  STRING_CURRENT_LIMIT: "스트링 전류 제한",
  WEATHER_STEP: "기상 입력 급변",
  OCCLUSION_CHANGE: "차폐 가시율 급변",
  ROTATION_PHASE: "회전 구간 위상 적분",
  NUMERIC_ERROR: "비유한 수치",
  STALE_WORKER_RESULT: "이전 입력의 워커 결과 폐기",
};
