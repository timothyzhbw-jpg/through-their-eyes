"""Readers for the Gameplay Football player data (SPEC 7, rigged-player trial).

Three formats, read as data only (nothing from the engine is run):
- `.ase`: 3ds Max ASCII export. `fullbody.ase` is the visible player; its vertex colours encode
  the skin weights. Hair styles are separate `.ase` files in the neck joint's frame.
- `player.object`: XML skeleton. Every <node> has a position and a rotation relative to its
  parent; the depth-first order of the nodes is the joint id used by the vertex colours.
- `.anim`: one CSV line per node: `name,frame,qx,qy,qz,qw,frame,...`, except the first line,
  `player,frame,x,y,z,...`, which is the root translation (the root motion). Optional
  `extension,football,<touch frame>,x,y,z` lines and an XML tail follow.

The engine works in metres with z up; the model faces -y and its left side is at +x. Where a rule
below copies the engine, the comment names the source file in google-research/football's
third_party/gfootball_engine/src.
"""

from __future__ import annotations

import math
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field, replace

import numpy as np

# One animation frame per 10 ms engine step: HumanoidBase::Process advances frameNum by one per
# step and humanoidbase.cpp integrates animations with timeStep_ms = 10. The data agree:
# templates/sprintD000.anim moves 1.68 m in 24 frames = 7.00 m/s = animSprintVelocity.
ANIM_FPS = 100


# ---------- quaternions (x, y, z, w) ----------


def quat_mul(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return np.array(
        [
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz,
        ]
    )


def rotate(q: np.ndarray, v: np.ndarray) -> np.ndarray:
    """Rotate vector v by unit quaternion q."""
    u = np.asarray(q[:3], float)
    w = float(q[3])
    v = np.asarray(v, float)
    t = 2.0 * np.cross(u, v)
    return v + w * t + np.cross(u, t)


def quat_matrix(q: np.ndarray) -> np.ndarray:
    x, y, z, w = q
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )


def slerp(a: np.ndarray, b: np.ndarray, t: float) -> np.ndarray:
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    dot = float(np.dot(a, b))
    if dot < 0:  # shortest arc (Quaternion::MakeSameNeighborhood)
        b = -b
        dot = -dot
    if dot > 0.9995:
        out = a + t * (b - a)
        return out / np.linalg.norm(out)
    theta = math.acos(dot)
    s = math.sin(theta)
    return (math.sin((1 - t) * theta) * a + math.sin(t * theta) * b) / s


# ---------- .ase ----------


@dataclass
class AseMesh:
    name: str
    material: str
    positions: np.ndarray  # (V, 3), engine frame
    faces: np.ndarray  # (F, 3) vertex indices
    uv: np.ndarray | None  # (F, 3, 2) per face corner, glTF convention (origin top-left)
    normals: np.ndarray  # (F, 3, 3) per face corner
    colours: np.ndarray | None  # (F, 3, 3) per face corner, 0..255 integers


def _blocks(text: str) -> list[tuple[int, int]]:
    """Spans of the top-level *GEOMOBJECT { ... } blocks."""
    spans = []
    for m in re.finditer(r"^\*GEOMOBJECT\s*\{", text, re.M):
        depth = 0
        for i in range(m.end() - 1, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    spans.append((m.start(), i + 1))
                    break
    return spans


def _materials(text: str) -> list[str]:
    head = text.split("*GEOMOBJECT", 1)[0]
    names: dict[int, str] = {}
    for m in re.finditer(r"^\t\*MATERIAL (\d+) \{\s*\*MATERIAL_NAME \"([^\"]*)\"", head, re.M):
        names[int(m.group(1))] = m.group(2)
    return [names[i] for i in sorted(names)]


def _rows(block: str, tag: str) -> list[list[str]]:
    return [line.split()[1:] for line in re.findall(rf"\*{tag}\s[^\n]*", block)]


def parse_ase(text: str) -> list[AseMesh]:
    materials = _materials(text)
    meshes = []
    for start, end in _blocks(text):
        block = text[start:end]
        name = re.search(r"\*NODE_NAME \"([^\"]*)\"", block).group(1)
        tm = np.array([[float(x) for x in r[:3]] for r in _rows(block, r"TM_ROW[012]")])
        tm /= np.linalg.norm(tm, axis=1, keepdims=True)  # aseloader.cpp normalises the rows

        verts = {int(r[0]): [float(x) for x in r[1:4]] for r in _rows(block, "MESH_VERTEX")}
        positions = np.array([verts[i] for i in range(len(verts))])
        faces = np.array(
            [[int(r[2]), int(r[4]), int(r[6])] for r in _rows(block, r"MESH_FACE(?=\s+\d+:)")]
        )

        tverts = {int(r[0]): [float(r[1]), float(r[2])] for r in _rows(block, "MESH_TVERT")}
        tfaces = [[int(x) for x in r[1:4]] for r in _rows(block, "MESH_TFACE")]
        uv = None
        if tverts and tfaces:
            t = np.array([tverts[i] for i in range(len(tverts))])
            # The engine negates v (aseloader.cpp); 1 - v is the same with repeat wrapping and
            # puts the origin at the top left, as glTF wants.
            t[:, 1] = 1.0 - t[:, 1]
            uv = t[np.array(tfaces)]

        normals = np.array([[float(x) for x in r[1:4]] for r in _rows(block, "MESH_VERTEXNORMAL")])
        # Row vector times the TM rotation: n' = n.x * ROW0 + n.y * ROW1 + n.z * ROW2.
        normals = normals @ tm
        normals /= np.linalg.norm(normals, axis=1, keepdims=True)
        normals = normals.reshape(len(faces), 3, 3)

        cols = {int(r[0]): [float(x) for x in r[1:4]] for r in _rows(block, "MESH_VERTCOL")}
        cfaces = [[int(x) for x in r[1:4]] for r in _rows(block, "MESH_CFACE")]
        colours = None
        if cols and cfaces:
            c = np.rint(np.array([cols[i] for i in range(len(cols))]) * 255.0)
            colours = c[np.array(cfaces)]

        ref = re.search(r"\*MATERIAL_REF (\d+)", block)
        material = materials[int(ref.group(1))] if ref else ""
        meshes.append(AseMesh(name, material, positions, faces, uv, normals, colours))
    return meshes


def vertex_colours(meshes: list[AseMesh]) -> dict[tuple[float, float, float], tuple[int, ...]]:
    """Colour per vertex position, the first face corner seen winning (gamedefines.cpp,
    GetVertexColors): the engine keys skin weights by position, across all objects."""
    out: dict[tuple[float, float, float], tuple[int, ...]] = {}
    for mesh in meshes:
        if mesh.colours is None:
            continue
        for f, face in enumerate(mesh.faces):
            for k in range(3):
                key = tuple(float(x) for x in mesh.positions[face[k]])
                if key not in out:
                    out[key] = tuple(int(x) for x in mesh.colours[f, k])
    return out


def decode_bones(colour: tuple[int, ...]) -> list[tuple[int, float]]:
    """Joint ids and weights from one vertex colour (humanoidbase.cpp, PrepareFullbodyModel):
    each channel is 10 * joint + digit, weight = digit / 9; weights are normalised and channels
    at or below 0.01 dropped. A first channel with weight 0 fails an assert in the engine; here
    it gives no bones."""
    raw = []
    for c in colour:
        joint = int(math.floor(c * 0.1))
        raw.append((joint, (c - joint * 10.0) / 9.0))
    if raw[0][1] == 0.0:
        return []
    total = sum(w for _, w in raw)
    return [(j, w / total) for j, w in raw if w > 0.01]


# ---------- player.object ----------


@dataclass
class SkelNode:
    name: str
    parent: int  # index into the node list, -1 for the top node
    position: np.ndarray  # relative to the parent, engine frame
    rotation: np.ndarray  # x, y, z, w
    geometry: str | None = None


def _angle_axis(text: str) -> np.ndarray:
    deg, x, y, z = (float(v) for v in text.split(","))
    axis = np.array([x, y, z])
    if deg == 0.0 or not axis.any():
        return np.array([0.0, 0.0, 0.0, 1.0])
    half = math.radians(deg) / 2  # utils.cpp: angle / 360 * 2 pi, then SetAngleAxis
    return np.array([*(math.sin(half) * axis), math.cos(half)])


def parse_object(text: str) -> list[SkelNode]:
    """Skeleton nodes in depth-first pre-order (Node::GetNodes): the index is the joint id."""
    root = ET.fromstring(text)
    nodes: list[SkelNode] = []

    def visit(el: ET.Element, parent: int) -> None:
        geom = el.find("geometry/name")
        nodes.append(
            SkelNode(
                name=el.findtext("name").strip(),
                parent=parent,
                position=np.array([float(v) for v in el.findtext("position").split(",")]),
                rotation=_angle_axis(el.findtext("rotation")),
                geometry=geom.text.strip() if geom is not None else None,
            )
        )
        me = len(nodes) - 1
        for child in el.findall("node"):
            visit(child, me)

    for top in root.findall("node"):
        visit(top, -1)
    return nodes


# ---------- .anim ----------


@dataclass
class Anim:
    root: list[tuple[int, np.ndarray]]  # (frame, x y z) root translation keys
    rotations: dict[str, list[tuple[int, np.ndarray]]] = field(default_factory=dict)
    touch_frame: int | None = None  # ball contact (extension,football,<frame>,...)
    ball_direction: np.ndarray | None = None  # <balldirection> of a kick, engine frame

    @property
    def frames(self) -> int:
        keys = [k for k, _ in self.root]
        for track in self.rotations.values():
            keys += [k for k, _ in track]
        return max(keys)


def parse_anim(text: str) -> Anim:
    root: list[tuple[int, np.ndarray]] = []
    rotations: dict[str, list[tuple[int, np.ndarray]]] = {}
    touch = None
    for line in text.splitlines():
        cells = [c.strip() for c in line.split(",")]
        if not cells[0] or cells[0].startswith("<"):
            break  # XML tail (Animation::Load stops at the first '<' line)
        if cells[0] == "extension":
            if cells[1] == "football":
                touch = int(cells[2])
            continue
        values = cells[1:]
        if cells[0] == "player":
            for i in range(0, len(values), 4):
                xyz = np.array([float(v) for v in values[i + 1 : i + 4]])
                root.append((int(values[i]), xyz))
        else:
            track = []
            for i in range(0, len(values), 5):
                q = np.array([float(v) for v in values[i + 1 : i + 5]])
                track.append((int(values[i]), q / np.linalg.norm(q)))
            rotations[cells[0]] = track
    ball = re.search(r"<balldirection>\s*([^<]+)</balldirection>", text)
    direction = np.array([float(v) for v in ball.group(1).split(",")]) if ball else None
    return Anim(root, rotations, touch, direction)


def _sample(track: list[tuple[int, np.ndarray]], frame: float, interp) -> np.ndarray:
    if frame <= track[0][0]:
        return track[0][1].copy()
    for (f0, v0), (f1, v1) in zip(track, track[1:], strict=False):
        if frame <= f1:
            return interp(v0, v1, (frame - f0) / (f1 - f0))
    return track[-1][1].copy()


def sample_rotation(anim: Anim, node: str, frame: float) -> np.ndarray:
    """Rotation of a node at a frame: slerp between keys (Animation::GetInterpolatedValues)."""
    return _sample(anim.rotations[node], frame, slerp)


def sample_root(anim: Anim, frame: float) -> np.ndarray:
    return _sample(anim.root, frame, lambda a, b, t: a + (b - a) * t)


def mirror(anim: Anim) -> Anim:
    """Animation::Mirror: left and right tracks swap, quaternion y and z flip, root x flips."""

    def other(name: str) -> str:
        if name.startswith("left"):
            return "right" + name[4:]
        if name.startswith("right"):
            return "left" + name[5:]
        return name

    flip = np.array([1.0, -1.0, -1.0, 1.0])
    rotations = {
        other(name): [(k, q * flip) for k, q in track] for name, track in anim.rotations.items()
    }
    root = [(k, p * np.array([-1.0, 1.0, 1.0])) for k, p in anim.root]
    return replace(anim, root=root, rotations=rotations)


def gait_cycle(step: Anim) -> Anim:
    """A loopable gait cycle: the step, then its mirror (the engine alternates feet by
    mirroring). The root keeps moving: the mirrored step starts where the first one ended."""
    n = step.frames
    m = mirror(step)
    end = sample_root(step, n)
    offset = np.array([end[0], end[1], 0.0])
    root = list(step.root) + [(k + n, p + offset) for k, p in m.root if k > 0]
    rotations = {
        name: list(track) + [(k + n, q) for k, q in m.rotations[name] if k > 0]
        for name, track in step.rotations.items()
    }
    return Anim(root, rotations, None)
