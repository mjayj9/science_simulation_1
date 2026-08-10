# 공식과 출처

이 문서는 현재 `src/lib/physics/registry.ts`의 모델 레지스트리와 계산 코드가 사용하는 공식을 사람이 읽기 쉬운 형태로 정리한다. UI의 `공식 · 근거` 화면은 같은 model ID와 계산 trace를 사용한다. 상세 유도·선택 근거·변수 범위는 [모델링 조사](modeling-research.md)에 있다.

## 공통 규약

- 내부 단위: m, s, W, Wh, Pa, kg/m³, rad. UI 각도만 deg로 입출력한다.
- 좌표: `+X=동`, `+Y=상`, `+Z=북`.
- 방위각 `γ`: 진북 0°, 동쪽 90°의 시계 방향.
- 패널 법선 `n`: 전면 방향 단위벡터. 단면형이므로 `n·s ≤ 0`이면 직달 성분은 0이다.
- 에너지는 Wh로 반환하므로 초 단위 적분 결과를 3600으로 나눈다.

## 실행 모델 목록

| model ID | 공식과 핵심 변수 | 채택 범위 | 공식 출처 |
|---|---|---|---|
| `solar.noaa-spa-compatible` | 축약 천문력 → 고도 `αs`, 방위 `γs`; `s=(cosα sinγ, sinα, cosα cosγ)` | 진북 방위 규약, 지평선 판정. 완전 SPA 급수보다 단순함 | [NREL SPA](https://midcdmz.nrel.gov/spa/), [Reda & Andreas 보고서](https://docs.nrel.gov/docs/fy08osti/34302.pdf) |
| `weather.offline-haurwitz-erbs` | `GHIclear=1098 cosθz exp(-0.059/cosθz)`; 시나리오 감쇠 후 Erbs로 `DHI=kdGHI`, `DNI=(GHI-DHI)/cosθz` | 외부 자료가 없을 때의 결정론적 오프라인 fallback. Haurwitz는 천정각만 쓰는 clear-sky GHI 근사이며 실측 대체가 아님 | [pvlib Haurwitz](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.clearsky.haurwitz.html), [Sandia SAND2012-2389](https://www.sandia.gov/research/publications/details/global-horizontal-irradiance-clear-sky-models-implementation-and-analysis-2012-03-01/), [pvlib Erbs](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.irradiance.erbs.html) |
| `irradiance.erbs` | `kt=GHI/(Ea cosθz)`; `DHI=kd(kt)GHI`; `DNI=(GHI-DHI)/cosθz` | GHI만 있을 때 시간평균 성분 분해. 천정각 87° 이상 제한 | [Sandia PVPMC decomposition](https://pvpmc.sandia.gov/modeling-guide/1-weather-design-inputs/irradiance-insolation/direct-normal-irradiance/piecewise-decomposition-models/) |
| `poa.hay-davies` | `ηcos=max(0,n·s)`, `ηangle=ηcos·IAM`; `Gdirect=V·DNI·ηangle`; `GPOA=Gdirect+Gdiffuse+Gground` | 기하 투영과 IAM을 분리해 각각 한 번만 적용. Hay–Davies 하늘 산란과 Lambert 지면반사는 별도 성분 | [Sandia PVPMC POA](https://pvpmc.sandia.gov/modeling-guide/1-weather-design-inputs/plane-of-array-poa-irradiance/) |
| `iam.physical-ashrae` | physical `IAM=τ(θ)/τ(0)` 또는 `IAM=max(0,1-b0(secθ-1))` | 전면 유리의 입사각 반사. 90°에서 0 | [Physical IAM](https://pvpmc.sandia.gov/modeling-guide/1-weather-design-inputs/shading-soiling-and-reflection-losses/incident-angle-reflection-losses/physical-iam-model/), [ASHRAE IAM](https://pvpmc.sandia.gov/modeling-guide/1-weather-design-inputs/shading-soiling-and-reflection-losses/incident-angle-reflection-losses/ashrae-iam-model/) |
| `thermal.faiman` | `Tm=Ta+GPOA/(U0+U1·WS)` | 정상상태 모듈 온도, 기본 `U0=25 W/m²K`, `U1=6.84 W·s/m³K` | [Sandia PVPMC Faiman](https://pvpmc.sandia.gov/modeling-guide/2-dc-module-iv/module-temperature/faiman-module-temperature-model/) |
| `wind.log-profile` | `U(z)=Uref ln((z-d)/z0) / ln((zref-d)/z0)` | 중립 표면층의 패널 높이 풍속 | [DTU WAsP wind shear](https://wasp.dtu.dk/support/frequently-asked-questions/wasp-faq/Wind-shear-exponents) |
| `pv.single-diode-desoto` | `I=IL-I0[exp((V+I·Rs)/a)-1]-(V+I·Rs)/Rsh` | 정상상태 단접합 패널 I-V, bracket/Newton 수치해 | [Sandia PVPMC single diode](https://pvpmc.sandia.gov/modeling-guide/2-dc-module-iv/single-diode-equivalent-circuit-models/) |
| `pv.simple` | `Pdc=A·η·GPOA[1+γ(Tm-Tref)]` | 빠른 MPP 전력 근사, I-V 불일치는 별도 회로 모드 | [NREL PVWatts V8](https://pvwatts.nrel.gov/version_8.php) |
| `circuit.series-parallel-bypass` | 직렬 `V=ΣVj(I)`, 병렬 `I=ΣIj(V)`, bypass `Vj≥-Vf` | 공통 전류/전압 곡선 합성과 piecewise 바이패스 | [Sandia PVPMC array I-V](https://pvpmc.sandia.gov/modeling-guide/3-dc-array-iv/) |
| `inverter.pvwatts-v5` | `η=ηnom/0.9637(-0.0162ζ-0.0059/ζ+0.9858)`; `Pac=min(Pac0,ηPdc)` | 대표 부분부하 효율, MPPT/전류/클리핑 조건 | [NREL PVWatts V5](https://pvwatts.nrel.gov/downloads/pvwattsv5.pdf) |
| `rotation.drag-rigid-body` | `Iz dω/dt=Σ(r×F)·ŷ-bω-τc sign(ω)`; `F=ρCdA|Urel|Urel/2` | 공통 +Y축, 준정상 항력, 적응 서브스텝/위상평균 | [NASA drag equation](https://www.grc.nasa.gov/www/k-12/VirtualAero/BottleRocket/airplane/drageq.html) |
| `integration.trapezoid` | `E=Σ ½(Pk+Pk+1)Δt` | 순간 전력 표본의 일·월·연 에너지 | [NIST DLMF quadrature](https://dlmf.nist.gov/3.5) |

## 패널별 계산 사슬

1. 실제 `WeatherSeries`의 timestamp와 위치에서 공유 `solarPosition()`으로 태양 고도/방위와 단위벡터를 계산한다.
2. 같은 `WeatherPoint`의 GHI/DNI/DHI를 입력하거나, 외부 자료가 없을 때만 Haurwitz GHI를 만든 뒤 Erbs로 분해한다. 고도 ≤0이면 세 성분을 0으로 만든다.
3. 각 패널 표본 ray의 가시율 `V`와 `max(0,n·s)`, IAM을 직달광에 적용한다.
4. Hay–Davies 산란광과 지면 반사를 더해 `GPOA`를 얻고 오염 손실을 한 번 적용한다.
5. 국부 풍속과 Faiman으로 모듈 온도를 계산한다.
6. 간단 모드 또는 단일 다이오드로 패널 I-V/Pmax를 계산한다.
7. 직렬·병렬·바이패스 곡선을 결합해 배열 MPP를 구한다.
8. 배선 손실, 인버터 효율과 클리핑을 적용해 AC를 구한다.
9. 전력 시계열을 적분해 Wh를 구한다.

손실 원장은 이 순서의 단계 전후 차이를 기록한다. 이미 회로 곡선에 반영된 불일치·바이패스 손실을 별도 비율로 다시 차감하지 않는다.

## 오프라인 시계열과 UI 통합 계약

외부 기상자료가 없을 때의 맑은 하늘 수평면 전천일사는 다음 Haurwitz 식이다.

\[
GHI_{clear}=1098\cos\theta_z\exp\left(-\frac{0.059}{\cos\theta_z}\right),\qquad \cos\theta_z>0
\]

밤에는 0이며, 구름·비 시나리오의 결정론적 감쇠는 이 GHI에 한 번만 적용한다. 그 다음 Erbs가 DHI와 DNI를 함께 만들므로 출력 triplet은 수평면 폐합식 `GHI=DNI cosθz+DHI`를 만족한다. 이 구현은 [pvlib의 Haurwitz 공식 구현](https://pvlib-python.readthedocs.io/en/stable/_modules/pvlib/clearsky.html#haurwitz), [pvlib Erbs 공식 문서](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.irradiance.erbs.html), Haurwitz를 포함한 clear-sky 모델을 평가한 [Sandia SAND2012-2389](https://www.osti.gov/servlets/purl/1039404)에 근거한다.

Haurwitz는 천정각 하나만 쓰므로 에어로졸, 수증기, 고도와 현지 탁도를 직접 표현하지 못한다. pvlib Haurwitz 문서는 겉보기(apparent) 천정각을 입력으로 정의하지만, 현재 오프라인 경로는 Erbs 폐합과 공유 태양기하를 맞추기 위해 굴절을 끈 true 천정각을 두 단계에 함께 쓴다. 따라서 지평선 부근에는 pvlib 기준과 차이가 생길 수 있다. 이 모델은 오프라인 시나리오와 UI 동작 검증용 fallback이며 발전량 타당성 평가에서는 계측·PVGIS·NASA POWER·Open-Meteo 등 출처가 있는 `WeatherSeries`를 우선한다.

### 제거된 원인: 이전 UI 일간 경험식 — 현재 미사용

이전 `buildDaySeries`의 `f=max(0,sin α)`에 대한 아래 재배율은 물리 모델이 아니며 현재 계산 경로에서 사용하지 않는다.

\[
GHI_t=GHI_0\min(1,f),\quad DNI_t=DNI_0\sqrt f,\quad
DHI_t=DHI_0(0.55+0.45f)
\]

세 항을 서로 다르게 재배율하면 폐합과 자료 provenance가 깨진다. 대체 공식은 이 세 경험식이 아니라, 출처가 있는 실제 `WeatherSeries` 또는 위 Haurwitz→Erbs 오프라인 fallback이다. 수정 계약은 `WeatherSeries → solarPosition/sunVector → simulateInstant`이며, 대표일·순간·연간·형상 비교가 같은 timestamp별 `WeatherPoint`를 그대로 공유한다. 패널은 기준 quaternion에 세로축 회전을 한 번만 합성하고, 그 세계 quaternion에서 위치·법선·sampling U/V·3D mesh pose를 일관되게 유도한다. 이미 세계 pose인 값에 UI 그룹 회전을 다시 적용하지 않는다.

POA에서 `ηcos`는 면 투영, `IAM`은 전면 광학 반사, `ηangle=ηcos·IAM`은 둘의 결합값이다. 직달항에 각 계수를 한 번만 적용하며 현재 산란·지면항에는 별도 diffuse IAM을 적용하지 않는다. 특히 AOI가 80°를 넘으면 ASHRAE 및 단순 physical IAM의 작은 절대오차도 상대 출력에 크게 반영되므로 저정확도 진단 영역으로 보고 실측 또는 모듈별 IAM 자료로 검증한다.

## 기상·환경 계수

- Open-Meteo, PVGIS, NASA POWER 값은 계산 공식이 아니라 외부 입력이다. provider, kind, 조회 시각, 시간/공간 해상도와 fallback 이유를 결과에 보존한다.
- 환경 거칠기, 난류, 알베도, 오염의 기본값은 사용자가 바꿀 수 있는 초기값이다. 개별 현장의 계측값을 대신하지 않는다.
- 장애물 후류는 CFD가 아닌 공학 근사로 표시한다.
- 구름 프리셋은 seed와 timestamp로 결정론적으로 생성하며 API 일사에 다시 곱하지 않는다.

## 코드와 문서의 일치 검증

각 계산 결과의 trace는 `modelId`를 기록하고 `MODEL_BY_ID`에 없는 ID가 있으면 자동 테스트가 실패한다. 0.5W 기준 패널, NREL SPA 사례, Erbs 폐합, IAM, Faiman, 단일 다이오드 수렴, 20패널 10W, 바이패스, 인버터 클리핑, RPM=0, 고RPM 위상평균, 2Wh 적분과 야간 0을 `tests/physics.test.ts`에서 검증한다.
