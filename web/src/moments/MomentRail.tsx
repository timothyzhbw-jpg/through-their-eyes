// The moments, always in reach (SPEC 7): the moment picker in the header's Settings, so the site
// never reads as a one-moment demo. The page on screen is marked current. The academy drill is
// not a moment: it is a Your turn mode (doors/).

import { useRankedLinks } from "../personal/hooks";
import { useView } from "../session";
import { currentMoment, hrefOf, MOMENT_LINKS } from "./moments";
import "./moments.css";

/** The moment links as a list, the one on screen marked. */
export function MomentChips({ label = "Moments" }: { label?: string }) {
  const view = useView();
  const current = currentMoment(view);
  const links = useRankedLinks(MOMENT_LINKS); // the followed player's and club's first
  return (
    <nav className="moment-chips" aria-label={label}>
      <ul>
        {links.map((m) => (
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
      </ul>
    </nav>
  );
}
