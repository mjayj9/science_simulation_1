# 검증 결과와 테스트 계약

검증 기준일: 2026-08-12 (Asia/Seoul)

## 현재 상태

이 문서는 테스트 개수를 영구 릴리스 계약으로 고정하지 않는다. 테스트 파일과 항목은 구현과 함께 늘어날 수 있기 때문이다. 2026-08-12 최종 통합 재실행에서는 **Vitest 14개 파일·279개 테스트**, production build, 렌더 HTML smoke 2개가 모두 통과했다.

| 명령 | 문서 감사 시점 상태 | 최종 판정 규칙 |
|---|---|---|
| `npm.cmd run test:unit` | PASS — 14 files / 279 tests | 모든 항목 성공 |
| `npm.cmd run typecheck` | PASS | TypeScript 오류 없음 |
| `npm.cmd run lint` | PASS | ESLint 오류 없음 |
| `npm.cmd run build` | PASS | production build 성공 |
| `npm.cmd run test:smoke` | PASS — 2/2 | production HTML·메타데이터 검증 |
| `npm.cmd test` | PASS | unit → build → HTML smoke 전체 성공 |

이 숫자는 위 날짜의 최종 체크포인트이며, 이후 변경이 있으면 더 최신 실행 로그가 우선한다.

## 기본 비교 계약의 감사 결론

기본 동일 토지 비교는 형상당 worker variant 하나를 사용한다.

```text
variantId: compare:<shape>:ideal
continuousSurface.electricalModel: local-mpp-area-integral
Σ continuousSurface.samples[].areaM2 = A_PV
```

기본 variant에는 `panelCount`, `totalPanelAreaM2`, `topology`, `electricalFairnessMode`가 없다. 각 절대면적 표본의 POA·온도·국소 DC를 더하고 공통 인버터를 한 번 적용한다. 따라서 기본 결과에 20-zone Mode A/B 차이, 회로 mismatch 또는 bypass가 생기면 회귀다.

자유 조립과 이전 프로젝트의 discrete-panel branch는 계속 테스트한다. 해당 branch의 20개 패널, Mode A/B, 단일 다이오드와 bypass 테스트가 남아 있다는 사실은 기본 비교가 그 모델을 쓴다는 뜻이 아니다.

## 자동 테스트 파일별 정확한 범위

| 테스트 파일 | 기본 비교/공통 계약 | 레거시·기타 계약 |
|---|---|---|
| `tests/physics.test.ts` | 태양위치, AOI/cosine/IAM 단일 적용, 밤 0, Faiman, 인버터, 에너지 적분 | 단일 다이오드·회로·바이패스와 회전 단위 fixture |
| `tests/continuous-surfaces.test.ts` | 해석 법선, 구·반구·원기둥·원뿔 투영, Y회전 불변, `Nφ` 수렴 | `0.050 m²`, 20-band 이전 곡면 생성기 회귀 |
| `tests/continuous-surface-physics.test.ts` | 기본값의 국소 MPP alias, 면적 적분, 밤 0, 반사광 cap, 손실원장 | 명시적 `distributed-circuit`와 이전 zone I–V 경로 |
| `tests/land-comparison.test.ts` | 여섯 형상의 동일 `A_land`, 면적지수, `A_PV` 닫힌식, 평면 `L×L`·0~75°·높이 제한, 매개화 영역 면적합 | 선택적 active-basis 기하 API 호환 |
| `tests/land-area-acceptance.test.ts` | 구 직달 예산 `A_land`, 밤·유한성·결정론, local-MPP에서 mismatch/bypass 0, spike/dropout, 대표일 수렴 | backward field name이 같은 결과를 가리키는지 확인 |
| `tests/comparison-performance.test.ts` | land/PV 이중 정규화, 원 시계열 적분, 광학 성분과 비유한 입력 거부 | 없음 |
| `tests/reflector-budget.test.ts` | Lambert 지면/반사판 면적 예산과 일반·연구 설정 격리 | 연구용 등가 반사 옵션 |
| `tests/research-presets.test.ts` | shape multiplier 금지, 명시값만 적용, null 보존 | 연구 namespace와 일반 설정 복귀 |
| `tests/three-workspace.test.ts` | 실제 수평 투영, top view parcel, 원형/swept footprint, 반구 dome, 높이 표시 | 렌더 helper 계약 |
| `tests/infrastructure.test.ts` | continuous-skin anchor와 ray/worker 경계 | 강체 panel, 저장·migration, API fallback |
| `tests/time-series-diagnostics.test.ts` | 정상 일몰, 기상·차폐·인버터 전이, 무원인 spike/dropout | bypass 전이 원인코드 |
| `tests/simulator-ui.test.ts` | 여섯 형상·동일 토지·fixed 평면 기본값, 단일 continuous variant, 이중 정규화, 비교 화면에서 20구역/`N_eq`/동일 활성면적/Mode A/B 제거 | 연구 전환과 현재 형상 화면 배선 |
| `tests/annual-worker-guard.test.ts` | 현재 worker 객체와 request ID/fingerprint가 모두 일치하는 event만 수용 | 종료된 이전 worker의 queued event 차단 |
| `tests/workers-annual.test.ts` | protocol v3 fingerprint, 절대면적 표본, panelCount 없는 단일 스킨, local-MPP 면적합, 밤 0, 원기둥 영역 폐합, AABB 차폐, 8,761 boundary validation | explicit panel Mode A/B, 회로, 회전·취소·stale 호환 |

`tests/rendered-html.test.mjs`는 Vitest 개수에 포함하지 않는 production HTML·한국어 메타데이터 smoke다.

## 수치 적분 검증 범위

현재 자동화가 보장하는 내용은 다음과 같다.

- 모든 표본의 위치·법선·절대면적이 유한하고 면적 가중치가 양수다.
- 표본 면적합이 해석 `A_PV`와 부동소수점 허용오차 안에서 같다.
- 렌더 mesh tessellation과 물리 `Nφ`는 서로 다른 입력이다.
- 구의 direct-only 적분은 `DNI×A_land`에 0.1% 안에서 닫힌다.
- 축대칭 투영면적 함수는 Y축 회전에 해석적으로 불변이다.
- 선택한 순간·clear-day·12개 대표일 fixture에서 `Nφ=32→64` 변화가 요구 허용오차 안에 있다.
- 여섯 형상의 밤 POA·DC·AC는 정확히 0이고 재실행 결과가 결정론적이다.
- 기본 local-MPP 결과는 mismatch/bypass 손실을 만들지 않는다.

마지막 수렴 기준은 fixture 범위의 수치 계약이다. 임의의 좁은 AABB 그림자, discontinuous weather, 빠른 회전과 실제 관측 연간 자료 전체에 0.5%를 보편 보증하지 않는다.

## worker와 시간축 검증 범위

- `WeatherSeries`는 중복 없는 오름차순 UTC timestamp와 유한·비음수 복사량을 요구한다.
- 공급된 GHI/DNI/DHI를 worker에서 과거의 `sin(elevation)` 또는 제곱근 곡선으로 다시 만들지 않는다.
- 연간 8,760개 시간 구간에는 다음 해 첫 boundary를 포함한 8,761개 timestamp가 필요하다.
- 월 bucket은 `reportingOffsetMinutes`의 현지 경계로 나누되 태양·복사 계산 timestamp는 UTC다.
- 고정 RPM interval-average는 에너지에 한 번만 곱하고 다시 사다리꼴 평균하지 않는다.
- source worker 객체, request ID 또는 fingerprint 중 하나라도 현재 active request와 다르면 queued chunk·complete·cancel 이벤트를 stale로 폐기한다.
- 기본 비교 worker는 fixed 평면 또는 표본의 공통 Y회전 자세에서 static obstacle AABB로 직달 가시율을 계산한다. 단축·이축 평면 tracking adapter는 worker 호환 테스트에는 남지만 동일 토지 기본 비교 variant에는 들어가지 않는다.
- ground와 water는 장애물 AABB에서 제외한다. 산란광 sky-view 차폐는 이 ray 테스트의 범위가 아니다.

## 실제 브라우저 8,760시간 실행

기록된 실행은 새 세션의 기본 비교 화면에서 annual worker를 100%까지 완료한 결과다. worker는 양끝점을 포함한 8,761개 weather point로 8,760개 hourly interval을 적분했다. 조건은 서울 `37.5665°N/126.9780°E`, 해발 `38 m`, UTC+9, 2026년, `A_land=0.050 m²`, 평면 `L×L` footprint·경사/방위 `30°/180°`, RPM 0, `H_max=0.3 m`, support `0.01 m`, albedo `0.20`, 인공 반사판 없음, seed `240521`의 offline clear 시계열, 균형 품질 `Nφ=32`, 기본 building/tree AABB 2개다.

| 형상 | kWh/year | kWh/m²-land/year | kWh/m²-PV/year |
|---|---:|---:|---:|
| 평면 | 23.716 | 474.315 | 410.769 |
| 정육면체 | 38.778 | 775.556 | 155.111 |
| 원기둥 | 38.842 | 776.832 | 155.366 |
| 구 | 34.557 | 691.132 | 172.783 |
| 반구 | 25.790 | 515.807 | 257.904 |
| 원뿔 | 27.743 | 554.856 | 248.139 |

원기둥 영역 귀속은 윗면 `12.986 kWh/year`, 옆면 `25.856 kWh/year`이고 합은 전체 `38.842 kWh/year`와 정확히 닫혔다. 이 표의 값과 실행 조건 해석은 [동일 토지 비교 보고서](land-area-comparison-report.md)를 따른다.

최종 평면 수치는 `L×L` 수평 footprint 수정 뒤 다시 실행한 값이다. 수정 전 장방형 footprint 실행의 `23.620 / 472.399 / 409.110`은 최신 구현 기준값에서 제외한다.

## 레거시 browser snapshot

아래 값은 2026-08-11의 기본 비교 교체 전 snapshot이다. 모두 `A_PV=0.050 m²`인 12개 대표일 추정 경로이므로 위 표와 직접 비교하지 않는다.

| 경로 | 대표연간 AC |
|---|---:|
| 평면 | 19.22 kWh |
| 구 Mode B/이상 | 9.31 kWh |
| 원기둥 | 9.20 kWh |
| 원뿔 | 12.44 kWh |

당시 구 Mode A는 `4.47 kWh`였다. Mode B `9.31 kWh`와의 차이는 20개 구역 공용 회로의 mismatch/bypass 계약이고, 평면 대비 차이는 동일 활성면적에서 평면의 큰 직달 투영과 구의 `A_PV/4` 투영 때문이다. 현재 기본 비교는 이 회로 분할을 제거하고 형상별 전체 `A_PV`의 국소 MPP를 적분한다.

## 아직 자동화되지 않은 항목

- 실제 production browser에서 8,760시간 수치를 매 커밋 고정하는 장시간 E2E 회귀
- 그래프 점 선택이 timestamp·기상·광학·인버터·원인코드를 갱신하는 브라우저 상호작용 테스트
- 연속 mesh의 틈, top-view footprint, 표본 helper와 hit-test를 픽셀 기준으로 검사하는 시각 회귀
- 실제 GLB 삼각형 실루엣과 현재 AABB 차폐 차이의 정량 fixture
- 관측/TMY 외부 기준자료와 동일 입력으로 수행한 독립 교차검증

모델의 적용 한계는 [알려진 한계](known-limitations.md), 시간 급변의 진단 기준은 [입사각·시간 진단](incident-angle-diagnosis.md)을 함께 따른다.
