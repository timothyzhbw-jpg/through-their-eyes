// A recap of the test match (testing.tsx matchExport) in the shape POST /api/recaps answers
// (agents/recap.py RecapResult): three key moments, a card, and a cue sheet with an intro, one
// clip per moment and an outro. For tests only.

import type { MatchExport } from "../data/types";
import { MATCH, MATCH_HERO, MATCH_PRESS } from "../testing";

const timecode = (t: number) => {
  const frames = Math.round(t * 25);
  const ff = frames % 25;
  const s = Math.floor(frames / 25);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(ff)}`;
};

const TEXT = {
  en: {
    S: "Full time: Home 1, Away 0.",
    K1: "When H8 looked over his shoulder before the ball arrived, he saw H9.",
    K2: "H8's pass to H9 went past three opponents.",
    K3: "H8 was under heavy pressure when he released the ball.",
    T1: "Home completed 30 of 34 passes.",
    connective: "Let's go back.",
  },
  zh: {
    S: "全场结束：主队1比0客队。",
    K1: "球到之前回头的那一眼，H8看到了H9。",
    K2: "H8传给H9的这脚球越过了三名对手。",
    K3: "H8是在重压之下出球的。",
    T1: "主队34次传球中完成了30次。",
    connective: "倒回去看看。",
  },
} as const;

export function recapFixture(
  m: MatchExport,
  persona = "casual",
  language: "en" | "zh" = "en",
  patch: {
    source?: "model" | "offline";
    capped?: boolean;
    rate_limited?: boolean;
    cached?: boolean;
    provenance?: object | null; // the API's `provenance`; null: an older service
  } = {},
) {
  const text = TEXT[language];
  const events = m.runs.factual.events;
  const byMoment = (id: string) => m.moments.find((c) => c.id === id)!;
  const hero = byMoment(MATCH_HERO);
  const press = byMoment(MATCH_PRESS);
  const lineBreak = m.moments.find((c) => c.kind === "line_breaking_pass")!;
  const scan = events.find(
    (e) => e.type === "scan" && e.player === "H8" && e.frame <= hero.anchor_frame,
  )!;
  const claims = {
    final_score: { kind: "observed", values: { home: 1, away: 0 }, evidence: [], seek: null },
    "k2.seen_in_scan": { kind: "computed", values: {}, evidence: [scan.id], seek: scan.frame },
    "k3.bypassed": {
      kind: "observed",
      values: { n: 3 },
      evidence: [],
      seek: lineBreak.anchor_frame,
    },
    "k1.heavy_pressure": { kind: "computed", values: {}, evidence: [], seek: press.anchor_frame },
    passes_home: { kind: "observed", values: { done: 30, passes: 34 }, evidence: [], seek: null },
  } as const;
  const claim = (id: keyof typeof claims) => ({
    id,
    kind: claims[id].kind,
    verdict: "supported",
    values: claims[id].values,
    evidence: claims[id].evidence,
    seek_frame: claims[id].seek,
  });
  const card = {
    moment: `recap:${MATCH}`,
    persona,
    language,
    lines: [
      { id: "S", text: text.S, claims: ["final_score"] },
      { id: "K1", text: text.K1, claims: ["k2.seen_in_scan"] },
      { id: "K2", text: text.K2, claims: ["k3.bypassed"] },
      { id: "K3", text: text.K3, claims: ["k1.heavy_pressure"] },
      { id: "T1", text: text.T1, claims: ["passes_home"] },
    ],
    claims: [
      claim("final_score"),
      claim("k2.seen_in_scan"),
      claim("k3.bypassed"),
      claim("k1.heavy_pressure"),
      claim("passes_home"),
    ],
  };
  const lines = [
    { id: "L1", text: text.S, claims: ["final_score"] },
    { id: "L2", text: text.connective, claims: [] },
    { id: "L3", text: text.K1, claims: ["k2.seen_in_scan"] },
    { id: "L4", text: text.K2, claims: ["k3.bypassed"] },
    { id: "L5", text: text.K3, claims: ["k1.heavy_pressure"] },
    { id: "L6", text: text.T1, claims: ["passes_home"] },
  ];
  const payload = { ...card, lines, claims: card.claims };
  // The reel: a 2 s intro, three 2 s clips (50 frames at 1x), a 2 s outro.
  const clipOf = (c: { id: string; anchor_frame: number; possession: number }, camera: string) => ({
    moment: c.id,
    possession: c.possession,
    frame_in: c.anchor_frame - 40,
    frame_out: c.anchor_frame + 9,
    speed: 1,
    camera,
  });
  const clips = [
    clipOf(hero, "broadcast"),
    clipOf(lineBreak, "tactical"),
    clipOf(press, "broadcast"),
  ];
  const cue = (id: string, type: string, t: number, until: number, extra: object = {}) => ({
    id,
    type,
    t,
    until,
    tc: timecode(t),
    tc_out: timecode(until),
    claims: [],
    data: {},
    ...extra,
  });
  const caption = (id: string, line: (typeof lines)[number], t: number, until: number) =>
    cue(id, "caption", t, until, {
      line: line.id,
      speaker: "pbp",
      text: line.text,
      claims: line.claims,
    });
  const cues = [
    cue("q1", "score_bug", 0, 10, {
      text: text.S,
      claims: ["final_score"],
      data: { home: 1, away: 0, state: "full_time" },
    }),
    caption("q2", lines[0], 0.4, 2),
    ...clips.flatMap((c, k) => {
      const t = 2 + 2 * k;
      return [
        cue(`q${3 + 3 * k}`, "clip", t, t + 2, {
          moment: c.moment,
          data: {
            possession: c.possession,
            match_frame_in: c.frame_in,
            match_frame_out: c.frame_out,
            speed: c.speed,
            camera: c.camera,
            hold_s: 0,
          },
        }),
        cue(`q${4 + 3 * k}`, "moment_title", t, t + 1.5, {
          moment: c.moment,
          text: [text.K1, text.K2, text.K3][k],
          data: {
            kind: c.moment.split(":")[1],
            actor: "H8",
            receiver: null,
            lens: null,
            rank: k + 1,
          },
        }),
        caption(`q${5 + 3 * k}`, lines[k + 2], t + 0.4, t + 2),
      ];
    }),
    caption("q12", lines[5], 8.4, 10),
    cue("q13", "stat", 8, 10, {
      line: "T1",
      text: text.T1,
      claims: ["passes_home"],
      data: { done: 30, passes: 34 },
    }),
  ];
  const voice = lines.map((line) => ({
    line: line.id,
    speaker: "pbp",
    t: cues.find((c) => "line" in c && c.line === line.id)?.t ?? 0,
    voice: language === "zh" ? "zh-CN-YunjianNeural" : "en-US-DavisNeural",
    ssml: `<speak>${line.text}</speak>`,
    cache_key: `${persona}${language}${line.id}`.padEnd(16, "0").slice(0, 16),
  }));
  const moment = (c: typeof hero, rank: number, kind: string) => ({
    id: c.id,
    rank,
    kind,
    tags: [kind],
    actor: "H8",
    receiver: null,
    lens: c.selected_lens,
    hero: c.hero,
    possession: c.possession,
    anchor_frame: c.anchor_frame,
  });
  return {
    key: "a".repeat(32),
    cached: patch.cached ?? false,
    rate_limited: patch.rate_limited ?? false,
    capped: patch.capped ?? false,
    source: patch.source ?? "offline",
    ...(patch.provenance === null
      ? {}
      : {
          provenance: patch.provenance ?? {
            kind: "template",
            ran_at: "2026-10-21T19:31:12+00:00",
            reason: "model_unavailable",
          },
        }),
    result: {
      request: {
        match: MATCH,
        moments: clips.map((c) => c.moment),
        personas: [persona],
        languages: [language],
        priority: "high",
        reason: "Template.",
      },
      findings: {
        match: MATCH,
        moments: clips.map((c) => c.moment),
        headline: ["final_score"],
        supporting: ["passes_home"],
        angle: "The match.",
      },
      score: { home: 1, away: 0 },
      moments: [
        moment(hero, 2, "decision_after_scan"),
        moment(lineBreak, 3, "line_breaking_pass"),
        moment(press, 1, "pressed_decision"),
      ],
      stats: ["passes_home"],
      reel: { match: MATCH, clips },
      reel_source: "template",
      reel_errors: [],
      tier: "excited",
      scripts: [
        {
          persona,
          language,
          lines: lines.map((l) => ({ ...l, speaker: "pbp" })),
          payload,
          dropped: [],
          rewrites: 0,
          voice,
          card,
          card_moments: { [hero.id]: "K1", [lineBreak.id]: "K2", [press.id]: "K3" },
          cues: { version: 1, match: MATCH, persona, language, fps: 25, duration_s: 10, cues },
        },
      ],
      trace: ["director", "analyst", "telestrator", "narration", "verifier", "voice"].map(
        (step) => ({
          step,
          source: ["verifier", "voice"].includes(step) ? "code" : "template",
          attempts: 0,
          ms: 0,
          error: null,
          notes: [],
        }),
      ),
      total_ms: 12,
    },
  };
}
