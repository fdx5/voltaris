import { LoadingManager } from 'three/webgpu';

// TextureLoader returns before image decoding finishes. GPU preparation must
// wait for these images as well as the GLTF promises.
export const sceneAssetManager = new LoadingManager();
let ready = Promise.resolve();
let resolveReady: (() => void) | undefined;
sceneAssetManager.onStart = () => {
  ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
};
sceneAssetManager.onLoad = () => {
  resolveReady?.();
};
// onError does not advance the manager's internal loaded/total tally, so a
// single failed texture (404, network blip, decode failure) would otherwise
// keep onLoad from ever firing and hang prepareStage()'s await forever.
sceneAssetManager.onError = () => {
  resolveReady?.();
};
/**
 * `onProgress` reports this pass's texture loads only (0..1); only one
 * prepareStage runs at a time, so a single manager-wide listener is safe.
 */
export function waitForSceneAssets(onProgress?: (fraction: number) => void) {
  sceneAssetManager.onProgress = (_url, loaded, total) =>
    onProgress?.(total > 0 ? loaded / total : 1);
  return ready;
}
