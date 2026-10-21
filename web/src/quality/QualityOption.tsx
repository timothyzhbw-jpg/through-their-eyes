// The render quality switch in View options (quality.ts): the viewer's choice overrides the
// device's tier and a link's. The device's own tier is named, so the viewer knows what fits.

import { useMemo } from "react";
import { useStore } from "../store/store";
import { Segmented } from "../ui/Segmented";
import { autoTier, quality, setTier, type Tier } from "./quality";

const LABEL: Record<Tier, string> = {
  standard: "Classic",
  low: "Low",
  medium: "Medium",
  high: "High",
};

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
        title="Low, medium and high share one look and differ in sharpness and effects; classic is the earlier picture"
        options={[
          { value: "standard", label: LABEL.standard, title: "The earlier picture" },
          { value: "low", label: LABEL.low, title: "The look, drawn straight to the screen" },
          { value: "medium", label: LABEL.medium, title: "Also smoothing and depth of field" },
          { value: "high", label: LABEL.high, title: "Also ambient occlusion and lamp bloom" },
        ]}
      />
      <p className="note">This device: {LABEL[device].toLowerCase()}</p>
    </section>
  );
}
