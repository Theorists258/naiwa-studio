export const STEP_COUNT = 16;
export const PROJECT_VERSION = 1;
export const MIN_TEMPO = 40;
export const MAX_TEMPO = 240;

export const SAMPLE_LIBRARY = [
  { id: 'laugh', name: '奶蛙原笑', url: '/audio/nailong_laugh.mp3' },
  { id: 'hola', name: '呼啦干巴爹', url: '/audio/hola_ganbadie.mp3' },
  { id: 'gajiaosai', name: '嘎脚塞', url: '/audio/gajiaosai.mp3' },
  { id: 'gagadilashui', name: '嘎嘎地拉水', url: '/audio/gagadilashui.mp3' },
  { id: 'dupu', name: '嘟噗', url: '/audio/dupu.mp3' },
];

// C4 is a relative reference, not a claim that the original recording is tuned to C4.
const padNames = ['C3', 'D3', 'E3', 'G3', 'A3', 'C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'D5', 'E5', 'G5', 'A5', 'C6'];
const padPitches = [-12, -10, -8, -5, -3, 0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const padKeys = 'asdfghjkqwertyui';
export const PAD_NOTES = padNames.map((name, index) => ({
  id: `pad-${index}`, name, note: name, label: name, semitone: padPitches[index],
  pitch: padPitches[index], key: padKeys[index],
}));

function pattern(indices, velocity = 0.85) {
  return Array.from({ length: STEP_COUNT }, (_, index) => (
    indices.includes(index) ? { pitch: 0, velocity } : null
  ));
}

export function createInitialTracks() {
  return [
    { id: 'low', name: '低音奶蛙', sampleId: 'laugh', pitch: -12, volume: 0.74, trimStart: 0.04, trimEnd: 0.4, steps: pattern([0, 6, 8, 14]) },
    { id: 'mid', name: '中音奶蛙', sampleId: 'laugh', pitch: 0, volume: 0.6, trimStart: 0.04, trimEnd: 0.4, steps: pattern([4, 12]) },
    { id: 'high', name: '高音奶蛙', sampleId: 'laugh', pitch: 12, volume: 0.44, trimStart: 0.04, trimEnd: 0.4, steps: pattern([2, 7, 10, 15], 0.72) },
    { id: 'dupu', name: '嘟噗', sampleId: 'dupu', pitch: 0, volume: 0.58, trimStart: 0.14, trimEnd: 0.66, steps: pattern([0, 8], 0.78) },
    { id: 'gajiaosai', name: '嘎脚塞', sampleId: 'gajiaosai', pitch: 0, volume: 0.48, trimStart: 0.14, trimEnd: 0.32, steps: pattern([5, 13], 0.7) },
    { id: 'breath', name: '气口', sampleId: 'laugh', pitch: -5, volume: 0.32, trimStart: 2.65, trimEnd: 2.82, steps: pattern([3, 11], 0.6) },
  ];
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const inRange = (value, min, max) => finite(value) && value >= min && value <= max;

/** Validate untrusted project JSON without mutating it. Buffers are intentionally not serialized. */
export function validateProject(input) {
  let data = input;
  const errors = [];
  if (typeof data === 'string') {
    if (data.length > 64 * 1024 * 1024) return { ok: false, valid: false, errors: ['工程文件过大。'], project: null, value: null };
    try { data = JSON.parse(data); } catch { return { ok: false, valid: false, errors: ['工程文件不是有效的 JSON。'], project: null, value: null }; }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, valid: false, errors: ['工程内容无效。'], project: null, value: null };
  }
  if (data.version !== undefined && data.version !== PROJECT_VERSION) errors.push('工程版本暂不支持。');
  if (!inRange(data.tempo, MIN_TEMPO, MAX_TEMPO)) errors.push(`速度应在 ${MIN_TEMPO}–${MAX_TEMPO} BPM 之间。`);
  if (!Array.isArray(data.tracks) || data.tracks.length < 1 || data.tracks.length > 32) errors.push('工程需要 1–32 条音轨。');
  const samples = data.samples === undefined ? SAMPLE_LIBRARY : data.samples;
  if (!Array.isArray(samples) || samples.length > 128) errors.push('音源列表无效。');
  const sampleIds = new Set();
  if (Array.isArray(samples)) samples.forEach((sample) => {
    if (!sample || typeof sample.id !== 'string' || !sample.id || sample.id.length > 100 || sampleIds.has(sample.id)) errors.push('音源标识无效或重复。');
    else sampleIds.add(sample.id);
    if (!sample || typeof sample.name !== 'string' || sample.name.length > 200) errors.push('音源名称无效。');
    if (sample?.url != null && (typeof sample.url !== 'string' || sample.url.length > 2048 || !/^(\/audio\/|https?:\/\/|blob:)/.test(sample.url))) errors.push('音源地址无效。');
    if (sample?.dataUrl != null && (typeof sample.dataUrl !== 'string' || sample.dataUrl.length > 28 * 1024 * 1024 || !/^data:(?:audio\/[a-z0-9.+-]+(?:;codecs=[a-z0-9.,_-]+)?|application\/octet-stream);base64,[A-Za-z0-9+/]*={0,2}$/i.test(sample.dataUrl))) errors.push('内嵌音频无效或超过 28 MB。');
  });
  const trackIds = new Set();
  if (Array.isArray(data.tracks)) data.tracks.forEach((track, index) => {
    const prefix = `第 ${index + 1} 条音轨`;
    if (!track || typeof track !== 'object') { errors.push(`${prefix}无效。`); return; }
    if (typeof track.id !== 'string' || !track.id || track.id.length > 100 || trackIds.has(track.id)) errors.push(`${prefix}标识无效或重复。`);
    else trackIds.add(track.id);
    if (typeof track.name !== 'string' || track.name.length > 200) errors.push(`${prefix}名称无效。`);
    if (!sampleIds.has(track.sampleId)) errors.push(`${prefix}引用了未知音源。`);
    if (!inRange(track.pitch, -48, 48)) errors.push(`${prefix}音高无效。`);
    if (!inRange(track.volume, 0, 1)) errors.push(`${prefix}音量无效。`);
    if (!inRange(track.trimStart, 0, 600)) errors.push(`${prefix}裁切起点无效。`);
    if (track.trimEnd !== null && track.trimEnd !== undefined && (!inRange(track.trimEnd, 0, 600) || track.trimEnd <= track.trimStart)) errors.push(`${prefix}裁切终点应在起点之后。`);
    if (!Array.isArray(track.steps) || track.steps.length !== STEP_COUNT) errors.push(`${prefix}应包含 16 步。`);
    else track.steps.forEach((note) => {
      if (note !== null && (!note || typeof note !== 'object' || !inRange(note.pitch, -48, 48) || !inRange(note.velocity, 0, 1))) errors.push(`${prefix}包含无效音符。`);
    });
  });
  if (errors.length) return { ok: false, valid: false, errors: [...new Set(errors)], project: null, value: null };
  const project = {
    version: PROJECT_VERSION,
    name: typeof data.name === 'string' ? data.name.slice(0, 200) : '我的奶蛙乐段',
    view: typeof data.view === 'string' ? data.view.slice(0, 32) : 'sequencer',
    tempo: data.tempo,
    tracks: data.tracks.map((track) => ({
      id: track.id, name: track.name, sampleId: track.sampleId,
      pitch: track.pitch, volume: track.volume, trimStart: track.trimStart,
      trimEnd: track.trimEnd ?? null, muted: Boolean(track.muted),
      steps: track.steps.map((note) => note === null ? null : { pitch: note.pitch, velocity: note.velocity }),
    })),
    samples: samples.map((sample) => ({
      id: sample.id, name: sample.name,
      url: sample.dataUrl && sample.url?.startsWith('blob:') ? null : sample.url ?? null,
      ...(sample.dataUrl ? { dataUrl: sample.dataUrl } : {}),
    })),
  };
  return { ok: true, valid: true, errors: [], project, value: project };
}

export function serializeProject(project) {
  const checked = validateProject(project);
  if (!checked.ok) throw new Error(checked.errors.join(' '));
  return JSON.stringify(checked.project, null, 2);
}
