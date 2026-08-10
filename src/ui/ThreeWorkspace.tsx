"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

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
  gltfUrl?: string | null;
  quality?: "fast" | "balanced" | "precise";
}

const PANEL_SIZE = 0.05;
const PANEL_DEPTH = 0.0022;

function colorForIrradiance(value = 0) {
  const t = THREE.MathUtils.clamp(value / 1000, 0, 1);
  const low = new THREE.Color("#17334a");
  const high = new THREE.Color("#f7bb38");
  return low.lerp(high, Math.pow(t, 0.72));
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
    importedGroup: THREE.Group;
    sunLight: THREE.DirectionalLight;
    sunOrb: THREE.Mesh;
    meshById: Map<string, THREE.Mesh>;
    obstacleMeshById: Map<string, THREE.Mesh>;
    raf: number;
    resizeObserver: ResizeObserver;
  } | null>(null);
  const callbacksRef = useRef({ onSelectPanel, onSelectObstacle, onPanelTransform, onObstacleTransform });
  useEffect(() => {
    callbacksRef.current = { onSelectPanel, onSelectObstacle, onPanelTransform, onObstacleTransform };
  }, [onSelectPanel, onSelectObstacle, onPanelTransform, onObstacleTransform]);

  const antialias = quality !== "fast";
  const normalizedSun = useMemo(() => {
    const v = new THREE.Vector3(...sunVector);
    return v.lengthSq() > 0 ? v.normalize() : new THREE.Vector3(0, 1, 0);
  }, [sunVector]);

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
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    const importedGroup = new THREE.Group();
    scene.add(panelGroup, obstacleGroup, helperGroup, importedGroup);

    const transform = new TransformControls(camera, renderer.domElement);
    transform.setSize(0.7);
    scene.add(transform.getHelper());
    transform.addEventListener("dragging-changed", (event) => {
      orbit.enabled = !event.value;
      if (!event.value && transform.object?.userData.panelId) {
        const object = transform.object;
        if (surfaceSnap) {
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
      const hit = raycaster.intersectObjects([...panelGroup.children, ...obstacleGroup.children], false)[0];
      const panelId = hit?.object.userData.panelId as string | undefined;
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
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      stateRef.current = null;
    };
  }, [antialias, quality, surfaceSnap]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    const { panelGroup, meshById, transform } = state;
    transform.detach();
    panelGroup.clear();
    meshById.clear();

    const geometry = new THREE.BoxGeometry(PANEL_SIZE, PANEL_SIZE, PANEL_DEPTH);
    panels.forEach((panel) => {
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
    panelGroup.rotation.y = rotationAngleRad;
  }, [panels, rotationAngleRad]);

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
    state.obstacleGroup.clear();
    state.obstacleMeshById.clear();
    obstacles.forEach((item) => {
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
  }, [obstacles]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    const boundary = obstacles.find((item) => item.label.startsWith("GLB 차폐 경계"));
    if (!boundary) {
      state.importedGroup.position.set(0, 0, 0);
      state.importedGroup.rotation.set(0, 0, 0);
      state.importedGroup.scale.set(1, 1, 1);
      return;
    }
    state.importedGroup.position.set(boundary.position[0], boundary.position[1] - 0.175, boundary.position[2]);
    state.importedGroup.rotation.set(...(boundary.rotation ?? [0, 0, 0]));
    state.importedGroup.scale.set(...boundary.scale);
  }, [obstacles]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    state.transform.detach();
    const panel = selectedPanelId ? state.meshById.get(selectedPanelId) : undefined;
    const obstacle = selectedObstacleId ? state.obstacleMeshById.get(selectedObstacleId) : undefined;
    if (obstacle) state.transform.attach(obstacle);
    else if (panel) state.transform.attach(panel);
  }, [panels, obstacles, selectedPanelId, selectedObstacleId]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    state.helperGroup.clear();
    const panelGeometry = new THREE.BoxGeometry(PANEL_SIZE, PANEL_SIZE, PANEL_DEPTH);
    panels.forEach((panel) => {
      if (showNormals || panel.id === selectedPanelId) {
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(...panel.quaternion));
        state.helperGroup.add(
          new THREE.ArrowHelper(normal, new THREE.Vector3(...panel.position), 0.035, "#5eead4", 0.011, 0.006),
        );
      }
      if (showRays && sunElevationDeg > 0) {
        const origin = new THREE.Vector3(...panel.position);
        const start = origin.clone().addScaledVector(normalizedSun, 0.22);
        const geometry = new THREE.BufferGeometry().setFromPoints([start, origin]);
        state.helperGroup.add(
          new THREE.Line(
            geometry,
            new THREE.LineDashedMaterial({ color: "#ffd76a", dashSize: 0.012, gapSize: 0.008, opacity: 0.45, transparent: true }),
          ),
        );
      }
    });
    panelGeometry.dispose();
  }, [panels, selectedPanelId, showNormals, showRays, normalizedSun, sunElevationDeg]);

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
    state.importedGroup.clear();
    if (!gltfUrl) return;
    const loader = new GLTFLoader();
    let active = true;
    loader.load(
      gltfUrl,
      (gltf) => {
        if (!active) return;
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
      <div className="scene-scale">격자 1칸 = 1 cm</div>
    </div>
  );
}
