// Verified numbers with presence (SPEC 7): a number counts up the first time it comes up, ends on
// exactly the verified text, carries a check stamp, and is read out only as the verified value.

import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { motion } from "../beat/beat";
import { countText, CountUp, forgetCounts } from "./CountUp";

afterEach(() => {
  motion.set({ reduced: false });
  forgetCounts();
});

describe("count-up", () => {
  it.each(["11 m", "0.13 xT", "0.3 metres", "+0.13", "−0.021", "45%", "0.80", "2 秒", "7"])(
    "ends on exactly the verified text: %s",
    (text) => {
      expect(countText(text, 1)).toBe(text);
    },
  );

  it("starts at zero and keeps the decimals and the unit on the way", () => {
    expect(countText("0.13 xT", 0)).toBe("0.00 xT");
    expect(countText("0.13 xT", 0.5)).toBe("0.06 xT"); // rounded down
    expect(countText("11 m", 0.5)).toBe("5 m");
    expect(countText("+0.13", 0.5)).toBe("+0.06");
    expect(countText("−0.021", 0.5)).toBe("−0.010");
  });

  it("never passes the verified value", () => {
    for (let p = 0; p <= 1; p += 0.01) {
      expect(Number(countText("0.13", p))).toBeLessThanOrEqual(0.13);
    }
  });

  it("leaves text without a number as it is", () => {
    expect(countText("a lot", 0.3)).toBe("a lot");
  });

  it("keeps the verified value as the page's text; the counting digits are drawn on top", () => {
    const html = renderToStaticMarkup(<CountUp text="0.3 metres" id="L3:0" />);
    expect(html).toBe(
      '<span class="count counting" data-count="0.0 metres">' +
        '<span class="count-value">0.3 metres</span></span>',
    );
  });

  it("shows the value and the stamp at once under reduced motion", () => {
    motion.set({ reduced: true });
    const html = renderToStaticMarkup(<CountUp text="0.3 metres" id="L3:0" />);
    expect(html).toContain('<span class="count done"><span class="count-value">0.3 metres</span>');
    expect(html).toContain('class="stamp" aria-hidden="true"');
  });
});
