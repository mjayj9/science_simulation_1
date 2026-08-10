# 검증 결과

검증일: 2026-08-10 (Asia/Seoul)

## 자동 검증

| 검사 | 결과 |
|---|---:|
| `npm run typecheck` | 통과 |
| `npm run lint` | 통과 |
| Vitest 물리·형상·저장·기상·worker | 35/35 통과 |
| vinext 배포 빌드 | 통과 |
| 빌드된 worker 서버 렌더 제품 스모크 | 2/2 통과 |
| `npm audit --omit=dev --audit-level=high` | 런타임 취약점 0건 |

`npm test`는 단위 테스트, 배포 빌드, 빌드 결과의 한국어 제품 셸 스모크를 연속 실행해 모두 통과했다. 로컬 개발 서버는 `/`에 HTTP 200을 반환했고 한국어 `3D 조립` 셸과 요청 호스트 기반 OG 메타데이터를 포함했다.

## 공학 계약 범위

테스트는 0.5W 단일 패널, 20패널 10W, 야간·뒷면 0, 코사인/IAM, 선택 장애물 ray 차폐, 부분음영 바이패스, RPM=0, 고RPM 수렴, 사다리꼴 적분, seed 결정성, API 실패 fallback, V1→V3 저장 round-trip, 1~5 형상/100패널, 모델 레지스트리 trace, 연간 worker 물리·월 경계·취소·stale fingerprint를 포함한다.

태양 위치는 NREL 2003 SPA 기준 사례를 축약 NOAA/Meeus 코어의 공개 허용오차로 비교한다. 이 구현은 완전한 SPA 다주기 급수나 인증 정확도를 주장하지 않는다.

## 빌드 참고

클라이언트의 Three.js, React Flow, Recharts가 제품 화면에 함께 포함되어 minified chunk 500kB 경고가 발생한다. 오류는 아니며 빌드는 성공했다. 비교 viewport는 `fast` 품질, 연간 계산은 별도 worker로 실행해 상호작용 중 메인 스레드 정지를 줄인다. 런타임 의존성 감사는 0건이지만 개발·빌드 도구의 전이 의존성 경고에는 강제 major 업데이트를 적용하지 않았다.

모델 적용 범위와 남은 차이는 [알려진 한계](known-limitations.md)를 기준으로 해석한다.
