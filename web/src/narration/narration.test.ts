// Acceptance check (SPEC 7): every caption line in the breakdown player opens its claims and
// seeks the replay to their evidence. Plus the payload checks the viewer runs (SPEC 5.3).

import { describe, expect, it } from "vitest";
import raw from "../../public/data/hero_seed3.json";
import payloadJson from "../../public/data/fixture_payload_seed3.json";
import { parseHero } from "../data/hero";
import { EXAMPLE_PLAN } from "../plan/example";
import { heroMoment } from "../plan/moment";
import { createSession } from "../session";
import {
  claimRun,
  KIND_LABEL,
  lineKinds,
  primaryClaim,
  scriptOf,
  validatePayload,
  type RenderPayload,
} from "./payload";

const hero = parseHero(raw);
const moment = heroMoment(hero);
const fixture = payloadJson as RenderPayload;
const check = (payload: unknown) => validatePayload(payload, moment, hero);
const errorsOf = (payload: unknown) => {
  const v = check(payload);
  return v.ok ? [] : v.errors;
};
const withClaim = (id: string, patch: object): RenderPayload => ({
  ...fixture,
  claims: fixture.claims.map((c) => (c.id === id ? { ...c, ...patch } : c)),
});

describe("render payload", () => {
  it("loads the fixture, marked as one, with a claim of every kind", () => {
    const v = check(fixture);
    expect(v.ok ? [] : v.errors).toEqual([]);
    if (!v.ok) return;
    expect(v.narration.fixture).toBe(true);
    expect(new Set(fixture.claims.map((c) => c.kind))).toEqual(
      new Set(["observed", "computed", "counterfactual"]),
    );
  });

  it("rejects payloads whose references do not resolve", () => {
    const line0 = fixture.lines[1];
    expect(errorsOf({ ...fixture, moment: "m:decision_after_scan:H8:0099" })).not.toEqual([]);
    expect(errorsOf({ ...fixture, lines: [{ ...line0, claims: ["no_such_claim"] }] })).not.toEqual(
      [],
    );
    expect(errorsOf(withClaim("belief_error", { evidence: ["pass:H8:9999"] }))).not.toEqual([]);
    expect(errorsOf(withClaim("belief_error", { seek_frame: 5000 }))).not.toEqual([]);
    expect(errorsOf(withClaim("belief_error", { kind: "opinion" }))).not.toEqual([]);
    expect(errorsOf({ ...fixture, claims: [...fixture.claims, fixture.claims[0]] })).not.toEqual(
      [],
    );
  });

  it("rejects a line whose evidence cannot be shown (no claim has a seek frame)", () => {
    expect(errorsOf(withClaim("runner_received", { seek_frame: null }))).toEqual([
      expect.stringMatching(/line L4: no claim has a seek frame/),
    ]);
  });

  it("withholds a line unless every claim on it is supported", () => {
    const v = check(withClaim("cf_belief_error", { verdict: "inconclusive" }));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.narration.withheld.map((l) => l.id)).toEqual(["L3"]);
    expect(Object.keys(scriptOf(v.narration))).not.toContain("L3");
  });
});

describe("every caption line opens its claims and seeks the replay to their evidence", () => {
  const session = createSession(hero, EXAMPLE_PLAN, fixture);
  const { narration: shown, resolved } = session.breakdown.get();
  const narration = shown!;
  const { controls, playback } = session;

  it("captions every line of the payload in the example plan", () => {
    expect(resolved.source).toBe("given");
    const voiced = resolved.plan.steps.flatMap((s) => (s.do === "voice" ? [s.line] : []));
    expect([...voiced].sort()).toEqual(narration.lines.map((l) => l.id).sort());
  });

  for (const line of fixture.lines.filter((l) => l.claims.length)) {
    it(`${line.id}: opens on its first claim and on each claim`, () => {
      controls.openLine(line.id);
      const first = primaryClaim(narration, line)!;
      expect(playback.get()).toMatchObject({
        evidenceLine: line.id,
        frame: first.seek_frame,
        mode: claimRun(first),
        playing: false,
      });
      for (const id of line.claims) {
        const claim = narration.claims.get(id)!;
        controls.openLine(line.id, id);
        expect(playback.get()).toMatchObject({ frame: claim.seek_frame, mode: claimRun(claim) });
      }
    });
  }

  it("opens a connective line without moving the replay", () => {
    controls.openLine("L4");
    const before = playback.get().frame;
    controls.openLine("L1");
    expect(playback.get()).toMatchObject({ evidenceLine: "L1", frame: before });
  });

  it("labels counterfactual lines and shows them in the re-simulated run", () => {
    const l5 = narration.lines.find((l) => l.id === "L5")!;
    expect(lineKinds(narration, l5)).toEqual(["counterfactual"]);
    expect(KIND_LABEL.counterfactual.detail).toMatch(/only inside the sim/);
    controls.openLine("L5");
    expect(playback.get()).toMatchObject({ mode: "counterfactual", cfGhost: true });
    controls.openLine("L2");
    expect(playback.get()).toMatchObject({ mode: "factual", scanMarker: hero.keyScan!.id });
  });

  it("seeks to a single evidence event", () => {
    controls.seekEvidence("runner_received", "reception:H9:0139");
    expect(playback.get()).toMatchObject({ mode: "factual", frame: 139 });
  });

  it("takes over from a running breakdown", () => {
    controls.playBreakdown();
    expect(session.runner.status.get().status).toBe("running");
    controls.openLine("L2");
    expect(session.runner.status.get().status).toBe("stopped");
    controls.closeEvidence();
    expect(playback.get().evidenceLine).toBeNull();
  });
});
