// "unseen 1.4 s" tags of the blind-side alerts on the tactical board (SPEC 4.4, 7), for the POV
// player's own alerts. A live deterministic overlay: marked `sim`, not a verified claim.

import { useEffect, useMemo, useRef, useState } from "react";
import { alertsAt, unseenLabel } from "../alerts/blindSide";
import { useView } from "../session";
import { useStore } from "../store/store";
import { boardZoom } from "../views/scene";
import { Sample, sampleInto } from "../data/hero";
import { toScreen } from "../options/passOptions";
import { shortName } from "../data/roster";
import { SourceChip } from "../provenance/SourceChip";

export function BlindSideOverlay() {
  const { hero, playback } = useView();
  const frame = useStore(playback, (s) => s.frame);
  const mode = useStore(playback, (s) => s.mode);
  const on = useStore(playback, (s) => s.blindSide);
  const povPlayer = useStore(playback, (s) => s.povPlayer);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const sample = useMemo(() => new Sample(hero.n), [hero]);
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

  const run = hero.runs[mode];
  const me = hero.ids.indexOf(povPlayer);
  const mine = on ? alertsAt(hero, run, frame).filter((a) => a.observer === me) : [];
  sampleInto(sample, hero, run, frame);
  const zoom = boardZoom(size.w, size.h);
  return (
    <div ref={ref} className="blind-side-overlay" aria-live="off">
      {mine.map((a) => {
        const [x, y] = toScreen(
          [sample.pos[2 * a.target], sample.pos[2 * a.target + 1]],
          size.w,
          size.h,
          zoom,
        );
        return (
          <div key={a.target} className="blind-tag" style={{ left: x, top: y }}>
            <b>{shortName(hero.ids[a.target])}</b> {unseenLabel(a.unseen)}
            <SourceChip
              kind="tracking"
              title="Live overlay from tracking (head yaw and positions), not a verified claim"
            />
          </div>
        );
      })}
    </div>
  );
}
