// Personalized viewing (SPEC 7): a "Your view" menu in the header (the mode switch, "More"
// audiences, who to follow, the language) and the one-line summary under the moment's title.
// Only cached breakdowns are asked for: the audience and language go through the same switches
// as the viewer menu's (the breakdown's, or the recap's inside a match).

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { type Persona } from "../api/client";
import { clubName, CLUBS, shortName } from "../data/roster";
import { useView } from "../session";
import { Segmented } from "../ui/Segmented";
import { usePopover } from "../ui/Stage";
import { ChevronIcon } from "../ui/icons";
import { PERSONA_LABEL } from "../ui/labels";
import { LANGUAGES, type Language } from "../whatif/whatif";
import {
  isMode,
  MODES,
  MORE_PERSONAS,
  parsePersona,
  parsePlayer,
  playerOptions,
  type Team,
} from "./follow";
import { useChoices, useMomentsInReach } from "./hooks";
import { involvedCount } from "./rank";
import { audienceOf, personal } from "./state";
import { LANGUAGE_NAME, personaLabel, yourView } from "./summary";
import "./personal.css";

/** The audience and language the page is on. */
function useAudience() {
  const view = useView();
  const audience = useMemo(() => audienceOf(view), [view]);
  const key = useSyncExternalStore(audience.subscribe, () => {
    const a = audience.get();
    return `${a.persona}|${a.language}`;
  });
  const [persona, language] = key.split("|") as [Persona, Language];
  return { audience, persona, language };
}

/** Keep the page's audience and the choices in step. Called once by the page (App, MatchView), not
 * by the menu: the menu is gone while Your call or the tour's other screens are up, and the store
 * must not miss a change meanwhile. What the viewer picks (here, in the viewer menu, in the recap)
 * becomes the choice. With `adopt`, a page that opens inside a match starts on the choices already
 * made: a hero moment opened from the match, the match when it is back. A page opened by address
 * has them from main.tsx. */
export function usePersonalSync(adopt = false) {
  const view = useView();
  const audience = useMemo(() => audienceOf(view), [view]);
  useEffect(() => {
    if (!adopt || !audience.online) return;
    const have = audience.get();
    const want = personal.get();
    const patch: { persona?: Persona; language?: Language } = {};
    if (want.persona && want.persona !== have.persona) patch.persona = want.persona;
    if (want.language && want.language !== have.language) patch.language = want.language;
    if (patch.persona || patch.language) audience.set(patch);
  }, [audience, adopt]);
  useEffect(() => {
    let prev = audience.get();
    return audience.subscribe(() => {
      const a = audience.get();
      if (a.persona === prev.persona && a.language === prev.language) return;
      prev = { persona: a.persona, language: a.language };
      personal.set({ persona: a.persona, language: a.language });
    });
  }, [audience]);
}

/** The line "Your view: Casual fan · English · following …". */
export function YourViewLine() {
  const { persona, language } = useAudience();
  const follow = useChoices();
  const reach = useMomentsInReach();
  const text = yourView({
    persona,
    language,
    follow,
    involved: involvedCount(follow, reach),
    total: reach.length,
  });
  return (
    <p className="your-view-line" data-testid="your-view-line">
      {text}
    </p>
  );
}

/** The header's "Your view" menu. It stays open while the viewer picks, until Escape or a press
 * outside. */
export function YourViewMenu() {
  const view = useView();
  const { audience, persona, language } = useAudience();
  const follow = useChoices();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(() => setOpen(false)).current;
  const onKeyDown = usePopover(open, close, wrap, toggle);
  const id = useId();
  const players = useMemo(() => playerOptions(view.hero.players), [view.hero]);
  const off = !audience.online;
  useEffect(() => {
    if (open) panel.current?.querySelector("button")?.focus();
  }, [open]);
  return (
    <div className="popover-wrap your-view" ref={wrap} onKeyDown={onKeyDown}>
      <button
        ref={toggle}
        type="button"
        className="btn your-view-toggle"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      >
        <span>Your view</span>
        <ChevronIcon />
      </button>
      {open && (
        <div
          id={id}
          ref={panel}
          className="popover your-view-panel"
          role="dialog"
          aria-label="Your view"
        >
          <p className="kicker">Mode</p>
          <Segmented<Persona>
            label="Mode"
            value={isMode(persona) ? persona : null}
            onPick={(p) => audience.set({ persona: p })}
            options={MODES.map((m) => ({
              value: m.persona,
              label: m.label,
              title: m.note,
              disabled: off && m.persona !== persona,
            }))}
          />
          <label className="your-view-row">
            <span className="kicker">More</span>
            <select
              value={isMode(persona) ? "" : persona}
              disabled={off}
              onChange={(e) => {
                const p = parsePersona(e.target.value);
                if (p) audience.set({ persona: p });
              }}
            >
              <option value="" disabled>
                Other audiences…
              </option>
              {MORE_PERSONAS.map((p) => (
                <option key={p} value={p}>
                  {PERSONA_LABEL[p]}
                </option>
              ))}
            </select>
          </label>

          <p className="kicker follow-head">Follow</p>
          <label className="your-view-row">
            <span className="kicker">Team</span>
            <select
              value={follow.team === null ? "" : String(follow.team)}
              onChange={(e) =>
                personal.set({
                  team: e.target.value === "" ? null : (Number(e.target.value) as Team),
                })
              }
            >
              <option value="">No team</option>
              {([0, 1] as const).map((t) => (
                <option key={t} value={t}>
                  {CLUBS[t].name}
                </option>
              ))}
            </select>
          </label>
          <label className="your-view-row">
            <span className="kicker">Player</span>
            <select
              value={follow.player ?? ""}
              onChange={(e) => personal.set({ player: parsePlayer(e.target.value) })}
            >
              <option value="">No player</option>
              {([0, 1] as const).map((t) => (
                <optgroup key={t} label={clubName(t)}>
                  {players
                    .filter((p) => p.team === t)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {`${p.number} · ${shortName(p.id)} · ${p.role}`}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="your-view-row">
            <span className="kicker">Language</span>
            <Segmented
              label="Language"
              value={language}
              onPick={(l) => audience.set({ language: l })}
              options={LANGUAGES.map((l) => ({
                value: l,
                label: LANGUAGE_NAME[l],
                lang: l,
                disabled: off && l !== language,
              }))}
            />
          </div>
          {off && <p className="note">Other audiences and languages need the live service.</p>}
          <p className="note">
            Saved in the address and in this browser. {personaLabel(persona)} in{" "}
            {LANGUAGE_NAME[language]} uses the breakdown the service has already written.
          </p>
        </div>
      )}
    </div>
  );
}
