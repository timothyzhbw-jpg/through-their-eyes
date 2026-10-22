// Fictional names for the synthetic players and the two clubs (SPEC 4.6, 7), mirrored from
// sim/roster.py; tests/test_roster_web.py fails when the two drift. Presentation only: the data
// keeps the ids (H8, A5) and the teams (0 home, 1 away). Narration from the service names them
// already (agents/context.py); the app names them wherever it writes an id itself.

export const ROSTER: Readonly<Record<string, readonly [string, string]>> = {
  H1: ["Bram", "Oystervelt"],
  H2: ["Tiago", "Marrenko"],
  H3: ["Sully", "Brannagh"],
  H4: ["Kofi", "Annersley"],
  H5: ["Dario", "Velkamp"],
  H6: ["Emre", "Saltonby"],
  H7: ["Rui", "Castellane"],
  H8: ["Joss", "Ferriday"],
  H9: ["Nico", "Varnhall"],
  H10: ["Lio", "Brackwell"],
  H11: ["Sami", "Okondru"],
  A1: ["Henrik", "Talvisto"],
  A2: ["Yusuf", "Pellard"],
  A3: ["Marek", "Undholm"],
  A4: ["Ossian", "Grevholt"],
  A5: ["Teo", "Mardelius"],
  A6: ["Bastien", "Coulvard"],
  A7: ["Ilyas", "Fenmore"],
  A8: ["Caio", "Brunvald"],
  A9: ["Matteo", "Quillan"],
  A10: ["Jory", "Kestrell"],
  A11: ["Anders", "Vintergren"],
};

/** Home (team 0) and away (team 1): name, three-letter code, Chinese name. Invented. */
export const CLUBS: Readonly<Record<0 | 1, { name: string; code: string; zh: string }>> = {
  0: { name: "Kestrel Bay", code: "KES", zh: "红隼湾" },
  1: { name: "Corvane Vale", code: "COR", zh: "科尔瓦恩谷" },
};

/** "J. Ferriday"; an id with no name (a stand-in in a test) is itself. */
export function shortName(id: string): string {
  const found = ROSTER[id];
  return found ? `${found[0].charAt(0)}. ${found[1]}` : id;
}

/** "Joss Ferriday"; an id with no name is itself. */
export function fullName(id: string): string {
  const found = ROSTER[id];
  return found ? `${found[0]} ${found[1]}` : id;
}

/** "Kestrel Bay" for the home side (team 0), "Corvane Vale" away. */
export function clubName(team: number): string {
  return CLUBS[team === 1 ? 1 : 0].name;
}

// A player id as a whole token (sim/roster.py `rename_ids`): not inside a word, a number or an
// event id (scan:H8:0050); a CJK character next to it is a boundary.
const ID = /(?<![A-Za-z0-9_:])[HA](?:1[01]|[1-9])(?![A-Za-z0-9_:])/g;

/** Every player id in `text` as his short name: for words the app writes with ids in them. */
export function renameIds(text: string): string {
  return text.replace(ID, (id) => shortName(id));
}
