import "./style.css";

import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import Stats from "stats-gl";
import { Pane } from "tweakpane";

const BACKGROUND_COLOR = 0x070b14;
const MAX_PIXEL_RATIO = 2;

class BoilerplateApp {
  private readonly container: HTMLElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  private readonly renderer = new THREE.WebGPURenderer({
    alpha: false,
    antialias: true,
    outputBufferType: THREE.HalfFloatType,
    trackTimestamp: true,
  });
  private readonly controls: OrbitControls;
  private readonly timer = new THREE.Timer();
  private readonly paneHost: HTMLDivElement;
  private readonly pane: Pane;
  private readonly stats = new Stats({ trackGPU: true });
  private readonly ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
  private readonly keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  private readonly trackedMaterials = new Set<THREE.Material>();
  private readonly trackedGeometries = new Set<THREE.BufferGeometry>();
  private readonly cube: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  private readonly triPanel: InstanceType<typeof Stats.Panel>;
  private readonly drawCallPanel: InstanceType<typeof Stats.Panel>;
  private timestampQueriesSupported = false;
  private maxTriangles = 1;
  private maxDrawCalls = 1;
  private readonly params = {
    ambient: 0.55,
    autoRotate: false,
    dpr: Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO),
    exposure: 1,
    key: 2.4,
    rotationSpeed: 0.65,
  };

  constructor(container: HTMLElement) {
    this.container = container;

    this.paneHost = document.createElement("div");
    this.paneHost.className = "ui-pane";
    this.pane = new Pane({
      container: this.paneHost,
      title: "Controls",
    });
    this.stats.dom.classList.add("ui-stats");
    this.triPanel = this.stats.addPanel(new Stats.Panel("TRIS", "#84fff7", "#08262d"));
    this.drawCallPanel = this.stats.addPanel(new Stats.Panel("CALLS", "#ffc171", "#34210b"));

    this.renderer.domElement.className = "app__canvas";
    this.container.append(this.renderer.domElement, this.stats.dom, this.paneHost);

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.params.exposure;

    this.camera.position.set(3.2, 2.2, 4.6);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = true;
    this.controls.autoRotate = this.params.autoRotate;
    this.controls.autoRotateSpeed = 1;
    this.controls.target.set(0, 0, 0);

    this.timer.connect(document);

    this.cube = new THREE.Mesh(
      this.trackGeometry(new THREE.BoxGeometry(1, 1, 1)),
      this.trackMaterial(
        new THREE.MeshStandardMaterial({
          color: 0xff6c43,
          metalness: 0.08,
          roughness: 0.58,
        }),
      ),
    );

    this.setupScene();
    this.setupPane();
  }

  async init(): Promise<void> {
    await this.renderer.init();
    await this.stats.init(this.renderer);
    this.timestampQueriesSupported = this.renderer.hasFeature("timestamp-query");

    this.handleResize();
    await this.renderer.compileAsync(this.scene, this.camera);

    this.renderer.render(this.scene, this.camera);
    this.flushRenderTimestamps();
    this.updatePerformancePanels();
    this.stats.update();

    window.addEventListener("resize", this.handleResize, { passive: true });
    this.renderer.setAnimationLoop(this.animate);
  }

  dispose(): void {
    window.removeEventListener("resize", this.handleResize);
    this.renderer.setAnimationLoop(null);

    this.timer.dispose();
    this.controls.dispose();
    this.pane.dispose();
    this.stats.dispose();

    for (const geometry of this.trackedGeometries) {
      geometry.dispose();
    }

    for (const material of this.trackedMaterials) {
      material.dispose();
    }

    this.renderer.dispose();
    this.container.replaceChildren();
  }

  showFatalError(error: unknown): void {
    this.renderer.setAnimationLoop(null);

    const errorCard = document.createElement("section");
    errorCard.className = "error-card";

    const title = document.createElement("span");
    title.className = "error-card__title";
    title.textContent = "Renderer initialization failed";

    const description = document.createElement("p");
    description.className = "error-card__meta";
    description.textContent = error instanceof Error ? error.message : "Unknown initialization error.";

    errorCard.append(title, description);

    this.container.replaceChildren(errorCard);
  }

  private setupScene(): void {
    this.scene.background = new THREE.Color(BACKGROUND_COLOR);

    this.keyLight.position.set(3, 4, 2);

    this.scene.add(this.ambientLight, this.keyLight, this.cube);
  }

  private setupPane(): void {
    this.pane.addBinding(this.params, "rotationSpeed", {
      label: "Spin",
      min: 0,
      max: 2,
      step: 0.01,
    });
    this.pane.addBinding(this.params, "exposure", {
      min: 0.5,
      max: 2,
      step: 0.05,
    }).on("change", ({ value }) => {
      this.renderer.toneMappingExposure = value;
    });
    this.pane.addBinding(this.params, "ambient", {
      min: 0,
      max: 2,
      step: 0.05,
    }).on("change", ({ value }) => {
      this.ambientLight.intensity = value;
    });
    this.pane.addBinding(this.params, "key", {
      min: 0,
      max: 6,
      step: 0.1,
    }).on("change", ({ value }) => {
      this.keyLight.intensity = value;
    });
    this.pane.addBinding(this.params, "autoRotate", {
      label: "Camera",
    }).on("change", ({ value }) => {
      this.controls.autoRotate = value;
    });
    this.pane.addBinding(this.params, "dpr", {
      min: 0.5,
      max: MAX_PIXEL_RATIO,
      step: 0.1,
    }).on("change", () => {
      this.handleResize();
    });
  }

  private readonly handleResize = (): void => {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.params.dpr));
    this.renderer.setSize(width, height);
  };

  private readonly animate = (timestamp?: number): void => {
    this.timer.update(timestamp);

    const delta = this.timer.getDelta();
    const rotationStep = delta * this.params.rotationSpeed;

    this.cube.rotation.x += rotationStep * 0.45;
    this.cube.rotation.y += rotationStep;

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.flushRenderTimestamps();
    this.updatePerformancePanels();
    this.stats.update();
  };

  private flushRenderTimestamps(): void {
    if (!this.timestampQueriesSupported) {
      return;
    }

    void this.renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER);
  }

  private updatePerformancePanels(): void {
    const { drawCalls, triangles } = this.renderer.info.render;

    this.maxTriangles = Math.max(this.maxTriangles, triangles, 1);
    this.maxDrawCalls = Math.max(this.maxDrawCalls, drawCalls, 1);

    this.triPanel.update(triangles, this.maxTriangles * 1.15, 0);
    this.triPanel.updateGraph(triangles, this.maxTriangles * 1.15);

    this.drawCallPanel.update(drawCalls, this.maxDrawCalls * 1.15, 0);
    this.drawCallPanel.updateGraph(drawCalls, this.maxDrawCalls * 1.15);
  }

  private trackGeometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.trackedGeometries.add(geometry);
    return geometry;
  }

  private trackMaterial<T extends THREE.Material>(material: T): T {
    this.trackedMaterials.add(material);
    return material;
  }
}

const appElement = document.querySelector<HTMLElement>("#app");

if (!appElement) {
  throw new Error("App root #app was not found.");
}

const app = new BoilerplateApp(appElement);

app.init().catch((error) => {
  console.error(error);
  app.showFatalError(error);
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    app.dispose();
  });
}
