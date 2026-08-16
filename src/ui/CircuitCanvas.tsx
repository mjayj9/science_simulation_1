"use client";

import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useNodesState,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeProps,
  type OnConnect,
  type OnEdgesChange,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import "./circuit.css";
import {
  createAutoWireEdges,
  validateCircuitEdges,
  type TerminalSign,
} from "./circuit-editor-core";
export { createAutoWireEdges, validateCircuitEdges } from "./circuit-editor-core";

export type CircuitTopology = "series" | "parallel";

export interface CircuitPanel {
  id: string;
  label: string;
  irradianceWm2: number;
  powerW: number;
  bypassActive: boolean;
}

export interface CircuitCanvasProps {
  panels: CircuitPanel[];
  topology: CircuitTopology;
  edges: Edge[];
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  onAutoWire: (edges: Edge[], topology: CircuitTopology) => void;
  onTopologyChange: (topology: CircuitTopology) => void;
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


interface PanelNodeData extends Record<string, unknown> {
  panel: CircuitPanel;
}

interface JunctionNodeData extends Record<string, unknown> {
  active: boolean;
  label: string;
  polarity: Exclude<TerminalSign, "unknown">;
}

interface InverterNodeData extends Record<string, unknown> {
  bypassCount: number;
  dcPowerW: number;
  mpptStatus: "대기" | "추적 중" | "회로 점검";
}

function finiteNumber(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function PanelNode({ data, selected }: NodeProps) {
  const { panel } = data as PanelNodeData;

  return (
    <article
      className={`circuit-node circuit-panel-node${selected ? " is-selected" : ""}${
        panel.bypassActive ? " has-bypass" : ""
      }`}
      aria-label={`${panel.label}, 일사량 ${finiteNumber(panel.irradianceWm2, 0)} 와트 매 제곱미터, 출력 ${finiteNumber(panel.powerW, 3)} 와트, 바이패스 다이오드 ${panel.bypassActive ? "도통" : "차단"}`}
    >
      <Handle
        id="negative"
        type="source"
        position={Position.Left}
        className="circuit-handle circuit-handle--negative"
        aria-label={`${panel.label} 음극 연결점`}
        title={`${panel.label} 음극(−)`}
      />
      <span className="circuit-terminal-label circuit-terminal-label--negative" aria-hidden="true">
        −
      </span>

      <header className="circuit-node__header">
        <span className="circuit-node__eyebrow">PV 패널</span>
        <strong title={panel.label}>{panel.label}</strong>
      </header>
      <dl className="circuit-panel-node__metrics">
        <div>
          <dt>입사</dt>
          <dd>{finiteNumber(panel.irradianceWm2, 0)} W/m²</dd>
        </div>
        <div>
          <dt>DC</dt>
          <dd>{finiteNumber(panel.powerW, 3)} W</dd>
        </div>
      </dl>
      <div
        className={`circuit-diode${panel.bypassActive ? " is-conducting" : ""}`}
        aria-label={`바이패스 다이오드 ${panel.bypassActive ? "도통 중" : "차단"}`}
      >
        <span className="circuit-diode__symbol" aria-hidden="true">
          ▶│
        </span>
        <span>바이패스</span>
        <b>{panel.bypassActive ? "도통" : "차단"}</b>
      </div>

      <span className="circuit-terminal-label circuit-terminal-label--positive" aria-hidden="true">
        +
      </span>
      <Handle
        id="positive"
        type="source"
        position={Position.Right}
        className="circuit-handle circuit-handle--positive"
        aria-label={`${panel.label} 양극 연결점`}
        title={`${panel.label} 양극(+)`}
      />
    </article>
  );
}

function JunctionNode({ data, selected }: NodeProps) {
  const junction = data as JunctionNodeData;
  const sign = junction.polarity === "positive" ? "+" : "−";

  return (
    <div
      className={`circuit-node circuit-junction-node circuit-junction-node--${junction.polarity}${
        junction.active ? " is-active" : " is-inactive"
      }${selected ? " is-selected" : ""}`}
      aria-label={`${junction.label} ${sign}, ${junction.active ? "병렬 결선에 사용 중" : "현재 구성에서 사용하지 않음"}`}
    >
      <span className="circuit-node__eyebrow">JUNCTION</span>
      <strong>
        <span aria-hidden="true">{sign}</span> {junction.label}
      </strong>
      <small>{junction.active ? "병렬 결합점" : "병렬 모드 대기"}</small>
      <Handle
        id="bus"
        type="source"
        position={Position.Right}
        className={`circuit-handle circuit-handle--${junction.polarity}`}
        aria-label={`${junction.label} 배선 연결점`}
        title={`${junction.label} 연결점`}
      />
    </div>
  );
}

function InverterNode({ data, selected }: NodeProps) {
  const inverter = data as InverterNodeData;
  const statusClass =
    inverter.mpptStatus === "추적 중"
      ? "is-tracking"
      : inverter.mpptStatus === "회로 점검"
        ? "has-error"
        : "is-idle";

  return (
    <article
      className={`circuit-node circuit-inverter-node ${statusClass}${selected ? " is-selected" : ""}`}
      aria-label={`인버터, MPPT ${inverter.mpptStatus}, 입력 DC ${finiteNumber(inverter.dcPowerW, 3)} 와트`}
    >
      <Handle
        id="positive"
        type="source"
        position={Position.Left}
        className="circuit-handle circuit-handle--positive circuit-inverter-node__positive"
        aria-label="인버터 DC 양극 연결점"
        title="인버터 DC 양극(+)"
      />
      <Handle
        id="negative"
        type="source"
        position={Position.Left}
        className="circuit-handle circuit-handle--negative circuit-inverter-node__negative"
        aria-label="인버터 DC 음극 연결점"
        title="인버터 DC 음극(−)"
      />
      <span className="circuit-node__eyebrow">INVERTER</span>
      <strong>DC / AC 인버터</strong>
      <div className="circuit-mppt-status" aria-live="polite">
        <span className="circuit-mppt-status__dot" aria-hidden="true" />
        MPPT {inverter.mpptStatus}
      </div>
      <dl className="circuit-inverter-node__metrics">
        <div>
          <dt>입력 DC</dt>
          <dd>{finiteNumber(inverter.dcPowerW, 3)} W</dd>
        </div>
        <div>
          <dt>다이오드</dt>
          <dd>{inverter.bypassCount}개 도통</dd>
        </div>
      </dl>
    </article>
  );
}

const nodeTypes = {
  panel: PanelNode,
  junction: JunctionNode,
  inverter: InverterNode,
};

function createCircuitNodes(
  panels: CircuitPanel[],
  topology: CircuitTopology,
  mpptStatus: InverterNodeData["mpptStatus"],
): Node[] {
  const columns = Math.min(5, Math.max(1, Math.ceil(Math.sqrt(Math.max(panels.length, 1)))));
  const rows = Math.max(1, Math.ceil(panels.length / columns));
  const startX = 250;
  const startY = 70;
  const columnGap = 230;
  const rowGap = 180;
  const panelNodes: Node[] = panels.map((panel, index) => {
    const row = Math.floor(index / columns);
    const positionInRow = index % columns;
    const column = topology === "series" && row % 2 === 1
      ? columns - positionInRow - 1
      : positionInRow;
    return {
      id: panel.id,
      type: "panel",
      position: { x: startX + column * columnGap, y: startY + row * rowGap },
      data: { panel } satisfies PanelNodeData,
      deletable: false,
      ariaLabel: `${panel.label} 회로 노드`,
    };
  });

  const junctionBottom = startY + Math.max(1, rows - 1) * rowGap + 80;
  const inverterX = startX + columns * columnGap + 100;
  const inverterY = startY + ((rows - 1) * rowGap) / 2;
  const dcPowerW = panels.reduce(
    (sum, panel) => sum + (Number.isFinite(panel.powerW) ? Math.max(0, panel.powerW) : 0),
    0,
  );

  return [
    ...panelNodes,
    {
      id: POSITIVE_JUNCTION_ID,
      type: "junction",
      position: { x: 20, y: startY },
      data: {
        active: topology === "parallel",
        label: "양극 결합점",
        polarity: "positive",
      } satisfies JunctionNodeData,
      deletable: false,
      ariaLabel: "양극 병렬 결합점",
    },
    {
      id: NEGATIVE_JUNCTION_ID,
      type: "junction",
      position: { x: 20, y: junctionBottom },
      data: {
        active: topology === "parallel",
        label: "음극 결합점",
        polarity: "negative",
      } satisfies JunctionNodeData,
      deletable: false,
      ariaLabel: "음극 병렬 결합점",
    },
    {
      id: INVERTER_ID,
      type: "inverter",
      position: { x: inverterX, y: inverterY },
      data: {
        bypassCount: panels.filter((panel) => panel.bypassActive).length,
        dcPowerW,
        mpptStatus,
      } satisfies InverterNodeData,
      deletable: false,
      ariaLabel: `인버터 MPPT ${mpptStatus}`,
    },
  ];
}

interface ValidationTileProps {
  label: string;
  value: number;
  details: string;
}

function ValidationTile({ label, value, details }: ValidationTileProps) {
  return (
    <div
      className={`circuit-validation-tile ${value === 0 ? "is-ok" : "has-error"}`}
      title={details}
      aria-label={`${label} ${value}건. ${details}`}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function CircuitCanvas({
  panels,
  topology,
  edges,
  onEdgesChange,
  onConnect,
  onAutoWire,
  onTopologyChange,
}: CircuitCanvasProps) {
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const validation = useMemo(
    () => validateCircuitEdges(panels, topology, edges),
    [edges, panels, topology],
  );
  const totalPowerW = useMemo(
    () =>
      panels.reduce(
        (sum, panel) => sum + (Number.isFinite(panel.powerW) ? Math.max(0, panel.powerW) : 0),
        0,
      ),
    [panels],
  );
  const mpptStatus: InverterNodeData["mpptStatus"] = !validation.isValid
    ? "회로 점검"
    : totalPowerW > 0
      ? "추적 중"
      : "대기";
  const layoutNodes = useMemo(
    () => createCircuitNodes(panels, topology, mpptStatus),
    [mpptStatus, panels, topology],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(layoutNodes);

  useEffect(() => {
    setNodes((currentNodes) => {
      const currentById = new Map(currentNodes.map((node) => [node.id, node]));
      return layoutNodes.map((nextNode) => {
        const current = currentById.get(nextNode.id);
        if (!current || current.type !== nextNode.type) return nextNode;
        return {
          ...nextNode,
          position: current.position,
          selected: current.selected,
        };
      });
    });
  }, [layoutNodes, setNodes]);

  const existingSelectedEdgeIds = useMemo(() => {
    const available = new Set(edges.map((edge) => edge.id));
    return selectedEdgeIds.filter((id) => available.has(id));
  }, [edges, selectedEdgeIds]);

  const handleSelectionChange = useCallback(
    ({ edges: selectedEdges }: OnSelectionChangeParams) => {
      setSelectedEdgeIds(selectedEdges.map((edge) => edge.id));
    },
    [],
  );

  const handleAutoWire = useCallback(() => {
    setSelectedEdgeIds([]);
    onAutoWire(createAutoWireEdges(panels, topology), topology);
  }, [onAutoWire, panels, topology]);

  const handleDeleteSelected = useCallback(() => {
    if (existingSelectedEdgeIds.length === 0) return;
    const changes: EdgeChange[] = existingSelectedEdgeIds.map((id) => ({ id, type: "remove" }));
    onEdgesChange(changes);
    setSelectedEdgeIds([]);
  }, [existingSelectedEdgeIds, onEdgesChange]);

  const handleDeleteAll = useCallback(() => {
    if (edges.length === 0) return;
    const changes: EdgeChange[] = edges.map((edge) => ({ id: edge.id, type: "remove" }));
    onEdgesChange(changes);
    setSelectedEdgeIds([]);
  }, [edges, onEdgesChange]);

  const bypassCount = panels.filter((panel) => panel.bypassActive).length;
  const issueCount =
    validation.openCircuits +
    validation.shorts +
    validation.polarityErrors +
    validation.cycles +
    validation.isolatedPanelIds.length +
    validation.invalidEdges +
    validation.topologyMismatches;
  const validationMessage = panels.length === 0
    ? "회로를 구성할 패널이 없습니다."
    : validation.isValid
      ? `${topology === "series" ? "직렬" : "병렬"} 회로 검증을 통과했습니다.`
      : `회로 문제 ${issueCount}건을 확인하세요.`;

  return (
    <section className="circuit-canvas" aria-label="태양광 시각적 회로 편집기">
      <header className="circuit-toolbar">
        <div className="circuit-toolbar__title">
          <span className="circuit-toolbar__eyebrow">시각적 회로 편집</span>
          <h2>패널 배선과 MPPT</h2>
          <p id="circuit-canvas-help">
            단자를 드래그해 연결하고, 배선을 선택한 뒤 Delete 키 또는 삭제 버튼을 누르세요.
          </p>
        </div>

        <div className="circuit-toolbar__actions">
          <div className="circuit-topology-switch" role="group" aria-label="회로 토폴로지 선택">
            <button
              type="button"
              className={topology === "series" ? "is-active" : ""}
              aria-pressed={topology === "series"}
              onClick={() => onTopologyChange("series")}
            >
              직렬
            </button>
            <button
              type="button"
              className={topology === "parallel" ? "is-active" : ""}
              aria-pressed={topology === "parallel"}
              onClick={() => onTopologyChange("parallel")}
            >
              병렬
            </button>
          </div>
          <button
            type="button"
            className="circuit-button circuit-button--primary"
            onClick={handleAutoWire}
            disabled={panels.length === 0}
            aria-label={`현재 ${topology === "series" ? "직렬" : "병렬"} 구성으로 자동 배선`}
          >
            자동 배선
          </button>
          <button
            type="button"
            className="circuit-button"
            onClick={handleDeleteSelected}
            disabled={existingSelectedEdgeIds.length === 0}
            aria-label={`선택 배선 ${existingSelectedEdgeIds.length}개 삭제`}
          >
            선택 삭제{existingSelectedEdgeIds.length > 0 ? ` (${existingSelectedEdgeIds.length})` : ""}
          </button>
          <button
            type="button"
            className="circuit-button circuit-button--danger"
            onClick={handleDeleteAll}
            disabled={edges.length === 0}
            aria-label="모든 배선 삭제"
          >
            전체 배선 삭제
          </button>
        </div>
      </header>

      <div className="circuit-status-strip" aria-live="polite" aria-atomic="true">
        <div className={`circuit-health ${validation.isValid ? "is-valid" : "has-error"}`}>
          <span className="circuit-health__dot" aria-hidden="true" />
          <strong>{validation.isValid ? "회로 정상" : "회로 점검"}</strong>
          <span>{validationMessage}</span>
        </div>
        <dl className="circuit-live-summary">
          <div>
            <dt>패널</dt>
            <dd>{panels.length}개</dd>
          </div>
          <div>
            <dt>배선</dt>
            <dd>{edges.length}개</dd>
          </div>
          <div>
            <dt>바이패스</dt>
            <dd className={bypassCount > 0 ? "is-warning" : ""}>{bypassCount}개 도통</dd>
          </div>
          <div>
            <dt>MPPT</dt>
            <dd>{mpptStatus}</dd>
          </div>
        </dl>
      </div>

      <div
        className="circuit-flow"
        role="application"
        aria-label="패널 단자를 드래그해 배선하는 회로 캔버스"
        aria-describedby="circuit-canvas-help"
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectionChange={handleSelectionChange}
          connectionMode={ConnectionMode.Loose}
          defaultEdgeOptions={{
            type: "smoothstep",
            className: "circuit-wire circuit-wire--manual",
          }}
          connectionLineStyle={{ stroke: "#56d8c4", strokeWidth: 3 }}
          deleteKeyCode={["Backspace", "Delete"]}
          nodesConnectable
          nodesDraggable
          nodesFocusable
          edgesFocusable
          elementsSelectable
          fitView
          fitViewOptions={{ padding: 0.22, maxZoom: 1.15 }}
          minZoom={0.25}
          maxZoom={1.8}
          snapToGrid
          snapGrid={[10, 10]}
          proOptions={{ hideAttribution: false }}
          colorMode="dark"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.25} color="#34506a" />
          <MiniMap
            ariaLabel="회로 전체 배치 미니맵"
            pannable
            zoomable
            nodeColor={(node) => {
              if (node.type === "inverter") return "#eebc66";
              if (node.type === "junction") return "#8a9aad";
              const panel = (node.data as PanelNodeData).panel;
              return panel?.bypassActive ? "#ef9a62" : "#3cc7b3";
            }}
          />
          <Controls
            showInteractive={false}
            aria-label="회로 화면 확대·축소 및 맞춤"
          />
        </ReactFlow>
        {panels.length === 0 ? (
          <div className="circuit-empty-state" role="status">
            <strong>표시할 패널이 없습니다.</strong>
            <span>3D 조립 화면에서 패널을 추가하면 회로 노드가 생성됩니다.</span>
          </div>
        ) : null}
      </div>

      <aside className="circuit-validation" aria-label="회로 검증 요약">
        <div className="circuit-validation__heading">
          <div>
            <span className="circuit-toolbar__eyebrow">실시간 검사</span>
            <h3>배선 검증 요약</h3>
          </div>
          <p>{validationMessage}</p>
        </div>
        <div className="circuit-validation__tiles">
          <ValidationTile
            label="개방"
            value={validation.openCircuits}
            details="연결되지 않은 필수 단자 또는 완성되지 않은 전류 경로"
          />
          <ValidationTile
            label="단락"
            value={validation.shorts}
            details="패널/인버터 양·음극을 전원 소자 없이 직접 잇는 경로"
          />
          <ValidationTile
            label="극성"
            value={validation.polarityErrors}
            details="선택 구성의 양·음극 규칙과 맞지 않는 연결"
          />
          <ValidationTile
            label="순환"
            value={validation.cycles}
            details="외부 배선만으로 만들어진 중복 또는 순환 연결"
          />
          <ValidationTile
            label="고립"
            value={validation.isolatedPanelIds.length}
            details={
              validation.isolatedPanelIds.length > 0
                ? `인버터와 연결되지 않은 패널: ${validation.isolatedPanelIds.join(", ")}`
                : "모든 패널이 인버터 측 회로에 연결됨"
            }
          />
          <ValidationTile
            label="구성"
            value={validation.topologyMismatches + validation.invalidEdges}
            details={`토폴로지 불일치 ${validation.topologyMismatches}건, 유효하지 않은 연결 ${validation.invalidEdges}건`}
          />
        </div>
      </aside>
    </section>
  );
}
