// The sponsor slot's three sponsors: invented for the demo, with simple generated wordmarks (a
// geometric mark and the name in the board font). No real brand, product or logo is meant or
// echoed; the slot says "Fictional sponsor" on every screen.

export type SponsorMark = "wave" | "chevron" | "leaf";

export interface Sponsor {
  id: string;
  name: string; // the wordmark, in capitals
  line: string; // a strapline with no digits
  bg: string;
  fg: string;
  accent: string;
  mark: SponsorMark;
}

export const SPONSORS: readonly Sponsor[] = [
  {
    id: "kelpstone",
    name: "KELPSTONE FERRIES",
    line: "Every crossing, every crowd",
    bg: "#0d2230",
    fg: "#e8f1f4",
    accent: "#58b7c9",
    mark: "wave",
  },
  {
    id: "krelwick",
    name: "KRELWICK OATS",
    line: "Breakfast for the long game",
    bg: "#2a1d0e",
    fg: "#f6ecd9",
    accent: "#e0a64a",
    mark: "leaf",
  },
  {
    id: "tallowglass",
    name: "TALLOWGLASS LAMPS",
    line: "Light the far post",
    bg: "#1d1830",
    fg: "#efeaf8",
    accent: "#a99be6",
    mark: "chevron",
  },
];

export const FICTIONAL_SPONSOR = "Fictional sponsor";
