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

# Extra player animations (SPEC 7)

`anims_extra.glb` holds animations only: no mesh, no skin, no textures. Its nodes are the 14
skeleton nodes of `grf_player.glb` with the same names and bind transforms, so its clips bind to
the rigged players by bone name and the skeleton is unchanged. Rotations are int16-normalized
quaternions with keys dropped where linear interpolation stays within 0.25°.

Every clip is keyed by hand for this project. There is no motion-capture data in it.

- `pass_short`: a right-foot kick with a plant step, 0.94 s, ball contact at 0.42 s, in place. Key
  poses (ankle paths, hip and trunk turns, arms out for balance) are set by hand on a synthetic
  body with this model's proportions; the legs are solved by two-bone IK, so the standing foot
  stays still.
- `shoulder_check_r`: the trunk turning about a fifth of the way with a 75° look over the right
  shoulder, dipping slightly towards it, and settling after the head is back. Trunk joint
  (`middle`) only; the head stays the sim's.
- `shoulder_check_l`: the same, mirrored left to right.

The keys and the script that writes this file live outside the repo in `tte-blender/anims/`
(`handkey.py`, numpy only; it maps the keyed body onto this skeleton by bone directions). The
scene extras record each clip's ball contact (`touch_s`), the kick's direction and the shoulder
check's phases.
