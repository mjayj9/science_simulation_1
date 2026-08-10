# 입사각·일사량 계산 원인 분석과 수정 계약

## 결론

패널 직달 POA의 유일한 계산식은 다음과 같다.

\[
G_{direct,POA}=DNI\;V_{sun}\;\eta_{cos}\;IAM
\]

\[
\eta_{cos}=\max(0,\hat n\cdot\hat s),\qquad
\eta_{angle}=\eta_{cos}\,IAM
\]

- `n̂`: 회전까지 반영한 패널 전면 세계법선, 무차원 단위벡터
- `ŝ`: 관측점에서 태양을 향하는 ENU 세계벡터, 무차원 단위벡터
- `DNI`: 직달법선 복사조도, W/m²
- `Vsun`: ray sampling으로 계산한 직달 가시율, 0–1
- `IAM`: 유리 표면 입사각 광학 계수, 0–1
- `ηcos`: 기하학적 코사인 투영 계수, 0–1
- `ηangle`: 가시율을 제외한 전체 직달 각도 계수, 0–1

수정 전 `calculatePOA` 내부의 수식 자체는 이미 이 구조를 사용했다. 실제 이상 출력의 원인은 그 앞뒤 통합 계층에 있었다. UI의 대표일 생성기가 GHI/DNI/DHI를 서로 다른 임의 함수로 다시 만들었고, 패널 위치·법선·ray sampling 축·Three.js 그룹이 서로 다른 단계에서 회전했다. 또한 코사인, IAM, 결합 각도계수가 별도로 노출되지 않아 후속 전기 계산이 같은 손실을 다시 적용하기 쉬웠다.

## 좌표계 계약

전 물리 코어는 Three.js와 같은 ENU 좌표계를 사용한다.

| 축/각 | 정의 |
|---|---|
| `+X` | 동쪽 |
| `+Y` | 위쪽 |
| `+Z` | 북쪽 |
| 방위각 0° | 북쪽 |
| 방위각 90° | 동쪽 |
| 방위각 180° | 남쪽 |
| 방위각 270° | 서쪽 |

태양벡터는 다음과 같다.

\[
\hat s=(\cos\alpha\sin\gamma,\;\sin\alpha,\;\cos\alpha\cos\gamma)
\]

여기서 `α`는 태양고도, `γ`는 진북 기준 시계방향 방위각이다. `sunVector()`가 이 규약의 단일 구현이다.

## 확인된 원인

### 1. 각도 손실의 의미가 합쳐져 있었음

기존 결과에는 signed `cosineIncidence`와 최종 `beamWm2`만 있어 다음 값을 구분하기 어려웠다.

- 전면 투영 손실 `ηcos`
- 유리 반사 손실 `IAM`
- 두 값을 곱한 `ηangle`
- 음영까지 반영한 최종 직달 POA

이 때문에 화면 표시 또는 전기 모델에서 `cos(AOI)`를 다시 곱하면 직달 출력이 `cos²(AOI)`에 비례하는 오류가 생길 수 있었다.

### 2. GHI/DNI/DHI의 수평면 폐합 검사가 없었음

세 성분이 모두 입력되면 이전 파이프라인은 그대로 사용했다. 서로 폐합하지 않는 입력에서는 직달·산란항과 GHI 기반 지면반사항이 서로 다른 복사장을 나타낼 수 있다.

검사식은 다음과 같다.

\[
GHI_{reconstructed}=DNI\max(0,\cos\theta_z)+DHI
\]

\[
r_{GHI}=GHI-GHI_{reconstructed}
\]

이번 수정은 원자료를 조용히 덮어쓰지 않고 잔차와 통과 여부를 노출한다. 기본 통과 허용치는 `max(1 W/m², 2%)`이다.

### 3. 태양벡터와 별도 천정각이 서로 다른 권위값이 될 수 있었음

기존 POA 입력은 `sunDirection`과 `solarZenithDeg`를 함께 받았다. AOI는 전자를, daylight·Hay–Davies 분모는 후자를 사용했기 때문에 두 값이 불일치하면 한 번의 POA 계산 안에서 서로 다른 태양 위치가 사용될 수 있었다.

수정 후 POA는 정규화된 `sunDirection.y`에서 천정각을 유도해 모든 기하 계산에 사용한다. 입력 천정각과의 차이는 `solarZenithMismatchDeg`로 보존한다.

### 4. 회전 위치·법선·ray sampling 축이 하나의 pose를 공유하지 않았음

패널 중심 ray 하나만 쓰지 않는 경우 위치, quaternion, 전면법선과 면내 sampling 축 `U`, `V`가 모두 같은 강체 회전을 받아야 한다. 이전 UI는 패널 위치와 법선을 +Y축으로 회전했지만 quaternion은 회전 전 값으로 남겼다. 차폐 sampling 축은 그 회전 전 quaternion에서 계산했으므로, POA가 본 법선과 ray origin들이 놓인 면이 달라졌다.

수정 후 `createPanelFrame()`이 오른손 직교 frame을 만들고 `rotatePanelFrameAroundY()`가 법선과 두 sampling 축에 동일한 +Y 회전행렬을 적용한다. `simulateInstant()`는 정규화된 `panelFrame`을 반환한다.

### 5. UI `buildDaySeries`가 실제 기상 대신 비폐합 일사 시계열을 합성했음

이전 대표일 경로는 한 시점의 프리셋을 시간대별 기상자료처럼 사용하면서 `f=max(0,sin(elevation))`를 만든 뒤 다음과 같이 세 성분에 서로 다른 배율을 적용했다.

\[
GHI_t=GHI_0\min(1,f),\qquad
DNI_t=DNI_0\sqrt f,\qquad
DHI_t=DHI_0(0.55+0.45f)
\]

이 식들은 Haurwitz, Erbs 또는 관측자료의 성분 분해식이 아니며 `GHI=DNI cos(zenith)+DHI`를 보장하지 않는다. 특히 태양이 지평선 바로 위에 있을 때도 DHI는 원 프리셋의 약 55%를 남기고, DNI의 제곱근 배율은 GHI와 다른 시간형상을 만들어 POA와 일·월·연 에너지를 왜곡한다. 이후 `simulateInstant()`가 정확한 POA 식을 사용해도 입력 복사장 자체가 비물리적이므로 결과를 복구할 수 없다.

### 6. 계산된 세계 pose를 Three.js에서 다시 회전했음

이전 순간 계산은 `position`과 `normal`에 이미 `rotationAngle`을 적용한 결과를 `ThreeWorkspace`로 넘겼다. 그러나 3D 계층은 다시 `panelGroup.rotation.y=rotationAngle`을 적용했다. 따라서 화면 위치는 두 번 회전하고 mesh quaternion·법선 helper·ray helper는 서로 다른 횟수로 회전할 수 있었다. 이 차이는 단순한 표시 오차가 아니라 편집 후 세계 pose를 기준 pose로 저장하면서 다음 계산에 다시 들어가는 누적 오차도 만들 수 있었다.

## 수정된 통합 계약

일사와 자세의 단일 데이터 흐름은 다음과 같다.

1. Open-Meteo/PVGIS/NASA 파일 또는 오프라인 fallback이 실제 `WeatherSeries`를 만든다. 각 `WeatherPoint`의 timestamp와 GHI/DNI/DHI가 시계열 계산의 유일한 기상 권위값이다.
2. 같은 timestamp·위치로 공유 `solarPosition()`을 한 번 호출하고 그 결과의 `sunVector()`를 사용한다. UI 전용 태양 위치 근사나 시간대별 `sin(elevation)` 재배율은 두지 않는다.
3. `WeatherPoint`의 세 일사 성분을 수정 없이 공유 `simulateInstant()`에 전달한다. POA에서 `etaCos`, IAM, 가시율을 각각 한 번 적용하고, 그 `effectivePoaWm2`를 DC 모델에 직접 전달한다.
4. 오프라인 fallback만 태양 위치에서 Haurwitz clear-sky GHI를 만든 뒤 시나리오 감쇠를 GHI에 한 번 적용하고 Erbs로 DNI/DHI를 분해한다. 이 경로도 폐합된 `WeatherSeries`를 먼저 만든 뒤 동일한 단계 2–3을 탄다.
5. 기준 pose `(p0,q0)`에 세로축 회전 하나만 합성해 `p=R_y p0`, `q=q_y q0`인 세계 pose를 만든다. `normal=q(+Z)`, `U=q(+X)`, `V=q(+Y)`를 같은 quaternion에서 유도하고 이 값을 POA, ray sampling, mesh, helper가 함께 사용한다.
6. `ThreeWorkspace`는 이미 계산된 세계 pose를 그대로 그리며 그룹 회전을 다시 적용하지 않는다. 편집 결과를 기준 pose로 저장해야 할 때만 현재 세계 회전의 역변환을 한 번 적용한다.

즉, UI의 대표일·순간·연간 경로는 모두 `WeatherSeries → solarPosition/sunVector → simulateInstant`라는 같은 물리 경계를 사용해야 한다. 임의 일사 곡선이나 별도 자세 변환은 이 경계 밖에서 추가하지 않는다.

## 변경된 API

### `POAResult`

새 필드:

| 필드 | 단위 | 의미 |
|---|---:|---|
| `etaCos` | 1 | `max(0,n̂·ŝ)` |
| `iamFactor` | 1 | 선택한 ASHRAE/physical IAM |
| `etaAngle` | 1 | `etaCos × iamFactor`; 가시율 제외 |
| `directPoaWm2` | W/m² | `DNI × visibility × etaAngle` |
| `diffusePoaWm2` | W/m² | Hay–Davies 또는 등방 산란 POA |
| `groundPoaWm2` | W/m² | Lambert 지면반사 POA |
| `solarZenithDegUsed` | deg | 세계 태양벡터에서 유도해 실제 사용한 천정각 |
| `solarZenithMismatchDeg` | deg | 입력 천정각 − 실제 사용 천정각 |
| `ghiClosure` | — | 폐합 재구성값·잔차·상대잔차·판정 |

호환 필드 `beamWm2`, `skyDiffuseWm2`, `groundReflectedWm2`, `incidenceAngleModifier`는 유지된다. 각각 새 canonical 필드와 같은 값이다.

### `IrradianceComponents`

`ghiClosure`가 추가되었다. `checkGHIClosure()`를 직접 호출할 수도 있다. 이 검사는 입력값을 수정하지 않는다.

### `InstantSimulationResult`

- `effectivePoaWm2`: `poa.totalWm2`에서 오염 손실만 차감한 전기 모델 입력
- `panelFrame.normal`: 회전 후 정규화 세계법선
- `panelFrame.sampleAxisU`, `panelFrame.sampleAxisV`: 법선과 동일 회전을 받은 면내 ray sampling 축

`simpleDcPower()`와 단일 다이오드 모델은 `effectivePoaWm2`를 직접 사용한다. `etaCos`나 IAM을 다시 곱하지 않는다.

### 패널 회전 입력 의미

`panel.normal`과 `panel.sampleAxisU`는 `rotation`이 있으면 회전 전 body frame 값이다. 이미 세계좌표로 변환한 위치·quaternion·법선·sampling 축을 전달할 때는 `rotation`을 다시 전달하지 않아야 한다. quaternion과 명시적 법선/축을 함께 전달한다면 서로 같은 pose에서 유도된 값이어야 하며, 불일치 값을 섞어 권위값으로 사용해서는 안 된다.

## POA 성분의 경계

\[
G_{POA}=G_{direct,POA}+G_{diffuse,POA}+G_{ground,POA}
\]

- 단면 패널에서 `n̂·ŝ≤0`이면 `etaCos=0`, 직달 POA는 정확히 0이다.
- 현재 IAM은 직달 성분에 적용한다. Hay–Davies 산란 및 지면반사에 별도 diffuse IAM은 적용하지 않는다.
- diffuse visibility와 ground visibility는 각각 별도 입력이다.
- 태양이 지평선 아래면 모든 POA와 DC/AC 출력은 0이다.
- 브라우저 실시간 코어는 Perez 전천돔 적분 대신 Hay–Davies 또는 등방 모델을 사용한다.

## 자동 회귀 검사

`tests/physics.test.ts`의 `incident-angle diagnosis contract 1-10`이 다음을 고정한다.

1. DNI 1000, DHI 0, AOI 0°에서 `etaCos=1`, `IAM=1`, 직달 1000 W/m²
2. AOI 60°에서 `etaCos=0.5`, 직달 `500×IAM(60°)`
3. AOI 90°에서 직달 0
4. AOI 90° 초과 단면에서 직달 0
5. 수평패널·태양고도 30°에서 AOI 60°, IAM off 직달 500 W/m²
6. 동일 DNI에서 태양방향/AOI가 바뀌면 출력 변화
7. 동일 AOI에서 직달 출력이 DNI에 선형 비례
8. `GHI=DNI cos(zenith)+DHI` 폐합과 불일치 탐지
9. POA 코사인 손실 뒤 simple 및 single-diode DC가 각도손실을 재적용하지 않음
10. +Y 회전 전후 법선·sampling U/V 축이 동일 변환을 사용

실행 명령과 결과:

```text
npx.cmd vitest run tests/physics.test.ts --config src/lib/physics/vitest.config.ts
Test Files  1 passed
Tests       30 passed
```

## 통합 시 주의점

- UI는 `etaCos`, `iamFactor`, `etaAngle`을 결과에서 읽어 표시하고 자체적으로 재계산하지 않는다.
- UI/worker는 전기 입력으로 `effectivePoaWm2`만 전달한다. `cos(AOI)`나 IAM을 추가 적용하지 않는다.
- ray sampling origin을 만들 때 `panelFrame.sampleAxisU/V`를 사용해야 한다.
- `ghiClosure.isClosed=false`이면 원자료 provenance와 잔차를 경고로 표시하되, 사용자가 선택하지 않은 보정 정책으로 원자료를 자동 변경하지 않는다.
- `solarZenithMismatchDeg`가 허용오차를 넘으면 태양벡터와 스칼라 천정각을 서로 다른 시점/좌표계에서 만든 것인지 점검한다.

## 기술 근거

- [NREL Solar Position Algorithm](https://midcdmz.nrel.gov/spa/)
- [Sandia PVPMC: Plane-of-array irradiance](https://pvpmc.sandia.gov/modeling-guide/1-weather-design-inputs/plane-of-array-poa-irradiance/)
- [Sandia PVPMC: ASHRAE IAM](https://pvpmc.sandia.gov/modeling-guide/1-weather-design-inputs/shading-soiling-and-reflection-losses/incident-angle-reflection-losses/ashrae-iam-model/)
- [Sandia PVPMC: Physical IAM](https://pvpmc.sandia.gov/modeling-guide/1-weather-design-inputs/shading-soiling-and-reflection-losses/incident-angle-reflection-losses/physical-iam-model/)
- [pvlib: Haurwitz clear-sky GHI](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.clearsky.haurwitz.html)
- [pvlib: Erbs GHI decomposition](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.irradiance.erbs.html)
- [Sandia SAND2012-2389](https://www.sandia.gov/research/publications/details/global-horizontal-irradiance-clear-sky-models-implementation-and-analysis-2012-03-01/)
