// The provenance chip: where the breakdown or recap on screen came from, as the API said it
// (provenance.ts). Drawn in both the hero and the match views; it takes the API's answer as a prop.

import { provenanceText, type Provenance } from "./provenance";
import "./provenance.css";

const TITLE: Record<Provenance["kind"], string> = {
  live: "The agent crew ran on the model for this request; the verifier checked every line",
  cached: "Served from the cache: the agent crew wrote it on the model at that time",
  template:
    "The crew's deterministic templates wrote it, with no model call; the verifier checked it",
};

/** A small chip: where the answer on screen came from. Nothing when the service did not say. */
export function ProvenanceChip({ provenance }: { provenance: Provenance | null | undefined }) {
  if (!provenance) return null;
  return (
    <span
      className={`provenance-chip ${provenance.kind}`}
      data-provenance={provenance.kind}
      title={TITLE[provenance.kind]}
    >
      <i aria-hidden="true" />
      {provenanceText(provenance)}
    </span>
  );
}
