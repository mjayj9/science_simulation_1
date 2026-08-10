# 기상·일사 데이터 소스와 오프라인 전략

> 공식 문서 확인일: 2026-08-10
> 적용 대상: 백엔드 없이 정적 배포되는 브라우저 앱

## 1. 지원 원칙

- 온라인 자료는 입력 데이터일 뿐 정답으로 간주하지 않는다. 응답의 데이터셋, 모델, 격자, 시간 기준과 조회 시각을 결과와 함께 저장한다.
- 내부 시계열은 UTC로 정규화하고 원래 시간대·오프셋도 보존한다. 서로 다른 소스의 `HH:00`이 같은 유효시간을 뜻한다고 가정하지 않는다.
- API 실패를 0 W/m²나 이전 값으로 조용히 바꾸지 않는다. 실패 이유와 대체 경로를 UI에 표시한다.
- GHI/DNI/DHI가 구름을 이미 포함하면 구름 프리셋 감쇠를 다시 적용하지 않는다.
- 정적 앱에 비밀 API 키를 포함하지 않는다.
- 실제 관측소 자료가 아닌 모델·재분석 자료에 `관측` 배지를 붙이지 않는다.

## 2. 데이터 출처 요약

| 용도 | 우선 경로 | 정적 브라우저 지원 | 기본 배지 |
|---|---|---|---|
| 현재·단기예보 | Open-Meteo Forecast API | 브라우저 API 호출 | `예보 모델` 또는 `현재시각 모델값` |
| 장기 과거 시계열 | Open-Meteo Historical Weather API | 브라우저 API 호출 | `재분석`/`분석 모델` |
| 대표년(TMY)·다년 시간별 | PVGIS 5.3 | **직접 AJAX 호출 미지원**. 사용자가 받은 JSON/CSV/EPW 파일 가져오기 | `대표년(TMY)` 또는 DB에 따른 `위성·재분석` |
| 장기 대체·교차검증 | NASA POWER | 배포 환경에서 CORS를 확인한 선택적 API 또는 JSON/CSV 파일 가져오기 | `위성·모델`/`재분석` |
| 네트워크 실패 | 내장 맑은하늘 모델·수동 프리셋 | 완전 오프라인 | `모델 추정` 또는 `수동 입력` |

`관측` 배지는 향후 관측소 ID, 측기, 품질 플래그와 시각이 있는 실제 관측 자료를 가져올 때만 사용한다.

## 3. Open-Meteo

공식 문서: [Weather Forecast API](https://open-meteo.com/en/docs/), [Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api), [Historical Forecast API](https://open-meteo.com/en/docs/historical-forecast-api)

### 3.1 현재·예보

기본 엔드포인트는 `https://api.open-meteo.com/v1/forecast`이다. 기본 예보는 7일이며 `forecast_days=16`으로 최대 16일까지 요청할 수 있다. 앱은 PV 계산에 필요한 다음 시간별 필드를 명시적으로 요청한다.

| 앱 값 | Open-Meteo 변수 | 시간 의미 |
|---|---|---|
| 기온 | `temperature_2m` | 표시 시각의 순간값 |
| GHI | `shortwave_radiation` | 직전 1시간 평균 W/m² |
| 수평면 직달 | `direct_radiation` | 직전 1시간 평균 W/m². DNI와 혼동 금지 |
| DNI | `direct_normal_irradiance` | 직전 1시간 평균 W/m² |
| DHI | `diffuse_radiation` | 직전 1시간 평균 W/m² |
| 풍속·풍향 | `wind_speed_10m`, `wind_direction_10m` | 표시 시각의 10 m 값 |
| 돌풍 | `wind_gusts_10m` | 직전 1시간 최대값 |
| 구름 | `cloud_cover` 및 필요 시 low/mid/high | 표시 시각의 면적률 |
| 강수·상태 | `precipitation`, `rain`, `weather_code` | 강수는 직전 1시간 합, 코드는 순간 상태 |

`current=` 응답은 **15분 기상모델 자료**를 기반으로 한다. 관측소 실황이 아니므로 UI에는 `현재시각 모델값`으로 표시한다. `current.interval`은 누적·평균이 거슬러 올라가는 초 단위 구간이며 함께 보존한다. 15분 자료를 별도로 요청할 때는 지역 모델이 제공하지 않는 변수가 1시간 자료에서 보간될 수 있으므로 `15분 관측`이라고 표기하지 않는다.

예보 공간 해상도는 선택 모델과 지역에 따라 다르다. 공식 모델 표에는 약 1–55 km 범위의 모델이 있고, 한국 KMA 모델은 1.5–13 km로 기재되어 있다. 기본 `models=auto`는 위치에 적용 가능한 고해상도 모델을 조합하므로 앱은 단일한 공간 해상도를 만들어 표시하지 않는다.

- 모델을 명시한 요청: 요청 모델명과 공식 표의 해상도를 기록
- `auto`: `Open-Meteo Best Match`, `모델별 상이`로 표시
- 반환 위·경도는 요청점이 아니라 사용된 **기상 격자 중심**일 수 있으므로 요청 좌표와 반환 좌표를 모두 저장
- 반환 고도는 기본 90 m DEM과 통계적 다운스케일링에 사용되므로 사용자 고도와 반환 고도를 구분

### 3.2 과거 자료

장기 일관성이 목적이면 Historical Weather API에서 모델을 고정한다.

| 데이터셋 | 공식 문서상 범위 | 공간 해상도 | 시간 해상도 | 배지 |
|---|---:|---:|---:|---|
| ERA5 | 1940–현재 | 0.25°(약 25 km) | 1시간 | `재분석` |
| ERA5-Land | 1950–현재 | 0.1°(약 11 km) | 1시간 | `재분석` |
| ECMWF IFS 분석 | 2017–현재 | 약 9 km | 1시간 | `분석 모델` |

기본 Best Match는 IFS, ERA5, ERA5-Land를 이어 붙이므로 장기 추세 비교에는 모델 변경에 따른 불연속이 섞일 수 있다. 기후·연간 비교에는 ERA5 또는 ERA5-Land를 명시하고, 최근 몇 년의 실제 날씨에 가까운 모델 시계열이 필요할 때만 Historical Forecast API를 별도 선택한다. Historical Forecast는 여러 운영 예보의 초기 구간을 연결한 자료이고 모델 버전이 바뀌므로 장기 기후 추세용이 아니다.

Historical Weather의 일사 변수는 1시간 평균과 표시 시각의 `*_instant` 변수를 모두 제공한다. 에너지 적분에는 평균 시계열을 사용하며 순간값과 섞지 않는다.

### 3.3 반드시 저장할 응답 메타데이터

- 요청 좌표·고도와 반환 격자 중심 `latitude`, `longitude`, `elevation`
- `timezone`, `timezone_abbreviation`, `utc_offset_seconds`
- `current.time`, `current.interval`, `hourly.time`
- `hourly_units`/`current_units`와 요청한 변수 목록
- 요청 또는 자동 선택한 모델명, 과거 자료의 재분석 데이터셋
- 앱이 추가한 `retrievedAtUtc`, 요청 URL의 비밀값 제거본, 응답 유효 기간
- 캐시 여부와 캐시 생성 시각

`generationtime_ms`는 서버 응답 생성 시간이지 자료의 관측·분석 시각이 아니므로 조회 시각 대신 사용하지 않는다.

## 4. PVGIS 5.3

공식 문서: [PVGIS 비대화형 API](https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/using-pvgis-5/api-non-interactive-service_en), [TMY 생성기](https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/using-pvgis-5/pvgis-5-tools/pvgis-typical-meteorological-year-tmy-generator_en), [Hourly radiation](https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/using-pvgis-5/pvgis-5-tools/hourly-radiation_en)

버전이 고정된 엔드포인트는 다음과 같다.

- TMY: `https://re.jrc.ec.europa.eu/api/v5_3/tmy`
- 다년 시간별: `https://re.jrc.ec.europa.eu/api/v5_3/seriescalc`

버전 없는 `/api/tmy` 또는 `/api/seriescalc`를 5.3으로 간주하지 않는다. JRC 문서는 버전 없는 진입점이 5.2를 제공한다고 명시한다.

### 4.1 TMY와 hourly의 의미

TMY는 과거 어느 한 해의 관측 기록이나 미래 예보가 아니라, 최소 10년 이상의 후보 기간에서 월을 골라 만든 **합성 대표년**이다. JSON/CSV에는 시간별 `T2m`, `RH`, `G(h)`(GHI), `Gb(n)`(DNI), `Gd(h)`(DHI), `IR(h)`, `WS10m`, `WD10m`, `SP`가 포함될 수 있다. 선택 월의 원래 연도, 방사 DB, 기상 DB, 고도, 지평선 사용 여부와 `irradiance_time_offset`을 보존한다. 표시 시각이 `HH:00`이어도 방사 값의 실제 대표 시각에는 DB별 오프셋이 있으므로 태양 위치 계산에 이를 적용한다.

`seriescalc`는 다년간 시간별 일사와 선택적인 PV 출력 추정을 제공한다. 성분 출력 시 경사면의 `Gb(i)`, `Gd(i)`, `Gr(i)`, 태양 고도, 기온, 10 m 풍속 등을 제공한다. PVGIS 경사면 방위각은 `0°=남, -90°=동, 90°=서`이므로 앱의 `0°=북, 시계방향` 규약으로 명시적으로 변환한다. 임의 3D 패널 형상의 주 계산을 PVGIS 고정면 출력으로 대체하지 않고, 평면 사례의 입력 또는 교차검증에 사용한다.

### 4.2 브라우저 제약 — 직접 호출을 지원하지 않음

JRC 공식 문서는 **PVGIS API의 AJAX 접근을 허용하지 않으며 CORS 변경 요청도 거부한다**고 명시한다. 따라서 백엔드 없는 정적 앱은 `fetch`, XHR, Web Worker, Service Worker 또는 `mode: no-cors`로 응답을 읽을 수 없다.

정적 배포의 지원 범위는 다음뿐이다.

1. 앱이 5.3 요청 URL을 만들어 외부 탭/다운로드로 안내한다.
2. 사용자가 `browser=1`로 받은 JSON/CSV 또는 TMY EPW 파일을 앱에 가져온다.
3. 앱이 파일 스키마·단위·시간·버전·DB를 검증한 뒤 로컬에 저장한다.

별도 서버/서버리스 프록시를 배포한 경우에만 자동 PVGIS 연결을 선택 기능으로 추가할 수 있다. 이는 정적 기본 아키텍처 밖의 기능이며 프록시 URL, 캐시, 속도 제한, 오류 처리와 운영 주체를 명시해야 한다. 공개 CORS 우회 프록시를 사용하지 않는다. UI 버튼 이름도 `PVGIS API 자동 조회`가 아니라 `PVGIS 5.3 파일 가져오기`로 한다.

PVGIS는 GET만 허용하고 공식 제한은 IP당 초당 30호출이다. `429`와 과부하 `529`는 실패로 처리하되, 정적 앱에서는 직접 재시도하지 않고 다운로드 안내 또는 오프라인 대체로 전환한다.

## 5. NASA POWER

공식 문서: [API 개요](https://power.larc.nasa.gov/docs/services/api/), [Temporal API](https://power.larc.nasa.gov/docs/services/api/temporal/), [Hourly API](https://power.larc.nasa.gov/docs/services/api/temporal/hourly/), [자료 방법론](https://power.larc.nasa.gov/docs/methodology/meteorology/), [Parameter Dictionary 안내](https://power.larc.nasa.gov/docs/tutorials/parameters/)

POWER는 PVGIS를 브라우저에서 호출할 수 없을 때의 **장기 자료 대체 경로이자 교차검증 자료**다. 현재·단기예보를 대신하지 않는다.

- 시간별·일별·월별·기후값 API와 JSON/CSV 등을 제공한다. 시간별은 단일 지점 시계열이다.
- 시간별 API는 평균 시간값이며 기본 시간 기준이 Local Solar Time(LST)이다. 앱은 `time-standard=UTC`를 명시하고 원래 기준도 저장한다.
- 공식 문서상 시간별 자료는 2001년부터 근실시간까지 제공된다. 일별 기상 자료는 더 긴 기간을 제공하므로 요청 수준별 가용 범위를 확인한다.
- 기상 변수는 MERRA-2 동화/재분석을 기반으로 하며 원 격자는 0.5° × 0.625°이다. 이것은 현장 관측점이 아니라 격자 평균이다.
- 태양복사 자료는 위성 관측을 사용하는 복사전달 산출물이다. `ALLSKY_SFC_SW_DWN`과 같은 변수의 정확한 단위·시간 의미·원 자료는 요청 시 Parameter Dictionary/응답 헤더에서 확인한다.
- 기온·풍속 등은 `T2M`, `WS10M`, `WD10M`처럼 높이가 이름에 포함된 변수를 사용하고 패널 높이의 국부 풍속과 동일시하지 않는다.

NASA 응답을 Open-Meteo/PVGIS와 비교할 때 해상도, 시간 기준, 위성·재분석 방법이 다르므로 수치가 다르다는 사실만으로 오류라고 판정하지 않는다. 월·연간 합계, 편향, 결측률을 같은 기간·단위·UTC 기준으로 비교한다.

공식 문서가 모든 배포 origin의 브라우저 CORS 동작을 보장한다고 가정하지 않는다. 자동 연결은 실제 배포에서 CORS 스모크 테스트가 통과한 경우에만 활성화하며, 실패 시 공식 페이지에서 내려받은 JSON/CSV 가져오기를 제공한다. HTTP `422`, `429`, 네트워크·스키마 오류를 대체 경로 조건으로 처리한다.

## 6. 결정론적 오프라인 대체

### 6.1 전환 순서

1. 정확히 같은 소스·좌표·고도·모델·시간 범위의 검증된 로컬 캐시가 있으면 `캐시`와 생성 시각을 표시해 사용한다.
2. 사용자가 가져온 PVGIS/NASA/Open-Meteo 파일이 있으면 원래 자료 배지를 유지하고 `파일 가져오기`를 추가 표시한다.
3. 해당 자료가 없으면 내장 **맑은하늘 모델**로 GHI/DNI/DHI를 계산하고 `모델 추정` 배지를 표시한다.
4. 기온·풍속·구름·비는 수동 입력 또는 수동 프리셋으로 받는다. 관측값처럼 꾸미지 않는다.

캐시는 다른 좌표·날짜·고도에 재사용하지 않으며, 예보 캐시에는 `만료/오래됨` 상태를 표시한다. 외부 API 실패 후 마지막 성공값을 현재값으로 조용히 유지하지 않는다.

### 6.2 맑은하늘 모델

맑은하늘 대체는 네트워크가 전혀 없어도 동일 입력에서 동일 출력을 내야 한다.

- 입력: 위도, 경도, 고도, UTC 시각, 지면 반사율과 문서화된 대기 기본값
- 출력: 비음수 GHI/DNI/DHI와 출처 `offline-clear-sky`, 모델·계수 버전
- 태양이 지평선 아래면 세 성분을 0으로 설정
- 난수, 시스템 현재시각, 렌더 프레임 속도에 의존하지 않음
- 이것은 실제 날씨나 TMY가 아니라 구름 없는 기준 시나리오임을 표시

사용한 맑은하늘 공식과 모든 계수는 `docs/modeling-research.md`에 공식·단위·범위·출처와 함께 둔다. 계수가 준비되지 않았다고 임의의 상수를 “정밀” 모델로 표시하지 않는다.

### 6.3 수동 프리셋

`맑음`, `반 구름`, `완전 흐림`, `비`, `밤` 프리셋은 자료가 아니라 재현 가능한 시나리오다.

- 프리셋이 맑은하늘 GHI/DNI/DHI를 변환하는 방식과 계수를 UI에 공개한다.
- `반 구름`의 시간 변화는 `시나리오 ID + 날짜 + 사용자 seed`로 결정하며 형상 비교 전체에 같은 시계열을 사용한다.
- `밤`은 일사 0이다. 다른 프리셋도 태양 고도 ≤ 0이면 일사 0이다.
- `비`는 일사·기온·풍속의 수동 시나리오일 뿐 자동 세척률을 뜻하지 않는다.
- 기온, 풍속, 풍향, 돌풍, 지면 반사율, 오염률은 사용자가 수정할 수 있고 단위와 범위를 검증한다.
- 배지는 `모델 추정 · 수동 프리셋`, 데이터 출처는 `offline-preset`, 난수 seed와 프리셋 버전을 내보내기에 포함한다.

## 7. 출처 배지와 공통 메타데이터 계약

| 배지 | 사용 조건 | 사용하면 안 되는 경우 |
|---|---|---|
| `관측` | 관측소/측기 ID와 품질 메타데이터가 있는 실제 측정 | Open-Meteo current, ERA5, POWER, PVGIS TMY |
| `재분석` | ERA5/ERA5-Land/MERRA-2처럼 관측을 동화한 재분석 | 단기예보, 합성 프리셋 |
| `예보 모델` | 특정 시각에 발행된 수치예보 또는 Open-Meteo 최신 예보 조합 | 과거 재분석, 실측 |
| `대표년(TMY)` | PVGIS가 선택한 합성 대표년 | 실제 특정 연도나 미래 예보 |
| `위성·모델` | 위성 입력을 복사전달 등으로 산출한 일사 자료 | 지상 일사계 관측 |
| `모델 추정` | 내장 맑은하늘·오프라인 계산 | API/파일의 실제 데이터 |
| `수동 입력` | 사용자가 직접 넣은 값/시계열 | 자동 대체 기본값 |

모든 시계열은 다음 공통 provenance를 저장한다.

```text
provider, product, dataset/model, version
kind (observation | reanalysis | forecast | tmy | satellite-model | offline-model | manual)
requestedLocation, returnedGridLocation, elevation
validFromUtc, validToUtc, temporalResolution, spatialResolution
timezone/originalTimeStandard, units
retrievedAtUtc, retrievalMode (api | import | cache | offline)
requestParameters, fallbackReason, qualityFlags
```

`fallbackReason`은 `offline`, `timeout`, `cors`, `http-429`, `http-5xx/529`, `invalid-schema`, `missing-values`, `user-selected`처럼 구체적으로 기록한다.

## 8. 완료 조건

- Open-Meteo 현재값을 관측으로 표시하지 않는다.
- GHI, 수평 직달, DNI, DHI의 의미와 평균 구간을 구분한다.
- 요청점과 반환 격자 중심, 고도, 시간대와 단위를 보존한다.
- PVGIS 5.3은 파일 가져오기만 정적 기본 기능으로 표시하며 직접 AJAX 성공을 주장하지 않는다.
- TMY, 실제 연도, 재분석, 예보, 맑은하늘 시나리오를 서로 다른 배지로 표시한다.
- NASA POWER를 장기 대체·교차검증에만 사용하고 격자 자료를 현장 관측으로 표현하지 않는다.
- 실패 시 사용자에게 전환 사실과 이유를 알리고 결정론적 맑은하늘/수동 프리셋으로 정상 동작한다.
- 같은 입력·seed·모델 버전은 온라인 연결 유무와 관계없이 같은 오프라인 결과를 만든다.
