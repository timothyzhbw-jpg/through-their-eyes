// End-to-end smoke test of the web app (SPEC 7, 8): the production build, talking to a local API
// service, opened page by page in headless Chromium. Every page must show its main view with no
// console error, no uncaught exception and no serious or critical WCAG violation (axe-core); a
// screenshot of each goes to out/smoke/. The unit tests
// render the app's pieces; this loads the whole app as a visitor gets it. On 2026-10-20
// `?match=match-1` rendered a black page on the live site ("useSession needs a hero moment, not a
// match") although every unit test passed.
//
//   npm run smoke                                    start the API, build for it, serve, test
//   npm run smoke -- --api http://localhost:8765     an API that is already running
//   npm run smoke -- --only match --headed           pages whose name has "match", in a window
//
// Starting the API needs uv and the Python environment (`uv sync` at the repo root). It runs
// offline whatever this shell has set: no model, no Speech, no Cosmos DB, no telemetry, a fresh
// breakdown cache, and the three matches the pages need. Pages find what they check by role and
// accessible name, as a screen reader does, so a new layout or style does not break them; a
// renamed control does, and then the test is updated with it.

import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { devices } from "playwright-core";
import { build, preview } from "vite";
import { axe, BLOCKING, describe, WCAG } from "./axe.mjs";
import { launchChrome } from "./gpu.mjs";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MATCHES = "blind_side_run:3,corner_blind_side:0,match:1,match:2,press_escape:0";
const TIMEOUT = 45_000; // per step: the first load fetches the export, fonts and models
const SETTLE = 2_500; // after the checks, so late errors (models, stream, breakdown) surface
const BLANK = 20_000; // bytes: a screenshot of the page's background alone; a drawn page is ~400K

const { values: opt } = parseArgs({
  options: {
    api: { type: "string" }, // an API that is already running; else one is started on :8765
    only: { type: "string" }, // run the pages whose name contains this
    headed: { type: "boolean", default: false },
    out: { type: "string", default: join(ROOT, "out", "smoke") },
  },
});

const DESKTOP = { viewport: { width: 1440, height: 900 } };
// The phone is an iPhone as Playwright describes it (viewport, pixel ratio, touch, Safari's user
// agent), drawn by Chromium: the layout an iPhone gets, not WebKit's rendering.
const { defaultBrowserType: _, ...PHONE } = devices["iPhone 17"];
const { defaultBrowserType: _se, ...PHONE_320 } = devices["iPhone SE"]; // 320 px
const { defaultBrowserType: _mini, ...PHONE_375 } = devices["iPhone 13 Mini"]; // 375 px

/** The README's tour for judges, and the pages around it. `intro=0` skips the intro card, which
 * the two intro pages open and close as a visitor does. */
const PAGES = [
  { name: "hero", path: "?autoplay=0&intro=0", check: (p) => hero(p) },
  {
    name: "press-escape",
    path: "?match=press_escape-0&autoplay=0&intro=0",
    check: (p) => hero(p),
  },
  { name: "match-1", path: "?match=match-1&autoplay=0&intro=0", check: (p) => match(p) },
  { name: "match-1-breakdowns", path: "?match=match-1&intro=0", check: breakdownsAndBack },
  { name: "match-2", path: "?match=match-2&autoplay=0&intro=0", check: (p) => match(p) },
  { name: "match-2-breakdowns", path: "?match=match-2&intro=0", check: breakdownsAndBack },
  { name: "lineup-hero", path: "", check: (p, shoot) => lineup(p, shoot, "Just watch", hero) },
  { name: "cold-load-without-the-look", path: "", check: coldLoad },
  {
    name: "lineup-match-1",
    path: "?match=match-1",
    check: (p, shoot) => lineup(p, shoot, "Watch the match", match),
  },
  { name: "link-tamper", path: "?persona=analyst&tamper=cf_value", check: tamper },
  {
    name: "link-tamper-count",
    path: "?persona=analyst&tamper=scans_before_reception",
    check: tamperCount,
  },
  { name: "follow-player-eyes", path: "?autoplay=0&intro=0", check: followEyes },
  { name: "audiences", path: "?autoplay=0&intro=0", check: audiences },
  { name: "link-eyes", path: "?play=eyes", check: takeEyes },
  { name: "link-eyes-press-escape", path: "?match=press_escape-0&play=eyes", check: takeEyes },
  {
    name: "link-eyes-match-1",
    path: "?match=match-1&play=eyes",
    check: async (p) => {
      await see(p.getByRole("button", { name: /Back to the match/ }), "Back to the match");
      await takeEyes(p);
    },
  },
  {
    name: "phone-320-eyes",
    path: "?play=eyes",
    device: PHONE_320,
    check: (p) => phone(p, takeEyes, { live: false }),
  },
  { name: "link-yourcall", path: "?play=yourcall", check: (p, shoot) => yourCall(p, shoot) },
  // The academy drill (SPEC 7), on both moments with a look grid, and on a phone.
  { name: "link-drill", path: "?play=drill", check: (p) => drill(p, "Blind side") },
  {
    name: "link-drill-press-escape",
    path: "?match=press_escape-0&play=drill",
    check: (p) => drill(p, "Under pressure"),
  },
  {
    name: "phone-375-drill",
    path: "?play=drill",
    device: PHONE_375,
    check: (p) => phone(p, (q) => drill(q, "Blind side"), { live: false }),
  },
  { name: "moment-links", path: "?intro=0", check: (p, shoot) => momentLinks(p, shoot) },
  // The card's primary button stays above the fold of a 390 × 844 phone (styles.css, phone card).
  {
    name: "phone-390-primary-above-fold",
    path: "?intro=0&autoplay=0",
    device: { ...PHONE_375, viewport: { width: 390, height: 844 } },
    check: async (p) => {
      const button = p.locator(".moment-card .card-actions .btn").first();
      await see(button, "the card's primary button");
      const bottom = await button.evaluate((el) => el.getBoundingClientRect().bottom);
      if (bottom > 844) throw new Error(`primary button ends at y=${bottom}, below the 844 fold`);
    },
  },
  {
    name: "phone-375-moment-links",
    path: "?intro=0",
    device: PHONE_375,
    check: (p, shoot) => momentLinks(p, shoot),
  },
  {
    name: "phone-375-yourcall",
    path: "?play=yourcall",
    device: PHONE_375,
    check: (p, shoot) => phone(p, (q) => yourCall(q, shoot), { live: false }),
  },
  { name: "link-steps", path: "?play=steps", check: scanSteps },
  { name: "link-steps-press-escape", path: "?match=press_escape-0&play=steps", check: scanSteps },
  {
    name: "phone-320-steps",
    path: "?play=steps",
    device: PHONE_320,
    check: (p) => phone(p, scanSteps, { live: false }),
  },
  { name: "link-recap", path: "?match=match-1&play=recap", check: recap },
  // The key-moment beat (SPEC 7) at a spot inside the key scan, after the runner came into sight.
  { name: "beat-eyes", path: "?at=60", check: (p) => beat(p, { push: 1 }) },
  { name: "beat-broadcast", path: "?at=66&camera=broadcast", check: (p) => beat(p, { push: 1 }) },
  {
    name: "beat-reduced-motion",
    path: "?at=60",
    device: { ...DESKTOP, reducedMotion: "reduce" },
    check: (p) => beat(p, { push: 0 }),
  },
  // The render tiers (SPEC 7, src/quality/): the post chain loads, draws, and says which tier.
  { name: "quality-high", path: "?at=60&quality=high", check: (p) => tier(p, "high") },
  {
    name: "quality-high-broadcast",
    path: "?at=66&camera=broadcast&quality=high",
    check: (p) => tier(p, "high"),
  },
  {
    name: "phone-quality-medium",
    path: "?intro=0&quality=medium",
    device: PHONE,
    // The tier and the phone layout. Not the live stream: where the tier's chunk loads slowly (a
    // software renderer) the stream has reached the hero moment and the cold-load show has taken
    // over by then (SPEC 2). phone-hero checks the stream on a phone.
    check: (p) => phone(p, (q) => tier(q, "medium"), { live: false }),
  },
  // No head-turn blur unless the viewer turns it on, and none right after a camera cut, even then
  // (beat/cut.ts).
  { name: "cut-no-blur", path: "?autoplay=0&intro=0", check: cutNoBlur },
  { name: "cut-no-blur-high", path: "?autoplay=0&intro=0&quality=high", check: cutNoBlur },
  // Every camera switch lands on a frame drawn at its pane's size, with no new WebGL context
  // (views/InstantFrame.tsx): no blank, stretched or cleared frame at a cut.
  {
    name: "instant-cuts",
    path: "?autoplay=0&intro=0&at=60",
    init: watchCanvases,
    check: instantCuts,
  },
  {
    name: "link-decision-tactical",
    path: "?at=decision&view=tactical",
    check: async (p) => {
      await hero(p, { main: "board" });
      await boardClear(p);
    },
  },
  // The skeleton's key over the broadcast camera, with the director's prompt and the stats up, and
  // on the board at the decision, with the pass options' key up: no text on text (it sat on
  // "Switch to …" at 1800 px, and on the board on the pass options' key).
  ...[
    [1440, 900],
    [1280, 800],
    [960, 800],
  ].flatMap(([width, height]) => [
    {
      name: `desktop-${width}-skeleton`,
      path: "?at=60&camera=broadcast",
      device: { viewport: { width, height } },
      check: async (p) => {
        await hero(p, { main: "eyes" });
        await skeletonKeyClear(p);
      },
    },
    {
      name: `desktop-${width}-skeleton-board`,
      path: "?at=decision&view=tactical",
      device: { viewport: { width, height } },
      check: async (p) => {
        await hero(p, { main: "board" });
        await skeletonKeyClear(p, { within: ".slot.main .view.tac" });
      },
    },
  ]),
  // A phone's board: the key has its own row under the picture (on the board it hid half of it).
  {
    name: "phone-375-skeleton-board",
    path: "?at=decision&view=tactical&intro=0",
    device: PHONE_375,
    check: (p) =>
      phone(
        p,
        async (q) => {
          await hero(q, { main: "board" });
          await skeletonKeyClear(q, { outside: ".views" });
        },
        { live: false },
      ),
  },
  {
    name: "desktop-1280-tactical",
    path: "?at=56&view=tactical",
    device: { viewport: { width: 1280, height: 800 } },
    check: async (p) => {
      await hero(p, { main: "board" });
      await boardClear(p);
    },
  },
  // Wider than 5:3: the HUD is a column beside the board (trailer shot 04 films this one).
  {
    name: "desktop-1920-tactical",
    path: "?at=decision&view=tactical",
    device: { viewport: { width: 1920, height: 1080 } },
    check: async (p) => {
      await hero(p, { main: "board" });
      await boardClear(p);
    },
  },
  { name: "tour", path: "?tour=1", check: (p, shoot) => tour(p, shoot) },
  { name: "quick-tour", path: "?tour=quick", check: (p, shoot) => quickTour(p, shoot) },
  // The three doors (SPEC 7, doors/). Door 2: Your turn's hub, a card's mode and back to it.
  { name: "door-turn", path: "?door=turn", check: (p) => yourTurn(p, { open: true }) },
  {
    name: "phone-375-door-turn",
    path: "?door=turn",
    device: PHONE_375,
    check: (p) => phone(p, yourTurn, { live: false }),
  },
  // Door 3, For studios (journey/): each of its four steps opened from the bar, axe on each, and
  // each step's Next; a deep link to one step; a phone's stepper; the studios' walk through all.
  { name: "journey", path: "?door=studios", check: (p, shoot) => journeySteps(p, shoot) },
  {
    name: "journey-link-value",
    path: "?step=value",
    check: (p) => journeyPanel(p, "Value"),
  },
  {
    name: "phone-375-journey",
    path: "?door=studios",
    device: PHONE_375,
    check: (p, shoot) => journeyStepper(p, shoot),
  },
  { name: "full-story", path: "?tour=story", check: (p, shoot) => fullStory(p, shoot) },
  // The old journey's addresses: Event is door 1's compare, Your view is in Settings.
  {
    name: "link-step-event",
    path: "?step=event",
    check: async (p) => {
      await hero(p);
      await see(p.getByRole("region", { name: "The look, compared" }), "door 1's compare");
    },
  },
  {
    name: "link-step-your-view",
    path: "?step=your-view",
    check: async (p) => {
      await hero(p);
      await see(p.getByRole("dialog", { name: "Your view" }), "Your view open in Settings");
    },
  },
  // A phone: no director's suggestion under the picture; Auto director in View options.
  ...[
    ["375", PHONE_375],
    ["320", PHONE_320],
  ].map(([width, device]) => ({
    name: `phone-${width}-director`,
    path: "?at=decision&intro=0&autoplay=0",
    device,
    check: (p) =>
      phone(
        p,
        async (q) => {
          await hero(q);
          await noDirectorOnPhone(q);
        },
        { live: false },
      ),
  })),
  {
    name: "phone-375-quick-tour",
    path: "?tour=quick",
    device: PHONE_375,
    check: (p, shoot) => quickTour(p, shoot),
  },
  {
    name: "tour-recap",
    path: "?match=match-1&play=recap&tour=recap",
    check: (p, shoot) => tour(p, shoot, match),
  },
  {
    name: "phone-tour",
    path: "?tour=1",
    device: PHONE,
    check: (p, shoot) => tour(p, shoot),
  },
  {
    // a narrow desktop: from 901 px the viewer button shows its full label, and the hero's header
    // also carries Your call and More; checked like a phone's (no overlap, on screen)
    name: "desktop-960-hero",
    path: "?intro=0",
    device: { viewport: { width: 960, height: 800 } },
    check: (p) => phone(p, hero),
  },
  // A laptop: the header's pills, the run switch and the column left of it must not meet (the
  // pills and the switch did at 1440 px once "His looks" joined the header).
  {
    name: "desktop-1440-hero",
    path: "?intro=0",
    device: { viewport: { width: 1440, height: 900 } },
    check: (p) => phone(p, hero),
  },
  {
    name: "desktop-1280-hero",
    path: "?intro=0",
    device: { viewport: { width: 1280, height: 800 } },
    check: (p) => phone(p, hero),
  },
  {
    name: "phone-hero",
    path: "?intro=0",
    device: PHONE,
    check: (p) => phone(p, hero),
  },
  {
    name: "phone-match-1",
    path: "?match=match-1&intro=0",
    device: PHONE,
    check: (p) => phone(p, match),
  },
  {
    name: "phone-320-hero",
    path: "?intro=0",
    device: PHONE_320,
    check: (p) => phone(p, hero),
  },
  {
    name: "phone-320-match-1",
    path: "?match=match-1&intro=0",
    device: PHONE_320,
    check: (p) => phone(p, match),
  },
  {
    name: "phone-375-hero",
    path: "?intro=0",
    device: PHONE_375,
    check: (p) => phone(p, hero),
  },
  {
    name: "phone-375-match-1",
    path: "?match=match-1&intro=0",
    device: PHONE_375,
    check: (p) => phone(p, match),
  },
  // The Stadium Screen Studio (SPEC 7): the lazy branch of main.tsx, flat wall and with the 3D bowl.
  { name: "studio-wall", path: "?studio=1&wall=1", check: (p) => studio(p) },
  { name: "studio", path: "?studio=1", check: (p) => studio(p) },
];

/** The studio page: its heading, the timeline and the Screen wall are on screen. */
async function studio(page) {
  await see(
    page.getByRole("heading", { name: "Every screen in the bowl, on one timeline" }),
    "the studio heading",
  );
  await see(page.getByRole("region", { name: "Event timeline" }), "the event timeline");
  await see(page.locator(".screen-wall"), "the Screen wall");
}

/** Wait for `locator` (its first match) to be on screen, or `attached` to the page. */
async function see(locator, what, state = "visible") {
  try {
    await locator.first().waitFor({ state });
  } catch {
    throw new Error(`expected ${what}`);
  }
}

/** The main view on screen with its WebGL canvas: the 3D view (first person or broadcast) or the
 * tactical board. Only the main one: a layout may show one view at a time (a phone does), and a
 * view that fails to draw logs an error anyway. */
async function mainView(page, main) {
  const view =
    main === "board"
      ? page.getByRole("figure", { name: "Tactical view from above" })
      : page.getByRole("figure", { name: /^(First-person|Broadcast) view$/ });
  await see(view, `the ${main === "board" ? "tactical board" : "3D view"} on screen`);
  await see(view.locator("canvas"), "its WebGL canvas");
}

/** Each audience sees its own view (SPEC 6, "Persona specs"): picking one sets its camera and
 * overlays at once, before its breakdown arrives. A screenshot of each. */
async function audiences(page, shoot) {
  await hero(page);
  const pick = async (label, main, also) => {
    await openMore(page); // who is watching is in the header's ⋯
    const toggle = page.getByRole("button", { name: /^Watching as / });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    const menu = page.getByRole("dialog", { name: "Who is watching" });
    await menu.getByRole("button", { name: new RegExp(`^${label} `) }).click();
    await page.keyboard.press("Escape");
    await see(page.getByRole("button", { name: `Watching as ${label} · English` }), label);
    await mainView(page, main);
    if (also) await see(also, `${label}'s view`);
    await shoot(label.toLowerCase().replaceAll(" ", "-"));
  };
  const figure = (name) => page.getByRole("figure", { name });
  await pick("Analyst", "board");
  await pick("Player fan", "eyes", figure("Broadcast view"));
  // Split: his eyes, and in the corner his picture of the pitch (views/BeliefMap.tsx).
  await pick("Coach", "eyes", page.getByRole("img", { name: /'s picture of the pitch/ }));
  await pick("Casual fan", "eyes", figure("First-person view"));
  await pick("Audio description", "eyes", figure("Broadcast view"));
}

/** A hero moment: its views and its run switch, and the header's three doors (The look marked) and
 * Settings; at the top level no Live pill (the stream runs, its state on the stage's
 * data-stream); inside a match, the way back. */
async function hero(page, { main = "eyes", inMatch = false } = {}) {
  if (inMatch) {
    await see(page.getByRole("button", { name: /Back to the match/ }), "Back to the match");
  } else if (await page.locator(".stage-head .live-chip").count()) {
    throw new Error("expected no Live pill on a hero moment");
  }
  await doorTabs(page, "The look");
  await see(page.getByRole("group", { name: "Run" }), "a hero moment's run switch");
  await mainView(page, main);
}

/** The header's three doors, `current` marked, and its one menu, Settings; no other control. */
async function doorTabs(page, current) {
  const nav = page.locator(".stage-head").getByRole("navigation", { name: "Doors" });
  await see(nav, "the header's three doors");
  const names = (await nav.locator("button, a").allTextContents()).map((t) => t.trim());
  if (names.join("|") !== "The look|Your turn|For studios") {
    throw new Error(`expected the doors The look, Your turn, For studios; got ${names.join(", ")}`);
  }
  if (current) {
    const marked = (await nav.locator("[aria-current=page]").allTextContents()).map((t) =>
      t.trim(),
    );
    if (marked.join("|") !== current) {
      throw new Error(`expected ${current} marked as the door on screen; got ${marked.join(", ")}`);
    }
  }
  await see(page.locator(".stage-head").getByRole("button", { name: "Settings" }), "Settings");
  const extra = await page
    .locator(".stage-head")
    .locator("#your-call-open, .moments-menu, #header-more")
    .count();
  if (extra) throw new Error("expected no header control but the doors and Settings");
}

/** The header's Settings open (the moment, who is watching, who to follow, sound, View options,
 * the full tour). */
async function openMore(page) {
  const more = page.locator("#settings");
  if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
}

/** View options open, in the header's ⋯. */
async function viewOptions(page) {
  await openMore(page);
  const toggle = page.getByRole("button", { name: "View options" });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
}

/** Close View options and the ⋯ around it: Escape closes the inner one, then the outer. */
async function closeMenus(page) {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
}

/** Nothing of the director over a phone's picture: its pending suggestion is a dot on the camera
 * switch, which stays on the bar; Auto director is in View options. */
async function noDirectorOnPhone(page) {
  const shown = await page.evaluate(() =>
    [...document.querySelectorAll(".stage-director, .director-chip")]
      .map((el) => el.getBoundingClientRect())
      .some((r) => r.width > 0 && r.height > 0),
  );
  if (shown) throw new Error("the director's suggestion shows over a phone's picture");
  await see(
    page.locator(".transport").getByRole("group", { name: "Camera" }),
    "the camera switch on the bar",
  );
  await viewOptions(page);
  await see(page.getByRole("button", { name: "Auto director" }), "Auto director in View options");
  await closeMenus(page);
}

/** The board as the main view: no part of the HUD (whose eyes, the director's suggestion and its
 * buttons, the stats ticker) or the run switch over it. Floating over the board they hid the
 * players in its top-left corner, and trailer shot 04, the board cropped, filmed them. */
async function boardClear(page) {
  const over = await page.evaluate(() => {
    const board = document.querySelector(".slot.main .view.tac")?.getBoundingClientRect();
    if (!board) return ["(no board as the main view)"];
    return [
      ...document.querySelectorAll(
        ".stage-top :is(button, .stat-chip, .hud > span), .stage-run .seg",
      ),
    ]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const across = Math.min(r.right, board.right) - Math.max(r.left, board.left);
        const down = Math.min(r.bottom, board.bottom) - Math.max(r.top, board.top);
        return r.width > 1 && r.height > 1 && across > 0.5 && down > 0.5;
      })
      .map((el) => `${el.classList[0] ?? el.tagName} "${el.textContent.trim().slice(0, 24)}"`);
  });
  if (over.length) throw new Error(`over the tactical board: ${over.join(", ")}`);
}

/** With the skeleton on, its key overlaps nothing else on the live screen: not the eyes picker,
 * the director's prompt or its buttons, the stats, the run switch, the card, the caption or the
 * pass options' key. `within`: it stays inside that element (the board); `outside`: it is clear of
 * it (a phone's picture). */
async function skeletonKeyClear(page, { within = null, outside = null } = {}) {
  await viewOptions(page);
  await page.getByRole("button", { name: "Skeleton", exact: true }).click();
  await closeMenus(page);
  // the board in the picture in picture has its own key, hidden there: the one on show
  await see(page.locator(".skeleton-key:visible"), "the skeleton's key");
  const over = await page.evaluate(
    ({ within, outside }) => {
      const keys = [...document.querySelectorAll(".skeleton-key")]
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0);
      if (keys.length !== 1) return [`${keys.length} keys on show`];
      const [key] = keys;
      const meets = (r) =>
        Math.min(r.right, key.right) - Math.max(r.left, key.left) > 0.5 &&
        Math.min(r.bottom, key.bottom) - Math.max(r.top, key.top) > 0.5;
      const found = [
        ...document.querySelectorAll(
          ".stage-top :is(button, .stat-chip, .hud > span), .stage-run .seg, .stage-card > *, .stage-caption .caption, .slot.main .options-legend",
        ),
      ]
        .filter((el) => !el.closest(".skeleton-key"))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 1 && r.height > 1 && meets(r);
        })
        .map((el) => `${el.classList[0] ?? el.tagName} "${el.textContent.trim().slice(0, 24)}"`);
      const box = within && document.querySelector(within)?.getBoundingClientRect();
      if (
        box &&
        (key.left < box.left ||
          key.top < box.top ||
          key.right > box.right ||
          key.bottom > box.bottom)
      ) {
        found.push(`out of ${within}`);
      }
      const clear = outside && document.querySelector(outside)?.getBoundingClientRect();
      if (clear && meets(clear)) found.push(`on ${outside}`);
      return found;
    },
    { within, outside },
  );
  if (over.length) throw new Error(`the skeleton's key overlaps: ${over.join(", ")}`);
}

/** A stitched match: the score bug, its views, the live service and every possession's moments. */
async function match(page) {
  await see(page.getByRole("group", { name: "Live stream" }), "the live stream control");
  const score = page.getByRole("region", { name: "Score and possession" });
  await see(score.filter({ hasText: /Possession \d+ of \d+/ }), "the score bug with a possession");
  await mainView(page, "eyes");
  await see(page.getByRole("region", { name: "Key moments" }), "the Moments panel", "attached");
}

/** The key-moment beat on the 3D view: pushed in (or not, under reduced motion) and the runner
 * ringed; the canvas says so in data-beat-push and data-beat-ring (beat/BeatLayers.tsx). */
async function beat(page, { push }) {
  await hero(page);
  const canvas = page
    .getByRole("figure", { name: /^(First-person|Broadcast) view$/ })
    .locator("canvas");
  try {
    await page.waitForFunction(
      ([el, want]) => Number(el.dataset.beatRing) > 0 && Number(el.dataset.beatPush) === want,
      [await canvas.elementHandle(), push],
    );
  } catch {
    const data = await canvas.evaluate((el) => ({ ...el.dataset }));
    throw new Error(`expected the beat with push ${push} and a ring, got ${JSON.stringify(data)}`);
  }
}

/** A hero moment drawn at a render tier: the 3D canvas carries data-quality once the tier's
 * chunk has loaded and taken over drawing. */
async function tier(page, want) {
  await hero(page);
  const canvas = page.locator(".view.pov canvas");
  try {
    await page.waitForFunction(
      ([el, t]) => el.dataset.quality === t,
      [await canvas.elementHandle(), want],
    );
  } catch {
    const data = await canvas.evaluate((el) => ({ ...el.dataset }));
    throw new Error(`expected the ${want} tier on the 3D canvas, got ${JSON.stringify(data)}`);
  }
}

/** How long the replay may take to reach a frame: a software renderer (SwiftShader on the CI
 * runner) draws far fewer frames, and the app's clock steps at most 0.1 s a frame. */
const PLAY_MS = process.env.CI ? 60_000 : 20_000;
/** Frames read after each cut. The cut guard (beat/cut.ts) keeps blur off for 0.3 s and for at
 * least its first 4 frames: on a software renderer one frame can outlast the 0.3 s, so the check
 * counts frames, one short of the guard. */
const CUT_READ_FRAMES = 3;

/** The first-person head-turn blur is off by default (Bowen: blur is uncomfortable). The replay
 * opens as H8 looks away (his head whips round over frames 50-59, holds at 60-62, and looks back
 * over 63-69): played to frame 60, the canvas stays sharp. Then, paused, "Motion blur" is turned
 * on in View options; played into the look back, the moment the blur shows the camera cuts to
 * the broadcast camera and back, and the first CUT_READ_FRAMES frames after each cut are sharp. */
async function cutNoBlur(page) {
  await hero(page);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const byDefault = await page.evaluate(async (limit) => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const el = document.querySelector(".view.pov canvas");
    const timeline = document.querySelector('input[aria-label="Timeline"]');
    const t0 = performance.now();
    let most = 0;
    while (Number(timeline.value) < 60 && performance.now() - t0 < limit) {
      await frame();
      most = Math.max(most, Number(el.dataset.blurSigma ?? 0));
    }
    document.querySelector('button[aria-label="Pause"]')?.click(); // before the look back
    return { most, frame: Number(timeline.value) };
  }, PLAY_MS);
  if (byDefault.frame < 60) {
    throw new Error(`play did not pass the look away (frame ${byDefault.frame})`);
  }
  if (byDefault.most > 0) {
    throw new Error(`expected no head-turn blur by default, got sigma ${byDefault.most} px`);
  }

  await viewOptions(page);
  const blur = page.getByRole("button", { name: "Motion blur" });
  await blur.click();
  if ((await blur.getAttribute("aria-pressed")) !== "true")
    throw new Error("Motion blur did not turn on");
  await closeMenus(page);
  const after = await page.evaluate(
    async ([limit, reads]) => {
      const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
      const el = document.querySelector(".view.pov canvas");
      document.querySelector('button[aria-label="Play"]').click();
      // Turned on, the blur comes on as his head whips back.
      const t0 = performance.now();
      while (!(Number(el.dataset.blurSigma) > 0)) {
        if (performance.now() - t0 > limit) return { blurred: false };
        await frame();
      }
      const cuts = [];
      for (const name of ["Broadcast", "His eyes"]) {
        [...document.querySelectorAll('[aria-label="Camera"] button')]
          .find((b) => b.textContent.trim() === name)
          .click();
        const seen = [];
        for (let k = 0; k < reads; k++) {
          await frame();
          // The head-whip blur and, at the medium and high tiers, the depth of field.
          seen.push(Number(el.dataset.blurSigma ?? 0) + Number(el.dataset.dof ?? 0));
        }
        cuts.push({ name, seen });
      }
      return { blurred: true, cuts };
    },
    [PLAY_MS, CUT_READ_FRAMES],
  );
  if (!after.blurred) throw new Error("Motion blur on, but no blur as his head turned back");
  for (const { name, seen } of after.cuts) {
    if (seen.some((v) => v > 0)) {
      throw new Error(`expected no blur right after the cut to ${name}, got ${seen.join(", ")}`);
    }
  }
}

/** In the page before the app: when each canvas was last resized (which clears it) and last
 * drawn to, and how many WebGL contexts the page has made. */
function watchCanvases() {
  window.__canvases = { contexts: 0 };
  for (const dim of ["width", "height"]) {
    const own = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, dim);
    Object.defineProperty(HTMLCanvasElement.prototype, dim, {
      configurable: true,
      get() {
        return own.get.call(this);
      },
      set(value) {
        this.__resizedAt = performance.now();
        own.set.call(this, value);
      },
    });
  }
  for (const gl of [WebGLRenderingContext, WebGL2RenderingContext]) {
    for (const name of [
      "drawArrays",
      "drawElements",
      "drawArraysInstanced",
      "drawElementsInstanced",
    ]) {
      const draw = gl.prototype[name];
      if (!draw) continue;
      gl.prototype[name] = function (...args) {
        this.canvas.__drawnAt = performance.now();
        return draw.apply(this, args);
      };
    }
  }
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const context = getContext.call(this, type, ...rest);
    if (context && String(type).startsWith("webgl") && !this.__counted) {
      this.__counted = true;
      window.__canvases.contexts++;
    }
    return context;
  };
}

/** Camera switches are clean cuts (SPEC 7): in the first frame painted after each switch, every
 * canvas on show has the size of its pane and was drawn after its last resize; no switch makes a
 * WebGL context (the board waits under his belief map instead of being built again). */
async function instantCuts(page) {
  await hero(page);
  await page.waitForFunction(() => window.__canvases.contexts >= 1, null, { timeout: 20_000 });
  await page.waitForTimeout(1000); // the board's context too, if it is built up front
  const contexts = await page.evaluate(() => window.__canvases.contexts);
  for (const name of ["Broadcast", "Tactical", "His eyes", "Tactical", "Broadcast", "His eyes"]) {
    const wrong = await page.evaluate(
      (name) =>
        new Promise((done) => {
          [...document.querySelectorAll('[aria-label="Camera"] button')]
            .find((b) => b.textContent.trim() === name)
            .click();
          // After the first frame's paint: what that frame showed.
          requestAnimationFrame(() =>
            setTimeout(() => {
              const dpr = Math.min(2, Math.max(1, window.devicePixelRatio));
              const wrong = [];
              for (const canvas of document.querySelectorAll(".views canvas")) {
                const box = canvas.parentElement.getBoundingClientRect();
                if (box.width === 0 || getComputedStyle(canvas).visibility === "hidden") continue;
                const view = canvas.closest("figure")?.getAttribute("aria-label") ?? "a canvas";
                const w = Math.floor(box.width * dpr);
                const h = Math.floor(box.height * dpr);
                if (Math.abs(canvas.width - w) > 1 || Math.abs(canvas.height - h) > 1) {
                  wrong.push(
                    `${view} drawn at ${canvas.width}x${canvas.height} in a ${w}x${h} pane`,
                  );
                } else if (!((canvas.__drawnAt ?? -1) >= (canvas.__resizedAt ?? 0))) {
                  wrong.push(`${view} cleared by a resize and not drawn again`);
                }
              }
              done(wrong);
            }, 0),
          );
        }),
      name,
    );
    if (wrong.length) throw new Error(`the first frame after "${name}": ${wrong.join("; ")}`);
  }
  const after = await page.evaluate(() => window.__canvases.contexts);
  if (after !== contexts) {
    throw new Error(`camera switches made ${after - contexts} new WebGL context(s)`);
  }
}

/** Your view → Follow → Player: the EYES selector follows the chosen player when the moment has
 * his look data; otherwise the note says so and "Watch through #N's eyes" does it. The EYES
 * selector switches players on its own too. */
async function followEyes(page) {
  await hero(page);
  // The picker is in View options, in the header's Settings: open both to read or use it, close
  // them again before the next click on the main screen.
  const eyes = page.getByRole("combobox", { name: "Whose eyes" });
  await viewOptions(page);
  const hostId = await eyes.inputValue();
  const ids = await eyes.locator("option").evaluateAll((os) => os.map((o) => o.value));
  const other = ids.find((id) => id !== hostId);
  await eyes.selectOption(other);
  if ((await eyes.inputValue()) !== other) throw new Error("expected the EYES selector to switch");
  await eyes.selectOption(hostId);
  await closeMenus(page);

  // Your view (who to follow) is in Settings too, under its own button.
  const yourViewToggle = page
    .locator("#settings ~ .more-panel")
    .getByRole("button", { name: "Your view" });
  const yourView = async () => {
    await openMore(page);
    if ((await yourViewToggle.getAttribute("aria-expanded")) !== "true") {
      await yourViewToggle.click();
    }
  };
  await yourView();
  const follow = page
    .locator(".your-view-panel select")
    .filter({ has: page.locator("option", { hasText: "No player" }) });
  const options = await follow.locator("option").evaluateAll((os) => os.map((o) => o.value));
  const pick = options.find((v) => v && v !== hostId);
  await follow.selectOption(pick);
  const note = page.getByTestId("follow-eyes");
  await see(note, "the note on the followed player's looks");
  const eyesNow = async () => {
    // Your view folds first, by its own button: folding on a press outside it would move View
    // options from under the pointer.
    if ((await page.locator(".your-view-panel").count()) && (await yourViewToggle.isVisible())) {
      await yourViewToggle.click();
    }
    await viewOptions(page);
    const value = await eyes.inputValue();
    await closeMenus(page);
    return value;
  };
  if ((await eyesNow()) !== pick) {
    await yourView();
    await see(note.getByText(/has no recorded looks in this moment/), "the no-look-data note");
    await note.getByRole("button", { name: /^Watch through #\d+'s eyes$/ }).click();
    await closeMenus(page);
  }
  const got = await eyesNow();
  if (got !== pick) throw new Error(`expected the EYES selector on ${pick}, got ${got}`);
}

/** A count typed into "Try a wrong number" (the scans claim's number of looks): 0, 3 and 7, typed
 * key by key, each reaches the Verifier, which refutes it; the true count is supported. */
async function tamperCount(page) {
  await tamper(page);
  const form = page.locator(".tamper-form").filter({ has: page.locator("input[name='n']") });
  const input = form.locator("input");
  const verdict = page.locator(".tamper-result");
  const payload = JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../public/data/fixture_payload_seed3.json", import.meta.url)),
      "utf8",
    ),
  );
  const trueN = payload.claims.find((c) => c.id === "scans_before_reception").values.n;
  for (const n of ["0", "3", "7"].filter((v) => Number(v) !== trueN)) {
    await input.fill("");
    await input.pressSequentially(n);
    if ((await input.inputValue()) !== n) throw new Error(`expected ${n} in the input`);
    await form.getByRole("button", { name: "Check", exact: true }).click();
    await see(verdict.getByText(/Refuted — this line would not air/), `the Verifier on ${n}`);
    await see(verdict.getByText(new RegExp(`You set .* to ${n};`)), `the answer names ${n}`);
  }
  await form.getByRole("button", { name: /^Check the true value/ }).click();
  await see(verdict.getByText(/Supported — this line would air/), "the true count supported");
}

/** `?persona=analyst&tamper=cf_value`: the evidence card with "Try a wrong number" open. */
async function tamper(page) {
  await hero(page);
  await see(page.getByRole("region", { name: "Evidence for this line" }), "the evidence card");
  await see(
    page.getByRole("button", { name: "Try a wrong number", expanded: true }),
    '"Try a wrong number" open',
  );
}

/** `?tour=1`, the judges' tour (SPEC 7, web/src/tour/), or its match steps (the recap): its card
 * on screen at every step and no sideways scroll, Next through to the end without pressing the
 * steps' own buttons (the drill would run the crew), then Done closes it and the page works as
 * before. A tour link opens
 * paused (no stream), so the phone's header check, which wants the stream running, is not run. */
async function tour(page, shoot, after = hero) {
  const card = page.getByRole("dialog").filter({ hasText: /^Tour · \d+ of \d+/ });
  for (let k = 1; ; k++) {
    await see(card.filter({ hasText: new RegExp(`^Tour · ${k} of `) }), `the tour's step ${k}`);
    const [box, size] = await Promise.all([
      card.boundingBox(),
      page.evaluate(() => [innerWidth, innerHeight, document.documentElement.scrollWidth]),
    ]);
    const [w, h, wide] = size;
    if (!box || box.x < 0 || box.y < 0 || box.x + box.width > w || box.y + box.height > h) {
      throw new Error(`expected the tour's step ${k} card on screen, got ${JSON.stringify(box)}`);
    }
    if (wide > w) throw new Error(`expected no sideways scroll at step ${k}: ${wide} px in ${w}`);
    await shoot(`step-${k}`);
    const done = card.getByRole("button", { name: "Done" });
    if (await done.count()) {
      await done.click();
      break;
    }
    if (k > 12) throw new Error("expected the tour to end within 12 steps");
    await card.getByRole("button", { name: "Next" }).click();
  }
  try {
    await card.waitFor({ state: "detached" });
  } catch {
    throw new Error('expected "Done" to close the tour');
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await after(page);
}

/** For studios' four steps, in its bar's order (journey/steps.ts), and what each panel shows. */
const JOURNEY = [
  ["Tactics", /Why tactics/],
  ["Content", /In the stadium/],
  ["Value", /Sponsor slots in this programme/],
  ["Behind the scenes", /The crew writes/],
];
const DEMO_DATA = "Demo data: simulated audience, not real results";

/** The open step's panel: its tab selected, the panel on screen with what it shows, no sideways
 * scroll, axe clean; the Value step with the demo-data badge on its figures. */
async function journeyPanel(page, label) {
  const [, shows] = JOURNEY.find(([l]) => l === label);
  await doorTabs(page, "For studios");
  const panel = page.getByRole("tabpanel", { name: new RegExp(label) });
  await see(panel, `the journey's ${label} panel`);
  await see(panel.getByText(shows), `the ${label} panel's content`);
  if (label === "Value") {
    await see(panel.getByText(DEMO_DATA, { exact: true }), "the demo-data badge");
    await see(
      panel.getByText(/^Match facts on this page come from the simulator/),
      "the facts note",
    );
  }
  const [w, wide] = await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth]);
  if (wide > w) throw new Error(`expected no sideways scroll on ${label}: ${wide} px in ${w}`);
  // Past the cards' rise and the buttons' colour change, so axe reads the colours at rest.
  await page.waitForTimeout(600);
  await accessible(page, `the journey's ${label} step`);
}

/** Every step from the bar: a click on the first, then the arrow keys; then each step's own Next
 * under its panel, from the first. */
async function journeySteps(page, shoot) {
  const bar = page.getByRole("tablist", { name: "Studio steps" });
  await see(bar, "the studios' bar");
  await bar.getByRole("tab", { name: /Tactics/ }).click();
  for (const [k, [label]] of JOURNEY.entries()) {
    const tab = bar.getByRole("tab", { name: new RegExp(label) });
    if ((await tab.getAttribute("aria-selected")) !== "true") {
      throw new Error(`expected the arrow key to select ${label}`);
    }
    await journeyPanel(page, label);
    await shoot(`step-${k + 1}`);
    if (k < JOURNEY.length - 1) await page.keyboard.press("ArrowRight");
  }
  if (!new URL(page.url()).search.includes("step=crew")) {
    throw new Error(`expected ?step=crew in the address, got ${page.url()}`);
  }
  // The last step ends the door; each other step's one action is the next step.
  await see(page.getByText(/^That's the studio side/), "the end of the studios' steps");
  await bar.getByRole("tab", { name: /Tactics/ }).click();
  for (const [label] of JOURNEY.slice(1)) {
    await page.getByRole("button", { name: `Next: ${label}` }).click();
    await see(page.getByRole("tabpanel", { name: new RegExp(label) }), `${label} from Next`);
  }
}

/** A phone: the bar is a stepper (no tabs on screen); Next walks the four steps. */
async function journeyStepper(page, shoot) {
  const stepper = page.locator(".journey-stepper");
  await see(stepper, "the journey's stepper");
  if (await page.getByRole("tablist", { name: "Studio steps" }).isVisible()) {
    throw new Error("expected the journey's tabs to fold into a stepper on a phone");
  }
  for (const [k, [label]] of JOURNEY.entries()) {
    await see(stepper.getByText(`Step ${k + 1} of ${JOURNEY.length}`), `step ${k + 1}`);
    await journeyPanel(page, label);
    await shoot(`step-${k + 1}`);
    if (k < JOURNEY.length - 1) await stepper.getByRole("button", { name: /^Next/ }).click();
  }
}

/** `?tour=story`: the studios' walk, its card opening each of For studios' four steps' panels,
 * and closes on Done. */
async function fullStory(page, shoot) {
  const card = page.getByRole("dialog").filter({ hasText: /^For studios · \d+ of \d+/ });
  const opened = [];
  for (let k = 1; ; k++) {
    await see(card.filter({ hasText: new RegExp(`^For studios · ${k} of `) }), `studio step ${k}`);
    opened.push(await page.locator(".journey-panel").getAttribute("data-step"));
    await shoot(`step-${k}`);
    const done = card.getByRole("button", { name: "Done" });
    if (await done.count()) {
      await done.click();
      break;
    }
    if (k > 8) throw new Error("expected the studios' walk to end within 8 steps");
    await card.getByRole("button", { name: "Next" }).click();
  }
  const steps = [...new Set(opened)];
  const want = ["tactics", "content", "value", "crew"];
  if (steps.join() !== want.join()) {
    throw new Error(
      `expected the studios' walk to open ${want.join(", ")}; got ${steps.join(", ")}`,
    );
  }
}

/** `?play=eyes`: Take his eyes (SPEC 7) in the live screen's place: the board with the dial, the
 * times and the directions to look; a look plays through his eyes, and the result airs its
 * verified lines. */
async function takeEyes(page) {
  await see(page.getByRole("region", { name: "Take his eyes" }), "Take his eyes");
  await see(page.getByRole("radiogroup", { name: "When he looks" }), "the times to look");
  await see(
    page.getByRole("radiogroup", { name: /^Where [A-Z]\. [A-Z][a-z]+ looks$/ }),
    "the directions",
  );
  await mainView(page, "board");
  await page.getByRole("button", { name: "Look", exact: true }).click();
  const play = page.getByRole("button", { name: "See what he does" });
  await see(play, "the look playing through his eyes");
  await play.click();
  await see(page.getByRole("list", { name: "Verified lines" }), "the look's verified lines");
}

/** `?play=drill`: the academy drill (SPEC 7) on `level`, completed: start, look over his shoulder
 * with the arrow keys (his head is a slider), let go, make the pass from his picture when the ball
 * has arrived, then the result's verified lines and the comparison. */
async function drill(page, level) {
  await see(page.getByRole("region", { name: "Academy drill" }), "the academy drill");
  await see(page.locator(".dr-kicker", { hasText: level }), `the drill on ${level}`);
  await mainView(page, "eyes");
  await accessible(page, "the drill, ready"); // the page's own check runs on the result
  await page.getByRole("button", { name: "Start" }).click(); // half speed, the default
  const head = page.getByRole("slider", { name: /'s head$/ });
  await see(head, "his head as a slider");
  // Held until his head is well round to his right (a software renderer's frames are slow, and
  // the head turns with the clock), then let go: the look.
  await head.focus();
  await page.keyboard.down("ArrowRight");
  try {
    await page.waitForFunction(
      () => Number(document.querySelector('[role="slider"]')?.getAttribute("aria-valuenow")) >= 100,
      null,
      { timeout: 15_000 },
    );
  } catch {
    throw new Error("expected the arrow key to turn his head");
  } finally {
    await page.keyboard.up("ArrowRight");
  }
  await see(
    page.locator(".dr-locked", { hasText: /^Your look: / }),
    "the look snapped to the grid",
  );
  await see(page.getByRole("heading", { name: "Your call" }), "the call at his decision");
  const options = page.getByRole("group", { name: /^Options of / }).getByRole("button");
  await see(options, "a marker per option");
  await accessible(page, "the drill's call");
  await options.first().click();
  await see(page.getByRole("list", { name: "Your drill" }), "the drill's checks");
  await see(page.getByRole("list", { name: "Verified lines" }), "the look's verified lines");
  await see(page.locator(".dr-versus"), "his real look and no look beside yours");
}

/** axe's WCAG 2.2 A/AA rules on a state a page passes through: a serious or critical violation
 * fails it, as at the page's end. */
async function accessible(page, what) {
  const { violations } = await axe(page, { tags: WCAG });
  const blocking = violations.filter((v) => BLOCKING.has(v.impact));
  if (blocking.length) throw new Error(`${what}: ${describe(blocking).join("; ")}`);
}

/** The moment links (SPEC 7, moments/): from the hero page, each link of Settings' moment picker
 * loads its moment, told by its own lede, with its link marked current and no sideways scroll; the
 * corner and the goal open inside the full match, with the way back. The page's console errors
 * fail it, as on every page. */
const MOMENT_PAGES = [
  ["The look", /the midfielder saw/],
  ["Under pressure", /centre-back saw with an opponent closing in/],
  ["The corner", /A short corner/, { inMatch: true }],
  ["The goal", /the striker saw of the keeper/, { inMatch: true }],
  ["Full match · live", /A whole match of \d+ possessions/],
];

async function momentLinks(page, shoot) {
  const menu = page.locator(".stage-head .more-panel").getByRole("navigation", { name: "Moments" });
  const open = () => openMore(page);
  for (const [label, lede, { inMatch = false } = {}] of MOMENT_PAGES) {
    await open();
    const chip = menu.locator("a", { hasText: label });
    await see(chip, `the "${label}" link in Settings' moment picker`);
    await Promise.all([page.waitForEvent("load"), chip.click()]);
    await see(
      page.locator(".moment-head .lede").filter({ hasText: lede }),
      `"${label}": its moment`,
    );
    if (inMatch) {
      await see(page.getByRole("button", { name: /Back to the match/ }), "Back to the match");
    }
    await open();
    await see(
      menu.locator('a[aria-current="page"]', { hasText: label }),
      `"${label}" marked current`,
    );
    await page.keyboard.press("Escape");
    const [wide, width] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    if (wide > width) throw new Error(`"${label}": the page scrolls sideways (${wide} > ${width})`);
    await shoot(label.toLowerCase().replace(/[^a-z]+/g, "-"));
  }
}

/** `?play=yourcall`: Your call (SPEC 7). A pick, then the reveal: why it went this way (what he
 * had seen, how his picture rated the call), what it led to, then each beat to the comparison. */
async function yourCall(page, shoot = async () => {}) {
  await see(page.getByRole("region", { name: "Your call" }), "Your call");
  const markers = page.getByRole("group", { name: /^Options of / }).getByRole("button");
  await see(markers.first(), "Your call's markers");
  await page
    .getByRole("button", { name: /^Pass to / })
    .first()
    .click();
  await see(page.getByRole("list", { name: "Reveal" }), "the reveal's steps");
  await see(page.locator('dl[aria-label="Why it went this way"]'), "why it went this way");
  await see(page.getByText("What it led to in the sim"), "what it led to");
  await shoot("why");
  for (const name of ["See the truth", "What he did", "Compare"]) {
    await page.getByRole("button", { name, exact: true }).click();
  }
  await see(page.getByRole("button", { name: "Try another call" }), "the comparison");
}

/** `?play=steps`: the scan step-through (SPEC 7) in the live screen's place: his first look
 * frozen with its verified lines, the potential passes, then his decision with everything but two
 * players dimmed. */
async function scanSteps(page) {
  await see(page.getByRole("region", { name: "His looks, step by step" }), "the step-through");
  await see(page.getByRole("list", { name: "Steps" }), "the steps");
  await see(page.getByRole("list", { name: "Verified lines" }), "a look's verified lines");
  await see(page.locator(".ss-tick").first(), "a tick on the scan timeline", "attached");
  await page.getByRole("button", { name: "Potential passes" }).click();
  await see(page.locator(".ss-board .ss-lane.chosen"), "his pick among the options", "attached");
  const next = page.getByRole("button", { name: "Next", exact: true });
  while (await next.isVisible()) await next.click();
  await see(page.getByRole("heading", { name: /His decision|The what-if/ }), "his decision");
  await see(page.locator(".ss-focus[data-focus]"), "the dimming round two players", "attached");
}

/** `?match=match-1&play=recap`: the end-of-match recap (SPEC 6), written offline here: the
 * full-time card on the live screen, the recap card with a Watch per key moment, and the reel's
 * captions once it plays. */
async function recap(page, shoot) {
  await match(page);
  await see(page.getByRole("region", { name: "Full time", exact: true }), "the full-time card");
  const card = page.getByRole("region", { name: "Full time · the recap" });
  await see(card.getByRole("button", { name: "Watch", exact: true }), "a key moment's Watch");
  await shoot("card");
  await page.getByRole("button", { name: "Play the recap reel" }).first().click();
  await see(page.locator(".recap-caption").filter({ hasText: /\S/ }), "a caption of the reel");
  await page.waitForTimeout(SETTLE);
}

/** A cold load (SPEC 2, 7): the intro card waits for the viewer, with nothing playing under it;
 * Watch the look opens door 1's story on the look, and its next step, within about 20 s, puts the
 * run without the look on screen with its line. The 20 s is for a viewer's machine. The app's
 * clock steps at most 0.1 s a frame (session.ts `startClock`), so where WebGL is drawn in software,
 * as on a CI runner (SwiftShader, about 0.5 s a frame), the look plays slower than the wall clock:
 * there the check is only that it gets there, and the time it took is printed. */
const COLD_LOAD_S = process.env.CI ? 120 : 22;
const CARD_WAITS_MS = 7000; // longer than the old card's 5 s countdown
const LOOK_S = 8; // a viewer watches the look before pressing Next

async function coldLoad(page, shoot) {
  const card = page.getByRole("dialog");
  await see(card, "the intro card");
  await page.waitForTimeout(CARD_WAITS_MS);
  if (!(await card.isVisible())) throw new Error("expected the intro card to wait for the viewer");
  const clock = (await page.locator(".transport .clock").first().textContent()) ?? "";
  if (!/frame 0\b/.test(clock)) {
    throw new Error(`expected the picture to rest on the first frame under the card: "${clock}"`);
  }
  await card.getByRole("button", { name: "Watch the look", exact: true }).click();
  const started = Date.now();
  const tourCard = page.getByRole("dialog").filter({ hasText: /^The look · 1 of / });
  await see(tourCard, "the quick tour's first step");
  await page.waitForTimeout(LOOK_S * 1000);
  await tourCard.getByRole("button", { name: "Next" }).click();
  const without = page
    .getByRole("group", { name: "Run" })
    .getByRole("button", { name: "Without the look", pressed: true });
  try {
    await without.waitFor({ timeout: COLD_LOAD_S * 1000 });
  } catch {
    throw new Error(`expected the run without the look on screen within ${COLD_LOAD_S} s of Start`);
  }
  const took = Math.round((Date.now() - started) / 1000);
  console.log(`     the run without the look ${took} s after Start (deadline ${COLD_LOAD_S} s)`);
  // The quick tour's card carries the step's verified lines (the caption stands down).
  await see(
    page.locator(".tour-card .tour-lines").filter({ hasText: /without that look/i }),
    'the "Without that look" line in the tour card',
  );
  await shoot(`at-${took}s`);
}

/** Door 1's story, the quick tour (SPEC 7): five steps, each card on screen with no sideways
 * scroll; the look in his eyes, the run without it, the board (with the scan story one link away),
 * the Verifier refusing a wrong number, then the end card: exactly three choices, of which Your
 * turn opens door 2's hub with the keyboard on its heading. */
async function quickTour(page, shoot) {
  const card = page.getByRole("dialog").filter({ hasText: /^The look · \d+ of 5/ });
  const expect = [
    ["Watch the look", () => mainView(page, "eyes")],
    [
      "Now remove it",
      () =>
        see(
          page.getByRole("group", { name: "Run" }).getByRole("button", {
            name: "Without the look",
            pressed: true,
          }),
          "the run without the look",
        ),
    ],
    [
      "Compare the outcomes",
      async () => {
        await mainView(page, "board");
        // One panel, clear of what it explains: the card leaves the board's pitch uncovered.
        const board = page.getByRole("figure", { name: "Tactical view from above" });
        const [a, b] = await Promise.all([
          board.locator("canvas").boundingBox(),
          card.boundingBox(),
        ]);
        const cover =
          a && b
            ? Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
              Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
            : 0;
        if (a && cover > 0.25 * a.width * a.height) {
          throw new Error(
            `expected the tour card clear of the board: it covers ${Math.round(cover)} px²`,
          );
        }
        await see(
          card.getByRole("button", { name: "Step through his looks" }),
          "the scan story, one link away from the compare",
        );
      },
    ],
    [
      "Every number is checked",
      () =>
        see(
          page.locator("section.evidence .tamper-result.held"),
          "the Verifier refusing the tour's wrong number",
        ),
    ],
    [
      "That's the look",
      async () => {
        const names = (await card.getByRole("button").allTextContents()).map((t) => t.trim());
        if (names.join("|") !== "Your turn|For studios|Watch again") {
          throw new Error(`expected the end card's three choices; got ${names.join(", ")}`);
        }
      },
    ],
  ];
  for (const [k, [title, shows]] of expect.entries()) {
    const step = card.filter({ hasText: new RegExp(`^The look · ${k + 1} of 5`) });
    await see(step.getByRole("heading", { name: title }), `the quick tour's step ${k + 1}`);
    await shows();
    if (await page.locator(".moment-card").isVisible()) {
      throw new Error("expected the moment card to stand down while the quick tour runs");
    }
    await cardOnScreen(page, step, k + 1);
    await shoot(`step-${k + 1}`);
    if (k < expect.length - 1) await step.getByRole("button", { name: "Next" }).click();
  }
  await card.getByRole("button", { name: "Your turn" }).click();
  try {
    await card.waitFor({ state: "detached" });
  } catch {
    throw new Error('expected "Your turn" to close the story');
  }
  await yourTurn(page);
  const focused = await page.evaluate(() => document.activeElement?.id);
  if (focused !== "turn-title")
    throw new Error(`expected the keyboard on Your turn, on ${focused}`);
}

/** Door 2, Your turn: its hub of three cards, the door marked; a card opens its mode as it is, and
 * closing the mode comes back to the hub with the keyboard on that card. */
async function yourTurn(page, { open = false } = {}) {
  await doorTabs(page, "Your turn");
  const hub = page.getByRole("region", { name: "Your turn." });
  await see(hub, "Your turn's hub");
  await see(hub.getByText("You are the player; see what he could see."), "its one line");
  const cards = hub.locator(".turn-card .turn-card-title");
  const titles = (await cards.allTextContents()).map((t) => t.trim());
  if (titles.join("|") !== "Make his call|See through his eyes|Train your scanning") {
    throw new Error(`expected the three cards; got ${titles.join(", ")}`);
  }
  if (!open) return;
  await page.locator("#turn-call").click();
  await see(page.getByRole("region", { name: "Your call" }), "Your call from its card");
  await page.getByRole("button", { name: "Back to the replay" }).click();
  await see(hub, "the hub again");
  const focused = await page.evaluate(() => document.activeElement?.id);
  if (focused !== "turn-call") throw new Error(`expected the keyboard on its card, on ${focused}`);
}

/** A tour card inside the screen, and no sideways scroll. */
async function cardOnScreen(page, card, k) {
  const [box, [w, h, wide]] = await Promise.all([
    card.boundingBox(),
    page.evaluate(() => [innerWidth, innerHeight, document.documentElement.scrollWidth]),
  ]);
  if (!box || box.x < 0 || box.y < 0 || box.x + box.width > w || box.y + box.height > h) {
    throw new Error(`expected the tour's step ${k} card on screen, got ${JSON.stringify(box)}`);
  }
  if (wide > w) throw new Error(`expected no sideways scroll at step ${k}: ${wide} px in ${w}`);
}

/** The intro card (SPEC 7): one line and one primary button ("Watch the look", or "Watch the
 * match"), clear of the picture; the line-ups behind "Teams and more". Shown, opened, closed with
 * `button`, then the page's main view. */
async function lineup(page, shoot, button, then) {
  const card = page.getByRole("dialog");
  await see(card, "the intro card");
  await see(
    card.getByRole("button", { name: /^Watch the (look|match)$/ }),
    "the card's one primary button",
  );
  if ((await card.locator(".btn-primary").count()) !== 1) {
    throw new Error("expected one primary button on the intro card");
  }
  await shoot("card");
  await card.getByRole("button", { name: "Teams and more" }).click();
  await see(
    card.getByRole("list", { name: "Kestrel Bay line-up" }),
    "the home line-up behind Teams and more",
  );
  await shoot("teams");
  await card.getByRole("button", { name: button, exact: true }).click();
  try {
    await card.first().waitFor({ state: "detached", timeout: 15_000 });
  } catch {
    throw new Error(`expected "${button}" to close the intro card`);
  }
  await then(page);
}

/** On a phone the page should scroll only up and down, and no two header controls (nor the run
 * switch over the picture) overlap or run off screen, with the live stream running (its status and the header's buttons are then all
 * there). `live: false` for a screen that takes the live screen's place (Take his eyes). */
async function phone(page, check, { live = true } = {}) {
  await check(page);
  if (live) {
    // A hero moment's header no longer shows the stream: the stage carries its state.
    await see(
      page.locator('.stage[data-stream="streaming"]'),
      "the live stream running",
      "attached",
    );
    // Once the lineup card is gone the header still says what this is (SPEC 0): name and note.
    await see(page.locator(".stage-head .brand h1"), "the product name in the header");
    // The note shows on a phone's header (up to 480 px); a tablet and a narrow desktop hide it.
    if ((page.viewportSize()?.width ?? 0) <= 480) {
      await see(
        page.locator(".stage-head .brand .sub").filter({ hasText: /synthetic match/i }),
        'the "synthetic match" note in the header',
      );
    }
  }
  const { wide, width, overlaps, offscreen } = await page.evaluate(() => {
    const root = document.documentElement;
    const wide = root.scrollWidth;
    const width = root.clientWidth;
    const found = [
      ...document.querySelectorAll(
        ".stage-head :is(.brand, .live-chip, .live-status, button, select, a.door-tab), .stage-run .seg",
      ),
    ].filter((el) => {
      if (el.closest(".popover")) return false;
      const rect = el.getBoundingClientRect();
      // 1 px or less: visually hidden for screen readers (the brand on a phone), not on screen.
      return rect.width > 1 && rect.height > 1 && getComputedStyle(el).visibility !== "hidden";
    });
    // A control that holds another is the other's box, not its own: keep the leaves.
    const controls = found.filter(
      (el) => !found.some((other) => other !== el && el.contains(other)),
    );
    const name = (el) => {
      const text = el.textContent.replace(/\s+/g, " ").trim();
      const hint = (text || el.getAttribute("aria-label") || "").slice(0, 14);
      return `${el.classList[0] ?? el.tagName.toLowerCase()} ${hint}`.trim();
    };
    const rects = controls.map((el) => el.getBoundingClientRect());
    const overlaps = [];
    for (let i = 0; i < controls.length; i++) {
      for (let j = i + 1; j < controls.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const across = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (across > 0.5 && down > 0.5)
          overlaps.push(`${name(controls[i])} x ${name(controls[j])}`);
      }
    }
    const offscreen = controls
      .filter((_, i) => rects[i].left < -0.5 || rects[i].right > width + 0.5)
      .map(name);
    return { wide, width, overlaps, offscreen };
  });
  if (wide > width) throw new Error(`scrolls sideways: ${wide} px wide in ${width} px`);
  if (overlaps.length) throw new Error(`header controls overlap: ${overlaps.join(", ")}`);
  if (offscreen.length) throw new Error(`header controls off screen: ${offscreen.join(", ")}`);
  await beliefLegend(page);
}

/** Beside his eyes (a tablet or a desktop: a phone has no picture in picture), each label of the
 * belief map's title and legend sits on one line inside the picture in picture: at 1280 px a
 * full-height disc left the legend a 71 px column and "His options" broke onto two lines. */
async function beliefLegend(page) {
  const broken = await page.evaluate(() => {
    const map = document.querySelector(".views .belief-map");
    const box = map?.getBoundingClientRect();
    if (!box || box.width < 1) return [];
    const out = [];
    const walk = document.createTreeWalker(map, NodeFilter.SHOW_TEXT);
    for (let node = walk.nextNode(); node; node = walk.nextNode()) {
      const text = node.textContent.trim();
      if (!text || !node.parentElement.closest(".belief-title, .belief-legend")) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      const lines = new Set(rects.map((r) => Math.round(r.top))).size;
      const r = range.getBoundingClientRect();
      if (lines > 1) out.push(`"${text}" on ${lines} lines`);
      else if (r.left < box.left - 0.5 || r.right > box.right + 0.5)
        out.push(`"${text}" cut at the edge (${Math.round(r.right - box.right)} px)`);
    }
    return out;
  });
  if (broken.length) throw new Error(`belief map legend: ${broken.join(", ")}`);
}

/** The match live, then each hero moment's breakdown from the Moments panel and back. */
async function breakdownsAndBack(page, shoot) {
  await match(page);
  await shoot("live");
  const open = page.getByRole("button", { name: "Breakdown", exact: true });
  const n = await open.count();
  if (n === 0) throw new Error("expected a Breakdown button in the Moments panel");
  for (let i = 0; i < n; i++) {
    await open.nth(i).click();
    await hero(page, { inMatch: true });
    await page.waitForTimeout(SETTLE);
    await shoot(`breakdown-${i + 1}`);
    await page.getByRole("button", { name: /Back to the match/ }).click();
    await match(page);
  }
  await page.waitForTimeout(SETTLE);
  await shoot("back");
}

/** Start the API offline on `url`'s port. `ready()` resolves once it is warm (/health answers);
 * `stop()` once it has exited. */
function startApi(url, cache) {
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !/^(FOUNDRY|AZURE|TTE)_/.test(name) && name !== "IDENTITY_ENDPOINT",
      ),
    ),
    APPLICATIONINSIGHTS_CONNECTION_STRING: "",
    TTE_MATCHES: MATCHES,
    TTE_CACHE_DIR: cache,
  };
  // --no-env-file: a UV_ENV_FILE in the shell must not bring the removed settings back.
  const args = ["run", "--no-env-file", "uvicorn", "api.main:app", "--port", new URL(url).port];
  const child = spawn("uv", args, { cwd: ROOT, env, detached: true, stdio: "pipe" });
  const log = createWriteStream(join(opt.out, "api.log"));
  // Two pipes into one file: neither may end it, or the other's last lines would be lost (or
  // written after the end). It is closed once the child has.
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.on("error", (err) => log.write(`could not start uv: ${err.message}\n`));
  const exited = new Promise((resolve) =>
    child.on("close", () => {
      log.end();
      resolve("exited");
    }),
  );
  // The group may already be gone (uv killed by a signal): then there is nothing to signal.
  const signal = (name) => {
    try {
      process.kill(-child.pid, name);
    } catch (err) {
      if (err.code !== "ESRCH") throw err;
    }
  };
  return {
    /** Last resort, synchronous (for an exit handler): kill the group at once. */
    kill() {
      if (child.pid && child.exitCode === null && child.signalCode === null) signal("SIGKILL");
    },
    // The whole process group (uv and uvicorn). Uvicorn heeds SIGTERM only once it is warm.
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
      signal("SIGTERM");
      const late = await Promise.race([exited, new Promise((r) => setTimeout(r, 5_000, "late"))]);
      if (late === "late") signal("SIGKILL");
      await exited;
    },
    async ready() {
      // The API loads all five matches before it opens the port (TTE_WARM): over 3 minutes on a loaded
      // runner (three smoke runs died on it on 2026-10-22/23).
      for (const deadline = Date.now() + 420_000; Date.now() < deadline;) {
        const up = await Promise.race([health(url), exited]);
        if (up === "exited") throw new Error(`the API exited: see ${join(opt.out, "api.log")}`);
        if (up) return up;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error("the API did not answer /health within 7 minutes");
    },
  };
}

/** The API's /health, or null while it does not answer. */
async function health(url) {
  try {
    const res = await fetch(new URL("/health", url), { signal: AbortSignal.timeout(2000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Open one page in a fresh context; resolves to its console errors and uncaught exceptions, and
 * notes (on the screenshots, and what a page reports without failing). */
async function visit(browser, base, page) {
  const context = await browser.newContext(page.device ?? DESKTOP);
  context.setDefaultTimeout(TIMEOUT);
  // The web fonts are the only requests outside this machine: answered empty, so a run needs no
  // network (text falls back to system fonts in the screenshots).
  const local = new Set([new URL(base).hostname, "localhost", "127.0.0.1"]);
  await context.route(
    (url) => !local.has(url.hostname),
    (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }),
  );
  const tab = await context.newPage();
  const errors = [];
  const notes = [];
  tab.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const where = msg.location().url;
    errors.push(`console error: ${msg.text()}${where ? ` (${where})` : ""}`);
  });
  // An uncaught exception fails the page at once: the checks would only time out after it.
  let fail = () => {};
  const thrown = new Promise((_, reject) => (fail = reject));
  thrown.catch(() => {});
  tab.on("pageerror", (err) => {
    errors.push(`uncaught: ${err.message}`);
    fail(new Error("stopped at an uncaught exception"));
  });
  tab.on("crash", () => {
    errors.push("the page crashed");
    fail(new Error("stopped at the crash"));
  });
  // Now and then, right after the app swaps screens, SwiftShader hands back a capture with only
  // the page's background in it while every check on the page passes; it is retaken once. The
  // screenshots are for people: no check looks at pixels. Finite CSS animations (a card coming in)
  // are run to their end first, so a screenshot shows the page at rest.
  const capture = (path) => tab.screenshot({ path, animations: "disabled" });
  const shoot = async (suffix) => {
    const name = `${page.name}${suffix ? `-${suffix}` : ""}.png`;
    if ((await capture(join(opt.out, name))).length >= BLANK) return;
    await tab.waitForTimeout(500);
    const again = await capture(join(opt.out, name));
    notes.push(`${name}: a blank capture, retaken${again.length < BLANK ? ", blank again" : ""}`);
  };
  try {
    if (page.init) await tab.addInitScript(page.init);
    await tab.goto(new URL(page.path, base).href);
    const checks = page.check(tab, shoot, (n) => notes.push(n));
    checks.catch(() => {}); // left behind if the page throws first
    await Promise.race([checks, thrown]);
    await Promise.race([tab.waitForTimeout(SETTLE), thrown]);
    // Accessibility (docs/ACCESSIBILITY.md): axe's WCAG 2.2 A/AA rules on the page as it is now.
    // A serious or critical violation fails the page; a lesser one is a note.
    const { violations } = await axe(tab, { tags: WCAG });
    const blocking = violations.filter((v) => BLOCKING.has(v.impact));
    for (const line of describe(blocking)) errors.push(`axe: ${line}`);
    for (const line of describe(violations.filter((v) => !blocking.includes(v)))) {
      notes.push(`axe: ${line}`);
    }
  } catch (err) {
    const text = await tab
      .locator("#root")
      .innerText({ timeout: 1000 })
      .catch(() => "");
    const shown = text.trim().replace(/\s+/g, " ").slice(0, 200) || "(an empty page)";
    errors.unshift(`${err instanceof Error ? err.message : String(err)}; the page shows: ${shown}`);
  } finally {
    await shoot("").catch(() => {});
    await context.close();
  }
  return { errors, notes };
}

mkdirSync(opt.out, { recursive: true });
const pages = PAGES.filter((p) => !opt.only || p.name.includes(opt.only));
if (!pages.length) throw new Error(`no page name contains "${opt.only}"`);
const t0 = performance.now();
const apiUrl = opt.api ?? "http://localhost:8765";
if (!opt.api && (await health(apiUrl))) {
  throw new Error(`an API already answers at ${apiUrl}: stop it, or pass --api ${apiUrl}`);
}
const tmp = mkdtempSync(join(tmpdir(), "tte-smoke-"));
const api = opt.api ? null : startApi(apiUrl, join(tmp, "cache"));
// Whoever ends this process (a signal handler of ours, Playwright's own, an uncaught error), the
// API's process group is killed and the temporary directory removed.
process.on("exit", () => {
  api?.kill();
  rmSync(tmp, { recursive: true, force: true });
});
for (const [name, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  process.on(name, async () => {
    try {
      await api?.stop();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      process.exit(code);
    }
  });
}
let server, browser;
let failed = 0;
try {
  // Build while the API warms up: VITE_API_URL is read at build time.
  process.env.VITE_API_URL = apiUrl;
  const dist = join(tmp, "dist");
  await build({ root: WEB, logLevel: "warn", build: { outDir: dist, emptyOutDir: true } });
  const up = api ? await api.ready() : await health(apiUrl);
  if (!up) throw new Error(`no API answers /health at ${apiUrl}`);
  console.log(`API ${apiUrl}: ${JSON.stringify(up)}`);
  server = await preview({
    root: WEB,
    configFile: false,
    logLevel: "error",
    build: { outDir: dist },
    preview: { port: 0 },
  });
  const base = server.resolvedUrls?.local[0];
  if (!base) throw new Error("the preview server has no local URL");
  browser = await launchChrome({ headless: !opt.headed });
  for (const page of pages) {
    const t = performance.now();
    const { errors, notes } = await visit(browser, base, page);
    const s = ((performance.now() - t) / 1000).toFixed(1);
    if (errors.length) failed++;
    console.log(`${errors.length ? "FAIL" : "ok  "} ${page.name} /${page.path} (${s} s)`);
    for (const e of errors) console.log(`       ${e}`);
    for (const n of notes) console.log(`       note: ${n}`);
  }
} finally {
  await browser?.close();
  await server?.close();
  try {
    await api?.stop();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
const total = ((performance.now() - t0) / 1000).toFixed(0);
console.log(
  `${pages.length - failed} of ${pages.length} pages passed in ${total} s; screenshots in ${opt.out}`,
);
process.exitCode = failed ? 1 : 0;
