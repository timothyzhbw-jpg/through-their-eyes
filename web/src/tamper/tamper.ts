// "Try a wrong number" (SPEC 7 producer console): the viewer changes one value of a claim in the
// evidence card and the live service checks the claim again with the real verifier,
// POST /api/verify (api/tamper.py). A wrong number is refuted and its line would not air; the
// verified one is supported. Nothing the viewer tries is saved to the audit log or aired.

import { ApiError, type VerifyResponse } from "../api/client";
import type { PayloadClaim } from "../narration/payload";

export interface TamperState {
  open: string | null; // the claim whose control is open
  status: "idle" | "checking" | "done" | "failed";
  claim: string | null; // what was last sent
  slot: string | null;
  value: number | null;
  result: VerifyResponse | null;
  error: string | null;
}

export const IDLE_TAMPER: TamperState = {
  open: null,
  status: "idle",
  claim: null,
  slot: null,
  value: null,
  result: null,
  error: null,
};

/** A claim's values that are numbers (not player ids or flags), in payload order. */
export function numericValues(claim: Pick<PayloadClaim, "values">): [string, number][] {
  return Object.entries(claim.values).filter(
    (e): e is [string, number] => typeof e[1] === "number",
  );
}

const decimalsOf = (value: number) => (String(value).split(".")[1] ?? "").length;

/**
 * The number the control starts with: half as much again, at the precision shown (0 becomes 1).
 * Wrong on purpose, so one click shows a refusal; the viewer can type any other.
 */
export function wrongNumber(value: number): number {
  const d = decimalsOf(value);
  const unit = 10 ** -d;
  if (value === 0) return 1;
  const scaled = Math.round(Number((value * 1.5 * 10 ** d).toPrecision(12)));
  const wrong = Number((scaled * unit).toFixed(d));
  return wrong === value ? Number((value + Math.sign(value) * unit).toFixed(d)) : wrong;
}

/** Why there is no check, in a sentence: the service's own reason when it gave one. */
export function tamperError(err: unknown): string {
  if (err instanceof ApiError && err.detail) return err.detail;
  if (err instanceof ApiError && err.status === 429) return "too many checks: try again shortly";
  return err instanceof Error ? err.message : String(err);
}
