import { useId, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BarChart3,
  Check,
  ChevronDown,
  CircleGauge,
  Info,
  Rotate3D,
  Sun,
  ThermometerSun,
} from "lucide-react";

export type ComparisonRotationMode = "static" | "fixed" | "auto";

export interface ShapeDiagnosticRow {
  id: string;
  label: string;
  landAreaM2: number;
  heightM: number;
  maximumHeightM: number;
  activeAreaM2: number;
  pvLandRatio: number;
  annualKWh: number;
  landKWhM2: number;
  pvKWhM2: number;
  footprintIndex: number;
  rotationMode: string;
  rpm: number;
  reflector: string;
  albedo: number;
  averageTemperatureC: number | null;
  maximumTemperatureC: number | null;
  temperaturePeriodLabel: string;
  electricalModel: string;
  thermalModel: string;
  rotationModel: string;
  weatherSource: string;
  timeResolution: string;
  integrationScope: string;
}

const LEGACY_ANNUAL_RESULTS = [
  ["일반 평면", 24.038],
  ["정육면체", 39.049],
  ["원기둥", 39.121],
  ["구", 35.035],
  ["반구", 26.549],
  ["원뿔", 28.503],
] as const;

function finite(value: number, digits: number) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function temperature(value: number | null) {
  return value !== null && Number.isFinite(value) ? `${value.toFixed(1)}°C` : "계산 대기";
}

export function PreliminaryDiagnosisPanel({
  rows,
  officialComparison,
  obstaclesIncluded,
}: {
  rows: ShapeDiagnosticRow[];
  officialComparison: boolean;
  obstaclesIncluded: boolean;
}) {
  const descriptionId = useId();
  return (
    <section className="surface-card preliminary-diagnosis" aria-labelledby="preliminary-diagnosis-title" aria-describedby={descriptionId}>
      <div className="analysis-panel-heading">
        <div>
          <BarChart3 size={18} />
          <span><strong id="preliminary-diagnosis-title">선행 진단 · 순위보다 먼저 확인</strong><small id={descriptionId}>현재 입력으로 다시 계산한 면적·높이·회전·광학·온도 계약입니다.</small></span>
        </div>
        <span className={`analysis-status ${officialComparison ? "good" : "warn"}`}>
          {officialComparison ? <Check size={13} /> : <AlertTriangle size={13} />}
          {officialComparison ? "공식 과도 E11 비교" : "대표일·준정상 또는 조건 미충족 · 탐색 비교"}
        </span>
      </div>

      <div className="diagnosis-table-wrap" aria-label="형상별 선행 진단 표, 가로로 스크롤 가능">
        <table className="diagnosis-table">
          <caption>형상별 공정성 입력과 현재 계산 결과</caption>
          <thead>
            <tr>
              <th scope="col">형상</th>
              <th scope="col">A_land</th>
              <th scope="col">높이 / H_max</th>
              <th scope="col">A_PV</th>
              <th scope="col">A_PV / A_land</th>
              <th scope="col">면적지수</th>
              <th scope="col">연간 AC</th>
              <th scope="col">토지면적당</th>
              <th scope="col">PV면적당</th>
              <th scope="col">회전</th>
              <th scope="col">반사 · albedo</th>
              <th scope="col">평균 / 최고 표면온도</th>
              <th scope="col">전기 연결</th>
              <th scope="col">열모델</th>
              <th scope="col">회전모델</th>
              <th scope="col">기상 출처</th>
              <th scope="col">시간 범위</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const footprintPass = Math.abs(row.footprintIndex - 100) <= 0.1;
              const heightPass = row.heightM <= row.maximumHeightM + 1e-9;
              return (
                <tr key={row.id}>
                  <th scope="row">{row.label}</th>
                  <td>{finite(row.landAreaM2, 4)} m²</td>
                  <td className={heightPass ? "pass" : "fail"}>{finite(row.heightM, 3)} / {finite(row.maximumHeightM, 3)} m</td>
                  <td>{finite(row.activeAreaM2, 4)} m²</td>
                  <td>{finite(row.pvLandRatio, 3)}×</td>
                  <td className={footprintPass ? "pass" : "fail"}>{finite(row.footprintIndex, 2)}</td>
                  <td>{finite(row.annualKWh, 3)} kWh/year</td>
                  <td>{finite(row.landKWhM2, 2)} kWh/m²-land/year</td>
                  <td>{finite(row.pvKWhM2, 2)} kWh/m²-PV/year</td>
                  <td>{row.rotationMode}<small>{finite(row.rpm, 2)} RPM · 월드 Y축</small></td>
                  <td>{row.reflector}<small>albedo {finite(row.albedo, 2)}</small></td>
                  <td>{temperature(row.averageTemperatureC)} / {temperature(row.maximumTemperatureC)}<small>{row.temperaturePeriodLabel}</small></td>
                  <td>{row.electricalModel}</td>
                  <td>{row.thermalModel}</td>
                  <td>{row.rotationModel}</td>
                  <td>{row.weatherSource}<small>{row.timeResolution}</small></td>
                  <td>{row.integrationScope}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="legacy-diagnosis-note">
        <AlertTriangle size={16} />
        <div><strong>수정 전 기록은 조건 불명 legacy evidence입니다.</strong><span>{LEGACY_ANNUAL_RESULTS.map(([label, value]) => `${label} ${value.toFixed(3)}`).join(" · ")} kWh/year</span><small>확정 가능한 점은 동일 PV 재료량 비교가 아니었다는 것입니다. 원기둥 기본 높이 초과는 확인되지 않았지만, 과거 상한이 A_land와 독립이고 custom height의 공식 제외가 보장되지 않았습니다. 위 표만 현재 공정 입력입니다.</small></div>
      </div>
      <p className="comparison-condition-note"><Info size={14} /> 차폐 조건: {obstaclesIncluded ? "사용자가 명시한 환경 장애물 포함" : "공식 비교 기본값 · 장애물 없음"}</p>
    </section>
  );
}

export interface AnnualTransientDecompositionRow {
  id: string;
  label: string;
  thermalModel: string;
  annual: {
    e00Wh: number;
    e10Wh: number;
    e01Wh: number;
    e11Wh: number;
    opticalWh: number;
    thermalWh: number;
    interactionWh: number;
    netWh: number;
    closureResidualWh: number;
  };
  monthly: Array<{
    month: string;
    e00Wh: number;
    e10Wh: number;
    e01Wh: number;
    e11Wh: number;
    opticalWh: number;
    thermalWh: number;
    interactionWh: number;
    netWh: number;
    closureResidualWh: number;
  }>;
}

export function AnnualTransientDecompositionPanel({
  rows,
  unsupportedReason,
}: {
  rows: AnnualTransientDecompositionRow[];
  unsupportedReason?: string;
}) {
  return (
    <section className="surface-card preliminary-diagnosis" aria-labelledby="annual-transient-decomposition-title">
      <div className="analysis-panel-heading">
        <div><ThermometerSun size={18} /><span><strong id="annual-transient-decomposition-title">실제 전년 E00/E10/E01/E11</strong><small>월별·연간 실제 기상 시계 적분 · optical + thermal + interaction = net</small></span></div>
        <span className={`analysis-status ${rows.length > 0 ? "good" : "warn"}`}>{rows.length > 0 ? <Check size={13} /> : <AlertTriangle size={13} />}{rows.length > 0 ? "과도 열이력 포함" : "계산 대기"}</span>
      </div>
      {unsupportedReason ? <p className="rotation-physics-warning"><AlertTriangle size={15} /> {unsupportedReason} 이 조건에서는 과도 열 결과를 생성하거나 공식 순위에 사용하지 않습니다.</p> : null}
      {rows.length > 0 ? <div className="diagnosis-table-wrap"><table className="diagnosis-table">
        <caption>형상별 연간 회전 광학·열 2×2 분해</caption>
        <thead><tr><th>형상</th><th>E00</th><th>E10</th><th>E01</th><th>E11</th><th>optical</th><th>thermal</th><th>interaction</th><th>net</th><th>closure</th><th>열모델</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}><th>{row.label}</th><td>{finite(row.annual.e00Wh / 1000, 3)}</td><td>{finite(row.annual.e10Wh / 1000, 3)}</td><td>{finite(row.annual.e01Wh / 1000, 3)}</td><td>{finite(row.annual.e11Wh / 1000, 3)}</td><td>{finite(row.annual.opticalWh / 1000, 3)}</td><td>{finite(row.annual.thermalWh / 1000, 3)}</td><td>{finite(row.annual.interactionWh / 1000, 3)}</td><td>{finite(row.annual.netWh / 1000, 3)}</td><td>{finite(row.annual.closureResidualWh, 9)} Wh</td><td>{row.thermalModel}</td></tr>)}</tbody>
      </table></div> : <p className="comparison-condition-note"><Info size={14} /> 연간 계산을 실행하기 전에는 대표일 분해를 연간 값으로 표시하지 않습니다.</p>}
      {rows.map((row) => <details key={`${row.id}-monthly`}>
        <summary>{row.label} 월별 분해 보기</summary>
        <div className="diagnosis-table-wrap"><table className="diagnosis-table"><thead><tr><th>월</th><th>E00</th><th>E10</th><th>E01</th><th>E11</th><th>optical</th><th>thermal</th><th>interaction</th><th>net</th><th>closure Wh</th></tr></thead><tbody>{row.monthly.map((month) => <tr key={month.month}><th>{month.month}</th><td>{finite(month.e00Wh / 1000, 3)}</td><td>{finite(month.e10Wh / 1000, 3)}</td><td>{finite(month.e01Wh / 1000, 3)}</td><td>{finite(month.e11Wh / 1000, 3)}</td><td>{finite(month.opticalWh / 1000, 3)}</td><td>{finite(month.thermalWh / 1000, 3)}</td><td>{finite(month.interactionWh / 1000, 3)}</td><td>{finite(month.netWh / 1000, 3)}</td><td>{finite(month.closureResidualWh, 9)}</td></tr>)}</tbody></table></div>
      </details>)}
      <p className="comparison-condition-note"><Info size={14} /> closure 열만 Wh, 나머지는 kWh입니다. E11이 연간 과도 열 순위의 authoritative AC입니다.</p>
    </section>
  );
}

export interface RotationControlValue {
  mode: ComparisonRotationMode;
  rpm: number;
  initialPhaseDeg: number;
  maximumRpm: number;
  motorTorqueNm: number;
  motorEfficiency: number;
  referenceHeightM: number;
  selfStarting: "none" | "user-cq";
  torqueCoefficientByShape: Record<RotationShapeKey, number>;
  /** Explicit user assumption used to derive each shape's I_y. */
  rotatingArealMassKgM2: number;
  staticFrictionNm: number;
  bearingViscousNmPerRadS: number;
  airDragNmPerRadS2: number;
}

export type RotationShapeKey =
  | "plane" | "cube" | "sphere" | "hemisphere" | "cylinder" | "cone";

export const ROTATION_SHAPE_LABELS: Record<RotationShapeKey, string> = {
  plane: "평면", cube: "정육면체", sphere: "구", hemisphere: "반구", cylinder: "원기둥", cone: "원뿔",
};

export interface ComparisonMotorResult {
  isWorkerResult: boolean;
  referenceShapeLabel: string;
  annualMotorEnergyWh: number;
  annualNetAcEnergyWh: number;
  monthly: { month: string; motorEnergyWh: number; netAcEnergyWh: number }[];
}
export interface ShapeRotationAuditValue {
  shape: RotationShapeKey;
  label: string;
  projectedAreaM2: number;
  forceApplicationRadiusM: number;
  inertiaKgM2: number;
  staticFrictionNm: number;
  bearingViscousNmPerRadS: number;
  airDragNmPerRadS2: number;
  torqueCoefficientSource: string;
  annualTimeWeightedRpm: number;
  confidence: string;
  officialComparisonEligible: boolean;
  warning?: string;
  monthly: {
    month: number;
    durationHours: number;
    meanWindSpeedMS: number;
    structureWindSpeedMS: number;
    timeWeightedMeanRpm: number;
  }[];
}


export interface RotationAuditValue {
  structureWindSpeedMS: number;
  unconstrainedRpm: number;
  finalRpm: number;
  aerodynamicModel: string;
  torqueCoefficient: string;
  bearingFriction: string;
  aerodynamicTorqueNm: number;
  lossTorqueNm: number;
  torqueResidualNm: number;
  mechanicalLossPowerW: number;
  safetyLimited: boolean;
  confidence: string;
  warning?: string;
  monthly?: {
    month: number;
    meanWindSpeedMS: number | null;
    structureWindSpeedMS: number;
    finalRpm: number;
    missingWeather: boolean;
  }[];
  shapes?: ShapeRotationAuditValue[];
  annualTimeWeightedRpm?: number;
}

function NumberControl({
  label,
  unit,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <label className="analysis-number-field" htmlFor={id}>
      <span>{label}</span>
      <span><input id={id} type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} /><small>{unit}</small></span>
    </label>
  );
}

export function ComparisonRotationPanel({
  value,
  audit,
  motorResult,
  obstaclesIncluded,
  onChange,
  onObstaclesIncludedChange,
}: {
  value: RotationControlValue;
  audit: RotationAuditValue;
  motorResult?: ComparisonMotorResult;
  obstaclesIncluded: boolean;
  onChange: (value: RotationControlValue) => void;
  onObstaclesIncludedChange: (included: boolean) => void;
}) {
  const patch = (next: Partial<RotationControlValue>) => onChange({ ...value, ...next });
  const direction = value.rpm < 0 ? "clockwise" : "counterclockwise";
  const fixedRpm = Math.max(-Math.max(0, value.maximumRpm), Math.min(Math.max(0, value.maximumRpm), value.rpm));
  const appliedRpm = value.mode === "static" ? 0 : value.mode === "fixed" ? fixedRpm : audit.finalRpm;
  const motorPowerW = value.mode === "fixed" && value.motorEfficiency > 0
    ? value.motorTorqueNm * Math.abs(appliedRpm) * 2 * Math.PI / 60 / value.motorEfficiency
    : 0;
  return (
    <section className="surface-card comparison-rotation-panel" aria-labelledby="comparison-rotation-title">
      <div className="analysis-panel-heading">
        <div><Rotate3D size={18} /><span><strong id="comparison-rotation-title">통제 RPM · 형상별 자연 회전</strong><small>월드 Y축 · 정지, 모든 형상의 동일 지정 RPM, 기상 구간별 형상 동역학을 분리합니다.</small></span></div>
        <span className="rotation-readout"><CircleGauge size={14} /><strong>{finite(appliedRpm, 2)}</strong> RPM</span>
      </div>
      <div className="analysis-segmented" role="group" aria-label="회전 모드">
        {([
          ["static", "정지"],
          ["fixed", "지정 RPM"],
          ["auto", "형상별 자연 RPM"],
        ] as const).map(([mode, label]) => <button type="button" key={mode} aria-pressed={value.mode === mode} className={value.mode === mode ? "active" : ""} onClick={() => patch({ mode })}>{label}</button>)}
      </div>

      {value.mode === "fixed" ? <div className="rotation-input-grid">
        <NumberControl label="회전수 크기" unit="RPM" value={Math.abs(value.rpm)} min={0} max={value.maximumRpm} step={0.1} onChange={(rpm) => patch({ rpm: direction === "clockwise" ? -Math.abs(rpm) : Math.abs(rpm) })} />
        <label className="analysis-select-field"><span>방향 · +Y에서 내려다봄</span><select value={direction} onChange={(event) => patch({ rpm: event.target.value === "clockwise" ? -Math.abs(value.rpm) : Math.abs(value.rpm) })}><option value="counterclockwise">반시계 (+)</option><option value="clockwise">시계 (−)</option></select></label>
        <NumberControl label="시작 위상" unit="°" value={value.initialPhaseDeg} min={0} max={359.99} step={1} onChange={(initialPhaseDeg) => patch({ initialPhaseDeg })} />
        <NumberControl label="최대 안전 회전수" unit="RPM" value={value.maximumRpm} min={0} max={120} step={1} onChange={(maximumRpm) => patch({ maximumRpm, rpm: Math.sign(value.rpm || 1) * Math.min(Math.abs(value.rpm), maximumRpm) })} />
        <NumberControl label="외부 모터 토크" unit="N·m" value={value.motorTorqueNm} min={0} max={100} step={0.001} onChange={(motorTorqueNm) => patch({ motorTorqueNm: Number.isFinite(motorTorqueNm) ? Math.max(0, motorTorqueNm) : 0 })} />
        <NumberControl label="모터 효율" unit="0–1" value={value.motorEfficiency} min={0.01} max={1} step={0.01} onChange={(motorEfficiency) => patch({ motorEfficiency: Number.isFinite(motorEfficiency) ? Math.max(0.01, Math.min(1, motorEfficiency)) : 0.8 })} />
      </div> : null}

      {value.mode === "fixed" ? <div className="motor-energy-audit" aria-label="외부 모터 소비전력과 연간 차감 결과" aria-live="polite">
        <dl className="rotation-audit-grid">
          <div><dt>외부 모터 입력</dt><dd>{finite(motorPowerW, 4)} W</dd></div>
          <div><dt>소비전력 공식</dt><dd>P_motor = τ · |ω| / η_motor</dd></div>
          <div><dt>적용 회전수</dt><dd>{finite(Math.abs(appliedRpm), 2)} RPM</dd></div>
          <div><dt>연간 AC 계약</dt><dd>인버터 후단에서 시간별 차감</dd></div>
        </dl>
        {motorResult?.isWorkerResult ? <>
          <dl className="rotation-audit-grid motor-result-summary">
            <div><dt>연간 모터 소비</dt><dd>{finite(motorResult.annualMotorEnergyWh / 1000, 4)} kWh</dd></div>
            <div><dt>연간 순효과 · {motorResult.referenceShapeLabel}</dt><dd>{finite(motorResult.annualNetAcEnergyWh / 1000, 4)} kWh</dd></div>
            <div><dt>AC 차감 규칙</dt><dd>max(0, AC_inv − P_motor)</dd></div>
          </dl>
          <dl className="rotation-audit-grid motor-monthly-grid" aria-label={`${motorResult.referenceShapeLabel} 월별 모터 소비와 차감 후 순 AC`}>
            {motorResult.monthly.map((month) => <div key={month.month}><dt>{month.month}</dt><dd>모터 {finite(month.motorEnergyWh / 1000, 3)} kWh<br />순효과 {finite(month.netAcEnergyWh / 1000, 3)} kWh</dd></div>)}
          </dl>
          <p className="comparison-condition-note"><Check size={14} /> 연간 Worker가 각 시간점에서 모터 전력을 인버터 AC에서 실제 차감했습니다. 가용 AC보다 큰 구간의 순 AC는 0 W로 제한됩니다.</p>
        </> : <div className="rotation-physics-warning" role="status"><AlertTriangle size={15} /><span>대표일 추정 경로는 모터 소비전력 차감을 지원하지 않습니다. ‘연속막 연간 계산’을 실행하면 Worker가 월별·연간 AC에서 실제 차감합니다.</span></div>}
      </div> : null}

      {value.mode === "auto" ? <>
        <div className="rotation-input-grid">
          <NumberControl label="풍속 기준 높이" unit="m" value={value.referenceHeightM} min={0.1} max={300} step={0.5} onChange={(referenceHeightM) => patch({ referenceHeightM })} />
          <label className="analysis-select-field"><span>수동 보조 로터 토크 모델</span><select value={value.selfStarting} onChange={(event) => patch({ selfStarting: event.target.value as RotationControlValue["selfStarting"] })}><option value="none">없음 · 대칭형상 0 RPM</option><option value="user-cq">미완성 보조 로터 C_Q(0) · 공식 제외</option></select></label>
          {value.selfStarting === "user-cq" ? (Object.entries(ROTATION_SHAPE_LABELS) as [RotationShapeKey, string][]).map(([shape, label]) => <NumberControl key={shape} label={`${label} C_Q(0) · λ=3 선형 영점 가정`} unit="—" value={value.torqueCoefficientByShape[shape]} min={0} max={2} step={0.01} onChange={(torqueCoefficient) => patch({ torqueCoefficientByShape: { ...value.torqueCoefficientByShape, [shape]: torqueCoefficient } })} />) : null}
          <NumberControl label="회전체 면밀도 · 사용자 가정" unit="kg/m²-PV" value={value.rotatingArealMassKgM2} min={0.01} max={1000} step={0.1} onChange={(rotatingArealMassKgM2) => patch({ rotatingArealMassKgM2 })} />
          <NumberControl label="축 정지마찰 · 사용자" unit="N·m" value={value.staticFrictionNm} min={0} max={100} step={0.001} onChange={(staticFrictionNm) => patch({ staticFrictionNm })} />
          <NumberControl label="축 점성마찰 · 사용자" unit="N·m·s/rad" value={value.bearingViscousNmPerRadS} min={0} max={100} step={0.001} onChange={(bearingViscousNmPerRadS) => patch({ bearingViscousNmPerRadS })} />
          <NumberControl label="회전 공기저항 · 사용자" unit="N·m·s²/rad²" value={value.airDragNmPerRadS2} min={0} max={100} step={0.0001} onChange={(airDragNmPerRadS2) => patch({ airDragNmPerRadS2 })} />
          <NumberControl label="최대 안전 회전수" unit="RPM" value={value.maximumRpm} min={0} max={120} step={1} onChange={(maximumRpm) => patch({ maximumRpm })} />
        </div>
        <dl className="rotation-audit-grid">
          <div><dt>구조 중심 풍속</dt><dd>{finite(audit.structureWindSpeedMS, 2)} m/s</dd></div>
          <div><dt>공력 모델</dt><dd>{audit.aerodynamicModel}</dd></div>
          <div><dt>토크계수</dt><dd>{audit.torqueCoefficient}</dd></div>
          <div><dt>베어링 마찰</dt><dd>{audit.bearingFriction}</dd></div>
          <div><dt>공력 / 손실 토크</dt><dd>{finite(audit.aerodynamicTorqueNm, 4)} / {finite(audit.lossTorqueNm, 4)} N·m</dd></div>
          <div><dt>토크 잔차</dt><dd>{finite(audit.torqueResidualNm, 6)} N·m</dd></div>
          <div><dt>평형 기계손실</dt><dd>{finite(audit.mechanicalLossPowerW, 4)} W</dd></div>
          <div><dt>제한 전 RPM</dt><dd>{finite(audit.unconstrainedRpm, 2)}</dd></div>
          <div><dt>안전제한</dt><dd>{audit.safetyLimited ? "적용" : "미적용"}</dd></div>
          <div><dt>최종 적용 RPM</dt><dd>{finite(audit.finalRpm, 2)}</dd></div>
          <div><dt>신뢰등급</dt><dd>{audit.confidence}</dd></div>
        </dl>
        {audit.shapes?.length ? <div className="diagnosis-table-wrap" aria-label="형상별 자연 회전 동역학 감사">
          <table className="diagnosis-table"><caption>형상별 자연환경 RPM 입력·결과</caption><thead><tr><th>형상</th><th>A_projected</th><th>작용반경</th><th>I_y</th><th>축·공기 손실계수</th><th>C_Q 출처</th><th>연평균 RPM</th><th>신뢰·공정성</th></tr></thead><tbody>{audit.shapes.map((shape) => <tr key={shape.shape}><th>{shape.label}</th><td>{finite(shape.projectedAreaM2, 4)} m²</td><td>{finite(shape.forceApplicationRadiusM, 4)} m</td><td>{finite(shape.inertiaKgM2, 6)} kg·m²</td><td>τ₀ {finite(shape.staticFrictionNm, 4)}<br />b {finite(shape.bearingViscousNmPerRadS, 4)} · c {finite(shape.airDragNmPerRadS2, 5)}</td><td>{shape.torqueCoefficientSource}</td><td>{finite(shape.annualTimeWeightedRpm, 3)}</td><td>{shape.confidence}<br />{shape.officialComparisonEligible ? "공식 포함" : "공식 제외"}</td></tr>)}</tbody></table>
        </div> : null}
        {audit.shapes?.map((shape) => <details key={`${shape.shape}-monthly`} className="rotation-shape-monthly"><summary>{shape.label} 월별 시간가중 RPM</summary><dl className="rotation-audit-grid motor-monthly-grid">{shape.monthly.map((month) => <div key={month.month}><dt>{month.month}월 · {finite(month.durationHours, 0)} h</dt><dd>풍속 {finite(month.meanWindSpeedMS, 2)} → 중심 {finite(month.structureWindSpeedMS, 2)} m/s<br />{finite(month.timeWeightedMeanRpm, 3)} RPM</dd></div>)}</dl></details>)}
        {audit.annualTimeWeightedRpm !== undefined ? <p className="comparison-condition-note"><Info size={14} /> 실제 WeatherSeries의 각 시간 구간에서 I·dω/dt = τ_aero(V,ω,shape) − τ_loss(ω)를 적분 · 표시값은 형상별 시간가중 월·연평균이며 풍력 전기는 포함하지 않습니다.</p> : null}
        {audit.warning ? <div className="rotation-physics-warning" role="status"><AlertTriangle size={15} /><span>{audit.warning}</span></div> : null}
        <p className="comparison-condition-note"><Info size={14} /> 월평균 풍속을 토크식에 한 번 넣지 않습니다. 구간 경계 사이의 풍속을 적분하고 ω(t) 상태를 다음 구간으로 넘깁니다.</p>
        {value.selfStarting === "user-cq" ? <p className="rotation-physics-warning"><AlertTriangle size={15} /> 입력값은 측정 C_Q(λ) 곡선이 아니라 C_Q(λ)=C_Q(0)·max(0,1−λ/3) 탐색 가정입니다. 보조 로터 A_ref·R_ref, footprint·그림자·전체 높이가 입력·공정 계산에 포함되지 않아 공력 토크와 RPM은 0/not-evaluated이며 공식 순위에서 제외합니다.</p> : null}
      </> : null}

      <button type="button" className={`comparison-obstacle-toggle ${obstaclesIncluded ? "active" : ""}`} aria-pressed={obstaclesIncluded} onClick={() => onObstaclesIncludedChange(!obstaclesIncluded)}><span>{obstaclesIncluded ? <Check size={12} /> : null}</span><strong>비교에 환경 장애물 포함</strong><small>{obstaclesIncluded ? "명시적 차폐 연구 · 순수 형상 공식 순위에서 제외" : "기본값 · 장애물 없는 순수 형상 비교"}</small></button>
    </section>
  );
}

export type DriverTone = "positive" | "negative" | "neutral" | "limited";

export interface RankDriver {
  id: string;
  label: string;
  value: string;
  explanation: string;
  tone: DriverTone;
}

export interface ShapeRankExplanation {
  id: string;
  label: string;
  rank: number;
  annualKWh: number;
  comparedWith: string;
  drivers: RankDriver[];
}

export function RankExplanationPanel({ rows, officialComparison }: { rows: ShapeRankExplanation[]; officialComparison: boolean }) {
  const [selectedId, setSelectedId] = useState(rows[0]?.id ?? "");
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0];
  if (!selected) return null;
  return (
    <section className="surface-card rank-explanation" aria-labelledby="rank-explanation-title">
      <div className="analysis-panel-heading">
        <div><BarChart3 size={18} /><span><strong id="rank-explanation-title">왜 이 형상이 이 순위인가?</strong><small>형상 multiplier 없이 현재 계산 원장과 공정 기준 형상을 나란히 봅니다.</small></span></div>
        <label className="rank-shape-select"><span>분석 형상</span><select value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>{rows.map((row) => <option key={row.id} value={row.id}>#{row.rank} {row.label}</option>)}</select></label>
      </div>
      <div className="rank-summary"><strong>#{selected.rank} · {selected.label}</strong><span>{finite(selected.annualKWh, 3)} kWh/year</span><small>{selected.comparedWith} 기준 신호 · {officialComparison ? "공식 비교" : "탐색 비교(공식 순위 제외)"}</small></div>
      <div className="driver-grid">
        {selected.drivers.map((driver) => <article className={`rank-driver ${driver.tone}`} key={driver.id}><span>{driver.label}</span><strong>{driver.value}</strong><small>{driver.explanation}</small></article>)}
      </div>
      <p className="comparison-condition-note"><Info size={14} /> 각 항목은 같은 순간 계산의 물리 원장 또는 명시적 비율입니다. 서로 상호작용하므로 임의 합산해 연간 발전량에 맞추지 않습니다.</p>
    </section>
  );
}

export interface SummerScenarioOption {
  id: string;
  label: string;
}

export interface SummerAnalysisValue {
  periodLabel: string;
  shapeLabel: string;
  staticInstantAcW: number;
  rotatingInstantAcW: number;
  staticEnergyKWh: number;
  rotatingEnergyKWh: number;
  staticAverageTemperatureC: number;
  rotatingAverageTemperatureC: number;
  staticMaximumTemperatureC: number;
  rotatingMaximumTemperatureC: number;
  staticHoursAbove45: number;
  rotatingHoursAbove45: number;
  staticTemperatureLossPct: number;
  rotatingTemperatureLossPct: number;
  hourlyStaticW: number[];
  hourlyRotatingW: number[];
  thermalHistoryAvailable: boolean;
  rotationDecomposition?: {
    representativeDate: string;
    e00Wh: number;
    e10Wh: number;
    e01Wh: number;
    e11Wh: number;
    opticalGainWh: number;
    thermalGainWh: number;
    interactionWh: number;
    netGainWh: number;
    averageTemperatureDeltaC: number;
    maximumTemperatureDeltaC: number;
    standardDeviationDeltaC: number;
    hotspotPersistenceDeltaHours: number;
  };
}

function signed(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

export function SummerAnalysisPanel({
  scenarios,
  selectedScenario,
  value,
  onScenarioChange,
}: {
  scenarios: SummerScenarioOption[];
  selectedScenario: string;
  value: SummerAnalysisValue;
  onScenarioChange: (id: string) => void;
}) {
  const maxPower = Math.max(1e-9, ...value.hourlyStaticW, ...value.hourlyRotatingW);
  const energyDelta = value.rotatingEnergyKWh - value.staticEnergyKWh;
  return (
    <section className="surface-card summer-analysis" aria-labelledby="summer-analysis-title">
      <div className="analysis-panel-heading">
        <div><ThermometerSun size={18} /><span><strong id="summer-analysis-title">서울 여름철 · 정지와 회전 비교</strong><small>{value.shapeLabel} · 회전 이득을 미리 강제하지 않고 계산값을 표시합니다.</small></span></div>
        <label className="rank-shape-select"><span>분석 기간</span><select value={selectedScenario} onChange={(event) => onScenarioChange(event.target.value)}>{scenarios.map((scenario) => <option value={scenario.id} key={scenario.id}>{scenario.label}</option>)}</select></label>
      </div>
      <div className="summer-period-label"><Sun size={15} /><strong>{value.periodLabel}</strong></div>
      <div className="summer-metric-grid">
        <div><span>대표일 12시 AC · 정지 / 회전</span><strong>{finite(value.staticInstantAcW, 3)} / {finite(value.rotatingInstantAcW, 3)} W</strong></div>
        <div><span>기간 AC · 정지 / 회전</span><strong>{finite(value.staticEnergyKWh, 3)} / {finite(value.rotatingEnergyKWh, 3)} kWh</strong></div>
        <div><span>순 에너지 변화</span><strong className={energyDelta >= 0 ? "positive" : "negative"}>{signed(energyDelta, 3)} kWh</strong></div>
        <div><span>평균 표면온도 · 정지 / 회전</span><strong>{finite(value.staticAverageTemperatureC, 1)} / {finite(value.rotatingAverageTemperatureC, 1)}°C</strong></div>
        <div><span>최고 표면온도 · 정지 / 회전</span><strong>{finite(value.staticMaximumTemperatureC, 1)} / {finite(value.rotatingMaximumTemperatureC, 1)}°C</strong></div>
        <div><span>45°C 초과 · 정지 / 회전</span><strong>{finite(value.staticHoursAbove45, 1)} / {finite(value.rotatingHoursAbove45, 1)} h</strong></div>
        <div><span>온도계수 감쇠 · 정지 / 회전</span><strong>{finite(value.staticTemperatureLossPct, 2)} / {finite(value.rotatingTemperatureLossPct, 2)}%</strong></div>
        <div><span>열이력 모델</span><strong>{value.thermalHistoryAvailable ? "재료점 비정상 열이력" : "준정상 표면온도"}</strong></div>
      </div>
      {value.rotationDecomposition ? <><p className="comparison-condition-note"><Info size={14} /> 2×2 대표일 분해 · {value.rotationDecomposition.representativeDate} · 선택 기간 합계가 아닙니다.</p><div className="summer-metric-grid rotation-effect-decomposition" aria-label="회전 광학·열 2×2 반사실험 분해">
        <div><span>E00 · 정지·완전 열모델</span><strong>{finite(value.rotationDecomposition.e00Wh, 3)} Wh</strong></div>
        <div><span>E10 · 회전·광학만</span><strong>{finite(value.rotationDecomposition.e10Wh, 3)} Wh</strong></div>
        <div><span>E01 · 회전·열·상대풍만</span><strong>{finite(value.rotationDecomposition.e01Wh, 3)} Wh</strong></div>
        <div><span>E11 · 회전·광학·열 모두</span><strong>{finite(value.rotationDecomposition.e11Wh, 3)} Wh</strong></div>
        <div><span>광학 회전 이득 · E10−E00</span><strong>{signed(value.rotationDecomposition.opticalGainWh, 3)} Wh</strong></div>
        <div><span>열·상대풍속 결합 주효과 · E01−E00</span><strong>{signed(value.rotationDecomposition.thermalGainWh, 3)} Wh</strong><small>2×2만으로 온도분산과 대류냉각의 별도 에너지 귀속은 불가</small></div>
        <div><span>광학×열 상호작용</span><strong>{signed(value.rotationDecomposition.interactionWh, 3)} Wh</strong></div>
        <div><span>순 AC 변화 · E11−E00</span><strong>{signed(value.rotationDecomposition.netGainWh, 3)} Wh</strong></div>
        <div><span>평균 / 최고온도 변화</span><strong>{signed(value.rotationDecomposition.averageTemperatureDeltaC, 2)} / {signed(value.rotationDecomposition.maximumTemperatureDeltaC, 2)}°C</strong></div>
        <div><span>최대 온도편차 변화</span><strong>{signed(value.rotationDecomposition.standardDeviationDeltaC, 2)}°C</strong></div>
        <div><span>hot-spot 지속시간 변화</span><strong>{signed(value.rotationDecomposition.hotspotPersistenceDeltaHours, 2)} h</strong></div>
        <div><span>분해 폐합</span><strong>E10−E00 + E01−E00 + interaction = E11−E00</strong></div>
      </div></> : null}
      <div className="summer-hourly" role="img" aria-label="시간대별 정지와 회전 AC 출력 비교 막대">
        {Array.from({ length: 24 }, (_, hour) => <div key={hour} title={`${String(hour).padStart(2, "0")}:00 · 정지 ${finite(value.hourlyStaticW[hour] ?? 0, 2)} W · 회전 ${finite(value.hourlyRotatingW[hour] ?? 0, 2)} W`}><span style={{ height: `${((value.hourlyStaticW[hour] ?? 0) / maxPower) * 100}%` }} /><i style={{ height: `${((value.hourlyRotatingW[hour] ?? 0) / maxPower) * 100}%` }} />{hour % 3 === 0 ? <small>{hour}</small> : null}</div>)}
      </div>
      <div className="summer-legend"><span><i className="static" /> 정지</span><span><i className="rotating" /> 회전</span></div>
      {!value.thermalHistoryAvailable ? <p className="rotation-physics-warning"><AlertTriangle size={15} /> 선택 기간 합계는 준정상 집계입니다. 아래 2×2 카드가 있으면 표시된 실제 대표일만 비정상 재료점 열이력으로 분해합니다.</p> : null}
    </section>
  );
}

export interface MethodologyStage {
  title: string;
  easy: string;
  formula: string;
  variables: string;
  currentInput: string;
  currentResult: string;
  assumption: string;
  scope: string;
  reference: string;
}

export function SimulationMethodology({ stages }: { stages: MethodologyStage[] }) {
  const [mode, setMode] = useState<"simple" | "expert">("simple");
  const [openStage, setOpenStage] = useState(0);
  return (
    <section className="surface-card simulation-methodology" aria-labelledby="simulation-methodology-title">
      <div className="analysis-panel-heading">
        <div><Sun size={18} /><span><strong id="simulation-methodology-title">시뮬레이션 작동 원리 · 8단계</strong><small>같은 입력이 형상, 광학, 열, 전기, 시간 적분을 어떻게 통과하는지 추적합니다.</small></span></div>
        <div className="analysis-segmented" role="group" aria-label="설명 상세 수준"><button type="button" aria-pressed={mode === "simple"} className={mode === "simple" ? "active" : ""} onClick={() => setMode("simple")}>단순 모드</button><button type="button" aria-pressed={mode === "expert"} className={mode === "expert" ? "active" : ""} onClick={() => setMode("expert")}>전문가 모드</button></div>
      </div>
      <ol className="methodology-steps">
        {stages.map((stage, index) => {
          const open = openStage === index;
          const buttonId = `method-stage-${index + 1}`;
          const panelId = `method-stage-panel-${index + 1}`;
          return <li key={stage.title} className={open ? "open" : ""}>
            <button id={buttonId} type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpenStage(open ? -1 : index)}><i>{index + 1}</i><span><strong>{stage.title}</strong><small>{stage.easy}</small></span><ChevronDown size={15} /></button>
            {open ? <div id={panelId} role="region" aria-labelledby={buttonId} className="methodology-detail">
              <div><span>현재 입력</span><strong>{stage.currentInput}</strong></div>
              <div><span>현재 결과</span><strong>{stage.currentResult}</strong></div>
              {mode === "expert" ? <>
                <div className="methodology-formula"><span>공식</span><code>{stage.formula}</code></div>
                <div><span>변수 · 단위</span><strong>{stage.variables}</strong></div>
                <div><span>가정</span><strong>{stage.assumption}</strong></div>
                <div><span>적용 범위</span><strong>{stage.scope}</strong></div>
                <div><span>참고 문헌</span><strong>{stage.reference}</strong></div>
              </> : <p>{stage.assumption}</p>}
            </div> : null}
          </li>;
        })}
      </ol>
    </section>
  );
}

export function AnalysisPanelFallback({ children }: { children: ReactNode }) {
  return <div className="analysis-panel-fallback"><AlertTriangle size={15} />{children}</div>;
}
