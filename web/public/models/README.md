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
- Quaternius' Universal Animation Library 1 (CC0) was retargeted and compared too (walk, jog,
  sprint) and is not used: its jog drops into a deep crouch every step, and its sprint looked no
  better than the engine's.
