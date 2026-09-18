# Selectable player fleet

The sortie armament selects the craft: LASER → existing blue STRIKER,
MISSILE → dark-red/black KESTREL (Executioner), SPREAD → violet MANTA (Spitfire).
All three are prepared before the app starts; failed downloads use the existing
retry screen. Models and menu renders are local, deployable assets. Source and
license details: `public/ASSET-CREDITS.md`.

Models face +X with dorsal +Y and span along Z. The rigid airframe rig and
engine children follow the existing eased roll and pitch: neutral flank view,
dorsal on climb, ventral on descent. No skeletal deformation is needed for
these rigid spacecraft. The original LASER model and paint are retained;
its previous fixed 62-degree presentation is removed for neutral side flight.

MISSILE firing intervals are multiplied by 3, SPREAD by 2. This reduces
**sustained projectiles per second** to exactly 1/3 and 1/2 respectively, for
the main ship and every option at all eight levels. Fan count, spread angles,
homing, collision radius, per-projectile damage, LASER and ground salvos retain
their existing rules. Consequently sustained damage also falls with firing
frequency. Keeping complete fans avoids rounding one-shot low levels to zero.

Four external projectile designs are merged into four instanced batches,
with separate paint and smaller option scales. Missile noses follow velocity,
including homing turns; SPREAD retains its existing straight fan behavior.

Rebuild the assets with `node tools/import-player-loadout.mjs` after the existing
fleet sources have been fetched (`node tools/import-space-assets.mjs`). Then run
Blender with `--background --python tools/blender/render-player-loadout.py`.
Runtime models and the three PNG thumbnails are checked in; Blender and source
downloads are not required to run or build the game.

Validation: `tests/unit/player-loadout.test.ts` checks sustained main/option
counts at four representative levels per weapon, and climb/descent/settling.
