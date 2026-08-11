"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  createContinuousSurface,
  continuousSurfaceDimensions,
  type ContinuousSurfaceDimensions,
  type ContinuousSurfaceKind,
  type ContinuousSurfaceModel,
} from "../lib/geometry/continuous-surfaces";

export type Vec3Tuple = [number, number, number];
export type QuaternionTuple = [number, number, number, number];

export interface ScenePanel {
  id: string;
  label: string;
  position: Vec3Tuple;
  quaternion: QuaternionTuple;
  irradianceWm2?: number;
  temperatureC?: number;
  powerW?: number;
  bypassActive?: boolean;
  selected?: boolean;
}

export interface SceneObstacle {
  id: string;
  type: "mountain" | "building" | "tree" | "wall" | "ground" | "water" | "other";
  label: string;
  position: Vec3Tuple;
  rotation?: Vec3Tuple;
  scale: Vec3Tuple;
  color?: string;
}

export interface ThreeWorkspaceProps {
  panels: ScenePanel[];
  obstacles: SceneObstacle[];
  selectedPanelId: string | null;
  selectedObstacleId?: string | null;
  onSelectPanel: (id: string | null) => void;
  onSelectObstacle?: (id: string | null) => void;
  onPanelTransform: (id: string, position: Vec3Tuple, quaternion: QuaternionTuple) => void;
  onObstacleTransform?: (id: string, position: Vec3Tuple, rotation: Vec3Tuple, scale: Vec3Tuple) => void;
  transformMode: "translate" | "rotate" | "scale";
  gridSnap: boolean;
  surfaceSnap: boolean;
  showNormals: boolean;
  showRays: boolean;
  sunVector: Vec3Tuple;
  sunElevationDeg: number;
  rotationAngleRad: number;
  continuousSurface?: {
    kind: ContinuousSurfaceKind;
    cylinderAspectRatio?: number;
    coneAspectRatio?: number;
  } | null;
  showZoneBoundaries?: boolean;
  showSurfaceSamples?: boolean;
  gltfUrl?: string | null;
  quality?: "fast" | "balanced" | "precise";
}

const PANEL_SIZE = 0.05;
const PANEL_DEPTH = 0.0022;
const TWO_PI = 2 * Math.PI;

interface ContinuousSurfaceHitData {
  kind: ContinuousSurfaceKind;
  dimensions: ContinuousSurfaceDimensions;
  panelIds: string[];
}

interface SurfacePoint {
  position: Vec3Tuple;
  normal: Vec3Tuple;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function surfaceLayout(kind: ContinuousSurfaceKind) {
  void kind;
  return { bands: 20, sectors: 1 };
}

/** q is the normalized equal-area coordinate and v is normalized azimuth. */
function pointOnContinuousSurface(
  kind: ContinuousSurfaceKind,
  dimensions: ContinuousSurfaceDimensions,
  q: number,
  v: number,
): SurfacePoint {
  const azimuth = TWO_PI * v;
  const sine = Math.sin(azimuth);
  const cosine = Math.cos(azimuth);
  if (kind === "sphere") {
    const equalAreaY = -1 + 2 * clamp01(q);
    const radial = Math.sqrt(Math.max(0, 1 - equalAreaY * equalAreaY));
    const normal: Vec3Tuple = [radial * sine, equalAreaY, radial * cosine];
    return {
      position: [
        dimensions.radiusM * normal[0],
        dimensions.centreY + dimensions.radiusM * normal[1],
        dimensions.radiusM * normal[2],
      ],
      normal,
    };
  }
  if (kind === "cylinder") {
    const normal: Vec3Tuple = [sine, 0, cosine];
    return {
      position: [
        dimensions.radiusM * normal[0],
        dimensions.centreY + (clamp01(q) - 0.5) * dimensions.heightM,
        dimensions.radiusM * normal[2],
      ],
      normal,
    };
  }

  const t = Math.sqrt(clamp01(q));
  const radial = dimensions.radiusM * t;
  const slant = dimensions.slantHeightM ?? Math.hypot(dimensions.radiusM, dimensions.heightM);
  return {
    position: [
      radial * sine,
      dimensions.centreY + dimensions.heightM / 2 - dimensions.heightM * t,
      radial * cosine,
    ],
    normal: [
      dimensions.heightM * sine / slant,
      dimensions.radiusM / slant,
      dimensions.heightM * cosine / slant,
    ],
  };
}

function panelForZone(panels: ScenePanel[], model: ContinuousSurfaceModel, zoneIndex: number) {
  const zone = model.zones[zoneIndex];
  return panels.find((panel) => panel.id === zone?.id) ?? panels[zoneIndex];
}

function selectedZoneIndex(
  panels: ScenePanel[],
  model: ContinuousSurfaceModel,
  selectedPanelId: string | null,
) {
  if (!selectedPanelId) return -1;
  const modelIndex = model.zones.findIndex((zone) => zone.id === selectedPanelId);
  if (modelIndex >= 0) return modelIndex;
  const panelIndex = panels.findIndex((panel) => panel.id === selectedPanelId);
  return panelIndex >= 0 && panelIndex < model.zones.length ? panelIndex : -1;
}

function zoneIndexAtSurfacePoint(
  data: ContinuousSurfaceHitData,
  point: THREE.Vector3,
) {
  const { bands, sectors } = surfaceLayout(data.kind);
  let q = 0;
  if (data.kind === "sphere") {
    const equalAreaY = (point.y - data.dimensions.centreY) / data.dimensions.radiusM;
    q = (equalAreaY + 1) / 2;
  } else if (data.kind === "cylinder") {
    q = (point.y - (data.dimensions.centreY - data.dimensions.heightM / 2))
      / data.dimensions.heightM;
  } else {
    const radialFraction = Math.hypot(point.x, point.z) / data.dimensions.radiusM;
    q = radialFraction * radialFraction;
  }
  const azimuth = (Math.atan2(point.x, point.z) + TWO_PI) % TWO_PI;
  const band = Math.min(bands - 1, Math.floor(clamp01(q) * bands));
  const sector = Math.min(sectors - 1, Math.floor((azimuth / TWO_PI) * sectors));
  return band * sectors + sector;
}

function colorForIrradiance(value = 0) {
  const t = THREE.MathUtils.clamp(value / 1000, 0, 1);
  const low = new THREE.Color("#17334a");
  const high = new THREE.Color("#f7bb38");
  return low.lerp(high, Math.pow(t, 0.72));
}

function colorForSurfaceZone(panel: ScenePanel | undefined, selected: boolean) {
  const color = colorForIrradiance(panel?.irradianceWm2);
  if (panel?.bypassActive) color.lerp(new THREE.Color("#d9683b"), 0.58);
  if (selected) color.lerp(new THREE.Color("#fff0a6"), 0.52);
  return color;
}

function pushSurfaceTriangle(
  positions: number[],
  normals: number[],
  colors: number[],
  a: SurfacePoint,
  b: SurfacePoint,
  c: SurfacePoint,
  color: THREE.Color,
) {
  for (const point of [a, b, c]) {
    positions.push(...point.position);
    normals.push(...point.normal);
    colors.push(color.r, color.g, color.b);
  }
}

function createContinuousSurfaceGeometry(
  model: ContinuousSurfaceModel,
  dimensions: ContinuousSurfaceDimensions,
  panels: ScenePanel[],
  selectedPanelId: string | null,
  quality: "fast" | "balanced" | "precise",
) {
  const { bands, sectors } = surfaceLayout(model.kind);
  const subdivisions = quality === "precise" ? 12 : quality === "balanced" ? 8 : 4;
  const qSegments = bands * subdivisions;
  const vSegments = sectors * subdivisions;
  const selectedIndex = selectedZoneIndex(panels, model, selectedPanelId);
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];

  for (let row = 0; row < qSegments; row += 1) {
    const q0 = row / qSegments;
    const q1 = (row + 1) / qSegments;
    const band = Math.min(bands - 1, Math.floor(row / subdivisions));
    for (let column = 0; column < vSegments; column += 1) {
      const v0 = column / vSegments;
      const v1 = (column + 1) / vSegments;
      const sector = Math.min(sectors - 1, Math.floor(column / subdivisions));
      const zoneIndex = band * sectors + sector;
      const color = colorForSurfaceZone(
        panelForZone(panels, model, zoneIndex),
        zoneIndex === selectedIndex,
      );
      const p00 = pointOnContinuousSurface(model.kind, dimensions, q0, v0);
      const p01 = pointOnContinuousSurface(model.kind, dimensions, q0, v1);
      const p10 = pointOnContinuousSurface(model.kind, dimensions, q1, v0);
      const p11 = pointOnContinuousSurface(model.kind, dimensions, q1, v1);

      // Sphere/cylinder q grows upward; cone q grows from apex to base. The
      // analytic normals remain authoritative, while winding stays outward.
      if (model.kind === "cone") {
        pushSurfaceTriangle(positions, normals, colors, p00, p10, p11, color);
        pushSurfaceTriangle(positions, normals, colors, p00, p11, p01, color);
      } else {
        pushSurfaceTriangle(positions, normals, colors, p00, p01, p11, color);
        pushSurfaceTriangle(positions, normals, colors, p00, p11, p10, color);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function offsetSurfacePoint(point: SurfacePoint, distance = 0.00045) {
  return new THREE.Vector3(...point.position).addScaledVector(
    new THREE.Vector3(...point.normal),
    distance,
  );
}

function createZoneBoundaryGroup(
  model: ContinuousSurfaceModel,
  dimensions: ContinuousSurfaceDimensions,
) {
  const group = new THREE.Group();
  group.name = `${model.kind}-electrical-zone-boundaries`;
  const material = new THREE.LineBasicMaterial({
    color: "#9de7d7",
    transparent: true,
    opacity: 0.76,
    depthWrite: false,
  });
  const { bands, sectors } = surfaceLayout(model.kind);
  const azimuthSegments = 128;
  const meridianSegments = 96;

  for (let boundary = 0; boundary <= bands; boundary += 1) {
    const q = boundary / bands;
    const points = Array.from({ length: azimuthSegments }, (_, index) =>
      offsetSurfacePoint(pointOnContinuousSurface(model.kind, dimensions, q, index / azimuthSegments))
    );
    const radius = Math.max(...points.map((point) => Math.hypot(point.x, point.z)));
    if (radius < 0.0001) continue;
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), material);
    line.raycast = () => {};
    group.add(line);
  }

  for (let sector = 0; sector < sectors; sector += 1) {
    const v = sector / sectors;
    const points = Array.from({ length: meridianSegments + 1 }, (_, index) => {
      const q = index / meridianSegments;
      const offset = model.kind === "cone" && index === 0 ? 0 : 0.00045;
      return offsetSurfacePoint(pointOnContinuousSurface(model.kind, dimensions, q, v), offset);
    });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
    line.raycast = () => {};
    group.add(line);
  }
  return group;
}

function addSunRay(
  group: THREE.Group,
  origin: THREE.Vector3,
  sunDirection: THREE.Vector3,
  length = 0.22,
  opacity = 0.45,
) {
  const start = origin.clone().addScaledVector(sunDirection, length);
  const geometry = new THREE.BufferGeometry().setFromPoints([start, origin]);
  const line = new THREE.Line(
    geometry,
    new THREE.LineDashedMaterial({
      color: "#ffd76a",
      dashSize: 0.012,
      gapSize: 0.008,
      opacity,
      transparent: true,
    }),
  );
  line.computeLineDistances();
  group.add(line);
}

function addAoiArc(
  group: THREE.Group,
  origin: THREE.Vector3,
  normal: THREE.Vector3,
  sunDirection: THREE.Vector3,
) {
  const cosine = THREE.MathUtils.clamp(normal.dot(sunDirection), -1, 1);
  const angle = Math.acos(cosine);
  if (angle < 1e-4) return;
  const tangent = sunDirection.clone().addScaledVector(normal, -cosine);
  if (tangent.lengthSq() < 1e-12) {
    tangent.copy(Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0));
    tangent.addScaledVector(normal, -tangent.dot(normal));
  }
  tangent.normalize();
  const segments = Math.max(12, Math.ceil(32 * angle / Math.PI));
  const radius = 0.026;
  const points = Array.from({ length: segments + 1 }, (_, index) => {
    const theta = angle * index / segments;
    return origin.clone()
      .addScaledVector(normal, radius * Math.cos(theta))
      .addScaledVector(tangent, radius * Math.sin(theta));
  });
  const arc = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: "#ff8fc7", depthTest: false }),
  );
  arc.renderOrder = 5;
  group.add(arc);
}

function obstacleGeometry(type: SceneObstacle["type"]): THREE.BufferGeometry {
  switch (type) {
    case "mountain":
      return new THREE.ConeGeometry(0.09, 0.18, 9);
    case "tree":
      return new THREE.ConeGeometry(0.045, 0.12, 10);
    case "wall":
      return new THREE.BoxGeometry(0.16, 0.09, 0.012);
    case "ground":
    case "water":
      return new THREE.BoxGeometry(0.22, 0.006, 0.22);
    case "other":
      return new THREE.DodecahedronGeometry(0.065, 0);
    default:
      return new THREE.BoxGeometry(0.1, 0.13, 0.09);
  }
}

function obstacleColor(item: SceneObstacle) {
  if (item.color) return item.color;
  return {
    mountain: "#596750",
    building: "#46556b",
    tree: "#2f7455",
    wall: "#6f6257",
    ground: "#50594d",
    water: "#1f7188",
    other: "#795f86",
  }[item.type];
}

function disposeObject3D(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) return;
    geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    objectMaterials.forEach((material) => materials.add(material));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

function clearAndDispose(group: THREE.Group) {
  group.children.forEach((child) => disposeObject3D(child));
  group.clear();
}

function rotateAroundY([x, y, z]: Vec3Tuple, angleRad: number): Vec3Tuple {
  const cosine = Math.cos(angleRad);
  const sine = Math.sin(angleRad);
  return [cosine * x + sine * z, y, -sine * x + cosine * z];
}

export function ThreeWorkspace({
  panels,
  obstacles,
  selectedPanelId,
  selectedObstacleId = null,
  onSelectPanel,
  onSelectObstacle,
  onPanelTransform,
  onObstacleTransform,
  transformMode,
  gridSnap,
  surfaceSnap,
  showNormals,
  showRays,
  sunVector,
  sunElevationDeg,
  rotationAngleRad,
  continuousSurface = null,
  showZoneBoundaries = false,
  showSurfaceSamples = false,
  gltfUrl,
  quality = "balanced",
}: ThreeWorkspaceProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    orbit: OrbitControls;
    transform: TransformControls;
    panelGroup: THREE.Group;
    obstacleGroup: THREE.Group;
    helperGroup: THREE.Group;
    rayGroup: THREE.Group;
    importedGroup: THREE.Group;
    sunLight: THREE.DirectionalLight;
    sunOrb: THREE.Mesh;
    meshById: Map<string, THREE.Mesh>;
    obstacleMeshById: Map<string, THREE.Mesh>;
    raf: number;
    resizeObserver: ResizeObserver;
  } | null>(null);
  const callbacksRef = useRef({ onSelectPanel, onSelectObstacle, onPanelTransform, onObstacleTransform });
  const surfaceSnapRef = useRef(surfaceSnap);
  useEffect(() => {
    callbacksRef.current = { onSelectPanel, onSelectObstacle, onPanelTransform, onObstacleTransform };
  }, [onSelectPanel, onSelectObstacle, onPanelTransform, onObstacleTransform]);
  useEffect(() => {
    surfaceSnapRef.current = surfaceSnap;
  }, [surfaceSnap]);

  const antialias = quality !== "fast";
  const [sunX, sunY, sunZ] = sunVector;
  const normalizedSun = useMemo(() => {
    const v = new THREE.Vector3(sunX, sunY, sunZ);
    return v.lengthSq() > 0 ? v.normalize() : new THREE.Vector3(0, 1, 0);
  }, [sunX, sunY, sunZ]);
  const continuousKind = continuousSurface?.kind;
  const cylinderAspectRatio = continuousSurface?.cylinderAspectRatio;
  const coneAspectRatio = continuousSurface?.coneAspectRatio;
  const continuousSurfaceState = useMemo(() => {
    if (!continuousKind) return null;
    const options = {
      ...(cylinderAspectRatio !== undefined
        ? { cylinderAspectRatio }
        : {}),
      ...(coneAspectRatio !== undefined
        ? { coneAspectRatio }
        : {}),
    };
    const samplesPerAxis = quality === "precise" ? 64 : quality === "balanced" ? 32 : 16;
    return {
      model: createContinuousSurface(continuousKind, samplesPerAxis, options),
      dimensions: continuousSurfaceDimensions(continuousKind, options),
    };
  }, [continuousKind, cylinderAspectRatio, coneAspectRatio, quality]);
  const panelRenderKey = panels.map((panel) => [
    panel.id,
    ...panel.position,
    ...panel.quaternion,
    panel.irradianceWm2 ?? 0,
    panel.bypassActive ? 1 : 0,
  ].join(":" )).join("|");
  const obstacleRenderKey = obstacles.map((obstacle) => [
    obstacle.id,
    obstacle.type,
    obstacle.label,
    ...obstacle.position,
    ...(obstacle.rotation ?? [0, 0, 0]),
    ...obstacle.scale,
    obstacle.color ?? "",
  ].join(":" )).join("|");
  // The scalar signatures intentionally stabilize semantically identical arrays supplied by the parent.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stablePanels = useMemo(() => panels, [panelRenderKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableObstacles = useMemo(() => obstacles, [obstacleRenderKey]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || stateRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#08131d");
    scene.fog = new THREE.FogExp2("#08131d", 1.15);

    const camera = new THREE.PerspectiveCamera(40, 1, 0.003, 50);
    camera.position.set(0.48, 0.36, 0.56);
    camera.lookAt(0, 0.08, 0);

    const renderer = new THREE.WebGLRenderer({ antialias, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === "precise" ? 2 : 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.setAttribute("aria-label", "3D 태양광 패널 조립 장면");
    renderer.domElement.tabIndex = 0;
    host.appendChild(renderer.domElement);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.07;
    orbit.target.set(0, 0.075, 0);
    orbit.minDistance = 0.16;
    orbit.maxDistance = 2.8;

    const ambient = new THREE.HemisphereLight("#bde7ff", "#1c251f", 1.35);
    scene.add(ambient);
    const fill = new THREE.DirectionalLight("#8db7ff", 1.1);
    fill.position.set(-0.4, 0.6, 0.35);
    scene.add(fill);

    const sunLight = new THREE.DirectionalLight("#fff0bd", 3.2);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(1024, 1024);
    sunLight.shadow.camera.left = -0.5;
    sunLight.shadow.camera.right = 0.5;
    sunLight.shadow.camera.top = 0.5;
    sunLight.shadow.camera.bottom = -0.5;
    scene.add(sunLight);
    scene.add(sunLight.target);

    const sunOrb = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 24, 16),
      new THREE.MeshBasicMaterial({ color: "#ffd266", toneMapped: false }),
    );
    scene.add(sunOrb);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(0.65, 96),
      new THREE.MeshStandardMaterial({ color: "#16241f", roughness: 0.92, metalness: 0.02 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.name = "simulation-ground";
    scene.add(ground);

    const grid = new THREE.GridHelper(1.15, 58, "#2c5362", "#18343e");
    grid.position.y = 0.0005;
    (grid.material as THREE.Material).opacity = 0.62;
    (grid.material as THREE.Material).transparent = true;
    scene.add(grid);

    const compassMaterial = new THREE.LineBasicMaterial({ color: "#5f8290", transparent: true, opacity: 0.7 });
    const compassGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.002, -0.42),
      new THREE.Vector3(0, 0.002, 0.42),
      new THREE.Vector3(-0.42, 0.002, 0),
      new THREE.Vector3(0.42, 0.002, 0),
    ]);
    scene.add(new THREE.LineSegments(compassGeometry, compassMaterial));

    const panelGroup = new THREE.Group();
    const obstacleGroup = new THREE.Group();
    const helperGroup = new THREE.Group();
    const rayGroup = new THREE.Group();
    const importedGroup = new THREE.Group();
    scene.add(panelGroup, obstacleGroup, helperGroup, rayGroup, importedGroup);

    const transform = new TransformControls(camera, renderer.domElement);
    transform.setSize(0.7);
    scene.add(transform.getHelper());
    transform.addEventListener("dragging-changed", (event) => {
      orbit.enabled = !event.value;
      if (!event.value && transform.object?.userData.panelId) {
        const object = transform.object;
        if (surfaceSnapRef.current) {
          const ray = new THREE.Raycaster(
            new THREE.Vector3(object.position.x, 2, object.position.z),
            new THREE.Vector3(0, -1, 0),
            0,
            4,
          );
          const surfaces = [ground, ...obstacleGroup.children.filter((item) => item !== object)];
          const hit = ray.intersectObjects(surfaces, true)[0];
          if (hit) object.position.y = hit.point.y + PANEL_DEPTH * 0.6;
        }
        callbacksRef.current.onPanelTransform(
          object.userData.panelId,
          [object.position.x, object.position.y, object.position.z],
          [object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w],
        );
      } else if (!event.value && transform.object?.userData.obstacleId) {
        const object = transform.object;
        callbacksRef.current.onObstacleTransform?.(
          object.userData.obstacleId,
          [object.position.x, object.position.y, object.position.z],
          [object.rotation.x, object.rotation.y, object.rotation.z],
          [object.scale.x, object.scale.y, object.scale.z],
        );
      }
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const handlePointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects([...panelGroup.children, ...obstacleGroup.children], false);
      const hit = hits.find((candidate) =>
        candidate.object.userData.panelId ||
        candidate.object.userData.obstacleId ||
        candidate.object.userData.continuousSurface
      );
      let panelId = hit?.object.userData.panelId as string | undefined;
      const surfaceData = hit?.object.userData.continuousSurface as ContinuousSurfaceHitData | undefined;
      if (!panelId && hit && surfaceData) {
        const localPoint = hit.object.worldToLocal(hit.point.clone());
        panelId = surfaceData.panelIds[zoneIndexAtSurfacePoint(surfaceData, localPoint)];
      }
      const obstacleId = hit?.object.userData.obstacleId as string | undefined;
      callbacksRef.current.onSelectPanel(panelId ?? null);
      callbacksRef.current.onSelectObstacle?.(obstacleId ?? null);
    };
    renderer.domElement.addEventListener("pointerdown", handlePointer);

    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    const meshById = new Map<string, THREE.Mesh>();
    const obstacleMeshById = new Map<string, THREE.Mesh>();
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      orbit.update();
      renderer.render(scene, camera);
    };
    animate();

    stateRef.current = {
      scene,
      camera,
      renderer,
      orbit,
      transform,
      panelGroup,
      obstacleGroup,
      helperGroup,
      rayGroup,
      importedGroup,
      sunLight,
      sunOrb,
      meshById,
      obstacleMeshById,
      raf,
      resizeObserver,
    };

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointer);
      transform.detach();
      transform.dispose();
      orbit.dispose();
      disposeObject3D(scene);
      renderer.dispose();
      renderer.domElement.remove();
      stateRef.current = null;
    };
  }, [antialias, quality]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    const { panelGroup, meshById, transform } = state;
    transform.detach();
    clearAndDispose(panelGroup);
    meshById.clear();

    if (continuousSurfaceState) {
      const { model, dimensions } = continuousSurfaceState;
      const geometry = createContinuousSurfaceGeometry(
        model,
        dimensions,
        stablePanels,
        selectedPanelId,
        quality,
      );
      const material = new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        roughness: 0.28,
        metalness: 0.12,
        clearcoat: 0.7,
        clearcoatRoughness: 0.18,
        emissive: new THREE.Color("#06131b"),
        emissiveIntensity: 0.1,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `${model.kind}-continuous-pv-skin`;
      mesh.userData.continuousSurface = {
        kind: model.kind,
        dimensions,
        panelIds: model.zones.map((zone, index) => panelForZone(stablePanels, model, index)?.id ?? zone.id),
      } satisfies ContinuousSurfaceHitData;
      panelGroup.add(mesh);
      if (showZoneBoundaries) panelGroup.add(createZoneBoundaryGroup(model, dimensions));
    } else {
      const geometry = new THREE.BoxGeometry(PANEL_SIZE, PANEL_SIZE, PANEL_DEPTH);
      stablePanels.forEach((panel) => {
        const material = new THREE.MeshPhysicalMaterial({
          color: colorForIrradiance(panel.irradianceWm2),
          roughness: 0.28,
          metalness: 0.12,
          clearcoat: 0.7,
          clearcoatRoughness: 0.18,
          emissive: panel.bypassActive ? new THREE.Color("#c6512c") : new THREE.Color("#06131b"),
          emissiveIntensity: panel.bypassActive ? 0.45 : 0.1,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(...panel.position);
        mesh.quaternion.set(...panel.quaternion).normalize();
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.panelId = panel.id;
        mesh.name = panel.label;
        panelGroup.add(mesh);
        meshById.set(panel.id, mesh);
      });
    }
  }, [continuousSurfaceState, stablePanels, quality, selectedPanelId, showZoneBoundaries]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    // The render skin and static local helpers receive the mechanical world-Y rotation once.
    state.panelGroup.rotation.y = rotationAngleRad;
    state.helperGroup.rotation.y = rotationAngleRad;
  }, [rotationAngleRad]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    state.transform.setMode(transformMode);
    state.transform.setTranslationSnap(gridSnap ? 0.01 : null);
    state.transform.setRotationSnap(gridSnap ? THREE.MathUtils.degToRad(15) : null);
  }, [transformMode, gridSnap]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    clearAndDispose(state.obstacleGroup);
    state.obstacleMeshById.clear();
    stableObstacles.forEach((item) => {
      const isGltfBoundary = item.label.startsWith("GLB 차폐 경계");
      const material = new THREE.MeshStandardMaterial({
        color: obstacleColor(item),
        roughness: item.type === "water" ? 0.15 : 0.86,
        metalness: item.type === "water" ? 0.22 : 0.02,
        transparent: item.type === "water" || isGltfBoundary,
        opacity: isGltfBoundary ? 0.16 : item.type === "water" ? 0.72 : 1,
        wireframe: isGltfBoundary,
      });
      const geometry = isGltfBoundary ? new THREE.BoxGeometry(0.35, 0.35, 0.35) : obstacleGeometry(item.type);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...item.position);
      if (item.rotation) mesh.rotation.set(...item.rotation);
      mesh.scale.set(...item.scale);
      mesh.castShadow = item.type !== "water";
      mesh.receiveShadow = true;
      mesh.userData.obstacleId = item.id;
      mesh.name = item.label;
      state.obstacleGroup.add(mesh);
      state.obstacleMeshById.set(item.id, mesh);
    });
  }, [stableObstacles]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    const boundary = stableObstacles.find((item) => item.label.startsWith("GLB 차폐 경계"));
    if (!boundary) {
      state.importedGroup.position.set(0, 0, 0);
      state.importedGroup.rotation.set(0, 0, 0);
      state.importedGroup.scale.set(1, 1, 1);
      return;
    }
    state.importedGroup.position.set(boundary.position[0], boundary.position[1] - 0.175, boundary.position[2]);
    state.importedGroup.rotation.set(...(boundary.rotation ?? [0, 0, 0]));
    state.importedGroup.scale.set(...boundary.scale);
  }, [stableObstacles]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    state.transform.detach();
    const panel = selectedPanelId ? state.meshById.get(selectedPanelId) : undefined;
    const obstacle = selectedObstacleId ? state.obstacleMeshById.get(selectedObstacleId) : undefined;
    if (obstacle) state.transform.attach(obstacle);
    else if (panel) state.transform.attach(panel);
  }, [stablePanels, stableObstacles, selectedPanelId, selectedObstacleId]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    clearAndDispose(state.helperGroup);
    if (continuousSurfaceState) {
      const { model } = continuousSurfaceState;
      const selection = selectedZoneIndex(stablePanels, model, selectedPanelId);
      model.zones.forEach((zone, zoneIndex) => {
        const localNormal = new THREE.Vector3(...zone.representativeNormal).normalize();
        const origin = new THREE.Vector3(...zone.representativePosition);
        const isSelected = zoneIndex === selection;
        if (showNormals || isSelected) {
          state.helperGroup.add(
            new THREE.ArrowHelper(
              localNormal,
              origin,
              isSelected ? 0.052 : 0.035,
              isSelected ? "#fff0a6" : "#5eead4",
              isSelected ? 0.014 : 0.011,
              isSelected ? 0.008 : 0.006,
            ),
          );
        }
      });

      const selectedZone = selection >= 0 ? model.zones[selection] : undefined;
      if (showSurfaceSamples && selectedZone) {
        const samplePositions: number[] = [];
        selectedZone.samples.forEach((sample) => {
          const localPosition = new THREE.Vector3(...sample.position);
          const localNormal = new THREE.Vector3(...sample.normal).normalize();
          localPosition.addScaledVector(localNormal, 0.001);
          samplePositions.push(localPosition.x, localPosition.y, localPosition.z);
          state.helperGroup.add(
            new THREE.ArrowHelper(localNormal, localPosition, 0.014, "#73e6ff", 0.004, 0.0025),
          );
        });
        const points = new THREE.Points(
          new THREE.BufferGeometry().setAttribute(
            "position",
            new THREE.Float32BufferAttribute(samplePositions, 3),
          ),
          new THREE.PointsMaterial({
            color: "#f9f871",
            size: 0.006,
            sizeAttenuation: true,
            depthTest: false,
          }),
        );
        points.renderOrder = 6;
        state.helperGroup.add(points);

        const diagnosticSample = selectedZone.samples.reduce((nearest, sample) => {
          const distance = sample.position.reduce((sum, value, axis) => {
            const delta = value - selectedZone.representativePosition[axis];
            return sum + delta * delta;
          }, 0);
          const nearestDistance = nearest.position.reduce((sum, value, axis) => {
            const delta = value - selectedZone.representativePosition[axis];
            return sum + delta * delta;
          }, 0);
          return distance < nearestDistance ? sample : nearest;
        });
        const diagnosticOrigin = new THREE.Vector3(...diagnosticSample.position);
        const diagnosticNormal = new THREE.Vector3(...diagnosticSample.normal).normalize();
        diagnosticOrigin.addScaledVector(diagnosticNormal, 0.0012);
        state.helperGroup.add(
          new THREE.ArrowHelper(diagnosticNormal, diagnosticOrigin, 0.048, "#fff0a6", 0.012, 0.007),
        );
      }
      return;
    }

    stablePanels.forEach((panel) => {
      if (showNormals || panel.id === selectedPanelId) {
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(...panel.quaternion));
        const isSelected = panel.id === selectedPanelId;
        state.helperGroup.add(
          new THREE.ArrowHelper(
            normal,
            new THREE.Vector3(...panel.position),
            isSelected ? 0.052 : 0.035,
            isSelected ? "#fff0a6" : "#5eead4",
            isSelected ? 0.014 : 0.011,
            isSelected ? 0.008 : 0.006,
          ),
        );
      }
    });
  }, [continuousSurfaceState, stablePanels, selectedPanelId, showNormals, showSurfaceSamples]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    clearAndDispose(state.rayGroup);
    if (!showRays || sunElevationDeg <= 0) return;

    if (continuousSurfaceState) {
      const { model } = continuousSurfaceState;
      model.zones.forEach((zone) => {
        const origin = new THREE.Vector3(
          ...rotateAroundY([...zone.representativePosition] as Vec3Tuple, rotationAngleRad),
        );
        addSunRay(state.rayGroup, origin, normalizedSun);
      });
      const selection = selectedZoneIndex(stablePanels, model, selectedPanelId);
      const selectedZone = selection >= 0 ? model.zones[selection] : undefined;
      if (showSurfaceSamples && selectedZone) {
        const diagnosticSample = selectedZone.samples.reduce((nearest, sample) => {
          const distance = sample.position.reduce((sum, value, axis) => {
            const delta = value - selectedZone.representativePosition[axis];
            return sum + delta * delta;
          }, 0);
          const nearestDistance = nearest.position.reduce((sum, value, axis) => {
            const delta = value - selectedZone.representativePosition[axis];
            return sum + delta * delta;
          }, 0);
          return distance < nearestDistance ? sample : nearest;
        });
        const diagnosticOrigin = new THREE.Vector3(
          ...rotateAroundY([...diagnosticSample.position] as Vec3Tuple, rotationAngleRad),
        );
        const diagnosticNormal = new THREE.Vector3(
          ...rotateAroundY([...diagnosticSample.normal] as Vec3Tuple, rotationAngleRad),
        ).normalize();
        diagnosticOrigin.addScaledVector(diagnosticNormal, 0.0012);
        addSunRay(state.rayGroup, diagnosticOrigin, normalizedSun, 0.09, 0.95);
        addAoiArc(state.rayGroup, diagnosticOrigin, diagnosticNormal, normalizedSun);
      }
      return;
    }

    stablePanels.forEach((panel) => {
      const origin = new THREE.Vector3(...rotateAroundY(panel.position, rotationAngleRad));
      addSunRay(state.rayGroup, origin, normalizedSun);
    });
  }, [continuousSurfaceState, stablePanels, rotationAngleRad, selectedPanelId, showRays, showSurfaceSamples, normalizedSun, sunElevationDeg]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    const distance = 0.46;
    const pos = normalizedSun.clone().multiplyScalar(distance).add(new THREE.Vector3(0, 0.09, 0));
    state.sunOrb.visible = sunElevationDeg > -6;
    state.sunOrb.position.copy(pos);
    state.sunLight.position.copy(pos);
    state.sunLight.target.position.set(0, 0.07, 0);
    state.sunLight.intensity = sunElevationDeg > 0 ? 3.2 : 0;
  }, [normalizedSun, sunElevationDeg]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    clearAndDispose(state.importedGroup);
    if (!gltfUrl) return;
    const loader = new GLTFLoader();
    let active = true;
    loader.load(
      gltfUrl,
      (gltf) => {
        if (!active) {
          disposeObject3D(gltf.scene);
          return;
        }
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3());
        const maxSize = Math.max(size.x, size.y, size.z, 0.001);
        gltf.scene.scale.setScalar(0.35 / maxSize);
        const normalizedBox = new THREE.Box3().setFromObject(gltf.scene);
        const center = normalizedBox.getCenter(new THREE.Vector3());
        gltf.scene.position.set(-center.x, -normalizedBox.min.y + 0.002, -center.z);
        gltf.scene.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.castShadow = true;
            object.receiveShadow = true;
          }
        });
        state.importedGroup.add(gltf.scene);
      },
      undefined,
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [gltfUrl]);

  return (
    <div className="three-workspace" ref={hostRef}>
      <div className="scene-compass" aria-hidden="true">
        <span className="north">N</span><span className="east">E</span><span className="south">S</span><span className="west">W</span>
      </div>
      <div className="scene-scale">
        {continuousSurface ? "이상적 연속 PV 스킨 · 격자 1칸 = 1 cm" : "강체 패널 · 격자 1칸 = 1 cm"}
      </div>
    </div>
  );
}
