import { clamp } from "./types";

export interface InverterConfig {
  ratedAcPowerW: number;
  nominalEfficiency: number;
  mpptMinVoltageV: number;
  mpptMaxVoltageV: number;
  maxDcVoltageV: number;
  maxInputCurrentA: number;
  startPowerW: number;
  nightConsumptionW: number;
  wiringLossFraction: number;
}

export const DEFAULT_INVERTER: Readonly<InverterConfig> = Object.freeze({
  ratedAcPowerW: 10,
  nominalEfficiency: 0.96,
  mpptMinVoltageV: 0,
  mpptMaxVoltageV: 1000,
  maxDcVoltageV: 1200,
  maxInputCurrentA: 100,
  startPowerW: 0,
  nightConsumptionW: 0,
  wiringLossFraction: 0,
});

export interface InverterInput {
  dcPowerW: number;
  dcVoltageV?: number;
  dcCurrentA?: number;
  config?: InverterConfig;
}

export interface InverterResult {
  acceptedDcPowerW: number;
  acPowerW: number;
  grossAcPowerW: number;
  efficiency: number;
  clippingLossW: number;
  wiringLossW: number;
  standbyConsumptionW: number;
  status: "off" | "running" | "clipped" | "mppt-voltage-limited" | "over-voltage" | "current-limited";
}

export function pvWattsV5Efficiency(loadRatio: number, nominalEfficiency = 0.96): number {
  if (!(loadRatio > 0)) return 0;
  const referenceEfficiency = 0.9637;
  return clamp(
    nominalEfficiency / referenceEfficiency *
      (-0.0162 * loadRatio - 0.0059 / loadRatio + 0.9858),
    0,
    1,
  );
}

export function calculateInverter(input: InverterInput): InverterResult {
  const config = input.config ?? DEFAULT_INVERTER;
  const requestedDc = Math.max(0, input.dcPowerW);
  const voltage = input.dcVoltageV;
  const current = input.dcCurrentA;
  const wiringLossW = requestedDc * clamp(config.wiringLossFraction, 0, 1);
  let acceptedDcPowerW = Math.max(0, requestedDc - wiringLossW);
  let status: InverterResult["status"] = "running";

  if (voltage !== undefined && voltage > config.maxDcVoltageV) {
    return {
      acceptedDcPowerW: 0,
      acPowerW: 0,
      grossAcPowerW: 0,
      efficiency: 0,
      clippingLossW: 0,
      wiringLossW,
      standbyConsumptionW: config.nightConsumptionW,
      status: "over-voltage",
    };
  }
  if (
    voltage !== undefined &&
    requestedDc > 0 &&
    (voltage < config.mpptMinVoltageV || voltage > config.mpptMaxVoltageV)
  ) {
    status = "mppt-voltage-limited";
    acceptedDcPowerW = 0;
  }
  if (current !== undefined && current > config.maxInputCurrentA) {
    status = "current-limited";
    acceptedDcPowerW = Math.min(
      acceptedDcPowerW,
      voltage !== undefined
        ? Math.max(0, voltage) * config.maxInputCurrentA
        : acceptedDcPowerW * config.maxInputCurrentA / current,
    );
  }
  if (acceptedDcPowerW <= config.startPowerW) {
    return {
      acceptedDcPowerW,
      acPowerW: 0,
      grossAcPowerW: 0,
      efficiency: 0,
      clippingLossW: 0,
      wiringLossW,
      standbyConsumptionW: config.nightConsumptionW,
      status: acceptedDcPowerW > 0 ? status : "off",
    };
  }

  const pdc0 = config.ratedAcPowerW / config.nominalEfficiency;
  const loadRatio = acceptedDcPowerW / pdc0;
  const efficiency = pvWattsV5Efficiency(loadRatio, config.nominalEfficiency);
  const grossAcPowerW = Math.max(0, acceptedDcPowerW * efficiency);
  const acPowerW = Math.min(config.ratedAcPowerW, grossAcPowerW);
  const clippingLossW = Math.max(0, grossAcPowerW - acPowerW);
  if (clippingLossW > 0) status = "clipped";
  return {
    acceptedDcPowerW,
    acPowerW,
    grossAcPowerW,
    efficiency,
    clippingLossW,
    wiringLossW,
    standbyConsumptionW: 0,
    status,
  };
}
