// Stadium Screen Studio (`?studio=1`): what the bowl's screens would show through a matchday, as
// a stadium's screen crew plans it. A timeline of events (walk-out, key look, press win, corner,
// goal, half-time); the rules (rules.ts) decide each screen's content; the screens are previewed
// in the 3D stadium and, flat, on the Screen wall (`?studio=1&wall=1` opens the wall alone, for
// slow GPUs). Offline: every file it reads is in public/data, and nothing calls the service.

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { parseHero } from "../data/hero";
import { useStore } from "../store/store";
import { studioFacts } from "./content";
import { SCREENS, type ScreenFormat } from "./formats";
import { PRESET_IDS, PRESETS, type PresetId } from "./presets";
import { DEMO_DATA, DemoBadge } from "../journey/DemoBadge";
import { describeContent, KIND_LABEL, programme, sponsorSlots, type StudioEvent } from "./rules";
import { createShow, createSurfaces, type Show } from "./show";
import "./studio.css";

const StadiumPreview = lazy(() =>
  import("./StadiumPreview").then((m) => ({ default: m.StadiumPreview })),
);

/** Shown with anything on this page that is not a match fact (the one legend, journey/). */
export { DEMO_DATA };

/** Seconds between events while the programme plays. */
const STEP_MS = 6000;

export const STUDIO_FILES = {
  hero: "hero_seed3.json",
  steps: "steps_seed3.json",
  without: "without_look_seed3.json",
  goalWithout: "without_look_far_post_finish_seed11.json",
} as const;

/** The studio's show, from the bundled files under `dataUrl`. */
export async function loadStudio(
  dataUrl: string,
  fetchImpl: typeof fetch = (url) => fetch(url),
): Promise<Show> {
  const get = async (file: string) => {
    const res = await fetchImpl(dataUrl + file);
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    return res.json() as Promise<unknown>;
  };
  const [hero, steps, without, goalWithout] = await Promise.all([
    get(STUDIO_FILES.hero),
    get(STUDIO_FILES.steps).catch(() => null),
    get(STUDIO_FILES.without).catch(() => null),
    get(STUDIO_FILES.goalWithout).catch(() => null),
  ]);
  const facts = studioFacts({ hero: parseHero(hero), steps, without, goalWithout });
  return createShow(programme(facts), createSurfaces());
}

export function StudioApp({ show, wallOnly = false }: { show: Show; wallOnly?: boolean }) {
  const { events } = show;
  const selected = useStore(show.state, (s) => s.selected);
  const shown = useStore(show.state, (s) => s.shown);
  const [preset, setPreset] = useState<PresetId>("bowl");
  const [three, setThree] = useState(!wallOnly);
  const [playing, setPlaying] = useState(false);
  const event = events[selected];

  useEffect(() => {
    show.select(show.state.get().selected);
    return () => show.dispose();
  }, [show]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      const next = show.state.get().selected + 1;
      if (next >= events.length) setPlaying(false);
      else show.select(next);
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [playing, show, events.length]);

  return (
    <div className="stadium-studio">
      <header className="studio-head">
        <div>
          <p className="kicker accent">Stadium Screen Studio</p>
          <h1>Every screen in the bowl, on one timeline</h1>
          <p className="lede">
            What the main board, the tunnel LED, the ribbon and the concourse screens show through a
            matchday, decided by the event on the pitch. A synthetic match: every player, club and
            sponsor is fictional, and every number on a screen comes from a verified claim or the
            match export.
          </p>
        </div>
        <a className="btn" href={import.meta.env.BASE_URL}>
          Back to the match
        </a>
      </header>

      <section className="studio-timeline" aria-label="Event timeline">
        <div className="studio-controls">
          <button
            type="button"
            className="btn btn-primary"
            aria-pressed={playing}
            onClick={() => {
              if (!playing && selected >= events.length - 1) show.select(0);
              setPlaying(!playing);
            }}
          >
            {playing ? "Pause the programme" : "Play the programme"}
          </button>
          <label className="studio-scrub">
            <span className="sr-only">Timeline</span>
            <input
              type="range"
              min={0}
              max={events.length - 1}
              step={1}
              value={selected}
              aria-valuetext={event.label}
              onChange={(e) => {
                setPlaying(false);
                show.select(Number(e.target.value));
              }}
            />
          </label>
        </div>
        <ol className="studio-events">
          {events.map((e, i) => (
            <li key={e.id}>
              <button
                type="button"
                className={i === shown ? "studio-event on-screen" : "studio-event"}
                aria-current={i === selected ? "step" : undefined}
                onClick={() => {
                  setPlaying(false);
                  show.select(i);
                }}
              >
                <span className="name">{e.label}</span>
                {e.rehearsal && <span className="tag">Rehearsal cue</span>}
              </button>
            </li>
          ))}
        </ol>
        <p className="note studio-event-note" aria-live="polite">
          <strong>{event.label}.</strong> {event.note}.
          {selected !== shown && shown !== null && " The screens change in a moment."}
        </p>
      </section>

      <section className="studio-preview" aria-label="Virtual stadium preview">
        <div className="studio-preview-bar">
          <div className="pick-row" role="group" aria-label="Camera">
            {PRESET_IDS.map((id) => (
              <button
                key={id}
                type="button"
                className="btn"
                aria-pressed={three && preset === id}
                disabled={!three}
                onClick={() => setPreset(id)}
              >
                {PRESETS[id].label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn"
            aria-pressed={!three}
            onClick={() => setThree(!three)}
          >
            {three ? "Screen wall only (no 3D)" : "Show the 3D stadium"}
          </button>
        </div>
        {three && (
          <div className="studio-canvas">
            <Suspense fallback={<p className="loading">Loading the stadium…</p>}>
              <StadiumPreview show={show} preset={preset} />
            </Suspense>
            <p className="studio-hint">
              Drag to orbit, scroll to zoom. Changes are slow fades or cuts.
            </p>
          </div>
        )}
      </section>

      <ScreenWall show={show} />

      <SponsorSlots events={events} />
    </div>
  );
}

/** How many screen slots each fictional sponsor gets over the programme: not a match fact, so
 * it carries the demo-data badge. `Heading`: h2 on the studio page, h3 inside a chapter. */
export function SponsorSlots({
  events,
  Heading = "h2",
}: {
  events: StudioEvent[];
  Heading?: "h2" | "h3";
}) {
  return (
    <section className="studio-sponsors" aria-labelledby="sponsor-slots">
      <Heading id="sponsor-slots" className="block-title">
        Sponsor slots in this programme
      </Heading>
      <DemoBadge />
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Fictional sponsor</th>
              <th scope="col">Screen slots</th>
            </tr>
          </thead>
          <tbody>
            {sponsorSlots(events).map(({ sponsor, slots }) => (
              <tr key={sponsor.id}>
                <td>{sponsor.name}</td>
                <td>{slots}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        Counted from the rules over the programme&apos;s events, one slot per screen per event. No
        audience, reach or sales figure is shown: the studio has none.
      </p>
    </section>
  );
}

/** Every screen flat, at its own aspect: the same canvases the 3D preview shows. */
export function ScreenWall({ show, Heading = "h2" }: { show: Show; Heading?: "h2" | "h3" | "h4" }) {
  return (
    <section className="screen-wall" aria-labelledby="screen-wall">
      <Heading id="screen-wall" className="block-title">
        Screen wall
      </Heading>
      <div className="screen-grid">
        {SCREENS.map((format) => (
          <WallScreen key={format.id} show={show} format={format} />
        ))}
      </div>
    </section>
  );
}

function WallScreen({ show, format }: { show: Show; format: ScreenFormat }) {
  const slot = useRef<HTMLDivElement>(null);
  // Re-render the caption when the screens change and when this one is redrawn.
  useStore(show.state, (s) => s.shown);
  useStore(show.state, (s) => s.versions[format.id]);
  const content = show.assignment()?.[format.id];
  const canvas = show.surfaces[format.id].canvas;
  useEffect(() => {
    const el = slot.current;
    if (!el) return;
    el.appendChild(canvas);
    return () => canvas.remove();
  }, [canvas]);
  // During a fade, follow its brightness frame by frame; at rest, nothing runs.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      canvas.style.opacity = String(show.level(format.id));
      raf = show.fading() ? requestAnimationFrame(tick) : 0;
    };
    const off = show.state.subscribe(() => {
      if (!raf) raf = requestAnimationFrame(tick);
    });
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
  }, [show, canvas, format.id]);
  return (
    <figure className={`wall-screen shape-${format.shape}`} data-screen={format.id}>
      <div
        ref={slot}
        className="wall-canvas"
        role="img"
        aria-label={content ? describeContent(content) : format.label}
        style={{ aspectRatio: `${format.aspect[0]} / ${format.aspect[1]}` }}
      />
      <figcaption>
        <span className="name" title={`${format.aspect[0]}:${format.aspect[1]} · ${format.where}`}>
          {format.label}
        </span>
        {content && <span className="what">{KIND_LABEL[content.kind]}</span>}
      </figcaption>
    </figure>
  );
}
