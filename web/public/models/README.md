# Rigged player model (SPEC 7)

`grf_player.glb` is one footballer converted from **Gameplay Football** by **Bastiaan Konings
Schuiling**, as shipped in Google Research Football. It is released under the **Unlicense**
(public domain dedication; text in `LICENSE-grf_player.txt`, copied from the source). The
Unlicense asks for no credit; we give it anyway.

- Source: <https://github.com/google-research/football>, commit
  `3d9e754720a95621bba6475c4d3b0d56fe919014`, directory `third_party/gfootball_engine/data/media/`:
  - `objects/players/player.object` (skeleton), `objects/players/models/fullbody.ase` (body and
    skin weights), `objects/players/hairstyles/short01.ase` (hair);
  - `animations/movement/idle/000_idlelevel1.anim` (idle), `animations/templates/walkD000.anim`
    (walk), `animations/templates/sprintD000.anim` (sprint), `animations/pass/idle/000.anim`
    (standing short pass), `animations/base.anim.util` (bind pose).
- Converted by `demo/grf/convert.py` (Z-up to Y-up, facing +x, root motion removed, walk and
  sprint made into two-step cycles). Same inputs give the same bytes.
- No textures from the source are used: no kit template, ad boards or stadium. The web app draws
  the kits in the fictional clubs' colours and gives skin, hair and boots flat colours.

The source files are fetched into `out/` (git-ignored) and never committed; only this converted
model is. The first-person view shows it by default; the "Animated players" toggle switches back
to the tokens.

## The upgraded look (`grf_player_look.glb`, `kit_mask.webp`)

The app dresses the players in the look shared with the trailer's Blender shots (`?look=v1` shows
the plain kits on `grf_player.glb` for comparison). The model is
`grf_player.glb` with additions only (`demo/grf/reskin.py`): every node, skin, clip and accessor
keeps its index and bytes, so the animation code poses both alike (`src/players/lookModel.test.ts`
compares every bone's world matrix through H8's key scan, H9's run and standing players).

- `_LOOK`, one RGBA byte quad per vertex: R ambient occlusion, baked with Cycles from the rest
  pose (0.3 m, 512 samples) and remapped to 0.45–1 so vertices hidden inside the sleeves, boots
  and shorts don't darken the visible ones; G the keepers' long sleeves (skin from the shoulder
  to the wrist ring, picked by skin weight) or the boots' sole ring; B the keepers' gloves (the
  hand rings).
- The kit's normal map (512², WebP): rolled hems at the collar, cuffs, shorts and sock tops, a
  stitch line along the panel edges, soft folds at the waist, the armpits and the shorts. A
  height field defined on the body in 3D, rasterised into the kit UVs, turned into a tangent-space
  map in glTF's convention.
- `kit_mask.webp` (256², lossless), in the same UVs: R side panels (where the torso and the outer
  thighs face sideways), G raglan sleeves (a straight seam from the armpit to the collar, the same
  front and back), B trims (collar, cuffs, shorts hems, a sock band). `src/players/kit.ts` colours
  them per kit; nothing in them echoes a real club (no stripes, hoops, sashes, crests or marks).

The bake and the design scripts run outside the repo (`~/tte-blender/reskin`: Blender for the
occlusion, numpy for the rest), next to the trailer's shots, which use the same files. Together
the two files add 17 KB (+22 %) to what the browser loads for the players.
