"""Convert one Gameplay Football player to a skinned, animated GLB (SPEC 7, rigged-player trial).

    uv run python -m demo.grf.convert \
        --media out/grf_src/repo/third_party/gfootball_engine/data/media \
        --out web/public/models/grf_player.glb

Inputs (Unlicense, original author Bastiaan Konings Schuiling; fetched into out/, never
committed): objects/players/player.object (skeleton), objects/players/models/fullbody.ase (the
visible body, skin weights in its vertex colours), one hair style, and five animations.

What the converter does:
- Z-up to Y-up, and the model turned to face +x (views/tokens.ts aims a model's local +x).
- Root motion removed: the root keeps only its height offset (the bob); the sim places the
  player. The removed horizontal speed is written to the scene extras as each clip's stride
  speed, which the web gait blend needs to keep the feet from sliding.
- Walk and sprint are single steps in the engine, which mirrors them for the other foot; here
  each becomes a loopable two-step cycle.
- Keys stay on the engine's 10 ms frames (formats.ANIM_FPS) with linear interpolation, which in
  glTF means slerp for rotations, as in the engine.
- Bind pose: the engine skins fullbody.ase against the skeleton in base.anim.util's pose
  (humanoidbase.cpp, PrepareFullbodyModel), so the inverse bind matrices come from that pose.
- One change to the skin weights: the shirt collar (10 kit vertices) is moved from the neck
  joint to the trunk. The engine's clips barely turn the neck; the sim turns heads up to 80°
  on the neck (web/src/players/look.ts), and a collar that turns with the head shears the shirt.
- No textures: the web app draws the kit in the fictional club colours and gives skin, hair and
  boots flat colours, so no source texture (kit template, ad boards, stadium) is used.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

from demo.grf import formats, glb
from demo.grf.formats import ANIM_FPS, Anim, SkelNode

# Engine frame (x = model's left, y = backwards, z = up) to three.js (x = forward, y = up,
# z = model's right).
BASIS = np.array([[0.0, -1.0, 0.0], [0.0, 0.0, 1.0], [-1.0, 0.0, 0.0]])

SOURCE = "google-research/football: third_party/gfootball_engine/data/media"
AUTHOR = "Bastiaan Konings Schuiling (Gameplay Football)"

CLIPS = {
    # Upright idle: the engine's level-1 idle (templates/idleD000.anim is a deep ready crouch).
    "idle": ("animations/movement/idle/000_idlelevel1.anim", "static"),
    "walk": ("animations/templates/walkD000.anim", "cycle"),  # the engine's 5 m/s "walk"
    "sprint": ("animations/templates/sprintD000.anim", "cycle"),
    # The sim's passers stand still at the kick (seed 3: H4 at frame 15, H8 at 75): the
    # standing short pass, ball contact at frame 35.
    "pass": ("animations/pass/idle/000.anim", "once"),
}

# Material groups: one primitive each, recoloured in the web app.
GROUPS = {"kit": {"kit"}, "skin": {"skin", "arm", "knee"}, "boots": {"shoe", "shoe_sole"}}


def to_y_up(v: np.ndarray) -> np.ndarray:
    return np.asarray(v, float) @ BASIS.T


def quat_to_y_up(q: np.ndarray) -> np.ndarray:
    return np.array([*(BASIS @ np.asarray(q[:3], float)), q[3]])


def _trs(position: np.ndarray, rotation: np.ndarray) -> np.ndarray:
    m = np.eye(4)
    m[:3, :3] = formats.quat_matrix(rotation)
    m[:3, 3] = position
    return m


def world_matrices(
    nodes: list[SkelNode], rotations: dict[str, np.ndarray], root: np.ndarray | None = None
) -> np.ndarray:
    """World matrix of every node (engine frame), the root (player) at `root` or the origin."""
    base = np.eye(4)
    if root is not None:
        base[:3, 3] = root
    out = np.zeros((len(nodes), 4, 4))
    for i, n in enumerate(nodes):
        local = _trs(n.position, rotations.get(n.name, n.rotation))
        out[i] = (out[n.parent] if n.parent >= 0 else base) @ local
    return out


def root_track(anim: Anim) -> tuple[np.ndarray, np.ndarray]:
    """Root translation keys in Y-up with the horizontal root motion removed."""
    times = np.array([k for k, _ in anim.root], float) / ANIM_FPS
    heights = np.array([p[2] for _, p in anim.root])
    values = np.zeros((len(heights), 3))
    values[:, 1] = heights
    return times, values


def stride_speed(anim: Anim) -> float:
    """Horizontal speed of the removed root motion over the clip, m/s."""
    a = formats.sample_root(anim, anim.root[0][0])
    b = formats.sample_root(anim, anim.frames)
    return float(np.hypot(*(b - a)[:2]) / (anim.frames / ANIM_FPS))


def kick_yaw(direction: np.ndarray) -> float:
    """Where a kick sends the ball, degrees from the model's forward, positive to its left
    (counter-clockwise from above, like pitch yaw)."""
    d = to_y_up(direction)
    return float(np.degrees(np.arctan2(-d[2], d[0])))


def load_clip(media: Path, path: str, kind: str) -> Anim:
    anim = formats.parse_anim((media / path).read_text())
    return formats.gait_cycle(anim) if kind == "cycle" else anim


# ---------- mesh ----------


def _bones_for(colours: dict, position: np.ndarray) -> list[tuple[int, float]]:
    bones = formats.decode_bones(colours[tuple(float(x) for x in position)])
    if not bones:
        raise ValueError(f"vertex {position} has no skin weight")
    return bones


def build_primitives(
    body: list[formats.AseMesh],
    hair: list[formats.AseMesh],
    neck: int,
    neck_bind: np.ndarray,
    trunk: int,
) -> dict[str, dict[str, np.ndarray]]:
    """Welded vertices per material group, engine frame; hair is rigid on the neck joint and
    the kit never follows the neck (its collar goes to the trunk)."""
    colours = formats.vertex_colours(body)
    groups: dict[str, dict] = {}

    def add(group: str, mesh: formats.AseMesh, transform, bones_of) -> None:
        g = groups.setdefault(group, {"index": {}, "pos": [], "nrm": [], "uv": [], "bones": []})
        for f, face in enumerate(mesh.faces):
            tri = []
            for k in range(3):
                p = transform(mesh.positions[face[k]])
                n = mesh.normals[f, k]
                if group == "hair":
                    n = neck_bind[:3, :3] @ n
                uv = mesh.uv[f, k] if mesh.uv is not None else np.zeros(2)
                key = (round(p[0], 5), round(p[1], 5), round(p[2], 5))
                key += tuple(np.round(n, 4)) + tuple(np.round(uv, 5))
                idx = g["index"].get(key)
                if idx is None:
                    idx = g["index"][key] = len(g["pos"])
                    g["pos"].append(p)
                    g["nrm"].append(n)
                    g["uv"].append(uv)
                    g["bones"].append(bones_of(mesh.positions[face[k]]))
                tri.append(idx)
            g.setdefault("faces", []).append(tri)

    for mesh in body:
        group = next((g for g, mats in GROUPS.items() if mesh.material in mats), None)
        if group is None:
            raise ValueError(f"unknown material {mesh.material!r} on {mesh.name}")
        add(group, mesh, lambda p: p, lambda p: _bones_for(colours, p))
    for mesh in hair:
        add("hair", mesh, lambda p: (neck_bind @ np.array([*p, 1.0]))[:3], lambda p: [(neck, 1.0)])

    out = {}
    for name, g in groups.items():
        joints = np.zeros((len(g["bones"]), 4), np.uint8)
        weights = np.zeros((len(g["bones"]), 4), np.float32)
        for v, bones in enumerate(g["bones"]):
            for s, (j, w) in enumerate(bones[:4]):
                joints[v, s] = j
                weights[v, s] = w
        weights /= weights.sum(axis=1, keepdims=True)
        if name == "kit":
            joints[joints == neck] = trunk
        out[name] = {
            "pos": np.array(g["pos"]),
            "nrm": np.array(g["nrm"]),
            "uv": np.array(g["uv"]),
            "joints": joints,
            "weights": weights,
            "faces": np.array(g["faces"]),
        }
    return out


def skin(prims, nodes, bind_world, pose_rotations, root) -> np.ndarray:
    """Linear-blend-skinned vertex positions of every primitive (engine frame), for checks."""
    pose = world_matrices(nodes, pose_rotations, root)
    mats = pose @ np.linalg.inv(bind_world)
    out = []
    for p in prims.values():
        hom = np.concatenate([p["pos"], np.ones((len(p["pos"]), 1))], axis=1)
        acc = np.zeros_like(hom)
        for s in range(4):
            m = mats[p["joints"][:, s]]
            acc += p["weights"][:, s, None] * np.einsum("vij,vj->vi", m, hom)
        out.append(acc[:, :3])
    return np.concatenate(out)


# ---------- GLB ----------


def write_glb(media: Path, out: Path, hairstyle: str = "short01") -> dict:
    players = media / "objects" / "players"
    nodes = formats.parse_object((players / "player.object").read_text())
    names = [n.name for n in nodes]
    base = formats.parse_anim((media / "animations" / "base.anim.util").read_text())
    bind_rot = {name: track[0][1] for name, track in base.rotations.items()}
    bind_world = world_matrices(nodes, bind_rot)
    neck = names.index("neck")
    body = formats.parse_ase((players / "models" / "fullbody.ase").read_text())
    hair = formats.parse_ase((players / "hairstyles" / f"{hairstyle}.ase").read_text())
    prims = build_primitives(body, hair, neck, bind_world[neck], names.index("middle"))
    clips = {name: load_clip(media, path, kind) for name, (path, kind) in CLIPS.items()}

    b = glb.Builder()
    g = b.gltf
    # Node 0 is the root ("player"), carrying the vertical bob; joints follow in engine order.
    g["nodes"] = [{"name": "player", "children": [1]}]
    for i, n in enumerate(nodes):
        node = {
            "name": n.name,
            "translation": [float(v) for v in to_y_up(n.position)],
            "rotation": [float(v) for v in quat_to_y_up(bind_rot.get(n.name, n.rotation))],
        }
        kids = [j + 1 for j, m in enumerate(nodes) if m.parent == i]
        if kids:
            node["children"] = kids
        g["nodes"].append(node)

    bind_world_y = np.array([_change_basis(m) for m in bind_world])
    ibm = np.linalg.inv(bind_world_y).transpose(0, 2, 1).reshape(-1, 16).astype(np.float32)
    g["skins"] = [
        {
            "name": "grf_skeleton",
            "joints": list(range(1, len(nodes) + 1)),
            "skeleton": 0,
            "inverseBindMatrices": b.add_accessor(ibm, "MAT4", minmax=False),
        }
    ]

    primitives = []
    materials = []
    for name, p in prims.items():
        attrs = {
            "POSITION": b.add_accessor(to_y_up(p["pos"]).astype(np.float32), "VEC3", 34962),
            "NORMAL": b.add_accessor(
                to_y_up(p["nrm"]).astype(np.float32), "VEC3", 34962, minmax=False
            ),
            "TEXCOORD_0": b.add_accessor(p["uv"].astype(np.float32), "VEC2", 34962, minmax=False),
            "JOINTS_0": b.add_accessor(p["joints"], "VEC4", 34962, minmax=False),
            "WEIGHTS_0": b.add_accessor(p["weights"], "VEC4", 34962, minmax=False),
        }
        indices = b.add_accessor(p["faces"].reshape(-1).astype(np.uint16), "SCALAR", 34963)
        materials.append({"name": name, "pbrMetallicRoughness": {"metallicFactor": 0.0}})
        primitives.append({"attributes": attrs, "indices": indices, "material": len(materials) - 1})
    g["materials"] = materials
    g["meshes"] = [{"name": "grf_player", "primitives": primitives}]
    g["nodes"].append({"name": "grf_player_mesh", "mesh": 0, "skin": 0})
    mesh_node = len(g["nodes"]) - 1

    meta = {}
    g["animations"] = []
    for clip_name, anim in clips.items():
        samplers: list[dict] = []
        channels: list[dict] = []
        times, values = root_track(anim)
        _channel(b, samplers, channels, 0, "translation", times, values)
        for name, track in anim.rotations.items():
            if name not in names:
                continue
            qs = np.array([quat_to_y_up(q) for _, q in track])
            for k in range(1, len(qs)):  # keep neighbours in one hemisphere
                if np.dot(qs[k - 1], qs[k]) < 0:
                    qs[k] = -qs[k]
            ts = np.array([k for k, _ in track], float) / ANIM_FPS
            _channel(b, samplers, channels, names.index(name) + 1, "rotation", ts, qs)
        g["animations"].append({"name": clip_name, "samplers": samplers, "channels": channels})
        info = {"duration_s": anim.frames / ANIM_FPS, "source": CLIPS[clip_name][0]}
        if CLIPS[clip_name][1] == "cycle":
            info["stride_speed_mps"] = round(stride_speed(anim), 4)
        if anim.touch_frame is not None:
            info["touch_s"] = anim.touch_frame / ANIM_FPS
        if anim.ball_direction is not None:
            info["ball_yaw_deg"] = round(kick_yaw(anim.ball_direction), 2)
        meta[clip_name] = info

    # Checks on the converted data, engine frame (z up).
    report = {"clips": {}}
    for clip_name, anim in clips.items():
        lows = []
        for f in range(0, anim.frames + 1, 2):
            rot = {n: formats.sample_rotation(anim, n, f) for n in anim.rotations}
            root = np.array([0.0, 0.0, formats.sample_root(anim, f)[2]])
            lows.append(skin(prims, nodes, bind_world, rot, root)[:, 2].min())
        report["clips"][clip_name] = {
            "sole_min_m": float(min(lows)),
            "sole_max_m": float(max(lows)),
        }
    idle = clips["idle"]
    rot = {n: formats.sample_rotation(idle, n, 0) for n in idle.rotations}
    verts = skin(prims, nodes, bind_world, rot, np.array([0, 0, formats.sample_root(idle, 0)[2]]))
    pose = world_matrices(nodes, rot, np.array([0, 0, formats.sample_root(idle, 0)[2]]))
    report["idle_height_m"] = float(verts[:, 2].max())
    report["idle_neck_height_m"] = float(pose[neck][2, 3])
    report["vertices"] = int(sum(len(p["pos"]) for p in prims.values()))
    report["triangles"] = int(sum(len(p["faces"]) for p in prims.values()))

    g["scenes"] = [
        {
            "nodes": [0, mesh_node],
            "extras": {
                "license": "Unlicense",
                "author": AUTHOR,
                "source": SOURCE,
                "converted_by": "demo/grf/convert.py (through-their-eyes)",
                "fps": ANIM_FPS,
                "height_m": round(report["idle_height_m"], 4),
                "neck_height_m": round(report["idle_neck_height_m"], 4),
                "clips": meta,
            },
        }
    ]
    g["scene"] = 0
    report["bytes"] = b.write(out)
    return report


def _channel(
    b: glb.Builder,
    samplers: list[dict],
    channels: list[dict],
    node: int,
    path: str,
    times: np.ndarray,
    values: np.ndarray,
) -> None:
    """One animation channel with a linear sampler (slerp for rotations)."""
    kind = "VEC4" if path == "rotation" else "VEC3"
    samplers.append(
        {
            "input": b.add_accessor(times.astype(np.float32), "SCALAR"),
            "output": b.add_accessor(values.astype(np.float32), kind, None, minmax=False),
            "interpolation": "LINEAR",
        }
    )
    channels.append({"sampler": len(samplers) - 1, "target": {"node": node, "path": path}})


def _change_basis(m: np.ndarray) -> np.ndarray:
    c = np.eye(4)
    c[:3, :3] = BASIS
    return c @ m @ c.T


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--media", type=Path, required=True, help="gfootball_engine/data/media")
    ap.add_argument("--out", type=Path, default=Path("web/public/models/grf_player.glb"))
    ap.add_argument("--hair", default="short01")
    args = ap.parse_args()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    report = write_glb(args.media, args.out, args.hair)
    for name, r in report["clips"].items():
        low, high = r["sole_min_m"], r["sole_max_m"]
        print(f"{name:7s} lowest vertex over the clip: {low:+.3f} .. {high:+.3f} m")
    height, neck = report["idle_height_m"], report["idle_neck_height_m"]
    print(f"idle height {height:.3f} m, neck joint {neck:.3f} m")
    count = f"{report['vertices']} vertices, {report['triangles']} triangles"
    print(f"{count}, {report['bytes']} bytes")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
