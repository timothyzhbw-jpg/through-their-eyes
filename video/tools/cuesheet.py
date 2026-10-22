"""The trailer's cue sheet for the score (SPEC 10): each beat's start, length, chapter, picture
and cut, and the sync points a composer needs (voice lines, freeze and chapter cards, scans,
the story's hits, the kid's goal).

    python3 video/tools/cuesheet.py <commit> [out.md]    # default: print to stdout

Times are seconds from the film's start, for one telling of the story (trailer.json `story`).
"""

import json
import sys
from pathlib import Path

SPEC = Path(__file__).resolve().parents[1] / "trailer.json"
CHAPTERS = {
    "a1-pov": "App (match-cut)",
    "ch1": "CH. I · The Look",
    "ch2": "CH. II · Under Pressure",
    "ch3": "CH. III · The Corner",
    "crew": "The product",
    "s4a-pov": "Story (close)",
    "spec": "Close",
}
# Beat (name after the number) -> (offset in s, what happens there).
MARKS = {
    "s1d-fall": (0.0, "TACKLE contact (hard cut from the POV)"),
    "s2-coach": (5.0, "tablet push (3 frames); the screen fills the frame for the match-cut"),
    "pov-look": (1.5, "SNAP ZOOM onto H9 (2 frames), back at +0.55 s"),
    "rw1": (0.0, "TAPE REWIND 0.45 s, then bl02 replays the moment from the other angle"),
    "s4b-check": (0.1, "S4: the shoulder check"),
    "s4c-drive": (0.0, "S4: the turn and the drive"),
    "s4d-strike": (0.05, "S4: the strike"),
    "s4e-net": (0.6, "S4: the net bulges, the film's peak"),
    "s4f-celebrate": (0.3, "S4: the coach nods; EVERY TOUCH / STARTS WITH A LOOK."),
}


def picture(pic: dict) -> str:
    src = pic.get("src")
    if src == "title":
        return f"title:{pic.get('id')}"
    if src == "clip":
        return f"clip:{str(pic.get('path', '')).split('/')[-1]}"
    if src == "capture":
        return f"app:{pic.get('shot')}"
    if src == "cine":
        return f"in-engine:{pic.get('id')}"
    return str(src)


def sheet(commit: str) -> str:
    spec = json.loads(SPEC.read_text())
    story = spec.get("story", "blender")

    def keep(b: dict) -> bool:
        if b.get("story") is None:
            return True
        pick = story if isinstance(story, str) else story.get(b.get("section"), "blender")
        return b["story"] == pick

    beats = [b for b in spec["beats"] if keep(b)]
    rows, events = [], []
    t, chapter = 0.0, "Story (open)"
    for b in beats:
        name = b["id"].split("-", 1)[1]
        chapter = CHAPTERS.get(name, chapter)
        out = b.get("out", {"type": "cut"})
        cut = out["type"] + (f" {out['dur']}s" if out.get("dur") else "")
        rows.append((t, b["dur"], b["id"], chapter, picture(b["picture"]), cut))
        for v in b.get("vo", []):
            who = (
                "coach"
                if v.get("speaker") == "coach"
                else "zh line"
                if v.get("lang") == "zh"
                else "narrator"
            )
            events.append(
                (t + v["at"], f"VO ({who}) {v['id']}: {v.get('text', '(app narration line)')}")
            )
        for o in b.get("overlays", []):
            if o["title"].startswith("nc-"):
                hold = spec["titles"][o["title"]]["dur"]
                events.append((t + o["at"], f"FREEZE name card {o['title']} (hold {hold} s)"))
            if o["title"] == "studio":
                events.append((t + o["at"], "THROUGH THEIR EYES / SEE WHAT THEY SAW slam"))
        if b["picture"].get("src") == "title" and str(b["picture"].get("id", "")).startswith("ch"):
            events.append((t, f"CHAPTER card {b['picture']['id']} (0.75 s, hard in and out)"))
        if name in MARKS:
            offset, what = MARKS[name]
            events.append((t + offset, what))
        t = round(t + b["dur"], 3)
    lines = [
        "# Trailer cue sheet",
        "",
        f"From `video/trailer.json` at commit **{commit}** (branch `claude/trailer`), telling "
        f"`{story}`. Total **{t:.2f} s**. Times are seconds from the film's start. "
        "Grid: 0.75 s units (seven sixteenths at 140 bpm).",
        "",
        "## Beats",
        "",
        "| start | dur | beat | chapter | picture | cut out |",
        "|---:|---:|---|---|---|---|",
    ]
    lines += [f"| {r[0]:.2f} | {r[1]} | {r[2]} | {r[3]} | {r[4]} | {r[5]} |" for r in rows]
    lines += ["", "## Sync points", "", "| time | event |", "|---:|---|"]
    lines += [f"| {e[0]:.2f} | {e[1]} |" for e in sorted(events)]
    lines += ["", f"Music: `{json.dumps(spec.get('music', []))}`", ""]
    return "\n".join(lines)


if __name__ == "__main__":
    text = sheet(sys.argv[1] if len(sys.argv) > 1 else "HEAD")
    if len(sys.argv) > 2:
        Path(sys.argv[2]).write_text(text)
    else:
        print(text)
