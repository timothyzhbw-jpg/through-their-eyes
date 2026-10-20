// Render payload (SPEC 5.3): the verified narration of one breakdown, as explain.render's
// build_payload writes it. Each line lists its claim ids; each claim carries its kind, verdict,
// filled values, evidence event ids and the frame the replay seeks to, so any line's evidence can
// be opened from the main view (SPEC 7).
//
// The viewer checks a payload against the moment before using it, like a plan: references must
// resolve, evidence events must exist in the replayed runs, seek frames must be inside the clip.

import { z } from "zod";
import type { Hero } from "../data/hero";
import type { RunName } from "../data/types";
import type { MomentContext } from "../plan/moment";
import type { Script } from "../plan/schema";

export const CLAIM_KINDS = ["observed", "computed", "counterfactual"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

const PayloadLine = z.object({
  id: z.string(),
  text: z.string(),
  claims: z.array(z.string()),
});

const PayloadClaim = z.object({
  id: z.string(),
  kind: z.enum(CLAIM_KINDS),
  // build_payload only sends supported claims; anything else is withheld here as well.
  verdict: z.enum(["supported", "refuted", "inconclusive"]),
  values: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])),
  evidence: z.array(z.string()),
  seek_frame: z.number().int().nullable().optional(),
});

export const RenderPayload = z.object({
  moment: z.string(),
  persona: z.string(),
  language: z.string(),
  lines: z.array(PayloadLine),
  claims: z.array(PayloadClaim),
  // Set only by sim.export.render_payload_fixture; real payloads come from the verifier.
  fixture: z.boolean().optional(),
  note: z.string().optional(),
});

export type RenderPayload = z.infer<typeof RenderPayload>;
export type PayloadLine = z.infer<typeof PayloadLine>;
export type PayloadClaim = z.infer<typeof PayloadClaim>;

export interface Narration {
  payload: RenderPayload;
  fixture: boolean;
  lines: PayloadLine[]; // lines that may be shown: every claim supported
  withheld: PayloadLine[]; // lines with a claim that is not supported
  claims: Map<string, PayloadClaim>;
}

export type PayloadCheck = { ok: true; narration: Narration } | { ok: false; errors: string[] };

/** Which run shows a claim's evidence: a counterfactual is seen in the re-simulated run. */
export function claimRun(claim: PayloadClaim): RunName {
  return claim.kind === "counterfactual" ? "counterfactual" : "factual";
}

export const KIND_LABEL: Record<ClaimKind, { name: string; detail: string }> = {
  observed: { name: "Observed", detail: "an event or tracking fact" },
  computed: { name: "Computed", detail: "an analytics metric" },
  counterfactual: {
    name: "Counterfactual",
    detail: "re-simulated with one thing changed: causal only inside the sim",
  },
};

/** What a payload may refer to: its moment, the events evidence may cite, the clip length. */
export interface PayloadScope {
  moment: string;
  events: ReadonlySet<string>;
  frames: (claim: PayloadClaim) => number;
}

/** A moment's narration: evidence from either replayed run. */
export function validatePayload(raw: unknown, m: MomentContext, hero: Hero): PayloadCheck {
  const runs = [hero.runs.factual, hero.runs.counterfactual];
  return checkPayload(raw, {
    moment: m.id,
    events: new Set(runs.flatMap((r) => r.events.map((e) => e.id))),
    frames: (c) => hero.runs[claimRun(c)].frames,
  });
}

export function checkPayload(raw: unknown, scope: PayloadScope): PayloadCheck {
  const parsed = RenderPayload.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "payload"}: ${i.message}`),
    };
  }
  const payload = parsed.data;
  const errors: string[] = [];
  if (payload.moment !== scope.moment) {
    errors.push(`moment: payload is for ${payload.moment}, not ${scope.moment}`);
  }

  const claims = new Map<string, PayloadClaim>();
  for (const c of payload.claims) {
    if (claims.has(c.id)) errors.push(`claims: duplicate id ${c.id}`);
    claims.set(c.id, c);
  }
  for (const c of claims.values()) {
    for (const e of c.evidence) {
      if (!scope.events.has(e)) errors.push(`claim ${c.id}: evidence ${e} is not in the replay`);
    }
    const frames = scope.frames(c);
    if (c.seek_frame != null && (c.seek_frame < 0 || c.seek_frame >= frames)) {
      errors.push(`claim ${c.id}: seek_frame ${c.seek_frame} is outside the clip`);
    }
  }
  const lineIds = new Set<string>();
  for (const line of payload.lines) {
    if (lineIds.has(line.id)) errors.push(`lines: duplicate id ${line.id}`);
    lineIds.add(line.id);
    const missing = line.claims.filter((id) => !claims.has(id));
    if (missing.length) errors.push(`line ${line.id}: unknown claims ${missing.join(", ")}`);
    else if (line.claims.length && !line.claims.some((id) => claims.get(id)?.seek_frame != null)) {
      errors.push(`line ${line.id}: no claim has a seek frame, so its evidence cannot be shown`);
    }
  }
  if (errors.length) return { ok: false, errors };

  const supported = (line: PayloadLine) =>
    line.claims.every((id) => claims.get(id)?.verdict === "supported");
  return {
    ok: true,
    narration: {
      payload,
      fixture: payload.fixture === true,
      lines: payload.lines.filter(supported),
      withheld: payload.lines.filter((line) => !supported(line)),
      claims,
    },
  };
}

/** Line id -> caption text, for the plan's voice steps. Withheld lines are not in it. */
export function scriptOf(narration: Narration | null): Script {
  return Object.fromEntries((narration?.lines ?? []).map((line) => [line.id, line.text]));
}

export function lineOf(narration: Narration | null, id: string | null): PayloadLine | undefined {
  return id ? narration?.lines.find((line) => line.id === id) : undefined;
}

/** The kinds of a line's claims, in a fixed order: observed, computed, counterfactual. */
export function lineKinds(narration: Narration, line: PayloadLine): ClaimKind[] {
  const kinds = new Set(line.claims.map((id) => narration.claims.get(id)!.kind));
  return CLAIM_KINDS.filter((k) => kinds.has(k));
}

/** The claim a line opens on: its first claim with a seek frame. */
export function primaryClaim(narration: Narration, line: PayloadLine): PayloadClaim | undefined {
  return line.claims.map((id) => narration.claims.get(id)!).find((c) => c.seek_frame != null);
}
