"""Gameplay Football player converter (SPEC 7, rigged-player trial): parsers on tiny fixtures,
the Z-up to Y-up change of basis, root-motion removal, the gait cycle and the GLB container.

The fixtures below are hand-written in the formats of the engine's data files; nothing here reads
the downloaded assets, which live in out/ and are never committed. The last tests check the one
converted model that is committed (web/public/models/grf_player.glb)."""

import json
import struct
from pathlib import Path

import numpy as np
import pytest

from demo.grf import convert, formats, glb

ASE = """*3DSMAX_ASCIIEXPORT\t200
*MATERIAL_LIST {
\t*MATERIAL_COUNT 2
\t*MATERIAL 0 {
\t\t*MATERIAL_NAME "skin"
\t\t*MAP_DIFFUSE {
\t\t\t*BITMAP "media/objects/players/textures/skin.jpg"
\t\t}
\t}
\t*MATERIAL 1 {
\t\t*MATERIAL_NAME "kit"
\t}
}
*GEOMOBJECT {
\t*NODE_NAME "shin"
\t*NODE_TM {
\t\t*NODE_NAME "shin"
\t\t*TM_ROW0 0.000\t1.000\t0.000
\t\t*TM_ROW1 -1.000\t0.000\t0.000
\t\t*TM_ROW2 0.000\t0.000\t1.000
\t\t*TM_ROW3 0.000\t0.000\t0.000
\t}
\t*MESH {
\t\t*MESH_NUMVERTEX 4
\t\t*MESH_NUMFACES 2
\t\t*MESH_VERTEX_LIST {
\t\t\t*MESH_VERTEX    0\t0.000\t0.000\t0.000
\t\t\t*MESH_VERTEX    1\t0.100\t0.000\t0.000
\t\t\t*MESH_VERTEX    2\t0.100\t0.000\t0.500
\t\t\t*MESH_VERTEX    3\t0.000\t0.000\t0.500
\t\t}
\t\t*MESH_FACE_LIST {
\t\t\t*MESH_FACE 0: A: 0 B: 1 C: 2 AB: 1 BC: 1 CA: 0\t*MESH_SMOOTHING 1\t*MESH_MTLID 0
\t\t\t*MESH_FACE 1: A: 0 B: 2 C: 3 AB: 0 BC: 1 CA: 1\t*MESH_SMOOTHING 1\t*MESH_MTLID 0
\t\t}
\t\t*MESH_NUMTVERTEX 4
\t\t*MESH_TVERTLIST {
\t\t\t*MESH_TVERT 0\t0.0000\t0.0000\t0.0000
\t\t\t*MESH_TVERT 1\t1.0000\t0.0000\t0.0000
\t\t\t*MESH_TVERT 2\t1.0000\t0.2500\t0.0000
\t\t\t*MESH_TVERT 3\t0.0000\t0.2500\t0.0000
\t\t}
\t\t*MESH_NUMTVFACES 2
\t\t*MESH_TFACELIST {
\t\t\t*MESH_TFACE 0\t0\t1\t2
\t\t\t*MESH_TFACE 1\t0\t2\t3
\t\t}
\t\t*MESH_NUMCVERTEX 2
\t\t*MESH_CVERTLIST {
\t\t\t*MESH_VERTCOL 0\t0.3882\t0.0000\t0.0000
\t\t\t*MESH_VERTCOL 1\t0.3216\t0.0745\t0.0000
\t\t}
\t\t*MESH_NUMCVFACES 2
\t\t*MESH_CFACELIST {
\t\t\t*MESH_CFACE 0\t0\t0\t1
\t\t\t*MESH_CFACE 1\t0\t1\t1
\t\t}
\t\t*MESH_NORMALS {
\t\t\t*MESH_FACENORMAL 0\t0.000\t-1.000\t0.000
\t\t\t\t*MESH_VERTEXNORMAL 0\t1.000\t0.000\t0.000
\t\t\t\t*MESH_VERTEXNORMAL 1\t1.000\t0.000\t0.000
\t\t\t\t*MESH_VERTEXNORMAL 2\t1.000\t0.000\t0.000
\t\t\t*MESH_FACENORMAL 1\t0.000\t-1.000\t0.000
\t\t\t\t*MESH_VERTEXNORMAL 0\t1.000\t0.000\t0.000
\t\t\t\t*MESH_VERTEXNORMAL 2\t1.000\t0.000\t0.000
\t\t\t\t*MESH_VERTEXNORMAL 3\t1.000\t0.000\t0.000
\t\t}
\t}
\t*MATERIAL_REF 1
}
"""

OBJECT = """<object>
\t<node>
\t\t<name>body</name>
\t\t<position>0, 0, 0.96</position>
\t\t<rotation>0, 0, 0, 0</rotation>
\t\t<geometry><filename>models/pelvis.ase</filename><name>pelvis</name></geometry>
\t\t<node>
\t\t\t<name>left_thigh</name>
\t\t\t<position>0.087, 0, -0.01</position>
\t\t\t<rotation>90, 0, 0, 1</rotation>
\t\t\t<node>
\t\t\t\t<name>left_knee</name>
\t\t\t\t<position>0, 0, -0.42</position>
\t\t\t\t<rotation>0, 0, 0, 0</rotation>
\t\t\t</node>
\t\t</node>
\t\t<node>
\t\t\t<name>right_thigh</name>
\t\t\t<position>-0.087, 0, -0.01</position>
\t\t\t<rotation>0, 0, 0, 0</rotation>
\t\t</node>
\t</node>
</object>
"""

# One step: the root moves 0.6 m forward (-y in the engine) and bobs; the left thigh swings.
ANIM = """player,0,0.0,0.0,-0.100000,12,0.010000,-0.300000,-0.070000,24,0.0,-0.600000,-0.100000
body,0,0.000000,0.000000,0.000000,1.000000,24,0.000000,0.000000,0.000000,1.000000
left_thigh,0,-0.200000,0.050000,0.060000,0.976678,24,-0.150000,-0.040000,0.030000,0.987421
right_thigh,0,-0.150000,0.040000,-0.030000,0.987421,24,-0.200000,-0.050000,-0.060000,0.976678
extension,football,10,-0.010000,-0.939999,0.110000
<balldirection>
	0.382057, -0.924139, 0.000000
</balldirection>
<type>
\tmovement
</type>
"""


# ---------- parsers ----------


def test_anim_frame_rate_is_one_frame_per_ten_ms_engine_step():
    # Confirmed from the engine (humanoidbase.cpp: timeStep_ms = 10, one frame per Process step)
    # and from the data: templates/sprintD000.anim moves 1.68 m in 24 frames = 7.00 m/s, the
    # engine's animSprintVelocity.
    assert formats.ANIM_FPS == 100


def test_parse_ase_reads_geometry_uvs_normals_and_material():
    (mesh,) = formats.parse_ase(ASE)
    assert mesh.name == "shin"
    assert mesh.material == "kit"
    np.testing.assert_allclose(mesh.positions[2], [0.1, 0.0, 0.5])
    np.testing.assert_array_equal(mesh.faces, [[0, 1, 2], [0, 2, 3]])
    # glTF UVs have their origin top-left: v is flipped.
    np.testing.assert_allclose(mesh.uv[0, 2], [1.0, 0.75])
    np.testing.assert_allclose(mesh.uv[1, 2], [0.0, 0.75])
    # Vertex normals are rotated by the node TM as a row vector (aseloader.cpp): x -> TM_ROW0.
    np.testing.assert_allclose(mesh.normals[0, 0], [0.0, 1.0, 0.0])


def test_vertex_colours_decode_to_engine_joint_weights():
    # Each colour channel x 255 = 10 * joint + weight digit; weight = digit / 9, then normalised
    # and channels at or below 0.01 dropped (humanoidbase.cpp, PrepareFullbodyModel).
    assert formats.decode_bones((99, 0, 0)) == [(9, 1.0)]
    assert formats.decode_bones((90, 0, 0)) == []  # weight digit 0: the engine rejects it
    bones = formats.decode_bones((82, 19, 0))
    assert [j for j, _ in bones] == [8, 1]
    np.testing.assert_allclose([w for _, w in bones], [2 / 11, 9 / 11])
    (mesh,) = formats.parse_ase(ASE)
    colours = formats.vertex_colours([mesh])
    # First face corner seen for a position wins, as in the engine's colour map.
    assert colours[(0.0, 0.0, 0.0)] == (99, 0, 0)
    assert colours[(0.1, 0.0, 0.0)] == (99, 0, 0)
    assert colours[(0.1, 0.0, 0.5)] == (82, 19, 0)


def test_parse_object_gives_the_joint_hierarchy_in_engine_order():
    nodes = formats.parse_object(OBJECT)
    # Depth-first pre-order, as Node::GetNodes gathers them: the index is the joint id.
    assert [n.name for n in nodes] == ["body", "left_thigh", "left_knee", "right_thigh"]
    assert [n.parent for n in nodes] == [-1, 0, 1, 0]
    np.testing.assert_allclose(nodes[1].position, [0.087, 0.0, -0.01])
    # <rotation> is degrees then axis (utils.cpp GetQuaternionFromString), stored as x, y, z, w.
    s = np.sqrt(0.5)
    np.testing.assert_allclose(nodes[1].rotation, [0.0, 0.0, s, s], atol=1e-7)
    np.testing.assert_allclose(nodes[0].rotation, [0.0, 0.0, 0.0, 1.0])
    assert nodes[0].geometry == "pelvis"


def test_parse_anim_reads_root_rotations_and_touch_frame():
    anim = formats.parse_anim(ANIM)
    assert anim.frames == 24
    assert [k for k, _ in anim.root] == [0, 12, 24]
    np.testing.assert_allclose(anim.root[1][1], [0.01, -0.3, -0.07])
    assert set(anim.rotations) == {"body", "left_thigh", "right_thigh"}
    np.testing.assert_allclose(
        anim.rotations["left_thigh"][0][1], [-0.2, 0.05, 0.06, 0.976678], atol=1e-6
    )
    assert anim.touch_frame == 10
    np.testing.assert_allclose(anim.ball_direction, [0.382057, -0.924139, 0.0])


def test_kick_yaw_is_measured_from_forward_towards_the_left():
    # The standing pass sends the ball 22.5 degrees to the left of straight ahead (+x engine).
    assert convert.kick_yaw(np.array([0.382057, -0.924139, 0.0])) == pytest.approx(22.46, abs=0.01)
    assert convert.kick_yaw(np.array([0.0, -1.0, 0.0])) == pytest.approx(0.0)
    assert convert.kick_yaw(np.array([-1.0, 0.0, 0.0])) == pytest.approx(-90.0)


def test_mirror_swaps_sides_and_reflects_like_the_engine():
    anim = formats.parse_anim(ANIM)
    m = formats.mirror(anim)
    # Animation::Mirror: left/right tracks swap, quaternion y and z flip, root x flips.
    np.testing.assert_allclose(
        m.rotations["left_thigh"][0][1], [-0.15, -0.04, 0.03, 0.987421], atol=1e-6
    )
    np.testing.assert_allclose(m.root[1][1], [-0.01, -0.3, -0.07])


def test_gait_cycle_is_the_step_then_its_mirror_and_loops():
    anim = formats.parse_anim(ANIM)
    cyc = formats.gait_cycle(anim)
    assert cyc.frames == 48
    first = formats.sample_rotation(cyc, "left_thigh", 0)
    last = formats.sample_rotation(cyc, "left_thigh", 48)
    np.testing.assert_allclose(first, last, atol=1e-6)
    # The root keeps moving forward through the mirrored step.
    np.testing.assert_allclose(formats.sample_root(cyc, 48), [0.0, -1.2, -0.1], atol=1e-6)


def test_sample_rotation_slerps_between_keys():
    anim = formats.parse_anim(ANIM)
    mid = formats.sample_rotation(anim, "left_thigh", 12)
    a = np.array(anim.rotations["left_thigh"][0][1])
    b = np.array(anim.rotations["left_thigh"][1][1])
    ref = formats.slerp(a, b, 0.5)
    np.testing.assert_allclose(mid, ref, atol=1e-7)
    np.testing.assert_allclose(np.linalg.norm(mid), 1.0, atol=1e-7)


# ---------- change of basis and root motion ----------


def test_z_up_engine_frame_maps_to_y_up_facing_plus_x():
    # The engine model faces -y with z up and its left side at +x; three.js wants y up and, for
    # views/tokens.ts, the model facing its local +x.
    np.testing.assert_allclose(convert.to_y_up(np.array([0.0, -1.0, 0.0])), [1.0, 0.0, 0.0])
    np.testing.assert_allclose(convert.to_y_up(np.array([0.0, 0.0, 1.0])), [0.0, 1.0, 0.0])
    # Left (+x in the engine) maps to -z: facing +x with y up, left is -z (and pitch +y).
    np.testing.assert_allclose(convert.to_y_up(np.array([1.0, 0.0, 0.0])), [0.0, 0.0, -1.0])
    assert np.isclose(np.linalg.det(convert.BASIS), 1.0)  # a rotation: winding is kept


def test_quaternions_change_basis_consistently_with_vectors():
    rng = np.random.default_rng(0)
    for _ in range(20):
        q = rng.normal(size=4)
        q /= np.linalg.norm(q)
        v = rng.normal(size=3)
        lhs = convert.to_y_up(formats.rotate(q, v))
        rhs = formats.rotate(convert.quat_to_y_up(q), convert.to_y_up(v))
        np.testing.assert_allclose(lhs, rhs, atol=1e-9)


def test_root_motion_is_removed_but_the_vertical_bob_is_kept():
    anim = formats.parse_anim(ANIM)
    times, values = convert.root_track(anim)
    np.testing.assert_allclose(times, [0.0, 0.12, 0.24])
    # Y-up: horizontal x and z are zero, the height offset is kept.
    np.testing.assert_allclose(values[:, [0, 2]], 0.0)
    np.testing.assert_allclose(values[:, 1], [-0.1, -0.07, -0.1])


def test_stride_speed_comes_from_the_root_motion_that_is_removed():
    anim = formats.parse_anim(ANIM)
    assert convert.stride_speed(anim) == pytest.approx(0.6 / 0.24)


# ---------- skeleton, skin and container ----------


def test_inverse_bind_matrices_undo_the_bind_pose():
    nodes = formats.parse_object(OBJECT)
    world = convert.world_matrices(nodes, {})
    ibm = np.linalg.inv(world)
    for w, i in zip(world, ibm, strict=True):
        np.testing.assert_allclose(w @ i, np.eye(4), atol=1e-12)
    # The knee hangs 0.42 m below the thigh, which is turned 90 degrees about the vertical.
    np.testing.assert_allclose(world[2][:3, 3], [0.087, 0.0, 0.53], atol=1e-12)


def test_glb_container_is_valid_and_aligned(tmp_path):
    builder = glb.Builder()
    pos = builder.add_accessor(np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0]], np.float32), "VEC3")
    idx = builder.add_accessor(np.array([0, 1, 2], np.uint16), "SCALAR", target=34963)
    builder.gltf["meshes"] = [{"primitives": [{"attributes": {"POSITION": pos}, "indices": idx}]}]
    builder.gltf["nodes"] = [{"mesh": 0}]
    builder.gltf["scenes"] = [{"nodes": [0]}]
    path = tmp_path / "t.glb"
    builder.write(path)
    data = path.read_bytes()
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    assert (magic, version, length) == (b"glTF", 2, len(data))
    json_len, json_type = struct.unpack_from("<I4s", data, 12)
    assert json_type == b"JSON" and json_len % 4 == 0
    doc = json.loads(data[20 : 20 + json_len])
    bin_len, bin_type = struct.unpack_from("<I4s", data, 20 + json_len)
    assert bin_type == b"BIN\x00" and bin_len % 4 == 0
    assert doc["accessors"][pos]["min"] == [0, 0, 0]
    assert doc["accessors"][pos]["max"] == [1, 1, 0]
    for view in doc["bufferViews"]:
        assert view["byteOffset"] % 4 == 0


# ---------- the committed model ----------

MODEL = Path(__file__).resolve().parents[1] / "web" / "public" / "models" / "grf_player.glb"


def _read_glb(path):
    data = path.read_bytes()
    json_len = struct.unpack_from("<I", data, 12)[0]
    doc = json.loads(data[20 : 20 + json_len])
    binary = data[28 + json_len :]
    return doc, binary


def _accessor(doc, binary, i):
    acc = doc["accessors"][i]
    view = doc["bufferViews"][acc["bufferView"]]
    dtype = {5126: np.float32, 5123: np.uint16, 5121: np.uint8}[acc["componentType"]]
    width = {"SCALAR": 1, "VEC3": 3, "VEC4": 4, "MAT4": 16}[acc["type"]]
    start = view["byteOffset"] + acc.get("byteOffset", 0)
    arr = np.frombuffer(binary, dtype, acc["count"] * width, start)
    return arr.reshape(acc["count"], width) if width > 1 else arr


@pytest.mark.skipif(not MODEL.exists(), reason="model not converted yet")
def test_committed_model_has_the_four_clips_without_root_motion():
    doc, binary = _read_glb(MODEL)
    clips = {a["name"]: a for a in doc["animations"]}
    assert set(clips) == {"idle", "walk", "sprint", "pass"}
    names = [n["name"] for n in doc["nodes"]]
    root = names.index("player")
    for clip in clips.values():
        for ch in clip["channels"]:
            sampler = clip["samplers"][ch["sampler"]]
            times = _accessor(doc, binary, sampler["input"])
            # Keys sit on the engine's 10 ms animation frames.
            np.testing.assert_allclose(times * formats.ANIM_FPS, np.round(times * 100), atol=1e-3)
            if ch["target"]["node"] == root:
                assert ch["target"]["path"] == "translation"
                values = _accessor(doc, binary, sampler["output"])
                np.testing.assert_allclose(values[:, [0, 2]], 0.0)


@pytest.mark.skipif(not MODEL.exists(), reason="model not converted yet")
def test_committed_model_is_y_up_one_skin_and_credits_the_author():
    doc, binary = _read_glb(MODEL)
    assert len(doc["skins"]) == 1
    names = [n["name"] for n in doc["nodes"]]
    joints = [names[j] for j in doc["skins"][0]["joints"]]
    assert joints[:3] == ["body", "middle", "neck"]
    for mesh in doc["meshes"]:
        for prim in mesh["primitives"]:
            acc = doc["accessors"][prim["attributes"]["POSITION"]]
            assert acc["max"][1] < 2.0 and acc["min"][1] > -0.05  # y is up, about 1.9 m tall
    extras = doc["scenes"][0]["extras"]
    assert extras["license"] == "Unlicense"
    assert "Bastiaan Konings Schuiling" in extras["author"]
    assert extras["fps"] == formats.ANIM_FPS


@pytest.mark.skipif(not MODEL.exists(), reason="model not converted yet")
def test_committed_model_kit_does_not_follow_the_neck():
    # The collar is re-homed to the trunk, so a head turned 80 degrees does not shear the shirt.
    doc, binary = _read_glb(MODEL)
    names = [n["name"] for n in doc["nodes"]]
    joints = doc["skins"][0]["joints"]
    neck = joints.index(names.index("neck"))
    materials = [m["name"] for m in doc["materials"]]
    for prim in doc["meshes"][0]["primitives"]:
        j = _accessor(doc, binary, prim["attributes"]["JOINTS_0"])
        w = _accessor(doc, binary, prim["attributes"]["WEIGHTS_0"])
        on_neck = ((j == neck) & (w > 0)).any(axis=1)
        if materials[prim["material"]] == "kit":
            assert not on_neck.any()
        if materials[prim["material"]] == "hair":
            assert on_neck.all()
