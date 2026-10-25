// The three doors on screen (SPEC 7, doors.ts): the header's tabs, door 2's hub and door 3's page.
// Door 1 is the hero page itself (App.tsx). The tabs switch the page in place on a hero moment; on
// a stitched match, whose page is not a door, they are links to the hero moment's doors.

import { useDeepLink } from "../deeplink";
import { drillOf } from "../drill/controller";
import { DRILL_SUB } from "../drill/Drill";
import { Journey } from "../journey/Journey";
import { useSession, useView } from "../session";
import { useStore } from "../store/store";
import { takeEyesOf } from "../takeeyes/controller";
import { TAKE_EYES_SUB } from "../takeeyes/TakeEyes";
import { ArrowIcon } from "../ui/icons";
import { yourCallOf } from "../yourcall/controller";
import { DOOR_LABEL, DOOR_NOTE, DOORS, type Door } from "./doors";
import { doors, openDoor } from "./state";
import "./doors.css";

/** The header's three doors, the one on screen marked. `rail=0` in the address leaves them out
 * (the demo video's captures keep their framing). */
export function DoorTabs() {
  const view = useView();
  const current = useStore(doors, (s) => s.door);
  if (!useDeepLink().rail) return null;
  const match = view.kind === "match";
  return (
    <nav className="door-tabs" aria-label="Doors">
      <ul>
        {DOORS.map((d) => (
          <li key={d}>
            {match ? (
              // A stitched match is no door: each opens the hero moment's page on it.
              <a className="door-tab" href={hrefOfDoor(d)} title={DOOR_NOTE[d]} data-door={d}>
                {DOOR_LABEL[d]}
              </a>
            ) : (
              <button
                type="button"
                className="door-tab"
                aria-current={d === current ? "page" : undefined}
                title={DOOR_NOTE[d]}
                data-door={d}
                onClick={() => openDoor(d, { address: true })}
              >
                {DOOR_LABEL[d]}
              </button>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

const hrefOfDoor = (door: Door) => `${import.meta.env.BASE_URL}?door=${door}`;

/** The ids of the hub's cards: what closing a mode they opened gives the focus back to. */
export const TURN_CARD_ID = {
  yourCall: "turn-call",
  takeEyes: "turn-eyes",
  drill: "turn-drill",
} as const;

/** Door 2: one hub, three cards, each opening a mode as it is (the mode takes the screen; closing
 * it comes back here). */
export function YourTurn() {
  const session = useSession();
  const yc = yourCallOf(session);
  const te = takeEyesOf(session);
  const drill = drillOf(session);
  const cards: { id: string; title: string; line: string; why: string | null; open: () => void }[] =
    [
      {
        id: TURN_CARD_ID.yourCall,
        title: "Make his call",
        line: "Decide with only what he knew, then see what really happened.",
        why: yc.unavailable,
        open: () => yc.open(),
      },
      {
        id: TURN_CARD_ID.takeEyes,
        title: "See through his eyes",
        line: `${TAKE_EYES_SUB}; the sim re-runs the moment.`,
        why: te.unavailable,
        open: () => te.open(),
      },
      {
        id: TURN_CARD_ID.drill,
        title: "Train your scanning",
        line: `${DRILL_SUB}, then make the pass.`,
        why: drill.unavailable,
        open: () => drill.open(),
      },
    ];
  return (
    <section className="door-page door-turn" aria-labelledby="turn-title">
      <header className="door-head">
        <h2 id="turn-title" tabIndex={-1}>
          Your <em>turn.</em>
        </h2>
        <p className="lede">You are the player; see what he could see.</p>
      </header>
      <ul className="turn-cards">
        {cards.map((c) => (
          <li key={c.id}>
            <button
              id={c.id}
              type="button"
              className="turn-card"
              disabled={!!c.why}
              aria-describedby={`${c.id}-line`}
              onClick={() => {
                window.scrollTo({ top: 0 });
                c.open();
              }}
            >
              <span className="turn-card-title">
                {c.title}
                <ArrowIcon />
              </span>
              <span className="turn-card-line" id={`${c.id}-line`}>
                {c.why ?? c.line}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Door 3: what it does for the league, four solutions and their value (journey/). */
export function ForStudios() {
  return (
    <section className="door-page door-studios" aria-labelledby="studios-title">
      <header className="door-head">
        <h2 id="studios-title" tabIndex={-1}>
          For <em>studios.</em>
        </h2>
        <p className="lede">
          What one moment does for the league: four solutions, broadcast and social first, then what
          they are worth.
        </p>
      </header>
      <Journey />
    </section>
  );
}
