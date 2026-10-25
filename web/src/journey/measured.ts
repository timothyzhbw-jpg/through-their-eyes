// The one measured number For studios quotes (SPEC 7, 11): what the deployed crew's model calls
// cost per verified breakdown, docs/NUMBERS.md MA6, from eval/reports/crew_vs_single.md (arm D,
// the crew with the Verifier, on Microsoft Foundry's gpt-4.1-mini at its list price). The marker
// on the next line is read by tests/test_doc_numbers.py against the report; journey.test.tsx
// checks the value shown is the marked one. Every other figure on the door is demo data or none.

export const COST_PER_VERIFIED_BREAKDOWN = "$0.0090"; // <!--num:MA6-->$0.0090<!--/num-->

/** Where the number is measured (the report, on GitHub). */
export const COST_REPORT_URL =
  "https://github.com/timothyzhbw-jpg/through-their-eyes/blob/main/eval/reports/crew_vs_single.md";
