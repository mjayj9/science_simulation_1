import { DEG2RAD, RAD2DEG, clamp } from "./types";
import type { Vec3 } from "./types";
import { dot, normalize } from "./vector";

export interface ErbsInput {
  ghiWm2: number;
  solarZenithDeg: number;
  extraterrestrialNormalWm2?: number;
}

export interface IrradianceComponents {
  ghiWm2: number;
  dniWm2: number;
  dhiWm2: number;
  clearnessIndex: number;
  diffuseFraction: number;
}

export function erbsDecomposition(input: ErbsInput): IrradianceComponents {
  const ghi = Math.max(0, input.ghiWm2);
  const cosineZenith = Math.cos(input.solarZenithDeg * DEG2RAD);
  const extraterrestrial = input.extraterrestrialNormalWm2 ?? 1361;
  if (ghi <= 0 || cosineZenith <= Math.cos(87 * DEG2RAD)) {
    return {
      ghiWm2: ghi,
      dniWm2: 0,
      dhiWm2: ghi,
      clearnessIndex: 0,
      diffuseFraction: ghi > 0 ? 1 : 0,
    };
  }
  const kt = clamp(ghi / (extraterrestrial * cosineZenith), 0, 1.5);
  let kd: number;
  if (kt <= 0.22) {
    kd = 1 - 0.09 * kt;
  } else if (kt <= 0.8) {
    kd =
      0.9511 -
      0.1604 * kt +
      4.388 * kt ** 2 -
      16.638 * kt ** 3 +
      12.336 * kt ** 4;
  } else {
    kd = 0.165;
  }
  const dhi = clamp(kd * ghi, 0, ghi);
  const dni = Math.max(0, (ghi - dhi) / cosineZenith);
  return { ghiWm2: ghi, dniWm2: dni, dhiWm2: dhi, clearnessIndex: kt, diffuseFraction: kd };
}

export type IAMConfig =
  | { model: "none" }
  | { model: "ashrae"; b0?: number }
  | { model: "physical"; refractiveIndex?: number; extinctionCoefficientM1?: number; glazingThicknessM?: number };

export function ashraeIAM(angleOfIncidenceDeg: number, b0 = 0.05): number {
  if (angleOfIncidenceDeg < 0 || angleOfIncidenceDeg >= 90) return 0;
  if (angleOfIncidenceDeg < 1e-10) return 1;
  const cosine = Math.cos(angleOfIncidenceDeg * DEG2RAD);
  return clamp(1 - b0 * (1 / cosine - 1), 0, 1);
}

function opticalTransmittance(
  angleRad: number,
  refractiveIndex: number,
  extinctionCoefficientM1: number,
  glazingThicknessM: number,
): number {
  if (Math.abs(angleRad) < 1e-9) {
    return (
      Math.exp(-extinctionCoefficientM1 * glazingThicknessM) *
      (1 - ((1 - refractiveIndex) / (1 + refractiveIndex)) ** 2)
    );
  }
  const refracted = Math.asin(clamp(Math.sin(angleRad) / refractiveIndex, -1, 1));
  const sinDenominator = Math.sin(refracted + angleRad);
  const tanDenominator = Math.tan(refracted + angleRad);
  if (Math.abs(sinDenominator) < 1e-12 || Math.abs(tanDenominator) < 1e-12) return 0;
  const fresnel =
    1 -
    0.5 *
      ((Math.sin(refracted - angleRad) / sinDenominator) ** 2 +
        (Math.tan(refracted - angleRad) / tanDenominator) ** 2);
  return (
    Math.exp(-extinctionCoefficientM1 * glazingThicknessM / Math.cos(refracted)) * fresnel
  );
}

export function physicalIAM(
  angleOfIncidenceDeg: number,
  refractiveIndex = 1.526,
  extinctionCoefficientM1 = 4,
  glazingThicknessM = 0.002,
): number {
  if (angleOfIncidenceDeg < 0 || angleOfIncidenceDeg >= 90) return 0;
  const normal = opticalTransmittance(
    0,
    refractiveIndex,
    extinctionCoefficientM1,
    glazingThicknessM,
  );
  if (!(normal > 0)) return 0;
  return clamp(
    opticalTransmittance(
      angleOfIncidenceDeg * DEG2RAD,
      refractiveIndex,
      extinctionCoefficientM1,
      glazingThicknessM,
    ) / normal,
    0,
    1,
  );
}

export function incidenceAngleModifier(angleOfIncidenceDeg: number, config: IAMConfig = { model: "ashrae" }): number {
  switch (config.model) {
    case "none":
      return angleOfIncidenceDeg >= 0 && angleOfIncidenceDeg < 90 ? 1 : 0;
    case "physical":
      return physicalIAM(
        angleOfIncidenceDeg,
        config.refractiveIndex,
        config.extinctionCoefficientM1,
        config.glazingThicknessM,
      );
    case "ashrae":
      return ashraeIAM(angleOfIncidenceDeg, config.b0);
  }
}

export interface POAInput {
  ghiWm2: number;
  dniWm2: number;
  dhiWm2: number;
  solarZenithDeg: number;
  sunDirection: Vec3;
  panelNormal: Vec3;
  visibility?: number;
  albedo?: number;
  iam?: IAMConfig;
  diffuseModel?: "hay-davies" | "isotropic";
  extraterrestrialNormalWm2?: number;
  diffuseVisibility?: number;
  groundVisibility?: number;
}

export interface POAResult {
  beamWm2: number;
  skyDiffuseWm2: number;
  groundReflectedWm2: number;
  totalWm2: number;
  angleOfIncidenceDeg: number;
  panelTiltDeg: number;
  incidenceAngleModifier: number;
  directVisibility: number;
  cosineIncidence: number;
}

export function calculatePOA(input: POAInput): POAResult {
  const panelNormal = normalize(input.panelNormal);
  const sunDirection = normalize(input.sunDirection);
  const cosineIncidence = clamp(dot(panelNormal, sunDirection), -1, 1);
  const angleOfIncidenceDeg = Math.acos(cosineIncidence) * RAD2DEG;
  const panelTiltDeg = Math.acos(clamp(panelNormal.y, -1, 1)) * RAD2DEG;
  const visibility = clamp(input.visibility ?? 1, 0, 1);
  const diffuseVisibility = clamp(input.diffuseVisibility ?? 1, 0, 1);
  const groundVisibility = clamp(input.groundVisibility ?? 1, 0, 1);
  const iam = incidenceAngleModifier(angleOfIncidenceDeg, input.iam);
  const daylight = input.solarZenithDeg < 90 && sunDirection.y > 0;
  const beam = daylight
    ? Math.max(0, input.dniWm2) * Math.max(0, cosineIncidence) * visibility * iam
    : 0;

  const tilt = panelTiltDeg * DEG2RAD;
  const isotropicView = (1 + Math.cos(tilt)) / 2;
  let skyDiffuse: number;
  if (!daylight || input.dhiWm2 <= 0) {
    skyDiffuse = 0;
  } else if ((input.diffuseModel ?? "hay-davies") === "isotropic") {
    skyDiffuse = input.dhiWm2 * isotropicView;
  } else {
    const cosineZenith = Math.max(Math.cos(85 * DEG2RAD), Math.cos(input.solarZenithDeg * DEG2RAD));
    const rb = Math.max(0, cosineIncidence) / cosineZenith;
    const anisotropy = clamp(
      Math.max(0, input.dniWm2) / (input.extraterrestrialNormalWm2 ?? 1361),
      0,
      1,
    );
    skyDiffuse = input.dhiWm2 * (anisotropy * rb + (1 - anisotropy) * isotropicView);
  }
  skyDiffuse = Math.max(0, skyDiffuse) * diffuseVisibility;
  const groundReflected =
    daylight
      ? Math.max(0, input.ghiWm2) *
        clamp(input.albedo ?? 0.2, 0, 1) *
        ((1 - Math.cos(tilt)) / 2) *
        groundVisibility
      : 0;
  const total = beam + skyDiffuse + groundReflected;
  return {
    beamWm2: beam,
    skyDiffuseWm2: skyDiffuse,
    groundReflectedWm2: groundReflected,
    totalWm2: total,
    angleOfIncidenceDeg,
    panelTiltDeg,
    incidenceAngleModifier: iam,
    directVisibility: visibility,
    cosineIncidence,
  };
}
