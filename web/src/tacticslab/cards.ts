// The Tactics lab's five tactic cards (SPEC 4.8, 7). Decisions, progression and shot quality are
// parameter rows of their tactic, never peer tactics. Every row has Pro and Plain explanations, a
// definition and a source. All rows in a card use the same hero or match scope, measured in the
// browser from its events and tracking, and the card links to the moment that shows it at work.

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

export type TacticId = "high_press" | "counter_attack" | "build_up" | "transition" | "corners";
/** Retired lens IDs remain valid for moment links; they are no longer cards in the lab. */
export type CardId = TacticId | "decisions" | "shot_quality" | "progression";

export const CARD_IDS: readonly TacticId[] = [
  "high_press",
  "counter_attack",
  "build_up",
  "transition",
  "corners",
];

const MATCH_FIRST: ReadonlySet<TacticId> = new Set(["counter_attack", "build_up", "transition"]);

export interface Metric {
  id: string;
  label: string;
  /** One value per team (home, away) or a single one. */
  values: string[];
  pro: string;
  plain: string;
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

/** The moment linked from a tactic, or from a retired lens ID held by an external caller. */
export const CARD_MOMENT: Record<CardId, MomentLinkId> = {
  high_press: "pressure",
  counter_attack: "match",
  build_up: "pressure",
  transition: "match",
  corners: "corner",
  decisions: "pressure",
  shot_quality: "goal",
  progression: "look",
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
const XG_DEFINITION =
  "Expected goals of an unplaced shot at d metres from the centre of the goal it attacks: " +
  `the smaller of ${XG_CAP} and ${XG_PEAK} · e^(−(d − ${XG_D0}) / ${XG_SCALE}), the sim's distance model (sim/decision.py).`;

/** What a builder returns: builders may leave `pro` and `plain` to EXPLANATIONS. */
type Built = Omit<LabCard, "pro" | "plain"> & Partial<Pick<LabCard, "pro" | "plain">>;

const EXPLANATIONS: Partial<Record<CardId, Pick<LabCard, "pro" | "plain">>> = {
  high_press: {
    pro: `The model counts interceptions and forced turnovers, then compares opponent passes with those ball wins and shots in the ${REGAIN_WINDOW_S}-second window.`,
    plain: "Win the ball near their goal and your next attack has far less defending to beat.",
  },
  corners: {
    pro: "The model compares the marker's separation when the cutback resolves, with his key look and without it, then counts the corner shots.",
    plain:
      "One quick look can keep a defender close enough to stop a rehearsed corner from becoming a chance.",
  },
};

function decisionsMetric(hero: Hero): Metric {
  const run = hero.runs.factual;
  const lanes = lanesAt(hero, run);
  const chosen = lanes.find((l) => l.chosen) ?? null;
  const counts = laneCounts(lanes);
  const outcome = run.action?.outcome ?? null;
  const available = !!run.decision && lanes.length > 0 && run.events.some((e) => e.type === "pass");
  return {
    id: "decisions",
    label: "Decisions under pressure",
    values: [
      available
        ? `${counts.open} open · ${counts.blocked} blocked · ${outcome ?? "unresolved"}`
        : dash,
    ],
    pro: available
      ? `The pressed carrier chose ${chosen?.label ?? "a pass"}: his arrival estimate was ${chosen?.pBelief.toFixed(2) ?? dash}, the true estimate ${chosen?.pTrue?.toFixed(2) ?? "not playable"}, and the outcome was ${outcome ?? "unresolved"}.`
      : "No press_escape on-ball decision is exported in this scope, so there are no options to score.",
    plain: available
      ? `He saw ${counts.open} of his main passing options as open on the truth; the pass ended ${outcome ?? "unresolved"}.`
      : "There is no pressed player's decision to examine in this view.",
    definition: `The pressed side's top pass options and outcome at the press_escape decision. A lane is open when its arrival probability on the true state is at least ${Math.round(OPEN_P * 100)}%; the value also reports how that pass ended.`,
    source: "sim",
    sourceNote: MODELLED,
    zeroWhy: available
      ? undefined
      : "This scope has no exported press_escape decision on the ball.",
  };
}

function progressionMetric(hero: Hero, xt: XtGrid | null): Metric {
  const events = hero.runs.factual.events;
  const [home, away] = xt ? TEAM_IDS.map((t) => progression(events, t, xt)) : [null, null];
  const best = [home, away]
    .filter((p): p is NonNullable<typeof p> => !!p?.best)
    .sort((a, b) => b.best!.xt - a.best!.xt)[0]?.best;
  return {
    id: "progression",
    label: "Progression · xT gained",
    values: each((t) => {
      const p = t ? away : home;
      return p ? signed(p.xtAdded) : dash;
    }),
    pro: best
      ? `Expected threat gained on completed passes; ${shortName(best.player)}'s pass to ${shortName(best.receiver ?? "?")} added the most at ${signed(best.xt)}.`
      : "Expected threat gained on completed passes, valued where each pass starts and ends on the xT grid.",
    plain: "This credits passes for moving the ball into more dangerous space.",
    definition:
      "Expected threat where each completed pass was received minus where it was kicked, summed by the kicking team. xT is our own grid, fitted on the sim's open play (analytics/xt.py).",
    source: "tracking",
    sourceNote: TRACKING("Computed"),
    zeroWhy: !xt
      ? "The xT grid is loading."
      : "No completed pass added measurable xT in this view.",
  };
}

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
        id: "regains",
        label: "Regains",
        zeroWhy:
          "No ball was won here: the sim's open play changes hands on interceptions only and has " +
          "no open-play tackles (docs/NUMBERS.md M4).",
        values: each((t) => String(t ? away.regains : home.regains)),
        pro: "Possession changes created by the pressing side's interceptions and forced turnovers.",
        plain: "This is how often the pressing team won the ball back.",
        definition:
          "The ball won from the opponent: an interception, or a tackle (the sim has tackles in " +
          "the pressure moment only). Each is a change of possession.",
        source: "tracking",
        sourceNote: TRACKING("Counted"),
      },
      {
        id: "high_regains",
        label: "High regains",
        zeroWhy: "No ball was won in the winner's attacking third in this view.",
        values: each((t) => String(t ? away.highRegains : home.highRegains)),
        pro: `Ball wins beyond ${THIRD_START.toFixed(1)} m in the winner's attacking frame, closest to the goal being pressed.`,
        plain: "These are the wins close enough to attack the goal immediately.",
        definition: `A regain in the winner's attacking third: beyond ${THIRD_START.toFixed(1)} m from the centre spot toward the goal it attacks (the last ${(HALF_LENGTH - THIRD_START).toFixed(0)} m of ${PITCH_L}).`,
        source: "tracking",
        sourceNote: TRACKING("Counted"),
      },
      {
        id: "ppda",
        label: "PPDA, interceptions and tackles",
        zeroWhy: "No interception or tackle in the pressing zone, so PPDA has no value to give.",
        values: each((t) => ppdaText(t ? away.ppda : home.ppda)),
        pro: "Opponent passes allowed per simulated defensive action in the pressing zone; lower indicates a more effective press.",
        plain:
          "A lower number means the defence lets fewer passes through before winning the ball.",
        definition:
          "Opponent passes per defensive action. Passes the opponent kicks in its own " +
          `${Math.round(PRESS_ZONE_SHARE * 100)}% of the pitch (beyond ${PRESS_ZONE_FROM} m in the pressing team's frame), divided by the ` +
          "pressing team's interceptions and tackles in that zone. Lower means a harder press. " +
          "The usual PPDA also counts challenges and fouls, which the sim does not have; a dash " +
          "means no defensive action in the zone.",
        source: "tracking",
        sourceNote: TRACKING("Computed"),
      },
      decisionsMetric(hero),
      {
        id: "shots_after_regain",
        label: `Shots within ${REGAIN_WINDOW_S} s of a high regain · xG`,
        zeroWhy: "There was no high regain to follow, so no shot followed one.",
        values: each((t) => {
          const m = t ? away : home;
          return `${m.shotsAfterHighRegain} · ${fixed(m.xgAfterHighRegain)}`;
        }),
        pro: `Shots and summed distance-xG produced by the pressing team inside the ${REGAIN_WINDOW_S}-second post-regain window.`,
        plain: "This shows whether winning it high quickly turned into a good shooting chance.",
        definition:
          `Shots by the side that won the ball, kicked within ${REGAIN_WINDOW_S} s of a high ` +
          `regain, and their xG. ${XG_DEFINITION}`,
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

function corners(hero: Hero, view: Context): Built {
  const events = hero.runs.factual.events;
  const marker = hero.marker;
  const sep = marker?.separation;
  const taken = hero.match?.possessions.filter((p) => p.restart === "corner") ?? [];
  const cornerPossession = new Set(taken.map((p) => p.index));
  const shotIds = new Set(
    events
      .filter((e) => e.type === "shot" && cornerPossession.has(e.possession ?? -1))
      .map((e) => e.id),
  );
  const fromCorners = TEAM_IDS.flatMap((t) => shotQuality(events, t).list).filter((s) =>
    shotIds.has(s.id),
  );
  const corner = taken[0];
  return {
    id: "corners",
    kicker: "Set pieces · the short corner",
    title: "Set pieces (corners)",
    idea:
      "A corner is a rehearsed passage, so one look can decide it: a marker who checks over his " +
      "shoulder before the ball is played keeps his man; one who does not loses him.",
    scope: scopeOf(hero),
    measured: "", // set by buildCards, which knows which hero it handed the builder
    metrics: [
      {
        id: "marking",
        label: "Corner hero's marking",
        values: [
          sep
            ? `${sep.factual.toFixed(1)} m with the scan · ${sep.counterfactual.toFixed(1)} m without`
            : dash,
        ],
        pro: "Marker-runner separation when the cutback resolves, compared between the factual scan and its removal.",
        plain: "This shows whether the defender's look kept him close to the runner.",
        definition:
          "The corner marker's distance to the runner at the frame the cutback is received or cut out, in the runs with and without his key scan.",
        source: "tracking",
        sourceNote: TRACKING("Measured"),
        zeroWhy: sep
          ? undefined
          : "This scope does not export the corner hero's marking comparison.",
      },
      {
        id: "look_outcome",
        label: "The scan and the outcome",
        values: [
          marker
            ? `${marker.resolved.factual.type} with the scan · ${marker.resolved.counterfactual.type} without`
            : dash,
        ],
        pro: "The cutback's terminal event with the key scan and without it: reception, interception or out.",
        plain:
          "This compares what happened to the corner when the defender looked and when he did not.",
        definition:
          "The event that ended the cutback in each counterfactual run, paired with the presence or removal of the marker's key look.",
        source: "sim",
        sourceNote: MODELLED,
        zeroWhy: marker ? undefined : "This scope has no corner look counterfactual.",
      },
      {
        id: "shot_quality",
        label: "Shot quality · shots from corners · xG",
        values: [
          hero.match
            ? `${fromCorners.length} · ${fixed(fromCorners.reduce((s, x) => s + x.xg, 0))}`
            : dash,
        ],
        pro: "Distance-xG summed over shots in possessions that started at a corner.",
        plain: "This values the chances created by corners, not just how many shots followed.",
        definition: `Shots taken in possessions that began from a corner, and their summed xG. ${XG_DEFINITION}`,
        source: "sim",
        sourceNote: MODELLED,
        zeroWhy: fromCorners.length ? undefined : "No shot from a corner is exported in this view.",
      },
    ],
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
    empty:
      marker || corner ? null : "Not in this match's data: no corner or corner hero is exported.",
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
  const shot =
    best?.endKind === "shot"
      ? shotQuality(hero.runs.factual.events, best.team).list.find((s) => s.frame === best.endFrame)
      : null;
  const metrics: Metric[] = best
    ? [
        {
          id: "time_to_final_third",
          label: "Win to final third or shot",
          values: [`${best.seconds.toFixed(1)} s`],
          pro: `Elapsed time from the ${kind} to the first qualifying final-third reception or shot.`,
          plain: "This is how quickly the team turned winning the ball into an attack.",
          definition: `Seconds from the ball win to the winning team's first shot, or, for a win outside the final third, its first completed pass received there, within ${COUNTER_WINDOW_S} s and before another loss or the possession cut.`,
          source: "tracking",
          sourceNote: TRACKING("Measured"),
        },
        {
          id: "passes_used",
          label: "Passes used",
          values: [String(best.passes)],
          pro: "Completed passes in the measured regain-to-final-third or regain-to-shot sequence.",
          plain: "This counts the passes the counter needed to reach its attacking destination.",
          definition:
            "The winning team's completed passes between the regain and the final-third reception or shot.",
          source: "tracking",
          sourceNote: TRACKING("Counted"),
        },
        {
          id: "progression",
          label: "Progression · xT gained",
          values: [signed(best.xtAdded)],
          pro: "Expected threat added by the counter's completed passes, from kick to reception locations.",
          plain: "This credits the counter for moving the ball into more dangerous space.",
          definition:
            "Expected threat added by those completed passes: xT where received minus xT where kicked, summed.",
          source: "tracking",
          sourceNote: TRACKING("Computed"),
        },
        {
          id: "shot_quality",
          label: "Shot quality · xG",
          values: [shot ? fixed(shot.xg) : dash],
          pro: shot
            ? `The counter's shot has ${fixed(shot.xg)} distance-xG from its kick location.`
            : "This counter ends at a final-third reception, so it has no shot to value.",
          plain: shot
            ? "This values the chance created at the end of the counter."
            : "This attack reached the final third but did not produce a shot.",
          definition: `The xG of the shot that ends the counter; a dash means the counter ends without a shot. ${XG_DEFINITION}`,
          source: "sim",
          sourceNote: MODELLED,
          zeroWhy: shot ? undefined : "The selected counter ends without a shot.",
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
  const xt = view.xt;
  const leader = xt
    ? TEAM_IDS.map((team) => progression(hero.runs.factual.events, team, xt))
        .filter((p) => p.best)
        .sort((a, b) => b.best!.xt - a.best!.xt)[0]
    : undefined;
  const bestPass = leader?.best;
  const stat = (f: (m: (typeof result.teams)[number]) => string) => each((t) => f(result.teams[t]));
  return {
    id: "build_up",
    kicker: "Possession play · pass through the press",
    title: "Possession play / breaking the press",
    idea: "Playing out under pressure can take the ball past a line and into the space the press leaves.",
    pro: best
      ? `${shortName(best.player)}'s completed escape went past ${best.bypassed} outfield opponents at ${best.pressure.toFixed(2)} pressing intensity; the model counts only own-half passes.`
      : `The model measures own-half passes at pressing intensity ${PRESSED} or higher and completed passes past at least ${MIN_BYPASSED} outfield opponents.`,
    plain: "Keep calm, pass through the press, and the space behind it opens up.",
    scope: scopeOf(hero),
    measured: "",
    metrics: [
      {
        id: "completed_under_pressure",
        label: "Completed passes under pressure",
        values: stat((m) => `${m.pressured} · ${m.completedPressured}`),
        pro: `Own-half attempts and completions at pressing intensity ${PRESSED} or higher, shown as attempted · completed.`,
        plain:
          "This shows how often a team-mate completed the pass while the passer was under heavy pressure.",
        definition: `Passes kicked in the passer's own half with pressing intensity at least ${PRESSED}, and how many a team-mate received; values are attempted · completed.`,
        source: "tracking",
        sourceNote: TRACKING("Computed"),
        zeroWhy: "No own-half pass was kicked under heavy pressure in this view.",
      },
      {
        id: "lines_broken",
        label: "Lines broken",
        values: stat((m) => `${m.lineBreakingPressured} under pressure · ${m.lineBreaking} all`),
        pro: `Completed own-half passes past at least ${MIN_BYPASSED} outfield opponents, split by whether the passer was heavily pressed.`,
        plain:
          "These completed passes took opponents out of the play and opened space beyond them.",
        definition: `Completed own-half passes past at least ${MIN_BYPASSED} opponents who were goal-side of the ball at the kick and behind it at reception; keepers do not count. The value separates pressured passes from all build-up passes.`,
        source: "tracking",
        sourceNote: TRACKING("Counted"),
        zeroWhy: "No completed own-half pass broke a line in this view.",
      },
      progressionMetric(hero, view.xt),
      decisionsMetric(hero),
    ],
    limits:
      "Open-play pass choices come from the sim's passing rule; only hero decisions use the decision model. Pressure, marking, movement and whether the pass arrives are simulated throughout. xT credits completed passes only.",
    moment: link("pressure"),
    here: view.scenario === "press_escape",
    watch: best ? { label: "Watch the press escape", frame: best.frame } : null,
    xtMove:
      leader && bestPass && xt
        ? moveOf({
            mode: "pass",
            team: leader.team,
            from: bestPass.from,
            to: bestPass.to,
            grid: xt,
            delta: bestPass.xt,
            label: `Best pass (${TEAMS[leader.team]})`,
          })
        : null,
    empty: result.list.length ? null : "Not in this match's data: no resolved own-half pass.",
  };
}

function transition(hero: Hero, view: Context): Built {
  const result = view.xt ? transitionAfterLoss(hero, view.xt) : { best: null, list: [] };
  const best = result.best;
  const metrics: Metric[] = best
    ? [
        {
          id: "space_behind_line",
          label: "Space behind the line · at loss → window end",
          values: [`${best.spaceAtLoss.toFixed(1)} m → ${best.spaceAtEnd.toFixed(1)} m`],
          pro: `Distance behind the deepest outfield defender at the loss and ${best.seconds.toFixed(1)} s later; the line moved ${best.lineTowardGoal.toFixed(1)} m toward its own goal.`,
          plain:
            "This shows how much room the new attackers had behind the defence after the loss.",
          definition: `Distance from the losing team's deepest outfield player to its own goal line at the loss and after ${best.seconds.toFixed(1)} s; the window stops at the next loss, ${TRANSITION_WINDOW_S} s, or the possession cut.`,
          source: "tracking",
          sourceNote: TRACKING("Measured"),
        },
        {
          id: "attackers_xt",
          label: "Attackers' xT · at loss → window peak",
          values: [`${best.xtStart.toFixed(3)} → ${best.xtPeak.toFixed(3)}`],
          pro: "The ball-winning team's expected threat at the regain and at the ball's most dangerous location in the window.",
          plain:
            "This shows how much more dangerous the attack became while the defence was recovering.",
          definition:
            "The ball-winning team's xT where it won the ball and the highest xT the ball reached in the measured window.",
          source: "tracking",
          sourceNote: TRACKING("Computed"),
        },
      ]
    : [];
  return {
    id: "transition",
    kicker: "Transition · the seconds after a loss",
    title: "Transition after losing the ball",
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
      "The back line is the deepest outfield player, not a detected tactical formation. Space is its distance to the goal line, and the window can be shorter than the definition when the stitched match cuts away. Recovery runs are not exported, so no recovery-run row is shown.",
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

const BUILDERS: Record<TacticId, (hero: Hero, view: Context) => Built> = {
  high_press,
  counter_attack,
  build_up,
  transition,
  corners,
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
function scoped(id: TacticId, session: Hero, xt: XtGrid | null, scope: Scope): LabCard {
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
 * The five tactic cards. Each uses the moment that shows it; counter-attack, possession and
 * transition prefer the stitched match from `scope`. A match page uses its match throughout.
 */
export function buildCards(hero: Hero, xt: XtGrid | null, scope: Scope = NO_SCOPE): LabCard[] {
  return CARD_IDS.map((id) => scoped(id, hero, xt, scope));
}
