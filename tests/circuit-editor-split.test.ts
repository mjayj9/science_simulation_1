import { describe, expect, it } from "vitest";
import {
  createAutoWireEdges,
  validateCircuitEdges,
  type CircuitPanel,
} from "../src/ui/circuit-editor-core";

const PANELS: CircuitPanel[] = [
  { id: "p1", label: "P1", irradianceWm2: 900, powerW: 4.5, bypassActive: false },
  { id: "p2", label: "P2", irradianceWm2: 650, powerW: 3.1, bypassActive: false },
  { id: "p3", label: "P3", irradianceWm2: 300, powerW: 1.2, bypassActive: true },
];

describe("lazy circuit editor core", () => {
  it.each(["series", "parallel"] as const)(
    "preserves the deterministic %s topology without loading ReactFlow",
    (topology) => {
      const first = createAutoWireEdges(PANELS, topology);
      const second = createAutoWireEdges(PANELS, topology);

      expect(second).toEqual(first);
      expect(first).toHaveLength(topology === "series" ? PANELS.length + 1 : PANELS.length * 2 + 2);
      expect(validateCircuitEdges(PANELS, topology, first)).toMatchObject({
        invalidEdges: 0,
        topologyMismatches: 0,
        isValid: true,
      });
    },
  );
});
