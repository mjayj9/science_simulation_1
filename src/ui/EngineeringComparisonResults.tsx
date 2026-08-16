import type {
  EngineeringArtifactRankingMode,
  generatedEngineeringOfficialRankingArtifact,
} from "./engineering-official-ranking";

const ARTIFACT_MODE_LABELS: Record<EngineeringArtifactRankingMode, string> = {
  static: "\uC815\uC9C0 0 RPM",
  controlled: "\uD1B5\uC81C RPM",
  natural: "\uC790\uC5F0 RPM",
};
export interface EngineeringComparisonDisplayRow {
  id: string;
  shapeLabel: string;
  landAreaM2: number;
  pvAreaM2: number;
  idealQuasiKWh?: number;
  idealTransientKWh?: number;
  engineeringQuasiKWh?: number;
  engineeringTransientKWh?: number;
  connectionDeltaKWh?: number;
  transientThermalDeltaKWh?: number;
  official: boolean;
  landRank?: number;
  pvRank?: number;
  layoutId?: string;
}

export interface EngineeringComparisonProvenance {
  weather: string;
  timeRange: string;
  timeResolution: string;
  integration: string;
  commonLandAreaM2: number;
  footprint: string;
  electrical: string;
  quasiThermal: string;
  transientThermal: string;
  rotation: string;
  numericalResolution: string;
  convergence: string;
  status: string;
}

function energy(value: number | undefined): string {
  return value === undefined ? "계산 대기" : `${value.toFixed(3)} kWh`;
}

function delta(value: number | undefined): string {
  return value === undefined ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(3)} kWh`;
}

export function EngineeringComparisonResults({
  rows,
  provenance,
  artifact,
}: {
  rows: readonly EngineeringComparisonDisplayRow[];
  provenance: EngineeringComparisonProvenance;
  artifact: ReturnType<typeof generatedEngineeringOfficialRankingArtifact>;
}) {
  return (
    <>
      <section className="surface-card fairness-card" aria-label="연간 비교 provenance">
        <header>
          <div>
            <span>공식 결과 게이트</span>
            <strong>{provenance.status}</strong>
          </div>
          <p>
            준정상 공학 연결은 순수 연결 차이를 보는 탐색 경로이며, 공식 공학 순위는
            같은 실행의 전년 과도 열상태와 직렬·병렬·바이패스 회로가 모두 결합되고
            수렴 게이트를 통과한 경우에만 표시됩니다.
          </p>
        </header>
        <div className="fairness-list">
          <div><span>기상 출처</span><strong>{provenance.weather}</strong></div>
          <div><span>시간 범위·해상도</span><strong>{provenance.timeRange} · {provenance.timeResolution}</strong></div>
          <div><span>적분 범위</span><strong>{provenance.integration}</strong></div>
          <div><span>A_land / A_PV</span><strong>{provenance.commonLandAreaM2.toFixed(4)} m² 공통 / 형상별 표 참조</strong></div>
          <div><span>footprint 방식</span><strong>{provenance.footprint}</strong></div>
          <div><span>전기 연결</span><strong>{provenance.electrical}</strong></div>
          <div><span>열모델</span><strong>준정상: {provenance.quasiThermal} / 과도: {provenance.transientThermal}</strong></div>
          <div><span>회전모델</span><strong>{provenance.rotation}</strong></div>
          <div><span>수치 해상도</span><strong>{provenance.numericalResolution}</strong></div>
          <div><span>수렴 판정</span><strong>{provenance.convergence}</strong></div>
        </div>
      </section>

      <section className="surface-card preliminary-diagnosis" aria-label="validated artifact official ranking">
        <div className="panel-heading">
          <div>
            <h3>{"\uAC80\uC99D \uC0B0\uCD9C\uBB3C\uC758 \uACF5\uC2DD \uC21C\uC704"}</h3>
            <p>Generated full-year transient+engineering artifact only; never mixed with the interactive exploratory run.</p>
          </div>
          <strong>{artifact.available ? "official" : `gate: ${artifact.gateStatus}`}</strong>
        </div>
        {artifact.available ? (
          <div className="artifact-ranking-grid">
            {(["static", "controlled", "natural"] as const).map((mode) => (
              <div className="diagnosis-table-wrap" key={mode}>
                <h4>{ARTIFACT_MODE_LABELS[mode]}</h4>
                <table className="diagnosis-table">
                  <thead><tr><th>rank</th><th>shape</th><th>A_land</th><th>A_PV</th><th>net AC</th><th>land productivity</th><th>PV productivity</th></tr></thead>
                  <tbody>{artifact.rankings[mode].map((row) => (
                    <tr key={`${mode}:${row.shape}`}>
                      <td>#{row.rank}</td><th>{row.shape}</th>
                      <td>{row.landAreaM2.toFixed(4)} m2</td><td>{row.activePvAreaM2.toFixed(4)} m2</td>
                      <td>{row.netAcKWhYear.toFixed(3)} kWh/year</td>
                      <td>{row.kWhPerLandM2Year.toFixed(3)} kWh/m2-land/year</td>
                      <td>{row.kWhPerPvM2Year.toFixed(3)} kWh/m2-PV/year</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ))}
          </div>
        ) : (
          <p className="comparison-condition-note">{"\uAC80\uC99D \uC0B0\uCD9C\uBB3C gate\uAC00 pass\uAC00 \uC544\uB2C8\uBBC0\uB85C \uACF5\uC2DD \uC21C\uC704\uB97C \uD45C\uC2DC\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4."}</p>
        )}
        <footer className="chart-provenance"><strong>artifact provenance</strong><span>{artifact.artifactPath} / SHA-256 {artifact.artifactSha256 || "not published"} / {artifact.provenance}</span></footer>
      </section>
      <section className="surface-card preliminary-diagnosis" aria-label="이상적 local MPP와 공학적 전기 연결 비교">
        <div className="panel-heading">
          <div>
            <h3>이상적 상한 vs 공학적 전기 연결</h3>
            <p>같은 A_land·A_PV·기상·회전 조건에서 준정상 연결 차이와 과도 열 결합 차이를 분리</p>
          </div>
        </div>
        <div className="diagnosis-table-wrap">
          <table className="diagnosis-table">
            <thead>
              <tr>
                <th>형상</th>
                <th>A_land</th>
                <th>A_PV</th>
                <th>A_PV/A_land</th>
                <th>이상적 준정상</th>
                <th>공학 준정상</th>
                <th>순수 연결 차이</th>
                <th>이상적 과도</th>
                <th>공학 과도</th>
                <th>준정상→과도 공학 열차이</th>
                <th>토지 순위</th>
                <th>PV 순위</th>
                <th>layout</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const rankUnavailable = "탐색값 · 순위 판정 불가";
                return (
                  <tr key={row.id}>
                    <th>{row.shapeLabel}</th>
                    <td>{row.landAreaM2.toFixed(4)} m²</td>
                    <td>{row.pvAreaM2.toFixed(4)} m²</td>
                    <td>{(row.pvAreaM2 / Math.max(row.landAreaM2, 1e-12)).toFixed(3)}×</td>
                    <td>{energy(row.idealQuasiKWh)}</td>
                    <td>{energy(row.engineeringQuasiKWh)}</td>
                    <td>{delta(row.connectionDeltaKWh)}</td>
                    <td>{energy(row.idealTransientKWh)}</td>
                    <td>{energy(row.engineeringTransientKWh)}</td>
                    <td>{delta(row.transientThermalDeltaKWh)}</td>
                    <td>{row.official && row.landRank ? `공식 #${row.landRank}` : rankUnavailable}</td>
                    <td>{row.official && row.pvRank ? `공식 #${row.pvRank}` : rankUnavailable}</td>
                    <td><code>{row.layoutId ?? "계산 대기"}</code></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
