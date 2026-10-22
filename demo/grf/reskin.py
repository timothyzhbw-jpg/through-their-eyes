"""Add the upgraded player look to the converted GLB (SPEC 7): the skeleton, skin weights, clips and
geometry stay byte for byte, so the web app's animation code works unchanged.

    uv run python -m demo.grf.reskin --model web/public/models/grf_player.glb \
        --look ~/tte-blender/reskin/out --out web/public/models/grf_player_look.glb

Inputs in --look (made outside the repo, with Blender for the ambient occlusion and numpy for the
rest, from this model's own rest pose; see web/public/models/README.md):
- `vertex_look.json`: one RGBA byte quad per vertex in the model's vertex order (primitives in
  order). R ambient occlusion, G the keeper's long-sleeve mask (skin) or the sole (boots), B the
  keeper's glove mask (skin), A unused. Written as the application-specific attribute `_LOOK`
  (unsigned bytes, normalised), so viewers that know nothing of it are unaffected.
- `kit_normal.webp`: the kit's tangent-space normal map in its UVs (hems, seams, folds), the kit
  material's `normalTexture` (EXT_texture_webp).

Only appends: every accessor, buffer view and node of the input keeps its index, and the input's
binary chunk is a prefix of the output's.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from pathlib import Path

import numpy as np

from demo.grf.glb import Builder

ARRAY_BUFFER = 34962
LINEAR, LINEAR_MIPMAP_LINEAR, CLAMP = 9729, 9987, 33071


def read_glb(path: Path) -> tuple[dict, bytes]:
    data = path.read_bytes()
    magic, version, _ = struct.unpack("<4sII", data[:12])
    if magic != b"glTF" or version != 2:
        raise ValueError(f"{path} is not a glTF 2.0 binary")
    json_len = struct.unpack("<I", data[12:16])[0]
    doc = json.loads(data[20 : 20 + json_len])
    at = 20 + json_len
    bin_len = struct.unpack("<I", data[at : at + 4])[0]
    return doc, data[at + 8 : at + 8 + bin_len]


def reskin(model: Path, look: Path, out: Path) -> int:
    doc, blob = read_glb(model)
    prims = doc["meshes"][0]["primitives"]
    if any("_LOOK" in p["attributes"] for p in prims) or doc.get("images"):
        raise ValueError(f"{model} already has a look; start from the converter's output")
    quads = np.asarray(json.loads((look / "vertex_look.json").read_text())["look"], dtype=np.uint8)
    normal = (look / "kit_normal.webp").read_bytes()
    if normal[:4] != b"RIFF" or normal[8:12] != b"WEBP":
        raise ValueError("kit_normal.webp is not a WebP image")

    b = Builder()
    b.gltf = doc
    b.blob = bytearray(blob)
    start = 0
    for prim in prims:
        n = doc["accessors"][prim["attributes"]["POSITION"]]["count"]
        part = quads[start : start + n]
        prim["attributes"]["_LOOK"] = b.add_accessor(
            part, "VEC4", target=ARRAY_BUFFER, minmax=False, normalized=True
        )
        start += n
    if start != len(quads):
        raise ValueError(f"vertex_look.json has {len(quads)} vertices, the model {start}")

    while len(b.blob) % 4:
        b.blob.append(0)
    doc["bufferViews"].append({"buffer": 0, "byteOffset": len(b.blob), "byteLength": len(normal)})
    b.blob += normal
    doc["images"] = [{"bufferView": len(doc["bufferViews"]) - 1, "mimeType": "image/webp"}]
    doc["samplers"] = [
        {"magFilter": LINEAR, "minFilter": LINEAR_MIPMAP_LINEAR, "wrapS": CLAMP, "wrapT": CLAMP}
    ]
    doc["textures"] = [{"sampler": 0, "extensions": {"EXT_texture_webp": {"source": 0}}}]
    doc["extensionsUsed"] = ["EXT_texture_webp"]
    doc["extensionsRequired"] = ["EXT_texture_webp"]
    kit = next(m for m in doc["materials"] if m["name"] == "kit")
    kit["normalTexture"] = {"index": 0}
    doc["scenes"][0].setdefault("extras", {})["look"] = {
        "added_by": "demo/grf/reskin.py (through-their-eyes)",
        "base_model_sha256": hashlib.sha256(model.read_bytes()).hexdigest(),
        "vertex_look_sha256": hashlib.sha256((look / "vertex_look.json").read_bytes()).hexdigest(),
        "kit_normal_sha256": hashlib.sha256(normal).hexdigest(),
    }
    return b.write(out)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--model", type=Path, required=True, help="the converter's GLB")
    ap.add_argument("--look", type=Path, required=True, help="vertex_look.json, kit_normal.webp")
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    size = reskin(a.model, a.look.expanduser(), a.out)
    print(f"wrote {a.out} ({size} bytes; the input was {a.model.stat().st_size})")


if __name__ == "__main__":
    main()
