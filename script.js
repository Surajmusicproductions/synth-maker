// Song → Synth WebAudio engine (Improved Timbre Learning)

// ---------- DOM ----------
const fileEl = document.getElementById('file');
const enableEl = document.getElementById('enable');
const player = document.getElementById('player');
const statusEl = document.getElementById('status');
const playBtn = document.getElementById('play-original');
const pauseBtn = document.getElementById('pause-original');
const waveEl = document.getElementById('wave');
const unisonEl = document.getElementById('unison');
const detuneEl = document.getElementById('detune'); const detuneV = document.getElementById('detune-v');
const cutoffEl = document.getElementById('cutoff'); const cutoffV = document.getElementById('cutoff-v');
const qEl = document.getElementById('q'); const qV = document.getElementById('q-v');
const attackEl = document.getElementById('attack'); const attackV = document.getElementById('attack-v');
const decayEl = document.getElementById('decay'); const decayV = document.getElementById('decay-v');
const sustainEl = document.getElementById('sustain'); const sustainV = document.getElementById('sustain-v');
const releaseEl = document.getElementById('release'); const releaseV = document.getElementById('release-v');
const velocityEl = document.getElementById('velocity'); const velocityV = document.getElementById('velocity-v');
const holdEl = document.getElementById('hold');
const panicEl = document.getElementById('panic');
const learnBtn = document.getElementById('learn');
const bypassEqBtn = document.getElementById('bypass-eq');
const flatEqBtn = document.getElementById('flat-eq');
const learnStatus = document.getElementById('learn-status');
const pianoDiv = document.getElementById('piano');

// ---------- Audio graph state ----------
let ac = null;
let master = null;
let eqIn = null, eqOut = null;
let eqNodes = [];
let eqBypass = false;
let originalArrayBuffer = null;
let audioBuffer = null;
let loadedName = null;
let sustain = false;
let activeVoices = new Map();
let heldKeys = new Set();
let learnedWave = null;

// ---------- Piano UI ----------
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const START_MIDI = 48; // C3
const END_MIDI   = 83; // B5
function midiToNote(m) { return NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1); }
function noteToFreqFromMidi(m) { return 440 * Math.pow(2, (m - 69) / 12); }
function buildKeyboard() {
  pianoDiv.innerHTML = '';
  for (let m = START_MIDI; m <= END_MIDI; m++) {
    const pc = m % 12;
    const isBlack = [1, 3, 6, 8, 10].includes(pc);
    if (!isBlack) {
      const white = document.createElement('div');
      white.className = 'white'; white.dataset.midi = m;
      const wl = document.createElement('div'); wl.className = 'label'; wl.textContent = midiToNote(m);
      white.appendChild(wl); pianoDiv.appendChild(white);
      if (![4, 11].includes(pc)) {
        const black = document.createElement('div');
        black.className = 'black'; black.dataset.midi = m + 1;
        const bl = document.createElement('div'); bl.className = 'label'; bl.textContent = midiToNote(m + 1);
        black.appendChild(bl); white.appendChild(black);
      }
    }
  }
}
buildKeyboard();

function keyElForMidi(m) { return pianoDiv.querySelector(`[data-midi="${m}"]`); }
function pressVisual(m) { const el = keyElForMidi(m); if (el) el.classList.add('playing'); }
function releaseVisual(m) { const el = keyElForMidi(m); if (el) el.classList.remove('playing'); }

// ---------- Piano events ----------
pianoDiv.addEventListener('pointerdown', e => {
  const key = e.target.closest('.white, .black');
  if (!key) return;
  const midi = parseInt(key.dataset.midi, 10);
  if (!ac) { alert('Click "Enable Audio" first.'); return; }
  player.pause(); noteOn(midi); heldKeys.add(midi);
  key.setPointerCapture(e.pointerId);
});
pianoDiv.addEventListener('pointerup', e => {
  const key = e.target.closest('.white, .black');
  if (!key) return;
  const midi = parseInt(key.dataset.midi, 10);
  heldKeys.delete(midi);
  if (!sustain) noteOff(midi);
});
document.addEventListener('pointercancel', () => { if (!sustain) allNotesOff(); });

// ---------- Controls display ----------
function bindVal(input, label, fmt = v => v) {
  const fn = () => label.textContent = fmt(input.value);
  input.addEventListener('input', fn); fn();
}
[ [detuneEl, detuneV, v=>v], [cutoffEl, cutoffV, v=>Math.round(v)], [qEl, qV, v=>parseFloat(v).toFixed(1)],
  [attackEl, attackV], [decayEl, decayV], [sustainEl, sustainV, v=>parseFloat(v).toFixed(2)], [releaseEl, releaseV], [velocityEl, velocityV, v=>parseFloat(v).toFixed(2)]
].forEach(args=>bindVal(...args));

holdEl.addEventListener('change', () => {
  sustain = holdEl.checked;
  if (!sustain) { for (const m of [...activeVoices.keys()]) { if (!heldKeys.has(m)) noteOff(m); } }
});
panicEl.addEventListener('click', allNotesOff);
function allNotesOff() { for (const [m, v] of activeVoices) v.stopNow(); activeVoices.clear(); pianoDiv.querySelectorAll('.white, .black').forEach(el => el.classList.remove('playing')); }

// ---------- Audio setup ----------
enableEl.addEventListener('click', async () => {
  if (!ac) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain(); master.gain.value = 0.9; master.connect(ac.destination);
    eqIn = ac.createGain(); buildEQChainOnce();
    enableEl.textContent = 'Audio Ready'; enableEl.disabled = true;
    if (originalArrayBuffer) { learnBtn.disabled = false; bypassEqBtn.disabled = false; flatEqBtn.disabled = false; }
  } else if (ac.state === 'suspended') await ac.resume();
});
function buildEQChainOnce() {
  try { eqIn.disconnect(); } catch {}
  eqOut = ac.createGain();
  const centers = [100, 200, 400, 800, 1600, 3200, 6400, 12000];
  eqNodes = centers.map(f => { const bq = ac.createBiquadFilter(); bq.type = 'peaking'; bq.frequency.value = f; bq.Q.value = 1.0; bq.gain.value = 0.0; return bq; });
  let node = eqIn; for (const f of eqNodes) { node.connect(f); node = f; } node.connect(eqOut); eqOut.connect(master);
  eqBypass = false; bypassEqBtn.textContent = 'EQ Bypass OFF';
}

// ---------- File load ----------
fileEl.addEventListener('change', async () => {
  const file = fileEl.files?.[0]; if (!file) return;
  player.src = URL.createObjectURL(file); playBtn.disabled = false; pauseBtn.disabled = false;
  statusEl.textContent = `Loaded: ${file.name}`; loadedName = file.name;
  originalArrayBuffer = await file.arrayBuffer();
  if (ac) { learnBtn.disabled = false; bypassEqBtn.disabled = false; flatEqBtn.disabled = false; }
  learnStatus.textContent = '—';
});
playBtn.addEventListener('click', () => player.play());
pauseBtn.addEventListener('click', () => player.pause());

// ---------- Voice ----------
class Voice {
  constructor(midi) {
    this.midi = midi; this.freq = noteToFreqFromMidi(midi);
    this.oscMix = ac.createGain(); this.oscMix.gain.value = 1.0;
    this.filter = ac.createBiquadFilter(); this.filter.type = 'lowpass';
    this.amp = ac.createGain(); this.amp.gain.setValueAtTime(0, ac.currentTime);
    this.oscMix.connect(this.filter); this.filter.connect(this.amp); this.amp.connect(eqIn);
    this.oscs = [];
    const u = Math.max(1, parseInt(unisonEl.value, 10) || 1);
    for (let k = 0; k < u; k++) {
      const osc = ac.createOscillator();
      if (learnedWave) osc.setPeriodicWave(learnedWave);
      else {
        const oscType = (waveEl.value || 'Saw').toLowerCase();
        osc.type = oscType === 'saw' ? 'sawtooth' : oscType;
      }
      osc.frequency.setValueAtTime(this.freq, ac.currentTime);
      osc.detune.value = (k - (u-1)/2) * parseFloat(detuneEl.value || 0);
      osc.connect(this.oscMix); osc.start();
      this.oscs.push({ osc });
    }
    this.updateFilter(); this.gateOn();
  }
  updateFilter() { this.filter.frequency.setValueAtTime(parseFloat(cutoffEl.value), ac.currentTime); this.filter.Q.setValueAtTime(parseFloat(qEl.value), ac.currentTime); }
  gateOn() {
    const vel = parseFloat(velocityEl.value); const now = ac.currentTime;
    const a = parseFloat(attackEl.value) / 1000; const d = parseFloat(decayEl.value) / 1000; const s = parseFloat(sustainEl.value);
    this.amp.gain.cancelScheduledValues(now); this.amp.gain.setValueAtTime(0, now);
    this.amp.gain.linearRampToValueAtTime(vel, now + Math.max(0.001, a));
    this.amp.gain.linearRampToValueAtTime(vel * s, now + Math.max(0.001, a + d));
    pressVisual(this.midi);
  }
  gateOff() {
    const now = ac.currentTime; const r = parseFloat(releaseEl.value) / 1000;
    this.amp.gain.cancelScheduledValues(now); const current = this.amp.gain.value;
    this.amp.gain.setValueAtTime(current, now);
    this.amp.gain.linearRampToValueAtTime(0, now + Math.max(0.01, r));
    setTimeout(() => this.stopNow(), Math.max(10, r * 1000 + 20));
    releaseVisual(this.midi);
  }
  stopNow() {
    try { for (const { osc } of this.oscs) { osc.stop(); osc.disconnect(); } this.oscMix.disconnect(); this.filter.disconnect(); this.amp.disconnect(); } catch {}
  }
}
function noteOn(midi) { if (activeVoices.has(midi)) { activeVoices.get(midi).stopNow(); activeVoices.delete(midi); } const v = new Voice(midi); activeVoices.set(midi, v); player.pause(); }
function noteOff(midi) { const v = activeVoices.get(midi); if (!v) return; v.gateOff(); activeVoices.delete(midi); }

// ---------- Learn Timbre (FFT-based) ----------
function sliceBuffer(buf, startSec, durSec) {
  const sr = buf.sampleRate; const start = Math.max(0, Math.min(buf.duration - 0.001, startSec));
  const frames = Math.floor(Math.min(durSec, buf.duration - start) * sr);
  const out = new AudioBuffer({ length: frames, numberOfChannels: 1, sampleRate: sr });
  const tmp = new Float32Array(frames); buf.copyFromChannel(tmp, 0, Math.floor(start * sr));
  out.copyToChannel(tmp, 0, 0); return out;
}
function hannWindow(len) { const win = new Float32Array(len); for (let i = 0; i < len; i++) win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (len - 1))); return win; }
function fftMagPhase(signal) {
  const N = signal.length; const re = new Float32Array(N); const im = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    for (let n = 0; n < N; n++) {
      const ang = (2 * Math.PI * k * n) / N;
      re[k] += signal[n] * Math.cos(ang);
      im[k] -= signal[n] * Math.sin(ang);
    }
  }
  const mag = new Float32Array(N / 2); const phase = new Float32Array(N / 2);
  for (let k = 0; k < N / 2; k++) { mag[k] = Math.sqrt(re[k]**2 + im[k]**2); phase[k] = Math.atan2(im[k], re[k]); }
  return { mag, phase };
}

learnBtn.addEventListener('click', async () => {
  if (!ac) { alert('Click Enable Audio first.'); return; }
  if (!originalArrayBuffer) { learnStatus.textContent = 'Load audio first.'; return; }
  learnStatus.textContent = 'Analyzing…';
  try { audioBuffer = await ac.decodeAudioData(originalArrayBuffer.slice(0)); } catch { learnStatus.textContent = 'Decode failed.'; return; }
  const win = Math.min(0.5, Math.max(0.2, audioBuffer.duration * 0.25));
  const start = Math.max(0, (audioBuffer.duration - win) / 2);
  const snip = sliceBuffer(audioBuffer, start, win);
  let data = snip.getChannelData(0);
  const windowed = new Float32Array(data.length); const winFn = hannWindow(data.length);
  for (let i = 0; i < data.length; i++) windowed[i] = data[i] * winFn[i];
  const { mag, phase } = fftMagPhase(windowed);

  // Find fundamental (max peak ignoring DC)
  let fundamentalIndex = 1; let maxVal = 0;
  for (let i = 1; i < mag.length; i++) { if (mag[i] > maxVal) { maxVal = mag[i]; fundamentalIndex = i; } }

  // Extract first N harmonics
  const N = 32; const reH = new Float32Array(N); const imH = new Float32Array(N);
  for (let h = 1; h < N; h++) {
    const idx = fundamentalIndex * h;
    if (idx < mag.length) {
      const ampNorm = mag[idx] / maxVal;
      reH[h] = ampNorm * Math.cos(phase[idx]);
      imH[h] = ampNorm * Math.sin(phase[idx]);
    }
  }
  learnedWave = ac.createPeriodicWave(reH, imH, { disableNormalization: false });
  learnStatus.textContent = 'Timbre learned from file.';
});

// EQ bypass & flat
bypassEqBtn.addEventListener('click', () => {
  if (!ac) return; eqBypass = !eqBypass; bypassEqBtn.textContent = eqBypass ? 'EQ Bypass ON' : 'EQ Bypass OFF';
  try { eqIn.disconnect(); } catch {}
  if (eqBypass) { try { eqOut.disconnect(); } catch {}; eqIn.connect(master); } else { buildEQChainOnce(); }
});
flatEqBtn.addEventListener('click', () => { if (!ac) return; for (const n of eqNodes) n.gain.setTargetAtTime(0, ac.currentTime, 0.05); learnStatus.textContent = 'EQ flattened. Learned waveform still active.'; });

// Live control updates
cutoffEl.addEventListener('input', () => { for (const [, v] of activeVoices) v.updateFilter(); });
qEl.addEventListener('input', () => { for (const [, v] of activeVoices) v.updateFilter(); });
