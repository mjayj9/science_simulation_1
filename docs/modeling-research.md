# 태양광 3D 시뮬레이터 물리 모델 조사

작성 기준일: 2026-08-10
용도: 브라우저에서 실행되는 비교·교육용 공학 시뮬레이터의 구현 기준. 이 문서는 제품 보증, 구조 안전 검토, 계통 연계 설계 또는 금융성 발전량 보증을 대신하지 않는다.

## 0. 출처 원칙과 모델 체인

사용자가 제공한 HTML은 `일사 강도·모듈 효율·기후·작동 온도·오염·각도/방향이 발전량에 영향을 준다`는 정성적 체크리스트로만 보았다. 아래 수식과 계수는 그 글에서 가져오지 않았고 NREL/NLR, Sandia PVPMC, JRC PVGIS, NASA POWER, Open-Meteo, NIST, NASA 기술자료와 원 논문만 근거로 삼았다. 여기서 NREL 웹사이트 일부는 현재 기관 표기를 NLR(National Laboratory of the Rockies)로 바꾸었지만 기존 보고서 번호와 문헌명은 NREL 표기를 유지한다.

권장 계산 순서는 다음과 같다.

`시각/좌표 → 태양 위치 → GHI/DNI/DHI 품질검사·분해 → 패널별 AOI·광선 차폐·Perez 하늘/지면 반사·IAM → 유효 POA → 높이별 풍속·Faiman 온도 → 패널/서브스트링 단일 다이오드 I-V → 직렬·병렬·바이패스 결합 → MPPT·인버터·클리핑 → 시간 적분`

각 단계는 입력, 중간값, 출처와 품질 상태(`api`, `reanalyzed`, `manual`, `estimated`, `fallback`)를 함께 반환해야 한다. 손실률을 뒤에서 다시 곱해 같은 현상을 이중 계산하지 않는다.

### 공통 좌표·단위

- 세계 좌표는 Three.js의 `x=동(E), y=상(Up), z=북(N)`으로 고정한다. 태양 방위각 `γs`는 진북 0°, 동 90°, 남 180°, 서 270°이고 고도각 `αs`는 지평선 0°에서 위로 양수다.
- 태양 단위벡터는 `s=(cos αs sin γs, sin αs, cos αs cos γs)`이다. 패널 앞면 외향 단위법선은 `n`; `μ=cos(AOI)=n·s`이고 `AOI=acos(clamp(μ,-1,1))`이다.
- 복사량은 순간/구간평균 복사조도 `W/m²`, 에너지는 `Wh` 또는 `Wh/m²`, 온도는 UI에 `°C`, 열역학식에는 `K`, 속도는 `m/s`, 각도는 UI에 degree·삼각함수 내부에 radian을 쓴다.
- 한 패널의 고정 기하 기본값은 `0.05 m × 0.05 m = 0.0025 m²`, 앞면만 발전, 형상별 기본 패널 수 20개다.
- `clamp`, 범위 및 기본값은 대부분 모델의 이론적 유효영역이 아니라 브라우저 UI의 안전 가드레일이다. 출처가 없는 값은 아래에서 반드시 **시나리오 가정**이라고 표시한다.

## 1. 태양 위치: NREL SPA

### 채택 모델과 식

정밀 모드는 Reda–Andreas의 NREL Solar Position Algorithm(SPA)을 보고서 순서대로 독립 구현한다. SPA는 UTC에서 Julian day/century/millennium을 구하고, VSOP87 항으로 지구의 태양중심 황경·위도·반지름, 세차·장동·황도경사·광행차, 겉보기 태양 황경, 적경·적위, 그리니치 항성시, 관측자 시차와 대기 굴절을 차례로 계산하여 topocentric zenith와 azimuth를 낸다. 수백 개 급수항을 이 문서에 전사하는 대신 기준 보고서의 표와 순서를 규범으로 삼는다.

최종 기하 관계와 앱 좌표 변환은 다음과 같다.

```text
θz = 90° - αs
s = (cos αs sin γs, sin αs, cos αs cos γs)
μ = n · s
AOI = acos(clamp(μ, -1, 1))
```

| 변수 | 단위 | UI 범위 / 기본값 |
|---|---:|---|
| 위도 `φ` | ° | `[-90, 90]`; 기본 서울 `37.5665` |
| 경도 `λ` | ° | `[-180, 180]`; 동경 양수, 기본 `126.9780` |
| 고도 `h` | m MSL | `[-430, 6000]`; 기본 `38` |
| 시각 | ISO-8601 | IANA 시간대와 offset을 보존; 기본 현재 시각/`Asia/Seoul` |
| 압력 `p` | hPa | `[300, 1100]`; 없으면 표준대기 추정 |
| 주위온도 `Ta` | °C | `[-80, 80]`; 기본 `15` |
| `ΔUT1=UT1-UTC` | s | SPA 허용 `[-1,1]`; 기본 `0`, 고정밀 사용자는 IERS 값 입력 |
| `ΔT=TT-UT1` | s | SPA 허용 `[-8000,8000]`; 현대 기본 `69`, 근사임을 표시 |

출처: [NREL SPA 배포·범위·검증값](https://midcdmz.nrel.gov/spa/), [NREL/TP-560-34302 전체 알고리즘](https://docs.nrel.gov/docs/fy08osti/34302.pdf), [NREL Solar Radiation Best Practices Handbook](https://docs.nrel.gov/docs/fy24osti/88300.pdf).

SPA가 공표한 범위는 연도 `-2000…6000`, 태양 천정각 불확도 약 `±0.0003°`이다. 이는 올바른 `ΔT`, `ΔUT1`, 기상 입력을 전제로 한 천문 알고리즘 성능이지 API 기상자료나 3D 메시 정밀도를 보증하지 않는다. 원 SPA C 코드는 배포 페이지의 별도 사용 조건이 있으므로 소스를 복사·재배포하지 말고, 공개 보고서로 독립 구현하거나 라이선스가 호환되는 구현을 사용한다.

브라우저 단순화: 하루/연간 계산에서는 같은 날짜의 지구중심 급수항을 캐시하고 각 시간의 topocentric 단계만 다시 계산한다. 수동 고도·방위 입력은 SPA를 우회하되 결과를 `manual`로 표기한다. `αs ≤ 0°`이면 야간으로 간주하여 모든 태양복사와 PV 출력을 정확히 0으로 만든다. 굴절 때문에 겉보기 고도가 조금 양수인 일출·일몰 경계에서는 API 복사량의 시간 평균 정의가 우선한다.

## 2. GHI·DNI·DHI와 품질검사/분해

수평면 성분의 폐합식은 다음과 같다.

```text
GHI = DHI + DNI cos(θz)
```

`GHI`, `DNI`, `DHI` 단위는 모두 `W/m²`, `θz`는 천정각이다. 입력 범위는 각각 `[0, 1500]`, `[0, 1400]`, `[0, 1000] W/m²`를 UI 가드레일로 두고 기본 맑은 정오 예시는 `GHI=800, DNI=850, DHI=120 W/m²`로 하되 이 세 기본값도 폐합 오차를 검사한다. 태양이 지평선 아래면 셋 모두 0으로 덮어쓴다. 낮에는 `|GHI-(DHI+DNI cosθz)| > max(25 W/m², 0.08 GHI)`이면 경고하고, 사용자가 어느 두 성분을 신뢰할지 선택하지 않았다면 원자료를 보존하되 계산용으로 `DHI=clamp(GHI-DNI cosθz,0,GHI)`를 만든다. 이 25 W/m²·8%는 **앱 품질경고 가정**이지 계측 표준 허용오차가 아니다.

GHI만 있을 때의 기본 분해는 시간평균 자료용 Erbs 모델이다.

```text
kt = GHI / (Ea cos θz)              (cos θz > 0)
kd = DHI/GHI
kd = 1 - 0.09 kt                                           kt ≤ 0.22
kd = 0.9511 - 0.1604kt + 4.388kt² - 16.638kt³ + 12.336kt⁴  0.22 < kt ≤ 0.80
kd = 0.165                                                 kt > 0.80
DHI = clamp(kd GHI, 0, GHI)
DNI = max(0, (GHI-DHI)/max(cos θz, cos 87°))
```

`Ea`는 해당 시각의 지구-태양 거리로 보정한 대기권 밖 법선 복사조도 `W/m²`다. `kt`는 수치 안정성을 위해 `[0,1.5]`로 제한한다. Erbs는 미국 위도 31–42°의 5개 관측소 **시간 평균**에 맞춘 경험식이므로 순간 구름 가장자리, 극지, 낮은 태양고도에서는 DNI 오차가 크다. `θz≥87°`, `GHI<1 W/m²`에서는 분해하지 않고 `DNI=0, DHI=GHI`로 둔다. DNI가 직접 제공되면 Erbs보다 원 DNI를 우선한다.

출처: [Sandia PVPMC GHI 정의와 폐합식](https://pvpmc.sandia.gov/modeling-guide/1-weather-design-inputs/irradiance-insolation/global-horizontal-irradiance/), [PVPMC Erbs 분해식과 적용 자료](https://pvpmc.sandia.gov/modeling-guide/1-weather-design-inputs/irradiance-insolation/direct-normal-irradiance/piecewise-decomposition-models/). 정밀 비교에는 연속 시계열과 이슬점이 있을 때 DIRINT를 선택할 수 있으나, 단일 시각 브라우저 계산의 기본으로는 입력 요구가 적은 Erbs를 택한다.

## 3. 패널별 POA, AOI, IAM, 산란·반사·3D 차폐

### 3.1 총 POA와 직달 성분

패널 `i` 앞면의 총 입사 복사조도는 다음처럼 분리한다.

```text
G_POA,i = G_beam,i + G_sky,i + G_ground,i
G_beam,i = V_sun,i · DNI · max(0, n_i·s) · IAM_B(AOI_i)
```

`V_sun∈[0,1]`은 패널 앞면 샘플 중 태양 방향 광선이 가려지지 않은 비율이다. 기본 `4×4=16`개 층화 샘플, UI `1×1…12×12`; 광선 시작점은 앞면 법선으로 `max(0.1 mm, 10⁻⁵×sceneScale)` 오프셋하여 자기 교차를 피한다. 패널 뒤면(`n·s≤0`) 직달은 정확히 0이다. 태양은 평행광으로 취급하며 태양 원반·반그림자는 생략한다. `V_sun`은 렌더링 그림자의 픽셀 밝기가 아니라 Three.js ray/triangle 교차 결과로만 정한다. GLB/GLTF 메시도 BVH/raycast 대상에 포함한다.

출처: [PVPMC POA 합](https://pvpmc.sandia.gov/modeling-guide/1-weather-design-inputs/plane-of-array-poa-irradiance/), [PVPMC POA beam](https://pvpmc.sandia.gov/modeling-guide/1-weather-design-inputs/plane-of-array-poa-irradiance/calculating-poa-irradiance/poa-beam/), [PVPMC AOI 식과 방위각 규약](https://pvpmc.sandia.gov/modeling-guide/1-weather-design-inputs/plane-of-array-poa-irradiance/calculating-poa-irradiance/angle-of-incidence-clone/).

### 3.2 입사각 반사 손실 IAM

정밀 기본은 De Soto physical IAM이다.

```text
θr = asin(sin θ / n_g)
τ(θ) = exp[-K L / cos θr] · {1 - 1/2[sin²(θr-θ)/sin²(θr+θ)
                                      + tan²(θr-θ)/tan²(θr+θ)]}
IAM_B(θ) = τ(θ)/τ(0)
τ(0) = exp(-KL)[1-((1-n_g)/(1+n_g))²]
```

| 변수 | 단위 | 범위 / 기본값 |
|---|---:|---|
| `θ=AOI` | ° | `[0,90)`; 90° 이상 0 |
| 유리 굴절률 `n_g` | 1 | `[1,2]`; `1.526` |
| 소광계수 `K` | m⁻¹ | `[0,50]`; `4` |
| 유리 두께 `L` | m | `[0.0005,0.01]`; `0.002` |

정상 입사에서 수치적 `0/0`은 극한식 `IAM=1`로 처리하고 최종값은 `[0,1]`로 제한한다. 출처: [Sandia PVPMC Physical IAM과 De Soto 기본계수](https://pvpmc.sandia.gov/modeling-guide/1-weather-design-inputs/shading-soiling-and-reflection-losses/incident-angle-reflection-losses/physical-iam-model/).

빠른 대안은 ASHRAE 식 `IAM=max(0, 1-b0(secθ-1))`, `b0∈[0,0.3]`, 기본 `0.05`(**UI 일반 유리 가정**)이다. 80°를 넘으면 부정확·불연속적이므로 0으로 매끄럽게 감쇠시키거나 physical IAM으로 전환한다. 출처: [PVPMC ASHRAE IAM](https://pvpmc.sandia.gov/modeling-guide/1-weather-design-inputs/shading-soiling-and-reflection-losses/incident-angle-reflection-losses/ashrae-iam-model/).

### 3.3 Perez 하늘 산란

장애물이 없는 패널의 기본 전사 모델은 Perez 1990 계수형이다.

```text
G_sky = DHI[(1-F1)(1+cosβ)/2 + F1(a/b) + F2 sinβ]
a = max(0, cos AOI)
b = max(cos85°, cosθz)
ε = {[(DHI+DNI)/DHI] + κ θz³}/{1+κ θz³}, κ=1.041 (θz rad)
Δ = DHI·AMa/Ea
F1 = max[0, f11 + f12Δ + f13θz]
F2 = f21 + f22Δ + f23θz
```

`β∈[0,180°]`는 패널 앞면 법선의 수평면 기울기, `AMa`는 절대 공기질량, `Ea`는 대기권 밖 법선 복사조도다. `fij`는 아래 clearness bin의 Perez 1990 irradiance 계수다.

| `ε` bin | `f11,f12,f13` | `f21,f22,f23` |
|---|---|---|
| 1.000–1.065 | -0.008, 0.588, -0.062 | -0.060, 0.072, -0.022 |
| 1.065–1.230 | 0.130, 0.683, -0.151 | -0.019, 0.066, -0.029 |
| 1.230–1.500 | 0.330, 0.487, -0.221 | 0.055, -0.064, -0.026 |
| 1.500–1.950 | 0.568, 0.187, -0.295 | 0.109, -0.152, -0.014 |
| 1.950–2.800 | 0.873, -0.392, -0.362 | 0.226, -0.462, 0.001 |
| 2.800–4.500 | 1.132, -1.237, -0.412 | 0.288, -0.823, 0.056 |
| 4.500–6.200 | 1.060, -1.600, -0.359 | 0.264, -1.127, 0.131 |
| ≥6.200 | 0.678, -0.327, -0.250 | 0.156, -1.377, 0.251 |

`DHI≈0`에서는 `G_sky=0`으로 두어 0으로 나누지 않는다. 출처와 정확한 계수: [Sandia PVPMC Perez Sky Diffuse](https://pvpmc.sandia.gov/modeling-guide/1-weather-design-inputs/plane-of-array-poa-irradiance/calculating-poa-irradiance/poa-sky-diffuse/perez-sky-diffuse-model/), 원 논문 Perez et al. 1990 및 SAND88-7030은 해당 페이지 참고문헌에 연결되어 있다.

Perez의 폐형식은 균일한 지평선과 무차폐 하늘을 가정한다. 나무·건물·인접 패널의 산란 차폐가 있으면 하늘돔을 기본 64개(조절 16–256) 면적가중 방향으로 샘플링하고,

```text
G_sky,blocked ≈ Σj L_Perez(ωj) max(0,n·ωj) V_i(ωj) IAM(θj) ΔΩj
```

를 사용한다. `L_Perez`는 Perez의 등방·태양주변·지평 증광 총량을 같은 비율로 보존하도록 정규화한 근사 분포다. 이는 Perez 폐형식에 대한 **브라우저 수치근사**이며 다중 산란, 반투명 수관, 구름 3D 복사전달은 아니다. 차폐가 없을 때 수치합을 폐형식 결과에 맞춰 정규화해 회귀검증한다. 빠른 모드는 등방식 `G_sky=DHI(1+cosβ)/2`와 ray 기반 sky-view factor만 사용한다([PVPMC isotropic model](https://pvpmc.sandia.gov/modeling-guide/1-weather-design-inputs/plane-of-array-poa-irradiance/calculating-poa-irradiance/poa-sky-diffuse/isotropic-sky-diffuse-model/)).

### 3.4 지면 반사

무차폐 Lambert 지면은 다음과 같다.

```text
G_ground = GHI · ρg · (1-cosβ)/2
```

`ρg`는 지면 albedo `[0,1]`, 환경 기본값은 도시/평야 `0.20`, 사막 `0.35`, 해안 `0.20`, 눈을 별도 선택하면 `0.70`이다. 이 값들은 **시나리오 기본값**이며 실제 API/측정값이 우선한다. 인접 물체가 있으면 지면 반구 32–128 방향 또는 지면 샘플에 visibility와 Lambert cosine을 적용한다. 장애물 자체의 재반사와 패널-패널 다중반사는 생략한다. 출처·가정: [PVPMC POA Ground Reflected](https://pvpmc.sandia.gov/modeling-guide/1-weather-design-inputs/plane-of-array-poa-irradiance/calculating-poa-irradiance/poa-ground-reflected/).

### 3.5 유효 복사조도와 오염

전기 모델 입력은

```text
S_i = (G_beam,i + G_sky,IAM,i + G_ground,IAM,i) · SF_i · M_i/Mref
SF_i = 1-L_soil,i
```

이다. `L_soil∈[0,0.95]`, 기본 0; `M/Mref`는 스펙트럼 자료가 없으면 1.0이다. IAM을 이미 각 복사 성분에 적용했으면 전기 출력에 다시 IAM 손실을 곱하지 않는다. 출처: [PVPMC Effective Irradiance](https://pvpmc.sandia.gov/modeling-guide/2-dc-module-iv/effective-irradiance/). 먼지·염분의 시간 누적과 비 세척은 현 버전에서 사용자 입력 시나리오이며 화학적/퇴적 모델이 아니다.

## 4. 날씨·구름·비·야간과 데이터 API

### 데이터 우선순위

1. 사용자가 GHI/DNI/DHI를 모두 입력하거나 API가 직접 제공하면 그 값을 품질검사 후 사용한다.
2. GHI+DHI이면 폐합식으로 DNI, GHI+DNI이면 DHI를 구한다.
3. GHI만이면 시간평균에 Erbs를 쓴다.
4. API 실패/오프라인이면 명시적인 `estimated fallback` 프리셋으로 전환하며 실측/재분석으로 표시하지 않는다.

| 소스 | 권장 용도·필드 | 시간/공간 의미 및 한계 | 공식 문서 |
|---|---|---|---|
| Open-Meteo Forecast/Historical | 현재·예보·과거 `temperature_2m`, `wind_speed_10m`, `wind_direction_10m`, `cloud_cover`, `precipitation`, `shortwave_radiation`(GHI), `direct_normal_irradiance`, `diffuse_radiation` | 여러 국가 수치예보를 위치별로 선택/결합; 모델별 해상도·갱신시각이 다르며 관측값이 아니다. 복사량은 기본적으로 직전 구간 평균이다. | [일반 API 문서](https://open-meteo.com/en/docs/), [위성 복사 API와 변수 정의](https://open-meteo.com/en/docs/satellite-radiation-api) |
| JRC PVGIS 5.3 | TMY(`tmy`), 다년 hourly(`seriescalc`), 장기 월/연 비교 | TMY는 실제 한 해가 아니라 최소 10년 후보기간에서 구성한 대표년. `seriescalc&components=1`은 beam/diffuse/reflected를 반환할 수 있고 지평선 적용 여부도 메타데이터에 보존해야 한다. | [PVGIS 5 API non-interactive service](https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/using-pvgis-5/api-non-interactive-service_en), [Hourly radiation](https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/using-pvgis-5/pvgis-5-tools/hourly-radiation_en) |
| NASA POWER | 장기 교차확인: `ALLSKY_SFC_SW_DWN`, DNI 파생값, `T2M`, `WS10M`, 강수 등 | 위성 복사+동화 기상 자료의 원 공간격자; 점 응답은 그 격자를 대표한다. hourly point만 사용하고 UTC/LST를 명시한다. 최대 20개 변수/요청 제한을 따른다. | [API 개요](https://power.larc.nasa.gov/docs/services/api/), [Temporal API](https://power.larc.nasa.gov/docs/services/api/temporal/), [parameter dictionary](https://power.larc.nasa.gov/docs/tutorials/parameters/), [DNI 방법론](https://power.larc.nasa.gov/docs/methodology/energy-fluxes/derived-parameters/) |

응답과 함께 provider, dataset/model 이름, API 버전/endpoint, 조회 UTC, 유효시간, timezone, 위경도/고도, 단위, 원 시간해상도, 공간해상도(응답 metadata), 보간 여부, 누락률을 저장·표시한다. PVGIS의 현재 공식 진입점은 `https://re.jrc.ec.europa.eu/api/v5_3/...`; 버전 없는 오래된 endpoint에 의존하지 않는다.

### 수동 프리셋과 시간 변화

복사 API가 없을 때 먼저 clear-sky GHI/DNI/DHI가 필요하다. 구현 범위를 줄이기 위해 온라인이면 PVGIS/Open-Meteo가 제공하는 clear-sky 계열을 사용하고, 오프라인이면 사용자가 기준 GHI/DNI/DHI를 넣도록 한다. 아래 프리셋은 그 기준 성분에 시드 고정 시간함수를 곱하는 **시각화용 시나리오 가정**이다. 검증된 구름 미세물리 모델로 표기하면 안 된다.

```text
x[k] = φ x[k-1] + sqrt(1-φ²) ξ[k]       ξ: seeded N(0,1)
C[k] = clamp(Cbar + σC x[k], 0, 1)
kbeam = exp(-τc C[k]/max(cosθz,0.15))
DNI = DNI_clear · kbeam
GHI = max(0, DNI cosθz + DHI_clear·(1 + aC·C[k]))
DHI = clamp(GHI-DNI cosθz,0,GHI)
```

`φ=exp(-Δt/τ)`; 기본 `τ=180 s`. 프리셋은 맑음 `(Cbar,σC,τc,aC)=(0.05,0.03,0.4,0.1)`, 반구름 `(0.45,0.20,1.4,0.5)`, 완전 흐림 `(0.95,0.03,3.0,0.8)`, 비 `(0.98,0.02,4.0,0.9)`이다. 모두 조절 가능하고 **출처 없는 앱 가정**으로 UI에 표시한다. 같은 비교 세트에는 동일 seed와 시간격자를 써야 한다. 실제 API GHI/DNI/DHI가 있으면 cloud cover나 rain으로 복사량을 또 감쇠하지 않는다. 비는 `precipitation>0` 상태 표시와 선택적 세척 이벤트에만 쓰며, 강수량으로 일사를 직접 환산하지 않는다. 야간 `αs≤0`에서는 프리셋과 무관하게 모든 성분·발전량 0; 달빛은 무시한다.

한계: 구름 가장자리 증광, 구름 층 높이/광학두께, 에어로졸, 수증기, 적설 피복과 스펙트럼 효과는 이 AR(1) 프리셋에 없다. 결과는 `estimated`이며 월·연간 금융 분석에 쓰지 않는다. Open-Meteo도 모델에 따라 direct/diffuse를 원자료 차이 또는 분해모델로 만들 수 있으므로 응답의 모델 출처를 표시한다.

## 5. 환경별 풍속, 난류, 공기밀도와 장애물 후류

### 5.1 높이별 평균 풍속

중립 대기 표면층의 기본은 변위높이를 포함한 로그 프로파일이다.

```text
U(z) = Uref · ln((z-d)/z0) / ln((zref-d)/z0)
```

`U,Uref`는 `m/s`, `z,zref,d,z0`는 m; `zref` 기본 10 m, 입력 `Uref∈[0,60] m/s`, 기본 4 m/s다. 식은 `z>d+z0`이고 기준점도 같은 조건일 때만 계산한다. 대안 power law는 `U(z)=Uref(z/zref)^α`이다. DTU WAsP는 로그법을 기본으로 하며 로그법과 power law가 기능적으로 다르고 제한된 높이에서만 근사적으로 맞는다고 명시한다.

환경 프리셋은 아래와 같다. `z0`와 `TI10`은 NREL/SERI 표의 대표 구간 안에서 고른 값이고, `d`는 정확한 캐노피/건물 높이가 없으므로 **앱 가정**이다. 사용자가 모두 수정할 수 있어야 한다.

| 환경 | `z0` m | `d` m | power `α` | `TI=σu/U` at 10 m | albedo | 설명 |
|---|---:|---:|---:|---:|---:|---|
| 사막 | 0.001 | 0 | 0.11 | 0.11 | 0.35 | 평탄·매우 매끈 |
| 바다/해안 | 0.001 | 0 | 0.10 | 0.11 | 0.20 | 육상 해안 구조물에는 별도 거칠기 필요 |
| 평야/개활지 | 0.03 | 0 | 0.16 | 0.17 | 0.20 | 드문 나무·건물 |
| 교외 | 0.30 | 3 | 0.24 | 0.26 | 0.20 | 낮은 건물 혼합 |
| 도시 중심 | 0.70 | 8 | 0.35 | 0.34 | 0.18 | 실제 도시는 방향·건물별 CFD 필요 |

근거: [DTU WAsP 로그/멱법 비교](https://wasp.dtu.dk/support/frequently-asked-questions/wasp-faq/Wind-shear-exponents), [NREL/SERI/STR-253-3431의 거칠기·power exponent·10 m 난류강도 표](https://www.nrel.gov/docs/legosti/old/3431.pdf), [NREL 풍하중 보고서의 해안/개활/교외/도심 exponent](https://www.nrel.gov/docs/fy08osti/32282.pdf). 이 표는 한 지점의 실제 풍황을 대체하지 않는다. 안정도, 언덕/절벽, 해륙풍, 도시협곡을 무시하므로 특히 패널 높이가 매우 낮거나 `z≤d+z0`이면 `U=max(0.1,Uref·0.1)` 같은 숫자를 꾸며내지 말고 “프로파일 범위 밖” 경고 후 사용자가 표면풍을 직접 넣게 한다.

### 5.2 난류 시간열

정의는 `TI=σu/Ū`(무차원)이다. 정밀 난류는 NREL TurbSim의 Kaimal 스펙트럼/공간 coherence가 적절하지만 브라우저에서 매 프레임 full-field 역 FFT를 수행하기에는 과하다. Kaimal 1점 스펙트럼은 다음 형태다.

```text
f Su(f)/σu² = 4 f Lu/Ū / [1+6 f Lu/Ū]^(5/3)
```

`f` Hz, `Su` `(m/s)²/Hz`, `Lu` m. 출처: [NREL TurbSim User's Guide, NREL/TP-500-41136](https://research-hub.nrel.gov/en/publications/turbsim-useraposs-guide-revised-february-2007-for-version-121/), [NREL Kaimal 식과 역 Fourier 설명](https://www.nrel.gov/docs/fy18osti/70445.pdf).

브라우저 기본은 앞 절의 seeded AR(1) `x`를 재사용하여 `U(t)=max(0,Ū[1+TI·x(t)])`, `τ=L/Ū`, `L` 기본 20 m (`[1,200]`)로 둔다. 이는 평균·표준편차·상관시간만 재현하는 **저차 확률 대용모델**이며 Kaimal 스펙트럼, 3성분 난류, 패널 간 공간 coherence를 재현하지 않는다. 같은 seed는 동일 결과를 보장한다. 고급 옵션은 16–128개 Kaimal 주파수 성분에 seed 위상을 주어 1점 신호를 합성하되 full CFD/TurbSim이라고 부르지 않는다.

### 5.3 공기밀도

API surface pressure `p`가 있으면 `ρ=p/[Rd(Ta+273.15)]`, `Rd=287.05 J/(kg·K)`를 사용한다. 없으면 고도 `h≤11,000 m`에서 표준대기를 쓴다.

```text
Tstd = T0-Lh
pstd = p0(Tstd/T0)^(g/(Rd L))
ρ = pstd/[Rd(Ta+273.15)]
T0=288.15 K, p0=101325 Pa, L=0.0065 K/m, g=9.80665 m/s²
```

UI `ρ∈[0.5,1.5] kg/m³`, 해수면 표준 기본 약 `1.225 kg/m³`. 실제 `Ta`를 넣되 pressure가 없을 때만 표준 pressure를 쓴다. 출처: [NASA 표준대기 식](https://www.grc.nasa.gov/www/k-12/VirtualAero/BottleRocket/airplane/atmosmet508.html), [NASA Standard Atmosphere 설명](https://nescacademy.nasa.gov/flightsim/2015/atmosphere). 습도 보정은 생략되어 고온다습 시 오차가 있다.

### 5.4 장애물 후류/가속

건물·나무·산·절벽의 정확한 국부 유동은 RANS/LES CFD와 경계조건이 필요하다. 본 앱에서는 ray로 풍상 장애물을 찾고, 그 뒤 원추/박스 wake 안에서

```text
Ulocal = Uprofile · clamp(1-Cw·B·exp[-x/(kr D)]·exp[-(r/Rw)²], 0.1, 1.2)
Rw=D/2+kw x
```

를 쓰는 선택적 **출처 없는 공학 시각화 근사**만 제공한다. `x` 풍하거리, `r` wake 중심거리, `D` 장애물 대표폭, `B∈[0,1]` 차폐율; 기본 `Cw=0.6, kr=6, kw=0.1`은 UI 가정이다. 산 정상 가속도 같은 복잡 유동은 모델링하지 않는다. 결과에 항상 “CFD 아님/정성 후류 근사” 배지를 붙이고 발전량 비교에서 이 옵션을 끈 기준도 함께 보인다. 환경 장면은 배경이 아니라 `z0,d,TI,albedo`, 공기밀도와 ray 차폐에 실제로 연결한다.

## 6. 패널 온도: Faiman

```text
Tm = Ta + G_POA,thermal/(U0+U1·WSmod)
```

| 변수 | 단위 | 범위 / 기본값 |
|---|---:|---|
| 모듈 온도 `Tm` | °C | 결과 가드 `[-80,150]` |
| 주위온도 `Ta` | °C | `[-80,80]`; 25 |
| 열입력 POA `G_POA,thermal` | W/m² | `[0,1500]`; 광학 IAM 전 입사 POA를 기본 사용 |
| 모듈 높이 풍속 `WSmod` | m/s | `[0,60]`; 로그 프로파일 결과 |
| `U0` | W/(m²·K) | `[1,100]`; `25.0` |
| `U1` | W·s/(m³·K) | `[0,30]`; `6.84` |

출처: [Sandia PVPMC Faiman 모델](https://pvpmc.sandia.gov/modeling-guide/2-dc-module-iv/module-temperature/faiman-module-temperature-model/). Faiman의 유리 앞면/Tedlar 뒷면 7개 모듈 실험에서 `U0=23.5…26.5`, 결합 25; `U1=6.25…7.68`, 결합 6.84였다. 따라서 위 기본은 자유 통풍 모듈에만 대표적이며 구에 밀착, 건물일체형, 수면 증발, 회전으로 생기는 상대풍에는 재보정이 필요하다.

회전 중에는 `WSmod=|Ulocal-ω×r_i|`의 패널 중심 상대풍을 쓸 수 있다. 야간에는 `G_POA=0`이므로 이 정상상태식은 `Tm=Ta`; 장파 복사에 의한 야간 과냉각과 열용량/시간지연은 없다. 열관성 옵션은 `Cth dTm/dt=αG_POA-(U0+U1WS)(Tm-Ta)`로 확장할 수 있으나 `Cth` 측정값 없이는 검증모델로 표시하지 않는다. 패널별 POA와 높이가 다르면 반드시 패널별로 계산한다.

## 7. 단일 다이오드 패널 I-V

### 7.1 지배식과 온도/복사 보정

정밀 모드의 모듈 또는 서브스트링 식은

```text
I = IL - I0·expm1[(V+I Rs)/a] - (V+I Rs)/Rsh
a = n Ns k Tc,K/q
Vt = k Tc,K/q
```

이다. `I,IL,I0` A, `V` V, `Rs,Rsh` Ω, `n` 무차원, `Ns` 직렬 셀 수, `k=1.380649×10⁻²³ J/K`, `q=1.602176634×10⁻¹⁹ C`. `n`은 단접합 셀에서 보통 1–2다. 출처: [Sandia PVPMC Single Diode Equivalent Circuit](https://pvpmc.sandia.gov/modeling-guide/2-dc-module-iv/single-diode-equivalent-circuit-models/).

De Soto 5-parameter 보조식은 다음처럼 쓴다(`Tc`는 K가 필요한 식에서 K).

```text
IL = (S/Sref)[ILref + αIsc(Tc-Tref)] · (M/Mref)
I0 = I0ref(Tc/Tref)³ exp[(Eg,ref/Tref - Eg(Tc)/Tc)/k_eV]
Eg(Tc)=Eg,ref[1-0.0002677(Tc-Tref)]
Rs = Rs,ref
Rsh = Rsh,ref(Sref/max(S,Smin))
a = aref(Tc/Tref)
```

`Sref=1000 W/m²`, `Tref=298.15 K`, 실리콘 `Eg,ref≈1.121 eV`, `k_eV=8.617333262×10⁻⁵ eV/K`; `Smin` 기본 `1 W/m²`는 수치가드다. PVPMC 페이지의 Rsh 수식 렌더링에는 중복 분수 문자가 보이므로 원 De Soto 정의인 `Rsh∝Sref/S`를 따른다. 출처: [PVPMC De Soto five-parameter model](https://pvpmc.sandia.gov/modeling-guide/2-dc-module-iv/single-diode-equivalent-circuit-models/de-soto-five-parameter-module-model/), [De Soto et al. 2006 DOI](https://doi.org/10.1016/j.solener.2005.06.010).

### 7.2 입력·기본값과 피팅

5 cm 패널의 STC 기본은 면적 0.0025 m², 효율 20%, 따라서 `Pmp,ref=0.500 W`; 설명용 초기점은 `Voc=0.62 V`, `Isc=1.05 A`, `Vmp=0.50 V`, `Imp=1.00 A`, `Ns=1`, `n=1.2`, `Rs=0.02 Ω`, `Rsh=100 Ω`이다. 이 숫자를 그대로 혼합하면 5개 nameplate 점을 정확히 통과하지 않을 수 있으므로 실제 기본 파라미터는 `I(0)=Isc`, `I(Voc)=0`, `I(Vmp)=Imp`, `d(VI)/dV|Vmp=0` 및 선택 조건을 동시에 최소화해 피팅하고, 실패하면 사용자가 `Rs,Rsh,n`을 직접 입력하게 한다.

| 입력 | UI 가드레일 / 기본 | 주의 |
|---|---|---|
| 효율 | `0…1` / 0.20 | `Pmp=η A Sref`; nameplate Pmp 직접 입력 시 효율은 파생값 |
| Pmax | `0…10 W` / 0.5 W | 5 cm 패널용 가드 |
| Voc, Isc | `(0,10] V`, `(0,20] A` / 0.62 V, 1.05 A | `Vmp<Voc`, `Imp<Isc` 검증 |
| Vmp, Imp | `(0,Voc)`, `(0,Isc)` / 0.50 V, 1.00 A | `|VmpImp-Pmax|≤1%` 아니면 경고 |
| Rs | `[0,10] Ω` / 피팅값 | 셀/모듈 기준 혼용 금지 |
| Rsh | `(0,10⁶] Ω` / 피팅값 | 저조도에서 커짐 |
| n | `[1,2]` / 1.2 | 단접합 가정 |
| αIsc | `[-0.02,0.02] A/K` / `+0.0005·Isc/K` | datasheet 단위 %/K를 먼저 변환 |
| βVoc, γPmp | `[-0.02,0.01] 1/K` / `-0.003`, `-0.004` | 진단/피팅 제약; De Soto 결과에 다시 곱하지 않음 |
| 오염손실 | `[0,0.95]` / 0 | 이미 `S`에서 적용 |

`Pmax/Voc/Isc/Vmp/Imp`와 `Rs/Rsh/n`을 동시에 자유 입력하면 과규정/불일치가 생긴다. UI는 `nameplate 피팅`과 `직접 5-parameter` 모드를 분리한다. `βVoc`, `γPmp`는 계산 결과의 온도 기울기 검증에 사용하고 De Soto 출력에 별도 온도손실을 중복 곱하지 않는다.

### 7.3 수치해법

고정 `V`에서 잔차 `F(I)=0`을 safeguarded Newton으로 풀되 미분이 작거나 step이 bracket을 벗어나면 bisection으로 전환한다. `expm1(x)`를 사용하고 물리 범위 밖 overflow 방지를 위해 `x≤80`으로 제한하되 제한 발생을 경고한다. `Isc`는 `V=0`, `Voc`는 `I=0`의 bracket root로 찾는다. 허용오차 기본 `|F|<10⁻⁹ A` 또는 상대 `10⁻⁷`, 최대 60회. 실패 시 NaN을 전파하지 말고 해당 패널 상태를 `solver-failed`, 출력 0으로 두며 입력과 bracket을 진단에 남긴다.

I-V는 `V=0…Voc` 적응 샘플 128점(32–1024), 꺾임/바이패스 근방을 세분한다. P-V 전역 최대는 모든 샘플의 후보 구간을 golden-section/Brent로 다듬어 찾는다. 단순 모드는 `Pdc=Pmp,ref(S/Sref)[1+γPmp(Tm-Tref)]`를 0 이상으로 제한하는 PVWatts형 점 모델이며 I-V/부분음영 정밀 결과와 UI에서 명확히 구분한다. PVWatts는 기술별 평균 성능 추정이며 실제 모듈 차이를 보증하지 않는다([PVWatts V8](https://pvwatts.nrel.gov/version_8.php), [PVPMC PVWatts 설명](https://pvpmc.sandia.gov/modeling-guide/2-dc-module-iv/point-value-models/pvwatts/)).

## 8. 직렬·병렬, 부분음영·불일치와 바이패스

패널 앞면을 여러 광선점으로 샘플한 shade fraction은 단순히 패널 평균 POA 한 개로 끝내지 않는다. 정밀 모드에서는 각 패널을 사용자 지정 서브스트링(기본 1; 일반 대형 모듈 예시 3)으로 나누고, 각 서브스트링의 샘플 평균 `S,T`로 별도 I-V를 만든다.

```text
series:   같은 I에서 Vstring(I)=Σj Vj(I)-I·Rwiring
parallel: 같은 V에서 Iarray(V)=Σk Ik(V)-V/Rleak
mismatch loss = 1 - Parray,mpp /(Σ Pdevice,mpp - Σ Pwiring)
```

직렬 수 `NsDevice≥1`, 병렬 수 `Np≥1`; 연결 그래프는 순환, 단락, 개방, 중복 단자, 정격 위반을 검증한다. 직렬 연결은 전류, 병렬 연결은 전압을 강제하므로 모듈별 MPP 단순합에서 mismatch를 또 정률 차감하지 않는다. 출처: [PVPMC DC Array IV](https://pvpmc.sandia.gov/modeling-guide/3-dc-array-iv/), [PVPMC Mismatch Losses](https://pvpmc.sandia.gov/modeling-guide/3-dc-array-iv/mismatch-losses/).

바이패스 다이오드는 서브스트링과 역병렬이다.

```text
Ib = I0,b · expm1((-Vsub-Vf,offset)/(nb Vt,b))
Iterminal = IPV(Vsub)+Ib(Vsub)
```

빠른 모델은 `Vsub≥-Vf`로 clamp하고 우회 시 `Vsub≈-Vf`; `Vf∈[0.1,1.5] V`, 기본 0.5 V, `nb∈[1,2]`. bypass active는 `Ib`가 string current의 1% 이상일 때 표시한다. NREL의 상세 음영 참조 모델도 De Soto 서브모듈 I-V를 합하고 0.5 V 순방향 바이패스 다이오드를 사용한다([NREL uniform shading reference model](https://sam.nrel.gov/images/web_page_files/deline-self-shading-model-draft-2013.pdf)); 실제 다이오드 `Vf`는 전류·온도에 따라 변한다. 역바이어스 avalanche/Bishop cell breakdown은 현 브라우저 모델에서 생략하므로 hot-spot·안전 분석에 쓰지 않는다.

부분음영은 여러 P-V 국부 최대를 만들 수 있으므로 정밀 MPPT는 전압 전 범위를 훑는 **global MPP**를 기본으로 한다. 바이패스가 켜진 서브스트링, 개방/단락, 고립 패널을 3D와 회로도에 표시한다. 제조 공차는 동일 seed의 `Voc/Isc/Rs/Rsh` 정규 perturbation(기본 σ=0, 조절 0–10%)으로 넣고 입력 파라미터를 저장한다. 소프트웨어 참조 구현으로는 cell→string→module→system I-V와 bypass 구성을 다루는 [PVMismatch](https://github.com/SunPower/PVMismatch) 및 NREL의 광선추적/불일치 툴 설명([bifacial irradiance toolkit](https://www.nrel.gov/pv/pv-bifacial-irradiance-toolkit))을 교차 참고한다.

## 9. MPPT, 인버터 효율과 클리핑

### 9.1 운전점/제한

배열 P-V에서 `Vmppt,min≤V≤Vmppt,max`, `I≤Idc,max`, `V≤Vdc,max`인 점만 허용하고 그중 최대 `Pdc`를 선택한다. 기본 MPPT는 순간·손실 없는 global MPP이며 실제 perturb-and-observe 동특성, 스캔 지연, 로컬 최대 고착은 모델링하지 않는다. PVPMC도 대부분 성능 모델이 MPP를 항상 유지한다고 가정함을 밝힌다([PVPMC Array Utilization](https://pvpmc.sandia.gov/modeling-guide/3-dc-array-iv/array-utilization/)). 범위 밖이면 0으로 숨기지 말고 `MPPT voltage/current limited` 상태와 선택 운전점을 보인다.

### 9.2 간단 모드: PVWatts V5 공개 효율곡선

```text
Pdc0 = Pac0/ηnom
ζ = Pdc/Pdc0
η(ζ)=ηnom/ηref · (-0.0162ζ - 0.0059/ζ + 0.9858)
Pac_raw=max(0,ηPdc-Pwire)
Pac=min(Pac0,Pac_raw)
Pclip=max(0,Pac_raw-Pac0)
ηref=0.9637; ηnom 기본 0.96
```

`Pac0` W, `ηnom∈[0.90,0.995]`, `Pdc≥0`; `ζ`가 매우 작아 식이 음수가 되면 0으로 제한하고 start threshold 아래는 standby로 둔다. 출처: [PVWatts V5 Manual 식 10–11](https://pvwatts.nrel.gov/downloads/pvwattsv5.pdf). 현재 공식 계산기는 V8.5.2(2025-09-25 공개)이고 V8은 개선된 인버터/열/모듈 모델을 쓰지만 API 문서상 상세 기술보고서는 아직 forthcoming이다([PVWatts V8 API](https://developer.nrel.gov/docs/solar/pvwatts/v8/)). 따라서 위 식을 “PVWatts V8과 동일”이라고 표기하지 말고 **V5 공개 간단곡선**이라고 정확히 표시한다.

### 9.3 정밀 모드: Sandia inverter

```text
A=Pdc0[1+C1(Vdc-Vdc0)]
B=Ps0 [1+C2(Vdc-Vdc0)]
C=C0  [1+C3(Vdc-Vdc0)]
Pac={Pac0/(A-B)-C(A-B)}(Pdc-B)+C(Pdc-B)²
```

`Pac0,Pdc0,Ps0` W, `Vdc,Vdc0` V, `C0` 1/W, `C1,C2,C3` 1/V. 여덟 계수는 CEC/제조사 효율 자료로 피팅해야 하며 임의 “일반 인버터” 계수를 만들지 않는다. `Pdc≤B`이면 발전 0 및 야간 소비 `-Pnight`(UI에는 소비와 발전 분리), 위에서는 `Pac`를 `[0,Pac0]`로 clip한다. 정격효율 입력만 있을 때는 Sandia 모드 대신 앞의 간단곡선을 쓴다. 출처·피팅 절차: [Sandia PVPMC Inverter Model](https://pvpmc.sandia.gov/modeling-guide/dc-to-ac-conversion/sandia-inverter-model/).

클리핑은 DC가 인버터 최대 입력을 넘을 때 인버터가 DC 전압을 MPP 위로 이동시켜 자체 제한할 수 있다는 물리 상태다. `Pclip` 외에 과전압·단락전류 초과를 별도 경고한다([PVPMC Inverter Clipping](https://pvpmc.sandia.gov/modeling-guide/dc-to-ac-conversion/inverter-saturation-or-clipping/)). 배선손실 기본 0%, `[0,20]%`; 효율곡선 사용자 입력은 `0≤η≤1`, 부하율 단조 x축을 검증하고 선형보간한다. 대기/야간소비 기본 0 W, `[0,Pac0]`.

## 10. 공통 세로축 회전과 공기역학

모든 형상은 공통 세계 `+y` 세로축을 중심으로 강체 회전한다. `θ`는 rad, `ω` rad/s, RPM은 rev/min이다.

### 10.1 정지/고정 RPM

```text
ω=2π·RPM/60
θ(t+Δt)=wrap2π[θ(t)+ωΔt]
```

RPM 범위 `[-120,120]`, 기본 0; 음수는 역회전이다. 에너지 계산의 “정지 기준”은 반드시 RPM=0이고 초기각도도 같은 조건이다.

### 10.2 풍력 자동 회전

각 패널 중심에서 상대풍과 준정상 항력을 계산한다.

```text
Urel,i = Ulocal(ri,t) - ω×ri
Aproj,i = A_i |n_i·ûrel,i|
Fi = 1/2 ρ Cd,i Aproj,i |Urel,i| Urel,i
τwind = Σi [(ri-rhub)×Fi]·ŷ
Iz dω/dt = τwind - bω - τc sign_smooth(ω)
```

`F` N, `τ` N·m, `ρ` kg/m³, `Cd` 무차원, `Aproj` m², `Iz` kg·m², `b` N·m·s/rad, `τc` N·m. NASA의 항력식은 `D=½ρCdAV²`이며 `Cd`가 형상·경사·Reynolds/Mach에 의존함을 강조한다([NASA Drag Equation](https://www.grc.nasa.gov/www/k-12/VirtualAero/BottleRocket/airplane/drageq.html), [NASA drag coefficient 주의](https://www.grc.nasa.gov/www/k-12/VirtualAero/BottleRocket/airplane/dragco.html)). 평판 정면 기본 `Cd=1.17`은 NACA/NASA의 정사각 평판 자유류 값 약 1.16을 근거로 한 시작값일 뿐이며([NACA flat-plate 자료](https://ntrs.nasa.gov/api/citations/19930093931/downloads/19930093931.pdf)), 패널 경사별 Cd를 실험 없이 정확하다고 보지 않는다.

| 값 | UI 범위 / 기본 |
|---|---|
| `Cd` | `[0,3]` / 1.17 |
| `Iz` | `(10⁻⁶,100] kg·m²` / 실제 메시 질량·반경에서 산출, 없으면 0.02 |
| `b` | `[0,10] N·m·s/rad` / 0.01 |
| `τc` | `[0,10] N·m` / 0.002 |
| 최대 RPM | `[0,120]` / 30 |

semi-implicit Euler `ωk+1=clamp(ωk+αkΔt)`, `θk+1=θk+ωk+1Δt`를 쓰고 `|Δθ|≤5°`, 기계 시간상수의 1/20 이하가 되도록 substep한다. 0 부근 마찰은 `tanh(ω/ωε)`로 매끄럽게 한다. 최대 RPM에서 토크를 인위적으로 없애는 대신 브레이크 반력/제한 상태를 기록한다.

중요 한계: 이 모델은 준정상 항력만 있고 lift, dynamic stall, wake 상호작용, 압력장, added mass, 베어링 속도 의존, 축/지지대 항력과 구조 진동이 없다. 대칭 폐곡면 배열의 순토크는 거의 0일 수 있다. 따라서 자동 RPM은 개념 비교값이며 풍력발전량을 계산하지 않는다. 바람은 형상을 회전시키고 패널 각도·상대풍 냉각을 바꾸어 **태양광 출력에만** 영향을 준다. 장애물 wake 식도 CFD가 아니다.

고 RPM 장기 발전량은 고정 시간격자에서 같은 위상만 반복 샘플하는 aliasing을 피해야 한다. 한 기상 step 안의 회전수가 많으면 (a) `Nφ=max(12,ceil(360°/5°))` 균등 위상 평균 또는 (b) low-discrepancy 위상 샘플을 사용한다. RPM=0에서는 평균하지 않고 초기 자세를 그대로 써야 한다.

## 11. 시간 적분, 일·월·연간 계산

에너지는 전력 시계열의 합이 아니라 시간 적분이다. 불균등 간격에도 다음 composite trapezoid를 쓴다.

```text
E[Wh] ≈ Σk 0.5(Pk+Pk+1)·(tk+1-tk)/3600
```

`P` W, `t` s. 출처: [NIST DLMF trapezoidal quadrature](https://dlmf.nist.gov/3.5). 구간평균 API 복사량은 timestamp가 “직전 1시간 평균”인지 순간값인지 먼저 해석해야 한다. 이미 구간평균인 시간별 `P̄k`는 `ΣP̄k Δt`가 더 자연스러우며, 순간 샘플에만 trapezoid를 쓴다. Open-Meteo 복사는 기본 직전 구간 평균임을 metadata에 기록한다.

| 계산 | 기본 시간격자 | 조절 범위 / 처리 |
|---|---:|---|
| 실시간 물리 | 1 s | `0.02…60 s`; 렌더 FPS와 분리 |
| 하루 | 5 min | `1…60 min`; 일출/일몰 구간 추가 세분 |
| 월/연 | 원자료 1 h | `5…60 min` 보간 또는 1 h; TMY는 8760 대표시간 |
| 회전 substep | `Δθ≤5°` | 고 RPM은 위상 평균 |

월·연간은 각 timestamp에서 태양위치, 날씨, 회전위상/평균, 차폐, 온도, 전기회로, 인버터를 다시 평가하고 `Wh`를 월별로 합한다. 총 패널 면적 `Atot=N×0.0025 m²`; 정규화는 `P/Atot (W/m²)`, `E/Atot (Wh/m²)`로 하며 절대값과 항상 함께 표시한다. 면적이 0이면 정규화하지 않는다.

시간 규칙: 내부는 UTC epoch, UI는 IANA timezone; DST 중복/누락시간을 offset으로 구별한다. PVGIS `localtime=0`은 UTC이며 TMY는 실제 연도가 아닌 대표월 조합임을 표시한다. 누락 구간은 2개 이하만 선형보간(복사량은 0 이상); 더 긴 gap은 적분에서 제외하고 coverage 비율을 보고하며 무단으로 연간 환산하지 않는다. 윤년은 입력자료 8784시간을 그대로 처리한다.

정확도 진단은 같은 조건에서 `Δt`를 절반으로 해 `|EΔt/2-EΔt|/max(EΔt/2,ε)`를 표시한다. 목표 기본 1%; 미달이면 더 작은 step을 권한다. 진행률/취소는 Web Worker chunk(예: 24시간) 사이에서 확인하고 취소 시 부분 결과를 명시한다. 애니메이션 프레임 속도는 물리 `Δt`를 바꾸지 않는다.

## 12. 형상·환경 비교의 공정성

동시 1–5개 형상은 동일한 UTC timestamp 배열, 위치, API 응답, 수동 기상값, 난류/cloud seed, solver tolerances와 인버터 규칙을 공유한다. 형상마다 달라질 수 있는 것은 패널 위치/법선, ray 차폐, 높이 풍속, 온도, 회로 토폴로지와 회전 위상뿐이다. 사용자가 개별 형상의 패널 수를 바꾸면 다음을 함께 보인다.

- 절대 DC/AC W와 Wh
- 패널 수, 총 면적 m²
- 면적 정규화 DC/AC W/m²와 Wh/m²
- 이용 가능한 입사 POA 및 광학/온도/mismatch/배선/인버터/clip 손실 워터폴
- RPM, 정지 대비 변화 `ΔE`와 `%`

손실 워터폴 기준은 순차적이고 상호배타적으로 정의한다. 예: `이론 front POA → direct/sky/ground 차폐 → IAM/soiling/spectral → 온도/단일다이오드 → mismatch+bypass → DC wiring → MPPT 제한 → inverter conversion → clipping → AC wiring`. 부분음영을 POA에서도 줄이고 다시 “shade loss %”로 곱하지 않는다.

## 13. 구현·검증용 수용 기준

1. **기하/효율 기준:** `A=0.0025 m²`, `S=1000 W/m²`, η=0.20, 25°C, 정상입사, 무손실에서 nameplate 피팅 정밀모드와 단순모드 모두 `Pdc,mpp=0.500 W`(허용 `±0.5%`). 20개 독립/정상 연결은 10.00 W(`±1%`).
2. **밤/뒤면:** `αs≤0`이면 모든 POA/Pdc/Pac가 정확히 0. `n·s≤0`이면 front beam은 정확히 0이고 diffuse/ground만 기하에 따라 남을 수 있다.
3. **AOI/IAM:** 직달은 IAM off에서 `cos(AOI)`에 따르고 physical IAM on에서는 normal=1, grazing→0. 0°·60°·80°를 PVPMC 식의 독립 계산과 `1e-6` 비교한다.
4. **POA 폐합:** 무차폐 수평면(`β=0`, IAM off)에서 `G_POA≈GHI`; 수직면 ground term은 `0.5ρgGHI`. Perez 무차폐 수치돔은 폐형식의 1% 이내.
5. **광선 차폐:** 작은 불투명 상자를 추가하면 실제 교차된 panel samples만 `Vsun`이 감소한다. 렌더 shadow on/off가 수치결과를 바꾸면 실패다.
6. **Faiman:** `Ta=25, G=1000, WS=0, U0=25`이면 `Tm=65°C`; `WS` 증가 시 단조 감소.
7. **단일 다이오드:** STC I-V가 `Isc,Voc,Vmp,Imp` 피팅 허용오차를 만족하고 `I(V)`가 정상 구간에서 단조 비증가. solver 실패/overflow가 NaN으로 전체 합을 오염시키지 않는다.
8. **회로:** 동일 패널 20개 직렬은 전압 약 20배/전류 동일, 병렬은 전류 약 20배/전압 동일. 패널 1개 음영 시 직렬 current limit과 bypass active가 나타나며 P-V의 다중 peak를 global MPPT가 찾는다.
9. **인버터:** `Pac≤Pac0`; `Pdc=0`일 때 발전 0(standby 소비는 별도). MPPT 전압/전류 범위 밖 상태와 clip W가 표시된다.
10. **회전:** RPM=0 결과는 정지 모델과 bitwise 또는 엄격 tolerance로 동일. 고정 RPM에서 `θ(t)` 해석해와 수치각 오차 `<10⁻⁶ rad`. 하루 energy는 timestep 절반에서 1% 이내; 고 RPM 위상 평균은 시작위상 변화에 1% 이내.
11. **적분:** 상수 10 W를 1 h 적분하면 10 Wh. 하루 누적은 시간대 그래프 원자료를 같은 규칙으로 재적분한 값과 일치. 월합의 합=연합.
12. **재현성/오프라인:** 같은 입력·seed·버전은 같은 결과. API 오류/timeout/schema 오류에는 `estimated fallback`으로 정상 동작하고 그 상태가 UI·CSV·JSON에 보존된다.
13. **API 의미:** Open-Meteo backward average, POWER UTC/LST, PVGIS TMY를 각각 fixture로 검사하고 단위/시간축을 잘못 한 칸 이동하지 않는다.
14. **비교:** 1–5 형상이 같은 weather object와 seed를 참조한다. 패널 수가 다르면 절대값과 면적정규화값이 동시에 존재한다.
15. **공식 추적:** UI 공식 패널의 식 ID/변수/단위/중간값이 실제 계산 함수가 내보낸 trace와 일치하고 별도의 설명용 재계산을 하지 않는다.

SPA 회귀검증은 NREL SPA 보고서/온라인 계산기의 알려진 예제와 비교하고, 단순 평면 무차폐 결과는 PVWatts 또는 PVGIS와 교차검증한다. 차이는 태양 알고리즘, irradiance database, Perez 계수, 온도·인버터 버전, 시간 평균 규약별로 분해해 기록한다. 서로 다른 서비스 결과가 다를 때 “평균값”을 정답처럼 만들지 않는다.

## 14. 핵심 한계와 사용자에게 표시할 문구

- 이 앱은 패널 전면의 단파 일사·준정상 열/전기/항력을 계산한다. 3D 복사전달, CFD, 구조해석, hot-spot 안전, 장기 열화, 계통 고조파/무효전력 모델이 아니다.
- raycast는 불투명 삼각형 차폐다. 반투명 나뭇잎, 태양 원반 반그림자, 다중반사와 회절이 없다.
- Perez는 경험적 하늘 전사식이고 장애물 하늘돔은 유한방향 수치근사다. Erbs는 시간평균·제한 지역 자료 기반이다.
- Faiman 기본계수는 특정 자유통풍 모듈 실험값이다. 회전/밀폐/수면/건물일체형에는 측정 보정이 필요하다.
- 단일 다이오드는 정상상태 DC 모델이다. 셀 역항복·열 hotspot과 바이패스 열화는 생략한다.
- 자동회전은 drag-only lumped rigid-body 모델이다. 표시 RPM과 obstacle wake는 풍동/CFD 검증치가 아니다.
- API 값은 공급자별 수치모델·위성·재분석 또는 TMY다. 관측 실측과 구분하고 조회 메타데이터를 함께 내보낸다.
- 모든 **시나리오 기본값**은 사용자가 수정할 수 있고 JSON에 값·단위·출처태그·모델버전으로 저장되어야 한다.

## 15. 공식 출처 색인

- NREL/NLR: [SPA](https://midcdmz.nrel.gov/spa/), [SPA Technical Report](https://docs.nrel.gov/docs/fy08osti/34302.pdf), [PVWatts V8](https://pvwatts.nrel.gov/version_8.php), [PVWatts V8 API](https://developer.nrel.gov/docs/solar/pvwatts/v8/), [PVWatts V5 공개 수식](https://pvwatts.nrel.gov/downloads/pvwattsv5.pdf), [TurbSim guide](https://research-hub.nrel.gov/en/publications/turbsim-useraposs-guide-revised-february-2007-for-version-121/).
- Sandia PVPMC: [Modeling Guide](https://pvpmc.sandia.gov/modeling-guide/), [POA](https://pvpmc.sandia.gov/modeling-guide/1-weather-design-inputs/plane-of-array-poa-irradiance/), [Perez](https://pvpmc.sandia.gov/modeling-guide/1-weather-design-inputs/plane-of-array-poa-irradiance/calculating-poa-irradiance/poa-sky-diffuse/perez-sky-diffuse-model/), [Faiman](https://pvpmc.sandia.gov/modeling-guide/2-dc-module-iv/module-temperature/faiman-module-temperature-model/), [single diode](https://pvpmc.sandia.gov/modeling-guide/2-dc-module-iv/single-diode-equivalent-circuit-models/), [Sandia inverter](https://pvpmc.sandia.gov/modeling-guide/dc-to-ac-conversion/sandia-inverter-model/).
- JRC: [PVGIS API v5 문서](https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/using-pvgis-5/api-non-interactive-service_en).
- NASA: [POWER API](https://power.larc.nasa.gov/docs/services/api/), [POWER parameter dictionary](https://power.larc.nasa.gov/docs/tutorials/parameters/), [standard atmosphere](https://www.grc.nasa.gov/www/k-12/VirtualAero/BottleRocket/airplane/atmosmet508.html), [drag equation](https://www.grc.nasa.gov/www/k-12/VirtualAero/BottleRocket/airplane/drageq.html).
- Open-Meteo: [Forecast/Weather API](https://open-meteo.com/en/docs/), [Satellite Radiation API](https://open-meteo.com/en/docs/satellite-radiation-api).
- DTU/NIST: [WAsP wind profile](https://wasp.dtu.dk/support/frequently-asked-questions/wasp-faq/Wind-shear-exponents), [NIST numerical quadrature](https://dlmf.nist.gov/3.5).
