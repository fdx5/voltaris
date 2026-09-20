# Deployment

- Production URL: https://voltaris-nyyo.onrender.com/
- Health endpoint: https://voltaris-nyyo.onrender.com/api/health
- Deploy through the existing Render Node Web Service by pushing validated changes to `origin/main`.
- The user has confirmed this deployment address. Reuse it for future deployments and checks; do not ask for it again.
- `.openai/hosting.json` is legacy metadata. The active production game and authentication API run on Render, as documented in README.md.

# Visual quality

- Use downloaded, detailed 3D scenery with authored textures; the NASA orbital station is the minimum visual quality reference. Do not reintroduce the removed low-poly Space Kit scenery or substitute procedural structures.
- Crescent Beam must not pulse, strobe, or oscillate its specular reflection. Keep emission subdued and its bevel orientation fixed.
- Stage 1's background station passes through the screen exactly twice per run, rather than wrapping continuously.
- All other scenery models appear once per run in separated, stage-specific encounters. Avoid repeated looping props; preserve quiet gaps and load models by sector.
