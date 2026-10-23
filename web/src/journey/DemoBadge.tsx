// The demo-data legend (SPEC 7): one badge, word for word the same, wherever an audience or a
// sponsor figure is on screen (the Content studio's business panel, the stadium's sponsor slots,
// the Value step). Nobody has watched this app: those figures are a seeded simulation, not a
// result. Match facts (from the sim, checked by the Verifier) never carry it.

export const DEMO_DATA = "Demo data: simulated audience, not real results";

/** The Value step's one sentence that keeps the two kinds of number apart. */
export const FACTS_VS_FIGURES =
  "Match facts on this page come from the simulator and are checked by the Verifier; the audience, engagement and sponsor figures are simulated by a seeded model and are not results.";

/** The badge. `compact`: the small form under a single figure. */
export function DemoBadge({ compact = false }: { compact?: boolean }) {
  return <span className={compact ? "demo-badge compact" : "demo-badge"}>{DEMO_DATA}</span>;
}
