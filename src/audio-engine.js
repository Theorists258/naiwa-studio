import { MAX_TEMPO, MIN_TEMPO, SAMPLE_LIBRARY, STEP_COUNT } from './music.js';

const MASTER_GAIN = 0.8;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const number = (value, fallback) => Number.isFinite(value) ? value : fallback;

export function semitoneToPlaybackRate(semitones = 0) {
  if (!Number.isFinite(semitones) || Math.abs(semitones) > 96) throw new Error('音高超出支持范围。');
  return 2 ** (semitones / 12);
}

export function getStepDuration(tempo) {
  if (!Number.isFinite(tempo) || tempo < MIN_TEMPO || tempo > MAX_TEMPO) throw new Error(`速度应在 ${MIN_TEMPO}–${MAX_TEMPO} BPM 之间。`);
  return 60 / tempo / 4;
}

export function resolveTrim(buffer, trimStart = 0, trimEnd = null) {
  const duration = buffer.duration;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('音源为空。');
  const start = clamp(number(trimStart, 0), 0, duration);
  const end = trimEnd == null ? duration : clamp(number(trimEnd, duration), 0, duration);
  if (end <= start) throw new Error('裁切范围为空，请调整起点和终点。');
  return { start, end, duration: end - start };
}

export function compileSequence({ tracks, tempo, bars = 1 }) {
  const stepDuration = getStepDuration(tempo);
  if (!Array.isArray(tracks)) throw new Error('音轨列表无效。');
  if (!Number.isInteger(bars) || bars < 1 || bars > 64) throw new Error('导出长度应为 1–64 个小节。');
  const events = [];
  for (let beat = 0; beat < STEP_COUNT * bars; beat += 1) {
    const step = beat % STEP_COUNT;
    for (const track of tracks) {
      const note = track.steps?.[step];
      if (!note || track.muted || track.mute) continue;
      events.push({
        time: beat * stepDuration, step, trackId: track.id, sampleId: track.sampleId,
        pitch: number(track.pitch, 0) + number(note.pitch, 0),
        volume: clamp(number(track.volume, 1), 0, 1),
        velocity: clamp(number(note.velocity, 1), 0, 1),
        trimStart: number(track.trimStart, 0), trimEnd: track.trimEnd ?? null,
      });
    }
  }
  return { events, duration: STEP_COUNT * bars * stepDuration, stepDuration };
}

/** Encode interleaved signed 16-bit PCM. Attenuate the entire mix only if necessary. */
export function audioBufferToWav(buffer, { peakLimit = 0.98 } = {}) {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const rate = buffer.sampleRate;
  if (!Number.isInteger(channels) || channels < 1 || channels > 8 || !Number.isInteger(frames) || frames < 0 || !Number.isFinite(rate) || rate <= 0) throw new Error('导出音频数据无效。');
  const data = Array.from({ length: channels }, (_, index) => buffer.getChannelData(index));
  let peak = 0;
  for (const channel of data) for (const sample of channel) if (Number.isFinite(sample)) peak = Math.max(peak, Math.abs(sample));
  const limit = clamp(number(peakLimit, 0.98), 0.01, 1);
  const scale = peak > limit ? limit / peak : 1;
  const bytes = new ArrayBuffer(44 + frames * channels * 2);
  const view = new DataView(bytes);
  const text = (offset, value) => { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, frames * channels * 2, true);
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const value = clamp(number(data[channel][frame], 0) * scale, -1, 1);
      view.setInt16(offset, Math.round(value * (value < 0 ? 32768 : 32767)), true);
      offset += 2;
    }
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

export class AudioEngine {
  constructor({ onStep = () => {}, contextFactory, offlineContextFactory, fetcher } = {}) {
    this.onStep = onStep;
    this.contextFactory = contextFactory;
    this.offlineContextFactory = offlineContextFactory;
    this.fetcher = fetcher ?? ((...args) => globalThis.fetch(...args));
    this.context = null;
    this.master = null;
    this.buffers = new Map();
    this.loads = new Map();
    this.sampleInputs = new Map();
    this.samples = new Map(SAMPLE_LIBRARY.map((sample) => [sample.id, sample]));
    this.activeVoices = new Set();
    this.tracks = [];
    this.tempo = 120;
    this.isPlaying = false;
    this.currentStep = -1;
    this.nextStep = 0;
    this.nextNoteTime = 0;
    this.stepQueue = [];
    this.runToken = 0;
    this.schedulerTimer = null;
    this.visualTimer = null;
    this.lastStepTime = null;
  }

  get audioContext() { return this.context; }
  get ctx() { return this.context; }

  _getContext() {
    if (!this.context) {
      const Constructor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!this.contextFactory && !Constructor) throw new Error('当前浏览器不支持 Web Audio，请使用较新的浏览器。');
      this.context = this.contextFactory ? this.contextFactory() : new Constructor();
      this.master = this.context.createGain();
      this.master.gain.value = MASTER_GAIN;
      this.master.connect(this.context.destination);
    }
    return this.context;
  }

  async resume() {
    const context = this._getContext();
    if (context.state === 'suspended') await context.resume();
    return context;
  }

  _registerSamples(samples) {
    if (!Array.isArray(samples)) return;
    for (const sample of samples) {
      const previous = this.samples.get(sample.id);
      const next = { ...sample, url: sample.url ?? sample.dataUrl };
      if (!sample.buffer && previous && previous.url !== next.url && next.url != null) {
        this.buffers.delete(sample.id);
        this.sampleInputs.delete(sample.id);
        this.loads.delete(sample.id);
      }
      this.samples.set(sample.id, next);
      if (sample.buffer?.getChannelData) this.buffers.set(sample.id, sample.buffer);
    }
  }

  async loadSample(sampleId, input) {
    if (!sampleId || typeof sampleId !== 'string') throw new Error('音源标识无效。');
    if (input?.getChannelData) {
      this.buffers.set(sampleId, input);
      this.sampleInputs.set(sampleId, input);
      return input;
    }
    const sample = this.samples.get(sampleId);
    const source = input ?? sample?.url ?? sample?.dataUrl;
    if (input === undefined && this.buffers.has(sampleId)) return this.buffers.get(sampleId);
    if (this.buffers.has(sampleId) && this.sampleInputs.get(sampleId) === source) return this.buffers.get(sampleId);
    if (this.loads.get(sampleId)?.source === source) return this.loads.get(sampleId).promise;
    if (!(source instanceof ArrayBuffer) && typeof source !== 'string') throw new Error(`找不到音源 ${sampleId}，请重新导入音频。`);
    const context = this._getContext();
    const entry = { source, promise: null };
    entry.promise = (async () => {
      let bytes;
      if (typeof source === 'string') {
        const response = await this.fetcher(source);
        if (!response.ok) throw new Error(`音源加载失败 (${response.status})：${sampleId}`);
        bytes = await response.arrayBuffer();
      } else bytes = source.slice(0); // decodeAudioData may detach its input.
      let buffer;
      try { buffer = await context.decodeAudioData(bytes); }
      catch { throw new Error(`无法解码音源 ${sampleId}，请使用支持的完整音频文件。`); }
      if (this.loads.get(sampleId) === entry) {
        this.buffers.set(sampleId, buffer);
        this.sampleInputs.set(sampleId, source);
      }
      return buffer;
    })();
    this.loads.set(sampleId, entry);
    try { return await entry.promise; }
    finally { if (this.loads.get(sampleId) === entry) this.loads.delete(sampleId); }
  }

  getSampleBuffer(sampleId) { return this.buffers.get(sampleId) ?? null; }
  getBuffer(sampleId) { return this.getSampleBuffer(sampleId); }
  getCurrentStep() { return this.currentStep; }

  async _loadTrackSamples(tracks) {
    await Promise.all([...new Set(tracks.map((track) => track.sampleId))].map((id) => this.loadSample(id)));
  }

  _voice(context, destination, buffer, options, time, transport = false) {
    const trim = resolveTrim(buffer, options.trimStart, options.trimEnd);
    const rate = semitoneToPlaybackRate(number(options.pitch, 0));
    const duration = trim.duration / rate;
    const amplitude = clamp(number(options.volume, 1), 0, 1) * clamp(number(options.velocity, 1), 0, 1);
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.connect(gain);
    gain.connect(destination);
    const fade = Math.min(0.01, duration / 4);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(amplitude, time + fade);
    gain.gain.setValueAtTime(amplitude, time + duration - fade);
    gain.gain.linearRampToValueAtTime(0, time + duration);
    const voice = { source, gain, time, endTime: time + duration, transport };
    if (context === this.context) {
      this.activeVoices.add(voice);
      source.onended = () => {
        this.activeVoices.delete(voice);
        source.disconnect();
        gain.disconnect();
      };
    }
    // start() duration is measured in source-buffer seconds, not pitched output seconds.
    source.start(time, trim.start, trim.duration);
    return voice;
  }

  async trigger(options = {}) {
    const token = this.runToken;
    this._registerSamples(options.samples);
    const context = await this.resume();
    const buffer = await this.loadSample(options.sampleId);
    if (token !== this.runToken) return null;
    return this._voice(context, this.master, buffer, options, Math.max(context.currentTime, number(options.when, context.currentTime)));
  }

  async play({ tracks, samples, tempo = this.tempo, onStep } = {}) {
    this.stop();
    const token = this.runToken;
    getStepDuration(tempo);
    if (!Array.isArray(tracks)) throw new Error('音轨列表无效。');
    if (onStep) this.onStep = onStep;
    this.tracks = tracks;
    this.tempo = tempo;
    this._registerSamples(samples);
    const context = await this.resume();
    await this._loadTrackSamples(tracks);
    if (token !== this.runToken) return false;
    this.isPlaying = true;
    this.nextStep = 0;
    this.nextNoteTime = context.currentTime + 0.04;
    this.stepQueue = [];
    this.lastStepTime = null;
    this._schedule();
    this._draw();
    return true;
  }

  update({ tracks, samples, tempo } = {}) {
    if (tempo !== undefined) getStepDuration(tempo);
    const oldStepDuration = getStepDuration(this.tempo);
    if (tracks !== undefined) this.tracks = tracks;
    this._registerSamples(samples);
    const changedTempo = tempo !== undefined && tempo !== this.tempo;
    if (tempo !== undefined) this.tempo = tempo;
    if (!this.isPlaying) return;
    const now = this.context.currentTime;
    const future = this.stepQueue.find((event) => event.time > now + 0.002);
    if (future) {
      for (const voice of [...this.activeVoices]) {
        if (voice.transport && voice.time >= future.time - 0.000001) this._stopVoice(voice, now, false);
      }
      this.stepQueue = this.stepQueue.filter((event) => event.time < future.time);
      this.nextStep = future.step;
      this.nextNoteTime = changedTempo
        ? Math.max(now + 0.012, future.time - oldStepDuration + getStepDuration(this.tempo))
        : future.time;
    } else if (changedTempo && this.lastStepTime !== null) {
      this.nextNoteTime = Math.max(now + 0.012, this.lastStepTime + getStepDuration(this.tempo));
    }
    // New custom buffers should be loaded before update; known URL sources may warm in the background.
    this._loadTrackSamples(this.tracks).catch((error) => { this.lastError = error; });
    // Refill the cancelled horizon immediately; waiting for the old timer could miss a near beat.
    clearTimeout(this.schedulerTimer);
    this._schedule();
  }

  _schedule() {
    if (!this.isPlaying) return;
    const now = this.context.currentTime;
    if (this.nextNoteTime < now - 0.1) {
      // Avoid a burst of every missed beat after a heavily throttled/background tab.
      const skipped = Math.ceil((now - this.nextNoteTime) / getStepDuration(this.tempo));
      this.nextStep = (this.nextStep + skipped) % STEP_COUNT;
      this.nextNoteTime += skipped * getStepDuration(this.tempo);
      this.stepQueue = this.stepQueue.filter((event) => event.time >= now);
    }
    while (this.nextNoteTime < now + 0.1) {
      const step = this.nextStep;
      const time = this.nextNoteTime;
      this.stepQueue.push({ step, time });
      for (const track of this.tracks) {
        const note = track.steps?.[step];
        const buffer = this.buffers.get(track.sampleId);
        if (!note || !buffer || track.muted || track.mute) continue;
        try {
          this._voice(this.context, this.master, buffer, {
            ...track, pitch: number(track.pitch, 0) + number(note.pitch, 0), velocity: number(note.velocity, 1),
          }, time, true);
        } catch (error) { this.lastError = error; }
      }
      this.nextStep = (step + 1) % STEP_COUNT;
      this.nextNoteTime += getStepDuration(this.tempo);
    }
    this.schedulerTimer = setTimeout(() => this._schedule(), 25);
  }

  _draw() {
    if (!this.isPlaying) return;
    const now = this.context.currentTime;
    while (this.stepQueue.length && this.stepQueue[0].time <= now) {
      const event = this.stepQueue.shift();
      this.currentStep = event.step;
      this.lastStepTime = event.time;
      this.onStep(event.step);
    }
    this.visualTimer = setTimeout(() => this._draw(), 16);
  }

  _stopVoice(voice, now, fade = true) {
    try {
      if (fade && voice.time <= now) {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
        voice.gain.gain.linearRampToValueAtTime(0, now + 0.008);
        voice.source.stop(now + 0.008);
      } else voice.source.stop(now);
    } catch { /* A voice may have ended between its callback and a stop click. */ }
    this.activeVoices.delete(voice);
  }

  stop() {
    this.runToken += 1;
    this.isPlaying = false;
    clearTimeout(this.schedulerTimer);
    clearTimeout(this.visualTimer);
    this.schedulerTimer = null;
    this.visualTimer = null;
    this.stepQueue = [];
    this.currentStep = -1;
    this.lastStepTime = null;
    if (this.context) for (const voice of [...this.activeVoices]) this._stopVoice(voice, this.context.currentTime);
    this.onStep(-1);
  }

  async exportWav({ tracks = this.tracks, samples, tempo = this.tempo, bars = 1, sampleRate = 44100 } = {}) {
    this._registerSamples(samples);
    const sequence = compileSequence({ tracks, tempo, bars });
    await this._loadTrackSamples(tracks);
    let duration = sequence.duration;
    for (const event of sequence.events) {
      const buffer = this.buffers.get(event.sampleId);
      const trim = resolveTrim(buffer, event.trimStart, event.trimEnd);
      duration = Math.max(duration, event.time + trim.duration / semitoneToPlaybackRate(event.pitch));
    }
    if (duration > 300) throw new Error('导出超过 5 分钟，请缩短音频或减少小节。');
    if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw new Error('导出采样率无效。');
    const length = Math.ceil((duration + 0.02) * sampleRate);
    const Constructor = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
    if (!this.offlineContextFactory && !Constructor) throw new Error('当前浏览器不支持离线音频导出。');
    const context = this.offlineContextFactory
      ? this.offlineContextFactory(2, length, sampleRate)
      : new Constructor(2, length, sampleRate);
    const master = context.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(context.destination);
    for (const event of sequence.events) this._voice(context, master, this.buffers.get(event.sampleId), event, event.time);
    const rendered = await context.startRendering();
    return audioBufferToWav(rendered);
  }

  async dispose() {
    this.stop();
    this.buffers.clear();
    this.loads.clear();
    this.sampleInputs.clear();
    if (this.context && this.context.state !== 'closed') await this.context.close();
    this.context = null;
    this.master = null;
  }
}

export default AudioEngine;
