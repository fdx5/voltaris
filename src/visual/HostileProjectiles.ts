import * as T from 'three/webgpu';
import { float, mix, normalView, positionViewDirection, uv, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Layered solid ordnance: a dark contour, enamel body and a small hot face.
 * Shared by all batches; instance colour preserves boss/faction shot colours. */
export function hostileShellMaterial() {
  const m = new T.MeshBasicNodeMaterial({ toneMapped: false, depthTest: false });
  const facing = normalView.dot(positionViewDirection).abs().clamp(0, 1);
  const core = facing.smoothstep(0.78, 0.99);
  m.colorNode = mix(vec3(0.19, 0.23, 0.3), vec3(1, 1, 1), facing.smoothstep(0.08, 0.55)).mul(
    core.mul(0.65).add(0.65),
  );
  return m;
}

/** Soft optical layers have no collision meaning, and never obscure the core. */
export function hostileGlowMaterial(trail: boolean) {
  const m = new T.MeshBasicNodeMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: T.AdditiveBlending,
    toneMapped: false,
  });
  const p = uv();
  const cross = float(1).sub(p.y.sub(0.5).abs().mul(2)).clamp(0, 1);
  const halo = float(1).sub(p.sub(0.5).length().mul(2)).clamp(0, 1);
  m.opacityNode = trail
    ? cross.pow(2).mul(p.x.clamp(0, 1).pow(1.8)).mul(0.32)
    : halo.pow(2.8).mul(0.27);
  return m;
}

export function projectileGeometry(kind: number) {
  const ring = (radius: number, tube: number) => new T.TorusGeometry(radius, tube, 8, 24);
  const combine = (...parts: T.BufferGeometry[]) => {
    const plain = parts.map((p) => (p.index ? p.toNonIndexed() : p));
    const geometry = mergeGeometries(plain);
    plain.forEach((p, i) => {
      if (p !== parts[i]) p.dispose();
    });
    parts.forEach((p) => p.dispose());
    return geometry;
  };
  switch (kind) {
    case 0:
      return combine(new T.SphereGeometry(0.78, 16, 12), ring(0.86, 0.11));
    case 1:
      return new T.CapsuleGeometry(0.8, 2.2, 6, 10).rotateZ(Math.PI / 2);
    case 2:
      return combine(new T.OctahedronGeometry(0.85, 1), ring(0.9, 0.09).rotateX(0.65));
    case 3:
      return combine(
        new T.ConeGeometry(0.78, 2.2, 12).rotateZ(-Math.PI / 2),
        ring(0.56, 0.12)
          .rotateY(Math.PI / 2)
          .translate(-0.65, 0, 0),
      );
    case 4:
      return new T.CapsuleGeometry(0.6, 1.6, 6, 10).rotateZ(Math.PI / 2);
    case 5:
      return combine(new T.SphereGeometry(0.72, 16, 12), ring(0.98, 0.075));
    case 6:
      return combine(new T.IcosahedronGeometry(0.85, 1), ring(1, 0.085).rotateY(0.8));
    case 7:
      return combine(new T.OctahedronGeometry(0.82, 0), ring(0.92, 0.1));
    case 8:
      return new T.ConeGeometry(0.85, 2.8, 5).rotateZ(-Math.PI / 2);
    default:
      return combine(ring(0.82, 0.18), new T.SphereGeometry(0.46, 12, 8));
  }
}
