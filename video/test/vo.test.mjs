// SSML for Azure: escape the line, and turn the one allowed markup into a break.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSsml, estimateSpeechSeconds, trailerVoiceFilters, voiceFor, voRoomWarnings } from "../lib/vo.mjs";

const voice = { name: "en-US-DavisNeural", lang: "en-US", rate: "-6%", pitch: "-6%", fx: "trailer" };

test("SSML escapes text and turns a pause into a break", () => {
  const ssml = buildSsml({
    text: `A & B <tag> "q" 's' [pause 400]`,
    voice,
    style: "whispering",
    degree: 1.4,
  });
  assert.equal(
    ssml,
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
      `xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">` +
      `<voice name="en-US-DavisNeural">` +
      `<mstts:express-as style="whispering" styledegree="1.4">` +
      `<prosody rate="-6%" pitch="-6%">A &amp; B &lt;tag&gt; &quot;q&quot; &apos;s&apos; <break time="400ms"/></prosody>` +
      `</mstts:express-as></voice></speak>`,
  );
});

test("a line with no style has no express-as wrapper", () => {
  const ssml = buildSsml({ text: "Look.", voice });
  assert.equal(ssml.includes("express-as"), false);
  assert.match(ssml, /<prosody rate="-6%" pitch="-6%">Look\.<\/prosody>/);
});

test("another language uses its own voice and keeps the main rate", () => {
  const zh = voiceFor(
    { voice, voices: { zh: { name: "zh-CN-YunxiNeural", lang: "zh-CN" } } },
    "zh",
  );
  assert.equal(zh.name, "zh-CN-YunxiNeural");
  assert.equal(zh.lang, "zh-CN");
  assert.equal(zh.rate, "-6%");
  assert.equal(voiceFor({ voice }, "en").name, voice.name);
});

test("a planned length counts words and pauses", () => {
  assert.equal(estimateSpeechSeconds("Off by {belief_error.err}."), 1.6);
  assert.equal(estimateSpeechSeconds("Wait [pause 400] now."), 0.4 + 2 / 2.5);
});

test("the trailer voice chain lowers the pitch without changing the tempo", () => {
  const chain = trailerVoiceFilters();
  assert.match(chain, /asetrate=46080/);
  assert.match(chain, /atempo=1\.041667/);
  assert.match(chain, /highpass=f=70/);
  assert.match(chain, /equalizer=f=120/);
  assert.match(chain, /acompressor=/);
  assert.match(chain, /aecho=/);
});

test("a line longer than the room before the next line is a warning", () => {
  const warnings = voRoomWarnings([
    { id: "vo01", beat: "b01-open", beatStart: 0, beatDur: 2, at: 0.3, duration: 3 },
    { id: "vo02", beat: "b02-cine", beatStart: 2, beatDur: 2, at: 0.1, duration: 0.4 },
  ]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /vo "vo01"/);
  assert.match(warnings[0], /next line \(vo02\)/);
});
