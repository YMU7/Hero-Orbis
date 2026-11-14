"use client";

import * as THREE from "three";

// Raycast selection for XR controllers + a desktop mouse fallback (brief §7).
//
// - Only meshes passed to register() are ever hit-tested.
// - XR: renderer.xr.getController(0/1); the ray comes from the controller's
//   world transform every frame; one `select` event = at most one onSelect.
// - Desktop: pointer click on the canvas, ray from the camera.
// - Target: Meta Quest 3 Touch Plus controllers in Meta Quest Browser. The
//   trigger is the WebXR primary action, so it arrives as `select`. Quest
//   hand tracking also works: hands are `generic-hand` tracked-pointer
//   inputs, and a pinch fires `select` (Meta docs: webxr-hands).
// - No hard-coded profile ids: targetRayMode and profiles are reported via
//   onInputInfo so a headset run records exactly what it saw.

export type SelectSource = "xr-controller" | "mouse";

export type InteractionOptions = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  onSelect: (id: string, source: SelectSource, detail: string) => void;
  onInputInfo?: (sources: string[]) => void;
  /** Ignore a second select within this window (one press per selection). */
  debounceMs?: number;
};

const RAY_LENGTH = 6;

export class InteractionManager {
  private readonly opts: InteractionOptions;
  private readonly targets = new Map<THREE.Object3D, string>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly controllers: THREE.XRTargetRaySpace[] = [];
  private readonly connected = new Map<number, XRInputSource>();
  private readonly cleanups: Array<() => void> = [];
  private lastSelectAt = 0;
  private mouseHover: string | null = null;
  /** Target ids currently under any ray/cursor — read by the scene for highlight. */
  readonly hovered = new Set<string>();

  constructor(opts: InteractionOptions) {
    this.opts = opts;
    for (let i = 0; i < 2; i++) this.setupController(i);
    this.setupMouse();
  }

  register(mesh: THREE.Object3D, id: string) {
    this.targets.set(mesh, id);
  }

  private setupController(index: number) {
    const { renderer, scene } = this.opts;
    const controller = renderer.xr.getController(index);

    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1),
    ]);
    const line = new THREE.Line(
      lineGeo,
      new THREE.LineBasicMaterial({ color: 0xffffff }),
    );
    line.name = "ray";
    line.scale.z = RAY_LENGTH;
    controller.add(line);
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.01, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    controller.add(tip);
    controller.visible = false;

    const onConnected = (e: { data: XRInputSource }) => {
      const src = e.data;
      this.connected.set(index, src);
      // Gaze / screen inputs get no visible ray (it would sit in the eye).
      controller.visible = src.targetRayMode === "tracked-pointer";
      this.reportInputs();
    };
    const onDisconnected = () => {
      this.connected.delete(index);
      controller.visible = false;
      this.reportInputs();
    };
    const onSelect = () => {
      const id = this.intersectFromController(controller);
      const src = this.connected.get(index);
      const detail = src
        ? `controller ${index} (${src.handedness}, ${src.targetRayMode})`
        : `controller ${index}`;
      if (id && this.fire(id, "xr-controller", detail)) {
        // Short haptic tick on Quest Touch controllers (no-op for hands /
        // inputs without an actuator).
        const act = (src?.gamepad as
          | (Gamepad & { hapticActuators?: Array<{ pulse?: (v: number, ms: number) => Promise<boolean> }> })
          | undefined)?.hapticActuators?.[0];
        void act?.pulse?.(0.6, 40)?.catch?.(() => undefined);
      }
    };

    // three's typings for XR controller events vary across versions; the
    // event payloads used here (`data: XRInputSource`) are documented in
    // WebXRManager / WebXRController.
    const c = controller as unknown as THREE.EventDispatcher<{
      connected: { data: XRInputSource };
      disconnected: object;
      select: object;
    }>;
    c.addEventListener("connected", onConnected);
    c.addEventListener("disconnected", onDisconnected);
    c.addEventListener("select", onSelect);
    this.cleanups.push(() => {
      c.removeEventListener("connected", onConnected);
      c.removeEventListener("disconnected", onDisconnected);
      c.removeEventListener("select", onSelect);
      scene.remove(controller);
    });

    scene.add(controller);
    this.controllers.push(controller);
  }

  private setupMouse() {
    const { renderer, camera } = this.opts;
    const el = renderer.domElement;
    const ndc = new THREE.Vector2();
    const toNdc = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ndc.set(
        ((ev.clientX - r.left) / r.width) * 2 - 1,
        -((ev.clientY - r.top) / r.height) * 2 + 1,
      );
    };
    const onMove = (ev: PointerEvent) => {
      if (renderer.xr.isPresenting) return;
      toNdc(ev);
      this.raycaster.setFromCamera(ndc, camera);
      this.mouseHover = this.firstHit();
      el.style.cursor = this.mouseHover ? "pointer" : "default";
    };
    const onClick = (ev: PointerEvent) => {
      if (renderer.xr.isPresenting) return;
      toNdc(ev);
      this.raycaster.setFromCamera(ndc, camera);
      const id = this.firstHit();
      if (id) this.fire(id, "mouse", "desktop mouse");
    };
    const onLeave = () => {
      this.mouseHover = null;
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("click", onClick as EventListener);
    el.addEventListener("pointerleave", onLeave);
    this.cleanups.push(() => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("click", onClick as EventListener);
      el.removeEventListener("pointerleave", onLeave);
    });
  }

  private fire(id: string, source: SelectSource, detail: string): boolean {
    const now = performance.now();
    if (now - this.lastSelectAt < (this.opts.debounceMs ?? 300)) return false;
    this.lastSelectAt = now;
    this.opts.onSelect(id, source, detail);
    return true;
  }

  private intersectFromController(controller: THREE.Object3D): string | null {
    this.tmpMatrix.identity().extractRotation(controller.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tmpMatrix);
    return this.firstHit();
  }

  private firstHit(): string | null {
    const hits = this.raycaster.intersectObjects([...this.targets.keys()], true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        const id = this.targets.get(o);
        if (id) return id;
        o = o.parent;
      }
    }
    return null;
  }

  /** Per-frame: update hover set and shorten each visible ray to its hit. */
  update() {
    this.hovered.clear();
    if (this.opts.renderer.xr.isPresenting) {
      for (const c of this.controllers) {
        if (!c.visible) continue;
        const id = this.intersectFromController(c);
        const line = c.getObjectByName("ray");
        const hit = id
          ? this.raycaster.intersectObjects([...this.targets.keys()], true)[0]
          : undefined;
        if (line) line.scale.z = hit ? hit.distance : RAY_LENGTH;
        if (id) this.hovered.add(id);
      }
    } else if (this.mouseHover) {
      this.hovered.add(this.mouseHover);
    }
  }

  private reportInputs() {
    const list = [...this.connected.entries()].map(
      ([i, s]) =>
        `#${i} ${s.handedness} ${s.targetRayMode} [${s.profiles.join(", ")}]`,
    );
    this.opts.onInputInfo?.(list);
  }

  dispose() {
    this.cleanups.forEach((f) => f());
    this.cleanups.length = 0;
    this.targets.clear();
  }
}
