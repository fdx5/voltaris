import type { InstancedMesh, Object3D } from 'three/webgpu';

/** Reveal hidden first-use effects and empty pools only for an exclusive GPU preparation pass. */
export async function prepareVisibility(
  root: Object3D,
  excluded: ReadonlySet<Object3D>,
  prepare: () => Promise<void>,
) {
  const saved: { object: Object3D; visible: boolean; culled: boolean; count?: number }[] = [];
  const visit = (object: Object3D) => {
    const batch = object as InstancedMesh;
    saved.push({
      object,
      visible: object.visible,
      culled: object.frustumCulled,
      count: batch.isInstancedMesh ? batch.count : undefined,
    });
    object.visible = !excluded.has(object);
    if (!object.visible) return;
    object.frustumCulled = false;
    // One instance exercises the real pipeline and allocates the entire pool's
    // GPU buffers, without drawing thousands of overlapping projectiles.
    if (batch.isInstancedMesh) batch.count = 1;
    object.children.forEach(visit);
  };
  visit(root);
  try {
    await prepare();
  } finally {
    for (const { object, visible, culled, count } of saved) {
      object.visible = visible;
      object.frustumCulled = culled;
      if (count !== undefined) (object as InstancedMesh).count = count;
    }
  }
}
