import {
  AmbientLight,
  Box3,
  Box3Helper,
  Color,
  DirectionalLight,
  GridHelper,
  Mesh as ThreeMesh,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BBox, Mesh } from '@yacad/geometry';
import { meshToBufferGeometry } from './geometry';

/**
 * A self-contained three.js viewport. The renderer walks no DAG itself — the
 * app feeds it the evaluated root mesh — but it supports progressive display:
 * `showPlaceholder` draws a bounding-box wireframe while evaluation is in
 * flight, then `setMesh` swaps in the final geometry.
 */
export class Viewport {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly material = new MeshStandardMaterial({
    color: 0x4f9dde,
    metalness: 0.1,
    roughness: 0.6,
  });
  private current: Object3D | undefined;
  private raf = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.scene.background = new Color(0x1e1e22);

    this.camera = new PerspectiveCamera(50, 1, 0.1, 10000);
    this.camera.position.set(60, 50, 80);

    this.controls = new OrbitControls(this.camera, canvas);
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
  }

  /** Show a bounding-box wireframe placeholder while evaluation runs. */
  showPlaceholder(bbox: BBox): void {
    const box = new Box3(new Vector3(...bbox.min), new Vector3(...bbox.max));
    this.replace(new Box3Helper(box, new Color(0x666666)));
  }

  /** Resize the drawing buffer and update the camera aspect ratio. */
  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.disposeCurrent();
    this.controls.dispose();
    this.renderer.dispose();
  }

  private replace(object: Object3D): void {
    this.disposeCurrent();
    this.current = object;
    this.scene.add(object);
  }

  private disposeCurrent(): void {
    if (!this.current) return;
    this.scene.remove(this.current);
    if (this.current instanceof ThreeMesh) this.current.geometry.dispose();
    this.current = undefined;
  }

  private animate = (): void => {
    this.raf = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}
