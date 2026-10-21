// The render quality switch in View options (quality.ts): the viewer's choice overrides the
// device's tier and a link's. The device's own tier is named, so the viewer knows what fits.

import { useMemo } from "react";
import { useStore } from "../store/store";
import { Segmented } from "../ui/Segmented";
import { autoTier, quality, setTier, type Tier } from "./quality";

const LABEL: Record<Tier, string> = { standard: "Standard", medium: "Medium", high: "High" };

export function QualityOption() {
  const tier = useStore(quality, (s) => s.tier);
  const device = useMemo(autoTier, []);
  return (
    <section className="options-group">
      <h3 className="kicker">Render quality</h3>
      <Segmented<Tier>
        label="Render quality"
        className="quality"
        value={tier}
        onPick={(t) => setTier(t, "viewer")}
        title="Medium: bloom, depth of field in the slow motion, image-based light. High: also ambient occlusion and soft shadows"
        options={[
          { value: "standard", label: LABEL.standard, title: "Drawn straight to the screen" },
          {
            value: "medium",
            label: LABEL.medium,
            title: "Bloom, depth of field, image-based light",
          },
          { value: "high", label: LABEL.high, title: "Also ambient occlusion and soft shadows" },
        ]}
      />
      <p className="note">This device: {LABEL[device].toLowerCase()}</p>
    </section>
  );
}
