// Slot filling. A missing claim uses a slot-free fallback, or the line is dropped.
import assert from "node:assert/strict";
import { test } from "node:test";
import { claimTable, fill, fillDeep, narrationText, reportFacts, resolveTitle, resolveVo } from "../lib/claims.mjs";

const claims = {
  belief_error: {
    usable: true,
    values: { err: "wide" },
    seen: ['casual/en l1: "the gap was wide"'],
  },
  bad: { usable: false, values: { err: "9" }, seen: ["unsupported"] },
};

test("fill replaces a usable claim and records where it was seen", () => {
  const result = fill("Off by {belief_error.err}.", claims);
  assert.equal(result.text, "Off by wide.");
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.used, [
    { slot: "{belief_error.err}", value: "wide", seen: 'casual/en l1: "the gap was wide"' },
  ]);
});

test("fill leaves a missing or unusable slot untouched", () => {
  const missing = fill("Off by {belief_error.other}.", claims);
  assert.equal(missing.text, "Off by {belief_error.other}.");
  assert.deepEqual(missing.missing, ["{belief_error.other}"]);
  const unusable = fill("Off by {bad.err}.", claims);
  assert.equal(unusable.text, "Off by {bad.err}.");
  assert.deepEqual(unusable.missing, ["{bad.err}"]);
  const unknown = fill("Off by {nope.err}.", claims);
  assert.deepEqual(unknown.missing, ["{nope.err}"]);
});

test("fillDeep walks strings inside objects and arrays", () => {
  const result = fillDeep({ text: "Off by {belief_error.err}", lines: ["{bad.err}", { sub: "plain" }] }, claims);
  assert.equal(result.params.text, "Off by wide");
  assert.equal(result.params.lines[0], "{bad.err}");
  assert.equal(result.params.lines[1].sub, "plain");
  assert.deepEqual(result.missing, ["{bad.err}"]);
  assert.equal(result.used.length, 1);
});

test("a voice-over line uses its fallback, or is dropped", () => {
  const used = resolveVo({ id: "vo01", text: "Off by {nope.err}.", fallback: "The picture was off." }, claims);
  assert.equal(used.drop, false);
  assert.equal(used.fallback, true);
  assert.equal(used.text, "The picture was off.");
  assert.deepEqual(used.used, []);
  assert.deepEqual(used.missing, ["{nope.err}"]);

  const dropped = resolveVo({ id: "vo01", text: "Off by {nope.err}." }, claims);
  assert.equal(dropped.drop, true);
  assert.match(dropped.warning, /missing \{nope\.err\}/);
  assert.match(dropped.warning, /dropped/);

  const badFallback = resolveVo(
    { id: "vo01", text: "Off by {nope.err}.", fallback: "Off by {nope.err}." },
    claims,
  );
  assert.equal(badFallback.drop, true);
  assert.match(badFallback.warning, /fallback contains a slot/);
});

test("a title uses fallback params, or is dropped", () => {
  const used = resolveTitle(
    { id: "lower", params: { text: "Off by {nope.err}" }, fallback: { text: "The picture was off" } },
    claims,
  );
  assert.equal(used.drop, false);
  assert.equal(used.fallback, true);
  assert.deepEqual(used.params, { text: "The picture was off" });
  assert.deepEqual(used.used, []);

  const dropped = resolveTitle({ id: "lower", params: { text: "Off by {nope.err}" } }, claims);
  assert.equal(dropped.drop, true);
  assert.match(dropped.warning, /title "lower"/);
  assert.match(dropped.warning, /no fallback, dropped/);

  const still = resolveTitle(
    { id: "lower", params: { text: "Off by {nope.err}" }, fallback: { text: "Off by {also.missing}" } },
    claims,
  );
  assert.equal(still.drop, true);
  assert.match(still.warning, /fallback still has/);
});

test("a narration line speaks the harvested sentence, or is dropped", () => {
  const doc = {
    sources: [
      {
        persona: "casual",
        language: "zh",
        lines: [{ text: "He saw the run." }, { text: "" }],
      },
    ],
  };
  assert.equal(narrationText(doc, { persona: "casual", language: "zh", index: 0 }), "He saw the run.");
  assert.equal(narrationText(doc, { persona: "casual", language: "zh", index: 4 }), null);
  const spoken = resolveVo({ id: "vo12", line: { persona: "casual", language: "zh", index: 0 } }, claims, doc);
  assert.equal(spoken.drop, false);
  assert.equal(spoken.narration, true);
  assert.equal(spoken.text, "He saw the run.");
  const missing = resolveVo({ id: "vo12", line: { persona: "casual", language: "zh", index: 4 } }, claims, doc);
  assert.equal(missing.drop, true);
  assert.match(missing.warning, /not in claims\.json/);
  assert.match(missing.warning, /casual\/zh #4/);
});

test("claimTable keeps a claim only when every sighting agrees and is supported", () => {
  const ok = claimTable([
    {
      persona: "casual",
      language: "en",
      verified: true,
      lines: [{ id: "l1", text: "wide", claims: [{ id: "belief_error", verdict: "supported", values: { err: "wide" } }] }],
    },
  ]);
  assert.equal(ok.belief_error.usable, true);
  const conflict = claimTable([
    {
      persona: "casual",
      language: "en",
      verified: true,
      lines: [{ id: "l1", text: "wide", claims: [{ id: "belief_error", verdict: "supported", values: { err: "wide" } }] }],
    },
    {
      persona: "analyst",
      language: "en",
      verified: true,
      lines: [{ id: "l2", text: "narrow", claims: [{ id: "belief_error", verdict: "supported", values: { err: "narrow" } }] }],
    },
  ]);
  assert.equal(conflict.belief_error.usable, false);
  assert.ok(conflict.belief_error.conflict);
  const fixture = claimTable([
    {
      persona: "casual",
      language: "en",
      verified: false,
      lines: [{ id: "l1", text: "wide", claims: [{ id: "belief_error", verdict: "supported", values: { err: "wide" } }] }],
    },
  ]);
  assert.equal(fixture.belief_error.usable, false);
});

test("report facts read numbers off a committed report, with thousands separators", () => {
  const report = "## Headline\n- Of 2837 perturbed lines (11 kinds), 2837 were kept off the air with the Verifier (14 by tidy).";
  const facts = {
    verifier_offline: { file: "eval/reports/x.md", pattern: "Of (\\d+) perturbed lines \\([^)]*\\), (\\d+) were kept off", values: ["total", "kept"] },
    gone: { file: "eval/reports/x.md", pattern: "no such line (\\d+)", values: ["n"] },
  };
  const table = reportFacts((file) => (file === "eval/reports/x.md" ? report : null), facts);
  assert.deepEqual(table.verifier_offline.values, { total: "2,837", kept: "2,837" });
  assert.equal(table.verifier_offline.usable, true);
  assert.match(table.verifier_offline.seen[0], /^eval\/reports\/x\.md L2: "Of 2837/);
  assert.equal(table.gone.usable, false); // the title takes its fallback
  assert.equal(fill("{verifier_offline.kept} OF {verifier_offline.total}", table).text, "2,837 OF 2,837");
});
