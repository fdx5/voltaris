import * as T from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { asset } from '../core/assets';
import { finishHull } from './ImportedFleet';

/**
 * The NOVA BOMB airframe: "Missile" by Poly by Google (CC-BY 3.0, via Poly
 * Pizza), a heavy finned warhead. See public/ASSET-CREDITS.md.
 */
export const NOVA_MISSILE_URL = asset('/models/special/nova-missile.glb');

let source: T.Object3D | null = null;

/** Loads the airframe. A failure is not fatal: the bomb falls back to a built shape. */
export async function loadNovaMissile() {
  try {
    source = (await new GLTFLoader().loadAsync(NOVA_MISSILE_URL)).scene;
  } catch (error) {
    console.warn('[VOLTARIS] NOVA BOMB model unavailable, using a built airframe:', error);
    source = null;
  }
}

/** A stand-in with the same proportions, should the download fail. */
function builtAirframe() {
  const group = new T.Group();
  const paint = new T.MeshStandardNodeMaterial({
    color: '#46523f',
    metalness: 0.5,
    roughness: 0.5,
  });
  group.add(new T.Mesh(new T.CylinderGeometry(0.18, 0.18, 1.6, 20).rotateZ(Math.PI / 2), paint));
  group.add(
    new T.Mesh(
      new T.ConeGeometry(0.18, 0.55, 20).rotateZ(-Math.PI / 2).translate(1.07, 0, 0),
      paint,
    ),
  );
  for (let k = 0; k < 4; k++)
    group.add(
      new T.Mesh(
        new T.BoxGeometry(0.4, 0.5, 0.03).translate(-0.62, 0.25, 0).rotateX((k * Math.PI) / 2),
        paint,
      ),
    );
  return group;
}

/**
 * The bomb, nose along +X, `length` world units long and centred on its
 * middle. `tail` is where the motor sits, for the flame and smoke.
 */
export function makeNovaMissile(length = 2.5) {
  const airframe = source ? source.clone(true) : builtAirframe();
  airframe.traverse((object) => {
    const mesh = object as T.Mesh;
    if (!mesh.isMesh) return;
    const original = mesh.material as T.MeshStandardMaterial;
    // The game's hull finish: reflections, a rim against the black sky, and a
    // little self-glow so the dark paint still reads.
    mesh.material = finishHull(
      new T.MeshStandardNodeMaterial({ map: original.map ?? null, color: original.color }),
      null,
    );
  });
  const box = new T.Box3().setFromObject(airframe);
  const size = box.getSize(new T.Vector3()),
    centre = box.getCenter(new T.Vector3());
  const scale = length / size.x;
  airframe.position.copy(centre).multiplyScalar(-scale);
  airframe.scale.setScalar(scale);
  const root = new T.Group();
  root.name = 'NOVA BOMB';
  root.add(airframe);
  return { root, tail: -length / 2, radius: (Math.max(size.y, size.z) * scale) / 2 };
}
