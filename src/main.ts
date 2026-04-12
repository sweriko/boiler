import "./style.css";

import * as THREE from "three/webgpu";
import { Timer } from "three/addons/misc/Timer.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import Stats from "stats-gl";
import { Pane } from "tweakpane";

// ============================================================================
// Scene setup
// ============================================================================

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(2, 2, 4);

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

// ============================================================================
// Stats (CPU, GPU, draw calls, triangles)
// ============================================================================

const stats = new Stats({ trackGPU: true });
stats.init(renderer);
document.body.appendChild(stats.dom);

const triPanel = stats.addPanel(new Stats.Panel("TRIS", "#0ff", "#022"));
const callPanel = stats.addPanel(new Stats.Panel("CALLS", "#f80", "#220"));
let maxTris = 1;
let maxCalls = 1;

// ============================================================================
// Main init
// ============================================================================

async function init() {
  await renderer.init();

  // --- Lighting (calibrated for ACES tone mapping) ---
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
  dirLight.position.set(5, 10, 5);
  scene.add(dirLight);

  // --- Ground ---
  const groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(50, 50, 2, 2),
    new THREE.MeshStandardNodeMaterial({ color: 0x333333, roughness: 0.8 }),
  );
  groundMesh.rotateX(-Math.PI / 2);
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
  scene.add(new THREE.GridHelper(50, 50, 0x444444, 0x222222));

  // --- Demo object ---
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardNodeMaterial({ color: 0xff6600, roughness: 0.4, metalness: 0.3 }),
  );
  mesh.position.y = 0.5;
  scene.add(mesh);

  // --- Orbit controls ---
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0.5, 0);

  // ============================================================================
  // Tweakpane
  // ============================================================================

  const params = {
    rotationSpeed: 1.0,
    exposure: 1.0,
    ambientIntensity: 0.8,
    directionalIntensity: 2.0,
  };

  const pane = new Pane({ title: "Controls" });

  const sceneFolder = pane.addFolder({ title: "Scene" });
  sceneFolder.addBinding(params, "exposure", { min: 0.1, max: 3.0, step: 0.05 }).on("change", (ev) => {
    renderer.toneMappingExposure = ev.value;
  });
  sceneFolder.addBinding(params, "ambientIntensity", { label: "Ambient", min: 0, max: 3, step: 0.1 }).on("change", (ev) => {
    ambientLight.intensity = ev.value;
  });
  sceneFolder.addBinding(params, "directionalIntensity", { label: "Directional", min: 0, max: 5, step: 0.1 }).on("change", (ev) => {
    dirLight.intensity = ev.value;
  });

  const objectFolder = pane.addFolder({ title: "Object" });
  objectFolder.addBinding(params, "rotationSpeed", { label: "Rotation Speed", min: 0, max: 5, step: 0.1 });

  // --- Resize ---
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ============================================================================
  // Main loop
  // ============================================================================

  const timer = new Timer();

  function animate(): void {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05); // cap to prevent spiral death

    // --- Update ---
    mesh.rotation.y += params.rotationSpeed * dt;
    controls.update();

    // --- Render ---
    renderer.renderAsync(scene, camera).then(() => {
      renderer.resolveTimestampsAsync("compute");
      renderer.resolveTimestampsAsync("render");
    });

    const { triangles, drawCalls } = renderer.info.render;
    maxTris = Math.max(maxTris, triangles);
    maxCalls = Math.max(maxCalls, drawCalls);
    triPanel.update(triangles, maxTris * 1.2, 0);
    triPanel.updateGraph(triangles, maxTris * 1.2);
    callPanel.update(drawCalls, maxCalls * 1.2, 0);
    callPanel.updateGraph(drawCalls, maxCalls * 1.2);

    stats.update();
  }

  renderer.setAnimationLoop(animate);
}

init().catch(console.error);
