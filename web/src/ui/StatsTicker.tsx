// The stats ticker over the live screen (SPEC 4.6, 7): the in-view tags as text, on every camera.
// A hero moment shows them for what happened; the other run keeps the picture clear of them.

import { useView } from "../session";
import { statTags, type StatTag, type Stats } from "../stats/stats";
import { useStats } from "../stats/store";
import { useStore } from "../store/store";
import { SourceChip } from "../provenance/SourceChip";
import { computed } from "../provenance/source";

const MAX = 4;

/** `owner[frame]`, held inside the run when the playhead sits outside it. */
function ownerAt(owner: ArrayLike<number>, frame: number): number {
  const n = owner.length;
  if (n === 0) return -1;
  const f = Math.floor(frame);
  const i = f < 0 ? 0 : f >= n ? n - 1 : f;
  return owner[i];
}

function shown(stats: Stats, frame: number, owner: ArrayLike<number>): StatTag[] {
  return statTags(stats, frame, ownerAt(owner, frame)).slice(0, MAX);
}

/** A stable line for the live region: the label and the player's name, no speed or distance. */
function spoken(tag: StatTag, name: string): string {
  if (tag.kind === "name" || tag.kind === "distance") return name;
  return `${tag.label} ${name}`.trim();
}

export function StatsTicker() {
  const view = useView();
  const { stats } = useStats();
  const owner = view.hero.runs.factual.owner;
  const key = useStore(view.playback, (s) => {
    if (!stats) return "";
    if (view.kind === "hero" && s.mode !== "factual") return "×";
    return shown(stats, s.frame, owner)
      .map((t) => `${t.kind}|${t.player}|${t.label}|${t.text}`)
      .join("\n");
  });
  if (!stats || key === "×") return null;
  const tags = shown(stats, view.playback.get().frame, owner);
  const names = stats.players;
  return (
    <div className="stage-ticker">
      {tags.map((tag) => (
        <span
          key={`${tag.kind}-${tag.player}-${tag.label}`}
          className="stat-chip"
          data-kind={tag.kind}
          aria-hidden="true"
        >
          <b>{tag.label}</b> {tag.text}{" "}
          <SourceChip
            kind="tracking"
            title={computed(
              "Measured from the match's tracking and event feed (analytics/stats.py)",
            )}
          />
        </span>
      ))}
      <span className="sr-only" aria-live="polite">
        {tags.map((tag) => spoken(tag, names.get(tag.player)?.name ?? "")).join(", ")}
      </span>
    </div>
  );
}
