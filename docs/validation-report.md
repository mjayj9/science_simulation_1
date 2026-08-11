# 검증 결과와 테스트 계약

검증 기준일: 2026-08-11 (Asia/Seoul)

이 문서는 테스트 통과 개수를 고정해서 기록하지 않는다. 테스트가 추가되면 숫자는 즉시 낡기 때문이다. 현재 결과는 명령의 성공 여부와 계약 범위로 기록한다.

## 실행 상태

| 명령 | 현재 상태 | 범위 |
|---|---|---|
| `npm.cmd run typecheck` | 통과 | TypeScript strict/noEmit |
| `npm.cmd run lint` | 통과 | ESLint |
| `npm.cmd run test:unit` | 통과 | 아래 Vitest 계약 |
| `npm.cmd run build` | 통과 | vinext production build |
| `npm.cmd run test:smoke` | 통과 | 빌드 HTML/한국어 메타데이터 |

unit, production build, standalone typecheck와 전체 lint가 통과했다. 연속 스킨 문구로 계약을 갱신한 production HTML smoke도 다시 실행해 통과했다.

## 자동 테스트 계약

| 테스트 파일 | 자동화된 계약 |
|---|---|
| `tests/physics.test.ts` | 태양 위치·ENU 좌표, AOI/cosine/IAM 단일 적용, GHI 폐합 감사, 밤 출력 0, Faiman, PV·회로·바이패스, 인버터 clipping/저부하 차단, RPM 0, 고RPM 수렴, Wh 적분과 결정론 |
| `tests/continuous-surfaces.test.ts` | 세 곡면의 정확한 `0.050 m²` 치수, 20개 `0.0025 m²` 전 방위 zone, 해석 법선과 특이점 회피, 구 `A/4`, 원기둥·원뿔 해석 투영면적, Y 회전 불변, 유한 격자 phase 오차, `Nφ=32 → 64` POA 수렴 |
| `tests/continuous-surface-physics.test.ts` | 세 곡면의 표면 POA·온도 적분, 20-zone Mode A/B, 밤·영 일사, 전용 I–V/바이패스 경로, 저온 이득을 포함한 signed 손실 원장 폐합, Y 회전 전기 출력 수렴, 서울 하지 10분 일일 AC의 `Nφ=32 → 64` 수렴 |
| `tests/infrastructure.test.ts` | 평면·정육면체·자유 조립의 강체 패널 유지, 곡면 zone anchor와 연속 모델 일치, ray 차폐, 프로젝트 저장·마이그레이션, 날씨 adapter/fallback, worker 규모·취소 |
| `tests/time-series-diagnostics.test.ts` | 정상 일몰, 기상·차폐·바이패스·인버터 전이, 밤과 회전 위상평균의 원인코드/심각도, 서울 하지·춘분·동지 5/10분 시계열의 길이·정렬·중복·무원인 단일점 anomaly 검사 |
| `tests/simulator-ui.test.ts` | 날짜 rollover, 자동 날씨 모드, 고정 RPM 구간평균 에너지의 단일 적분, 위상 밀도 수렴, 일간 경로 배선 회귀 |
| `tests/workers-annual.test.ts` | 공급된 기상 우선, 실제 POA→온도→PV→회로→인버터 경로, 회전 pose와 구간 적분, 월 경계, closing endpoint, 진행률·취소, GHI 폐합, stale fingerprint 차단, 곡면 표본 입력 검증·적분, 회전된 강체 pose·곡면 표본의 AABB 직달 차폐 |
| `tests/rendered-html.test.mjs` | production HTML 응답과 한국어 제품 메타데이터 smoke |

## 곡면 검증의 정확한 범위

현재 자동화가 보장하는 내용은 다음과 같다.

- 총 활성면적과 각 전기 구역 가중치가 부동소수점 허용오차 안에서 정확하다.
- 렌더 mesh의 삼각형 수와 물리 `Nφ`는 별도 입력이다.
- 각 표본의 위치·법선·가중치는 유한하며 법선 길이는 1이다.
- 축대칭 투영면적 함수는 Y 회전에 정확히 불변이다.
- `Nφ=64` 유한 표본합의 임의 Y 위상 변화가 0.5% 미만이다.
- 대표 태양 방향 집합에서 `Nφ=32`와 64의 직달 및 총 POA 적분 차이가 0.5% 미만이다.
- `Nφ=64` 수치 투영면적과 해석 투영면적의 차이가 0.1% 미만이다.

마지막 두 순간 적분 항목에 더해 `simulateContinuousSurface()`의 Mode A·B, 영 일사, 회전 출력, signed 손실 원장 폐합과 서울 하지 맑은 날 10분 일일 AC의 `Nφ=32 → 64` 변화 0.5% 미만을 별도 fixture로 검증한다. 이 일일 수렴 계약은 하지·오프라인 clear·장애물 없음 조건이며 모든 계절·기상·차폐에 대한 보장은 아니다.

## 시간·worker 검증의 정확한 범위

- `WeatherSeries` 입력은 중복 없는 오름차순 UTC timestamp와 유한·비음수 복사량을 요구한다.
- 공급된 GHI/DNI/DHI는 worker에서 다시 일사 곡선으로 변형하지 않는다.
- 회전 구간평균 행은 사다리꼴로 다시 평균하지 않고 해당 구간 에너지에 한 번만 사용한다.
- 연간 worker는 요청 fingerprint와 다른 취소/완료 이벤트를 stale로 처리하며 이전 run의 chunk 또는 완료값을 새 run에 누출하지 않는다.
- `SimulatorClient.runAnnual()`은 현재 품질의 연속 곡면 모델에서 각 zone의 GL2×`Nφ` 위치·법선·면적가중 표본을 worker에 전달한다. worker는 같은 weather point에서 표본별 POA·온도를 적분한 뒤 zone당 한 개의 I–V 곡선을 회로에 공급한다.
- 연간 요청은 UI 시간대의 고정 offset을 `reportingOffsetMinutes`로 전달한다. 내부 계산 timestamp는 UTC를 유지하고 월별 에너지 bucket 경계만 해당 현지 offset으로 나눈다.
- UI는 ground와 water를 제외한 장애물의 정규화 AABB를 각 variant의 `obstacleBounds`로 전달한다. worker는 Y 회전된 강체 panel pose와 곡면 sample 위치에서 태양 방향 ray–AABB를 검사하고 그 직달 visibility를 POA에 적용한다. 빈 경계, 회전된 강체와 회전된 곡면 표본, 잘못된 경계 입력이 회귀 테스트에 포함된다.

따라서 연간 곡면 계산이 zone 대표 법선 하나만 사용하거나 외부 장애물을 전부 무시하던 한계는 제거됐다. 남은 차폐 한계는 표현 정밀도다. 복잡한 GLB/GLTF의 실제 삼각형을 worker로 보내지 않고 UI에서 정규화한 정적 AABB proxy를 사용하므로 회전되거나 오목한 장애물의 실루엣을 보수적으로 크게 가릴 수 있다. 이 ray는 직달 성분에만 적용되며 산란광 sky-view와 지면 view factor는 별도 적분하지 않는다.

## 아직 자동화되지 않은 완료 조건

- 구현된 그래프 급변점 클릭이 timestamp, 기상, 구역 AOI/POA, 회로 상태와 원인코드를 표시하는지 확인하는 브라우저 테스트
- Three.js에서 곡면이 빈틈없이 보이고 구역 경계/표본 helper 토글 및 곡면 hit-test가 동작하는 시각 회귀
- 실제 production build를 실행한 브라우저에서 수정 전후 순간·일간·연간 수치 snapshot 비교

## 2026-08-11 수동 브라우저 확인

- 서울 `37.5665 / 126.9780`, UTC+9, 2026-06-21, RPM 0, 장애물 0 조건에서 실제 화면을 열어 평면과 구 연속 mesh, 구역 경계, GL2×φ32 표본, 법선과 광선을 확인했다.
- 일간 그래프 점 클릭으로 선택 시각이 `18:00 → 11:50`으로 바뀌고 UTC·원본 timestamp, 기상 source, 태양각, Mode A/B, 20개 zone의 AOI/POA/온도/V/I/상태가 함께 갱신되는 것을 확인했다.
- 평면의 수정 후 일간 에너지는 `60.10 Wh`, 18:00은 태양고도 `20.51°`, 가시율 `100%`, DC/AC `1.4386 / 1.3483 W`, 원인코드 `NORMAL_SUNSET`이었다.
- 같은 평면의 브라우저 8,760시간점 worker를 100%까지 완주했고 연간 AC는 `19.21 kWh`였다. 12개 대표일 추정 `19.22 kWh`와 별개로 worker URL·진행률·완료 상태·현지 월 경계를 실제 경로에서 확인했다.
- 동일 화면의 12개 대표일 연간 비교는 평면 `19.22 kWh`, 구 Mode A/B `4.47 / 9.31 kWh`, 원기둥 `9.20 / 9.20 kWh`, 원뿔 `12.44 / 12.44 kWh`였다. 이는 full 8,760시간 worker 결과가 아니라 UI의 대표일 추정치다.
- 브라우저 개발자 로그에는 Vite 연결 및 React 개발 안내 외의 오류가 없었다.

## 수치 결과 해석

동일 활성면적은 동일 투영면적을 뜻하지 않는다. 정면 평면은 최대 `A`, 완전 구는 항상 `A/4`를 투영하므로 평면의 직달 출력이 구보다 최대 약 4배인 결과는 물리적으로 가능하다. Mode B는 광학·온도 차이를, Mode A와 Mode B의 차이는 회로 mismatch·바이패스 영향을 분리하는 데 사용한다. 테스트나 문서 모두 형상 순위를 맞추기 위한 multiplier를 허용하지 않는다.

모델 적용 범위는 [알려진 한계](known-limitations.md), 시간 급변의 진단 기준은 [입사각·시간 진단 계약](incident-angle-diagnosis.md)을 함께 따른다.
