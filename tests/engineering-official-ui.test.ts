import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import transientEngineeringGateJson from "../src/lib/physics/transient-engineering-validation.generated.json";
import { EngineeringComparisonResults } from "../src/ui/EngineeringComparisonResults";
import {
  certifiedEngineeringFixtureEligibility,
  certifiedRuntimeGeometryEligibility,
  certifiedRuntimeLayoutEligibility,
  generatedEngineeringOfficialRankingArtifact,
  type EngineeringCertifiedFixture,
} from "../src/ui/engineering-official-ranking";
import { AnnualComparisonChart } from "../src/ui/SimulationCharts";

const certified = transientEngineeringGateJson.certifiedFixture;

function fixtureWithMutation(mutator: (fixture: unknown) => void): EngineeringCertifiedFixture {
  const fixture = structuredClone(certified) as unknown;
  mutator(fixture);
  return fixture as EngineeringCertifiedFixture;
}

describe("official engineering UI fail-closed contracts", () => {
  it("accepts only the complete certified fixture and identifies every changed section", () => {
    expect(certifiedEngineeringFixtureEligibility({ actual: structuredClone(certified), certified })).toEqual({
      eligible: true,
      reasons: [],
    });

    const mismatches: Array<[string, (fixture: unknown) => void]> = [
      ["weather-fixture-mismatch", (fixture) => { (fixture as { weather: { seed: string } }).weather.seed = "different-seed"; }],
      ["pv-fixture-mismatch", (fixture) => { (fixture as { pv: { referenceCell: { iscA: number } } }).pv.referenceCell.iscA += 0.01; }],
      ["inverter-fixture-mismatch", (fixture) => { (fixture as { inverter: { ratedAcPowerW: number } }).inverter.ratedAcPowerW += 1; }],
      ["thermal-fixture-mismatch", (fixture) => { (fixture as { thermal: { materialConfig: { arealHeatCapacityJm2K: number } } }).thermal.materialConfig.arealHeatCapacityJm2K += 1; }],
      ["controlledRotation-fixture-mismatch", (fixture) => { (fixture as { controlledRotation: { rpm: number } }).controlledRotation.rpm += 1; }],
      ["optics-fixture-mismatch", (fixture) => { (fixture as { optics: { albedo: number } }).optics.albedo += 0.01; }],
      ["geometry-fixture-mismatch", (fixture) => { (fixture as { geometry: { landAreaM2: number } }).geometry.landAreaM2 += 0.001; }],
      ["geometry-fixture-mismatch", (fixture) => { (fixture as { geometry: { planeTiltDeg: number } }).geometry.planeTiltDeg += 1; }],
      ["geometry-fixture-mismatch", (fixture) => { (fixture as { geometry: { planeAzimuthDeg: number } }).geometry.planeAzimuthDeg += 1; }],
    ];

    for (const [reason, mutate] of mismatches) {
      const result = certifiedEngineeringFixtureEligibility({
        actual: fixtureWithMutation(mutate),
        certified,
      });
      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain(reason);
    }
  });

  it("binds official geometry to audited land, height, support, and plane tilt", () => {
    const runtime = {
      landAreaM2: certified.geometry.landAreaM2,
      maximumHeightM: certified.geometry.maximumHeightM,
      structureHeightM: certified.geometry.maximumHeightM,
      supportHeightM: 0,
      planeTiltDeg: certified.geometry.planeTiltDeg,
    };
    expect(certifiedRuntimeGeometryEligibility({ runtime, certified: certified.geometry }).eligible).toBe(true);

    for (const changed of [
      { ...runtime, landAreaM2: runtime.landAreaM2 + 0.001 },
      { ...runtime, maximumHeightM: runtime.maximumHeightM + 0.001 },
      { ...runtime, structureHeightM: runtime.structureHeightM - 0.001 },
      { ...runtime, supportHeightM: 0.001 },
      { ...runtime, planeTiltDeg: runtime.planeTiltDeg + 1 },
    ]) {
      expect(certifiedRuntimeGeometryEligibility({ runtime: changed, certified: certified.geometry })).toEqual({
        eligible: false,
        reasons: ["runtime-geometry-outside-certified-fixture"],
      });
    }
  });

  it("requires the runtime, audit, and certificate layout IDs plus active area to match", () => {
    const layoutId = `${transientEngineeringGateJson.layoutVersion}|activeAreaM2=0.05|cells=20|parallel=2|bypass=10`;
    const base = {
      runtimeLayoutId: layoutId,
      auditLayoutId: layoutId,
      certifiedLayoutId: layoutId,
      expectedActiveAreaM2: 0.05,
      layoutVersion: transientEngineeringGateJson.layoutVersion,
    };
    expect(certifiedRuntimeLayoutEligibility(base).eligible).toBe(true);

    for (const changed of [
      { ...base, runtimeLayoutId: `${layoutId}|changed=true` },
      { ...base, auditLayoutId: `${layoutId}|changed=true` },
      { ...base, certifiedLayoutId: `${layoutId}|changed=true` },
      { ...base, expectedActiveAreaM2: 0.049 },
    ]) {
      expect(certifiedRuntimeLayoutEligibility(changed)).toEqual({
        eligible: false,
        reasons: ["runtime-geometry-layout-not-certified"],
      });
    }
  });

  it("exposes generated rankings only after the compact gate publishes six official rows per mode", () => {
    const artifact = generatedEngineeringOfficialRankingArtifact();
    if (artifact.available) {
      expect(artifact.gateStatus).toBe("pass");
      expect(artifact.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(Object.values(artifact.rankings).every((rows) => rows.length === 6)).toBe(true);
    } else {
      expect(Object.values(artifact.rankings).every((rows) => rows.length === 0)).toBe(true);
    }
    expect(artifact.provenance).toContain("weather=");
    expect(artifact.provenance).toContain("footprint=");
    expect(artifact.provenance).toContain("electrical=");
    expect(artifact.provenance).toContain("thermal=");
    expect(artifact.provenance).toContain("rotation=");
    expect(artifact.provenance).toContain("resolution=");
    expect(artifact.provenance).toContain("convergence=");
    expect(artifact.provenance).toContain("status=");
  });
});

describe("comparison provenance rendering", () => {
  it("renders provenance inside the annual chart export/screenshot boundary", () => {
    const provenance = "weather=offline model estimate | time=8760 h | A_land=0.05 m2 | A_PV=0.05 m2 | footprint=static | electrical=ideal | thermal=transient | rotation=0 RPM | resolution=32/16/256 | convergence=pass | status=official";
    const html = renderToStaticMarkup(createElement(AnnualComparisonChart, {
      title: "Annual comparison",
      subtitle: "fixture",
      unit: "kWh/year",
      dataKey: "absoluteKWh",
      data: [{ name: "plane", fill: "#ffffff", absoluteKWh: 1, landKWhM2: 20, pvKWhM2: 20 }],
      provenance,
    }));
    expect(html).toContain('class="chart-provenance"');
    expect(html).toContain("weather=offline model estimate");
    expect(html).toContain("convergence=pass");
    expect(html).toContain("status=official");
  });

  it("renders no numeric rank for nonconverged interactive rows", () => {
    const html = renderToStaticMarkup(createElement(EngineeringComparisonResults, {
      rows: [{
        id: "plane",
        shapeLabel: "plane",
        landAreaM2: 0.05,
        pvAreaM2: 0.05,
        official: false,
      }],
      provenance: {
        weather: "offline model estimate",
        timeRange: "2025",
        timeResolution: "60 min",
        integration: "8760 h",
        commonLandAreaM2: 0.05,
        footprint: "static",
        electrical: "engineering",
        quasiThermal: "quasi",
        transientThermal: "transient",
        rotation: "stationary",
        numericalResolution: "32/16/256",
        convergence: "fail-closed",
        status: "\uD0D0\uC0C9\uAC12 \u00B7 \uC21C\uC704 \uD310\uC815 \uBD88\uAC00",
      },
      artifact: generatedEngineeringOfficialRankingArtifact(),
    }));
    expect(html).toContain("\uD0D0\uC0C9\uAC12 \u00B7 \uC21C\uC704 \uD310\uC815 \uBD88\uAC00");
    expect(html).not.toMatch(/\uACF5\uC2DD #\d/);
  });
});
