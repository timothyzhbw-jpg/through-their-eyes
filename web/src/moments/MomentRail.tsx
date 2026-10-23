// The moments, always in reach (SPEC 7): a row of links above the live screen and on the intro
// card, so the site never reads as a one-moment demo. The page on screen is marked current.

import { useDeepLink } from "../deeplink";
import { useView } from "../session";
import { currentMoment, DRILL_LINK, hrefOf, MOMENT_LINKS } from "./moments";
import "./moments.css";

/** The moment links as a list of chips, the one on screen marked, then the academy drill. */
export function MomentChips({ label = "Moments" }: { label?: string }) {
  const view = useView();
  const current = currentMoment(view);
  return (
    <nav className="moment-chips" aria-label={label}>
      <ul>
        {MOMENT_LINKS.map((m) => (
          <li key={m.id}>
            <a
              className={m.id === "match" ? "moment-chip match" : "moment-chip"}
              href={hrefOf(m)}
              title={m.title}
              aria-current={m.id === current ? "page" : undefined}
              data-moment={m.id}
            >
              {m.id === "match" && <i aria-hidden="true" />}
              {m.label}
            </a>
          </li>
        ))}
        <li className="drill-item">
          <a className="moment-chip drill-link" href={hrefOf(DRILL_LINK)} title={DRILL_LINK.title}>
            {DRILL_LINK.label}
          </a>
        </li>
      </ul>
    </nav>
  );
}

/** The rail above the live screen. While the intro card is up it keeps its place, hidden (the card
 * carries the same links), so the picture does not jump when the card closes. `rail=0` in the
 * address leaves it out (the demo video's captures keep their framing). */
export function MomentRail({ hidden }: { hidden: boolean }) {
  if (!useDeepLink().rail) return null;
  return (
    <div
      className={hidden ? "moment-rail hidden" : "moment-rail"}
      aria-hidden={hidden || undefined}
    >
      <MomentChips />
    </div>
  );
}
