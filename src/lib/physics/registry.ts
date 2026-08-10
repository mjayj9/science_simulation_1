import type { ModelDescriptor } from "./types";

export const MODEL_REGISTRY = [
  {
    id: "solar.noaa-spa-compatible",
    version: "1.0.0",
    titleKo: "태양 위치 (NOAA/Meeus, SPA 규약)",
    expression: "천문력 → topocentric αs, γs; s=(cosα sinγ, sinα, cosα cosγ)",
    variables: [
      { symbol: "αs", labelKo: "태양 고도각", unit: "deg" },
      { symbol: "γs", labelKo: "태양 방위각", unit: "deg" },
    ],
    sourceUrls: ["https://midcdmz.nrel.gov/spa/", "https://docs.nrel.gov/docs/fy08osti/34302.pdf"],
    assumptionsKo: ["진북 0°, 동쪽으로 증가", "브라우저용 축약 천문력"],
    limitationsKo: ["완전한 SPA 다주기 급수 구현보다 정확도가 낮음"],
  },
  {
    id: "irradiance.erbs",
    version: "1.0.0",
    titleKo: "Erbs GHI 분해",
    expression: "kt=GHI/(Ea cosθz), DHI=kd(kt)GHI, DNI=(GHI-DHI)/cosθz",
    variables: [
      { symbol: "GHI", labelKo: "수평면 전천일사", unit: "W/m²" },
      { symbol: "DNI", labelKo: "직달법선일사", unit: "W/m²" },
      { symbol: "DHI", labelKo: "수평면 산란일사", unit: "W/m²" },
    ],
    sourceUrls: ["https://pvpmc.sandia.gov/modeling-guide/1-weather-design-inputs/irradiance-insolation/direct-normal-irradiance/piecewise-decomposition-models/"],
    assumptionsKo: ["시간평균 GHI"],
    limitationsKo: ["태양 천정각 87° 이상에서는 DNI를 분해하지 않음"],
  },
  {
    id: "poa.hay-davies",
    version: "1.0.0",
    titleKo: "POA 직달·Hay-Davies 산란·지면반사",
    expression: "GPOA=VDNI max(0,n·s)IAM + DHI[AiRb+(1-Ai)(1+cosβ)/2] + ρgGHI(1-cosβ)/2",
    variables: [
      { symbol: "V", labelKo: "직달 가시율", unit: "1" },
      { symbol: "β", labelKo: "패널 기울기", unit: "deg" },
      { symbol: "ρg", labelKo: "지면 반사율", unit: "1" },
    ],
    sourceUrls: ["https://pvpmc.sandia.gov/modeling-guide/1-weather-design-inputs/plane-of-array-poa-irradiance/"],
    assumptionsKo: ["지면은 Lambert 반사체", "태양은 평행광"],
    limitationsKo: ["다중 반사와 3D 대기 산란을 생략"],
  },
  {
    id: "iam.physical-ashrae",
    version: "1.0.0",
    titleKo: "입사각 반사 손실",
    expression: "IAMphysical=τ(θ)/τ(0) 또는 IAMASHRAE=1-b0(secθ-1)",
    variables: [{ symbol: "θ", labelKo: "입사각", unit: "deg" }],
    sourceUrls: [
      "https://pvpmc.sandia.gov/modeling-guide/1-weather-design-inputs/shading-soiling-and-reflection-losses/incident-angle-reflection-losses/physical-iam-model/",
      "https://pvpmc.sandia.gov/modeling-guide/1-weather-design-inputs/shading-soiling-and-reflection-losses/incident-angle-reflection-losses/ashrae-iam-model/",
    ],
    assumptionsKo: ["전면 유리 모듈"],
    limitationsKo: ["ASHRAE 식은 큰 입사각에서 정확도가 낮음"],
  },
  {
    id: "thermal.faiman",
    version: "1.0.0",
    titleKo: "Faiman 모듈 온도",
    expression: "Tm=Ta+GPOA/(U0+U1WS)",
    variables: [
      { symbol: "Tm", labelKo: "모듈 온도", unit: "°C" },
      { symbol: "WS", labelKo: "모듈 높이 풍속", unit: "m/s" },
    ],
    sourceUrls: ["https://pvpmc.sandia.gov/modeling-guide/2-dc-module-iv/module-temperature/faiman-module-temperature-model/"],
    assumptionsKo: ["정상상태", "기본 U0=25, U1=6.84"],
    limitationsKo: ["열용량과 야간 장파 과냉각을 생략"],
  },
  {
    id: "wind.log-profile",
    version: "1.0.0",
    titleKo: "로그 높이별 풍속",
    expression: "U(z)=Uref ln((z-d)/z0)/ln((zref-d)/z0)",
    variables: [
      { symbol: "z0", labelKo: "거칠기 길이", unit: "m" },
      { symbol: "d", labelKo: "변위 높이", unit: "m" },
    ],
    sourceUrls: ["https://wasp.dtu.dk/support/frequently-asked-questions/wasp-faq/Wind-shear-exponents"],
    assumptionsKo: ["중립 표면층"],
    limitationsKo: ["안정도·복잡지형·도시협곡을 생략"],
  },
  {
    id: "pv.single-diode-desoto",
    version: "1.0.0",
    titleKo: "De Soto 단일 다이오드",
    expression: "I=IL-I0[exp((V+IRs)/a)-1]-(V+IRs)/Rsh",
    variables: [
      { symbol: "IL", labelKo: "광전류", unit: "A" },
      { symbol: "I0", labelKo: "포화전류", unit: "A" },
      { symbol: "Rs", labelKo: "직렬저항", unit: "Ω" },
      { symbol: "Rsh", labelKo: "병렬저항", unit: "Ω" },
    ],
    sourceUrls: ["https://pvpmc.sandia.gov/modeling-guide/2-dc-module-iv/single-diode-equivalent-circuit-models/"],
    assumptionsKo: ["정상상태 단접합 PV"],
    limitationsKo: ["셀 역항복과 hotspot 열해석을 생략"],
  },
  {
    id: "pv.simple",
    version: "1.0.0",
    titleKo: "단순 면적·효율 DC 모델",
    expression: "Pdc=AηGPOA[1+γ(Tm-Tref)]",
    variables: [{ symbol: "η", labelKo: "변환 효율", unit: "1" }],
    sourceUrls: ["https://pvwatts.nrel.gov/version_8.php"],
    assumptionsKo: ["MPP를 즉시 유지"],
    limitationsKo: ["I-V와 부분음영 불일치를 직접 표현하지 않음"],
  },
  {
    id: "circuit.series-parallel-bypass",
    version: "1.0.0",
    titleKo: "직렬·병렬·바이패스 결합",
    expression: "series: V=ΣVj(I), parallel: I=ΣIj(V), bypass: Vj≥-Vf",
    variables: [{ symbol: "Vf", labelKo: "바이패스 순방향 전압", unit: "V" }],
    sourceUrls: ["https://pvpmc.sandia.gov/modeling-guide/3-dc-array-iv/"],
    assumptionsKo: ["직렬 공통전류·병렬 공통전압"],
    limitationsKo: ["바이패스 열특성과 avalanche를 생략"],
  },
  {
    id: "inverter.pvwatts-v5",
    version: "1.0.0",
    titleKo: "PVWatts V5 인버터",
    expression: "η=ηnom/0.9637(-0.0162ζ-0.0059/ζ+0.9858), Pac=min(Pac0,ηPdc)",
    variables: [{ symbol: "ζ", labelKo: "DC 부하율", unit: "1" }],
    sourceUrls: ["https://pvwatts.nrel.gov/downloads/pvwattsv5.pdf"],
    assumptionsKo: ["대표 부분부하 효율곡선"],
    limitationsKo: ["PVWatts V8 상세 인버터와 동일하지 않음"],
  },
  {
    id: "rotation.drag-rigid-body",
    version: "1.0.0",
    titleKo: "세로축 강체 회전",
    expression: "Iz dω/dt=Σ(r×F)·ŷ-bω-τc sign(ω), F=ρCdA|Urel|Urel/2",
    variables: [
      { symbol: "ω", labelKo: "각속도", unit: "rad/s" },
      { symbol: "Iz", labelKo: "관성모멘트", unit: "kg·m²" },
    ],
    sourceUrls: ["https://www.grc.nasa.gov/www/k-12/VirtualAero/BottleRocket/airplane/drageq.html"],
    assumptionsKo: ["준정상 항력", "공통 +Y 회전축"],
    limitationsKo: ["CFD, lift, dynamic stall, wake 상호작용을 생략"],
  },
  {
    id: "integration.trapezoid",
    version: "1.0.0",
    titleKo: "시간-전력 사다리꼴 적분",
    expression: "E=Σ(Pk+Pk+1)Δt/2",
    variables: [{ symbol: "E", labelKo: "전기에너지", unit: "Wh" }],
    sourceUrls: ["https://dlmf.nist.gov/3.5"],
    assumptionsKo: ["입력 전력은 순간 표본"],
    limitationsKo: ["불연속 구간은 시간격자 수렴 확인 필요"],
  },
] as const satisfies readonly ModelDescriptor[];

export const MODEL_BY_ID: ReadonlyMap<string, ModelDescriptor> = new Map(
  MODEL_REGISTRY.map((descriptor) => [descriptor.id, descriptor]),
);

export function getModelDescriptor(id: string): ModelDescriptor {
  const descriptor = MODEL_BY_ID.get(id);
  if (!descriptor) throw new RangeError(`Unknown physics model: ${id}`);
  return descriptor;
}
