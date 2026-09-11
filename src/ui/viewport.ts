/** One visible viewport for the app, canvas and overlays (Safari and installed PWA). */
export function installViewport() {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  let frame = 0;
  const update = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      // Do not resize gameplay around accessibility pinch zoom.
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
      const width = viewport?.width || window.innerWidth;
      const height = viewport?.height || window.innerHeight;
      root.style.setProperty('--viewport-width', `${width}px`);
      root.style.setProperty('--viewport-height', `${height}px`);
      root.style.setProperty('--viewport-top', `${viewport?.offsetTop || 0}px`);
      root.style.setProperty('--viewport-left', `${viewport?.offsetLeft || 0}px`);
    });
  };
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  window.addEventListener('pageshow', update);
  document.addEventListener('fullscreenchange', update);
  document.addEventListener('webkitfullscreenchange', update);
  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
  update();
}
