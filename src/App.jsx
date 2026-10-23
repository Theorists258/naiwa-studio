import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Stop, Repeat, Plus, DownloadSimple, FloppyDisk, FolderOpen, ArrowCounterClockwise, X, SpeakerHigh, SpeakerSlash, GridFour, SquaresFour, Info, Trash, Check, Circle } from '@phosphor-icons/react';
import { AudioEngine } from './audio-engine.js';
import { SAMPLE_LIBRARY, createInitialTracks, PAD_NOTES, serializeProject, validateProject } from './music.js';

const STORAGE_KEY = 'naiwa-studio-project-v1';
const signed = (n) => `${n > 0 ? '+' : ''}${n}`;
const clone = (v) => JSON.parse(JSON.stringify(v));
const names = { laugh: '大笑原声', hola: 'Hola～干巴爹', gajiaosai: '嘎脚塞', gagadilashui: '嘎嘎滴啦水', dupu: '嘟噗' };
const displayName = (s) => names[s?.id] || s?.name || '未选择声音';
const trackNames = { low: '哈 · 低音', mid: '哈 · 中音', high: '哈 · 高音', breath: '气口' };
const trackName = (t) => trackNames[t?.id] || t?.name || '';

function readSaved() {
  try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) { const result = validateProject(raw); if (result.ok) return result.project; } } catch { /* Storage may be unavailable. */ }
  return { name: '我的奶蛙乐段', tempo: 112, tracks: createInitialTracks(), samples: SAMPLE_LIBRARY, view: 'sequencer' };
}
function trapModalFocus(event) {
  if (event.key !== 'Tab') return;
  const focusable = event.currentTarget.querySelectorAll('button:not(:disabled), a[href], input, select');
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (event.shiftKey && event.target === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && event.target === last) { event.preventDefault(); first.focus(); }
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
function Waveform({ buffer, color = '#85867b', height = 40, className = '' }) {
  const canvas = useRef(null);
  useEffect(() => {
    const element = canvas.current; if (!element) return;
    function draw() {
      const width = Math.max(element.clientWidth, 1), ratio = window.devicePixelRatio || 1;
      element.width = width * ratio; element.height = height * ratio;
      const ctx = element.getContext('2d'); ctx.scale(ratio, ratio); ctx.clearRect(0, 0, width, height); ctx.strokeStyle = color; ctx.lineWidth = 1.25;
      if (!buffer) { ctx.globalAlpha = .25; ctx.beginPath(); ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); ctx.stroke(); return; }
      const data = buffer.getChannelData(0), count = Math.floor(width / 2.5), stride = Math.max(1, Math.floor(data.length / count));
      let peak = .01; for (let i = 0; i < data.length; i += 40) peak = Math.max(peak, Math.abs(data[i]));
      ctx.beginPath();
      for (let x = 0; x < count; x++) {
        let min = 0, max = 0; const end = Math.min(data.length, (x + 1) * stride);
        for (let i = x * stride; i < end; i += Math.max(1, Math.floor(stride / 45))) { min = Math.min(min, data[i]); max = Math.max(max, data[i]); }
        const amplitude = height * .43 / peak;
        ctx.moveTo(x * 2.5 + 1, height / 2 + min * amplitude); ctx.lineTo(x * 2.5 + 1, height / 2 + Math.max(max * amplitude, .8));
      }
      ctx.stroke();
    }
    draw(); const observer = new ResizeObserver(draw); observer.observe(element); return () => observer.disconnect();
  }, [buffer, color, height]);
  return <canvas ref={canvas} className={`waveform ${className}`} style={{ height }} aria-label={buffer ? '声音波形' : '声音加载中'} role="img" />;
}
function RangeControl({ label, value, min, max, step = 1, onChange, suffix = '', valueLabel, title }) {
  return <label className="range-control" title={title}><span className="range-label"><span>{label}</span><output>{valueLabel ?? `${value}${suffix}`}</output></span><input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} style={{ '--range-progress': `${Math.max(0, Math.min(100, (value - min) / (max - min) * 100))}%` }} /></label>;
}

function NumberControl({ value, min, max, onChange, label }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => { const n = draft.trim() === '' ? value : Number(draft); const next = Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : value; setDraft(String(next)); onChange(next); };
  return <input type="number" min={min} max={max} value={draft} aria-label={label} onChange={(e) => { setDraft(e.target.value); const n = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(n) && n >= min && n <= max) onChange(Math.round(n)); }} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { commit(); e.currentTarget.blur(); } }} />;
}

export function App() {
  const [initial] = useState(readSaved);
  const [view, setView] = useState(initial.view === 'pads' ? 'pads' : 'sequencer');
  const [tracks, setTracks] = useState(initial.tracks), [samples, setSamples] = useState(initial.samples);
  const [tempo, setTempo] = useState(initial.tempo), [name, setName] = useState(initial.name);
  const [selectedId, setSelectedId] = useState(initial.tracks[1]?.id || initial.tracks[0].id), [selectedStep, setSelectedStep] = useState(null);
  const [playing, setPlaying] = useState(false), [recording, setRecording] = useState(false), [currentStep, setCurrentStep] = useState(-1);
  const [activePad, setActivePad] = useState(null), [loadedBuffers, setLoadedBuffers] = useState({}), [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false), [toast, setToast] = useState(null), [showInfo, setShowInfo] = useState(false);
  const [history, setHistory] = useState([]), [saveState, setSaveState] = useState('已自动保存');
  const audioInput = useRef(null), projectInput = useRef(null), padTimeout = useRef(null), toastTimeout = useRef(null);
  const engineRef = useRef(null), playbackToken = useRef(0);
  if (!engineRef.current) engineRef.current = new AudioEngine({ onStep: setCurrentStep });
  const engine = engineRef.current, track = tracks.find((t) => t.id === selectedId) || tracks[0];
  const sample = samples.find((s) => s.id === track.sampleId), buffer = loadedBuffers[track.sampleId], duration = buffer?.duration || 1;
  const trimEnd = Math.min(track.trimEnd ?? duration, duration), selectedNote = selectedStep === null ? null : track.steps[selectedStep];
  const notify = useCallback((message, error = false) => { clearTimeout(toastTimeout.current); setToast({ message, error }); toastTimeout.current = setTimeout(() => setToast(null), error ? 7000 : 3500); }, []);
  useEffect(() => {
    let cancelled = false; setLoading(true);
    setLoadedBuffers({});
    Promise.allSettled(samples.map(async (s) => [s.id, await engine.loadSample(s.id, s.dataUrl || s.url)]))
      .then((results) => { if (!cancelled) { setLoadedBuffers(Object.fromEntries(results.filter((r) => r.status === 'fulfilled').map((r) => r.value))); const failed = results.find((r) => r.status === 'rejected'); if (failed) notify(failed.reason.message, true); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [samples, engine, notify]);
  useEffect(() => { engine.update({ tracks, tempo, samples }); }, [tracks, tempo, samples, engine]);
  useEffect(() => {
    const timeout = setTimeout(() => { try { localStorage.setItem(STORAGE_KEY, serializeProject({ name, tempo, tracks, samples, view })); setSaveState('已自动保存'); } catch { setSaveState('请下载作品保存'); } }, 600);
    return () => clearTimeout(timeout);
  }, [name, tracks, samples, tempo, view]);
  useEffect(() => () => { engine.stop(); clearTimeout(padTimeout.current); clearTimeout(toastTimeout.current); }, [engine]);

  function remember() { setHistory((prev) => [...prev.slice(-29), clone(tracks)]); }
  function updateTrack(patch, id = track.id) { remember(); setTracks((prev) => prev.map((t) => t.id === id ? { ...t, ...patch } : t)); }
  function stop() { playbackToken.current++; engine.stop(); setPlaying(false); setRecording(false); setCurrentStep(-1); }
  async function play() { const token = ++playbackToken.current; try { const started = await engine.play({ tracks, samples, tempo }); if (token === playbackToken.current) setPlaying(started !== false && engine.isPlaying); } catch (error) { if (token !== playbackToken.current) return; setPlaying(false); setRecording(false); notify(error.message, true); } }
  async function togglePlay() { if (playing) stop(); else await play(); }
  async function previewTrack(item = track, offset = 0) { try { await engine.trigger({ ...item, pitch: item.pitch + offset, samples }); } catch (error) { notify(error.message, true); } }
  async function chooseSample(item) {
    setSelectedStep(null); updateTrack({ sampleId: item.id, trimStart: 0, trimEnd: item.id === 'laugh' ? .4 : null });
    try { await engine.trigger({ sampleId: item.id, pitch: 0, volume: .7, trimStart: 0, trimEnd: item.id === 'laugh' ? 2.2 : null, samples }); } catch (error) { notify(error.message, true); }
  }
  function toggleCell(item, index, event) {
    setSelectedId(item.id); setSelectedStep(index); if (event.shiftKey && item.steps[index]) return;
    remember(); setTracks((prev) => prev.map((t) => t.id === item.id ? { ...t, steps: t.steps.map((note, i) => i === index ? (note ? null : { pitch: 0, velocity: .85 }) : note) } : t));
  }
  function changeNotePitch(pitch) { updateTrack({ steps: track.steps.map((note, i) => i === selectedStep && note ? { ...note, pitch } : note) }); }
  function hitPad(pad) {
    setActivePad(pad.id); clearTimeout(padTimeout.current); padTimeout.current = setTimeout(() => setActivePad(null), 170); previewTrack(track, pad.pitch);
    if (recording && playing) { const index = Math.max(0, engine.getCurrentStep()); remember(); setSelectedStep(index); setTracks((prev) => prev.map((t) => t.id === track.id ? { ...t, steps: t.steps.map((note, i) => i === index ? { pitch: pad.pitch, velocity: .9 } : note) } : t)); }
  }
  async function toggleRecord() { if (recording) { setRecording(false); return; } if (!playing) { await play(); if (!engine.isPlaying) return; } setRecording(true); notify('录制中：击打会写入当前亮起的步点'); }
  function undo() { if (!history.length) return; setTracks(history[history.length - 1]); setHistory(history.slice(0, -1)); setSelectedStep(null); }
  function clearTrack() { updateTrack({ steps: Array(16).fill(null) }); setSelectedStep(null); notify(`已清空「${trackName(track)}」，可撤销`); }
  useEffect(() => {
    const onKey = (e) => {
      if (showInfo) { if (e.key === 'Escape') setShowInfo(false); return; }
      if ((e.target instanceof HTMLElement && (e.target.matches('input,select,textarea') || e.target.isContentEditable)) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (view === 'pads') { const pad = PAD_NOTES.find((p) => p.key === e.key.toLowerCase()); if (pad) { e.preventDefault(); hitPad(pad); } }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });
  async function importAudio(e) {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
    if (file.size > 15 * 1024 * 1024) { notify('请导入小于 15 MB 的音频', true); return; }
    if (samples.reduce((total, item) => total + (item.dataUrl?.length || 0), 0) + Math.ceil(file.size * 4 / 3) > 30 * 1024 * 1024) { notify('作品的导入声音已接近容量上限，请选更短的片段', true); return; }
    setBusy(true);
    try {
      const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, decoded = await engine.loadSample(id, await file.arrayBuffer());
      if (decoded.duration > 120) throw new Error('请使用 2 分钟以内的声音片段');
      const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
      const item = { id, name: file.name.replace(/\.[^.]+$/, ''), dataUrl, url: null };
      setSamples((prev) => [...prev, item]); setLoadedBuffers((prev) => ({ ...prev, [id]: decoded })); updateTrack({ sampleId: id, trimStart: 0, trimEnd: Math.min(decoded.duration, .6) }); setSelectedStep(null); notify(`已导入「${item.name}」`);
    } catch (error) { notify(error.message || '音频导入失败，请选择有效的音频文件', true); } finally { setBusy(false); }
  }
  function saveProject() { try { download(new Blob([serializeProject({ name, tracks, samples, tempo, view })], { type: 'application/json' }), `${name}.naiwa.json`); notify('作品已下载，包含导入的声音'); } catch (error) { notify(error.message, true); } }
  async function openProject(e) {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
    if (file.size > 35 * 1024 * 1024) { notify('工程文件过大，请使用 35 MB 以内的文件', true); return; }
    try { const result = validateProject(await file.text()); if (!result.ok) throw new Error(result.errors[0]); stop(); const p = result.project; setTracks(p.tracks); setSamples(p.samples); setTempo(p.tempo); setName(p.name); setSelectedId(p.tracks[0].id); setSelectedStep(null); setHistory([]); if (p.view) setView(p.view); notify('作品已打开'); } catch (error) { notify(error.message, true); }
  }
  async function exportAudio() { setBusy(true); try { download(await engine.exportWav({ tracks, samples, tempo, bars: 4 }), `${name}-${tempo}bpm.wav`); notify('WAV 已导出：4 次循环，保留尾音'); } catch (error) { notify(error.message, true); } finally { setBusy(false); } }
  function selectTrack(id) { setSelectedId(id); setSelectedStep(null); }

  const transport = <div className="transport"><button className={`round-button play-button ${playing ? 'is-playing' : ''}`} onClick={togglePlay} aria-label={playing ? '停止播放' : '播放作品'} title="空格播放 / 停止" disabled={busy}><Play size={27} weight="fill" /></button><button className="round-button stop-button" onClick={stop} aria-label="停止并回到开头"><Stop size={22} weight="fill" /></button><span className="loop-symbol" title="16 步循环播放"><Repeat size={27} weight="bold" /></span><label className="tempo-control"><NumberControl value={tempo} min={40} max={240} onChange={setTempo} label="速度 BPM" /><span>BPM</span></label></div>;
  const actionButtons = <div className="header-actions"><button className="icon-button open-project" disabled={busy} onClick={() => projectInput.current.click()} aria-label="打开作品" title="打开 .naiwa.json 作品"><FolderOpen size={23} /></button><button className="button save-button" aria-label="保存作品" onClick={saveProject}><FloppyDisk size={19} /><span>保存</span></button><button className="button primary export-button" aria-label="导出 WAV" onClick={exportAudio} disabled={busy || loading}><DownloadSimple size={20} /><span>{busy ? '处理中…' : '导出 WAV'}</span></button></div>;
  const toneControls = <div className="tone-controls"><RangeControl label="音高" value={track.pitch} min={-24} max={24} valueLabel={`${signed(track.pitch)} 半音`} onChange={(pitch) => updateTrack({ pitch })} title="升降调会同时改变采样时长" /><RangeControl label="音量" value={Math.round(track.volume * 100)} min={0} max={100} suffix="%" onChange={(value) => updateTrack({ volume: value / 100 })} /></div>;
  const trimEditor = <div className="trim-editor"><div className="waveform-container"><Waveform buffer={buffer} height={view === 'pads' ? 65 : 96} />{buffer && <div className="waveform-selection" style={{ left: `${track.trimStart / duration * 100}%`, width: `${Math.max(0, trimEnd - track.trimStart) / duration * 100}%` }} />}</div><div className="trim-sliders"><RangeControl label="起始" value={Math.min(track.trimStart, Math.max(0, duration - .02))} min={0} max={Math.max(.01, duration - .02)} step={.01} valueLabel={`${track.trimStart.toFixed(2)}s`} onChange={(value) => updateTrack({ trimStart: Math.min(value, trimEnd - .02) })} /><RangeControl label="结束" value={trimEnd} min={.02} max={duration} step={.01} valueLabel={`${trimEnd.toFixed(2)}s`} onChange={(value) => updateTrack({ trimEnd: Math.max(track.trimStart + .02, value) })} /></div></div>;

  const sampleStrip = <section className="pad-sample-strip" aria-label="打击垫音色选择"><span className="strip-label">选择声音</span>{samples.map((item) => <button key={item.id} className={`sound-chip ${track.sampleId === item.id ? 'is-selected' : ''}`} onClick={() => chooseSample(item)}><Play size={13} weight="fill" /><span>{displayName(item)}</span><Waveform buffer={loadedBuffers[item.id]} height={22} /></button>)}<button className="sound-chip import-chip" onClick={() => audioInput.current.click()} disabled={busy}><Plus size={18} />导入</button></section>;

  return <main className={`studio view-${view}`}>
    <input ref={audioInput} type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac" hidden onChange={importAudio} /><input ref={projectInput} type="file" accept=".json,.naiwa" hidden onChange={openProject} />
    <div className="mode-bar"><a className="brand-mark" href="#" onClick={(e) => e.preventDefault()} aria-label="奶蛙音乐实验室"><span className="brand-dot" /> NAIWA STUDIO <span className="brand-divider">/</span><span className="brand-subtitle">奶蛙音乐实验室</span></a><div className="view-switch" aria-label="工作台模式"><button className={view === 'sequencer' ? 'is-active' : ''} aria-pressed={view === 'sequencer'} onClick={() => setView('sequencer')}><GridFour size={17} weight="bold" />音序器</button><button className={view === 'pads' ? 'is-active' : ''} aria-pressed={view === 'pads'} onClick={() => setView('pads')}><SquaresFour size={17} weight="bold" />打击垫</button></div><span className="save-status"><Check size={14} />{saveState}</span></div>
    <header className="studio-header"><div className="title-block"><h1>{view === 'pads' ? '蛙音盒' : '蛙声工作台'}<span className="title-period">.</span></h1><p>{view === 'pads' ? '用笑声，弹一首自己的歌' : '把笑声编成一首歌'}</p></div>{view === 'sequencer' ? <>{transport}{actionButtons}</> : sampleStrip}</header>
    {view === 'sequencer' ? <>
      <section className="sequencer-layout" aria-label="16 步音序器"><aside className="sound-library"><div className="section-heading"><h2>声音库</h2><button className="text-button" onClick={() => audioInput.current.click()} disabled={busy}><Plus size={18} />导入音频</button></div><div className="sample-list">{samples.map((item) => <button key={item.id} className={`sample-card ${track.sampleId === item.id ? 'is-selected' : ''}`} onClick={() => chooseSample(item)} aria-label={`选择并试听${displayName(item)}`}><span className="sample-play"><Play size={17} weight="fill" /></span><span className="sample-main"><strong>{displayName(item)}</strong><Waveform buffer={loadedBuffers[item.id]} height={34} className="mini-wave" /></span></button>)}</div><p className="library-note">每一种声音，都能变成旋律。</p></aside>
        <div className="sequencer-scroll"><div className="sequencer"><div className="beat-labels"><span className="grid-spacer" />{[1, 2, 3, 4].map((beat) => <span key={beat}>第 {beat} 拍</span>)}</div><div className="step-numbers"><span className="grid-spacer" />{Array.from({ length: 16 }, (_, i) => <span key={i} className={currentStep === i ? 'is-current' : ''}>{i % 4 + 1}</span>)}</div>
          {tracks.map((item) => <div className={`track-row ${track.id === item.id ? 'is-selected' : ''} ${item.muted ? 'is-muted' : ''}`} key={item.id}><div className="track-info"><button className="round-button track-preview" onClick={() => previewTrack(item)} aria-label={`试听${trackName(item)}`}><Play size={15} weight="fill" /></button><button className="track-label" onClick={() => selectTrack(item.id)} aria-pressed={track.id === item.id}><strong>{trackName(item)}</strong><span>{signed(item.pitch)} 半音</span></button><button className="mute-button" onClick={() => updateTrack({ muted: !item.muted }, item.id)} aria-label={`${item.muted ? '取消静音' : '静音'}${trackName(item)}`}>{item.muted ? <SpeakerSlash size={15} /> : <SpeakerHigh size={15} />}</button></div><div className="step-cells">{item.steps.map((note, i) => <button key={i} className={`step-cell ${note ? 'is-on' : ''} ${currentStep === i ? 'is-current' : ''} ${selectedId === item.id && selectedStep === i ? 'is-editing' : ''} ${i % 4 === 0 ? 'beat-start' : ''}`} aria-label={`${trackName(item)} 第${i + 1}步${note ? `，已启用，${signed(item.pitch + note.pitch)}半音` : '，空白'}`} aria-pressed={!!note} onClick={(e) => toggleCell(item, i, e)}>{note?.pitch ? <span>{signed(note.pitch)}</span> : null}</button>)}</div></div>)}
          <div className="grid-bottom"><span><i className={playing ? 'status-led on' : 'status-led'} />{playing ? `正在播放 · 第 ${Math.max(0, currentStep) + 1} / 16 步` : '16 步 · 4/4 拍 · 循环乐段'}</span><div><button className="text-button" onClick={undo} disabled={!history.length}><ArrowCounterClockwise size={16} />撤销</button><button className="text-button" onClick={clearTrack}><Trash size={16} />清空此轨</button></div></div>
        </div></div>
      </section>
      <section className="sample-inspector" aria-label="所选声音编辑"><div className="inspector-title"><h2>所选声音</h2><span>{displayName(sample)} · {buffer ? `${duration.toFixed(2)}s` : '加载中…'}</span>{selectedNote && <label className="note-editor">第 {selectedStep + 1} 步偏移 <NumberControl value={selectedNote.pitch} min={-24} max={24} onChange={changeNotePitch} label="所选单步音高偏移" /> 半音 <button className="icon-button" aria-label="关闭单步编辑" onClick={() => setSelectedStep(null)}><X size={14} /></button></label>}</div><div className="inspector-content"><div className="inspector-name"><button className="round-button" aria-label="试听所选声音" onClick={() => previewTrack()}><Play size={22} weight="fill" /></button><div><strong>{trackName(track)}</strong><span>{signed(track.pitch)} 半音</span></div></div>{trimEditor}{toneControls}<div className={`mascot ${playing ? 'is-bopping' : ''}`}><img src="/assets/naiwa.png" alt="捧着肚子大笑的奶蛙" /></div></div></section>
    </> : <>

      <section className="instrument-layout"><aside className="instrument-panel"><div className="instrument-heading"><div><span className="eyebrow">当前音色</span><h2>{displayName(sample)}</h2></div><button className="round-button" onClick={() => previewTrack()} aria-label="试听当前音色"><Play size={20} weight="fill" /></button></div><div className={`mascot-stage ${activePad || playing ? 'is-bopping' : ''}`}><img src="/assets/naiwa.png" alt="奶蛙正在用笑声唱歌" /><span className="mascot-caption">{recording ? '录下来！这段笑声属于你。' : activePad ? '哈哈哈哈哈哈！' : '准备好，让我笑出旋律。'}</span></div><div className="pad-editor">{trimEditor}{toneControls}<p className="pitch-hint">音名是相对参考 · 升降调会改变采样时长</p></div></aside>
        <div className="pads-panel"><div className="pads-caption"><span><span className="status-led on" />16 个音高，随手就是一段</span><label>写入音轨 <select aria-label="打击垫写入音轨" value={track.id} onChange={(e) => selectTrack(e.target.value)}>{tracks.map((item) => <option key={item.id} value={item.id}>{trackName(item)}</option>)}</select></label></div><div className="pad-grid">{PAD_NOTES.map((pad) => <button key={pad.id} className={`music-pad ${activePad === pad.id ? 'is-active' : ''} ${track.steps.some(note => note && note.pitch === pad.pitch) ? 'is-in-pattern' : ''} ${activePad === pad.id && recording ? 'is-recording' : ''}`} onPointerDown={(event) => { if (event.button === 0) hitPad(pad); }} onClick={(event) => { if (event.detail === 0) hitPad(pad); }} aria-label={`${pad.name}，${signed(track.pitch + pad.pitch)}半音，快捷键${pad.key.toUpperCase()}`}><kbd>{pad.key.toUpperCase()}</kbd><strong>{pad.name}</strong><span>{signed(track.pitch + pad.pitch)} 半音</span><i /></button>)}</div><div className="pads-help"><span>点击或敲键盘演奏 · 录制后可切回音序器精修</span><button className="text-button" onClick={clearTrack}><Trash size={15} />清空此轨</button></div></div>
      </section>
      <section className="pad-transport" aria-label="打击垫录制和播放"><button className={`record-button ${recording ? 'is-recording' : ''}`} onClick={toggleRecord} disabled={busy} aria-pressed={recording}><Circle size={20} weight="fill" /><span>{recording ? '结束录制' : '录制'}</span></button>{transport}<div className="loop-strip"><div className="loop-strip-label"><span>{recording ? '正在写入当前步点' : '循环乐段'}</span><span>1 BAR / 16 STEPS</span></div><div className="loop-steps">{Array.from({ length: 16 }, (_, i) => <span key={i} className={`${currentStep === i ? 'is-current' : ''} ${track.steps[i] ? 'has-note' : ''}`}>{i % 4 === 0 ? i / 4 + 1 : ''}</span>)}</div></div><button className="button undo-button" onClick={undo} disabled={!history.length}><ArrowCounterClockwise size={21} />撤销</button>{actionButtons}</section>
    </>}
    <footer className="footer-note"><span>{loading ? '正在加载奶蛙声音…' : view === 'sequencer' ? '单击格子开关声音 · Shift + 单击编辑单步 · 空格播放' : recording ? '录制会覆盖当前音轨的对应步点 · 点击结束录制保留乐段' : '两种模式，共用一首作品。声音、音高与编曲都会保留。'}</span><button className="text-button" onClick={() => setShowInfo(true)}><Info size={16} />声音与使用说明</button></footer>
    {toast && <div className={`toast ${toast.error ? 'is-error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <Info size={19} /> : <Check size={19} />}{toast.message}<button className="icon-button" aria-label="关闭提示" onClick={() => setToast(null)}><X size={15} /></button></div>}
    {showInfo && <div className="modal-backdrop" onClick={() => setShowInfo(false)}><section className="modal" onKeyDown={trapModalFocus} role="dialog" aria-modal="true" aria-labelledby="info-title" onClick={(e) => e.stopPropagation()}><button className="icon-button modal-close" onClick={() => setShowInfo(false)} aria-label="关闭使用说明" autoFocus><X size={24} /></button><span className="eyebrow">SMALL SOUNDS, BIG GROOVES</span><h2 id="info-title">让奶蛙成为你的乐器</h2><p>音序器用格子编节奏；打击垫用 16 个相对音高演奏。按下「录制」，每次击打就会写入当前音轨的亮起步点，循环叠录，也能随时撤销。</p><p>声音库和导入音频都会应用到选中的音轨。裁切一小段「哈」，通常更适合演奏旋律。音高通过改变采样播放速度实现，因此时长也会变化；C4 表示原始相对音高，未经自动定调。</p><p>作品自动保存在此浏览器。点击「保存」可下载含导入声音的工程文件，再用文件夹按钮打开；「导出 WAV」会生成 4 次循环并保留尾音。</p><div className="source-note"><strong>声音来源</strong><p>内置采样来自 <a href="https://github.com/lin-alg/NaiLoong" target="_blank" rel="noreferrer">lin-alg / NaiLoong</a> 公开声音库，包括大笑、Hola、嘎脚塞、嘎嘎滴啦水和嘟噗。素材保留原作者权益，项目内附来源记录。</p></div><button className="button primary" onClick={() => setShowInfo(false)}>开始创作 <Play size={17} weight="fill" /></button></section></div>}
  </main>;
}
