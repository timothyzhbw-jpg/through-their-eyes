# Accessibility

What was checked in the web app, what passes, and the known gaps. Audit of 2026-10-21. The
`audio_description` persona (SPEC 1) serves blind and low-vision fans; this audit covers the rest
of the app. Every claim below was checked as described here. Nothing was tested with a real
screen reader.

## How it was checked

- **Automated: axe-core 4.14.0.** WCAG 2.0, 2.1 and 2.2 rules at levels A and AA, plus axe's
  best-practice rules. axe-core is MPL-2.0, which is allowed unmodified (CLAUDE.md). It is a dev
  dependency only: `web/scripts/axe.mjs` injects its `axe.min.js` into the page as shipped.
  - `npm run a11y -- --url <site>` (`web/scripts/a11y.mjs`) audits 13 screens at 1440×900 and at
    375×812 (Playwright's iPhone 13 Mini profile, drawn by Chromium):
    - the lineup card, of the hero and of `match-1`;
    - the hero paused, playing its breakdown with captions, with the viewer menu open, with View
      options open;
    - the evidence card with "Try a wrong number" open (`?persona=analyst&tamper=cf_value`);
    - Your call while deciding, and in the reveal;
    - `match-1` paused, `match-1` live, and a hero breakdown inside it;
    - the pressure hero.

    Each full-page scan includes the panels below the fold, among them the Producer's failure
    drill and the verdict chapter.
  - `npm run smoke` runs the same WCAG rules on each of its 14 pages. A serious or critical
    violation fails the page, and CI runs it.
  - Both ran on the live site and on a local production build against the offline API.
- **Keyboard only.**
  - A scripted Tab walk through the whole hero page records every stop: what it is, its focus
    ring, and whether it is on screen or covered.
  - Escape was pressed in every overlay: the lineup card, the viewer menu, View options, Your
    call, the evidence card and the director chip.
- **Names and roles.** Playwright's accessibility snapshot (role and accessible name) of the hero,
  `match-1`, Your call and the lineup card.
- **Contrast over the picture.** axe cannot judge text drawn over the WebGL views; it reports
  those as "needs review". A pixel test does instead (`npm run contrast`,
  `web/scripts/contrast.mjs`):
  - The page is rendered twice, once with the text drawn normally and once in magenta. The pixels
    that differ are the glyphs.
  - The background is every pixel within 2 px of a glyph in the normal render, so halos count as
    background, as WCAG counts them.
  - Each text box passes if its 5th-percentile ratio meets 4.5:1 (3:1 for large text).
  - The sweep covers 72 renders: 6 frames (10, 40, 56, 75, 110, 150) × first person, broadcast
    and the tactical board × with and without the look × desktop and phone. The lineup card and
    the popovers were measured the same way, one render each.
- **Reduced motion.** Chromium's `prefers-reduced-motion: reduce` emulation, checked by sampling
  `document.getAnimations()` and the first-person blur (`data-blur-sigma`) while the replay, the
  breakdown and Your call's reveal play.
- **Captions.**
  - On the live site with Azure speech on (casual, English): every spoken line showed as a caption
    while its clip played.
  - Locally, with speech unavailable (503), every caption still went to the screen reader's live
    region.
- **Audio description, end to end, keyboard only** (local build, offline crew): choose it in the
  viewer menu, then the breakdown arrives and plays with sound on.
- **Colour scheme.** The app is dark only (`color-scheme: dark`). It was checked under both OS
  schemes: an OS light preference changes no colour, and native controls stay dark.

## Results

| Check | Before (live site, 2026-10-21) | After (this change, local build) |
|---|---|---|
| axe WCAG A/AA, 13 screens × 2 viewports | 4 rules violated, all serious (5 findings below) | 0 violations |
| axe best practice | heading order, no `<main>` in Your call, no `<h1>` on phones | heading order in View options, no `<main>` in Your call |
| smoke (14 pages, with axe) | — (axe not in the smoke run) | 14 of 14 pass |
| Text over the picture, 72 renders | 24 text boxes below threshold | see the sweep note under Known gaps |
| Keyboard: Escape closes the overlay | lineup card, menus and Your call: yes; evidence card: no | all |
| Focus after the lineup card closes | lost to `<body>`; the next Tab skipped the live screen | the live screen's title |

Violations found on the live site, all fixed here:

1. **Contrast, 2.79:1.** The re-simulated chapter dims the run that is not playing to
   opacity 0.5, which takes its Dusk kicker to 2.79:1. It shows on every page that has the
   chapter.
2. **Contrast, 2.07:1.** In a live stitched match, the moments the stream has not reached yet were
   dimmed to opacity 0.45, though they are still buttons that replay. That took them to 2.07:1, on
   108 elements.
3. **Label in name (2.5.3).** The viewer button shows "C" plus its label. The sound toggle shows
   "Sound off" but is named "Sound". Your call's markers show a shirt number that is not in their
   name ("Pass to H3").
4. **Scrollable region (2.1.1).** The telestration steps list scrolls but could not be reached
   from the keyboard.
5. **Target size (2.5.8).** On phones the Live chip was overlapped. This was already fixed on main
   by #80 before this change.

Found by hand, fixed here:

- `button.link` ("Ask now", "Check the true value") used `all: unset`, which drops the focus ring
  (2.4.7).
- The evidence card did not close on Escape, and its close button dropped the focus on `<body>`.
- The lineup card closed after 5 s with no warning to a screen reader. It now says so, and says
  that Tab keeps it open.
- On phones the brand is hidden while the Your call pill or the match picker shows. It is now
  visually hidden instead of removed, so it stays the page's `<h1>` and can take focus.
- The director chip over the picture sat on 4 % white with no blur, because a later rule with the
  same specificity overrode its glass. It dropped to 3:1 over the ad boards.
- Small text over the picture was too faint over floodlights, white lines and ad boards. This
  covers the header strapline, "Watching as", the clock, the timeline marks, the HUD's "sim" tag
  and the pass-options legend. Those labels move from Chalk 3 to Chalk 2 with a Night halo, and the
  legend gets a glass backing because it sits on the touchline.

## What passes (verified)

- Every control on the hero, `match-1`, Your call and the lineup card has a role and a name. The
  toggles expose `aria-pressed`, and the groups and regions are named. The unit tests check this
  on the mounted components (`web/src/ui/access.test.tsx`), now with label-in-name too.
- **Keyboard.**
  - Every control is reached by Tab with a visible Floodlight ring, and there is no trap: Tab
    wraps from the last control to the first.
  - The lineup card keeps Tab inside itself while it is open (it is a modal).
  - Escape closes the lineup card, the viewer menu, View options, Your call and the evidence card.
    The focus returns to the control that opened each one, or to the live screen's title.
  - Your call is fully keyboard-operable: arrows and Enter on the markers, Escape to leave (SPEC 7
    and `yourcall.test.tsx`).
- **Reduced motion.**
  - Nothing autoplays (`main.tsx`).
  - The first-person blur stays at σ = 0 while playing.
  - Every CSS animation and transition runs 1 ms, and the lineup countdown line is hidden.
  - Your call's clips cut to their end.
- **Captions.**
  - A caption is on screen for every narration line while it plays, with sound on or off.
  - With the voice playing, the screen reader's live region is off (no double reading). It is
    polite whenever the voice is off, blocked, failed or capped.
- **Audio description.**
  - Reached from a fresh page in 5 Tabs (the viewer menu), then 1 Enter. Choosing it turns the
    sound on.
  - Captions are large print (46 px on desktop), and the narration list is large print too.
  - Its six lines tell the moment in order: where he got the ball, who was on his blind side,
    which way he looked, whom the look showed him, what he did, and what he would have done
    without the look. They have no xT or probabilities.
  - With speech unavailable, every line still reached the live region.
- **Reflow.** No sideways scroll at 320, 375 and 402 px (the smoke test checks it). The viewer
  menu, View options and the evidence card fit and are readable at 375 px.

## Known gaps

- **Text over the moving picture.** The sweep is a sample of 72 renders, not every frame. After
  the fix, the smaller labels are Chalk 2 with a halo; their worst-5 % numbers are in the PR. The
  3D views change every frame, so a frame not sampled could still put a floodlight behind a label.
- **The lineup card closes itself after 5 s.** That was the design for judges who do not click.
  A screen reader is told, and Tab keeps the card open. WCAG 2.2.1 would rather have no timer, or
  a way to turn it off before it starts. Two smaller issues remain:
  - Any key other than Tab, Enter, Space or a bare modifier closes the card, so the arrow keys
    cannot scroll it when it overflows on a small screen.
  - The card is 88 % opaque, and on desktop the live screen behind it shows through. A few of its
    Chalk 3 labels measure 4.0–4.5:1 at their worst 5 % of pixels.
- **The views are pictures.** The 3D views and the tactical board are canvases with a name and no
  text alternative for what they show. The narration (audio description above all), the HUD
  readouts and the story panels carry the content. The board's pass-option values appear on hover
  only; the Decision chapter lists the same options as text.
- **Order and structure (best practice, not WCAG failures).**
  - The view-swap button comes before the header in the Tab order.
  - "Ask now" comes after the Sound button in the narration chapter.
  - The headings in View options skip a level.
  - Your call has no `<main>`.
  - The Decision chapter's option bars and the telemetry chart read as runs of plain text.
  - Dismissing the moment card drops the focus.
- **Speech and the live region.** While a clip is being fetched, the live region is still polite,
  so a screen reader may read the caption just before the voice speaks it.
- **Not covered.**
  - Real screen readers (VoiceOver, NVDA, JAWS).
  - Safari and Firefox.
  - Windows forced-colours mode.
  - Zoom beyond the 320 px reflow width.
  - Audio description with real speech on the live site: its breakdown would cost a model call,
    so live speech was checked with the casual persona.
  - Features in open pull requests (the judge tour, the match recap, the stats panel).

## Re-running

```bash
cd web
npm run a11y -- --url https://ttesite1ff906.z14.web.core.windows.net
npm run contrast -- --url https://ttesite1ff906.z14.web.core.windows.net
npm run smoke
```

`npm run a11y` writes `out/a11y/<site>/summary.md` and one JSON file per screen and viewport.
`--reduced-motion` emulates reduced motion, and `--only <name>` picks screens. On a deployed site
it lets through only the breakdowns a visitor's first minutes ask for anyway (casual and analyst,
in English); `--all-breakdowns` lifts that.
