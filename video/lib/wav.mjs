// WAV read and write. SFX are 24-bit PCM stereo; Azure's voice-over is 16-bit PCM mono.
// The trailer parses the RIFF header itself so a clip's length is known without ffprobe.

/**
 * @typedef {{
 *   format: number,
 *   channels: number,
 *   sampleRate: number,
 *   bits: number,
 *   frames: number,
 *   duration: number,
 *   samples: Float64Array[],
 * }} Wav
 */

/**
 * Parse a RIFF/WAVE buffer. Samples are floats in about [-1, 1].
 * @param {Buffer} buf
 * @returns {Wav}
 */
export function readWav(buf) {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a WAV file");
  }
  let format = 1;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  /** @type {Buffer | null} */
  let data = null;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > buf.length) break;
    if (id === "fmt ") {
      format = buf.readUInt16LE(start);
      channels = buf.readUInt16LE(start + 2);
      sampleRate = buf.readUInt32LE(start + 4);
      bits = buf.readUInt16LE(start + 14);
    } else if (id === "data") {
      data = buf.subarray(start, start + size);
      break;
    }
    offset = start + size + (size & 1);
  }
  if (!data || !channels || !sampleRate || !bits) throw new Error("WAV is missing fmt or data");
  if (format !== 1) throw new Error(`WAV format ${format} is not PCM`);
  const bytesPerFrame = channels * (bits / 8);
  if (!Number.isInteger(bytesPerFrame) || bytesPerFrame <= 0) throw new Error("WAV has a bad frame size");
  const frames = Math.floor(data.length / bytesPerFrame);
  const samples = Array.from({ length: channels }, () => new Float64Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const at = i * bytesPerFrame + c * (bits / 8);
      samples[c][i] = readSample(data, at, bits);
    }
  }
  return { format, channels, sampleRate, bits, frames, duration: frames / sampleRate, samples };
}

/** Duration in seconds, from the header alone. */
export function wavDuration(buf) {
  return readWav(buf).duration;
}

/**
 * 24-bit PCM stereo. `left` and `right` are floats in [-1, 1].
 * @param {Float64Array} left
 * @param {Float64Array} right
 * @param {number} sampleRate
 * @returns {Buffer}
 */
export function encodeWav24(left, right, sampleRate) {
  if (left.length !== right.length) throw new Error("stereo channels differ in length");
  return encodePcm([left, right], sampleRate, 24);
}

/**
 * 16-bit PCM mono, the shape Azure writes (24 kHz when we build a silent stand-in).
 * @param {Float64Array} samples
 * @param {number} sampleRate
 * @returns {Buffer}
 */
export function encodeWav16Mono(samples, sampleRate) {
  return encodePcm([samples], sampleRate, 16);
}

/**
 * @param {Float64Array[]} channels
 * @param {number} sampleRate
 * @param {16 | 24} bits
 */
function encodePcm(channels, sampleRate, bits) {
  const n = channels[0].length;
  const ch = channels.length;
  const bytesPerSample = bits / 8;
  const block = ch * bytesPerSample;
  const dataSize = n * block;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * block, 28);
  buf.writeUInt16LE(block, 32);
  buf.writeUInt16LE(bits, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  let o = 44;
  const full = bits === 16 ? 32767 : 8388607;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      writeSample(buf, o, channels[c][i], bits, full);
      o += bytesPerSample;
    }
  }
  return buf;
}

/** @param {Buffer} buf @param {number} at @param {number} bits */
function readSample(buf, at, bits) {
  if (bits === 16) return buf.readInt16LE(at) / 32767;
  if (bits === 24) {
    const n = buf[at] | (buf[at + 1] << 8) | (buf[at + 2] << 16);
    const signed = n & 0x800000 ? n - 0x1000000 : n;
    return signed / 8388607;
  }
  if (bits === 8) return (buf[at] - 128) / 128;
  throw new Error(`WAV sample width ${bits} is not supported`);
}

/** @param {Buffer} buf @param {number} at @param {number} sample @param {16 | 24} bits @param {number} full */
function writeSample(buf, at, sample, bits, full) {
  const clipped = Math.max(-1, Math.min(1, sample));
  let n = Math.round(clipped * full);
  if (bits === 16) {
    buf.writeInt16LE(n, at);
    return;
  }
  if (n < 0) n = 0x1000000 + n;
  buf[at] = n & 0xff;
  buf[at + 1] = (n >> 8) & 0xff;
  buf[at + 2] = (n >> 16) & 0xff;
}

/**
 * The speech in a synthesized line, without the silence Azure puts around it (about 0.15 s before
 * and 0.9 s after). Keeps `pad` seconds either side so no consonant is clipped. Mono or the first
 * channel decides; every channel is cut the same.
 * @param {{ samples: Float64Array[], sampleRate: number }} wav
 * @param {{ thresholdDb?: number, pad?: number }} [opts]
 * @returns {Float64Array[]}
 */
export function trimSilence(wav, { thresholdDb = -45, pad = 0.04 } = {}) {
  const x = wav.samples[0];
  const n = x.length;
  const win = Math.max(1, Math.round(wav.sampleRate * 0.01));
  const limit = Math.pow(10, thresholdDb / 20);
  // A 10 ms moving average of |x|, so a single click does not count as speech.
  const loud = (i) => {
    let sum = 0;
    const from = Math.max(0, i - win);
    const to = Math.min(n, i + win);
    for (let k = from; k < to; k++) sum += Math.abs(x[k]);
    return sum / (to - from) > limit;
  };
  let first = 0;
  while (first < n && !loud(first)) first += win;
  let last = n - 1;
  while (last > first && !loud(last)) last -= win;
  if (first >= n) return wav.samples.map((c) => c.slice(0, 0));
  const keep = Math.round(pad * wav.sampleRate);
  const from = Math.max(0, first - keep);
  const to = Math.min(n, last + keep);
  return wav.samples.map((c) => c.slice(from, to));
}
