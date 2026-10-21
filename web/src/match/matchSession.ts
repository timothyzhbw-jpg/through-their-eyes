// A stitched match on screen (SPEC 2, 3.1): the whole match clock played live from the stream,
// with the transport, POV and overlay controls of a hero moment, and no breakdown of its own.
// Each hero moment opens a breakdown: the possession's own hero export (`<scenario>-<seed>` on
// the service) becomes a hero Session in local frames, asking for its breakdown and what-ifs by
// the moment's id in match time; its clock shows local frame + the possession's start. Back to
// the match puts the match playhead where the breakdown left off. Your call opens the same hero
// when every option has a re-simulated run; otherwise the match stays up and nothing plays.
// At full time on the live stream the end-of-match recap is asked for (recap/recap.ts).

import { MATCH_ID, type Api, type Fetch } from "../api/client";
import type { Hero } from "../data/hero";
import { bundledWhatIfs, loadScenarioHero } from "../data/load";
import { LiveFeed, type SocketFactory } from "../live/feed";
import { createSession, transportControls, type Session, type ViewControls } from "../session";
import { createPlayback, type PlaybackStore } from "../store/playback";
import { createStore, type Store } from "../store/store";
import { createRecap, type Recap } from "../recap/recap";
import type { MakeAudio } from "../voice/voice";
import { takeEyesOf } from "../takeeyes/controller";
import { yourCallOf } from "../yourcall/controller";
import { scenarioMatchId, type MatchInfo, type MatchMoment } from "./match";

export interface MatchSessionOptions {
  api: Api | null; // a match is only served live; null shows the replay with no breakdowns
  offline?: string | null;
  dataUrl: string; // public/data: the bundled hero, when the service does not serve it
  fetch?: Fetch;
  socket?: SocketFactory; // WebSocket stand-in for tests
  makeAudio?: MakeAudio;
  // The bundled breakdown of the default hero (blind_side_run-3): the fallback narration and plan
  // and the suggested what-ifs, for that possession only. Other heroes' what-ifs are fetched
  // from the bundled files (data/load.ts WHAT_IF_FILES) when their breakdown opens.
  payload?: unknown;
  plan?: unknown;
  whatIfs?: unknown;
}

/** Which screen is up: the match, or one hero moment's breakdown. */
export interface MatchScreen {
  hero: Session | null; // the breakdown on screen; null: the match
  opening: string | null; // the hero moment (match id) whose breakdown is loading
  error: string | null; // why the last breakdown could not be opened
}

export interface MatchControls extends ViewControls {
  startLive(): void;
  /** Open a hero moment's breakdown (the moment's card, in match time); with "yourcall", open it
   * in Your call instead of playing the breakdown, with "eyes" in Take his eyes. If that cannot
   * open, the match stays up. */
  openBreakdown(
    card: Pick<MatchMoment, "id" | "hero" | "possession" | "local_id">,
    play?: "breakdown" | "yourcall" | "eyes",
  ): void;
  backToMatch(): void;
}

export interface MatchSession {
  kind: "match";
  hero: Hero; // the stitched run (kind "match")
  match: MatchInfo;
  playback: PlaybackStore;
  feed: LiveFeed | null;
  api: Api | null;
  offline: string | null;
  screen: Store<MatchScreen>;
  recap: Recap; // the end-of-match recap: its card and its reel
  controls: MatchControls;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function createMatchSession(hero: Hero, options: MatchSessionOptions): MatchSession {
  const match = hero.match;
  if (!match) throw new Error("createMatchSession needs a stitched match export");
  const api = options.api;
  const playback = createPlayback(hero);
  const feed = api ? new LiveFeed(hero, (start) => api.liveUrl(start), options.socket) : null;
  const screen = createStore<MatchScreen>({ hero: null, opening: null, error: null });
  const heroes = new Map<number, Session>(); // by possession index, loaded once
  const { controls: transport, endLive } = transportControls({
    hero,
    playback,
    feed,
    takeOver: () => {
      screen.set({ error: null });
      recap.stopReel(); // the viewer took the controls
    },
    beforeLive: () => {},
  });
  const recap = createRecap({
    api,
    hero,
    playback,
    takeOver: () => {
      endLive();
      screen.set({ error: null });
    },
    makeAudio: options.makeAudio,
  });

  // The stream ended (or broke): the viewer is left in the replay at the last frame received.
  // It ended on the match's last frame: full time, the recap is asked for.
  feed?.state.subscribe(() => {
    const { status, latest } = feed.state.get();
    if (!playback.get().live || (status !== "ended" && status !== "lost")) return;
    playback.set({ live: false, playing: false, frame: Math.max(0, latest) });
    if (status === "ended" && latest >= hero.runs.factual.frames - 1) recap.fullTime();
  });

  const show = (session: Session, cardId: string, play: "breakdown" | "yourcall" | "eyes") => {
    const yc = yourCallOf(session);
    if (play === "eyes") {
      const te = takeEyesOf(session);
      if (te.unavailable) {
        screen.set({ hero: null, opening: null, error: `${cardId}: ${te.unavailable}` });
        return;
      }
      screen.set({ hero: session, opening: null, error: null });
      yc.close();
      te.open();
      return;
    }
    if (play === "yourcall") {
      if (yc.unavailable) {
        // Not the hero screen, and not the breakdown: that replay would show what he picked.
        screen.set({ hero: null, opening: null, error: `${cardId}: ${yc.unavailable}` });
        return;
      }
      screen.set({ hero: session, opening: null, error: null });
      yc.open();
      return;
    }
    screen.set({ hero: session, opening: null, error: null });
    yc.close();
    session.controls.playBreakdown();
  };

  async function openBreakdown(
    card: Parameters<MatchControls["openBreakdown"]>[0],
    play: "breakdown" | "yourcall" | "eyes" = "breakdown",
  ) {
    const p = match!.possessions.find((x) => x.index === card.possession);
    if (!card.hero || !p) return;
    endLive();
    playback.set({ playing: false });
    const loaded = heroes.get(p.index);
    if (loaded) return show(loaded, card.id, play);
    if (!api) {
      screen.set({ error: "Breakdowns need the live service." });
      return;
    }
    screen.set({ opening: card.id, error: null });
    try {
      const possessionHero = await loadScenarioHero(api, p, options.dataUrl, options.fetch);
      const run = possessionHero.runs.factual;
      if (run.frames !== p.frames || possessionHero.ids.join() !== hero.ids.join()) {
        throw new Error(`${scenarioMatchId(p)} is not possession ${p.index + 1} of this match`);
      }
      // The bundled fixture and plan are for the default hero only.
      const bundled = scenarioMatchId(p) === MATCH_ID;
      const whatIfs = bundled
        ? (options.whatIfs ?? null)
        : await bundledWhatIfs(
            options.fetch ?? ((url, init) => fetch(url, init)),
            options.dataUrl,
            scenarioMatchId(p),
          );
      const session = createSession(
        possessionHero,
        bundled ? (options.plan ?? null) : null,
        bundled ? (options.payload ?? null) : null,
        whatIfs,
        {
          api,
          makeAudio: options.makeAudio,
          momentId: card.local_id,
          possession: { index: p.index, start: p.start, moment: card.id },
        },
      );
      heroes.set(p.index, session);
      if (screen.get().opening === card.id) show(session, card.id, play);
    } catch (err) {
      if (screen.get().opening === card.id) {
        screen.set({ opening: null, error: `${card.id}: ${message(err)}` });
      }
    }
  }

  const controls: MatchControls = {
    ...transport,
    startLive: transport.goLive,
    openBreakdown: (card, play) => void openBreakdown(card, play),
    backToMatch() {
      const session = screen.get().hero;
      screen.set({ hero: null, opening: null, error: null });
      if (!session?.possession) return;
      yourCallOf(session).close();
      session.controls.stopBreakdown();
      session.voice.stop();
      const p = match.possessions.find((x) => x.index === session.possession!.index)!;
      const local = Math.max(0, Math.min(p.frames - 1, session.playback.get().frame));
      playback.set({
        live: false,
        playing: false,
        playUntil: null,
        mode: "factual",
        frame: p.start + local,
      });
    },
  };

  return {
    kind: "match",
    hero,
    match,
    playback,
    feed,
    api,
    offline: api ? null : (options.offline ?? "no live service"),
    screen,
    recap,
    controls,
  };
}
