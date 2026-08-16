import type { Edge, EdgeChange } from "@xyflow/react";

export type CircuitTopology = "series" | "parallel";

export interface CircuitPanel {
  id: string;
  label: string;
  irradianceWm2: number;
  powerW: number;
  bypassActive: boolean;
}

export interface CircuitValidationSummary {
  openCircuits: number;
  shorts: number;
  polarityErrors: number;
  cycles: number;
  isolatedPanelIds: string[];
  invalidEdges: number;
  topologyMismatches: number;
  isValid: boolean;
}

const INVERTER_ID = "__circuit__inverter";
const POSITIVE_JUNCTION_ID = "__circuit__junction_positive";
const NEGATIVE_JUNCTION_ID = "__circuit__junction_negative";
const RESERVED_IDS = new Set([
  INVERTER_ID,
  POSITIVE_JUNCTION_ID,
  NEGATIVE_JUNCTION_ID,
]);

export type TerminalSign = "positive" | "negative" | "unknown";
type WireTone = "positive" | "negative" | "series";

function terminalSign(
  nodeId: string,
  handleId: string | null | undefined,
  panelIds: Set<string>,
): TerminalSign {
  if (nodeId === POSITIVE_JUNCTION_ID) return "positive";
  if (nodeId === NEGATIVE_JUNCTION_ID) return "negative";
  if (nodeId === INVERTER_ID || panelIds.has(nodeId)) {
    return handleId === "positive" || handleId === "negative" ? handleId : "unknown";
  }
  return "unknown";
}

function terminalKey(
  nodeId: string,
  handleId: string | null | undefined,
): string {
  if (nodeId === POSITIVE_JUNCTION_ID || nodeId === NEGATIVE_JUNCTION_ID) {
    return `${nodeId}:bus`;
  }
  return `${nodeId}:${handleId ?? "unknown"}`;
}

function addLink(graph: Map<string, Set<string>>, left: string, right: string): void {
  if (!graph.has(left)) graph.set(left, new Set());
  if (!graph.has(right)) graph.set(right, new Set());
  graph.get(left)?.add(right);
  graph.get(right)?.add(left);
}

function isReachable(graph: Map<string, Set<string>>, start: string, target: string): boolean {
  if (start === target) return true;
  const queue = [start];
  const visited = new Set<string>(queue);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const next of graph.get(current) ?? []) {
      if (next === target) return true;
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

function reachableFrom(graph: Map<string, Set<string>>, starts: string[]): Set<string> {
  const visited = new Set<string>();
  const queue = starts.filter((start) => {
    if (visited.has(start)) return false;
    visited.add(start);
    return true;
  });

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const next of graph.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited;
}

function cloneGraph(graph: Map<string, Set<string>>): Map<string, Set<string>> {
  return new Map([...graph.entries()].map(([key, values]) => [key, new Set(values)]));
}

/** Pure topology validation used before the ReactFlow editor chunk is loaded. */
export function validateCircuitEdges(
  panels: CircuitPanel[],
  topology: CircuitTopology,
  edges: Edge[],
): CircuitValidationSummary {
  const panelIds = new Set(panels.map((panel) => panel.id));
  const knownIds = new Set([
    ...panelIds,
    INVERTER_ID,
    POSITIVE_JUNCTION_ID,
    NEGATIVE_JUNCTION_ID,
  ]);
  const wireGraph = new Map<string, Set<string>>();
  const terminalDegree = new Map<string, number>();
  const shortKeys = new Set<string>();
  let polarityErrors = 0;
  let invalidEdges = 0;
  let topologyMismatches = 0;
  let cycles = 0;

  const unionParent = new Map<string, string>();
  const findRoot = (key: string): string => {
    const parent = unionParent.get(key);
    if (!parent) {
      unionParent.set(key, key);
      return key;
    }
    if (parent === key) return key;
    const root = findRoot(parent);
    unionParent.set(key, root);
    return root;
  };
  const union = (left: string, right: string): boolean => {
    const leftRoot = findRoot(left);
    const rightRoot = findRoot(right);
    if (leftRoot === rightRoot) return false;
    unionParent.set(leftRoot, rightRoot);
    return true;
  };

  for (const edge of edges) {
    const sourceKnown = knownIds.has(edge.source);
    const targetKnown = knownIds.has(edge.target);
    const sourceSign = terminalSign(edge.source, edge.sourceHandle, panelIds);
    const targetSign = terminalSign(edge.target, edge.targetHandle, panelIds);

    if (!sourceKnown || !targetKnown || sourceSign === "unknown" || targetSign === "unknown") {
      invalidEdges += 1;
      continue;
    }

    const sourceTerminal = terminalKey(edge.source, edge.sourceHandle);
    const targetTerminal = terminalKey(edge.target, edge.targetHandle);
    terminalDegree.set(sourceTerminal, (terminalDegree.get(sourceTerminal) ?? 0) + 1);
    terminalDegree.set(targetTerminal, (terminalDegree.get(targetTerminal) ?? 0) + 1);
    addLink(wireGraph, sourceTerminal, targetTerminal);

    if (sourceTerminal === targetTerminal || !union(sourceTerminal, targetTerminal)) {
      cycles += 1;
    }

    const sourceIsPanel = panelIds.has(edge.source);
    const targetIsPanel = panelIds.has(edge.target);
    const bothPanels = sourceIsPanel && targetIsPanel;
    const sameComponent = edge.source === edge.target;

    if (sameComponent && sourceSign !== targetSign) {
      shortKeys.add(`component:${edge.source}`);
    } else if (bothPanels) {
      if (sourceSign === targetSign) polarityErrors += 1;
    } else if (sourceSign !== targetSign) {
      polarityErrors += 1;
    }

    const joinsOppositeBuses =
      (edge.source === POSITIVE_JUNCTION_ID && edge.target === NEGATIVE_JUNCTION_ID) ||
      (edge.source === NEGATIVE_JUNCTION_ID && edge.target === POSITIVE_JUNCTION_ID);
    const joinsInverterTerminals =
      edge.source === INVERTER_ID && edge.target === INVERTER_ID && sourceSign !== targetSign;
    if (joinsOppositeBuses || joinsInverterTerminals) {
      shortKeys.add(`wire:${edge.id}`);
    }

    const sourceIsJunction =
      edge.source === POSITIVE_JUNCTION_ID || edge.source === NEGATIVE_JUNCTION_ID;
    const targetIsJunction =
      edge.target === POSITIVE_JUNCTION_ID || edge.target === NEGATIVE_JUNCTION_ID;

    if (topology === "series") {
      if (sourceIsJunction || targetIsJunction) topologyMismatches += 1;
    } else {
      const panelToJunction =
        (sourceIsPanel && targetIsJunction) || (targetIsPanel && sourceIsJunction);
      const junctionToInverter =
        (sourceIsJunction && edge.target === INVERTER_ID) ||
        (targetIsJunction && edge.source === INVERTER_ID);
      if (!panelToJunction && !junctionToInverter) topologyMismatches += 1;
    }
  }

  const inverterPositive = terminalKey(INVERTER_ID, "positive");
  const inverterNegative = terminalKey(INVERTER_ID, "negative");
  if (isReachable(wireGraph, inverterPositive, inverterNegative)) {
    shortKeys.add("wire:inverter-path");
  }

  const expectedTerminals = [inverterPositive, inverterNegative];
  for (const panel of panels) {
    expectedTerminals.push(terminalKey(panel.id, "positive"), terminalKey(panel.id, "negative"));
  }
  let openCircuits = expectedTerminals.filter(
    (terminal) => (terminalDegree.get(terminal) ?? 0) === 0,
  ).length;

  const electricalGraph = cloneGraph(wireGraph);
  for (const panel of panels) {
    addLink(
      electricalGraph,
      terminalKey(panel.id, "negative"),
      terminalKey(panel.id, "positive"),
    );
  }
  const completePath = isReachable(electricalGraph, inverterNegative, inverterPositive);
  if (panels.length > 0 && !completePath && openCircuits === 0) openCircuits = 1;

  const inverterReach = reachableFrom(electricalGraph, [inverterNegative, inverterPositive]);
  const isolatedPanelIds = panels
    .filter(
      (panel) =>
        !inverterReach.has(terminalKey(panel.id, "negative")) &&
        !inverterReach.has(terminalKey(panel.id, "positive")),
    )
    .map((panel) => panel.id);

  const duplicatePanelIds = panels.length - panelIds.size;
  const reservedCollisions = panels.filter((panel) => RESERVED_IDS.has(panel.id)).length;
  topologyMismatches += Math.max(0, duplicatePanelIds) + reservedCollisions;

  const summary: CircuitValidationSummary = {
    openCircuits,
    shorts: shortKeys.size,
    polarityErrors,
    cycles,
    isolatedPanelIds,
    invalidEdges,
    topologyMismatches,
    isValid: false,
  };
  summary.isValid =
    panels.length > 0 &&
    summary.openCircuits === 0 &&
    summary.shorts === 0 &&
    summary.polarityErrors === 0 &&
    summary.cycles === 0 &&
    summary.isolatedPanelIds.length === 0 &&
    summary.invalidEdges === 0 &&
    summary.topologyMismatches === 0;
  return summary;
}

function createWire(
  id: string,
  source: string,
  sourceHandle: "positive" | "negative" | "bus",
  target: string,
  targetHandle: "positive" | "negative" | "bus",
  tone: WireTone,
  topology: CircuitTopology,
  ariaLabel: string,
): Edge {
  return {
    id,
    source,
    sourceHandle,
    target,
    targetHandle,
    type: "smoothstep",
    className: `circuit-wire circuit-wire--${tone}`,
    ariaLabel,
    data: { autoWired: true, topology, tone },
  };
}

/** Creates a complete deterministic wire set without loading ReactFlow. */
export function createAutoWireEdges(
  panels: CircuitPanel[],
  topology: CircuitTopology,
): Edge[] {
  if (panels.length === 0) return [];

  if (topology === "series") {
    const result: Edge[] = [
      createWire(
        "auto:series:inverter-negative",
        INVERTER_ID,
        "negative",
        panels[0].id,
        "negative",
        "negative",
        topology,
        `인버터 음극에서 ${panels[0].label} 음극 연결`,
      ),
    ];
    for (let index = 0; index < panels.length - 1; index += 1) {
      result.push(
        createWire(
          `auto:series:${index}`,
          panels[index].id,
          "positive",
          panels[index + 1].id,
          "negative",
          "series",
          topology,
          `${panels[index].label} 양극에서 ${panels[index + 1].label} 음극 직렬 연결`,
        ),
      );
    }
    result.push(
      createWire(
        "auto:series:inverter-positive",
        panels[panels.length - 1].id,
        "positive",
        INVERTER_ID,
        "positive",
        "positive",
        topology,
        `${panels[panels.length - 1].label} 양극에서 인버터 양극 연결`,
      ),
    );
    return result;
  }

  const result: Edge[] = [];
  for (const panel of panels) {
    result.push(
      createWire(
        `auto:parallel:${panel.id}:negative`,
        panel.id,
        "negative",
        NEGATIVE_JUNCTION_ID,
        "bus",
        "negative",
        topology,
        `${panel.label} 음극에서 음극 결합점 연결`,
      ),
      createWire(
        `auto:parallel:${panel.id}:positive`,
        panel.id,
        "positive",
        POSITIVE_JUNCTION_ID,
        "bus",
        "positive",
        topology,
        `${panel.label} 양극에서 양극 결합점 연결`,
      ),
    );
  }
  result.push(
    createWire(
      "auto:parallel:inverter-negative",
      NEGATIVE_JUNCTION_ID,
      "bus",
      INVERTER_ID,
      "negative",
      "negative",
      topology,
      "음극 결합점에서 인버터 음극 연결",
    ),
    createWire(
      "auto:parallel:inverter-positive",
      POSITIVE_JUNCTION_ID,
      "bus",
      INVERTER_ID,
      "positive",
      "positive",
      topology,
      "양극 결합점에서 인버터 양극 연결",
    ),
  );
  return result;
}

/** ReactFlow-compatible edge updates kept in the lightweight state layer. */
export function applyCircuitEdgeChanges(changes: EdgeChange[], current: Edge[]): Edge[] {
  let edges = current;
  for (const change of changes) {
    if (change.type === "remove") {
      edges = edges.filter((edge) => edge.id !== change.id);
    } else if (change.type === "select") {
      edges = edges.map((edge) => edge.id === change.id ? { ...edge, selected: change.selected } : edge);
    } else if (change.type === "replace") {
      edges = edges.map((edge) => edge.id === change.id ? change.item : edge);
    } else if (change.type === "add") {
      const next = [...edges];
      next.splice(change.index ?? next.length, 0, change.item);
      edges = next;
    }
  }
  return edges;
}

export function addCircuitEdge(edge: Edge, current: Edge[]): Edge[] {
  const existing = current.findIndex((item) => item.id === edge.id);
  if (existing < 0) return [...current, edge];
  return current.map((item, index) => index === existing ? edge : item);
}
