# Surface batteries — third-party art

- **Sci-Fi Rotary Turret**, David W CG, CC BY 4.0.
  https://opengameart.org/content/sci-fi-rotary-turret
  https://creativecommons.org/licenses/by/4.0/
  Original model and authored PBR textures, including CC0 ambientCG sources.
- **3D Turret PBR texture + Flat Diff Texture**, PolygonDan, CC0.
  https://opengameart.org/content/3d-turret-pbr-texture-flat-diff-texture

VOLTARIS adaptations: separated original moving components, normalized scale,
barrel-length variants, sector paint tint, packed UV geometry, JPEG textures,
combined roughness/metalness channels, 512px mobile derivatives. All twelve
combat slots use these two authored model families; no Quaternius ground models
remain in the active surface battery pack.

Rebuild with `node tools/pack-surface-batteries.mjs` after extracting the two
linked source archives into `.local/vendor/rotary/source` and `polygon`.
