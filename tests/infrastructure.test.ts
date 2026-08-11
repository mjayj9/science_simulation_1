import { describe, expect, it, vi } from "vitest";
import {
  PANEL_AREA_M2,
  addPanel,
  createContinuousSurface,
  createObstacle,
  createPanel,
  computeVisibilities,
  deletePanel,
  detectOverlaps,
  duplicatePanel,
  generatePreset,
  obstacleToAabb,
  updatePanel,
  visibility,
  type ContinuousSurfaceKind,
  type PresetOptions,
  type PresetName,
  type Vec3,
} from "../src/lib/geometry";
import {
  createDefaultProject,
  exportProject,
  importProject,
  loadProject,
  migrateProject,
  saveProject,
  validateProject,
  type StorageLike,
} from "../src/lib/project";
import {
  fetchOpenMeteo,
  getOfflineWeather,
  importPvgisJson,
  normalizeOpenMeteoResponse,
  type WeatherRangeRequest,
} from "../src/lib/weather";
import {
  SIMULATION_WORKER_PROTOCOL_VERSION,
  SimulationCancelledError,
  runSimulationKernel,
  type SimulationRunRequest,
} from "../src/workers";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe("geometry infrastructure", () => {
  it("keeps plane, cube and free presets as twenty rigid 5 cm panels", () => {
    const names: PresetName[] = ["cube", "plane", "free"];
    for (const name of names) {
      const panels = generatePreset(name);
      expect(panels).toHaveLength(20);
      expect(new Set(panels.map((panel) => panel.id)).size).toBe(20);
      for (const panel of panels) {
        expect(panel.widthM).toBe(0.05);
        expect(panel.heightM).toBe(0.05);
        expect(panel.areaM2).toBe(0.0025);
        expect(Math.hypot(...panel.normal)).toBeCloseTo(1, 12);
        expect(Math.hypot(...panel.quaternion)).toBeCloseTo(1, 12);
      }
    }
  });

  it("maps each continuous curved skin to twenty equal-area electrical-zone anchors", () => {
    const cases: { kind: ContinuousSurfaceKind; options: PresetOptions }[] = [
      { kind: "sphere", options: { azimuthSamples: 64, groundClearanceM: 0.007 } },
      {
        kind: "cylinder",
        options: { azimuthSamples: 64, cylinderAspectRatio: 1.7, groundClearanceM: 0.007 },
      },
      {
        kind: "cone",
        options: { azimuthSamples: 64, coneAspectRatio: 2.4, groundClearanceM: 0.007 },
      },
    ];

    for (const { kind, options } of cases) {
      const surface = createContinuousSurface(kind, options.azimuthSamples, {
        cylinderAspectRatio: options.cylinderAspectRatio,
        coneAspectRatio: options.coneAspectRatio,
        groundClearanceM: options.groundClearanceM,
      });
      const anchors = generatePreset(kind, options);

      expect(anchors).toHaveLength(20);
      expect(anchors.map(({ id }) => id)).toEqual(surface.zones.map(({ id }) => id));
      expect(anchors.reduce((sum, anchor) => sum + anchor.areaM2, 0)).toBeCloseTo(0.05, 14);
      anchors.forEach((anchor, index) => {
        const zone = surface.zones[index];
        expect(zone.areaM2).toBe(PANEL_AREA_M2);
        expect(zone.qMax - zone.qMin).toBeCloseTo(1 / 20, 14);
        expect(anchor.widthM).toBe(0.05);
        expect(anchor.heightM).toBe(0.05);
        expect(anchor.areaM2).toBe(zone.areaM2);
        anchor.position.forEach((value, axis) => {
          expect(value).toBeCloseTo(zone.representativePosition[axis], 14);
        });
        anchor.normal.forEach((value, axis) => {
          expect(value).toBeCloseTo(zone.representativeNormal[axis], 14);
        });
        expect(Math.hypot(...anchor.normal)).toBeCloseTo(1, 12);
        expect(Math.hypot(...anchor.quaternion)).toBeCloseTo(1, 12);
      });
    }

    expect(() => generatePreset("sphere", { azimuthSamples: 15 })).toThrow(/16~128/);
  });

  it("adds, duplicates, updates, deletes and detects overlap without mutating inputs", () => {
    const original = [createPanel({ id: "a" })];
    const added = addPanel(original, { id: "b", position: [0.1, 0, 0] });
    const duplicated = duplicatePanel(added, "a", [0, 0, 0], () => "a-copy");
    expect(original).toHaveLength(1);
    expect(detectOverlaps(duplicated)).toContainEqual({ aId: "a", bId: "a-copy" });
    const updated = updatePanel(duplicated, "a-copy", { position: [0.2, 0, 0] });
    expect(detectOverlaps(updated)).toHaveLength(0);
    expect(deletePanel(updated, "b").map((panel) => panel.id)).toEqual(["a", "a-copy"]);
  });

  it("test 6: ray intersections reduce visibility only on the geometrically blocked panel", () => {
    const panelA = createPanel({ id: "panel-a", position: [-0.06, 0, 0] });
    const panelB = createPanel({ id: "panel-b", position: [0.06, 0, 0] });
    const obstacle = createObstacle("building", {
      id: "block-a",
      position: [-0.06, 0, 0.5],
      sizeM: [0.05, 0.05, 0.05],
    });
    const occluders = [{ kind: "aabb" as const, id: obstacle.id, bounds: obstacleToAabb(obstacle) }];
    const a = visibility(panelA, [0, 0, 1], occluders, { samplesPerSide: 3 });
    const b = visibility(panelB, [0, 0, 1], occluders, { samplesPerSide: 3 });
    expect(a.visibility).toBe(0);
    expect(a.blockedBy["block-a"]).toBe(9);
    expect(b.visibility).toBe(1);
    expect(b.blockedBy).toEqual({});
  });

  it("keeps every coplanar plane panel visible for front-side sun directions", () => {
    const panels = generatePreset("plane", { planeTiltDeg: 30, planeAzimuthDeg: 180 });
    const normal = panels[0].normal;
    const directions: Vec3[] = [
      [normal[0], normal[1], normal[2]],
      [normal[0] + 0.18, normal[1] + 0.12, normal[2] - 0.08],
      [normal[0] - 0.15, normal[1] + 0.08, normal[2] + 0.1],
    ];
    for (const direction of directions) {
      const results = computeVisibilities(panels, direction, [], { samplesPerSide: 3 });
      expect(results.every((result) => result.frontFacing && result.visibility === 1)).toBe(true);
    }
  });
});

describe("project V3 infrastructure", () => {
  it("test 13: validates and round-trips placement, circuit, environment and result settings", () => {
    const now = new Date("2026-08-10T12:00:00.000Z");
    const base = createDefaultProject({ id: "roundtrip", now });
    const movedPanels = updatePanel(base.variants[0].panels, base.variants[0].panels[0].id, {
      position: [0.123, 0.456, 0.789],
    });
    const document = validateProject({
      ...base,
      shared: {
        ...base.shared,
        resultSettings: { ...base.shared.resultSettings, retainPanelSeries: true },
        environment: {
          ...base.shared.environment,
          obstacles: [createObstacle("building", { id: "saved-building", position: [1, 0.5, 2] })],
        },
      },
      variants: [{ ...base.variants[0], panels: movedPanels }],
    });
    const imported = importProject(exportProject(document, { now }));
    expect(imported).toEqual(document);

    const storage = new MemoryStorage();
    saveProject(document, { storage });
    expect(loadProject({ storage })).toEqual(document);
  });

  it("migrates a V1 single-shape save through V2 into a valid V3 document", () => {
    const legacy = {
      version: 1,
      id: "legacy",
      name: "이전 저장",
      updatedAt: "2026-08-10T00:00:00.000Z",
      preset: "free",
      panels: [{ id: "legacy-panel", position: [1, 2, 3], normal: [0, 1, 0] }],
    };
    const migrated = migrateProject(legacy);
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.variants[0].panels).toHaveLength(1);
    expect(migrated.variants[0].panels[0].position).toEqual([1, 2, 3]);
    expect(validateProject(migrated)).toEqual(migrated);
    expect(migrateProject(legacy)).toEqual(migrated);
  });
});

describe("weather adapters", () => {
  const request: WeatherRangeRequest = {
    latitudeDeg: 37.5665,
    longitudeDeg: 126.978,
    start: "2026-08-10T00:00:00Z",
    end: "2026-08-10T03:00:00Z",
    stepMinutes: 60,
    seed: "repeatable",
    offlinePreset: "partly-cloudy",
  };

  it("test 12: falls back to a deterministic, explicitly labelled offline series", async () => {
    const now = new Date("2026-08-10T00:00:00Z");
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("network down"));
    const first = await fetchOpenMeteo(request, { fetchImpl, now, timeoutMs: 50 });
    const second = await fetchOpenMeteo(request, { fetchImpl, now, timeoutMs: 50 });
    expect(first.provenance.provider).toBe("offline");
    expect(first.provenance.kind).toBe("model-estimate");
    expect(first.provenance.fallbackReason).toContain("Open-Meteo 실패");
    expect(first.points).toEqual(second.points);
    expect(first.points.every((point) => Object.values(point)
      .filter((value): value is number => typeof value === "number")
      .every(Number.isFinite))).toBe(true);
  });

  it("offline generation is stable for the same seed and changes with a different seed", () => {
    const a = getOfflineWeather(request, { now: new Date(0) });
    const b = getOfflineWeather(request, { now: new Date(0) });
    const c = getOfflineWeather({ ...request, seed: "different" }, { now: new Date(0) });
    expect(a).toEqual(b);
    expect(a.points).not.toEqual(c.points);
  });

  it("rejects a missing Open-Meteo irradiance value instead of converting it to night", () => {
    expect(() => normalizeOpenMeteoResponse({
      hourly: {
        time: ["2026-06-21T08:00", "2026-06-21T09:00", "2026-06-21T10:00"],
        shortwave_radiation: [300, null, 100],
        direct_normal_irradiance: [500, 400, 200],
        diffuse_radiation: [80, 70, 60],
      },
    })).toThrow(/누락/);
  });

  it("canonicalizes multi-source-year PVGIS TMY rows by month-day clock", () => {
    const series = importPvgisJson({ outputs: { tmy_hourly: [
      { time: "20210301:0000", "G(h)": 300, "Gb(n)": 0, "Gd(h)": 0 },
      { time: "20200101:0000", "G(h)": 100, "Gb(n)": 0, "Gd(h)": 0 },
      { time: "20190201:0000", "G(h)": 200, "Gb(n)": 0, "Gd(h)": 0 },
    ] } });
    expect(series.points.map((point) => new Date(point.timeUtcMs).getUTCFullYear())).toEqual([2000, 2000, 2000]);
    expect(series.points.map((point) => new Date(point.timeUtcMs).getUTCMonth())).toEqual([0, 1, 2]);
    expect(series.points.map((point) => point.sourceTimestamp)).toEqual([
      "20200101:0000",
      "20190201:0000",
      "20210301:0000",
    ]);
  });
});

describe("simulation worker kernel", () => {
  function request(variantCount = 5): SimulationRunRequest {
    const weather = getOfflineWeather({
      latitudeDeg: 37.5,
      longitudeDeg: 127,
      start: "2026-08-10T00:00:00Z",
      end: "2026-08-10T05:00:00Z",
      stepMinutes: 60,
      seed: "worker",
    }).points;
    return {
      protocolVersion: SIMULATION_WORKER_PROTOCOL_VERSION,
      type: "simulation/run",
      requestId: "run-1",
      fingerprint: "fingerprint-1",
      input: {
        variants: Array.from({ length: variantCount }, (_, index) => ({
          variantId: `variant-${index + 1}`,
          panelCount: 20,
          totalPanelAreaM2: 20 * PANEL_AREA_M2,
          referenceEfficiency: 0.2,
          irradianceScale: 1 - index * 0.05,
        })),
        weather,
        chunkSize: 2,
      },
    };
  }

  it("test 14: executes one to five variants with at most one hundred panels", async () => {
    for (let count = 1; count <= 5; count += 1) {
      const progress: number[] = [];
      const chunks: number[] = [];
      const complete = await runSimulationKernel(request(count), {
        onProgress: (event) => { progress.push(event.fraction); },
        onChunk: (event) => { chunks.push(event.rows.length); },
        yieldControl: async () => undefined,
      });
      expect(complete.steps).toBe(6);
      expect(Object.keys(complete.energyWhByVariant)).toHaveLength(count);
      expect(progress.at(-1)).toBe(1);
      expect(chunks.reduce((sum, value) => sum + value, 0)).toBe(6);
    }
  });

  it("checks cancellation between chunks after yielding control", async () => {
    let cancelled = false;
    let yields = 0;
    await expect(runSimulationKernel(request(5), {
      isCancelled: () => cancelled,
      yieldControl: async () => {
        yields += 1;
        if (yields === 1) cancelled = true;
      },
    })).rejects.toBeInstanceOf(SimulationCancelledError);
    expect(yields).toBe(1);
  });
});
