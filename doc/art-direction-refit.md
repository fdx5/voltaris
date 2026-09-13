# VOLTARIS — capital refit / 2026-09-13

## Reference study

- [Housemarque: Returnal VFX breakdown](https://housemarque.com/news/2021/9/15/returnal-vfx-breakdown): runtime procedural effects and a darker setting provide a useful reference for this project's real-time effects. Application here: bounded instanced missile exhaust, compact bright weapon cores, subdued environmental light.
- [Housemarque: The Art and Science of Explosions](https://housemarque.com/news/2021/8/16/the-art-and-science-of-explosions-h8ly7): the discussion of effects within the player's experience informs our separation of background ornament from combat feedback.
- [MOSS: Raiden V](https://raiden.mossjp.co.jp/raiden5/eng/xboxone/about.html) and [Director's Cut](https://raiden.mossjp.co.jp/raiden5_dc/dc/about.html): references for aircraft presentation, weapon identity, and long-stage presentation. Our interpretation is to give each sector a landmark and each existing weapon a recognizable silhouette.
- User's Macross/Gundam reference informs swept wings, paired nacelles, layered armour and a military aerospace vocabulary. No franchise models, textures or specific vehicle designs are imported.

These are design interpretations, not claims that the implementation duplicates those games' technology or production quality.

## Four sectors

1. **Orbital Gate:** open crescent shipyard, radial docking berths and a distant service convoy. Replaces the previous complete station wheel.
2. **Iron Belt:** derelict mass-driver rails, interrupted bracing and a broken orbital ring, in muted oxide tones.
3. **Io Surface:** a procession of geothermal collectors beneath Jupiter, with a restrained upper-atmosphere ribbon.
4. **Glacial Vault:** a segmented ancient halo behind the ice passage, with cold auroral bands.

Landmarks are cosmetic and placed behind the play plane. Existing terrain and collision rules remain authoritative. Geometry is merged into three finish batches per sector; aurora adds three simple meshes only in sectors three and four. Near-field streak count falls from 90 to 36. Environment colours remain below weapon highlights.

## Fleet

Peregrine III is a twin-engine interceptor with layered swept wings, canards, intake vanes, nozzle throats, framed canopy and canted stabilizers. Both exhausts follow the authored Blender rotation.

Gatekeeper gains armoured shoulders, hangars and command bridges; Ares gains blast doors, launch tubes and heavy stern turbines; Jove gains radial armour cassettes and field generators; Nereid gains overlapping carapace, gill exchangers and jaw accelerators. Capital paint is desaturated; large plates are divided into ballistic tiles. Existing enemy silhouettes retain their identities and gain fitted raised skins on substantial armour panels.

The editable `.blend`, exported `.glb`, manifest and generated hardpoints are rebuilt together. Asset URL revision is `capital-refit-3`. Fleet GLB increases from approximately 12.4 MB to 14.5 MB; combat enemies still use the existing two instanced finish batches. This is a visual refit, not a complete hand-painted PBR texture production pass.

## Combat and HUD

- Score: warm ivory/gold, 24–46 px desktop range, tabular digits and grouping separators, dark local backing; compact landscape/mobile rules.
- Laser: existing thin blue-white core and sheath.
- Scatter: violet crystalline silhouette and alternating narrow/wide fans, preserving shot count and damage.
- Missiles: wider launch spread and separate rail positions, orange three-part exhaust with a fixed 1,536-instance budget.
- Bosses: every third salvo substitutes a contrasting attack. Gatekeeper has a three-row moving passage; Ares launches staggered acceleration fans; Jove uses mirrored wave/plasma phrases; Nereid releases jaw teeth. Alternates replace rather than stack on existing salvos, and remain within 60 shots and 1.3 seconds.

## Validation

Use `npm test`, `npm run test:server`, `npm run lint`, `npm run build`, and the existing Playwright regression suite. The new refit tests verify deterministic alternate attacks, salvo limits, the Gatekeeper passage, and scatter projectile identity.

Blender inspection sheets are generated with `tools/blender/render_fleet.py` in `doc/validation/`. Browser screenshots from the regression suite are in `test-results/`. Neither source geometry checks nor desktop regression tests establish commercial production quality or actual iPhone performance.

Completed checks: production build and lint passed; 92 unit tests and 8 server
tests passed. The game/mobile browser run passed all 17 tests. After the final
star-density, landmark-height and model adjustments, a further 9 browser checks
passed, covering all four sectors, four mobile safe-area sizes (including the
score panel), and actual WebGPU shader compatibility. One initial unit run hit
its five-second timeout while Blender was rendering; subsequent runs passed
without relaxing the timeout.

The local application is started with `npm run dev` at `http://localhost:5173/`,
using the project's existing connection configuration.
