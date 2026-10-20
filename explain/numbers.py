"""Number detection for the render check (SPEC 5.3: number words count as digits).

A caption may contain a number only where a verified slot put it. This module finds every
number in a caption, in any language:
- digits: any Unicode decimal digit run (ASCII, full-width), with decimals ("0.4", "41");
- English number words: cardinals zero–nineteen, the tens, hundred/thousand/million/billion,
  nil, once/twice/thrice, dozen, half/halves, quarter, ordinals from third up;
- Chinese numerals followed by a measure word (三次, 两名, 五米, 十五秒, 第三次, 半秒), and
  一半 / 半数.

Idioms that contain a number word but state no quantity are allowlisted: SPEC's 一个, 一脚,
一眼, 一下, plus a few more listed below. "first" and "second" are not flagged at all: in
football they are mostly idioms (first touch, first-time pass, second ball) or a unit.
A token inside an allowlisted phrase is ignored; a longer number that merely contains one
(十一个) is still a number.
"""

from __future__ import annotations

import re
from typing import NamedTuple

# fmt: off
ONES = (
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
    "nineteen",
)
TENS = ("twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety")
_ORDINALS = (
    "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh",
    "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth",
    "nineteenth", "twentieth", "thirtieth", "fortieth", "fiftieth", "sixtieth", "seventieth",
    "eightieth", "ninetieth", "hundredth", "thousandth",
)
_OTHER = (
    "hundred", "hundreds", "thousand", "thousands", "million", "millions", "billion", "billions",
    "nil", "once", "twice", "thrice", "dozen", "dozens", "half", "halves", "quarter", "quarters",
)
# fmt: on
EN_WORDS = re.compile(r"\b(?:" + "|".join(ONES + TENS + _ORDINALS + _OTHER) + r")\b", re.IGNORECASE)
EN_ALLOW = re.compile(
    r"\bno one\b|\bone another\b|\bone-twos?\b|\bone-touch\b|\bhalf-spaces?\b|\bhalf-turns?\b"
    r"|\bhalf-time\b|\bhalf-volleys?\b|\bthird[- ]man\b",
    re.IGNORECASE,
)

DIGITS = re.compile(r"\d+(?:[.,]\d+)*")

ZH_NUMERALS = "零〇一二两三四五六七八九十百千万亿"
# fmt: off
ZH_MEASURES = sorted((
    "次", "名", "个", "位", "人", "米", "秒", "分", "分钟", "秒钟", "小时", "公里", "千米",
    "公尺", "脚", "眼", "下", "步", "码", "度", "倍", "成", "场", "回", "遍", "球", "粒",
    "号", "记", "趟", "拍",
), key=len, reverse=True)
# fmt: on
ZH_NUMBER = re.compile(
    rf"(?P<ord>第)?(?P<num>[半{ZH_NUMERALS}][{ZH_NUMERALS}几多余来]*)\s*"
    rf"(?:{'|'.join(ZH_MEASURES)})"
)
ZH_EXTRA = re.compile(r"一半|半数")
ZH_ALLOW = re.compile(r"一个|一脚|一眼|一下|上一次|下一次|十分(?!钟)|半场|第三人")


class NumberToken(NamedTuple):
    start: int
    end: int
    text: str
    kind: str  # "digit" | "en_word" | "zh_numeral"
    num_start: int  # the numeral itself, without 第 or the measure word
    num_end: int


def number_tokens(text: str) -> list[NumberToken]:
    allowed = [m.span() for p in (EN_ALLOW, ZH_ALLOW) for m in p.finditer(text)]
    tokens = [
        NumberToken(m.start(), m.end(), m[0], "digit", *m.span()) for m in DIGITS.finditer(text)
    ]
    tokens += [
        NumberToken(m.start(), m.end(), m[0], "en_word", *m.span()) for m in EN_WORDS.finditer(text)
    ]
    tokens += [
        NumberToken(m.start(), m.end(), m[0], "zh_numeral", *m.span("num"))
        for m in ZH_NUMBER.finditer(text)
    ]
    tokens += [
        NumberToken(m.start(), m.end(), m[0], "zh_numeral", *m.span())
        for m in ZH_EXTRA.finditer(text)
    ]
    kept = [t for t in tokens if not any(a <= t.start and t.end <= b for a, b in allowed)]
    return sorted(kept, key=lambda t: (t.start, t.end))
