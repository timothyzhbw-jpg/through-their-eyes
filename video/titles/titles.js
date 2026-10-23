// Title runtime (SPEC 10). Each template page defines build(params). setup() paints
// the stage and waits for the local fonts; seek(t) pauses every animation and parks
// it at t seconds. No timers, no clock, no randomness: the same t is the same frame.
(() => {
  "use strict";

  const SVG = "http://www.w3.org/2000/svg";
  const COLORS = {
    chalk: "#efede5",
    gold: "#f6d566",
    dusk: "#95a7ba",
    flare: "#ef774b",
  };
  const OUTS = new Set(["cut", "fade", "wipe", "slam-out"]);
  const ALIGNS = new Set(["center", "left", "lower-left"]);
  const TILTS = ["-5deg", "-3deg", "-1.5deg", "1.5deg", "3deg", "5deg"];
  const SLANT = Math.tan((12 * Math.PI) / 180);

  function num(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    const n = typeof value === "number" ? value : Number(String(value).trim());
    return Number.isFinite(n) ? n : fallback;
  }

  function flag(value) {
    if (value === true) return true;
    if (typeof value === "string") {
      const s = value.trim().toLowerCase();
      return s === "true" || s === "yes" || s === "1";
    }
    return false;
  }

  function paint(name, fallback = "chalk") {
    const key = String(name || fallback).trim().toLowerCase();
    return COLORS[key] || COLORS[fallback] || COLORS.chalk;
  }

  function seconds(value) {
    return `${Math.round(value * 1000) / 1000}s`;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function setAt(node, t) {
    node.style.setProperty("--at", seconds(t));
  }

  function svg(tag, attrs) {
    const node = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  }

  function prepare(layout, align) {
    const stage = document.getElementById("stage");
    if (!stage) throw new Error("title page has no stage");
    stage.replaceChildren();
    if (layout) stage.dataset.layout = layout;
    else delete stage.dataset.layout;
    if (align) stage.dataset.align = align;
    else delete stage.dataset.align;
    return stage;
  }

  function list(value, max) {
    return Array.isArray(value) ? value.slice(0, max) : [];
  }

  async function fontsReady() {
    const anton = await document.fonts.load("16px Anton");
    const bebas = await document.fonts.load('16px "Bebas Neue"');
    if (!anton.length || !bebas.length) throw new Error("title fonts did not load");
    await document.fonts.ready;
  }

  function icon(kind) {
    const root = svg("svg", {
      viewBox: "0 0 80 80",
      fill: "none",
      stroke: "#efede5",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
    });
    const add = (tag, attrs) => root.append(svg(tag, attrs));
    const gold = "#f6d566";
    if (kind === "director") {
      add("path", { d: "M16 28 H28 M16 28 V40" });
      add("path", { d: "M64 28 H52 M64 28 V40" });
      add("path", { d: "M16 64 H28 M16 64 V52" });
      add("path", { d: "M64 64 H52 M64 64 V52" });
      add("path", { d: "M24 24 H58", stroke: gold });
      add("path", { d: "M26 24 L56 15", stroke: gold });
    } else if (kind === "analyst") {
      add("path", { d: "M16 58 V46 M28 58 V34 M40 58 V42" });
      add("circle", { cx: "50", cy: "32", r: "12" });
      add("path", { d: "M58 40 L70 52", stroke: gold });
    } else if (kind === "telestrator") {
      add("path", { d: "M12 56 H68" });
      add("path", { d: "M12 56 V48 M40 56 V50 M68 56 V48" });
      add("path", { d: "M18 50 C30 28 46 26 58 18", stroke: gold });
      add("path", { d: "M50 20 L60 16 L54 28", stroke: gold });
    } else if (kind === "narrator") {
      add("path", { d: "M14 18 H62 V46 H36 L24 58 V46 H14 Z" });
      add("path", { d: "M24 28 H52", stroke: gold });
      add("path", { d: "M24 36 H44" });
    } else if (kind === "verifier") {
      add("path", { d: "M40 12 L64 22 V40 C64 54 40 68 40 68 C40 68 16 54 16 40 V22 Z" });
      add("path", { d: "M28 40 L36 48 L54 30", stroke: gold });
    } else if (kind === "voice") {
      add("path", { d: "M16 34 H26 L38 22 V58 L26 46 H16 Z" });
      add("path", { d: "M46 32 Q52 40 46 48", stroke: gold });
      add("path", { d: "M52 26 Q62 40 52 54" });
      add("path", { d: "M58 20 Q72 40 58 60", stroke: gold });
    } else {
      add("circle", { cx: "40", cy: "40", r: "18", stroke: gold });
    }
    return root;
  }

  function checkMark() {
    const root = svg("svg", { viewBox: "0 0 64 64", fill: "none", "aria-hidden": "true" });
    root.append(
      svg("path", {
        d: "M12 34 L26 48 L54 16",
        stroke: "#f6d566",
        "stroke-width": "7",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
    );
    return root;
  }

  function crossMark() {
    const root = svg("svg", { viewBox: "0 0 64 64", fill: "none", "aria-hidden": "true" });
    root.append(
      svg("path", {
        d: "M10 10 L54 54 M54 10 L10 54",
        stroke: "#ef774b",
        "stroke-width": "8",
        "stroke-linecap": "round",
      }),
    );
    return root;
  }

  function arrowMark() {
    const root = svg("svg", { viewBox: "0 0 120 64", fill: "none", "aria-hidden": "true" });
    root.append(
      svg("path", {
        d: "M8 32 H96",
        stroke: "#f6d566",
        "stroke-width": "4",
        "stroke-linecap": "round",
      }),
      svg("path", {
        d: "M74 14 L104 32 L74 50",
        fill: "none",
        stroke: "#f6d566",
        "stroke-width": "4",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
    );
    return root;
  }

  function kinetic(params, options = {}) {
    const align = ALIGNS.has(params.align) ? params.align : "center";
    const stage = prepare(null, align);
    if (options.flood) stage.append(el("div", "flood"), el("div", "beam"));

    const lines = list(params.lines, 3);
    const stagger = num(params.stagger, 0.35);
    const hold = num(params.hold, 60);
    const out = OUTS.has(params.out) ? params.out : "fade";
    const kicker = params.kicker ? String(params.kicker) : "";
    const sub = params.sub ? String(params.sub) : "";
    const lead = kicker ? 0.22 : 0;
    const lastStart = lines.length ? lead + (lines.length - 1) * stagger : 0;
    const stackH =
      lines.reduce((sum, line) => sum + num(line && line.size, 150) * 0.9, 0) +
      (kicker ? 56 : 0) +
      (sub ? 72 : 0) +
      24;

    const outAt = seconds(lastStart + 0.16 + hold);
    if (flag(params.backdrop)) {
      const backdrop = el("div", `backdrop out-${out}`);
      backdrop.style.setProperty("--out-at", outAt);
      backdrop.style.setProperty("--slant", `${Math.round(1080 * SLANT)}px`);
      stage.append(backdrop);
    }

    const stack = el("div", `stack out-${out}`);
    stack.style.setProperty("--out-at", outAt);
    stack.style.setProperty("--slant", `${Math.round(Math.max(stackH, 80) * SLANT)}px`);

    if (kicker) {
      const node = el("div", "kicker bebas fx-wipe", kicker);
      setAt(node, 0);
      node.style.setProperty("--slant", `${Math.round(36 * SLANT)}px`);
      stack.append(node);
    }

    lines.forEach((line, i) => {
      const at = lead + i * stagger;
      const text = line && line.text != null ? String(line.text) : "";
      const row = el("div", "line");
      const head = el("div", "headline anton fx-slam-chroma", text);
      head.style.fontSize = `${num(line && line.size, 150)}px`;
      head.style.color = paint(line && line.color, "chalk");
      setAt(head, at);
      row.append(head);
      stack.append(row);
    });

    const rule = el("i", "underline");
    setAt(rule, lastStart + 0.1);
    stack.append(rule);

    if (sub) {
      const node = el("div", "sub bebas fx-slam", sub);
      setAt(node, lastStart + 0.22);
      stack.append(node);
    }
    stage.append(stack);
  }

  function freeze(params) {
    const stage = prepare(null, null);
    const wrap = el("div", "freeze");
    if (params.title) {
      const title = el("div", "freeze-title bebas fx-wipe", params.title);
      setAt(title, 0);
      title.style.setProperty("--slant", `${Math.round(40 * SLANT)}px`);
      wrap.append(title);
    }
    const items = list(params.items, 2);
    const bracket = el("div", "bracket");
    for (const name of ["tl", "tr", "bl", "br"]) bracket.append(el("i", `corner ${name}`));
    const row = el("div", items.length > 1 ? "stat-row pair" : "stat-row");
    items.forEach((item, i) => {
      const stat = el("div", "stat");
      const numRow = el("div", "stat-num");
      const value = el("div", "stat-value anton fx-slam", item && item.value != null ? item.value : "");
      value.style.color = paint(item && item.color, "gold");
      setAt(value, 0.12 + i * 0.12);
      numRow.append(value);
      if (item && item.unit) {
        const unit = el("div", "stat-unit bebas fx-fade", item.unit);
        setAt(unit, 0.18 + i * 0.12);
        numRow.append(unit);
      }
      stat.append(numRow);
      if (item && item.label) {
        const label = el("div", "stat-label bebas fx-fade", item.label);
        setAt(label, 0.2 + i * 0.12);
        stat.append(label);
      }
      row.append(stat);
    });
    bracket.append(row);
    wrap.append(bracket);
    stage.append(wrap);
  }

  function verified(params) {
    const stage = prepare(null, flag(params.backdrop) ? "left" : null);
    // backdrop: a dark gradient behind the lines, for a busy picture underneath.
    if (flag(params.backdrop)) stage.append(el("div", "backdrop fx-fade"));
    const wrap = el("div", "verified");
    if (params.kicker) {
      const kicker = el("div", "kicker bebas fx-wipe", params.kicker);
      setAt(kicker, 0);
      kicker.style.setProperty("--slant", `${Math.round(36 * SLANT)}px`);
      wrap.append(kicker);
    }
    const items = list(params.items, 4);
    const stagger = num(params.stagger, 0.45);
    const lineBase = 0.2;
    const stampBase = lineBase + Math.max(items.length, 1) * stagger + 0.12;
    items.forEach((item, i) => {
      const line = el("div", "v-line bebas fx-line");
      setAt(line, lineBase + i * stagger);
      if (item && item.before) line.append(el("span", "v-before", item.before));
      const hold = el("span", "val-wrap");
      const value = el("span", "v-value anton", item && item.value != null ? item.value : "");
      hold.append(value);
      const stampAt = stampBase + i * 0.32;
      const ring = el("i", "ring");
      setAt(ring, stampAt + 0.1);
      const mark = el("span", "mark");
      setAt(mark, stampAt);
      mark.append(checkMark());
      // The stamp lands after the line, never over the number, so the value stays readable.
      const stampBox = el("span", "stamp-box");
      stampBox.append(ring, mark);
      line.append(hold);
      if (item && item.after) line.append(el("span", "v-after", item.after));
      line.append(stampBox);
      wrap.append(line);
    });
    // note: one plain line under the checked lines (what a unit means), no number of its own.
    if (params.note) {
      const note = el("div", "v-note bebas fx-fade", params.note);
      setAt(note, lineBase + items.length * stagger);
      wrap.append(note);
    }
    stage.append(wrap);
  }

  function refuted(params) {
    const stage = prepare(null, null);
    const wrap = el("div", "refuted");
    if (params.kicker) {
      const kicker = el("div", "kicker bebas fx-wipe", params.kicker);
      setAt(kicker, 0);
      kicker.style.setProperty("--slant", `${Math.round(36 * SLANT)}px`);
      wrap.append(kicker);
    }
    const line = el("div", "refuted-line anton fx-slam-chroma");
    setAt(line, 0.16);
    if (params.before) line.append(el("span", "before", params.before));
    line.append(el("span", "value", params.value != null ? params.value : ""));
    if (params.after) line.append(el("span", "after", params.after));
    const strike = el("i", "strike");
    setAt(strike, 0.7);
    line.append(strike);
    wrap.append(line);
    if (params.stamp) {
      const label = el("div", "stamp-label bebas", params.stamp);
      setAt(label, 0.92);
      wrap.append(label);
    }
    stage.append(wrap);
    const cross = el("div", "big-x");
    setAt(cross, 0.5);
    cross.append(crossMark());
    stage.append(cross);
  }

  function lineup(params) {
    const stage = prepare("free", null);
    stage.append(el("div", "pitch-lines"), el("div", "flood"));
    const header = el("h1", "crew-head anton fx-slam-chroma", params.header || "");
    setAt(header, 0);
    stage.append(header);
    const row = el("div", "crew-row");
    const stagger = num(params.stagger, 0.18);
    const start = num(params.start, 0.16); // when the first card lands, s
    const highlight = params.highlight ? String(params.highlight).trim() : "";
    list(params.cards, 6).forEach((card, i) => {
      const name = card && card.name != null ? String(card.name) : "";
      const on = highlight !== "" && name.trim() === highlight;
      const node = el("article", on ? "crew-card highlight" : "crew-card");
      const at = start + i * stagger;
      setAt(node, at);
      node.style.setProperty("--tilt", TILTS[i] || "-4deg");
      node.style.setProperty("--ty", on ? "-28px" : "0px");
      node.style.setProperty("--scale", on ? "1.04" : "1");
      node.style.zIndex = on ? "8" : String(i + 1);
      node.append(el("div", "edge"));
      const glyph = el("div", "glyph");
      glyph.append(icon(card && card.glyph));
      const job = el("div", "crew-job bebas", card && card.job != null ? card.job : "");
      node.append(glyph, el("div", "crew-name anton", name), job);
      row.append(node);
    });
    stage.append(row);
  }

  function redcard(params) {
    const stage = prepare("free", null);
    const card = el("div", "red-card");
    card.append(el("div", "inner"), el("div", "pip"));
    stage.append(card);
    const copy = el("div", "red-copy");
    const title = el("div", "headline anton fx-slam-chroma", params.title || "");
    setAt(title, 0.7);
    const sub = el("div", "sub bebas fx-slam", params.sub || "");
    setAt(sub, 0.9);
    copy.append(title, sub);
    stage.append(copy);
  }

  function subboard(params) {
    const stage = prepare(null, null);
    const board = el("div", "board");
    board.append(el("div", "edge"));
    const row = el("div", "sub-row");

    function panel(role, word, at) {
      const node = el("div", "led-panel");
      setAt(node, at);
      const kicker = el("div", `led-kicker bebas ${role}`, role === "off" ? "OFF" : "ON");
      const glow = el("div", "led-glow");
      const led = el("div", `led bebas ${role}`, word || "");
      glow.append(led);
      node.append(kicker, glow);
      return node;
    }

    row.append(panel("off", params.off, 0.12));
    const arrow = el("div", "sub-arrow");
    setAt(arrow, 0.4);
    arrow.append(arrowMark());
    row.append(arrow);
    row.append(panel("on", params.on, 0.52));
    board.append(row);
    if (params.caption) {
      const caption = el("div", "sub-caption bebas fx-fade", params.caption);
      setAt(caption, 0.86);
      board.append(caption);
    }
    stage.append(board);
  }

  function tag(params) {
    const stage = prepare("free", null);
    const wrap = el("div", "tag");
    const bar = el("div", "tag-bar");
    const text = el("span", "tag-text bebas fx-slam", params.text || "");
    setAt(text, 0.16);
    bar.append(text);
    wrap.append(bar);
    if (params.sub) {
      const sub = el("div", "tag-sub bebas fx-slam", params.sub);
      setAt(sub, 0.3);
      wrap.append(sub);
    }
    stage.append(wrap);
  }

  function spec(params) {
    const stage = prepare("free", null);
    // backdrop: the sheet over a picture (the crew trace), dark on the left where the rows are;
    // the page drops its own opaque ground so the picture shows through on the right.
    if (flag(params.backdrop)) {
      document.documentElement.classList.replace("opaque", "alpha");
      stage.append(el("div", "spec-backdrop fx-fade"));
    }
    const sheet = el("div", "sheet");
    const head = el("h1", "spec-head anton fx-slam", params.header || "");
    setAt(head, 0);
    sheet.append(head, el("i", "spec-rule"));
    const rows = list(params.rows, 10);
    const two = rows.length > 10; // one column up to ten rows: the stack reads top to bottom
    const cols = el("div", two ? "spec-cols two" : "spec-cols");
    const per = two ? Math.ceil(rows.length / 2) : rows.length;
    const columns = [rows.slice(0, per), two ? rows.slice(per) : []].filter((col) => col.length);
    let index = 0;
    for (const group of columns) {
      const col = el("div", "spec-col");
      for (const item of group) {
        const at = 0.28 + index * 0.08;
        index += 1;
        const row = el("div", "spec-row fx-wipe");
        setAt(row, at);
        row.style.setProperty("--slant", "16px");
        row.append(el("span", "scan"));
        row.append(el("span", "spec-label bebas", item && item.label != null ? item.label : ""));
        row.append(el("span", "spec-value anton", item && item.value != null ? item.value : ""));
        if (item && item.note) row.append(el("span", "spec-note bebas", item.note));
        col.append(row);
      }
      cols.append(col);
    }
    sheet.append(cols);
    if (params.footer) {
      const foot = el("div", "spec-foot bebas fx-fade", params.footer);
      setAt(foot, 0.36 + rows.length * 0.08);
      sheet.append(foot);
    }
    stage.append(sheet);
  }

  function end(params) {
    const stage = prepare(null, null);
    stage.append(el("div", "flood"));
    const wrap = el("div", "end-card");
    const name = el("div", "end-name anton fx-slam-chroma", params.name || "");
    setAt(name, 0);
    const rule = el("i", "underline");
    setAt(rule, 0.16);
    wrap.append(name, rule);
    if (params.tagline) {
      const tagline = el("div", "end-tag bebas fx-fade", params.tagline);
      setAt(tagline, 0.42);
      wrap.append(tagline);
    }
    if (params.url) {
      const url = el("div", "end-url bebas fx-fade", params.url);
      setAt(url, 0.62);
      wrap.append(url);
    }
    // qr: the demo's address as a QR code (qrcode-generator, drawn in the page), under cta.
    if (params.qr && typeof window.qrcode === "function") {
      const code = window.qrcode(0, "M");
      code.addData(String(params.qr));
      code.make();
      const box = el("div", "end-qr fx-fade");
      if (params.cta) box.append(el("div", "end-cta bebas", params.cta));
      const square = el("div", "qr-square");
      square.innerHTML = code.createSvgTag({ cellSize: 8, margin: 16, scalable: true });
      box.append(square);
      setAt(box, 0.62);
      stage.append(box);
    }
    const lines = list(params.lines, 8);
    if (lines.length) {
      const block = el("div", "end-lines");
      lines.forEach((line, i) => {
        const credit = el("div", "credit bebas fx-fade", line);
        setAt(credit, 0.95 + i * 0.16);
        block.append(credit);
      });
      wrap.append(block);
    }
    // Credit lines a licence requires word for word, in smaller type under the others.
    const legal = list(params.legal, 4);
    if (legal.length) {
      const block = el("div", "end-legal");
      legal.forEach((line) => block.append(el("div", "legal bebas fx-fade", line)));
      setAt(block, 0.95 + lines.length * 0.16);
      for (const node of block.children) setAt(node, 0.95 + lines.length * 0.16);
      wrap.append(block);
    }
    stage.append(wrap);
  }

  function countdown(params) {
    const stage = prepare(null, null);
    const secs = Math.max(0.05, num(params.secs, 4));
    const wrap = el("div", "count");
    const label = el("div", "count-label anton fx-slam-chroma", params.label || "");
    setAt(label, 0);
    const ring = el("div", "count-ring");
    ring.append(el("div", "count-halo"));
    const picture = svg("svg", { viewBox: "0 0 280 280", "aria-hidden": "true" });
    const radius = 112;
    const girth = 2 * Math.PI * radius;
    picture.append(
      svg("circle", {
        cx: "140",
        cy: "140",
        r: String(radius),
        fill: "none",
        stroke: "rgba(149, 167, 186, 0.4)",
        "stroke-width": "10",
      }),
    );
    const arc = svg("circle", {
      cx: "140",
      cy: "140",
      r: String(radius),
      fill: "none",
      stroke: "#f6d566",
      "stroke-width": "10",
      "stroke-linecap": "round",
      transform: "rotate(-90 140 140)",
    });
    arc.style.strokeDasharray = `${girth}px`;
    arc.style.strokeDashoffset = "0px";
    picture.append(arc);
    ring.append(picture);
    wrap.append(label, ring);
    if (params.sub) {
      const sub = el("div", "count-sub bebas fx-fade", params.sub);
      setAt(sub, 0.18);
      wrap.append(sub);
    }
    stage.append(wrap);
    arc.animate([{ strokeDashoffset: "0px" }, { strokeDashoffset: `${girth}px` }], {
      duration: secs * 1000,
      easing: "linear",
      fill: "both",
    });
  }

  // Burned-in caption of a voice-over line: one or two lines in a dark box low in the frame (in
  // the 2.39:1 bar where there is one), numbers in gold. Centred, or on the right with
  // `side: "right"` when a title holds the lower left. Fades in, and out at `dur`.
  function caption(params) {
    const stage = prepare("free", null);
    const right = params.side === "right";
    const box = el("div", right ? "cap cap-right" : params.side === "top" ? "cap cap-top" : "cap");
    const line = el("p", "cap-text bebas");
    for (const part of String(params.text || "").split(/(\d+(?:[.,]\d+)?)/)) {
      if (!part) continue;
      line.append(/^\d/.test(part) ? el("span", "cap-num", part) : document.createTextNode(part));
    }
    box.append(line);
    stage.append(box);
    const dur = num(params.dur, 2);
    // The centred box is placed with translateX(-50%), so the rise keeps it; the right and top
    // boxes are placed by their edges.
    const x = right || params.side === "top" ? "0" : "-50%";
    const rise = [
      { opacity: 0, transform: `translate(${x}, 10px)` },
      { opacity: 1, transform: `translate(${x}, 0)` },
    ];
    box.animate(rise, {
      duration: 140,
      easing: "ease-out",
      fill: "both",
    });
    box.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 160,
      delay: Math.max(0, dur * 1000 - 160),
      easing: "linear",
      fill: "forwards",
    });
  }

  // A small, steady corner label, e.g. "IN-ENGINE · RENDERED FROM OUR SIMULATION DATA" over the
  // cinematic shots, so no one mistakes them for the app's screens.
  function label(params) {
    const stage = prepare("free", null);
    const corner = params.corner === "top-left" ? "corner-label corner-tl bebas" : "corner-label bebas";
    stage.append(el("div", corner, params.text || ""));
  }

  // Freeze-frame name card: everything but the player drops about a stop under a scrim with a
  // clear circle at `spot`, and the card slams in over two frames. Hard in, hard out: the clip
  // simply ends at its length.
  function namecard(params) {
    const stage = prepare("free", null);
    const spot = params.spot || {};
    const x = num(spot.x, 960);
    const y = num(spot.y, 540);
    const r = num(spot.r, 160);
    const scrim = el("div", "nc-scrim");
    const dark = Math.min(1, Math.max(0, num(params.scrim, 0.5)));
    scrim.style.background = `radial-gradient(circle at ${x}px ${y}px, transparent ${r}px, rgba(8, 14, 11, ${dark}) ${Math.round(r * 1.5)}px)`;
    const card = el("div", params.side === "right" ? "nc-card nc-right" : "nc-card");
    const head = el("div", "nc-head anton");
    head.append(el("span", "nc-name", params.name || ""));
    if (params.role) head.append(el("span", "nc-role", ` · ${params.role}`));
    card.append(head, el("span", "nc-rule"));
    if (params.sub) card.append(el("div", "nc-sub bebas", params.sub));
    stage.append(scrim, card);
    card.animate([{ transform: "scale(1.12)" }, { transform: "scale(1)" }], {
      duration: 66,
      easing: "linear",
      fill: "both",
    });
  }

  // Chapter card: a small Floodlight label and the title in Anton on Night, no motion, so it cuts
  // in and out hard on a downbeat.
  function chapter(params) {
    const stage = prepare("free", null);
    const box = el("div", "chapter");
    box.append(el("div", "chapter-label bebas", params.label || ""), el("div", "chapter-title anton", params.title || ""));
    stage.append(box);
  }

  // Labels for a split-screen beat: the left half's in Floodlight, the right half's in Dusk.
  function duo(params) {
    const stage = prepare("free", null);
    stage.append(el("div", "duo duo-left bebas", params.left || ""), el("div", "duo duo-right bebas", params.right || ""));
  }

  window.__titleBuild = {
    kinetic,
    freeze,
    verified,
    refuted,
    lineup,
    redcard,
    subboard,
    tag,
    spec,
    end,
    countdown,
    caption,
    label,
    namecard,
    chapter,
    duo,
  };

  window.__title = {
    ready: false,
    _pending: null,
    _token: null,
    async setup(params) {
      this.ready = false;
      const token = {};
      this._token = token;
      const build = globalThis.build;
      if (typeof build !== "function") throw new Error("title page has no build(params)");
      build(params || {});
      await fontsReady();
      if (this._token !== token) return;
      void document.documentElement.offsetWidth;
      this.ready = true;
      if (this._pending != null) {
        const t = this._pending;
        this._pending = null;
        this.seek(t);
      }
    },
    seek(t) {
      if (!this.ready) {
        this._pending = t;
        return;
      }
      const ms = Number(t) * 1000;
      void document.documentElement.offsetWidth;
      const anims = document.getAnimations();
      for (const anim of anims) anim.pause();
      for (const anim of anims) anim.currentTime = ms;
    },
  };

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.source !== "tte-gallery") return;
    if (data.type === "setup") void window.__title.setup(data.params);
    else if (data.type === "seek") window.__title.seek(data.t);
  });
})();
