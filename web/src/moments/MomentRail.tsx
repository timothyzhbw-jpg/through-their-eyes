// The moments, always in reach (SPEC 7): one "Moments" menu in the header and a row of chips on
// the intro card, so the site never reads as a one-moment demo. The page on screen is marked
// current.

import { useId, useRef, useState } from "react";
import { useDeepLink } from "../deeplink";
import { ChevronIcon } from "../ui/icons";
import { usePopover } from "../ui/Stage";
import { useRankedLinks } from "../personal/hooks";
import { useView } from "../session";
import { currentMoment, DRILL_LINK, hrefOf, MOMENT_LINKS } from "./moments";
import "./moments.css";

/** The moment links as a list of chips, the one on screen marked, then the academy drill. */
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
        <li className="drill-item">
          <a className="moment-chip drill-link" href={hrefOf(DRILL_LINK)} title={DRILL_LINK.title}>
            {DRILL_LINK.label}
          </a>
        </li>
      </ul>
    </nav>
  );
}

/** "Moments ▾" in the header: the same links in one menu (the intro card carries them as chips).
 * `rail=0` in the address leaves it out (the demo video's captures keep their framing). */
export function MomentsMenu() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = useRef(() => setOpen(false)).current;
  const onKeyDown = usePopover(open, close, wrap, toggle);
  if (!useDeepLink().rail) return null;
  return (
    <div className="popover-wrap moments-menu" ref={wrap} onKeyDown={onKeyDown}>
      <button
        ref={toggle}
        type="button"
        className="btn btn-quiet"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        Moments
        <ChevronIcon />
      </button>
      <div id={id} className="popover moments-panel" hidden={!open}>
        <MomentChips />
      </div>
    </div>
  );
}
