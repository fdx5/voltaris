import * as T from 'three/webgpu';

/** Upright, cached badges: silhouettes and initials remain readable in combat. */
export function itemMaterial(type: number) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const color = ['#ffad32', '#48e5ff', '#69efaa', '#cc85ff'][type];
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (type === 0) {
    ctx.roundRect(63, 24, 130, 208, 65);
  } else if (type === 1) {
    // Side attachment lugs distinguish an extra weapon from a power capsule.
    ctx.moveTo(62, 45);
    for (const [x, y] of [
      [194, 45],
      [194, 81],
      [226, 81],
      [226, 175],
      [194, 175],
      [194, 211],
      [62, 211],
      [62, 175],
      [30, 175],
      [30, 81],
      [62, 81],
    ])
      ctx.lineTo(x, y);
    ctx.closePath();
  } else {
    const points =
      type === 2
        ? [
            [128, 24],
            [211, 58],
            [200, 154],
            [128, 231],
            [56, 154],
            [45, 58],
          ]
        : [
            [128, 19],
            [224, 128],
            [128, 237],
            [32, 128],
          ];
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  }
  ctx.shadowColor = color;
  ctx.shadowBlur = 15;
  ctx.strokeStyle = color;
  ctx.lineWidth = 9;
  const fill = ctx.createLinearGradient(0, 24, 0, 232);
  fill.addColorStop(0, color);
  fill.addColorStop(0.32, '#172535');
  fill.addColorStop(1, '#080e20');
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.save();
  ctx.clip();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(30, 184, 196, 6);
  ctx.fillRect(30, 63, 196, 4);
  ctx.restore();
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.fillStyle = '#f4fbff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${type === 1 ? 80 : 112}px Arial, sans-serif`;
  ctx.fillText(['P', 'W+', 'H', 'S'][type], 128, 132);
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  return new T.MeshBasicNodeMaterial({
    map,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
}
