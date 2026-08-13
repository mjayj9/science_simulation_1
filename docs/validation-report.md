# 검증 결과 및 테스트 계약

검증 기준일: 2026-08-12 (Asia/Seoul)

## 수치 권위

현재 결과·오차·판정·순위의 단일 사람이 읽는 진입점은 [자동 생성 검증 보고서](generated-validation-report-2026.md)다. 그 파일은 아래 감사 JSON에서 매번 생성되며 수치를 손으로 복사해 유지하지 않는다. 이 문서 또한 계산 수치나 테스트 개수를 중복 기록하지 않는다.

| 감사 | 기계 판독 원본 | 사람이 읽는 파생본 | 검증 계약 |
|---|---|---|---|
| 공정 기하 | [`fair-geometry-audit-2026.json`](fair-geometry-audit-2026.json) | [`fair-geometry-audit-2026.md`](fair-geometry-audit-2026.md) | 공통 수평투영, `H_max`, 회전 불변성·면적 불변식 |
| 실제 전년 비교 | [`full-year-comparison-audit-2026.json`](full-year-comparison-audit-2026.json) | [`full-year-comparison-audit-2026.md`](full-year-comparison-audit-2026.md) | 정지·통제 RPM·자연 RPM, 이상적·공학적 연결, 실제 시간 구간 |
| 연간 과도 열 | [`annual-transient-audit-2026.json`](annual-transient-audit-2026.json) | 통합 보고서에서 생성 | persistent `T(t)`, E00/E10/E01/E11, 열잔차·mesh 수렴 |
| 열모델 비교 | [`thermal-model-comparison-audit-2026.json`](thermal-model-comparison-audit-2026.json) | [`thermal-model-comparison-audit-2026.md`](thermal-model-comparison-audit-2026.md) | 같은 전년 clock의 준정상·과도 차이 |
| 자연회전 | [`natural-rotation-audit-2026.json`](natural-rotation-audit-2026.json) | [`natural-rotation-audit-2026.md`](natural-rotation-audit-2026.md) | 형상별 ODE, no-C_Q 0 RPM, 공정 제외 sensitivity |
| 연구 재현 | [`research-source-equivalent-audit.json`](research-source-equivalent-audit.json) | [`research-source-equivalent-audit.md`](research-source-equivalent-audit.md) | 1차 출처 조건, 오차·허용오차·판정 |

`fair-comparison-audit-2026.json`의 과거 12대표일 환산표는 실제 전년 순위의 권위가 아니다. 새 전년 감사와 섞어 인용하지 않는다.

## 현재 구현 계약

- 실제 전년 계산은 비윤년 8,761개 weather 경계/8,760개 구간 또는 윤년 8,785개 경계/8,784개 구간을 직접 적분한다. closing endpoint는 중복 에너지로 계산하지 않는다.
- 정지, 모든 형상에 같은 통제 RPM, 형상별 자연회전을 별도 group으로 계산한다. 자연회전은 월평균 풍속을 한 번 푸는 방식이 아니라 각 weather interval에서 동역학 ODE를 적분한다.
- 전기 결과는 `local-mpp-area-integral` 이상적 연속막 상한과 `explicit-series-parallel-bypass` 공학적 연결로 분리한다.
- 준정상 결과에는 `준정상 광학 회전·열이력 미포함` provenance를 붙인다. annual transient opt-in의 authoritative 월·연간 결과는 full-clock E11이며 E00/E10/E01/E11 폐합, 열수지 잔차와 mesh 수렴을 함께 보고한다.
- 모든 순위 행은 `A_land`, `A_PV`, `A_PV/A_land`, 총 AC, kWh/m²-land/year, kWh/m²-PV/year, 전기·열·회전 모델, 기상 출처, 시간 해상도와 실제 전년/대표일 구분을 가진다.

## 연구 source-equivalent 판정

A–D는 원 논문의 핵심 조건이 충분하지 않아 계속 `not-evaluated`이며 성공 건수에서 제외된다. E는 direct-beam convex-sphere 기하·광학 benchmark, F는 rotating heated-disk Reynolds/Nusselt benchmark로 source-equivalent 실행한다. 이 두 pass의 적용 범위는 각각 PV 전기/열 연간모델 전체가 아니라 해당 광학·기하 및 회전·열 상관 계산이다.

논문별 보고값, 계산값, 절대·상대오차, 사전 허용오차, 일치·불일치 조건과 pass/partial/fail 판정은 [연구 감사](research-source-equivalent-audit.md)만을 권위로 삼는다. 연구 결과에 맞추기 위한 multiplier는 사용하지 않는다.

## 재생성 명령

감사 파일은 다음 계산 명령으로 갱신한 뒤 통합 보고서를 마지막에 생성한다.

```text
npm run audit:geometry
npm run audit:annual
npm run audit:natural
npm run audit:thermal
npm run audit:thermal-compare
npm run audit:research
npm run report:validation
```

단위·통합 테스트, typecheck, lint, production build와 렌더 smoke의 실제 명령·개수·실행시간은 최종 검증 실행 로그에서 보고한다. 이 수동 문서에는 과거 실행 개수나 시간을 고정값으로 남기지 않는다.

## 판정 범위

자동 검증은 모델 내부의 불변식과 지정 fixture를 검사한다. 실제 제조 가능성, 계측 기상 오차, 구조·전기 안전성과 장기 신뢰성을 인증하지 않는다. 특히 annual transient와 공학적 전기 연결의 결합, 장애물/plane tracking을 포함한 annual transient는 현재 미지원이다. 상세 해석 경계는 [알려진 한계](known-limitations.md)를 따른다.
