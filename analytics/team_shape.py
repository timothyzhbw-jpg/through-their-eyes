"""Team shape from tracking (SPEC 3.8): length, width, length per width, the defensive line's
height and the distances between the lines, per team and frame, and each frame's phase.

Only positions, who is the keeper and who has the ball are read, so the same functions measure any
tracking source. Definitions, for one team's outfield players (the keeper is left out), as in the
papers the realism report compares with (docs/REFERENCES.md, "Team shape"):
- **length**: the spread along the pitch's long axis, deepest to most advanced player;
- **width**: the spread across it, between the two widest players;
- **length per width**: length / width (Folgado et al. 2014's LpW ratio);
- **defensive line height**: the deepest player's distance from the goal line the team defends
  (Castellano et al. 2013's "defensive height");
- **lines**: defence, midfield and attack, found as Forcher et al. (2024) do: k-means with three
  clusters on each player's mean depth, assigned anew for every possession (here, every spell
  with one team on the ball); the inter-line distances are the distances between the lines' mean
  depths, frame by frame.

Phases, per team: `attack` while it has the ball (a free ball belongs to the team that last had
it), `defence` while the other team has it, and for `transition_frames` after a change of
possession `transition_attack` (it just won the ball) or `transition_defence` (it just lost it).
Frames before anyone has had the ball have no phase.
"""

from __future__ import annotations

from itertools import combinations

import numpy as np

HALF_LENGTH = 52.5  # m
LINES = 3  # defence, midfield, attack

ATTACK, DEFENCE, TRANSITION_ATTACK, TRANSITION_DEFENCE = (
    "attack", "defence", "transition_attack", "transition_defence",
)  # fmt: skip
PHASES = (ATTACK, DEFENCE, TRANSITION_ATTACK, TRANSITION_DEFENCE)


def possession_by_frame(owner_team: np.ndarray) -> np.ndarray:
    """(F,) the team in possession: the owner's team, a free ball the last owner's; -1 before
    anyone has had it."""
    carried = np.array(owner_team, dtype=np.int64)
    for f in range(1, len(carried)):
        if carried[f] < 0:
            carried[f] = carried[f - 1]
    return carried


def phases(possession: np.ndarray, team: int, transition_frames: int) -> np.ndarray:
    """(F,) phase of `team` per frame ("" before anyone has had the ball)."""
    possession = np.asarray(possession)
    out = np.where(possession == team, ATTACK, DEFENCE).astype(object)
    out[possession < 0] = ""
    changes = np.flatnonzero((possession[1:] != possession[:-1]) & (possession[:-1] >= 0)) + 1
    for c in changes:
        span = slice(c, c + transition_frames)
        out[span] = np.where(possession[span] == team, TRANSITION_ATTACK, TRANSITION_DEFENCE)
    return out


def spells(possession: np.ndarray) -> np.ndarray:
    """(F,) an id per spell of one team on the ball (0, 1, ...); -1 before anyone has had it."""
    possession = np.asarray(possession)
    ids = np.cumsum(np.r_[0, possession[1:] != possession[:-1]])
    valid = possession >= 0
    return np.where(valid, ids - (ids[valid][0] if valid.any() else 0), -1)


def kmeans_lines(depth: np.ndarray, k: int = LINES) -> np.ndarray:
    """(n,) line of each player, 0 the deepest: the exact k-means of 1-D depths (the best of all
    splits of the sorted depths into k runs, ties to the first split found)."""
    order = np.argsort(depth, kind="stable")
    d = depth[order]
    best, cuts = np.inf, ()
    for c in combinations(range(1, len(d)), k - 1):
        parts = np.split(d, c)
        sse = sum(float(((p - p.mean()) ** 2).sum()) for p in parts)
        if sse < best - 1e-12:
            best, cuts = sse, c
    labels = np.empty(len(d), dtype=np.int64)
    labels[order] = np.searchsorted(np.array(cuts), np.arange(len(d)), side="right")
    return labels


def shape(pos: np.ndarray, keeper: np.ndarray, attack_sign: int,
          spell: np.ndarray | None = None) -> dict[str, np.ndarray]:  # fmt: skip
    """Per-frame shape of one team.

    pos: (F, n, 2) the team's players; keeper: (n,) True for its keeper (left out);
    attack_sign: +1 if the team attacks +x, else -1; spell: (F,) possession spell ids
    (`spells`) for the lines, which are found once per spell (frames with -1 have none).
    """
    outfield = ~np.asarray(keeper, dtype=bool)
    depth = HALF_LENGTH + attack_sign * pos[:, outfield, 0]
    y = pos[:, outfield, 1]
    length = depth.max(axis=1) - depth.min(axis=1)
    width = y.max(axis=1) - y.min(axis=1)
    out = {
        "length": length,
        "width": width,
        "lpw": np.divide(length, width, out=np.full_like(length, np.nan), where=width > 0),
        "line_height": depth.min(axis=1),
        "centroid_depth": depth.mean(axis=1),
        "centroid_y": y.mean(axis=1),
        "defence_midfield": np.full(len(depth), np.nan),
        "midfield_attack": np.full(len(depth), np.nan),
    }
    if spell is None:
        spell = np.zeros(len(depth), dtype=np.int64)
    for s in np.unique(spell[spell >= 0]):
        frames = np.flatnonzero(spell == s)
        lines = kmeans_lines(depth[frames].mean(axis=0))
        centre = np.stack([depth[frames][:, lines == k].mean(axis=1) for k in range(LINES)])
        out["defence_midfield"][frames] = centre[1] - centre[0]
        out["midfield_attack"][frames] = centre[2] - centre[1]
    return out
