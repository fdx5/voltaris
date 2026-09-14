import { isIOSDevice } from './device';

/**
 * Heavy media - the fleet model, textures and audio - is served from a CDN in
 * production so it does not count against the app host's bandwidth. The build
 * sets `VITE_ASSET_BASE` to the jsDelivr mirror of this repository's `public/`
 * folder, pinned to a commit; in development and tests it is empty and every
 * path resolves against the local server. Small UI images stay on the host.
 */
const BASE = (import.meta.env?.VITE_ASSET_BASE ?? '').replace(/\/$/, '');

/** Resolves a public path such as `/audio/win.mp3` to wherever assets are served from. */
export const asset = (path: string) => {
  if (/^[a-z]+:/i.test(path)) return path;
  let local = path.startsWith('/') ? path : `/${path}`;
  if (local.startsWith('/textures/') && isIOSDevice())
    local = local.replace('/textures/', '/textures-ios/');
  return BASE + local;
};
