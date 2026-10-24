import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "./reveal";

/** Two composited floodlights, confined to the story below the live picture. */
export function FloodlightBackground() {
  const reduced = usePrefersReducedMotion();
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return (
    <div className="floodlight-background" aria-hidden="true" data-paused={hidden || reduced}>
      <span />
      <span />
    </div>
  );
}
