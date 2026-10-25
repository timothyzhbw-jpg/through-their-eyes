// Numbers in a verified line (SPEC 5.3, the Floodlit design): every digit on air was slot-filled
// from a verified value, so each number, with its unit, gets the dotted Floodlight underline.
// Player ids such as H8 are names, not numbers.

import { describe, expect, it } from "vitest";
import { numberParts } from "./numbers";

const nums = (text: string) =>
  numberParts(text)
    .filter((p) => p.num)
    .map((p) => p.text);

describe("numbers in a line", () => {
  it("marks each number with its unit and leaves the rest of the line as it is", () => {
    const text = "H8 scanned once in the 2 seconds before receiving.";
    expect(numberParts(text)).toEqual([
      { text: "H8 scanned once in the ", num: false },
      { text: "2 seconds", num: true },
      { text: " before receiving.", num: false },
    ]);
    expect(
      numberParts(text)
        .map((p) => p.text)
        .join(""),
    ).toBe(text);
  });

  it("reads the units the narration uses", () => {
    expect(
      nums(
        "H8's picture of H9 was off by 0.3 metres. Without that look, it would have been off by 12.3 metres.",
      ),
    ).toEqual(["0.3 metres", "12.3 metres"]);
    expect(nums("H8 found H9 with a 42-metre pass.")).toEqual(["42-metre"]);
    expect(nums("H8 saw 64% of the space the opponents controlled.")).toEqual(["64%"]);
    expect(nums("That look was worth 0.1 in expected threat.")).toEqual(["0.1"]);
    expect(nums("a 0.80 chance of arriving; it was 0.90.")).toEqual(["0.80", "0.90"]);
    expect(nums("He shot from 18 m at 1.4 s.")).toEqual(["18 m", "1.4 s"]);
    expect(nums("worth +0.10 xT")).toEqual(["+0.10 xT"]);
  });

  it("never marks a player id", () => {
    expect(nums("H9 took the pass from H8.")).toEqual([]);
    expect(nums("A5 closed H4 down")).toEqual([]);
  });

  it("reads Chinese narration too", () => {
    expect(nums("接球前2秒内，H8回头观察了1次。")).toEqual(["2秒", "1次"]);
    expect(nums("那一眼带来了0.10的预期威胁。")).toEqual(["0.10"]);
  });

  it("returns one plain part for a line without numbers", () => {
    expect(numberParts("What did he see?")).toEqual([{ text: "What did he see?", num: false }]);
    expect(numberParts("")).toEqual([]);
  });
});
