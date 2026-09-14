# VOLTARIS — imported spaceship assets

Every enemy family (44), surface emplacement (12), boss hull (4), boss escort
drone (4) and the player flies a **different** downloaded spaceship. No model is
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
