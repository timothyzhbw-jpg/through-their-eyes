// Where a number on screen comes from (SPEC 5, 7): every number carries one small chip saying so,
// in one style. A verified claim was checked by the Verifier against the match data; everything
// else is a metric, not a claim: read from the sim export (sim), measured from tracking and the
// event feed by analytics/ (tracking), estimated by the scan detector from tracked head yaw
// (detector), taken from the moment's scan lens (lens), or a sample answer shipped with the app
// for when the service is not there (sample). Each call site passes the kind its data already
// carries; the words are here, once.

export type SourceKind = "verified" | "sim" | "tracking" | "detector" | "lens" | "sample";

export const SOURCES: Readonly<Record<SourceKind, { label: string; title: string }>> = {
  verified: {
    label: "✓",
    title: "A verified claim: the Verifier checked it against the match data",
  },
  sim: { label: "sim", title: "Read from the sim export, not a verified claim" },
  tracking: {
    label: "tracking",
    title: "Measured from tracking and the event feed: a metric, not a verified claim",
  },
  detector: {
    label: "detector",
    title: "Estimated by the scan detector from tracked head yaw: a metric, not a verified claim",
  },
  lens: { label: "lens", title: "From the moment's scan lens, not a verified claim" },
  sample: {
    label: "sample",
    title: "A sample answer shipped with the app, not checked by the Verifier",
  },
};
