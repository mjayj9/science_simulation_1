# 동일 토지 점유면적 비교 보고서

검증 기준일: 2026-08-12 (Asia/Seoul)

## 결과를 읽는 방법

최신 순위와 수치는 [자동 생성 검증 보고서](generated-validation-report-2026.md) 및 그 원본인 [실제 전년 비교 감사 JSON](full-year-comparison-audit-2026.json)을 따른다. 이 문서에는 숫자표를 복제하지 않는다. 과거 `fair-comparison-audit-2026.json`의 12대표일 가중치는 실제 8,760/8,784시간 worker 결과가 아니므로 최신 전년 순위와 혼합하지 않는다.

공식 비교는 같은 `A_land`와 공통 `H_max=2√(A_land/π)`를 적용하지만 형상별 `A_PV`는 같지 않다. 따라서 하나의 “효율 순위” 대신 다음 세 질문을 분리한다.

- 토지 생산성: `AC kWh/year ÷ A_land`
- PV 면적당 생산성: `AC kWh/year ÷ A_PV`
- 이상적 상한: 각 미소면의 독립 MPP를 합한 `local-mpp-area-integral`

총 AC와 토지 생산성은 모든 행의 `A_land`가 정확히 같을 때 같은 순서를 가져야 한다. PV 면적당 생산성은 재료량이 다른 형상을 비교하므로 순서가 달라질 수 있다. 각 결과 행에는 `A_land`, `A_PV`, `A_PV/A_land`, 총 AC, 두 정규화 값과 계산 provenance가 함께 있어야 한다.

## 공정 기하 계약

평면·정육면체·원기둥·구·반구·원뿔은 동일한 토지 점유 기준과 높이 상한을 사용한다. `A_PV`는 형상별 실제 해석 활성 표면적이며 순위를 맞추는 multiplier가 아니다. 회전하는 평면·정육면체처럼 비축대칭인 구조는 유리한 한 자세가 아니라 360° swept occupation이 공통 `A_land`와 맞아야 한다.

높이·투영·활성면적 공식과 허용오차는 [공정 기하 감사](fair-geometry-audit-2026.md)가 권위다. custom height, parcel 초과, 보조로터 공정 자료 누락 등 eligibility 위반 행은 공식 순위에서 제외한다.

## 회전별 비교

실제 전년 감사는 다음 group을 서로 섞지 않는다.

- 정지: 모든 형상 `0 RPM`.
- 통제 RPM: 모든 형상에 같은 지정 RPM. 능동 모터라면 `P_motor=τ|ω|/η_motor`를 gross AC에서 차감하며 net AC를 음수 발전으로 표시하지 않는다.
- 자연 RPM: 형상별 투영면적·힘 작용점·관성·마찰·항력·`C_Q(λ)`를 사용해 각 기상 interval의 `I·dω/dt=τ_aero-τ_loss`를 적분한다. 월·연간 RPM은 시간가중 평균이다.

source-backed 자가기동 `C_Q`가 없는 대칭 형상의 공식 자연 RPM은 0이다. 사용자 `C_Q` sensitivity는 low confidence이며, 별도 수동 로터의 footprint·높이·음영이 완전하지 않으면 공식 순위에서 제외한다. 상세 입력 출처와 exclusion은 [자연회전 감사](natural-rotation-audit-2026.md)를 따른다. 풍력으로 생성된 전기는 모든 group에서 제외한다.

## 전기 연결별 비교

각 회전 group은 두 전기 계약을 분리해 제시한다. 다만 공학적 연결은 현재 mesh 수렴 기준을 통과하지 못했으므로 공식 순위가 아니라 `not-evaluated` 탐색 순서와 수렴 실패 근거만 보고한다.

- 이상적 연속막 상한: `local-mpp-area-integral`.
- 공학적 전기 연결: 동일 명목 셀 밀도, 명시적 셀 직렬·스트링 병렬·bypass substring·배선 저항을 쓰는 `explicit-series-parallel-bypass`.

공학적 연결은 실제 제조사 모듈의 완전한 digital twin은 아니지만 직렬 불일치와 bypass를 모델에서 제외한 local-MPP 상한과 같은 결과로 부르지 않는다. 두 결과의 차이는 [생성 보고서](generated-validation-report-2026.md)의 대응 표에서 직접 계산한다.

## 열모델별 비교

일반 전년 순위의 준정상 행은 `준정상 광학 회전·열이력 미포함`이라고 표시한다. 이는 각 timestamp의 Faiman 온도를 독립적으로 푼 값이다.

annual transient 감사는 실제 전년 weather clock에 걸쳐 열상태 `T(t)`를 이어가며 E00/E10/E01/E11과 광학·열·상호작용·순 효과를 계산한다. 그 결과를 대표일 환산처럼 취급하지 않는다. 같은 fixture의 준정상·과도 차이는 [열모델 비교 감사](thermal-model-comparison-audit-2026.md), 에너지 폐합과 열망 수렴은 [annual transient 감사 JSON](annual-transient-audit-2026.json)을 따른다.

현재 과도 열경로는 local-MPP 연속표면에 한정되므로 공학적 연결·장애물·plane tracking과 결합한 연간 과도열 순위를 제공하지 않는다. 미지원 조합을 준정상 결과로 대체해 “열이력 포함”이라고 표시하면 안 된다.

## 시간과 기상 provenance

공식 전년 결과는 비윤년 8,760개 또는 윤년 8,784개 실제 시간구간과 마지막 closing endpoint를 사용한다. closing endpoint는 마지막 구간을 닫을 뿐 한 시간의 에너지를 더 만들지 않는다. 각 표에는 기상 provider/kind, seed 또는 출처, 시간 해상도와 실제 전년 적분 여부가 기록된다.

대표일 계산은 별도의 진단 도구다. 대표일의 peak temperature, hotspot 또는 E 분해를 실제 전년 worker 순위와 같은 종류의 값처럼 섞지 않는다.

## 연구 결과와의 경계

일반 형상 순위는 특정 논문 순위를 재현하기 위한 표가 아니다. A–D는 source-equivalent 조건 부족으로 `not-evaluated`다. E/F benchmark도 각각 제한된 광학·기하 및 회전·열 상관을 검증할 뿐 일반 전년 순위를 직접 검증하지 않는다. 조건·오차·판정은 [연구 source-equivalent 감사](research-source-equivalent-audit.md)를 참조한다.

## 해석 범위

현재 결과는 명시된 기상·광학·전기·열·회전 입력에서의 공학 비교다. 곡면 제조, 실제 셀 layout, 구조 안전, 풍동 계수, 계측 기상과 운영 제어를 자동 인증하지 않는다. 세부 한계는 [알려진 한계](known-limitations.md)를 따른다.
