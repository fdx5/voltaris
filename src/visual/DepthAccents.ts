import * as T from 'three/webgpu';
import { attribute, float, uv } from 'three/tsl';
import type { GameState } from '../game/GameState';

/** Shading and pickup presentation only; no gameplay coordinates or hitboxes are changed. */
export class DepthAccents {
  readonly root = new T.Group();
  private readonly pose = new T.Object3D();
  private readonly tint = new T.Color();
  private readonly shadowAlpha = new Float32Array(64);
  private readonly shadows: T.InstancedMesh;
  private readonly pickupRims: T.InstancedMesh;
  constructor() {
    const shadow = new T.PlaneGeometry(2, 2);
    shadow.setAttribute(
      'shadowAlpha',
      new T.InstancedBufferAttribute(this.shadowAlpha, 1).setUsage(T.DynamicDrawUsage),
    );
    const material = new T.MeshBasicNodeMaterial({
      color: '#020609',
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
    });
    material.opacityNode = float(1)
      .sub(uv().sub(0.5).length().mul(2))
      .max(0)
      .pow(1.8)
      .mul(attribute<'float'>('shadowAlpha', 'float'));
    this.shadows = new T.InstancedMesh(shadow, material, 64);
    this.pickupRims = new T.InstancedMesh(
      new T.TorusGeometry(0.46, 0.019, 5, 40),
      new T.MeshStandardNodeMaterial({ color: '#b4cee0', metalness: 0.75, roughness: 0.24 }),
      256,
    );
    for (const mesh of [this.shadows, this.pickupRims]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      this.root.add(mesh);
    }
    this.pickupRims.setColorAt(0, this.tint);
  }
  update(g: Readonly<GameState>, t: number, low: boolean, reducedMotion: boolean) {
    this.root.visible = g.status !== 'menu';
    this.shadows.count = this.pickupRims.count = 0;
    if (!this.root.visible) return;
    if (g.terrain && !low) {
      const cast = (x: number, y: number, radius: number) => {
        if (this.shadows.count >= 64) return;
        const z = -0.8;
        const floor = g.terrain!.height(x + g.scroll, z);
        const height = y - floor;
        if (height < 0 || height > 10) return;
        const spread = radius * (1.05 + height * 0.1);
        this.pose.position.set(x + height * 0.13, floor + 0.06, z);
        this.pose.rotation.set(-Math.PI / 2, 0, 0);
        this.pose.scale.set(spread * 1.7, spread * 0.85, 1);
        this.pose.updateMatrix();
        this.shadows.setMatrixAt(this.shadows.count, this.pose.matrix);
        this.shadowAlpha[this.shadows.count++] = 0.38 * (1 - height / 12);
      };
      if (!g.respawn) cast(g.x, g.y, 0.8);
      for (let i = 0; i < g.enemies.limit; i++)
        if (g.enemies.active[i]) cast(g.enemies.x[i], g.enemies.y[i], g.enemies.radius[i]);
      if ((g.boss || g.midBoss) && !g.bossDying) cast(g.bossX, g.bossY, g.bossDef.coreRadius);
    }
    const colors = ['#ffbe69', '#79dfff', '#8df2bc', '#d8b0ff', '#d295ff', '#7df1ae'];
    for (let i = 0; i < g.items.limit && this.pickupRims.count < 256; i++) {
      if (!g.items.active[i]) continue;
      this.pose.position.set(g.items.x[i], g.items.y[i], -0.12);
      this.pose.scale.setScalar(1);
      this.pose.rotation.set(
        reducedMotion ? 0.28 : 0.35 + Math.sin(t * 0.7 + i) * 0.18,
        reducedMotion ? 0.2 : Math.sin(t * 0.9 + i) * 0.4,
        reducedMotion ? 0 : t * 0.12,
      );
      this.pose.updateMatrix();
      this.pickupRims.setMatrixAt(this.pickupRims.count, this.pose.matrix);
      this.pickupRims.setColorAt(this.pickupRims.count++, this.tint.set(colors[g.items.type[i]]));
    }
    for (const mesh of [this.shadows, this.pickupRims]) {
      mesh.visible = mesh.count > 0;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.shadows.geometry.attributes.shadowAlpha.needsUpdate = true;
    if (this.pickupRims.instanceColor) this.pickupRims.instanceColor.needsUpdate = true;
  }
}
