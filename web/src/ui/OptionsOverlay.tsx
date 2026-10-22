// DOM layer of the pass options on the tactical board (SPEC 7): the hover card for the option
// under the pointer, and at the freeze the "he thought / it was" tag, both numbers from claims.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Vec2 } from "../data/types";
import {
  hoverContent,
  optionsVisible,
  passOptions,
  pickOption,
  thoughtVsWas,
  toPitch,
  toScreen,
  type PassOption,
} from "../options/passOptions";
import { useBreakdown, useSession } from "../session";
import { useStore } from "../store/store";
import { boardZoom } from "../views/scene";
import { KindTag } from "./Narration";
import { SourceChip } from "../provenance/SourceChip";

const PICK_PX = 10; // pointer tolerance

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export function OptionsOverlay() {
  const { hero, playback } = useSession();
  const { narration } = useBreakdown();
  const mode = useStore(playback, (s) => s.mode);
  const frame = useStore(playback, (s) => s.frame);
  const playing = useStore(playback, (s) => s.playing);
  const on = useStore(playback, (s) => s.options);
  const run = hero.runs[mode];
  const options = useMemo(() => passOptions(hero, run), [hero, run]);
  const verified = useMemo(() => thoughtVsWas(narration, hero, run), [narration, hero, run]);
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<{ option: PassOption; at: Vec2 } | null>(null);
  const zoom = boardZoom(w, h);
  const visible = on && !!run.decision && optionsVisible(frame, run.decision.frame);

  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const at: Vec2 = [e.clientX - r.left, e.clientY - r.top];
    const option = pickOption(toPitch(at, w, h, zoom), options, PICK_PX / zoom);
    setHover(option ? { option, at } : null);
  };

  const tagged = verified && options.find((o) => o.action === verified.action);
  const tagAt = tagged && toScreen(along(tagged, 0.62), w, h, zoom);

  return (
    <div
      ref={ref}
      className="options-overlay"
      style={{ pointerEvents: visible ? "auto" : "none" }}
      onPointerMove={pick}
      onPointerDown={pick}
      onPointerLeave={() => setHover(null)}
    >
      {visible && verified && tagAt && !playing && (
        <div
          className={`thought-tag kind-${verified.claim.kind}`}
          style={{ left: tagAt[0], top: tagAt[1] }}
        >
          <KindTag kind={verified.claim.kind} />
          <span>
            he thought <b>{verified.pBelief}</b> · it was <b>{verified.pTrue}</b>
          </span>
        </div>
      )}
      {visible && hover && <HoverCard hover={hover} width={w} height={h} verified={verified} />}
      {visible && (
        <p className="options-legend">
          Pass options: width = chance he picked it · brighter = more threat · dashed = on the truth
        </p>
      )}
    </div>
  );
}

/** A point `t` of the way along an option's line (its target for carry and shot). */
function along(o: PassOption, t: number): Vec2 {
  if (o.kind !== "pass") return o.target;
  return [o.from[0] + (o.target[0] - o.from[0]) * t, o.from[1] + (o.target[1] - o.from[1]) * t];
}

function HoverCard({
  hover,
  width,
  height,
  verified,
}: {
  hover: { option: PassOption; at: Vec2 };
  width: number;
  height: number;
  verified: ReturnType<typeof thoughtVsWas>;
}) {
  const content = hoverContent(hover.option, verified);
  const claimKind = content.rows.find((r) => r.source === "claim")?.kind;
  const anySim = content.rows.some((r) => r.source === "sim");
  const left = Math.min(hover.at[0] + 14, Math.max(8, width - 276));
  const above = hover.at[1] > height / 2; // open away from the nearer edge
  const style = above
    ? { left, top: hover.at[1] - 14, transform: "translateY(-100%)" }
    : { left, top: hover.at[1] + 14 };
  return (
    <div className="option-card" style={style} role="tooltip">
      <div className="option-title">
        {content.title}
        {content.chosen && <span className="chosen">chosen</span>}
      </div>
      <dl>
        {content.rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>
              {row.value}
              <SourceChip kind={row.source === "claim" ? "verified" : "sim"} />
            </dd>
          </div>
        ))}
      </dl>
      {claimKind && verified && (
        <p className="option-source">
          ✓ <KindTag kind={claimKind} /> claim <code>{verified.claim.id}</code>
        </p>
      )}
      {anySim && <p className="option-source">sim: read from the export, not verified</p>}
    </div>
  );
}
