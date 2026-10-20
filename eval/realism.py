"""Realism report (SPEC 3.8): the sim's perception and movement statistics against published values.

    uv run python -m eval.realism --seeds 100-199

Runs `possession_play` (normal passing play, no scripted scans) on held-out seeds and compares each
statistic with a value printed in a paper cited in docs/REFERENCES.md. Only printed numbers count:
a statistic with no printed value is marked "no published reference", never filled in. A row is
"inside" when the pooled sim value lies in the range checked: the printed 95% CI when the paper
gives one, else the printed mean ± 1 SD, else the 95% CI of a printed share computed from its n.
Nothing here tunes the sim. The scan parameters in sim/config.py were fitted to some of these
values on tuning seeds 0-99 (marked †; SPEC 3.4); this report runs held-out seeds. Writes
eval/reports/realism.md.
"""

from __future__ import annotations

import argparse
import math
from collections.abc import Callable
from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np

from analytics.scan_detector import ball_offset
from analytics.vision import wrap_angle
from sim.config import ROLES, SimParams
from sim.engine import Simulation
from sim.perception import longest_scan_s

REPORTS = Path(__file__).parent / "reports"

NO_REFERENCE = "no published reference"
COLUMNS = (
    "Metric", "Sim (pooled)", "Sim, 90% over seeds", "Published", "Range checked", "Source",
    "Inside",
)  # fmt: skip
INSIDE, OUTSIDE, INCONCLUSIVE = "✅ inside", "❌ outside", "inconclusive"
VERDICTS = (INSIDE, OUTSIDE, INCONCLUSIVE)

SCENARIO = "possession_play"
PARAMS = replace(SimParams(), max_duration_s=45.0)
WINDOW_S = 10.0  # scans are counted over the last 10 s of the team's possession (Jordet 2013, 2020)
# A scan still under way when a run stops has no event yet (the sim emits it once the head is
# back), so receptions closer to the end than the longest sim scan are left out.
END_GUARD_S = longest_scan_s(PARAMS)
# Aksum et al. (2021) time a scan by the ball leaving the head-worn scene camera, which films at
# least 82 deg horizontally: the ball is out of frame beyond 41 deg from the head direction.
FRAME_HALF_WIDTH = np.deg2rad(82.0 / 2.0)
MIN_GROUP = 10  # observations per group below which a comparison is inconclusive
BOOTSTRAP = 1000
BOOTSTRAP_SEED = 20261019

# Jordet et al. (2020) use five positional roles from the official line-up; goalkeepers are not
# in the sample. The sim's DM and AM go with central midfielders.
GROUPS = {
    "CB": "central defenders",
    "FB": "side defenders",
    "DM": "central midfielders",
    "CM": "central midfielders",
    "AM": "central midfielders",
    "W": "wingers",
    "ST": "forwards",
}
GROUP_ORDER = ("central midfielders", "central defenders", "wingers", "side defenders", "forwards")
MIDFIELD = ("DM", "CM", "AM")
# Jordet et al. (2020) Figure 2: role pairs with the printed Cohen's d of scan frequency and its
# 95% CI. Sign: the first role scans more, as the text (central midfielders highest, forwards
# lowest) and the bar order of Figure 2 show.
ROLE_PAIRS = (
    ("central midfielders", "forwards", 0.54, 0.48, 0.60, "Figure 2"),
    ("central midfielders", "side defenders", 0.56, 0.51, 0.61,
     "Results › Positional Role; Figure 2"),
    ("central midfielders", "wingers", 0.33, 0.27, 0.39, "Figure 2"),
    ("central midfielders", "central defenders", 0.29, 0.24, 0.34, "Figure 2"),
    ("central defenders", "forwards", 0.51, 0.43, 0.59, "Figure 2"),
    ("central defenders", "side defenders", 0.37, 0.31, 0.43, "Figure 2"),
    ("wingers", "forwards", 0.36, 0.27, 0.45, "Figure 2"),
    ("side defenders", "forwards", 0.20, 0.12, 0.28, "Figure 2"),
)  # fmt: skip


@dataclass(frozen=True)
class Source:
    cite: str  # short citation, as written in docs/REFERENCES.md
    detail: str
    url: str


SOURCES = {
    "jordet2020": Source(
        "Jordet et al. (2020)",
        "Scanning, contextual factors, and association with performance in English Premier League "
        "footballers: an investigation across a season. Frontiers in Psychology 11:553813. 27 "
        "players of one EPL club, 21 home games, 9,574 ball possessions, scans counted from "
        "close-up video.",
        "https://pmc.ncbi.nlm.nih.gov/articles/PMC7573254/",
    ),
    "jordet2013": Source(
        "Jordet et al. (2013)",
        "Jordet, Bloomfield, Heijmerikx. The hidden foundation of field vision in English Premier "
        "League (EPL) soccer players. MIT Sloan Sports Analytics Conference. 118 players (63 "
        "forwards, 55 midfielders), 1,279 situations, from broadcast player-cam video.",
        "https://www.sloansportsconference.com/research-papers/"
        "the-hidden-foundation-of-field-vision-in-english-premier-league-epl-soccer-players",
    ),
    "aksum2021": Source(
        "Aksum et al. (2021)",
        "Scanning activity of elite football players in 11 vs. 11 match play: an eye-tracking "
        "analysis on the duration and visual information of scanning. PLoS ONE 16(8):e0244118; "
        "by the author of the NIH thesis Visual Perception in Elite Football and the source of "
        "its '> 90% of scans last ≤ 0.66 s'. 4 elite midfielders, 869 scans, Tobii Pro Glasses 2.",
        "https://pmc.ncbi.nlm.nih.gov/articles/PMC8378692/",
    ),
    "kokubu2026": Source(
        "Kokubu et al. (2026)",
        "Correspondence between motion sensor kinematics and notational analysis of scanning in "
        "field-based football gameplay. Frontiers in Psychology 17:1785026. 12 university players, "
        "a 7-min 6 v 6 game, head-worn IMU at 200 Hz.",
        "https://pmc.ncbi.nlm.nih.gov/articles/PMC13441872/",
    ),
}


@dataclass
class Row:
    metric: str
    sim: str
    seeds: str
    published: str = NO_REFERENCE
    range: str = "—"
    source: str = "—"
    inside: str = "—"
    note: str = ""
    calibrated: bool = False  # the sim was fitted to this value on tuning seeds (sim/config.py)

    @property
    def label(self) -> str:
        return f"{self.metric} †" if self.calibrated else self.metric


# --- measurements on one run -----------------------------------------------------------------


def possession_start(owner_team: np.ndarray, frame: int, team_id: int) -> int:
    """First frame of the spell in which `team_id` has had the ball, up to `frame`.

    owner_team: (F,) team of the ball owner per frame, -1 while the ball is free; a free ball
    belongs to the team that last had it.
    """
    carried = np.array(owner_team, dtype=np.int64)
    for f in range(1, len(carried)):
        if carried[f] < 0:
            carried[f] = carried[f - 1]
    f = frame
    while f > 0 and carried[f - 1] == team_id:
        f -= 1
    return f


def out_of_frame_s(
    head_yaw: np.ndarray, player_pos: np.ndarray, ball_pos: np.ndarray, dt: float, half_width: float
) -> float | None:
    """Time from the first frame with the ball out of a head-fixed frame to the first frame back.

    As Aksum et al. (2021) time a scan with a head-worn scene camera. None if the ball never
    leaves the frame or never comes back.
    """
    offset = np.abs(ball_offset(head_yaw, player_pos, ball_pos))
    out = np.flatnonzero(offset > half_width)
    if out.size == 0:
        return None
    back = np.flatnonzero(offset[out[0] :] <= half_width)
    return None if back.size == 0 else float(back[0] * dt)


def simulate(seed: int, params: SimParams = PARAMS) -> dict[str, dict[str, np.ndarray]]:
    """Per-observation tables of one run: receptions, scans, player peaks, passes."""
    run = Simulation.from_scenario(SCENARIO, seed, params=params).run()
    dt, frames = run.dt, len(run.owner)
    roles = [p.role for p in run.players]
    team = np.array([p.team for p in run.players])
    owner_team = np.where(run.owner >= 0, team[np.maximum(run.owner, 0)], -1)
    onsets: list[list[int]] = [[] for _ in run.players]
    for e in run.events:
        if e.type == "scan":
            onsets[run.index(e.player)].append(e.frame)
    resolved = [e for e in run.events if e.type == "pass" and e.attrs.get("end") is not None]
    passes = {(e.attrs["receiver"], e.attrs["end"]): e for e in resolved}

    rec: dict[str, list] = {
        k: [] for k in ("role", "scans", "window", "pressure", "pressure_window", "behind")
    }
    last = frames - 1 - round(END_GUARD_S / dt)
    for e in run.events:
        i = run.index(e.player)
        if e.type != "reception" or roles[i] == "GK" or e.frame > last:
            continue
        f = e.frame
        start = max(f - round(WINDOW_S / dt), possession_start(owner_team, f, team[i]))
        opponents = np.flatnonzero(team != team[i])
        kick = passes[(e.player, f)]
        passer = run.index(kick.player)
        attack = 1.0 if team[i] == 0 else -1.0  # the home team attacks +x in possession_play
        rec["role"].append(roles[i])
        rec["scans"].append(sum(start <= s < f for s in onsets[i]))
        rec["window"].append((f - start) * dt)
        gap = np.linalg.norm(
            run.pos[start : f + 1, opponents] - run.pos[start : f + 1, None, i], axis=-1
        )
        rec["pressure"].append(gap[-1].min())
        rec["pressure_window"].append(gap.min(axis=1).mean())
        rec["behind"].append(
            attack * (run.pos[kick.frame, passer, 0] - run.pos[kick.frame, i, 0]) < 0
        )

    scan: dict[str, list] = {k: [] for k in ("role", "out", "peak")}
    for e in run.events:
        i = run.index(e.player)
        if e.type != "scan" or roles[i] == "GK":
            continue
        span = slice(e.frame, e.attrs["end"] + 1)
        yaw = run.head_yaw[span, i]  # the true head, not the tracking output with sensor noise
        out = None
        if run.owner[e.frame] != i:  # Aksum et al. do not time scans made on the ball
            out = out_of_frame_s(yaw, run.pos[span, i], run.ball_pos[span], dt, FRAME_HALF_WIDTH)
        scan["role"].append(roles[i])
        scan["out"].append(np.nan if out is None else out)
        scan["peak"].append(np.abs(wrap_angle(np.diff(yaw))).max() / dt)

    outfield = np.array([r != "GK" for r in roles])
    speed = np.linalg.norm(run.vel[:, outfield], axis=-1)
    dspeed = np.diff(speed, axis=0) / dt
    peak = {"speed": speed.max(axis=0), "accel": dspeed.max(axis=0), "decel": -dspeed.min(axis=0)}

    kicked: dict[str, list] = {"launch": [], "average": []}
    for e in run.events:
        if e.type != "pass":
            continue
        kicked["launch"].append(e.attrs["speed"])
        average = np.nan
        if e in resolved:
            travelled = np.linalg.norm(np.subtract(e.attrs["end_at"], e.attrs["start"]))
            average = travelled / ((e.attrs["end"] - e.frame) * dt)
        kicked["average"].append(average)

    def table(columns: dict[str, list]) -> dict[str, np.ndarray]:
        return {k: np.asarray(v) for k, v in columns.items()}

    return {"receptions": table(rec), "scans": table(scan), "peaks": peak, "passes": table(kicked)}


# --- pooled statistics with seed bootstrap --------------------------------------------------


def _wmean(x: np.ndarray, w: np.ndarray) -> float:
    return float(np.sum(w * x) / np.sum(w)) if np.sum(w) > 0 else math.nan


def _wsd(x: np.ndarray, w: np.ndarray) -> float:
    n = np.sum(w)
    if n < 2:
        return math.nan
    return float(np.sqrt(np.sum(w * (x - _wmean(x, w)) ** 2) / (n - 1)))


def _wd(xa: np.ndarray, wa: np.ndarray, xb: np.ndarray, wb: np.ndarray) -> float:
    """Cohen's d with the pooled SD and frequency weights."""
    na, nb = np.sum(wa), np.sum(wb)
    if na < 2 or nb < 2:
        return math.nan
    ss = np.sum(wa * (xa - _wmean(xa, wa)) ** 2) + np.sum(wb * (xb - _wmean(xb, wb)) ** 2)
    pooled = math.sqrt(ss / (na + nb - 2))
    # A group with no spread (a handful of identical values) has no meaningful effect size.
    return (_wmean(xa, wa) - _wmean(xb, wb)) / pooled if pooled > 1e-9 else math.nan


def cohens_d(a: np.ndarray, b: np.ndarray) -> float:
    """(mean a - mean b) / pooled SD."""
    a, b = np.asarray(a, dtype=float), np.asarray(b, dtype=float)
    return _wd(a, np.ones_like(a), b, np.ones_like(b))


class Pool:
    """All seeds' observations, each tagged with its seed, and bootstrap weights over seeds."""

    def __init__(self, per_seed: list[dict[str, dict[str, np.ndarray]]]) -> None:
        self.n_seeds = len(per_seed)
        self.tables: dict[str, dict[str, np.ndarray]] = {}
        for name in per_seed[0]:
            cols = per_seed[0][name]
            self.tables[name] = {k: np.concatenate([s[name][k] for s in per_seed]) for k in cols}
            sizes = [len(next(iter(s[name].values()))) for s in per_seed]
            self.tables[name]["seed"] = np.repeat(np.arange(self.n_seeds), sizes)
        gen = np.random.default_rng(BOOTSTRAP_SEED)
        n = self.n_seeds
        self.resamples = gen.multinomial(n, np.full(n, 1.0 / n), size=BOOTSTRAP).astype(float)

    def weights(self, table: str, seed_weights: np.ndarray, mask: np.ndarray | None = None):
        w = seed_weights[self.tables[table]["seed"]]
        return w if mask is None else w * mask

    def pooled(self, fn: Callable[[np.ndarray], float]) -> float:
        return fn(np.ones(self.n_seeds))

    def interval(self, fn: Callable[[np.ndarray], float]) -> tuple[float, float]:
        values = np.array([fn(w) for w in self.resamples])
        values = values[np.isfinite(values)]
        if values.size == 0:
            return math.nan, math.nan
        lo, hi = np.percentile(values, [5, 95])
        return float(lo), float(hi)

    def share(self, fn: Callable[[np.ndarray], bool]) -> float:
        return float(np.mean([fn(w) for w in self.resamples]))


def _verdict(value: float, lo: float, hi: float, enough: bool = True) -> str:
    if not enough or not math.isfinite(value):
        return INCONCLUSIVE
    return INSIDE if lo <= value <= hi else OUTSIDE


def _binomial_ci(p: float, n: int) -> tuple[float, float]:
    half = 1.96 * math.sqrt(p * (1.0 - p) / n)
    return p - half, p + half


def _num(value: float, fmt: str) -> str:
    return "—" if not math.isfinite(value) else f"{value:{fmt}}".replace("-", "−")


def _span(lo: float, hi: float, fmt: str) -> str:
    return f"{_num(lo, fmt)} to {_num(hi, fmt)}"


def _cite(key: str, where: str) -> str:
    return f"{SOURCES[key].cite}, {where}"


# --- rows ------------------------------------------------------------------------------------


def evaluate(seeds: list[int]) -> list[Row]:
    pool = Pool([simulate(s) for s in seeds])
    rec, scans = pool.tables["receptions"], pool.tables["scans"]
    rate = rec["scans"] / rec["window"]
    group = np.array([GROUPS[r] for r in rec["role"]])
    rows: list[Row] = []

    def mean_row(
        metric, table, x, mask, fmt, published, lo, hi, source, note="", scale=1.0,
        label="mean ± SD", calibrated=False,
    ):  # fmt: skip
        def stat(w):
            return _wmean(x[mask], pool.weights(table, w)[mask]) * scale

        ones = np.ones(pool.n_seeds)
        value = pool.pooled(stat)
        sd = _wsd(x[mask], pool.weights(table, ones)[mask]) * scale
        n = int(mask.sum())
        a, b = pool.interval(stat)
        row = Row(
            metric,
            f"{_num(value, fmt)} ± {_num(sd, fmt)} (n = {n})",
            _span(a, b, fmt),
            note=note,
            calibrated=calibrated,
        )
        if published is not None:
            row.published, row.source = published, source
            row.range = f"{_span(lo, hi, fmt)} ({label})"
            row.inside = _verdict(value, lo, hi, n >= MIN_GROUP)
        rows.append(row)
        return value

    def d_row(metric, xa_mask, xb_mask, published, lo, hi, source, note="", calibrated=True):
        def stat(w):
            wr = pool.weights("receptions", w)
            return _wd(rate[xa_mask], wr[xa_mask], rate[xb_mask], wr[xb_mask])

        value = pool.pooled(stat)
        na, nb = int(xa_mask.sum()), int(xb_mask.sum())
        a, b = pool.interval(stat)
        rows.append(
            Row(
                metric,
                f"d = {_num(value, '.2f')} (n = {na} vs {nb})",
                _span(a, b, ".2f"),
                published,
                f"{_span(lo, hi, '.2f')} (95% CI)",
                source,
                _verdict(value, lo, hi, min(na, nb) >= MIN_GROUP),
                note,
                calibrated,
            )
        )

    every = np.ones(len(rate), dtype=bool)

    # Scanning before receiving the ball.
    spec_lo, spec_hi = 0.75 * 3.0, 1.25 * 3.0
    count = mean_row(
        "Scans in the 10 s before receiving",
        "receptions", rec["scans"].astype(float), every, ".2f", "3.0 ± 2.1", 0.9, 5.1,
        _cite("jordet2020", "Results › General"),
        "Sim `scan` events of the receiver with onset in the window; partial head turns are not "
        "scans. The window starts at the latest of 10 s before the reception, the moment the team "
        "won the ball, and the run start (the paper cuts it at turnovers and set plays).",
        calibrated=True,
    )  # fmt: skip
    full = float(np.mean(rec["window"] >= WINDOW_S - 1e-9)) if len(rate) else math.nan
    rows[-1].note += (
        f" Mean window {np.mean(rec['window']):.1f} s; {full:.0%} of receptions have the full "
        f"10 s. SPEC 3.8 asks for the mean within ±25% of the SPEC 3.4 target of ≈ 3 "
        f"({spec_lo:.2f}–{spec_hi:.2f}): {'met' if spec_lo <= count <= spec_hi else 'not met'}."
    )
    mean_row(
        "Scan frequency before receiving (scans/s)",
        "receptions", rate, every, ".2f", "0.44 ± 0.30", 0.14, 0.74,
        _cite("jordet2020", "Results › General"),
        "Scans divided by the window length, per reception, then averaged as the paper does. "
        "It sits far below the configured rates (sim/config.py ROLES), which hold while the head "
        "is free and no opponent is within 10 m: a scan in progress, its refractory time and "
        "partial head turns block new scans, and nearer opponents slow them.",
    )  # fmt: skip
    behind = rec["behind"].astype(bool) & np.isin(rec["role"], [*MIDFIELD, "W", "ST"])
    mean_row(
        "Scan frequency, midfielders and forwards receiving from a teammate nearer their goal "
        "(scans/s)",
        "receptions", rate, behind, ".2f",
        "0.27 ± 0.22 (no major award); 0.33 ± 0.25 (award)", 0.27 - 0.22, 0.33 + 0.25,
        _cite("jordet2013", "Results, p. 3"),
        "The 2013 sample: forwards and midfielders receiving a pass from a teammate closer to "
        "their own goal (along the attack direction, at the kick). The range spans both "
        "groups' mean ± SD. The paper's highest per-player means (0.62, two players) have no "
        "spread and are not checked.",
        label="both groups' mean ± SD",
    )  # fmt: skip

    # Positional role (Jordet et al. 2020 plot the role means in Figure 2 without printing them).
    for g in GROUP_ORDER:
        sim_roles = sorted({r for r, name in GROUPS.items() if name == g}, key=list(ROLES).index)
        configured = ", ".join(f"{r} {ROLES[r].scan_rate:.2f}" for r in sim_roles)
        mean_row(
            f"Scan frequency, {g} (scans/s)",
            "receptions", rate, group == g, ".2f", None, 0, 0, "",
            f"Configured rate while the head is free and no opponent is within 10 m: {configured} "
            "per s. Jordet et al. (2020) Figure 2 plots each role's mean without printing it, so "
            "no value is checked; the effect sizes it prints are compared below, and the "
            "configured rates were fitted to them.",
        )  # fmt: skip

    def means_by_group(w):
        wr = pool.weights("receptions", w)
        return {g: _wmean(rate[group == g], wr[group == g]) for g in GROUP_ORDER}

    def order_holds(w) -> bool:
        m = means_by_group(w)
        if not all(math.isfinite(v) for v in m.values()):
            return False
        return max(m, key=m.get) == "central midfielders" and min(m, key=m.get) == "forwards"

    pooled_means = means_by_group(np.ones(pool.n_seeds))
    roles = rec["role"]
    by_role = {r: float(np.mean(rate[roles == r])) for r in ROLES if np.any(roles == r)}
    ranked = sorted(pooled_means, key=lambda g: -pooled_means[g])
    holds = order_holds(np.ones(pool.n_seeds))
    rows.append(
        Row(
            "Positional order of scan frequency",
            " > ".join(f"{g} {pooled_means[g]:.2f}" for g in ranked),
            f"order holds in {pool.share(order_holds):.0%} of resamples",
            "central midfielders highest, forwards lowest",
            "the same order at both ends",
            _cite("jordet2020", "Results › Positional Role"),
            INSIDE if holds else OUTSIDE,
            "Only the two ends of the order are printed in the text; the bars of Figure 2 are "
            "not read off. Central midfielders pool the sim's DM, CM and AM; by sim role: "
            + ", ".join(f"{r} {v:.2f}" for r, v in by_role.items())
            + ".",
            calibrated=True,
        )
    )
    for a, b, d, lo, hi, where in ROLE_PAIRS:
        d_row(
            f"Cohen's d of scan frequency, {a} vs {b}",
            group == a, group == b, f"d = {d:.2f}", lo, hi, _cite("jordet2020", where),
        )  # fmt: skip

    # Opponent pressure: closest opponent at the reception, in the paper's metre bins.
    close, free = rec["pressure"] < 1.5, rec["pressure"] >= 9.5
    close_mid = int(np.sum(close & (group == "central midfielders")))
    near_m, far_m = (
        float(np.mean(rec["pressure_window"][m])) if m.any() else math.nan for m in (close, free)
    )
    d_row(
        "Cohen's d of scan frequency, closest opponent 10+ m vs 0–1 m at the reception",
        free, close, "d = 0.57 (lower under tight pressure)", 0.49, 0.65,
        _cite("jordet2020", "Results › Opponent Pressure; Figure 3"),
        "The paper's bins are whole metres, so 0–1 m is read as < 1.5 m and 10+ m as ≥ 9.5 m. "
        "The sim slows scanning as the closest opponent nears (sim/config.py, "
        "pressure_scan_factor, set from this d), but that does not reach this comparison: "
        f"{close_mid} of the {int(close.sum())} receptions at 0–1 m are central midfielders, who "
        f"scan most, and their closest opponent averaged {_num(near_m, '.1f')} m over the window, "
        f"against {_num(far_m, '.1f')} m at 10+ m. possession_play has no tight marking: "
        "pressure at a reception is mostly a defender arriving with the ball.",
    )  # fmt: skip

    # Head turns.
    mid = np.isin(scans["role"], MIDFIELD) & np.isfinite(scans["out"])
    out = scans["out"]
    timed = out[mid]
    mean_row(
        "Scan duration, ball out of the 82° scene-camera frame (s)",
        "scans", out, mid, ".2f", "0.40 ± 0.28 (39.65 cs, SD 28.42 cs)", 0.3965 - 0.2842,
        0.3965 + 0.2842, _cite("aksum2021", "Results › Scanning duration"),
        "Midfielders' scans off the ball, timed from the first 25 Hz frame with the ball more "
        "than 41° from the true head direction to the first frame back (the paper: from the "
        "first video frame without the ball to the first with it; micro scans that keep the "
        "ball in frame are excluded there as here). Vertical framing is ignored. Printed but "
        f"not checked (no spread): median 0.34 s, most common 0.26 s, longest 3.28 s; sim median "
        f"{np.median(timed) if timed.size else math.nan:.2f} s, longest "
        f"{timed.max() if timed.size else math.nan:.2f} s. The median is set by the turn itself "
        "(70–150° out and back at about 404°/s); the dwell was fitted to the share and SD.",
        calibrated=True,
    )  # fmt: skip

    def short_share(w):
        ws = pool.weights("scans", w, mid)
        return _wmean((out <= 0.66 + 1e-9).astype(float), ws) * 100.0

    lo, hi = (100.0 * v for v in _binomial_ci(0.903, 869))
    value = pool.pooled(short_share)
    a, b = pool.interval(short_share)
    rows.append(
        Row(
            "Scans with the ball out of frame for ≤ 0.66 s (%)",
            f"{_num(value, '.1f')}% (n = {int(mid.sum())})",
            f"{_span(a, b, '.1f')}%",
            "90.3% (n = 869)",
            f"{_span(lo, hi, '.1f')}% (95% CI of the printed share)",
            _cite("aksum2021", "Results › Scanning duration; Fig 3"),
            _verdict(value, lo, hi, int(mid.sum()) >= MIN_GROUP),
            "Same scans and timing as the row above. The range is the binomial 95% CI of the "
            "printed 90.3% with n = 869, computed here (normal approximation); the paper prints "
            "no interval.",
            calibrated=True,
        )
    )
    every_scan = np.ones(len(scans["peak"]), dtype=bool)
    mean_omega, sd_omega = np.rad2deg(PARAMS.scan_omega)
    mean_row(
        "Peak head angular speed during a scan (°/s)",
        "scans", scans["peak"], every_scan, ".0f", "404.2 ± 50.7", 404.2 - 50.7, 404.2 + 50.7,
        _cite("kokubu2026", "Results 3.1"), f"Outfield scans; frame-to-frame yaw change of the "
        f"true head at 25 Hz (the paper: yaw rate from a head-worn IMU at 200 Hz, scans "
        f"detected at 250°/s). Each sim scan draws its peak speed from {mean_omega:.1f} ± "
        f"{sd_omega:.1f}°/s (sim/config.py scan_omega, this printed value), so inside is by "
        "construction. The paper does not say whether its SD is over scans or players.",
        scale=180.0 / math.pi, calibrated=True,
    )  # fmt: skip

    # Movement and ball: no paper in docs/REFERENCES.md prints a measured value.
    peaks, kicked = pool.tables["peaks"], pool.tables["passes"]
    all_peaks = np.ones(len(peaks["speed"]), dtype=bool)
    sprinting = float(np.mean(peaks["speed"] > 7.0))
    mean_row(
        "Peak speed per outfield player per run (m/s)",
        "peaks", peaks["speed"], all_peaks, ".2f", None, 0, 0, "",
        f"Highest {peaks['speed'].max():.2f} m/s; {sprinting:.0%} of player-runs pass the SPEC "
        "4.6 sprint threshold (7.0 m/s). Spearman (2018, §3.1.1) sets v = 5 m/s in its "
        "time-to-intercept model as an 'average sustainable speed': a model parameter, not a "
        "measured top speed, so it is not used here.",
    )  # fmt: skip
    mean_row(
        "Peak acceleration per outfield player per run (m/s²)",
        "peaks", peaks["accel"], all_peaks, ".2f", None, 0, 0, "",
        "Rate of speed increase over one frame; the sim caps it at a_max. Spearman (2018, "
        "§3.1.1) sets a = 7 m/s² in its time-to-intercept model, a model parameter: not used.",
    )  # fmt: skip
    mean_row(
        "Peak deceleration per outfield player per run (m/s²)",
        "peaks", peaks["decel"], all_peaks, ".2f", None, 0, 0, "",
        "Rate of speed decrease over one frame; the sim caps it at d_max.",
    )  # fmt: skip
    all_passes = np.ones(len(kicked["launch"]), dtype=bool)
    mean_row(
        "Pass launch speed (m/s)",
        "passes", kicked["launch"], all_passes, ".2f", None, 0, 0, "",
        "Ground passes only (SPEC 3.3, M1). No cited paper prints pass or ball speeds; the "
        "average ball speed in Shaw's tutorial code is not a paper and is not used.",
    )  # fmt: skip
    resolved = np.isfinite(kicked["average"])
    mean_row(
        "Pass average ball speed, kick to end of the pass (m/s)",
        "passes", kicked["average"], resolved, ".2f", None, 0, 0, "",
        "Straight-line distance over flight time, for passes that were received, intercepted "
        "or went out.",
    )  # fmt: skip
    return rows


# --- report ----------------------------------------------------------------------------------


def _seed_text(seeds: list[int]) -> str:
    contiguous = seeds == list(range(seeds[0], seeds[-1] + 1))
    span = f"{seeds[0]}–{seeds[-1]}" if contiguous else ", ".join(map(str, seeds))
    return f"`{SCENARIO}` seeds {span} ({len(seeds)})"


def render(rows: list[Row], seeds: list[int]) -> str:
    counts = {v: sum(r.inside == v for r in rows) for v in VERDICTS}
    no_ref = sum(r.published == NO_REFERENCE for r in rows)
    outside = [r for r in rows if r.inside == OUTSIDE]
    lines = [
        "# Realism — sim vs published values (SPEC 3.8)",
        "",
        f"`uv run python -m eval.realism`. {_seed_text(seeds)}, {PARAMS.max_duration_s:.0f} s "
        "of passing play each (a run ends early if the ball goes out). Synthetic data only: every "
        "published value below is a number printed in a paper cited in docs/REFERENCES.md; no "
        "dataset was used.",
        "",
        f"**{counts[INSIDE]} inside, {counts[OUTSIDE]} outside, {counts[INCONCLUSIVE]} "
        f"inconclusive, {no_ref} with no published reference.**",
        "",
    ]
    if outside:
        lines += ["Outside the published range:", ""]
        lines += [f"- {r.label}: sim {r.sim}; published {r.published}." for r in outside]
        lines.append("")
    lines += [
        "| " + " | ".join(COLUMNS) + " |",
        "|" + "---|" * len(COLUMNS),
    ]
    for r in rows:
        cells = (r.label, r.sim, r.seeds, r.published, r.range, r.source, r.inside)
        lines.append("| " + " | ".join(c.replace("|", "\\|") for c in cells) + " |")
    lines += [
        "",
        "## How to read it",
        "",
        "- **Sim (pooled)**: all observations of all seeds pooled; mean ± SD of the observations "
        "and their number. **Sim, 90% over seeds**: the 5th–95th percentile of the pooled value "
        f"over {BOOTSTRAP} bootstrap resamples of the seeds (whole runs resampled), i.e. how much "
        "it depends on which matches were simulated.",
        "- **Range checked**: the paper's printed 95% CI when it prints one; else the printed "
        "mean ± 1 SD — the spread of single situations, so *inside* means the sim's average is a "
        "typical real value, not that the means agree; else, for a printed share, its binomial "
        "95% CI computed from the printed n. **Inside** compares the pooled value; a group with "
        f"fewer than {MIN_GROUP} observations is inconclusive.",
        "- **†**: the sim's scan parameters (sim/config.py) were fitted to this printed value on "
        "`possession_play` tuning seeds 0–99 (SPEC 3.4). The seeds here are held out, so *inside* "
        "shows that the fit carries over to new matches, not independent agreement.",
        f"- Rows marked *{NO_REFERENCE}* have no printed value in any cited paper; they show the "
        "sim's distribution only. Nothing was filled in from memory or from datasets.",
        "- The populations differ from the sim's 22 synthetic players: one EPL club's 27 players "
        "(Jordet 2020), 118 EPL forwards and midfielders (Jordet 2013), four elite midfielders "
        "(Aksum 2021), twelve university players in a 6 v 6 game (Kokubu 2026).",
        "",
        "## Notes per row",
        "",
    ]
    lines += [f"- **{r.label}** — {r.note}" for r in rows if r.note]
    lines += [
        "",
        "## Sources",
        "",
    ]
    lines += [f"- **{s.cite}** — {s.detail} {s.url}" for s in SOURCES.values()]
    lines += [
        "",
        "Checked and not used: Bekkers (2026, *Wide Open Gazes*) prints its field-of-view model "
        "and model scores, no scan rates or head kinematics; Bekkers (*Pressing Intensity*) and "
        "Fernández, Bornn, Cervone (2021) print model parameters, no measured speeds; Spearman "
        "(2018) prints time-to-intercept parameters (v = 5 m/s, a = 7 m/s²), which are model "
        'choices; the summaries of Jordet et al. (2013) quoted in REFERENCES.md ("> 0.5 scans/s '
        'is very high") are not the paper, which prints the values used above.',
        "",
    ]
    return "\n".join(lines)


def _parse_seeds(text: str) -> list[int]:
    lo, _, hi = text.partition("-")
    return list(range(int(lo), int(hi or lo) + 1))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--seeds", default="100-199")
    args = parser.parse_args()
    seeds = _parse_seeds(args.seeds)
    report = render(evaluate(seeds), seeds)
    REPORTS.mkdir(exist_ok=True)
    path = REPORTS / "realism.md"
    path.write_text(report)
    print(report.split("\n## How to read it")[0])
    print(f"\nwrote {path}")


if __name__ == "__main__":
    main()
