"""Corruption check (SPEC 5.3, acceptance checks — explain), on a small sample.

The full run (seeds 0-19, 100 perturbations) is `uv run python -m eval.corruption`; its report is
eval/reports/corruption.md.
"""

import pytest

from eval.corruption import PERTURBATIONS, run_eval


@pytest.fixture(scope="module")
def result():
    return run_eval(seeds=[0, 1], n=24, rng_seed=7)


def test_generated_hero_claims_are_all_supported(result):
    assert result.generated
    assert {g.verdict.status for g in result.generated} == {"supported"}
    kinds = {g.kind for g in result.generated}
    assert {"scans_before_reception", "pass_to_runner", "unmarked", "blind_side",
            "scan_before_reception", "cf_value"} <= kinds  # fmt: skip


def test_every_perturbation_type_is_exercised(result):
    assert len(result.perturbed) == 24
    assert {p.perturbation for p in result.perturbed} == set(PERTURBATIONS)
    assert all(p.claim.fingerprint() != p.original.claim.fingerprint() for p in result.perturbed)


def test_false_perturbations_are_refuted(result):
    false = [p for p in result.perturbed if p.truth is False]
    assert false
    refuted = sum(p.verdict.status == "refuted" for p in false)
    assert refuted / len(false) >= 0.98, [
        (p.kind, p.perturbation, p.verdict.status, p.verdict.reason)
        for p in false if p.verdict.status != "refuted"
    ]  # fmt: skip


def test_perturbations_that_stay_true_are_still_supported(result):
    for p in result.perturbed:
        if p.truth is True:
            assert p.verdict.status == "supported", (p.kind, p.perturbation, p.verdict.reason)
        if p.truth is None:  # the recording cannot decide: neither can the verifier
            assert p.verdict.status == "inconclusive", (p.kind, p.perturbation, p.verdict.reason)


def test_claims_the_verifier_did_not_support_never_render(result):
    assert not any(p.rendered for p in result.perturbed if p.verdict.status != "supported")


def test_every_supported_claim_renders_cleanly_in_both_languages(result):
    assert result.render_failures == []
    assert result.rendered == 2 * len(result.generated)


def test_payloads_pass_the_final_check_and_every_claim_is_labelled(result):
    assert result.payloads == 4  # two seeds, en and zh
    assert result.payload_violations == []
    assert result.payload_lines == 2 * (len(result.generated) + 2)
    assert {g.claim.kind for g in result.generated} == {"observed", "computed", "counterfactual"}
    for g in result.generated:
        uses_cf = "cf_delta" in g.claim.predicate.model_dump_json() or g.kind.startswith("cf_")
        assert (g.claim.kind == "counterfactual") == uses_cf, g.kind
    assert result.card_anchored > len(result.generated) // 2


DESCRIBING = ("reception_zone", "scan_side", "seen_in_scan")  # audio description (SPEC 1)


def test_the_oracle_agrees_with_every_generated_claim_it_judges(result):
    from eval.corruption import APPLICABLE, ground_truth

    judged = {kind for table in APPLICABLE.values() for kind in table}
    assert set(DESCRIBING) <= judged & {g.kind for g in result.generated}
    for g in result.generated:
        if g.kind in judged:
            assert ground_truth(g.kind, g.claim, g.world) is True, (g.world.seed, g.kind)


@pytest.mark.parametrize("kind", DESCRIBING)
def test_perturbed_describing_claims_are_judged_like_the_oracle(result, kind):
    """Every applicable perturbation of the new claims, on both seeds: the verifier refutes what
    the oracle finds false and supports what stays true."""
    import random

    from eval.corruption import APPLICABLE, ground_truth, perturb

    rng = random.Random(3)
    judged = []
    for g in (g for g in result.generated if g.kind == kind):
        for ptype, table in APPLICABLE.items():
            if kind not in table:
                continue
            for _ in range(4):
                claim, change = perturb(g, ptype, rng)
                truth = ground_truth(kind, claim, g.world)
                verdict = g.world.verifier.verify(claim)
                expected = {True: "supported", False: "refuted", None: "inconclusive"}[truth]
                assert verdict.status == expected, (g.world.seed, ptype, change, verdict.reason)
                judged.append(truth)
    assert False in judged
