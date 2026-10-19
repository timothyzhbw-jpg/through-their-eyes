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
