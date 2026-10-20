# Rigged player model (SPEC 7, trial)

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
model is. It is used by the "Rigged players (trial)" toggle in the first-person view, off by
default.
