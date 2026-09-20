# VOLTARIS — imported spaceship assets

Every enemy family (44), boss hull (6), boss escort drone (6) and the player
flies a **different** downloaded spaceship; every surface emplacement (12) is a
different downloaded turret, launcher or tank. No model is
recoloured or reused for another roster slot. The slot-by-slot register is
`data/enemies/imported-fleet.json`; triangle counts and texture sizes of the
packed result are in `/models/imported/manifest.json`.

All three packs are CC0 1.0 Universal (public domain dedication).
https://creativecommons.org/publicdomain/zero/1.0/

## Quaternius — Ultimate Spaceships Pack

https://quaternius.com/packs/ultimatespaceships.html
glTF files from the artist's linked distribution; 2048 px red/blue textures from
Malcolm Nixon's CC0 port: https://github.com/Malcolmnixon/Quaternius-Ultimate-Spaceships-Pack

## Polyy.AI — 3D Spaceships Pack

https://polyyai.itch.io/3d-spaceships-pack
35 GLB spaceships with PBR textures (1024 px base colour and metallic-roughness).

## Polyy.AI — 3D Spaceships Pack 2

https://polyyai.itch.io/3d-spaceships-pack-2
25 GLB spaceships. Ordinary units use the artist's decimated LOD meshes; boss
hulls use the full-detail (~100k triangle) meshes simplified to 60k triangles.

## Quaternius — Turrets Pack and Tanks Pack (surface emplacements)

CC0 1.0 Universal. https://quaternius.com/packs/turrets.html ·
https://quaternius.com/packs/tanks.html
Ten turrets and launchers (GearCannon_2, Upwards_3, Cannon_4, Laser_2,
Teleporter4, Teleporter5, Bomber_2, Upwards_2, Long_2, Cannon_7) and two tanks
(Tank3, Tank2), exported from the artist's .blend files and packed into
`/models/imported/voltaris-ground-units.glb` by `tools/pack-ground-units.mjs`.
The models are untextured; the game paints them per sector.

## Poly Haven — PBR textures (surface stages and emplacement finish)

CC0 1.0 Universal. https://polyhaven.com/license
Resized and recompressed; stored under `/textures/terrain` and `/textures/materials`.

- Dark Rock (dark_rock) by Amal Kumar - https://polyhaven.com/a/dark_rock
- Sandstone Cracks (sandstone_cracks) by Rob Tuytel - https://polyhaven.com/a/sandstone_cracks
- Snow 01 (snow_01) by Rob Tuytel - https://polyhaven.com/a/snow_01
- Metal Plate 02 (metal_plate_02) by Rob Tuytel - https://polyhaven.com/a/metal_plate_02

## Special weapon — NOVA BOMB airframe

"Missile" by Poly by Google, licensed under CC-BY 3.0
(https://creativecommons.org/licenses/by/3.0/), via Poly Pizza:
https://poly.pizza/m/dPVCvXP-S58
Used unmodified as `/models/special/nova-missile.glb`; the game rescales it and
applies its own hull finish and motor flame at runtime.

## Special weapon — NOVA BOMB detonation sound

"Chunky Explosion" by Joth, CC0 1.0 (public domain dedication), via OpenGameArt:
https://opengameart.org/content/chunky-explosion
Stored unmodified as `/audio/nova-blast.mp3`; the game plays its first four
seconds and fades the rumble tail out over the last 0.8 s.

## Adaptations

`tools/pack-imported-fleet.mjs` bakes node transforms, merges each model into a
single primitive, and packs multi-material models into an atlas in which every
textured material keeps its own pixel-exact cell at native resolution. Textures
are re-encoded as WebP; geometry is meshopt-compressed. Original topology, normals
and UVs are otherwise retained. In game each hull is turned to face along the
flight path, rolled toward the camera by a per-model viewing angle and scaled to
its collision radius.

The space backdrops (planets, sector structures, asteroid belts and the
twinkling star field) are the game's own procedural artwork.

## Selectable player fleet and standard ordnance (September 2026)

- KESTREL / MISSILE: **Executioner**, Quaternius, Ultimate Spaceships Pack,
  https://quaternius.com/packs/ultimatespaceships.html — CC0-1.0.
- MANTA / SPREAD: **Spitfire**, Quaternius, same pack and license.
  The artist's original glTFs were downloaded from their public Drive folder;
  textures from the CC0 port at
  https://github.com/Malcolmnixon/Quaternius-Ultimate-Spaceships-Pack.
  Modified: dark red/black (KESTREL) and violet (MANTA) texture paint,
  orientation, scale and PBR finish.
- MISSILE main: **Missile**, Jarlan Perez,
  https://poly.pizza/m/1Xid2Qhqn2s — CC BY 3.0
  (https://creativecommons.org/licenses/by/3.0/).
- MISSILE option: **Missile**, Poly by Google,
  https://poly.pizza/m/dPVCvXP-S58 — CC BY 3.0
  (https://creativecommons.org/licenses/by/3.0/).
- SPREAD main: **Rocket**, hat_my_guy,
  https://poly.pizza/m/9awwTQWYux — CC0-1.0.
- SPREAD option: **rocket_topA, rocket_fuelA, rocket_finsB**, Kenney Space Kit,
  https://kenney.nl/assets/space-kit — CC0-1.0.

The four ordnance designs are stored in `/models/player/`. Adaptations include
reorientation, normalization, assembly of Kenney's modular parts, removal of
the rocket's static flame, vertex paint, accent bands and metallic finish.
The game instances each design as one merged mesh and animates its exhaust.
`tools/import-player-loadout.mjs` records exact download URLs and rebuilds the
assets. `tools/blender/render-player-loadout.py` renders the real ship assets
for the three armament card images (existing STRIKER blue, KESTREL, MANTA).


## Depth scenery

- Distant structures, dishes, crystals and debris: Kenney **Space Kit**, CC0.
  https://kenney.nl/assets/space-kit
  Original GLBs are included; their colors/transforms are batched at runtime.
  Source archive and SHA-256 checksums: `models/scenery/manifest.json`.
- Detailed orbital station: **International Space Station 3D Model**, NASA
  Visualization Technology Applications and Development (VTAD).
  https://science.nasa.gov/resource/international-space-station-3d-model/
  NASA media usage guidelines: https://www.nasa.gov/nasa-brand-center/images-and-media/
  Adaptation: joined meshes, simplified geometry, 1024px WebP texture conversion.
  NASA is credited as the source; no endorsement is implied.
