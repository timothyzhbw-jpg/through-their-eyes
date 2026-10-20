"""Fetch the source footage into out/realfeed/source/ and verify its SHA-256.

    uv run python -m demo.realfeed.download

The footage is never committed. Source: Wikimedia Commons, by savinkins, CC BY 3.0 (see
demo/realfeed/README.md for the full attribution).
"""

from __future__ import annotations

import hashlib
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parents[2]
SOURCE_DIR = ROOT / "out" / "realfeed" / "source"
FILENAME = "futsal_final_2019-10-06.webm"
URL = (
    "https://upload.wikimedia.org/wikipedia/commons/3/30/"
    "%D0%91%D0%B8%D1%82%D0%B2%D0%B0_%D0%9A%D0%BE%D1%80%D0%BF%D0%BE%D1%80%D0%B0%D1%86%D0%B8%D0%B9"
    "_-_2019-10-06_-_%D0%9D%D0%BE%D0%B2%D0%B0_%D0%9F%D0%BE%D1%88%D1%82%D0%B0._-_"
    "%D0%9C%D0%B8%D0%BD%D0%B8-%D1%84%D1%83%D1%82%D0%B1%D0%BE%D0%BB._"
    "%D0%A4%D0%B8%D0%BD%D0%B0%D0%BB..webm"
)
# Original upload, 650,632,692 bytes; the SHA-1 matches the one Commons reports for the file.
SHA256 = "2495b466ced7e0db29538ed38fafcd0c337218d62448521b5c28af5186c47741"
USER_AGENT = "through-their-eyes-demo/0.1 (hackathon entry; https://commons.wikimedia.org)"


def sha256_of(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while block := f.read(chunk):
            h.update(block)
    return h.hexdigest()


def fetch(dest: Path = SOURCE_DIR / FILENAME) -> Path:
    if dest.exists() and sha256_of(dest) == SHA256:
        print(f"ok {dest}")
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    req = urllib.request.Request(URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req) as resp, open(tmp, "wb") as out:
        while block := resp.read(1 << 20):
            out.write(block)
    digest = sha256_of(tmp)
    if digest != SHA256:
        tmp.unlink()
        sys.exit(f"checksum mismatch: got {digest}, expected {SHA256}")
    tmp.rename(dest)
    print(f"downloaded {dest}")
    return dest


if __name__ == "__main__":
    fetch()
