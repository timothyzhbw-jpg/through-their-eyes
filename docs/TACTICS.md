# Tactics knowledge base: what we show, and what the sim needs for the rest

A teammate who plays proposed a tactics knowledge base: each tactic goes **tactic → mechanism →
data evidence → fan-friendly explanation**. Most rows need events our simulator does not produce
yet (tackles, crosses and headers, regains under a counter-press, open play that attacks the
goal), so computing them now would mean inventing numbers. We built the two cards our data truly
supports and keep the rest here as the roadmap, each with what the sim would need first.

## What is built: two cards (SPEC 4.8)

Both cards are in the analyst's live stats panel and in the end-of-match recap
(`web/src/tactics/`), served by `GET /api/matches/<id>/tactics`.

- **Measured, not invented.** The numbers come from the tracking and the event feed, through the
  live stats timeline ([analytics/tactics.py](../analytics/tactics.py)): pass outcomes from the
  feed, pressing intensity on the passer at the kick (Bekkers 2025), expected threat from our
  fitted grid (SPEC 4.5). They carry the `tracking` source chip.
- **The decision options are sim records.** They carry the `sim` chip.
- **One verified sentence per card.** It is a claim like any narration line
  ([explain/tactics.py](../explain/tactics.py)). A template fills it from the card, in English
  and Chinese, and the Verifier measures the card again from the run (`tactics_stat`) before the
  sentence airs. No model writes a digit.

```
uv run python -m explain.tactics --match 1     # the cards and sentences of match-1
```

### Why build from the back?

Passes kicked in the passer's own half, per team:
- all of them, and split with and without pressure on the passer (pressing intensity ≥ 0.7,
  the lexicon's heavy pressure);
- short against long (long: to a teammate 32 m or more away at the kick);
- line-breaking passes (completed past two or more outfield opponents, as the moment detector
  counts them);
- the xT each kind adds;
- the xT a lost one hands the opponent where they won it.

Where the sim records the alternatives (the decision model's options, SPEC 3.5), the card shows
what the carrier chose against his best short option, his best long option and his safest pass.

On match-1 (measured 2026-10-22 on Linux, with the team shape, #150, and the keeper spot):

- Under pressure, Home completed 30 of its 38 short passes out from the back (79%), against 86%
  without pressure.
- The passes it lost there handed Away the ball where it was worth 0.048 xT on average.
- In the pressure hero (5:09), H4 under a press of 0.94 chose the 35 m pass to H7 (P 0.82,
  value +0.013). His safest pass was back to H1 (P 0.95, +0.005); his best long option, to H3,
  was worth about the same as the one he took (+0.013).

What it cannot say yet:
- **Open play passes by a rule.** Outside the hero moments, who passes, when and to whom
  comes from possession play's passing rule (SPEC 3.1: after a moment on the ball, the carrier
  plays an onside team-mate 8–35 m away, picked by a draw weighted toward space); the decision
  model chooses only at the hero moments (SPEC 3.5). The movement, press, marking, perception
  and whether each pass arrives are simulated throughout. So the rates describe that rule under
  the sim's press, not a coached team's choices.
- **Long balls are rare** (6 for Home in match-1), and tackles are not modelled.

### Why focus on set pieces?

For each team:
- corners;
- shots after a corner and their xG (the sim's distance shot model), and xG per corner;
- the share of the match's shots and xG from set pieces;
- how much threat a corner reaches: the best reception's xT, against the open-play passages'.

On match-1:
- Its one corner put A9 on the ball 4.4 s after the kick at a spot worth 0.20 xT. One of the 18
  open-play passages reached more (their median best is 0.0154).
- No shot followed, so corners added 0.00 xG.

What it cannot say yet:
- **The corner passage ends at the cutback.** The stitched match cuts it before a shot could
  follow (SPEC 3.1), so set-piece xG is zero by construction.
- **The comparison flatters the corner.** Open play is possession play that rarely reaches the
  final third.
- **One corner, and only one kind.** match-1 has a single corner, played short, and the sim plays
  no other set piece.
- **One shot in match-1**, the shot hero's, from open play.

## The full table, and what each row needs

"Have" means the sim records it today; "Needs" is what must exist before the row can be shown
without inventing anything.

| Tactic | Mechanism | Data evidence | For a fan | Have | Needs | Status |
|---|---|---|---|---|---|---|
| **Build from the back** | Keep the ball through the press with short passes from the keeper and centre-backs, to draw the press and find space behind it | Completion of own-half passes under pressure, line-breaking passes, xT gained, short against long | "Playing out is a bet: keep it and the press is beaten, lose it and they are near your goal." | Passes, outcomes, pressing intensity, xT, the decision model's options | Decision-made open play (not rule-based possession play), tackles | **Built** (the card above) |
| **Set pieces** | Rehearsed routines put the ball near goal in seconds, against a set defence | Corners, shots and xG from corners, xG per corner, share of chances from set pieces | "A corner is a free chance to put the ball in the box." | Corners (the corner hero), receptions and xT, the distance xG model | A corner passage that plays on to a shot (shots on, no cut), crosses and headers, free kicks and throw-ins as set pieces | **Built, partly**: no shot follows a corner yet |
| **High press** | Press high and together to win the ball near the opponent's goal | PPDA (opponent passes per defensive action), high turnovers (regains in the final third), shots and xT within 10 s of a high regain | "Win it back where the goal is close." | Pressing intensity per frame, interception locations, xT | Tackles, challenges and fouls in every scenario (PPDA's defensive actions; today only interceptions), a team-level press behaviour, open play that shoots after a regain | Roadmap |
| **Counter-attack** | After winning the ball, attack fast before the defence is set | Time from regain to shot or box entry, speed toward goal (m/s), xT gained in the 10 s after a regain, shots from fast breaks | "Go before they are back in shape." | Regains (interceptions), positions and ball speed, xT | Open play that attacks the goal after a regain (the decision model for every carrier, shots on), possessions that carry on through a turnover instead of being cut | Roadmap |
| **Wide overloads** | Outnumber the opponent on a flank, then cross or cut back | Numerical superiority in a wing channel, overlapping runs, crosses and their xG, cut-backs | "Two against one out wide makes the cross." | Positions (players per channel are countable), cut-backs on the ground | Crosses (balls in the air into the box), headers and aerial duels with a shot model for them, an overlap behaviour | Roadmap |
| **Central penetration** | Break lines through the middle, receive between the lines, go into Zone 14 and the box | Line-breaking passes through the centre, receptions between the lines, entries into Zone 14 and the box, xT gained | "Through the middle is the shortest way to goal." | Line-breaking passes, receptions, positions, xT | Open play that reaches the final third and shoots (possession play rarely does), so the payoff can be measured | Roadmap |
| **Low block** | Defend deep and compact, deny space between the lines, break on the counter | Defensive line height, team length and width, xT and xG conceded from central zones, blocks and clearances | "Park the bus: no space behind, little in front." | Positions (line height and compactness are computable) | A defending team that chooses its line height (a shape model), clearances, blocked shots in open play | Roadmap |
| **Counter-press** | Win the ball back within seconds of losing it, before the opponent can play out | Regains within 5 s of a loss, pressing intensity in those seconds, how often it works | "Lose it, hunt it." | Losses (interceptions), pressing intensity per frame | Tackles and duels everywhere (regains are interceptions only), a transition behaviour for the team that just lost the ball, possessions not cut at the turnover | Roadmap |

## What would unlock most of the table

1. **Open play that attacks.** Today's possession play passes by a rule. The `open_play` scenario
   already exists: every carrier decides with the decision model and shots are on (the xT fit
   uses it, SPEC 4.5). Putting it in the stitched match unlocks counter-attack, central
   penetration and the payoff rows of the high press and the low block.
2. **Tackles and duels in every scenario.** They exist in the pressure hero only. They are
   needed for PPDA, regains and the counter-press.
3. **Balls in the air.** Crosses, headers and aerial duels, with a shot model for headers. They
   are needed for wide overloads and for real set-piece xG.
4. **Possessions that run through a turnover**, rather than ending at the next cut, so the seconds
   after a loss or a regain are on the clock.

Each step changes the sim's output, so every eval report and committed export is regenerated
with it (SPEC 3.7).
