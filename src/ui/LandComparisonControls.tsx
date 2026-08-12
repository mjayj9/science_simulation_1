import { useState } from "react";
import { BookOpenCheck, Check, Layers3, Ruler, ScanLine } from "lucide-react";
import type { ResearchPresetId as SourceResearchPresetId } from "../lib/research";

export type ComparisonBasis = "land" | "active";
export type ReflectorMode = "none" | "white-diffuse" | "aluminum" | "research-cup";
export type PlaneTrackingMode = "fixed" | "single-axis" | "dual-axis";
export type ComparisonResearchPresetId = "general" | SourceResearchPresetId;
export type ComparisonLayoutMode = "independent" | "array";

export interface LandComparisonSettings {
  basis: ComparisonBasis;
  landAreaM2: number;
  maximumHeightM: number;
  structureHeightM: number;
  supportHeightM: number;
  structureSpacingM: number;
  maintenanceMarginM: number;
  maximumAspectRatio: number;
  maximumActiveAreaM2: number;
  groundAlbedo: number;
  reflectorMode: ReflectorMode;
  planeTrackingMode: PlaneTrackingMode;
  layoutMode: ComparisonLayoutMode;
  researchPresetId: ComparisonResearchPresetId;
  showParcel: boolean;
  showSweptFootprint: boolean;
}

interface Props {
  value: LandComparisonSettings;
  onChange: (next: LandComparisonSettings) => boolean;
}

function NumericField({
  label,
  value,
  min,
  max,
  step,
  unit,
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  disabled?: boolean;
  onChange: (value: number) => boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(parsed) || parsed < min || parsed > max) {
      setError(`${label}: ${min}~${max} 범위의 숫자를 입력하세요.`);
      setDraft(String(value));
      return;
    }
    if (!onChange(parsed)) {
      setError(`${label}: 현재 선택 형상과 높이 제약을 함께 만족하지 않습니다.`);
      setDraft(String(value));
      return;
    }
    setError(null);
  };

  return (
    <label className={`land-field ${error ? "invalid" : ""}`}>
      <span>{label}</span>
      <span><input type="number" value={draft} min={min} max={max} step={step} disabled={disabled} aria-invalid={Boolean(error)} onChange={(event) => { setDraft(event.target.value); setError(null); }} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setDraft(String(value)); setError(null); event.currentTarget.blur(); } }} /><small>{unit}</small></span>
      {error ? <small className="land-field-error" role="alert">{error}</small> : null}
    </label>
  );
}

function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <button type="button" className={`land-switch ${checked ? "active" : ""}`} aria-pressed={checked} onClick={() => onChange(!checked)}><span>{checked ? <Check size={12} /> : null}</span>{label}</button>;
}

export function LandComparisonControls({ value, onChange }: Props) {
  const patch = (next: Partial<LandComparisonSettings>) => onChange({
    ...value,
    ...next,
    basis: "land",
    layoutMode: "independent",
    structureSpacingM: 0,
    maintenanceMarginM: 0,
  });
  return (
    <section className="land-comparison-controls" aria-label="형상 비교 기준과 토지 제약">
      <div className="land-control-heading">
        <div><Layers3 size={17} /><span><strong>공통 토지 투영면적 A_land</strong><small>모든 형상의 월드 XZ 투영 합집합 면적을 정확히 같게 유지합니다.</small></span></div>
        <span className="land-contract-badge"><Check size={13} /> 면적지수 100</span>
      </div>

      <div className="land-control-grid">
        <NumericField key={`land:${value.landAreaM2}`} label="공통 A_land" unit="m²" value={value.landAreaM2} min={0.0001} max={10_000} step={0.001} onChange={(landAreaM2) => patch({ landAreaM2 })} />
        <NumericField key={`height:${value.maximumHeightM}`} label="공통 최대높이 H_max" unit="m" value={value.maximumHeightM} min={0.05} max={100} step={0.01} onChange={(maximumHeightM) => patch({ maximumHeightM })} />
        <NumericField key={`structure:${value.structureHeightM}`} label="원기둥·원뿔 높이 H" unit="m" value={value.structureHeightM} min={0.01} max={100} step={0.01} onChange={(structureHeightM) => patch({ structureHeightM })} />
        <NumericField key={`support:${value.supportHeightM}`} label="구 지지대·지면 여유" unit="m" value={value.supportHeightM} min={0} max={100} step={0.01} onChange={(supportHeightM) => patch({ supportHeightM })} />
        <NumericField key={`albedo:${value.groundAlbedo}`} label="지면 albedo" unit="—" value={value.groundAlbedo} min={0} max={1} step={0.01} onChange={(groundAlbedo) => patch({ groundAlbedo })} />
      </div>

      <div className="land-select-grid">
        <label><span>반사 조건</span><select value={value.reflectorMode} onChange={(event) => patch({ reflectorMode: event.target.value as ReflectorMode })}><option value="none">반사판 없음 · 지면만</option><option value="white-diffuse">흰색 확산판</option><option value="aluminum">알루미늄판</option><option value="research-cup">연구용 반사컵</option></select></label>
        <label><span>연구 재현 프리셋</span><select value={value.researchPresetId} onChange={(event) => patch({ researchPresetId: event.target.value as ComparisonResearchPresetId })}><option value="general">일반 비교 · 숨은 설정 없음</option><option value="research:A">A · Bernardi 3D PV</option><option value="research:B">B · El-Atab 구형 PV</option><option value="research:C">C · 구/반구 비교</option></select></label>
      </div>

      <div className="land-switches">
        <Switch checked={value.showParcel} label="A_land 반투명 바닥" onChange={(showParcel) => patch({ showParcel })} />
        <Switch checked={value.showSweptFootprint} label="360° swept footprint" onChange={(showSweptFootprint) => patch({ showSweptFootprint })} />
      </div>

      <div className="land-contract-note">
        <Ruler size={16} />
        <span><strong>비교 형상은 각각 하나의 빈틈없는 단일 연속 PV 스킨입니다.</strong><small>A_land는 시간과 태양 위치에 무관하게 고정하고, 실제 PV 활성면적 A_PV와 순간 태양 투영면적 A_sun(t)는 형상별 결과로 분리합니다.</small></span>
      </div>

      <div className="research-isolation-note"><BookOpenCheck size={15} /><span>연구 프리셋은 별도 명시 입력만 바꾸며 형상 multiplier를 사용하지 않습니다.</span><ScanLine size={14} /></div>
    </section>
  );
}
