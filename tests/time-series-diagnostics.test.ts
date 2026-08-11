import { describe, expect, it } from "vitest";
import { PANEL_AREA_M2 } from "../src/lib/geometry";
import {
  DEFAULT_INVERTER,
  solarPosition,
} from "../src/lib/physics";
import {
  classifyTimePoint,
  type ClassifiedDiagnostic,
  type DiagnosticReasonCode,
  type DiagnosticSignal,
} from "../src/lib/diagnostics/time-series";
import {
  fetchOpenMeteo,
  getOfflineWeather,
  importPvgisJson,
  normalizeNasaPowerResponse,
  type WeatherPoint,
} from "../src/lib/weather";
import {
  createSimulationRunRequest,
  runSimulationKernel,
  type SimulationResultRow,
} from "../src/workers";

const SEOUL = {
  latitudeDeg: 37.5665,
  longitudeDeg: 126.978,
  elevationM: 38,
} as const;

interface EndToEndDiagnosticPoint {
  weather: WeatherPoint;
  row: SimulationResultRow;
  signal: DiagnosticSignal;
  classified: ClassifiedDiagnostic;
}

interface SinglePointAnomaly {
  kind: "zero" | "dropout" | "spike";
  index: number;
  timeUtcMs: number;
  previousAcW: number;
  currentAcW: number;
  nextAcW: number;
  reasonCodes: DiagnosticReasonCode[];
}

const EXPLANATORY_TRANSITIONS = new Set<DiagnosticReasonCode>([
  "NIGHT",
  "MISSING_DATA",
  "INVERTER_CUTOFF",
  "BYPASS_SWITCH",
  "STRING_CURRENT_LIMIT",
  "WEATHER_STEP",
  "OCCLUSION_CHANGE",
  "ROTATION_PHASE",
  "NUMERIC_ERROR",
  "STALE_WORKER_RESULT",
]);

function seoulDayStartUtcMs(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date) - 9 * 3_600_000;
}

function findUnexplainedSinglePointAnomalies(
  points: readonly EndToEndDiagnosticPoint[],
): SinglePointAnomaly[] {
  const anomalies: SinglePointAnomaly[] = [];
  for (let index = 1; index + 1 < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const previousAcW = previous.signal.acPowerW;
    const currentAcW = current.signal.acPowerW;
    const nextAcW = next.signal.acPowerW;
    const neighborMinimum = Math.min(previousAcW, nextAcW);
    const neighborMaximum = Math.max(previousAcW, nextAcW);
    const isolatedZero = currentAcW <= 1e-12 && neighborMinimum > 0.005;
    const stableDaylightResource = [previous, current, next].every((point) =>
      point.signal.solarElevationDeg > 3 && point.signal.ghiWm2 > 50
    );
    const isolatedDropout = stableDaylightResource &&
      currentAcW < 0.5 * neighborMinimum && neighborMinimum - currentAcW > 0.005;
    const isolatedSpike = stableDaylightResource &&
      currentAcW > 1.5 * neighborMaximum && currentAcW - neighborMaximum > 0.005;
    const kind = isolatedZero
      ? "zero" as const
      : isolatedDropout
        ? "dropout" as const
        : isolatedSpike
          ? "spike" as const
          : undefined;
    if (
      kind &&
      !current.classified.reasonCodes.some((code) => EXPLANATORY_TRANSITIONS.has(code))
    ) {
      anomalies.push({
        kind,
        index,
        timeUtcMs: current.weather.timeUtcMs,
        previousAcW,
        currentAcW,
        nextAcW,
        reasonCodes: current.classified.reasonCodes,
      });
    }
  }
  return anomalies;
}

async function clearSeoulDiagnosticFixture(
  day: string,
  stepMinutes: 5 | 10,
): Promise<EndToEndDiagnosticPoint[]> {
  const start = seoulDayStartUtcMs(day);
  const end = start + 24 * 3_600_000;
  const weatherSeries = getOfflineWeather({
    ...SEOUL,
    start,
    end,
    stepMinutes,
    timezone: "Asia/Seoul",
    seed: `diagnostic-${day}-${stepMinutes}`,
    offlinePreset: "clear",
  }, { now: new Date(0) });
  const visibilityByStep = weatherSeries.points.map(() => 1);
  const rows: SimulationResultRow[] = [];
  const chunkOffsets: number[] = [];
  const variantId = "clear-plane";
  const complete = await runSimulationKernel(createSimulationRunRequest(
    `diagnostic-${day}-${stepMinutes}`,
    {
      mode: "time-series",
      chunkSize: 37,
      weather: weatherSeries.points,
      physics: {
        location: SEOUL,
        panelDefaults: { soilingLossFraction: 0 },
      },
      variants: [{
        variantId,
        panelCount: 1,
        totalPanelAreaM2: PANEL_AREA_M2,
        referenceEfficiency: 0.2,
        topology: "series",
        obstacleBounds: [],
        electrical: { mode: "simple" },
        inverter: { ...DEFAULT_INVERTER, ratedAcPowerW: 0.5 },
        panels: [{
          panelId: "horizontal-plane",
          positionM: { x: 0, y: 1, z: 0 },
          normal: { x: 0, y: 1, z: 0 },
          areaM2: PANEL_AREA_M2,
          efficiency: 0.2,
          heightM: 1,
          visibilityByStep,
          diffuseVisibility: 1,
          groundVisibility: 1,
          albedo: 0.2,
          iam: { model: "ashrae", b0: 0.05 },
          diffuseModel: "hay-davies",
          soilingLossFraction: 0,
        }],
      }],
    },
  ), {
    onChunk: (event) => {
      chunkOffsets.push(event.offset);
      rows.push(...event.rows);
    },
    yieldControl: async () => undefined,
  });

  const expectedLength = 24 * 60 / stepMinutes + 1;
  expect(weatherSeries.points).toHaveLength(expectedLength);
  expect(rows).toHaveLength(expectedLength);
  expect(complete.steps).toBe(expectedLength);
  expect(complete.intervals).toBe(expectedLength - 1);
  expect(complete.durationHours).toBe(24);
  expect(chunkOffsets).toEqual(
    Array.from({ length: Math.ceil(expectedLength / 37) }, (_, index) => index * 37),
  );

  const stepMs = stepMinutes * 60_000;
  const timestamps = weatherSeries.points.map((point) => point.timeUtcMs);
  expect(new Set(timestamps).size).toBe(expectedLength);
  weatherSeries.points.forEach((point, index) => {
    expect(point.timeUtcMs).toBe(start + index * stepMs);
    expect(point.sourceTimestamp).toBe(new Date(point.timeUtcMs).toISOString());
    expect(rows[index].timeUtcMs).toBe(point.timeUtcMs);
  });

  const diagnostics: EndToEndDiagnosticPoint[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const weather = weatherSeries.points[index];
    const row = rows[index];
    const solar = solarPosition({
      timestamp: weather.timeUtcMs,
      ...SEOUL,
      temperatureC: weather.ambientC,
    });
    const signal: DiagnosticSignal = {
      minute: (weather.timeUtcMs - start) / 60_000,
      solarElevationDeg: solar.elevationDeg,
      ghiWm2: weather.ghiWm2,
      dcPowerW: row.dcPowerWByVariant[variantId],
      acPowerW: row.acPowerWByVariant[variantId],
      visibility: visibilityByStep[index],
      bypassCount: row.bypassActiveCountByVariant[variantId],
      inverterStatus: row.inverterStatusByVariant[variantId],
      intervalAveraged: row.rotationIntervalAveragedByVariant[variantId],
    };
    const classified = classifyTimePoint(signal, diagnostics.at(-1)?.signal);
    diagnostics.push({ weather, row, signal, classified });
  }
  return diagnostics;
}

const signal = (patch: Partial<DiagnosticSignal> = {}): DiagnosticSignal => ({
  minute: 17 * 60,
  solarElevationDeg: 25,
  ghiWm2: 400,
  dcPowerW: 2,
  acPowerW: 1.8,
  visibility: 1,
  bypassCount: 0,
  inverterStatus: "running",
  intervalAveraged: false,
  ...patch,
});

describe("time-series cause classification", () => {
  it("distinguishes a smooth evening decline from an error", () => {
    const classified = classifyTimePoint(
      signal({ minute: 18 * 60, solarElevationDeg: 20, ghiWm2: 300, acPowerW: 1.2 }),
      signal(),
    );
    expect(classified.reasonCodes).toContain("NORMAL_SUNSET");
    expect(classified.severity).toBe("normal");
  });

  it("labels input, occlusion, bypass and inverter transitions without smoothing", () => {
    const classified = classifyTimePoint(
      signal({ ghiWm2: 0, visibility: 0.4, bypassCount: 4, acPowerW: 0, inverterStatus: "low-load-cutoff" }),
      signal(),
    );
    expect(classified.reasonCodes).toEqual(expect.arrayContaining([
      "INVERTER_CUTOFF",
      "BYPASS_SWITCH",
      "WEATHER_STEP",
      "OCCLUSION_CHANGE",
    ]));
  });

  it("treats night and interval phase integration as normal audit states", () => {
    const classified = classifyTimePoint(signal({ solarElevationDeg: -2, ghiWm2: 0, dcPowerW: 0, acPowerW: 0, intervalAveraged: true }));
    expect(classified.reasonCodes).toEqual(expect.arrayContaining(["NIGHT", "ROTATION_PHASE"]));
    expect(classified.severity).toBe("normal");
  });
});

describe("weather missing-value guards", () => {
  const nasaFixture = () => ({
    properties: {
      parameter: {
        ALLSKY_SFC_SW_DWN: { "2026062103": 0 },
        ALLSKY_SFC_SW_DNI: { "2026062103": 0 },
        ALLSKY_SFC_SW_DIFF: { "2026062103": 0 },
      },
    },
  });
  const pvgisFixture = () => ({
    outputs: {
      tmy_hourly: [{
        time: "20260621:0300",
        "G(h)": 0,
        "Gb(n)": 0,
        "Gd(h)": 0,
      }],
    },
  });

  it("accepts physical zero irradiance from NASA POWER and PVGIS", () => {
    expect(normalizeNasaPowerResponse(nasaFixture()).points[0]).toMatchObject({
      ghiWm2: 0,
      dniWm2: 0,
      dhiWm2: 0,
    });
    expect(importPvgisJson(pvgisFixture()).points[0]).toMatchObject({
      ghiWm2: 0,
      dniWm2: 0,
      dhiWm2: 0,
    });
  });

  it.each([
    "ALLSKY_SFC_SW_DWN",
    "ALLSKY_SFC_SW_DNI",
    "ALLSKY_SFC_SW_DIFF",
  ] as const)("rejects NASA POWER sentinel in required field %s", (field) => {
    const raw = nasaFixture();
    raw.properties.parameter[field]["2026062103"] = -999;
    expect(() => normalizeNasaPowerResponse(raw)).toThrow(new RegExp(field));
  });

  it.each([
    ["G(h)", "GHI"],
    ["Gb(n)", "DNI"],
    ["Gd(h)", "DHI"],
  ] as const)("rejects PVGIS null in required field %s", (field, label) => {
    const raw = pvgisFixture();
    raw.outputs.tmy_hourly[0][field] = null as never;
    expect(() => importPvgisJson(raw)).toThrow(new RegExp(label));
  });

  it("uses provenance for a complete source fallback and reserves MISSING_DATA for unresolved points", async () => {
    const timestamp = "2026-06-21T03:00:00Z";
    const fetchImpl: typeof fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        hourly: {
          time: [timestamp],
          shortwave_radiation: [null],
          direct_normal_irradiance: [700],
          diffuse_radiation: [100],
        },
      }),
    }) as Response;
    const fallback = await fetchOpenMeteo({
      ...SEOUL,
      start: timestamp,
      end: timestamp,
      stepMinutes: 10,
      offlinePreset: "clear",
    }, { fetchImpl, now: new Date(0) });

    expect(fallback.provenance.provider).toBe("offline");
    expect(fallback.provenance.fallbackReason).toContain("shortwave_radiation");
    const point = fallback.points[0];
    const completeFallbackSignal = signal({
      minute: 12 * 60,
      solarElevationDeg: 60,
      ghiWm2: point.ghiWm2,
      dcPowerW: 1,
      acPowerW: 0.9,
    });
    expect(classifyTimePoint(completeFallbackSignal).reasonCodes).not.toContain("MISSING_DATA");
    expect(classifyTimePoint({
      ...completeFallbackSignal,
      missingData: true,
    }).reasonCodes).toContain("MISSING_DATA");
  });
});

describe("clear Seoul end-to-end diagnostic fixtures", () => {
  const seasonalDays = [
    ["spring equinox", "2026-03-20"],
    ["summer solstice", "2026-06-21"],
    ["winter solstice", "2026-12-21"],
  ] as const;

  it.each(seasonalDays.flatMap(([season, day]) => ([5, 10] as const).map((stepMinutes) => ({
    season,
    day,
    stepMinutes,
  }))))(
    "$season has ordered raw $stepMinutes-minute weather/solar/power diagnostics without unexplained one-point anomalies",
    async ({ day, stepMinutes }) => {
      const points = await clearSeoulDiagnosticFixture(day, stepMinutes);
      const numericSignals = points.flatMap((point) => [
        point.signal.minute,
        point.signal.solarElevationDeg,
        point.signal.ghiWm2,
        point.signal.dcPowerW,
        point.signal.acPowerW,
        point.signal.visibility,
        point.signal.bypassCount,
      ]);
      expect(numericSignals.every(Number.isFinite)).toBe(true);
      expect(points.every((point) => point.signal.visibility === 1)).toBe(true);
      expect(points.every((point) =>
        !point.classified.reasonCodes.includes("NUMERIC_ERROR") &&
        !point.classified.reasonCodes.includes("MISSING_DATA") &&
        !point.classified.reasonCodes.includes("STALE_WORKER_RESULT") &&
        !point.classified.reasonCodes.includes("OCCLUSION_CHANGE")
      )).toBe(true);
      expect(points.some((point) => point.classified.reasonCodes.includes("NIGHT"))).toBe(true);
      expect(points.some((point) => point.classified.reasonCodes.includes("NORMAL_SUNSET"))).toBe(true);
      expect(Math.max(...points.map((point) => point.signal.acPowerW))).toBeGreaterThan(0);

      const unexplained = findUnexplainedSinglePointAnomalies(points);
      expect(unexplained, JSON.stringify(unexplained, null, 2)).toEqual([]);
    },
  );
});
