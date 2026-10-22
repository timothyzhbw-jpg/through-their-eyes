// Where a breakdown or a recap came from, as the API says it (`provenance`, api/main.py): the crew
// ran for this request (live), a crew run from an earlier time (cached), or the offline template
// with no model call and why. Shown exactly as given: nothing here works it out from `cached` or
// `source`, so a cached or template answer is never presented as a fresh crew run. An answer
// without it (an older service) shows no chip.

import { z } from "zod";

export const Provenance = z.object({
  kind: z.enum(["live", "cached", "template"]),
  ran_at: z.string().nullable(), // when the crew run that wrote it started, UTC ISO 8601
  reason: z.enum(["rate_limited", "capped", "model_unavailable"]).nullable(),
});
export type Provenance = z.infer<typeof Provenance>;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** "21 Oct 2026, 19:31 UTC"; null when the time does not parse. */
export function utcTime(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export const REASON: Record<NonNullable<Provenance["reason"]>, string> = {
  rate_limited: "rate-limited: too many new requests from this address",
  capped: "today's model budget is used up",
  model_unavailable: "the model is unavailable on this service",
};

/** The sentence the chip says. */
export function provenanceText(p: Provenance): string {
  if (p.kind === "live") return "Live: written by the crew just now";
  if (p.kind === "cached") {
    const at = p.ran_at ? utcTime(p.ran_at) : null;
    return at
      ? `Cached: a crew run from ${at}`
      : "Cached: a crew run from before run times were recorded";
  }
  return `Offline template: no model call${p.reason ? ` (${REASON[p.reason]})` : ""}`;
}
