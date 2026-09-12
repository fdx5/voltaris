# VOLTARIS / Independent fleet

`voltaris-fleet.blend` is the editable Blender source. The shared fighter design
was replaced. `tools/blender/unit_designs.py` now contains a separate construction
for every enemy, four unrelated capital ships, twelve different emplacements and
the player's single-turbine lifting body. Helpers manufacture plates, fasteners,
tubes and pressure vessels; no common hostile hull is recoloured or enlarged.

`data/enemies/fleet-designs.json` is the definitive roster: 44 distinct concepts,
44 primary paint colours and 44 named weapon recipes. Examples include a crescent
courier, binocular platform, triple-neck Hydra, split Monolith, asymmetric Scourge,
hollow Wraith and articulated Leviathan.

Each aircraft has an individually authored viewing angle from 0 to 75 degrees.
The gameplay camera stays stable while models present top, side and oblique
profiles. Rotations are baked before normalizing actual vertices to collision
radii. `fleet-hardpoints.json` and `ground-hardpoints.json` record the resulting
weapon positions, which the simulation uses for projectile origins.

## Medium ships

13 of 44 enemy types are medium: Warden, Hydra, Bulwark, Monolith, Arbiter, Scourge,
Basilisk, Anvil, Chimera, Obelisk, Leviathan, Calving and Glacier. Their radii are
1.04–1.28 versus 0.43–0.57 for small craft; base HP is 68–128 versus 4–13.
Stage difficulty still scales actual HP. Every medium burst has more projectiles
and firing steps than a small burst, using its own weapon layout.

Authored spawns target 30% medium per stage. After opening wave caps and the
stage-three multiplier, scheduled shares are 30.2%, 29.5%, 29.7% and 29.5%.
Wave timing and level progression are preserved.

## Bosses and weapons

- Gatekeeper: divided vertical portal and shield drones; zipper, diagonal and iris attacks.
- Ares: asymmetric siege rail and magazine; rail trains and shell ladders.
- Jove: three-arm station and relay drones; triangular waves and orbital attacks.
- Nereid: abyssal leviathan and stingray drones; spine ripples, jaw scissors and shedding scales.

Bosses retain 4/6/8/10 destructible pods. All twelve phase recipes and twelve
emplacement recipes are separate. Timed salvos pause with the simulation, stop
on death and cannot leak into reused pool slots. Phase transitions and bullet
clears also cancel pending shots. Projectile colours follow aircraft palettes.

## Rebuild

Run from the project root:

```powershell
node tools/rebalance-fleet.mjs
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' -b --python tools/blender/build_fleet.py
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' -b --python tools/blender/render_fleet.py
```

The builder saves named editable components, then writes the game GLB, manifest
and hardpoints. The source opens on the player; reveal other named collections
to edit them. The render command produces three labelled inspection sheets in
`doc/validation/`, preserving medium/small size differences and individual views.

The Blender source retains procedural paint variation, edge bevels, engraved
seams, access covers and fasteners. The GLB carries base PBR factors, with the
matching hero/boss microfinish reconstructed in `BlenderFleet.ts`. Ordinary enemies
bake material colours into two instanced batches per type to keep draw calls low.
The complete asset is about 12 MB.

Coordinates are game XYZ, with camera-facing +Z. glTF Y-up conversion is disabled;
do not apply another global axis rotation when loading. The app validates the
whole roster before constructing the renderer and versions the asset URL to avoid
displaying the rejected earlier fleet from an existing browser cache.
