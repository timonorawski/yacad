import {
  AmbientLight,
  Box3,
  Box3Helper,
  Color,
  DirectionalLight,
  EdgesGeometry,
  GridHelper,
  LineBasicMaterial,
  LineSegments,
  Mesh as ThreeMesh,
  MeshStandardMaterial,
  type Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BBox, Geometry, Mesh } from '@yacad/geometry';
import { geometryToObject3D, meshToBufferGeometry } from './geometry';
import type { TriangulateApi } from './cross-section-mesh';

/** Display modes for 3D meshes. */
export type DisplayMode = 'solid' | 'wireframe' | 'solid+edges';

/** Named orthographic projection directions. */
export type ProjectionView = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'isometric';

/**
 * A self-contained three.js viewport. The renderer walks no DAG itself — the
 * app feeds it the evaluated root mesh — but it supports progressive display:
 * `showPlaceholder` draws a bounding-box wireframe while evaluation is in
 * flight, then `setMesh` swaps in the final geometry.
 */
export class Viewport {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly perspCamera: PerspectiveCamera;
  private readonly orthoCamera: OrthographicCamera;
  private activeCamera: PerspectiveCamera | OrthographicCamera;
  private readonly controls: OrbitControls;
  private readonly material = new MeshStandardMaterial({
    color: 0x4f9dde,
    metalness: 0.1,
    roughness: 0.6,
  });
  private current: Object3D | undefined;
  private edgesOverlay: LineSegments | undefined;
  private raf = 0;
  private displayMode: DisplayMode = 'solid';
  private width = 1;
  private height = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.scene.background = new Color(0x1e1e22);

    this.perspCamera = new PerspectiveCamera(50, 1, 0.1, 10000);
    this.perspCamera.position.set(60, 50, 80);

    this.orthoCamera = new OrthographicCamera(-100, 100, 100, -100, 0.1, 10000);
    this.orthoCamera.position.set(60, 50, 80);

    this.activeCamera = this.perspCamera;

    this.controls = new OrbitControls(this.activeCamera, canvas);
    this.controls.enableDamping = true;

    const key = new DirectionalLight(0xffffff, 2.2);
    key.position.set(40, 80, 60);
    this.scene.add(
      key,
      new AmbientLight(0xffffff, 0.5),
      new GridHelper(200, 20, 0x444444, 0x2a2a2a),
    );

    this.animate();
  }

  /** Swap in the final geometry. */
  setMesh(mesh: Mesh): void {
    this.replace(new ThreeMesh(meshToBufferGeometry(mesh), this.material));
    this.applyDisplayMode();
  }

  /**
   * Swap in any evaluated geometry — dispatches on `kind` so both 3D meshes
   * and 2D cross-sections are handled. The Manifold API is required for the
   * 2D triangulation path.
   */
  setGeometry(geometry: Geometry, api: TriangulateApi): void {
    this.replace(geometryToObject3D(geometry, api));
    this.applyDisplayMode();
  }

  /**
   * Swap in a pre-built Object3D directly. Use this when the caller has
   * already converted geometry to a scene object (e.g. via `geometryToObject3D`).
   */
  setObject3D(object: Object3D): void {
    this.replace(object);
    this.applyDisplayMode();
  }

  /** Show a bounding-box wireframe placeholder while evaluation runs. */
  showPlaceholder(bbox: BBox): void {
    const box = new Box3(new Vector3(...bbox.min), new Vector3(...bbox.max));
    this.replace(new Box3Helper(box, new Color(0x666666)));
  }

  /** Resize the drawing buffer and update the camera aspect ratio. */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.perspCamera.aspect = width / Math.max(height, 1);
    this.perspCamera.updateProjectionMatrix();
    this.updateOrthoBounds();
  }

  /** Set display mode: solid, wireframe, or solid+edges. */
  setDisplayMode(mode: DisplayMode): void {
    this.displayMode = mode;
    this.applyDisplayMode();
  }

  /** Get the current display mode. */
  getDisplayMode(): DisplayMode {
    return this.displayMode;
  }

  /** Fit the entire scene (current object) into the viewport. */
  zoomToExtents(): void {
    const box = this.currentBBox();
    if (!box) return;
    this.fitBox(box);
  }

  /** Fit a specific bounding box into the viewport. */
  zoomToBox(bbox: BBox): void {
    const box = new Box3(new Vector3(...bbox.min), new Vector3(...bbox.max));
    this.fitBox(box);
  }

  /** Snap the camera to an orthographic projection view. */
  setCameraProjection(view: ProjectionView): void {
    const box = this.currentBBox();
    const center = new Vector3();
    let dist = 150;
    if (box) {
      box.getCenter(center);
      dist = box.getSize(new Vector3()).length() * 1.2;
    }

    // Switch to ortho for axis-aligned views
    const useOrtho = view !== 'isometric';
    const pos = center.clone();

    switch (view) {
      case 'front':
        pos.z += dist;
        break;
      case 'back':
        pos.z -= dist;
        break;
      case 'right':
        pos.x += dist;
        break;
      case 'left':
        pos.x -= dist;
        break;
      case 'top':
        pos.y += dist;
        break;
      case 'bottom':
        pos.y -= dist;
        break;
      case 'isometric':
        pos.set(center.x + dist * 0.577, center.y + dist * 0.577, center.z + dist * 0.577);
        break;
    }

    if (useOrtho) {
      this.switchToOrtho();
    } else {
      this.switchToPerspective();
    }

    this.activeCamera.position.copy(pos);
    // For top/bottom, set the up vector so the camera orients correctly.
    if (view === 'top' || view === 'bottom') {
      this.activeCamera.up.set(0, 0, view === 'top' ? -1 : 1);
    } else {
      this.activeCamera.up.set(0, 1, 0);
    }
    this.controls.target.copy(center);
    this.activeCamera.lookAt(center);
    this.controls.update();

    if (box && this.activeCamera instanceof OrthographicCamera) {
      this.fitOrthoToBox(box);
    }
  }

  /** Switch back to perspective camera. */
  switchToPerspective(): void {
    if (this.activeCamera === this.perspCamera) return;
    // Transfer position and target from ortho to perspective
    this.perspCamera.position.copy(this.orthoCamera.position);
    this.perspCamera.up.copy(this.orthoCamera.up);
    this.activeCamera = this.perspCamera;
    this.controls.object = this.perspCamera;
    this.controls.update();
  }

  /** Return true if the viewport is currently in orthographic mode. */
  isOrthographic(): boolean {
    return this.activeCamera instanceof OrthographicCamera;
  }

  /** Zoom the camera in by a fixed factor. */
  zoomIn(): void {
    this.zoomByFactor(0.8);
  }

  /** Zoom the camera out by a fixed factor. */
  zoomOut(): void {
    this.zoomByFactor(1.25);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.disposeCurrent();
    this.controls.dispose();
    this.renderer.dispose();
  }

  // -- private helpers --------------------------------------------------------

  private replace(object: Object3D): void {
    this.disposeCurrent();
    this.current = object;
    this.scene.add(object);
  }

  private disposeCurrent(): void {
    if (!this.current) return;
    this.scene.remove(this.current);
    if (this.current instanceof ThreeMesh) this.current.geometry.dispose();
    this.removeEdgesOverlay();
    this.current = undefined;
  }

  private removeEdgesOverlay(): void {
    if (this.edgesOverlay) {
      this.scene.remove(this.edgesOverlay);
      this.edgesOverlay.geometry.dispose();
      (this.edgesOverlay.material as LineBasicMaterial).dispose();
      this.edgesOverlay = undefined;
    }
  }

  private applyDisplayMode(): void {
    this.removeEdgesOverlay();
    if (!this.current) return;

    // Collect all ThreeMesh instances in the current object tree.
    const meshes: ThreeMesh[] = [];
    this.current.traverse((child) => {
      if (child instanceof ThreeMesh) meshes.push(child);
    });

    for (const mesh of meshes) {
      const mat = mesh.material;
      if (mat instanceof MeshStandardMaterial) {
        mat.wireframe = this.displayMode === 'wireframe';
      }
    }

    if (this.displayMode === 'solid+edges' && meshes.length > 0) {
      // Create an edges overlay group. For simplicity, overlay on the first mesh.
      const primary = meshes[0]!;
      const edgesGeo = new EdgesGeometry(primary.geometry, 30);
      const edgesMat = new LineBasicMaterial({ color: 0x000000, linewidth: 1 });
      this.edgesOverlay = new LineSegments(edgesGeo, edgesMat);
      // Match position/rotation of the source mesh.
      this.edgesOverlay.position.copy(primary.position);
      this.edgesOverlay.rotation.copy(primary.rotation);
      this.edgesOverlay.scale.copy(primary.scale);
      this.scene.add(this.edgesOverlay);
    }
  }

  private currentBBox(): Box3 | undefined {
    if (!this.current) return undefined;
    const box = new Box3();
    box.setFromObject(this.current);
    if (box.isEmpty()) return undefined;
    return box;
  }

  private fitBox(box: Box3): void {
    const center = new Vector3();
    const size = new Vector3();
    box.getCenter(center);
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim === 0) return;

    this.controls.target.copy(center);

    if (this.activeCamera instanceof PerspectiveCamera) {
      const fov = this.activeCamera.fov * (Math.PI / 180);
      const dist = (maxDim / (2 * Math.tan(fov / 2))) * 1.5;
      const dir = new Vector3();
      this.activeCamera.getWorldDirection(dir);
      this.activeCamera.position.copy(center).sub(dir.multiplyScalar(dist));
    } else {
      this.fitOrthoToBox(box);
    }
    this.controls.update();
  }

  private fitOrthoToBox(box: Box3): void {
    const size = new Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) * 0.6;
    const aspect = this.width / Math.max(this.height, 1);
    if (aspect >= 1) {
      this.orthoCamera.top = maxDim;
      this.orthoCamera.bottom = -maxDim;
      this.orthoCamera.left = -maxDim * aspect;
      this.orthoCamera.right = maxDim * aspect;
    } else {
      this.orthoCamera.left = -maxDim;
      this.orthoCamera.right = maxDim;
      this.orthoCamera.top = maxDim / aspect;
      this.orthoCamera.bottom = -maxDim / aspect;
    }
    this.orthoCamera.updateProjectionMatrix();
  }

  private switchToOrtho(): void {
    if (this.activeCamera === this.orthoCamera) return;
    this.orthoCamera.position.copy(this.perspCamera.position);
    this.orthoCamera.up.copy(this.perspCamera.up);
    this.updateOrthoBounds();
    this.activeCamera = this.orthoCamera;
    this.controls.object = this.orthoCamera;
    this.controls.update();
  }

  private updateOrthoBounds(): void {
    const aspect = this.width / Math.max(this.height, 1);
    const halfH = this.orthoCamera.top !== 0 ? Math.abs(this.orthoCamera.top) : 100;
    this.orthoCamera.left = -halfH * aspect;
    this.orthoCamera.right = halfH * aspect;
    this.orthoCamera.top = halfH;
    this.orthoCamera.bottom = -halfH;
    this.orthoCamera.updateProjectionMatrix();
  }

  private zoomByFactor(factor: number): void {
    if (this.activeCamera instanceof PerspectiveCamera) {
      const dir = new Vector3();
      this.activeCamera.getWorldDirection(dir);
      const dist = this.activeCamera.position.distanceTo(this.controls.target);
      const delta = dist * (1 - factor);
      this.activeCamera.position.addScaledVector(dir, delta);
    } else {
      this.orthoCamera.zoom /= factor;
      this.orthoCamera.updateProjectionMatrix();
    }
    this.controls.update();
  }

  private animate = (): void => {
    this.raf = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.activeCamera);
  };
}
