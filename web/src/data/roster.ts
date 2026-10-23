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
  1: { name: "Corvane Vale", code: "COR", zh: "科尔文谷" },
};

/** Each surname as Chinese text and the zh voice write it (sim/roster.py `ZH_NAMES`, Xinhua style):
 * a Chinese line says 费里迪, never "J. Ferriday". */
export const ZH_NAMES: Readonly<Record<string, string>> = {
  H1: "奥伊斯特维尔特",
  H2: "马伦科",
  H3: "布兰纳",
  H4: "安纳斯利",
  H5: "韦尔坎普",
  H6: "索尔顿比",
  H7: "卡斯特兰",
  H8: "费里迪",
  H9: "瓦恩霍尔",
  H10: "布拉克韦尔",
  H11: "奥孔德鲁",
  A1: "塔尔维斯托",
  A2: "佩拉德",
  A3: "温德霍尔姆",
  A4: "格雷夫霍尔特",
  A5: "马德利乌斯",
  A6: "库尔瓦尔",
  A7: "芬莫尔",
  A8: "布伦瓦尔德",
  A9: "奎兰",
  A10: "凯斯特雷尔",
  A11: "温特格伦",
};

export type NameLanguage = "en" | "zh";

/** "J. Ferriday"; "费里迪" in Chinese; an id with no name (a stand-in in a test) is itself. */
export function shortName(id: string, lang: NameLanguage = "en"): string {
  if (lang === "zh" && ZH_NAMES[id]) return ZH_NAMES[id];
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

const HAN = /\p{Script=Han}/u;

/** Every player id in `text` as his short name: for words the app writes with ids in them. A
 * Chinese sentence (`lang`, by default: any Han character in it) names him in Chinese. */
export function renameIds(text: string, lang?: NameLanguage): string {
  const as = lang ?? (HAN.test(text) ? "zh" : "en");
  return text.replace(ID, (id) => shortName(id, as));
}
