import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioEngine, audioBufferToWav, compileSequence, getStepDuration, resolveTrim, semitoneToPlaybackRate } from '../src/audio-engine.js';
import { createInitialTracks, PAD_NOTES, SAMPLE_LIBRARY, serializeProject, validateProject } from '../src/music.js';

function buffer(channels = [[0, 0.5, -0.5, 0]], sampleRate = 4) {
  const arrays = channels.map((data) => Float32Array.from(data));
  return { numberOfChannels: arrays.length, sampleRate, length: arrays[0].length, duration: arrays[0].length / sampleRate, getChannelData: (channel) => arrays[channel] };
}

function fakeContext() {
  const sources = [];
  const gains = [];
  return {
    state: 'running', currentTime: 0, destination: {}, sources, gains,
    createGain() {
      const events = [];
      const node = { connect() {}, disconnect() {}, gain: { value: 1,
        setValueAtTime(value, time) { events.push(['set', value, time]); },
        linearRampToValueAtTime(value, time) { events.push(['ramp', value, time]); },
        cancelScheduledValues(time) { events.push(['cancel', time]); },
      }, events };
      gains.push(node); return node;
    },
    createBufferSource() {
      const node = { buffer: null, playbackRate: { value: 1 }, connect() {}, disconnect() {}, starts: [], stops: [],
        start(...args) { this.starts.push(args); }, stop(...args) { this.stops.push(args); },
      };
      sources.push(node); return node;
    },
    decodeAudioData: async () => buffer(),
    resume: async function () { this.state = 'running'; },
    close: async function () { this.state = 'closed'; },
  };
}

const track = (overrides = {}) => ({ id: 'one', name: 'One', sampleId: 'laugh', volume: 0.8, pitch: 0, trimStart: 0, trimEnd: null, steps: Array.from({ length: 16 }, () => null), ...overrides });

test('pad pitches and keyboard keys match the chosen 4×4 design, relative to C4', () => {
  assert.deepEqual(PAD_NOTES.map((pad) => pad.semitone), [-12, -10, -8, -5, -3, 0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]);
  assert.equal(PAD_NOTES[5].name, 'C4');
  assert.equal(PAD_NOTES.map((pad) => pad.key).join(''), 'asdfghjkqwertyui');
  assert.equal(new Set(PAD_NOTES.map((pad) => pad.key)).size, 16);
});

test('default projects are independent, validate, and serialize without AudioBuffers', () => {
  const one = createInitialTracks();
  const two = createInitialTracks();
  one[0].steps[0].velocity = 0.1;
  assert.notEqual(two[0].steps[0].velocity, 0.1);
  const source = { tempo: 116, tracks: two, samples: SAMPLE_LIBRARY.map((sample) => ({ ...sample, buffer: buffer() })) };
  const serialized = serializeProject(source);
  const checked = validateProject(serialized);
  assert.equal(checked.ok, true);
  assert.equal(checked.project.tracks.length, 6);
  assert.equal(serialized.includes('getChannelData'), false);
  assert.equal(checked.project.samples.some((sample) => 'buffer' in sample), false);
});

test('project validation rejects malformed notes, unknown samples, duplicates, and invalid trim', () => {
  assert.equal(validateProject('{broken').ok, false);
  assert.equal(validateProject({ tempo: 0, tracks: createInitialTracks() }).ok, false);
  const tracks = createInitialTracks();
  tracks[0].sampleId = 'missing';
  tracks[1].trimEnd = -1;
  tracks[2].steps[0] = { pitch: Infinity, velocity: 1 };
  tracks[3].id = tracks[0].id;
  const checked = validateProject({ tempo: 120, tracks });
  assert.equal(checked.ok, false);
  assert.ok(checked.errors.length >= 4);
});

test('custom audio survives a project round trip without an expired blob URL', () => {
  const samples = [...SAMPLE_LIBRARY, { id: 'own', name: 'My voice', url: 'blob:https://localhost/session', dataUrl: 'data:audio/webm;base64,AQID' }];
  const notes = track({ sampleId: 'own' });
  const saved = serializeProject({ tempo: 120, tracks: [notes], samples, view: 'pads' });
  const restored = validateProject(saved).project;
  assert.equal(restored.view, 'pads');
  assert.equal(restored.samples.at(-1).url, null);
  assert.equal(restored.samples.at(-1).dataUrl, 'data:audio/webm;base64,AQID');
  assert.equal(validateProject({ tempo: 120, tracks: [notes], samples: [{ id: 'own', name: 'Bad', dataUrl: 'data:text/html;base64,AQID' }] }).ok, false);
});

test('pitch is musical resampling: an octave doubles rate, a lower octave halves it', () => {
  assert.equal(semitoneToPlaybackRate(12), 2);
  assert.equal(semitoneToPlaybackRate(-12), 0.5);
  assert.ok(Math.abs(semitoneToPlaybackRate(7) - 1.4983070768766815) < 1e-12);
  assert.throws(() => semitoneToPlaybackRate(NaN));
  assert.equal(getStepDuration(120), 0.125);
});

test('sequence compilation preserves layered voices, summed pitch, mute, and successive bars', () => {
  const a = track({ pitch: -12 }); a.steps[0] = { pitch: 7, velocity: 0.4 }; a.steps[15] = { pitch: 0, velocity: 1 };
  const b = track({ id: 'two', muted: true }); b.steps[0] = { pitch: 0, velocity: 1 };
  const c = track({ id: 'three' }); c.steps[0] = { pitch: 0, velocity: 0.5 };
  const sequence = compileSequence({ tracks: [a, b, c], tempo: 120, bars: 2 });
  assert.equal(sequence.duration, 4);
  assert.equal(sequence.events.length, 6);
  assert.equal(sequence.events[0].pitch, -5);
  assert.equal(sequence.events[0].velocity, 0.4);
  assert.equal(sequence.events[2].time, 1.875);
  assert.equal(sequence.events[3].time, 2);
  assert.throws(() => compileSequence({ tracks: [], tempo: 120, bars: 0 }));
});

test('trim uses seconds, clamps sample end, and rejects an empty slice', () => {
  assert.deepEqual(resolveTrim(buffer(), 0.25, 2), { start: 0.25, end: 1, duration: 0.75 });
  assert.equal(resolveTrim(buffer(), 0, null).duration, 1);
  assert.throws(() => resolveTrim(buffer(), 1, null));
  assert.throws(() => resolveTrim(buffer(), 0.8, 0.2));
});

test('WAV writes stereo interleaved signed PCM with a valid header and proportional peak control', async () => {
  const blob = audioBufferToWav(buffer([[2, -1, 0], [-2, 0.5, 0]], 44100));
  assert.equal(blob.type, 'audio/wav');
  const bytes = await blob.arrayBuffer();
  const view = new DataView(bytes);
  const text = (offset, length) => String.fromCharCode(...new Uint8Array(bytes, offset, length));
  assert.equal(text(0, 4), 'RIFF');
  assert.equal(text(8, 4), 'WAVE');
  assert.equal(view.getUint32(4, true), bytes.byteLength - 8);
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 44100);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 12);
  assert.equal(view.getInt16(44, true), Math.round(0.98 * 32767));
  assert.equal(view.getInt16(46, true), Math.round(-0.98 * 32768));
  assert.equal(view.getInt16(48, true), Math.round(-0.49 * 32768));
});

test('sample cache coalesces fetch/decode and returns real supplied buffers', async () => {
  const context = fakeContext(); let fetched = 0; let decoded = 0;
  context.decodeAudioData = async () => { decoded += 1; return buffer(); };
  const engine = new AudioEngine({ contextFactory: () => context, fetcher: async () => { fetched += 1; return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; } });
  const [one, two] = await Promise.all([engine.loadSample('laugh', '/audio/nailong_laugh.mp3'), engine.loadSample('laugh', '/audio/nailong_laugh.mp3')]);
  assert.equal(one, two);
  assert.equal(await engine.loadSample('laugh'), one);
  assert.equal(engine.getBuffer('laugh'), one);
  assert.equal(fetched, 1); assert.equal(decoded, 1);
  await engine.dispose();
});

test('failed audio fetches are surfaced, never replaced with synthesized sound', async () => {
  const engine = new AudioEngine({ contextFactory: fakeContext, fetcher: async () => ({ ok: false, status: 404 }) });
  await assert.rejects(engine.loadSample('missing', '/missing.mp3'), /404/);
  assert.equal(engine.getBuffer('missing'), null);
  await engine.dispose();
});

test('replacing a sample URL under the same id invalidates the decoded cache', async () => {
  const context = fakeContext(); let fetched = 0;
  const engine = new AudioEngine({ contextFactory: () => context, fetcher: async () => { fetched += 1; return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; } });
  await engine.loadSample('laugh', '/audio/nailong_laugh.mp3');
  engine.update({ samples: [{ id: 'laugh', name: 'New', url: '/audio/replacement.mp3' }] });
  assert.equal(engine.getBuffer('laugh'), null);
  await engine.loadSample('laugh');
  assert.equal(fetched, 2);
  await engine.dispose();
});

test('a serialized embedded recording is loadable without an external URL', async () => {
  let requested;
  const engine = new AudioEngine({ contextFactory: fakeContext, fetcher: async (url) => { requested = url; return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; } });
  engine.update({ samples: [{ id: 'own', name: 'Own', url: null, dataUrl: 'data:audio/webm;base64,AQID' }] });
  await engine.loadSample('own');
  assert.equal(requested, 'data:audio/webm;base64,AQID');
  await engine.dispose();
});

test('each preview creates a new source and pitched trim retains source-time duration', async () => {
  const context = fakeContext(); const engine = new AudioEngine({ contextFactory: () => context });
  await engine.loadSample('own', buffer());
  await engine.trigger({ sampleId: 'own', pitch: 12, trimStart: 0.25, trimEnd: 0.75 });
  await engine.trigger({ sampleId: 'own', pitch: -12 });
  assert.equal(context.sources.length, 2);
  assert.equal(context.sources[0].playbackRate.value, 2);
  assert.deepEqual(context.sources[0].starts[0], [0, 0.25, 0.5]);
  assert.equal([...engine.activeVoices][0].endTime, 0.25);
  engine.stop();
  assert.equal(engine.activeVoices.size, 0);
  assert.ok(context.sources.every((source) => source.stops.length === 1));
  await engine.dispose();
});

test('stop prevents a loading transport from starting later', async () => {
  const context = fakeContext(); let release;
  const deferred = new Promise((resolve) => { release = resolve; });
  const engine = new AudioEngine({ contextFactory: () => context, fetcher: () => deferred });
  const pending = engine.play({ tracks: [track()], tempo: 120 });
  await Promise.resolve();
  engine.stop();
  release({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  assert.equal(await pending, false);
  assert.equal(engine.isPlaying, false);
  assert.equal(context.sources.length, 0);
  await engine.dispose();
});

test('editing while playing cancels queued voices and applies tempo at the upcoming step', async () => {
  const context = fakeContext(); const engine = new AudioEngine({ contextFactory: () => context });
  await engine.loadSample('laugh', buffer());
  const initial = track(); initial.steps[0] = { pitch: 0, velocity: 1 };
  await engine.play({ tracks: [initial], tempo: 120 });
  assert.equal(context.sources[0].starts[0][0], 0.04);
  const edited = track({ pitch: 12 }); edited.steps[0] = { pitch: 0, velocity: 1 };
  engine.update({ tracks: [edited], tempo: 160 });
  assert.equal(context.sources[0].stops.length, 1);
  assert.equal(engine.tempo, 160);
  assert.equal(engine.stepQueue[0].step, 0);
  assert.equal(context.sources[1].playbackRate.value, 2);
  await engine.dispose();
});

test('offline export includes the slower final note tail and passes actual rendered PCM to WAV', async () => {
  const live = fakeContext(); let offline;
  const engine = new AudioEngine({ contextFactory: () => live, offlineContextFactory: (channels, length, rate) => {
    offline = fakeContext(); offline.channels = channels; offline.length = length; offline.rate = rate;
    offline.startRendering = async () => buffer([[0.25, -0.25], [0.5, -0.5]], rate);
    return offline;
  } });
  await engine.loadSample('laugh', buffer());
  const notes = track({ pitch: -12 }); notes.steps[15] = { pitch: 0, velocity: 1 };
  const wav = await engine.exportWav({ tracks: [notes], tempo: 120, bars: 1 });
  assert.equal(offline.length, Math.ceil((1.875 + 2 + 0.02) * 44100));
  assert.deepEqual(offline.sources[0].starts[0], [1.875, 0, 1]);
  assert.equal(offline.sources[0].playbackRate.value, 0.5);
  const view = new DataView(await wav.arrayBuffer());
  assert.equal(view.getInt16(44, true), Math.round(0.25 * 32767));
  await engine.dispose();
});
