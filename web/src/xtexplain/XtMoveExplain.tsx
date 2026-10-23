// Where xT is explained, in the words of the chosen persona (zones.ts): the Tactics lab's
// Progression card, the evidence card's cf_value claim and the Without-the-look panel all draw this.
// Casual gets one plain sentence; analyst and coach get the zones by name with their values, and
// the from and to cells light up on the tactical board while that version is open.

import { useEffect, useMemo } from "react";
import type { Persona } from "../api/client";
import type { PayloadClaim } from "../narration/payload";
import { useView } from "../session";
import { lookWorthMove } from "./moves";
import { createStore, useStore } from "../store/store";
import { SourceChip } from "../provenance/SourceChip";
import { computed } from "../provenance/source";
import { xtCells } from "./XtCellsLayer";
import {
  COMPONENTS_LIMIT,
  boardCells,
  plainLine,
  valuesLine,
  versionFor,
  whereLine,
  type Move,
  type Owner,
} from "./zones";
import "./xtexplain.css";

const NO_PERSONA = createStore<{ persona: Persona }>({ persona: "casual" });

/** The persona on screen: the breakdown's on a hero moment, the recap's on a match. */
export function usePersona(): Persona {
  const view = useView();
  const hero = useStore(view.kind === "hero" ? view.breakdown : NO_PERSONA, (s) => s.persona);
  const match = useStore(view.kind === "match" ? view.recap.state : NO_PERSONA, (s) => s.persona);
  return view.kind === "hero" ? hero : match;
}

export function XtMoveExplain({
  moves,
  owner,
  persona: given,
  valuesFrom = "grid",
}: {
  moves: readonly Move[];
  owner: Owner;
  persona?: Persona; // tests
  /** What the values come from, for the chip: the grid, or a verified claim's difference. */
  valuesFrom?: "grid" | "claim";
}) {
  const shown = usePersona();
  const persona = given ?? shown;
  const version = versionFor(persona);
  const cells = useMemo(() => boardCells(moves), [moves]);
  useEffect(() => {
    if (version !== "concrete") return;
    xtCells.set({ cells });
    return () => xtCells.set({ cells: [] });
  }, [version, cells]);
  if (!moves.length) return null;
  if (version === "plain") {
    return (
      <p className="xt-explain plain" data-xt-version="plain">
        {plainLine(moves[0])}
      </p>
    );
  }
  return (
    <div className="xt-explain concrete" data-xt-version="concrete">
      <ul>
        {moves.map((m, i) => {
          const values = valuesLine(m);
          return (
            <li key={i}>
              {m.label && <strong>{m.label}: </strong>}
              {whereLine(m, owner)}
              {values && (
                <>
                  {" "}
                  {values}{" "}
                  <SourceChip
                    kind={valuesFrom === "claim" ? "verified" : "tracking"}
                    title={
                      valuesFrom === "claim"
                        ? undefined
                        : computed("Read from the xT grid at the two ends, in the browser")
                    }
                    spoken
                  />
                </>
              )}
            </li>
          );
        })}
      </ul>
      <p className="note">
        {COMPONENTS_LIMIT} On the tactical board the start is outlined in blue and the end in gold.
      </p>
    </div>
  );
}

/**
 * The evidence card's cf_value claim, zone by zone: where the ball ended without the look and with
 * it, and the claim's own difference. Only for a dropped look, whose `dxt` is signed (a forced
 * option's is an absolute value with "more" or "less" in the line); nothing when either run's pass
 * was not received. The values are the claim's: the grid is not read here.
 */
export function XtClaimNote({ claim }: { claim: PayloadClaim }) {
  const { hero } = useView();
  const dxt = claim.values.dxt;
  const moves = useMemo(
    () => (typeof dxt === "number" ? lookWorthMove(hero, dxt) : []),
    [hero, dxt],
  );
  if (claim.id !== "cf_value" || claim.verdict !== "supported") return null;
  if (hero.counterfactual?.intervention !== "drop_scan") return null;
  return <XtMoveExplain moves={moves} owner="his" valuesFrom="claim" />;
}
