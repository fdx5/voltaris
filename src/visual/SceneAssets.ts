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
export const waitForSceneAssets = () => ready;
