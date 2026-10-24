export type Language = "en" | "zh";

export interface GlossaryTerm {
  id: string;
  label: Record<Language, string>;
  aliases: Record<Language, readonly string[]>;
  definition: Record<Language, string>;
  analyst?: Record<Language, string>;
}

export const TERMS: readonly GlossaryTerm[] = [
  {
    id: "high-press",
    label: { en: "High press", zh: "高位逼抢" },
    aliases: { en: ["high press", "high pressing"], zh: ["高位逼抢", "高位压迫"] },
    definition: {
      en: "Pressure high up the pitch, near the opponent's goal, to win the ball back early.",
      zh: "在靠近对方球门的位置集体上前施压，争取尽早夺回球权。",
    },
    analyst: {
      en: "For analysts: the press is coordinated across the team, not one player chasing the ball.",
      zh: "进阶理解：强调整条线一起前移和协同封堵，而不是单个球员追着球跑。",
    },
  },
  {
    id: "counter-press",
    label: { en: "Counter-press", zh: "反抢" },
    aliases: {
      en: ["counter-press", "counterpress", "counter-pressing"],
      zh: ["反抢", "就地反抢", "丢球反抢"],
    },
    definition: {
      en: "Press immediately after losing the ball, before the opponent can settle.",
      zh: "丢球后马上就地施压，趁对方阵脚未稳把球权夺回来。",
    },
  },
  {
    id: "low-block",
    label: { en: "Low block", zh: "低位防守" },
    aliases: { en: ["low block", "low-block defending"], zh: ["低位防守", "低位防守阵型"] },
    definition: {
      en: "A compact defence that drops back near its own penalty area to protect the goal.",
      zh: "防线整体回撤到本方禁区附近，保持紧凑，压缩身后空间。",
    },
  },
  {
    id: "pressing-trigger",
    label: { en: "Pressing trigger", zh: "逼抢信号" },
    aliases: {
      en: ["pressing trigger", "press trigger"],
      zh: ["逼抢信号", "上抢信号", "逼抢触发点"],
    },
    definition: {
      en: "An agreed cue, such as a slow pass, that tells the team to start pressing together.",
      zh: "全队约定的上抢时机，比如对手回传或停球失误，信号一出就一起施压。",
    },
  },
  {
    id: "ppda",
    label: { en: "PPDA", zh: "PPDA" },
    aliases: { en: ["PPDA"], zh: ["PPDA"] },
    definition: {
      en: "Opponent passes allowed per defensive action; lower usually means a stronger press.",
      zh: "每次防守动作前让对方完成的传球数，数值越低通常代表逼抢越强。",
    },
    analyst: {
      en: "For analysts: compare its exact defensive-action definition before comparing teams or models.",
      zh: "进阶理解：比较数据前要先看防守动作的统计口径，不同口径不能直接横比。",
    },
  },
  {
    id: "regain",
    label: { en: "Regain", zh: "夺回球权" },
    aliases: {
      en: ["regain", "regains", "ball recovery", "ball recoveries"],
      zh: ["夺回球权", "球权夺回", "抢回球权"],
    },
    definition: {
      en: "Winning possession back from the opponent.",
      zh: "从对手脚下赢回球权。",
    },
  },
  {
    id: "transition",
    label: { en: "Transition", zh: "攻防转换" },
    aliases: { en: ["transition", "transitions"], zh: ["攻防转换", "攻守转换"] },
    definition: {
      en: "The phase just after possession changes, when a team switches between attack and defence.",
      zh: "球权易手后，球队由攻转守或由守转攻的阶段。",
    },
  },
  {
    id: "counter-attack",
    label: { en: "Counter-attack", zh: "快速反击" },
    aliases: {
      en: ["counter-attack", "counterattack", "counter-attacks", "counterattacks"],
      zh: ["快速反击", "反击"],
    },
    definition: {
      en: "A fast attack after winning the ball, while the opponent is still getting back.",
      zh: "夺回球权后趁对方还没回防，快速向前发动进攻。",
    },
  },
  {
    id: "half-space",
    label: { en: "Half-space", zh: "肋部" },
    aliases: {
      en: ["half-space", "half space", "half-spaces", "half spaces"],
      zh: ["肋部", "半空间"],
    },
    definition: {
      en: "The channel between the centre and the wing.",
      zh: "球场上中路与边路之间的纵向通道。",
    },
    analyst: {
      en: "For analysts: receiving between lines here can give a passer a diagonal view of the pitch.",
      zh: "进阶理解：球员在肋部两线之间接球，往往能获得斜向观察和出球的角度。",
    },
  },
  {
    id: "final-third",
    label: { en: "Final third", zh: "前场三区" },
    aliases: { en: ["final third", "attacking third"], zh: ["前场三区", "进攻三区"] },
    definition: {
      en: "The third of the pitch nearest the opponent's goal.",
      zh: "靠近对方球门的最后三分之一球场。",
    },
  },
  {
    id: "xg",
    label: { en: "Expected goals (xG)", zh: "预期进球" },
    aliases: { en: ["xG", "expected goals"], zh: ["预期进球"] },
    definition: {
      en: "An estimate of how likely a shot is to score, based on factors such as its location.",
      zh: "根据射门位置等因素，估算一脚射门转化为进球的可能性。",
    },
    analyst: {
      en: "For analysts: a shot's xG is a probability before the outcome, not a promise of a goal.",
      zh: "进阶理解：预期进球是射门结果发生前的概率估计，不代表这脚球必进或必不进。",
    },
  },
  {
    id: "xt",
    label: { en: "Expected threat (xT)", zh: "预期威胁" },
    aliases: { en: ["xT", "expected threat"], zh: ["预期威胁"] },
    definition: {
      en: "A value for how dangerous a team's possession is from where the ball is.",
      zh: "预期威胁衡量球队在当前控球位置继续进攻、最终取得进球的价值。",
    },
    analyst: {
      en: "For analysts: moving to a higher-xT zone adds threat; losing the ball can hand threat over.",
      zh: "进阶理解：把球推进到更高威胁区域会增加价值，丢球则可能把进攻机会交给对手。",
    },
  },
  {
    id: "pitch-control",
    label: { en: "Pitch control", zh: "场地控制" },
    aliases: { en: ["pitch control"], zh: ["场地控制", "区域控制"] },
    definition: {
      en: "Which team is more likely to get to and control the ball in each area of the pitch.",
      zh: "衡量球场上各个位置更可能由哪支球队先拿到并控制住球。",
    },
  },
  {
    id: "scan",
    label: { en: "Scan", zh: "扭头观察" },
    aliases: {
      en: ["scan", "scans", "scanned", "scanning"],
      zh: ["扭头观察", "回头观察", "观察身后"],
    },
    definition: {
      en: "A quick look away from the ball to check teammates, opponents and space.",
      zh: "接球或处理球前快速扭头，查看周围的队友、对手和空间。",
    },
  },
  {
    id: "body-orientation",
    label: { en: "Body orientation / half-turn", zh: "身体朝向与半转身" },
    aliases: {
      en: ["body orientation", "half-turn", "half turn", "half-turns"],
      zh: ["身体朝向", "半转身"],
    },
    definition: {
      en: "How a player faces; a half-turn is side-on, helping them see the ball and the pitch.",
      zh: "身体朝向决定接球时的视野；半转身就是侧身站位，方便同时照顾来球和场上局面。",
    },
  },
  {
    id: "blind-side",
    label: { en: "Blind side", zh: "盲侧" },
    aliases: { en: ["blind side", "blind-side"], zh: ["盲侧", "视野盲区", "身后盲区"] },
    definition: {
      en: "The area behind or outside a player's view, where an opponent can move unseen.",
      zh: "球员身后或视线之外的区域，对手常从这里悄悄前插。",
    },
  },
  {
    id: "overload",
    label: { en: "Overload", zh: "局部人数优势" },
    aliases: { en: ["overload", "overloads"], zh: ["局部人数优势", "人数优势"] },
    definition: {
      en: "More players than the opponent in one area, creating a spare player.",
      zh: "在局部区域集中比防守方更多的球员，形成空出来的接应点。",
    },
  },
  {
    id: "line-breaking-pass",
    label: { en: "Line-breaking pass", zh: "穿线传球" },
    aliases: {
      en: [
        "line-breaking pass",
        "line breaking pass",
        "line-breaking passes",
        "line breaking passes",
        "line-breaking",
        "line breaking",
      ],
      zh: ["穿线传球", "破线传球", "穿透防线传球"],
    },
    definition: {
      en: "A pass that takes the ball beyond a line of defenders to a teammate.",
      zh: "一脚传球越过一道防守线，把球送到防线身后的队友脚下。",
    },
  },
  {
    id: "set-piece",
    label: { en: "Set piece", zh: "定位球" },
    aliases: { en: ["set piece", "set-piece", "set pieces", "set-pieces"], zh: ["定位球"] },
    definition: {
      en: "A restart from a still ball, such as a corner or free kick.",
      zh: "比赛从静止球重新开始的情境，比如角球和任意球。",
    },
  },
  {
    id: "marking",
    label: { en: "Marking", zh: "盯人" },
    aliases: { en: ["marking", "man-marking", "man marking"], zh: ["盯人", "盯防"] },
    definition: {
      en: "Following an assigned opponent to limit their space, movement and chances to receive.",
      zh: "防守球员跟住指定对手，限制他的跑动和接球空间。",
    },
  },
];

export const TERM_BY_ID = new Map(TERMS.map((term) => [term.id, term]));
