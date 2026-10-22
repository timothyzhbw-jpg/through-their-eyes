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

# Baked stadium (SPEC 7)

`stadium_baked.glb` is our own: **modelled in Blender from our own procedural scripts**, with no
imported models, photos or textures, and no real stadium, club, sponsor or broadcaster. The
scripts build the same bowl as the app's procedural stadium (`src/views/stadiumGeometry.ts`, same
numbers, pitch coordinates) with a stepped terrace, a crowd of 15,171 flat spectators, lattice
floodlight masts, roof trusses, a row of lamps along the roof's edge, a players' tunnel and two
dugouts; Cycles bakes the floodlights, the roof lamps, a hidden fill under the roof for the stands,
the sky and the ambient occlusion into it. The words on its
boards and ribbon ("Through Their Eyes", "Synthetic match", "All players fictional") are drawn by
the app.

- Stands and roof: one 4096 x 768 lightmap (albedo x light); the grass: a 1024 x 724 map of the
  light alone, which the app puts on its own pitch markings; the crowd, masts and props: vertex
  colours (the square root of the light, so 8 bits keep the darks).
- Geometry compressed with meshopt by gltfpack (meshoptimizer, MIT; decoded by the decoder that
  ships with three.js, MIT); images re-encoded as WebP (EXT_texture_webp) with Pillow (MIT-CMU).
  About 0.8 MB.
- The scripts are not in this repository (bpy scripts may count as derived from Blender's GPL);
  only their output is. Same inputs give the same file up to Cycles' sampling noise.

# Extra player animations (SPEC 7)

`anims_extra.glb` holds animations only: no mesh, no skin, no textures. Its nodes are the 14
skeleton nodes of `grf_player.glb` with the same names and bind transforms, so its clips bind to
the rigged players by bone name and the skeleton is unchanged. Rotations are int16-normalized
quaternions with keys dropped where linear interpolation stays within 0.25°.

Clips:

- `pass_short`: CMU Motion Capture Database, subject 10, trial 02 ("soccer - kick ball"),
  120 Hz, from 0.40 s before to 0.55 s after ball contact. The whole body, in place: the root
  keeps only its height, and planted feet are held still with two-bone IK.
- `shoulder_check_r`: CMU Motion Capture Database, subject 139, trial 04 ("Looking Around"),
  0.68–1.50 s. Only the trunk joint (`middle`); the head stays the sim's.
- `shoulder_check_l`: the same, mirrored left to right.

- Terms (checked 2026-10-21 on <https://mocap.cs.cmu.edu/>): the data is free for all uses and may
  be included in commercially sold products, but not resold directly, even in converted form.
  Downloaded from the official site only (not from third-party mirrors, which carry other
  licences).
- Acknowledgement, as the database asks: _The data used in this project was obtained from
  mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217._
- The CMU data is motion capture of lab subjects, not match data or footage: no real match, club
  or player is in it.
- Retargeted onto this skeleton by direction matching: each bone takes its direction (hip to knee,
  knee to ankle, ankle to toe, and so on) and twist from the source, its length from this model.
  The scripts (numpy; Blender is used only for preview renders) live outside the repo in
  `tte-blender/anims/`, with the source files. The scene extras record each clip's source, its
  ball contact (`touch_s`), the kick's direction and the shoulder check's phases.
- Of Quaternius' Universal Animation Library 1 (CC0) only the walk is used, in its own file
  (below): its jog drops into a deep crouch every step, and its sprint looked no better than the
  engine's.

# The walk (SPEC 7)

`anims_walk.glb` holds one clip, `walk`, bound to the same 14 skeleton nodes in the same way
(animations only, int16 quaternions). It is a file of its own so it can ship, or be dropped, apart
from the extra clips above.

- Source: Quaternius' Universal Animation Library 1, free "Standard" pack, `Walk_Loop`: one
  two-step cycle (1.33 s), retargeted in place by direction matching (each bone takes its
  direction and twist from the source, its length from this model), the root keeping only its
  height.
- Its stride speed (`stride_speed_mps`, 1.01 m/s) is the root speed of the same loop in the
  pack's root-motion file, 0.975 m/s, scaled by leg length. The scene extras also give its
  left-foot strike phase and the engine walk's, measured the same way, so the web app plays it on
  the engine clips' phase.
- Feet: the planted ankle holds still without locking (under 2 mm). The retarget left the boot
  5.5° toe-up, so it is levelled; the root is lifted where the heel would sink at strike, and the
  ankle pitched (at most 12°) to keep the sole down while the source foot is planted. Knees and
  hips are the retarget's.
- Licence: **CC0 1.0** (public domain dedication; `License.txt` in the pack, checked 2026-10-21).
  It asks for no credit; we give it anyway: _Walk: Universal Animation Library by Quaternius
  (quaternius.com)._ Quaternius' page does not say how the animations were made; Digital
  Production (2025-03-21) reports Xsens motion capture. Bowen allowed it on 2026-10-22 on the
  same terms as the CMU clips: animation only, credited. It is not footage or match data.
- Written by `tte-blender/anims/walk.py` (numpy; outside the repo, with the source files):
  `nice -n 10 .venv/bin/python -I ~/tte-blender/anims/walk.py --model web/public/models/grf_player.glb --out web/public/models/anims_walk.glb`.
  Same inputs give the same bytes.
