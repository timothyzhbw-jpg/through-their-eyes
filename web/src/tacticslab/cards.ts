// The Tactics lab's cards (SPEC 4.8, 7): why a common tactic works, told with this match's own
// synthetic data. Each card names what it measures, prints the definition of every number and its
// source, and ties them to the hero moment that shows the tactic at work. The numbers are computed
// here from the events and tracking of the session or its loaded match scope, so a card says what
// it measures: "this moment" or "this match". Pro and Plain tell the same evidence two ways.

import type { Hero } from "../data/hero";
import {
  FULL_MATCH,
  MOMENT_LINKS,
  hrefOf,
  type MomentLink,
  type MomentLinkId,
} from "../moments/moments";
import type { SourceKind } from "../provenance/source";
import { clock, fixed, signed } from "../tactics/tactics";
import { shortName } from "../data/roster";
import { moveOf, type Move } from "../xtexplain/zones";
import { OPEN_P, laneCounts, lanesAt } from "./lanes";
import { CARD_SCENARIO, NO_SCOPE, type Scope } from "./scope";
import {
  COUNTER_WINDOW_S,
  FPS,
  HALF_LENGTH,
  MIN_BYPASSED,
  PITCH_L,
  PRESSED,
  PRESS_ZONE_FROM,
  PRESS_ZONE_SHARE,
  REGAIN_WINDOW_S,
  THIRD_START,
  TRANSITION_WINDOW_S,
  XG_CAP,
  XG_D0,
  XG_PEAK,
  XG_SCALE,
  buildUpMetrics,
  counterAttack,
  pressMetrics,
  progression,
  regains,
  shotQuality,
  transitionAfterLoss,
  xtAt,
  type Team,
  type XtGrid,
} from "./metrics";

export type CardId =
  | "high_press"
  | "decisions"
  | "corners"
  | "shot_quality"
  | "progression"
  | "counter_attack"
  | "build_up"
  | "transition";

export const CARD_IDS: readonly CardId[] = [
  "high_press",
  "decisions",
  "corners",
  "shot_quality",
  "progression",
  "counter_attack",
  "build_up",
  "transition",
];

export const ORIGINAL_CARDS: ReadonlySet<CardId> = new Set([
  "high_press",
  "decisions",
  "corners",
  "shot_quality",
  "progression",
]);
const MATCH_FIRST: ReadonlySet<CardId> = new Set(["counter_attack", "build_up", "transition"]);

export interface Metric {
  label: string;
  /** One value per team (home, away) or a single one. */
  values: string[];
  definition: string;
  source: SourceKind;
  /** What the source chip's tooltip adds, when the kind's own words are not enough. */
  sourceNote?: string;
  /** One line on why the value is zero or empty in the data, shown when it is. */
  zeroWhy?: string;
}

export interface Watch {
  label: string;
  frame: number; // on the clock of the session on screen
}

export interface LabCard {
  id: CardId;
  kicker: string;
  title: string;
  /** The tactic in a sentence, and why it works, in plain words. */
  idea: string;
  /** What changed in the model, for analyst and coach. */
  pro: string;
  /** One sentence a casual fan gets. */
  plain: string;
  scope: "this moment" | "this match";
  /** What the numbers were measured on, in words: the moment that shows the tactic, or the match. */
  measured: string;
  metrics: Metric[];
  /** What the sim cannot say here, said honestly. */
  limits: string;
  moment: MomentLink;
  /** A frame-aware match link for an example without a named hero moment. */
  href?: string;
  /** True when the session on screen is the card's own hero moment. */
  here: boolean;
  /** Where the metrics are told in the moment's own view, if the viewer is on it. */
  watch: Watch | null;
  /** The card's xT example as a move between zones, told per persona (xtexplain/). */
  xtMove?: Move | null;
  /** Nothing to show in this session: why, and what to open instead. */
  empty: string | null;
}

export const TEAMS = ["Home", "Away"] as const;
const TEAM_IDS: readonly Team[] = [0, 1];

const link = (id: MomentLinkId): MomentLink => MOMENT_LINKS.find((m) => m.id === id)!;

/** The card's hero moment. */
export const CARD_MOMENT: Record<CardId, MomentLinkId> = {
  high_press: "pressure",
  decisions: "pressure",
  corners: "corner",
  shot_quality: "goal",
  progression: "look",
  counter_attack: "match",
  build_up: "pressure",
  transition: "match",
};

/**
 * The With / Without comparison of a card's moment: the moment opened on its run without the look
 * and at the decision, for the heroes that stand alone; for the ones told inside the match the
 * moment's own run toggle does it (a link into a match does not carry the run).
 */
export function compareHref(id: CardId): string {
  const m = link(CARD_MOMENT[id]);
  const alone = !m.query.includes("moment=");
  return hrefOf(alone ? { query: `${m.query}&run=counterfactual&at=decision` } : m);
}

export const momentHref = (id: CardId): string => hrefOf(link(CARD_MOMENT[id]));

const each = (f: (team: Team) => string): string[] => TEAM_IDS.map(f);
const dash = "–";
const ppdaText = (v: number | null) => (v === null ? dash : v.toFixed(1));

const TRACKING = (what: string) => `${what}, computed in the browser from this match's event feed`;
const MODELLED = "The sim's own models, read from the export";

/** What a builder returns: the five original builders leave `pro` and `plain` to EXPLANATIONS. */
type Built = Omit<LabCard, "pro" | "plain"> & Partial<Pick<LabCard, "pro" | "plain">>;

const EXPLANATIONS: Partial<Record<CardId, Pick<LabCard, "pro" | "plain">>> = {
  high_press: {
    pro: `The model counts interceptions and forced turnovers, then compares opponent passes with those ball wins and shots in the ${REGAIN_WINDOW_S}-second window.`,
    plain: "Win the ball near their goal and your next attack has far less defending to beat.",
  },
  decisions: {
    pro: "The decision model scores the carrier's believed pass lanes, then scores the same choices on the true tracking state.",
    plain:
      "A player under pressure can only use what he has seen, which may not be what is really there.",
  },
  corners: {
    pro: "The model compares the marker's separation when the cutback resolves, with his key look and without it, then counts the corner shots.",
    plain:
      "One quick look can keep a defender close enough to stop a rehearsed corner from becoming a chance.",
  },
  shot_quality: {
    pro: "The distance-xG model turns each shot's location into a scoring value, so shot positions can be compared rather than just counted.",
    plain:
      "Working the ball closer to goal usually gives the shooter a better chance than shooting from far out.",
  },
  progression: {
    pro: "The xT grid values where each completed pass starts and ends; the largest rise identifies the pass that changed the attack most.",
    plain: "A pass matters when it moves the ball to a place where a shot is easier to imagine.",
  },
};

function high_press(hero: Hero, view: Context): Built {
  const events = hero.runs.factual.events;
  const [home, away] = TEAM_IDS.map((t) => pressMetrics(events, t));
  const first = regains(events)
    .filter((r) => r.high)
    .sort((a, b) => a.frame - b.frame)[0];
  return {
    id: "high_press",
    kicker: "Pressing · win it where the goal is close",
    title: "High press",
    idea:
      "Press high and together, and the ball is won near the opponent's goal: one regain there " +
      "leaves the defence behind the play, so the next pass has far less to beat.",
    scope: scopeOf(hero),
    measured: "", // set by buildCards, which knows which hero it handed the builder
    metrics: [
      {
        label: "Regains",
        zeroWhy:
          "No ball was won here: the sim's open play changes hands on interceptions only and has " +
          "no open-play tackles (docs/NUMBERS.md M4).",
        values: each((t) => String(t ? away.regains : home.regains)),
        definition:
          "The ball won from the opponent: an interception, or a tackle (the sim has tackles in " +
          "the pressure moment only). Each is a change of possession.",
        source: "tracking",
        sourceNote: TRACKING("Counted"),
      },
      {
        label: "High regains",
        zeroWhy: "No ball was won in the winner's attacking third in this view.",
        values: each((t) => String(t ? away.highRegains : home.highRegains)),
        definition: `A regain in the winner's attacking third: beyond ${THIRD_START.toFixed(1)} m from the centre spot toward the goal it attacks (the last ${(HALF_LENGTH - THIRD_START).toFixed(0)} m of ${PITCH_L}).`,
        source: "tracking",
        sourceNote: TRACKING("Counted"),
      },
      {
        label: "PPDA, interceptions and tackles",
        zeroWhy: "No interception or tackle in the pressing zone, so PPDA has no value to give.",
        values: each((t) => ppdaText(t ? away.ppda : home.ppda)),
        definition:
          "Opponent passes per defensive action. Passes the opponent kicks in its own " +
          `${Math.round(PRESS_ZONE_SHARE * 100)}% of the pitch (beyond ${PRESS_ZONE_FROM} m in the pressing team's frame), divided by the ` +
          "pressing team's interceptions and tackles in that zone. Lower means a harder press. " +
          "The usual PPDA also counts challenges and fouls, which the sim does not have; a dash " +
          "means no defensive action in the zone.",
        source: "tracking",
        sourceNote: TRACKING("Computed"),
      },
      {
        label: `Shots within ${REGAIN_WINDOW_S} s of a high regain · xG`,
        zeroWhy: "There was no high regain to follow, so no shot followed one.",
        values: each((t) => {
          const m = t ? away : home;
          return `${m.shotsAfterHighRegain} · ${fixed(m.xgAfterHighRegain)}`;
        }),
        definition:
          `Shots by the side that won the ball, kicked within ${REGAIN_WINDOW_S} s of a high ` +
          "regain, and their xG (the sim's distance model, see Shot quality).",
        source: "sim",
        sourceNote: MODELLED,
      },
    ],
    limits:
      "Open play in the sim changes hands on interceptions only; tackles exist in the pressure " +
      "moment, and there are no fouls, challenges or duels anywhere (docs/NUMBERS.md M4). So " +
      "PPDA here counts interceptions and tackles, not the usual defensive actions, and a short " +
      "clip has too few passes for a stable value: read it over the match.",
    moment: link("pressure"),
    here: view.scenario === "press_escape",
    watch: first ? { label: "Watch the first high regain", frame: first.frame } : null,
    empty: events.some((e) => e.type === "pass" || e.type === "interception" || e.type === "tackle")
      ? null
      : "This view has no passes or regains yet.",
  };
}

function decisions(hero: Hero, view: Context): Built {
  const run = hero.runs.factual;
  const lanes = lanesAt(hero, run);
  const chosen = lanes.find((l) => l.chosen) ?? null;
  const counts = laneCounts(lanes);
  const action = run.action;
  const outcome = action?.outcome ?? null;
  const metrics: Metric[] = [];
  if (run.decision && lanes.length) {
    metrics.push(
      {
        label: "Pass lanes open · blocked",
        values: [`${counts.open} · ${counts.blocked}`],
        definition:
          `Among his top options, a lane is open when the pass would have arrived at least ` +
          `${Math.round(OPEN_P * 100)}% of the time on the true state at the decision; ` +
          "otherwise blocked.",
        source: "sim",
        sourceNote: MODELLED,
      },
      {
        label: "Pressure on the receiver he chose",
        values: [chosen?.pressure == null ? dash : `${chosen.pressure.toFixed(1)} m`],
        definition:
          "Distance from the receiver to the nearest opponent at the decision frame, from the " +
          "tracking. A smaller distance is more pressure.",
        source: "tracking",
        sourceNote: TRACKING("Measured"),
      },
      {
        label: "He thought · it was",
        values: [
          chosen
            ? `${chosen.pBelief.toFixed(2)} · ${chosen.pTrue === null ? "not playable" : chosen.pTrue.toFixed(2)}`
            : dash,
        ],
        definition:
          "His chance of the chosen pass arriving as he saw it, and as it really was on the " +
          "truth at that moment.",
        source: "sim",
        sourceNote: MODELLED,
      },
      {
        label: "Outcome",
        values: [
          outcome
            ? `${chosen ? chosen.label : "Pass"}: ${outcome}${action?.receiver ? ` (${shortName(action.receiver)})` : ""}`
            : dash,
        ],
        definition: "How the ball he played ended in the run: complete, intercepted or out.",
        source: "sim",
        sourceNote: MODELLED,
      },
    );
  }
  return {
    id: "decisions",
    kicker: "Decisions · the pass out of a press",
    title: "Decisions under pressure",
    idea:
      "Under pressure a player chooses on what he believes, not on what is true. The lanes " +
      "that look open on his picture may be shut on the pitch; the card puts both side by side.",
    scope: scopeOf(hero),
    measured: "", // set by buildCards, which knows which hero it handed the builder
    metrics,
    limits:
      "The decision model chooses at the hero moments only; elsewhere in the match a passing " +
      "rule plays the ball (SPEC 3.1). The lanes are the player's top options at his decision, " +
      "not every pass on the pitch.",
    moment: link("pressure"),
    here: view.scenario === "press_escape",
    watch: run.decision ? { label: "Watch the decision", frame: run.decision.frame } : null,
    empty: metrics.length
      ? null
      : hero.kind === "match"
        ? "The match has no decision to open here: its hero moments carry them."
        : "This moment has no decision on the ball.",
  };
}

function corners(hero: Hero, view: Context): Built {
  const events = hero.runs.factual.events;
  const metrics: Metric[] = [];
  const marker = hero.marker;
  if (marker) {
    const sep = marker.separation;
    metrics.push(
      {
        label: "Marker to his man when the pass arrived",
        values: [
          `${sep.factual.toFixed(1)} m with the look · ${sep.counterfactual.toFixed(1)} m without`,
        ],
        definition:
          "The corner's marker's distance to the runner he marks at the frame the pass to the " +
          "runner is received or cut out, in the run with his key scan and in the run without it.",
        source: "tracking",
        sourceNote: TRACKING("Measured"),
      },
      {
        label: "How the pass ended",
        values: [
          `${marker.resolved.factual.type} with the look · ${marker.resolved.counterfactual.type} without`,
        ],
        definition: "The event that ended the cutback in each run: reception, interception or out.",
        source: "sim",
        sourceNote: MODELLED,
      },
    );
  }
  if (hero.match) {
    const taken = hero.match.possessions.filter((p) => p.restart === "corner");
    const cornerPossession = new Set(taken.map((p) => p.index));
    const shotIds = new Set(
      events
        .filter((e) => e.type === "shot" && cornerPossession.has(e.possession ?? -1))
        .map((e) => e.id),
    );
    const fromCorners = TEAM_IDS.flatMap((t) => shotQuality(events, t).list).filter((s) =>
      shotIds.has(s.id),
    );
    metrics.push({
      label: "Corners · shots from them · xG",
      values: [
        `${taken.length} · ${fromCorners.length} · ${fixed(fromCorners.reduce((s, x) => s + x.xg, 0))}`,
      ],
      definition:
        "Possessions that began from a corner, the shots taken in those possessions, and their " +
        "xG (the sim's distance model).",
      source: "sim",
      sourceNote: MODELLED,
    });
  }
  const corner = hero.match?.possessions.find((p) => p.restart === "corner");
  return {
    id: "corners",
    kicker: "Set pieces · the short corner",
    title: "Corners",
    idea:
      "A corner is a rehearsed passage, so one look can decide it: a marker who checks over his " +
      "shoulder before the ball is played keeps his man; one who does not loses him.",
    scope: scopeOf(hero),
    measured: "", // set by buildCards, which knows which hero it handed the builder
    metrics,
    limits:
      "A corner's passage ends after its cutback and the stitched match cuts it before a shot " +
      "could follow (SPEC 3.1); the row counts what the match's events hold. Crosses and " +
      "headers are not modelled.",
    moment: link("corner"),
    here: view.scenario === "corner_blind_side",
    watch: marker
      ? { label: "Watch the cutback", frame: marker.pass.frame }
      : corner
        ? { label: `Watch the first corner (${clock(corner.start / FPS)})`, frame: corner.start }
        : null,
    empty: metrics.length ? null : "No corner in this view.",
  };
}

function shot_quality(hero: Hero, view: Context): Built {
  const events = hero.runs.factual.events;
  const [home, away] = TEAM_IDS.map((t) => shotQuality(events, t));
  const all = [...home.list, ...away.list].sort((a, b) => b.xg - a.xg);
  return {
    id: "shot_quality",
    kicker: "Finishing · where the shot is taken",
    title: "Shot quality",
    idea:
      "A shot from close and central is worth far more than one from range: the same number of " +
      "shots is a different attack depending on where they are struck, so teams work the ball " +
      "to a better place first.",
    scope: scopeOf(hero),
    measured: "", // set by buildCards, which knows which hero it handed the builder
    metrics: [
      {
        label: "Shots",
        values: each((t) => String((t ? away : home).shots)),
        definition: "Shot events in the feed, by the team that took them.",
        source: "tracking",
        sourceNote: TRACKING("Counted"),
      },
      {
        label: "xG",
        values: each((t) => fixed((t ? away : home).xg)),
        definition:
          "Expected goals of an unplaced shot at d metres from the centre of the goal it " +
          `attacks: the smaller of ${XG_CAP} and ${XG_PEAK} · e^(−(d − ${XG_D0}) / ${XG_SCALE}), the sim's distance model ` +
          "(sim/decision.py), summed over the team's shots.",
        source: "sim",
        sourceNote: MODELLED,
      },
      {
        label: "xG per shot",
        values: each((t) => fixed((t ? away : home).perShot)),
        definition: "xG divided by shots; a dash means no shot.",
        source: "sim",
        sourceNote: MODELLED,
      },
    ],
    limits:
      "The distance model sees only where the ball was kicked from. The far-post finish moment " +
      "is decided by a placed-shot model (keeper, aim and sight) that this xG does not use, " +
      "so its chance of scoring is told in the moment itself, not here.",
    moment: link("goal"),
    here: view.scenario === "far_post_finish",
    watch: all[0] ? { label: "Watch the best chance", frame: all[0].frame } : null,
    empty: all.length ? null : "No shot in this view.",
  };
}

function progression_card(hero: Hero, view: Context): Built {
  const events = hero.runs.factual.events;
  const xt = view.xt;
  const [home, away] = xt ? TEAM_IDS.map((t) => progression(events, t, xt)) : [null, null];
  // The team rides on the progression the best pass came from, so it is never guessed.
  const leader = [home, away]
    .filter((p): p is NonNullable<typeof p> => !!p?.best)
    .sort((a, b) => b.best!.xt - a.best!.xt)[0];
  const best = leader?.best;
  const xtMove =
    leader && best && xt
      ? moveOf({
          mode: "pass",
          team: leader.team,
          from: best.from,
          to: best.to,
          grid: xt,
          delta: best.xt,
          label: `Best pass (${TEAMS[leader.team]})`,
        })
      : null;
  const stat = (f: (p: NonNullable<typeof home>) => string) =>
    each((t) => {
      const p = t ? away : home;
      return p ? f(p) : dash;
    });
  return {
    id: "progression",
    kicker: "Build-up · moving the ball into danger",
    title: "Progression",
    idea:
      "A pass is worth what it does to the threat: moving the ball from a cold place to a " +
      "dangerous one adds expected threat, and the passes that add the most are the ones that " +
      "break lines, which is why teams look for them.",
    scope: scopeOf(hero),
    measured: "", // set by buildCards, which knows which hero it handed the builder
    metrics: [
      {
        label: "Passes · completed",
        values: stat((p) => `${p.passes} · ${p.completed}`),
        definition: "Passes kicked and passes received by a team-mate, by the kicker's team.",
        source: "tracking",
        sourceNote: TRACKING("Counted"),
      },
      {
        label: "xT added",
        values: stat((p) => signed(p.xtAdded)),
        definition:
          "Expected threat (Singh, 2019) where each completed pass was received minus where it " +
          "was kicked, for the team that kicked it, summed. xT is our own grid, fitted on the " +
          "sim's open play (analytics/xt.py).",
        source: "tracking",
        sourceNote: TRACKING("Computed"),
      },
      {
        label: "Progressive passes",
        values: stat((p) => String(p.progressive)),
        definition: "Completed passes that added expected threat (above zero).",
        source: "tracking",
        sourceNote: TRACKING("Counted"),
      },
      {
        label: "Best pass",
        values: stat((p) =>
          p.best
            ? `${shortName(p.best.player)} → ${shortName(p.best.receiver ?? "?")} ${signed(p.best.xt)}`
            : dash,
        ),
        definition: "The completed pass that added the most expected threat.",
        source: "tracking",
        sourceNote: TRACKING("Computed"),
      },
    ],
    limits:
      "xT credits only passes that were received: a lost pass adds nothing here (the match's " +
      "tactics card counts it as the threat handed over). In open play the sim's passing rule " +
      "rarely reaches the final third, so most gains are small.",
    moment: link("look"),
    here: view.scenario === "blind_side_run",
    watch: best ? { label: "Watch the best pass", frame: best.frame } : null,
    xtMove,
    empty: !xt
      ? "The xT grid is loading."
      : events.some((e) => e.type === "pass")
        ? null
        : "No pass in this view.",
  };
}

function matchExampleHref(hero: Hero, frame: number): string {
  const id = hero.kind === "match" ? `${hero.scenario}-${hero.seed}` : FULL_MATCH;
  return hrefOf({ query: `?match=${id}&intro=0&at=${frame}` });
}

function counter_attack(hero: Hero, view: Context): Built {
  const result = view.xt ? counterAttack(hero, view.xt) : { best: null, list: [] };
  const best = result.best;
  const kind = best?.win.kind === "tackle" ? "forced turnover" : "interception";
  const metrics: Metric[] = best
    ? [
        {
          label: "Win to final third or shot",
          values: [`${best.seconds.toFixed(1)} s`],
          definition: `Seconds from the ball win to the winning team's first shot, or, for a win outside the final third, its first completed pass received there, within ${COUNTER_WINDOW_S} s and before another loss or the possession cut.`,
          source: "tracking",
          sourceNote: TRACKING("Measured"),
        },
        {
          label: "Completed passes",
          values: [String(best.passes)],
          definition:
            "The winning team's completed passes between the regain and the final-third reception or shot.",
          source: "tracking",
          sourceNote: TRACKING("Counted"),
        },
        {
          label: "xT gained",
          values: [signed(best.xtAdded)],
          definition:
            "Expected threat added by those completed passes: xT where received minus xT where kicked, summed.",
          source: "tracking",
          sourceNote: TRACKING("Computed"),
        },
        {
          label: "Ball won by",
          values: [`${TEAMS[best.team]} · ${kind}`],
          definition:
            "An interception, or a forced turnover recorded by the sim's tackle event in the pressure moment.",
          source: "tracking",
          sourceNote: TRACKING("Read"),
        },
      ]
    : [];
  return {
    id: "counter_attack",
    kicker: "Counter-attack · go before they are set",
    title: "Counter-attack",
    idea: "A fast attack after a ball win can reach the danger zone before the defence recovers.",
    pro: best
      ? `The model follows the ${kind} into the same possession's next final-third reception or shot; it does not call an isolated regain a counter.`
      : "The model looks for a regain followed quickly by a final-third reception or a shot in the same possession.",
    plain: "Win it and go before the defence can get back into shape.",
    scope: scopeOf(hero),
    measured: "",
    metrics,
    limits: `A counter here must reach the final third on a completed pass or produce a shot within ${COUNTER_WINDOW_S} s; a carry alone is not counted. Open-play ball wins are interceptions, not tackles (docs/NUMBERS.md M4).`,
    moment: link("match"),
    href: best ? matchExampleHref(hero, best.win.frame) : undefined,
    here: false,
    watch: best ? { label: "Watch the counter-attack", frame: best.win.frame } : null,
    xtMove:
      best && view.xt
        ? moveOf({
            mode: "pass",
            team: best.team,
            from: best.from,
            to: best.to,
            grid: view.xt,
            delta: xtAt(view.xt, best.to, best.team) - xtAt(view.xt, best.from, best.team),
            label: "Counter-attack",
          })
        : null,
    empty: !view.xt
      ? "The xT grid is loading."
      : best
        ? null
        : "Not in this match's data: no ball win is followed by a fast final-third entry or shot.",
  };
}

function build_up(hero: Hero, view: Context): Built {
  const result = buildUpMetrics(hero);
  const best = result.best;
  const stat = (f: (m: (typeof result.teams)[number]) => string) => each((t) => f(result.teams[t]));
  return {
    id: "build_up",
    kicker: "Possession play · pass through the press",
    title: "Press-breaking build-up",
    idea: "Playing out under pressure can take the ball past a line and into the space the press leaves.",
    pro: best
      ? `${shortName(best.player)}'s completed escape went past ${best.bypassed} outfield opponents at ${best.pressure.toFixed(2)} pressing intensity; the model counts only own-half passes.`
      : `The model measures own-half passes at pressing intensity ${PRESSED} or higher and completed passes past at least ${MIN_BYPASSED} outfield opponents.`,
    plain: "Keep calm, pass through the press, and the space behind it opens up.",
    scope: scopeOf(hero),
    measured: "",
    metrics: [
      {
        label: "Own-half passes under pressure · completed",
        values: stat((m) => `${m.pressured} · ${m.completedPressured}`),
        definition: `Passes kicked in the passer's own half with pressing intensity at least ${PRESSED}, and how many a team-mate received.`,
        source: "tracking",
        sourceNote: TRACKING("Computed"),
        zeroWhy: "No own-half pass was kicked under heavy pressure in this view.",
      },
      {
        label: "Line-breaking passes under pressure",
        values: stat((m) => String(m.lineBreakingPressured)),
        definition: `Completed pressured own-half passes that went past at least ${MIN_BYPASSED} opponents who were goal-side of the ball at the kick and behind it at reception; keepers do not count.`,
        source: "tracking",
        sourceNote: TRACKING("Counted"),
        zeroWhy: "No pressured own-half pass broke a line in this view.",
      },
      {
        label: "All line-breaking build-up passes",
        values: stat((m) => String(m.lineBreaking)),
        definition: `All completed own-half passes past at least ${MIN_BYPASSED} outfield opponents, with or without heavy pressure.`,
        source: "tracking",
        sourceNote: TRACKING("Counted"),
        zeroWhy: "No completed own-half pass broke a line in this view.",
      },
    ],
    limits:
      "Open-play pass choices come from the sim's passing rule; only hero decisions use the decision model. Pressure, marking, movement and whether the pass arrives are simulated throughout.",
    moment: link("pressure"),
    here: view.scenario === "press_escape",
    watch: best ? { label: "Watch the press escape", frame: best.frame } : null,
    empty: result.list.length ? null : "Not in this match's data: no resolved own-half pass.",
  };
}

function transition(hero: Hero, view: Context): Built {
  const result = view.xt ? transitionAfterLoss(hero, view.xt) : { best: null, list: [] };
  const best = result.best;
  const kind = best?.win.kind === "tackle" ? "forced turnover" : "interception";
  const metrics: Metric[] = best
    ? [
        {
          label: "Back line toward its own goal",
          values: [`${best.lineTowardGoal.toFixed(1)} m`],
          definition: `Movement of the losing team's deepest outfield player toward its own goal, from the loss to the end of the measured window; negative means it moved upfield.`,
          source: "tracking",
          sourceNote: TRACKING("Measured"),
        },
        {
          label: "Space behind the line · at loss → window end",
          values: [`${best.spaceAtLoss.toFixed(1)} m → ${best.spaceAtEnd.toFixed(1)} m`],
          definition: `Distance from that back line to its own goal line at the loss and after ${best.seconds.toFixed(1)} s; the window stops at the next loss, ${TRANSITION_WINDOW_S} s, or the possession cut.`,
          source: "tracking",
          sourceNote: TRACKING("Measured"),
        },
        {
          label: "Attackers' xT · at loss → window peak",
          values: [`${best.xtStart.toFixed(3)} → ${best.xtPeak.toFixed(3)}`],
          definition:
            "The ball-winning team's xT where it won the ball and the highest xT the ball reached in the measured window.",
          source: "tracking",
          sourceNote: TRACKING("Computed"),
        },
        {
          label: "Possession lost to",
          values: [`${TEAMS[best.team]} · ${kind}`],
          definition: "The interception or forced turnover that began this transition.",
          source: "tracking",
          sourceNote: TRACKING("Read"),
        },
      ]
    : [];
  return {
    id: "transition",
    kicker: "Transition · the seconds after a loss",
    title: "After losing the ball",
    idea: "A loss can leave the back line moving toward its own goal with space behind it for the new attackers.",
    pro: best
      ? `The model freezes the loss and follows the ball and the losing back line for ${best.seconds.toFixed(1)} s, stopping at the next loss or the possession cut.`
      : "The model looks for tracking after a loss; a regain at the possession cut is not a transition example.",
    plain:
      "Lose it with your defenders upfield and the other side can attack the open space behind them.",
    scope: scopeOf(hero),
    measured: "",
    metrics,
    limits:
      "The back line is the deepest outfield player, not a detected tactical formation. Space is its distance to the goal line, and the window can be shorter than the definition when the stitched match cuts away.",
    moment: link("match"),
    href: best ? matchExampleHref(hero, best.win.frame) : undefined,
    here: false,
    watch: best ? { label: "Watch the transition", frame: best.win.frame } : null,
    xtMove:
      best && view.xt
        ? moveOf({
            mode: "pass",
            team: best.team,
            from: best.win.at,
            to: best.peakAt,
            grid: view.xt,
            delta: best.xtPeak - best.xtStart,
            label: "After the loss",
          })
        : null,
    empty: !view.xt
      ? "The xT grid is loading."
      : best
        ? null
        : "Not in this match's data: no loss has tracking afterwards in the same possession.",
  };
}

export interface Context {
  scenario: string;
  xt: XtGrid | null;
}

const scopeOf = (hero: Hero): LabCard["scope"] =>
  hero.kind === "match" ? "this match" : "this moment";

const BUILDERS: Record<CardId, (hero: Hero, view: Context) => Built> = {
  high_press,
  decisions,
  corners,
  shot_quality,
  progression: progression_card,
  counter_attack,
  build_up,
  transition,
};

/** A value with nothing in it: zero, a dash, or only zeros ("0 · 0.00"). */
export const isBlank = (v: string): boolean => /^[\s0.·–+−-]*$/.test(v);

const ZERO_WHY = "Nothing of this in the data for this view.";

/** True when no metric has a value to lead with. */
const nothingToShow = (c: LabCard): boolean =>
  c.metrics.every((m) => m.values.every(isBlank)) && (c.metrics.length > 0 || c.empty !== null);

/**
 * A card never leads with zeros or dashes: the metrics that have a value come first, the ones that
 * do not follow with one line on why (their `zeroWhy`), and a card with nothing but those says
 * so instead of printing a table of them.
 */
export function leadWithValues(card: LabCard): LabCard {
  const has = (m: Metric) => m.values.some((v) => !isBlank(v));
  const live = card.metrics.filter(has).map(({ zeroWhy: _, ...m }) => m);
  const blank = card.metrics
    .filter((m) => !has(m))
    .map((m) => ({ ...m, zeroWhy: m.zeroWhy ?? ZERO_WHY }));
  if (!live.length && card.metrics.length) {
    return {
      ...card,
      metrics: blank,
      empty: card.empty ?? `Nothing to measure on ${card.measured}. ${blank[0].zeroWhy}`,
    };
  }
  return { ...card, metrics: [...live, ...blank] };
}

/** The builder's card with its explanations: its own, else the id's entry in EXPLANATIONS. */
function explained(id: CardId, card: Built): LabCard {
  const text = EXPLANATIONS[id];
  return { ...card, pro: card.pro ?? text?.pro ?? "", plain: card.plain ?? text?.plain ?? "" };
}

/** The card for `id`, measured on the moment that shows its tactic (see scope.ts). */
function scoped(id: CardId, session: Hero, xt: XtGrid | null, scope: Scope): LabCard {
  const want = CARD_SCENARIO[id];
  const moment = link(CARD_MOMENT[id]);
  const view: Context = { scenario: session.kind === "hero" ? session.scenario : "match", xt };
  const hero =
    MATCH_FIRST.has(id) && scope.match
      ? scope.match
      : session.kind === "match" || session.scenario === want
        ? session
        : scope.heroes[want];
  if (!hero) {
    return {
      ...explained(id, BUILDERS[id](session, view)),
      measured: `${moment.label} (${want})`,
      scope: "this moment",
      metrics: [],
      watch: null,
      here: false,
      empty: scope.loading
        ? `Loading ${moment.label.toLowerCase()}, the moment that shows this tactic…`
        : scope.online
          ? `${moment.label} (${want}) could not be loaded from the service: open it from the link below.`
          : `This card measures ${moment.label.toLowerCase()} (${want}), which needs the live service: only ${session.scenario} is bundled.`,
    };
  }
  const on = (h: Hero, measured: string): LabCard => {
    const card = BUILDERS[id](h, view);
    return leadWithValues({
      ...explained(id, card),
      measured,
      watch: h === session ? card.watch : null,
      here: h === session && card.here,
    });
  };
  const own =
    MATCH_FIRST.has(id) && hero.kind === "match"
      ? session.kind === "match"
        ? "this match"
        : `the whole stitched match (${hero.scenario}-${hero.seed})`
      : session.kind === "match"
        ? "this match"
        : `${moment.label} (${want})`;
  const card = on(hero, own);
  if (!nothingToShow(card) || !scope.match || hero === scope.match) return card;
  // The moment holds none of what the card measures: the whole stitched match does, or says so.
  const wide = on(scope.match, `the whole stitched match (${FULL_MATCH}) for ${own}`);
  return nothingToShow(wide) ? card : wide;
}

/**
 * The cards. On a hero moment each original card is measured on the moment that shows its tactic;
 * the three match-level cards prefer the stitched match from `scope`. A match page uses its match.
 */
export function buildCards(hero: Hero, xt: XtGrid | null, scope: Scope = NO_SCOPE): LabCard[] {
  return CARD_IDS.map((id) => scoped(id, hero, xt, scope));
}
