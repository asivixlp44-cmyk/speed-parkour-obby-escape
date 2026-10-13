// Procedural soundtrack and sound effects (Web Audio, no asset files).
// "Parkour Rush": an original 150 BPM electro-pop / drum-and-bass-lite track in E minor for the
// obby (Em - C - G - D). Punchy kicks, a rolling offbeat bass, sidechain-pumped supersaw chords,
// bright plucked arps and a singing lead hook that climbs like a run up a wall. 40 bars: intro,
// verse, build, drop, break, build, drop 2, looping.

let ctx = null, master, musicBus, musicOut, duckFilter, sfxBus, reverb, delay, pump;
let noiseBuf = null, meter = null, wallSrc = null, wallGain = null;
let musicOn = false, schedTimer = null, step = 0, nextTime = 0, ducked = false, intensity = 0;
const settings = { music: 0.6, sfx: 0.8, master: 1, muted: false };
try { Object.assign(settings, JSON.parse(localStorage.getItem('spo_audio') || '{}')); } catch (e) { /* defaults */ }

const BPM = 150, STEP = 60 / BPM / 4;
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
// i - VI - III - VII in E minor
const CHORDS = [
    { root: 28, notes: [55, 59, 64, 67] },   // Em
    { root: 24, notes: [55, 60, 64, 67] },   // C
    { root: 31, notes: [55, 59, 62, 67] },   // G
    { root: 26, notes: [54, 57, 62, 66] },   // D
];
// The hook: [step, midi, length] per chord. A: rising "run up the wall" phrases, B: the answer
const HOOK_A = [
    [[0, 71, 2], [2, 74, 2], [4, 76, 3], [7, 74, 1], [8, 79, 4], [12, 76, 2], [14, 74, 2]],
    [[0, 76, 2], [2, 72, 2], [4, 74, 2], [6, 76, 2], [8, 79, 3], [11, 76, 1], [12, 72, 4]],
    [[0, 74, 2], [2, 71, 2], [4, 74, 2], [6, 79, 2], [8, 83, 4], [12, 81, 2], [14, 79, 2]],
    [[0, 78, 3], [3, 76, 1], [4, 74, 2], [6, 78, 2], [8, 81, 6], [14, 78, 2]],
];
const HOOK_B = [
    [[0, 83, 2], [2, 81, 2], [4, 79, 2], [6, 76, 2], [8, 79, 2], [10, 83, 2], [12, 86, 4]],
    [[0, 84, 3], [3, 83, 1], [4, 79, 2], [6, 76, 2], [8, 79, 4], [12, 76, 2], [14, 72, 2]],
    [[0, 79, 2], [2, 83, 2], [4, 86, 2], [6, 83, 2], [8, 91, 4], [12, 88, 2], [14, 86, 2]],
    [[0, 85, 2], [2, 86, 2], [4, 85, 2], [6, 81, 2], [8, 78, 6], [14, 81, 2]],
];
const SECTION = (bar) => {
    const b = bar % 40;
    if (b < 4) return 'intro';
    if (b < 12) return 'verse';
    if (b < 16) return 'build';
    if (b < 24) return 'drop';
    if (b < 28) return 'break';
    if (b < 32) return 'build';
    return 'drop2';
};

export function initAudio() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
    master = ctx.createGain(); master.gain.value = 1.0;
    comp.connect(master).connect(ctx.destination);
    meter = ctx.createAnalyser(); meter.fftSize = 2048; master.connect(meter);
    musicBus = ctx.createGain();
    duckFilter = ctx.createBiquadFilter(); duckFilter.type = 'lowpass'; duckFilter.frequency.value = 20000; duckFilter.Q.value = 0.5;
    musicOut = ctx.createGain();
    musicBus.connect(duckFilter).connect(musicOut).connect(comp);
    sfxBus = ctx.createGain(); sfxBus.connect(comp);
    pump = ctx.createGain(); pump.connect(musicBus);
    applyVolumes();

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.0, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
        const ch = ir.getChannelData(c);
        for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.6);
    }
    reverb.buffer = ir;
    const revGain = ctx.createGain(); revGain.gain.value = 0.26;
    reverb.connect(revGain).connect(musicBus);
    delay = ctx.createDelay(1);
    delay.delayTime.value = STEP * 3;
    const fb = ctx.createGain(); fb.gain.value = 0.28;
    const dlf = ctx.createBiquadFilter(); dlf.type = 'highpass'; dlf.frequency.value = 700;
    const dlGain = ctx.createGain(); dlGain.gain.value = 0.24;
    delay.connect(dlf).connect(fb).connect(delay);
    dlf.connect(dlGain).connect(musicBus);

    // Wall-run rush: looping filtered noise, faded in while you run on the glass
    wallSrc = ctx.createBufferSource(); wallSrc.buffer = noiseBuf; wallSrc.loop = true;
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 1400; wf.Q.value = 0.8;
    wallGain = ctx.createGain(); wallGain.gain.value = 0;
    wallSrc.connect(wf).connect(wallGain).connect(sfxBus); wallSrc.start();

    document.addEventListener('visibilitychange', () => {
        if (!ctx) return;
        if (document.hidden) ctx.suspend(); else ctx.resume();
    });
}

function applyVolumes() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const m = settings.master ?? 1;
    musicOut.gain.setTargetAtTime(settings.muted ? 0 : settings.music * 1.7 * m * (ducked ? 0.6 : 1), t, 0.08);
    sfxBus.gain.setTargetAtTime(settings.sfx * m, t, 0.05);
}
function save() { try { localStorage.setItem('spo_audio', JSON.stringify(settings)); } catch (e) { /* ignore */ } }
export function getVolumes() { return { ...settings }; }
export function setVolume(kind, v) {
    settings[kind] = Math.max(0, Math.min(1, v));
    save();
    applyVolumes();
}
// The speaker button (top right): music on / off
export function toggleMusic() { settings.muted = !settings.muted; save(); applyVolumes(); return !settings.muted; }
export const musicMuted = () => !!settings.muted;
// Browsers keep audio off until a click or key press: every gesture retries until it's running
export function resumeAudio() { initAudio(); if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); if (ctx && !musicOn && wantMusic) startMusic(); }
const level = () => { if (!meter) return 0; const a = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(a); let p = 0; for (const v of a) p = Math.max(p, Math.abs(v)); return +p.toFixed(3); };
export const audioDebug = () => ({ peak: level(), state: ctx && ctx.state, musicOn, settings: { ...settings }, music: musicOut && musicOut.gain.value, sfx: sfxBus && sfxBus.gain.value });
export const audioSuspended = () => !ctx || ctx.state !== 'running';
// Menus open: the music goes muffled and a little quieter
export function setMusicDuck(on) {
    if (!ctx || on === ducked) return;
    ducked = on;
    duckFilter.frequency.setTargetAtTime(on ? 900 : 20000, ctx.currentTime, 0.12);
    applyVolumes();
}
// 0 in the lobby, up to 1 on the high stages: extra layers in the drops
export function setMusicIntensity(v) { intensity = v; }
export function setWallrunSound(on) {
    if (!ctx || !wallGain) return;
    wallGain.gain.setTargetAtTime(on ? 0.12 : 0, ctx.currentTime, on ? 0.05 : 0.12);
}

// ----- instruments -----
function env(g, t, a, peak, d, sustain, r, end) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + d);
    if (end) { g.gain.setValueAtTime(Math.max(0.0001, sustain), end); g.gain.exponentialRampToValueAtTime(0.0001, end + r); }
}
function noise(t, dur, type, freq, q, gain, out) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out || musicBus);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    return g;
}
function kick(t, gain) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.08);
    g.gain.setValueAtTime(gain || 0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(musicBus); o.start(t); o.stop(t + 0.36);
    noise(t, 0.012, 'highpass', 3000, 0.7, 0.18, musicBus);
    pump.gain.cancelScheduledValues(t);
    pump.gain.setValueAtTime(0.2, t);
    pump.gain.linearRampToValueAtTime(1, t + STEP * 3);
}
function snare(t, gain) {
    noise(t, 0.14, 'bandpass', 1900, 0.9, gain, musicBus);
    noise(t, 0.3, 'bandpass', 2200, 0.8, gain * 0.4, reverb);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(240, t); o.frequency.exponentialRampToValueAtTime(160, t + 0.06);
    g.gain.setValueAtTime(gain * 0.7, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g).connect(musicBus); o.start(t); o.stop(t + 0.1);
}
function hat(t, gain, open) { noise(t, open ? 0.16 : 0.035, 'highpass', 8000, 0.7, gain, musicBus); }
function clap(t, gain) {
    for (let i = 0; i < 3; i++) noise(t + i * 0.009, 0.08, 'bandpass', 1500, 1.1, gain, musicBus);
    noise(t, 0.3, 'bandpass', 1800, 0.9, gain * 0.5, reverb);
}
function bell(t, n, dur, gain) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.4, dur * 2.2));
    g.connect(musicBus); g.connect(reverb); g.connect(delay);
    for (const [k, a] of [[1, 1], [2.01, 0.35], [3.99, 0.16]]) {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.value = midi(n) * k; og.gain.value = a;
        o.connect(og).connect(g); o.start(t); o.stop(t + Math.max(0.45, dur * 2.3));
    }
}
function pluck(t, n, gain) {
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(midi(n), t);
    f.type = 'lowpass'; f.frequency.setValueAtTime(5200, t); f.frequency.exponentialRampToValueAtTime(700, t + 0.16); f.Q.value = 4;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(f).connect(g); g.connect(musicBus); g.connect(delay);
    o.start(t); o.stop(t + 0.22);
}
function supersaw(t, notes, dur, gain, cutoff) {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(cutoff * 2.2, t); f.frequency.exponentialRampToValueAtTime(cutoff, t + dur * 0.6);
    env(g, t, 0.006, gain, dur * 0.5, gain * 0.55, 0.08, t + dur);
    f.connect(g); g.connect(pump); g.connect(reverb);
    for (const n of notes) for (const det of [-14, 0, 14]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(n); o.detune.value = det + (Math.random() - 0.5) * 4;
        o.connect(f); o.start(t); o.stop(t + dur + 0.12);
    }
}
function pad(t, notes, dur, gain, cutoff) {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.Q.value = 0.7; f.frequency.value = cutoff;
    env(g, t, dur * 0.25, gain, dur * 0.2, gain * 0.8, 0.3, t + dur);
    f.connect(g); g.connect(pump); g.connect(reverb);
    for (const n of notes) for (const det of [-8, 8]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(n); o.detune.value = det;
        o.connect(f); o.start(t); o.stop(t + dur + 0.35);
    }
}
// Rolling bass: a growly saw through a low filter, with a sub sine under it
function bass(t, n, dur, gain) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(260, t + dur); f.Q.value = 5;
    env(g, t, 0.004, gain || 0.3, dur * 0.6, (gain || 0.3) * 0.6, 0.04, t + dur);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(n);
    const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = midi(n); const sg = ctx.createGain(); sg.gain.value = 0.9;
    o.connect(f).connect(g); sub.connect(sg).connect(g); g.connect(pump);
    o.start(t); o.stop(t + dur + 0.1); sub.start(t); sub.stop(t + dur + 0.1);
}
function riser(t, dur) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.5;
    f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(9000, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + dur * 0.95); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    src.connect(f).connect(g); g.connect(musicBus); g.connect(reverb);
    src.start(t); src.stop(t + dur + 0.1);
}
function impact(t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.9);
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    o.connect(g).connect(musicBus); o.start(t); o.stop(t + 1.2);
    noise(t, 1.4, 'highpass', 3500, 0.5, 0.13, reverb);
}
// The lead: detuned squares and a saw with vibrato and an octave sine on top
function lead(t, n, dur, gain) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = 1.4;
    f.frequency.setValueAtTime(6000, t); f.frequency.exponentialRampToValueAtTime(2800, t + Math.min(0.4, dur));
    env(g, t, 0.008, gain, 0.12, gain * 0.75, 0.09, t + dur);
    f.connect(g); g.connect(musicBus); g.connect(delay); g.connect(reverb);
    const vib = ctx.createOscillator(), vg = ctx.createGain();
    vib.frequency.value = 6; vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(midi(n) * 0.01, t + Math.min(0.25, dur));
    vib.connect(vg);
    for (const [type, det, k, oct] of [['square', -9, 0.4, 0], ['square', 9, 0.4, 0], ['sawtooth', 0, 0.25, 0], ['sine', 0, 0.3, 12]]) {
        const o = ctx.createOscillator(), og = ctx.createGain();
        o.type = type; o.detune.value = det; og.gain.value = k;
        o.frequency.setValueAtTime(midi(n + oct), t);
        vg.connect(o.frequency);
        o.connect(og).connect(f); o.start(t); o.stop(t + dur + 0.18);
    }
    vib.start(t); vib.stop(t + dur + 0.18);
}
function hookNotes(sec, bar) { return (sec === 'drop2' ? HOOK_B : HOOK_A)[bar % 4]; }
// Breakbeat-ish pattern for the drops: kick on 1 and the "and" of 3, snare on 2 and 4
const KICKS = [0, 10], GHOST = [7, 13];

function playStep(s, t) {
    const bar = Math.floor(s / 16), i = s % 16, b = bar % 40, sec = SECTION(bar), chord = CHORDS[bar % 4];
    if (sec === 'intro' || sec === 'break') {
        if (i === 0) pad(t, chord.notes, STEP * 16, 0.045, sec === 'intro' ? 900 + (b % 4) * 500 : 1800);
        if (i === 0) bass(t, chord.root + 12, STEP * 14, 0.12);
        if (i % 2 === 0) pluck(t, chord.notes[(i / 2) % 4] + 12, 0.025);
        if (i % 4 === 2) hat(t, 0.03);
        for (const [at, n, l] of HOOK_A[bar % 4]) if (at === i && sec === 'break') bell(t, n + 12, STEP * l, 0.05);
        if ((b === 3 || b === 27) && i >= 8) snare(t, 0.04 + (i - 8) * 0.012);
        return;
    }
    if (sec === 'verse') {
        if (KICKS.includes(i)) kick(t, 0.7);
        if (i === 4 || i === 12) snare(t, 0.12);
        if (i % 2 === 0) hat(t, i % 4 === 2 ? 0.06 : 0.035);
        if (i % 2 === 1) bass(t, chord.root + 12 + (i % 4 === 3 ? 12 : 0), STEP * 0.9, 0.22);
        pluck(t, chord.notes[[0, 2, 1, 3, 2, 0, 3, 1][(i >> 1) % 8]] + 12, i % 2 ? 0.018 : 0.03);
        if (i === 0) pad(t, chord.notes, STEP * 16, 0.028, 1300);
        if (bar % 4 === 3 && i >= 8) for (const [at, n, l] of HOOK_A[3]) if (at === i) lead(t, n, STEP * l, 0.06);
        return;
    }
    if (sec === 'build') {
        const k = b % 4;
        if (k === 0 && i === 0) riser(t, STEP * 64);
        const every = k < 2 ? 4 : k === 2 ? 2 : 1;
        if (i % every === 0) snare(t, 0.05 + (k * 16 + i) / 64 * 0.12);
        if (k < 3 && i % 4 === 0) kick(t, 0.6);
        if (i === 0) supersaw(t, chord.notes, STEP * 14, 0.03, 800 + k * 900);
        if (i % 2 === 0) pluck(t, chord.notes[(i / 2) % 4] + 12, 0.03);
        if (i % 2 === 1) bass(t, chord.root + 12, STEP * 0.9, 0.16);
        if (k === 3) for (const [at, n, l] of HOOK_A[bar % 4]) if (at === i) lead(t, n, STEP * l, 0.07);
        return;
    }
    // Drops
    if ((b === 16 || b === 32) && i === 0) impact(t);
    if (KICKS.includes(i) || (i === 8 && bar % 2)) kick(t, 0.9);
    if (i === 4 || i === 12) { snare(t, 0.17); clap(t, 0.08); }
    if (GHOST.includes(i)) snare(t, 0.04);
    hat(t, i % 2 ? 0.035 : 0.06, i % 4 === 2);
    if (i % 4 === 0) supersaw(t, chord.notes.map((n) => n + 12), STEP * 3.4, 0.04, 3400);
    if (i % 2 === 1 || i === 0) bass(t, chord.root + (i % 4 === 3 ? 24 : 12), STEP * 0.95, 0.3);
    for (const [at, n, l] of hookNotes(sec, bar)) if (at === i) {
        lead(t, n, STEP * l, 0.1);
        if (sec === 'drop2') bell(t, n + 12, STEP * l, 0.04);
    }
    if (i % 2 === 1) pluck(t, chord.notes[(i >> 1) % 4] + 24, 0.016);
    if (intensity > 0.6 && i % 4 === 2) bell(t, chord.notes[(i >> 2) % 4] + 24, STEP, 0.028);
    if (i === 14 && bar % 4 === 3) { snare(t, 0.1); snare(t + STEP / 2, 0.12); }
}

function scheduler() {
    while (nextTime < ctx.currentTime + 0.15) {
        playStep(step, nextTime);
        nextTime += STEP;
        step++;
    }
}
let wantMusic = false;
export function startMusic() {
    wantMusic = true;
    if (!ctx || musicOn) return;
    musicOn = true;
    step = 0; nextTime = ctx.currentTime + 0.1;
    schedTimer = setInterval(scheduler, 25);
}
export function stopMusic() { musicOn = false; clearInterval(schedTimer); }

// ----- sound effects -----
function tone(t, type, f0, f1, dur, gain, out) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out || sfxBus); o.start(t); o.stop(t + dur + 0.05);
}
function sweep(t, f0, f1, dur, gain, q) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q || 2;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.7);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(sfxBus); src.start(t, Math.random()); src.stop(t + dur + 0.05);
}
// A sneaker step on studded plastic: a soft low thump and a little scuff, pitched a bit each time
export function footstep(k) {
    if (!ctx || settings.sfx <= 0) return;
    const t = ctx.currentTime + 0.002, p = 0.85 + Math.random() * 0.3;
    noise(t, 0.05, 'lowpass', 500 * p, 1, 0.16 * (k || 1), sfxBus);
    noise(t, 0.025, 'bandpass', 2600 * p, 2, 0.045 * (k || 1), sfxBus);
}
const SFX = {
    click(t) { tone(t, 'sine', 1150, 1700, 0.05, 0.12); noise(t, 0.015, 'bandpass', 5000, 2, 0.08, sfxBus); },
    clickBuy(t) { tone(t, 'sine', 900, 1500, 0.05, 0.12); tone(t + 0.05, 'sine', 1500, 2100, 0.06, 0.09); },
    jump(t) { tone(t, 'sine', 280, 640, 0.12, 0.2); noise(t, 0.04, 'lowpass', 600, 1, 0.12, sfxBus); },
    // Double jump: an airy whoosh with a bright blip on top
    double(t) { sweep(t, 500, 3200, 0.3, 0.2, 1.6); tone(t, 'triangle', midi(84), midi(91), 0.12, 0.1); },
    // Super Jump: a deep boom launching up, then a rising whoosh
    superJump(t) {
        tone(t, 'sine', 140, 40, 0.4, 0.5);
        noise(t, 0.25, 'lowpass', 900, 1, 0.3, sfxBus);
        sweep(t + 0.04, 300, 6000, 0.55, 0.22, 1.2);
        tone(t + 0.05, 'square', midi(72), midi(96), 0.3, 0.06);
    },
    dash(t) { sweep(t, 2400, 500, 0.32, 0.3, 1); noise(t, 0.06, 'highpass', 4000, 0.7, 0.15, sfxBus); tone(t, 'sawtooth', 600, 180, 0.18, 0.06); },
    slide(t) { sweep(t, 1800, 700, 0.6, 0.22, 0.8); noise(t, 0.5, 'lowpass', 1200, 0.8, 0.1, sfxBus); },
    wallGrab(t) { noise(t, 0.05, 'bandpass', 1200, 2, 0.2, sfxBus); tone(t, 'triangle', 420, 380, 0.06, 0.1); },
    grab(t) { noise(t, 0.04, 'bandpass', 900, 2.5, 0.25, sfxBus); tone(t, 'triangle', 330, 300, 0.07, 0.14); },
    swing(t) { sweep(t, 300, 1600, 0.75, 0.22, 1.4); },
    whoosh(t) { sweep(t, 400, 3500, 0.45, 0.3, 1.6); },
    climbStep(t) { noise(t, 0.04, 'bandpass', 900 + Math.random() * 400, 2, 0.16, sfxBus); },
    land(t) { noise(t, 0.08, 'lowpass', 400, 1, 0.35, sfxBus); tone(t, 'sine', 120, 60, 0.12, 0.25); },
    gain(t) { tone(t, 'triangle', midi(88 + Math.floor(Math.random() * 3) * 2), null, 0.05, 0.04); },
    gate(t) {
        [84, 88, 91, 96, 100].forEach((n, i) => tone(t + i * 0.035, 'sine', midi(n), null, 0.5, 0.09));
        tone(t, 'triangle', 220, 880, 0.35, 0.12);
    },
    zap(t) { tone(t, 'square', 1400, 180, 0.22, 0.16); noise(t, 0.15, 'highpass', 3000, 0.8, 0.18, sfxBus); },
    crush(t) { tone(t, 'sine', 120, 35, 0.4, 0.55); noise(t, 0.35, 'lowpass', 700, 1, 0.45, sfxBus); },
    sizzle(t) { noise(t, 0.8, 'highpass', 2500, 0.6, 0.25, sfxBus); tone(t, 'sine', 300, 90, 0.4, 0.12); },
    // The classic "oof"
    death(t) {
        const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
        o.type = 'sawtooth'; o.frequency.setValueAtTime(230, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.22);
        f.type = 'bandpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(500, t + 0.22); f.Q.value = 3;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
        o.connect(f).connect(g).connect(sfxBus); o.start(t); o.stop(t + 0.3);
        noise(t + 0.05, 0.3, 'lowpass', 900, 1, 0.2, sfxBus);
    },
    levelUp(t) { [72, 76, 79, 84].forEach((n, i) => tone(t + i * 0.08, 'square', midi(n), null, 0.25, 0.1)); tone(t + 0.32, 'triangle', midi(88), null, 0.6, 0.18); },
    buy(t) { [79, 84, 88, 91, 96].forEach((n, i) => tone(t + i * 0.05, 'sine', midi(n), null, 0.3, 0.15)); },
    denied(t) { tone(t, 'square', 220, 160, 0.14, 0.12); tone(t + 0.14, 'square', 180, 120, 0.18, 0.12); },
    cheer(t) {
        for (let i = 0; i < 6; i++) tone(t + i * 0.04, 'sine', 180 - i * 8, 90, 0.08, 0.2);
        [72, 76, 79, 84, 88].forEach((n, i) => tone(t + 0.25 + i * 0.07, 'square', midi(n), null, 0.3, 0.08));
        noise(t + 0.25, 0.6, 'highpass', 4000, 0.7, 0.12, sfxBus);
    },
    teleport(t) { for (let i = 0; i < 8; i++) tone(t + i * 0.03, 'sine', midi(76 + i * 3), null, 0.15, 0.07); },
    firework(t) { tone(t, 'sine', 900, 200, 0.35, 0.05); noise(t + 0.35, 0.4, 'lowpass', 2500, 0.8, 0.3, sfxBus); },
    quest(t) { [84, 91, 96].forEach((n, i) => tone(t + i * 0.09, 'triangle', midi(n), null, 0.35, 0.12)); },
};
export function sfx(name) {
    if (!ctx || !SFX[name] || settings.sfx <= 0) return;
    SFX[name](ctx.currentTime + 0.005);
}
