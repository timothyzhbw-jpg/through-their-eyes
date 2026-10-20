"""A minimal glTF 2.0 binary (GLB) writer: one buffer, 4-byte aligned views, accessors with
min/max where the spec asks for them. Enough for one skinned, animated mesh without textures."""

from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np

COMPONENT = {np.float32: 5126, np.uint16: 5123, np.uint8: 5121, np.uint32: 5125}
WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


class Builder:
    def __init__(self) -> None:
        self.gltf: dict = {
            "asset": {"version": "2.0", "generator": "through-their-eyes demo/grf"},
            "buffers": [],
            "bufferViews": [],
            "accessors": [],
        }
        self.blob = bytearray()

    def add_accessor(
        self,
        array: np.ndarray,
        kind: str,
        target: int | None = None,
        minmax: bool = True,
        normalized: bool = False,
    ) -> int:
        dtype = next(t for t in COMPONENT if array.dtype == t)
        data = np.ascontiguousarray(array).tobytes()
        while len(self.blob) % 4:
            self.blob.append(0)
        view = {"buffer": 0, "byteOffset": len(self.blob), "byteLength": len(data)}
        if target is not None:
            view["target"] = target
        self.blob += data
        self.gltf["bufferViews"].append(view)
        width = WIDTH[kind]
        acc = {
            "bufferView": len(self.gltf["bufferViews"]) - 1,
            "componentType": COMPONENT[dtype],
            "count": int(array.size // width),
            "type": kind,
        }
        if normalized:
            acc["normalized"] = True
        if minmax:
            flat = array.reshape(-1, width)
            cast = float if dtype == np.float32 else int
            acc["min"] = [cast(v) for v in flat.min(axis=0)]
            acc["max"] = [cast(v) for v in flat.max(axis=0)]
        self.gltf["accessors"].append(acc)
        return len(self.gltf["accessors"]) - 1

    def write(self, path: Path) -> int:
        while len(self.blob) % 4:
            self.blob.append(0)
        self.gltf["buffers"] = [{"byteLength": len(self.blob)}]
        doc = json.dumps(self.gltf, separators=(",", ":")).encode()
        doc += b" " * (-len(doc) % 4)
        total = 12 + 8 + len(doc) + 8 + len(self.blob)
        out = bytearray(struct.pack("<4sII", b"glTF", 2, total))
        out += struct.pack("<I4s", len(doc), b"JSON") + doc
        out += struct.pack("<I4s", len(self.blob), b"BIN\x00") + self.blob
        Path(path).write_bytes(bytes(out))
        return total
