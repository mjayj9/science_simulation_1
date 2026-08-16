# 솔라폼 엔지니어링 랩

한국어 PC 환경을 우선한 Three.js 기반 3D 태양광 형상 비교 시뮬레이터입니다. 공식 비교 경로는 평면·정육면체·원기둥·구·반구·원뿔을 각각 하나의 빈틈없는 연속 PV 스킨으로 만들고, 동일한 수평 투영면적과 최대높이 안에서 광학·열·회전·AC 에너지를 비교합니다. 이산 패널 조립과 회로 편집은 별도의 설계 탐색 경로로 유지됩니다.

이 앱은 설계안 비교와 모델 탐색을 위한 공학 도구입니다. 인증 발전량 예측, 구조 안전 검토, 계통연계 승인 또는 금융성 평가를 대신하지 않습니다. 모델별 가정은 [공식과 출처](docs/formulas-and-sources.md), 현재 구현 한계는 [알려진 한계](docs/known-limitations.md)에 정리되어 있습니다.

## 주요 기능

- 기본 `A_land=0.050 m²`, `H_max=2√(A_land/π)`의 여섯 형상 공정 비교
- 연속 PV 스킨의 해석 활성면적과 면적가중 표본 적분 (`ΣΔA=A_PV`)
- 절대 AC, `kWh/m²-land`, `kWh/m²-PV`, 높이·면적지수·표면온도 선행 진단
- 정지·고정 RPM·월별 평균풍속 토크평형 회전, 시간가중 연평균, swept-footprint 제약과 모터 손실 원장
- 실제 기상 시계열에서 고른 서울 계절·대표일 및 재료좌표 과도 열이력
- Myers 2010, Bernardi 2012, El-Atab 2020, Almadhhachi et al. 2024 연구 조건 감사
- 20개 이산 패널 기본 프리셋과 1~20개 패널 자유 조립(설계 탐색 경로)
- 1~20개 패널 자유 조립, 이동·회전·복제·삭제, 격자/표면 스냅, 겹침 검사
- OrbitControls, TransformControls, GLB/GLTF 불러오기와 전면 법선/태양 광선 표시
- 렌더링 그림자와 분리된 다점 ray 차폐율
- 자동/수동 태양 위치, GHI/DNI/DHI, 날씨 프리셋과 재현 가능한 seed
- Faiman 온도, 단일 다이오드/PVWatts형 DC, 직렬·병렬·바이패스 회로, PVWatts V5 인버터
- 순간·일간·월간·연간 결과, 여섯 형상 비교, 원기둥 윗면/옆면 기여도
- 브라우저 자동 저장, 버전 3 JSON, CSV와 차트 PNG 내보내기
- 공식·단위·현재 중간값·출처·한계를 보여주는 패널별 계산 추적

주요 화면은 `3D 조립`, `환경 편집`, `회로 편집`, `시뮬레이션`, `다중 형상 비교`, `공식 · 근거`, `데이터 내보내기`입니다. 권장 최소 화면 폭은 1280px입니다.

## 요구 환경

- Node.js `>=22.13.0 <25.0.0` (배포 시 고정 버전은 [`.node-version`](.node-version))
- WebGL 2와 Web Worker를 지원하는 최신 데스크톱 브라우저
- npm

## 설치와 실행

```bash
npm install
npm run dev
```

개발 서버가 출력한 로컬 주소를 브라우저에서 엽니다. 배포용 결과는 다음 명령으로 검증합니다.

```bash
npm run build
npm run start
```

## 기본 사용 흐름

1. 시작 화면인 `다중 형상 비교`에서 `A_land`, 공식 `H_max`, 평면 경사와 여섯 형상의 면적 진단을 확인합니다.
2. 정지·고정 RPM·환경 평균 RPM과 장애물 포함 여부를 명시하고 연간 계산을 실행합니다.
3. 순위 원인, 계절 대표일, 과도 표면온도와 연구 A–D 조건 감사를 확인합니다.
4. 필요하면 `환경 편집`에서 Open-Meteo 모델 자료를 조회하거나 PVGIS/NASA JSON을 가져옵니다.
5. 이산 패널·회로를 탐색할 때만 `3D 조립`과 `회로 편집` 경로를 사용합니다.
6. `데이터 내보내기`에서 프로젝트 JSON, 결과 CSV 또는 그래프 PNG를 저장합니다.

모든 내부 길이·시간·전력 계산은 SI 단위를 사용합니다. 방위각은 진북 0°, 동쪽 90°이고 월드 좌표는 `+X=동`, `+Y=상`, `+Z=북`입니다.

## 기상 데이터와 오프라인 동작

- Open-Meteo: 현재·예보 모델 자료를 브라우저에서 조회합니다. 관측소 실측으로 표시하지 않습니다.
- PVGIS 5.3: JRC의 CORS 정책 때문에 정적 앱에서 응답을 직접 읽지 않고 공식 URL로 받은 JSON 파일을 가져옵니다.
- NASA POWER: 장기 위성·재분석 자료의 URL/JSON 보조 경로입니다.
- 네트워크 또는 응답 스키마 실패: 같은 위치·시간·seed에서 재현되는 오프라인 맑은하늘/날씨 프리셋으로 전환하고 결과 provenance에 실패 이유를 남깁니다.

자세한 필드, 시간 의미와 출처 배지는 [기상 데이터 소스](docs/data-sources.md)를 참고하세요. 비밀 API 키는 클라이언트 번들에 포함하지 않습니다.

## 저장과 파일

- 현재 프로젝트는 사용자가 요구한 기기 로컬 동작에 따라 브라우저 저장소에 자동 저장됩니다.
- 저장 데이터는 다른 기기나 브라우저 프로필과 자동 동기화되지 않습니다. 중요한 시나리오는 JSON으로 내보내세요.
- V1과 V2 JSON은 순차 마이그레이션 후 V3 스키마로 검증합니다. 더 새로운 버전과 잘못된 참조·NaN·범위 초과 값은 거부합니다.
- 브라우저 보안상 원래 로컬 파일 경로를 보존할 수 없습니다. GLB/GLTF 프로젝트를 다른 기기에서 열 때 파일 재연결이 필요할 수 있습니다.
- `.openai/hosting.json`의 D1/R2는 사용하지 않습니다. 향후 계정 기반 동기화를 추가할 때만 플랫폼 저장소를 설계합니다.

## 테스트

```bash
npm run test:unit   # 순수 물리·형상·저장·기상·worker 계약
npm run typecheck   # 전체 TypeScript 검사
npm run lint        # 정적 코드 검사
npm test            # 단위 테스트 → 배포 빌드 → 서버 렌더 제품 스모크 테스트
```

루트 `vitest.config.ts`는 배포용 `vite.config.ts`와 테스트 그래프를 분리합니다. 제품 스모크 테스트는 빌드된 서버 엔트리가 한국어 UI와 제품 제목을 서버 렌더하는지, 일회용 스타터 스켈레톤이 남지 않았는지, 그리고 엔트리의 모양과 배포 산출물이 선택한 `DEPLOY_TARGET`과 일치하는지 확인합니다.

핵심 자동 검증에는 여섯 형상의 면적지수·높이·활성면적, swept footprint, 구의 직달 투영 항등식, 회전 광학 불변성, 토크평형 RPM, 무장치 축대칭 RPM 0, 모터 AC 차감, 과도 열 에너지 보존·시간간격 수렴, 계절 선택, 연구 프리셋 격리, worker cache/stale 차단이 포함됩니다. 기존 패널·회로·기상·저장 회귀도 함께 실행됩니다.

## 코드 구조

```text
app/                    vinext 페이지, 메타데이터, 전역 스타일
build/                  배포 대상 선택과 Sites 패키징 Vite 플러그인
src/ui/                 한국어 제품 UI, Three.js 작업공간, 회로 캔버스
src/lib/physics/        태양·복사·준정상/과도 열·PV·회로·인버터·회전 코어
src/lib/geometry/       연속 비교 표면, 형상 프리셋, OBB, ray visibility
src/lib/compare/        정규화·평면 경사 최적화·계절 대표기간 선택
src/lib/research/       연구 A–D 출처 조건과 재현 감사 계약
src/lib/weather/        Open-Meteo/PVGIS/NASA/오프라인 어댑터
src/lib/project/        V3 스키마, V1→V2→V3 마이그레이션, 저장
src/workers/            계산 worker protocol, progress, cancel, kernel
docs/                   조사, 아키텍처, 공식, 형상과 한계
tests/                  Vitest 공학 계약과 빌드 후 HTML 스모크 테스트
```

구조와 데이터 흐름은 [아키텍처](docs/architecture.md), 프리셋 치수는 [형상 프리셋](docs/geometry-presets.md), 원문 정성자료의 해석은 [첨부 글 분석](docs/reference-article-analysis.md)을 참고하세요.

마지막 자동 검사와 빌드 결과는 [검증 결과](docs/validation-report.md)에 기록되어 있습니다.

## 배포

이 앱은 React Server Components로 서버 렌더링되므로 **정적 사이트로 호스팅할 수 없습니다**. 빌드 산출물에 `index.html`이 없고, 페이지 셸을 만들어 주는 Node 서버가 항상 떠 있어야 합니다. 물리 계산 자체는 브라우저의 Web Worker에서 돌기 때문에 서버는 계산 부하를 지지 않습니다.

빌드 대상은 `DEPLOY_TARGET` 환경변수가 결정하며 기본값은 `node`입니다. 두 대상은 서로 호환되지 않는 서버 엔트리를 만들기 때문에 값을 하나만 고르며, 알 수 없는 값은 빌드 시작 전에 예외를 던집니다.

| `DEPLOY_TARGET` | `dist/server/index.js` | 실행 방법 |
|---|---|---|
| `node` (기본) | `(request) => Response` 핸들러 | `node dist/standalone/server.js` 또는 `npm start` |
| `cloudflare` | `{ fetch(request, env, ctx) }` Worker 모듈 | `npx @vinext/cloudflare deploy` |

### Render

저장소 루트의 [`render.yaml`](render.yaml)이 블루프린트입니다. Render 대시보드에서 이 저장소를 연결하면 그대로 읽습니다.

```text
buildCommand: npm ci --include=dev && npm run build
startCommand: node dist/standalone/server.js
```

- `--include=dev`는 생략할 수 없습니다. Vite·vinext·TypeScript가 모두 `devDependencies`에 있고, Render는 `NODE_ENV=production`으로 설치를 돌릴 수 있어 그대로 두면 빌드가 실패합니다.
- 실행에 쓰는 `dist/standalone/`은 필요한 런타임 패키지를 자체 `node_modules`에 복사해 갖고 있습니다. 따라서 빌드 후 dev 패키지가 정리되더라도 서비스는 뜹니다.
- `dist/standalone/server.js`는 `PORT`를 읽고 `0.0.0.0`에 바인딩합니다. Render의 요구사항과 그대로 맞습니다. 바인드 주소를 바꾸려면 `HOST`를 씁니다(Next.js standalone의 `HOSTNAME`이 아닙니다).
- Node 버전은 [`.node-version`](.node-version)이 고정합니다.
- `plan: free`로 되어 있습니다. 무료 인스턴스는 메모리가 작아 Three.js를 포함한 클라이언트 번들 빌드에서 실패할 수 있습니다. 빌드가 메모리 부족으로 죽으면 `starter` 이상으로 올리세요.

### 그 밖의 Node 호스트

`render.yaml`에 묶인 것은 없습니다. 같은 두 명령이면 어디서든 동작합니다.

```bash
npm ci --include=dev
npm run build
node dist/standalone/server.js   # PORT, HOST 환경변수를 읽습니다
```

### Cloudflare Workers

이전 배포 경로도 그대로 남아 있습니다.

```bash
npm run build:cloudflare
npx @vinext/cloudflare deploy
```

이 대상에서는 `worker/index.ts`가 엔트리가 되고 `dist/server/wrangler.json`이 생성되며, `dist/standalone/`은 만들지 않습니다.

### 배포 전 확인

`npm test`가 모두 통과해야 합니다. 스모크 테스트는 빌드된 엔트리의 모양이 선택한 대상과 일치하는지, `node` 대상이면 `render.yaml`이 실행하는 standalone 번들이 실제로 생성됐는지까지 확인합니다.

외부 기상 호출은 브라우저에서 이루어지므로 실제 배포 origin의 CORS와 네트워크 정책은 별도로 스모크 테스트하세요. 실패하면 앱은 오프라인 모델 추정값으로 전환하고 그 이유를 provenance에 남깁니다. 사용자 쪽은 WebGL 2와 Web Worker를 지원하는 데스크톱 브라우저여야 하며 권장 최소 화면 폭은 1280px입니다.
