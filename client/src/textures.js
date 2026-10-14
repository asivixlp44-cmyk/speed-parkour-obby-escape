import { T, texFrom } from './engine.js';

// Canvas-generated textures for the parkour hall, drawn once and cached: the red climbing wall
// with its white chevrons, the cyan arrow carpet, the blue glass wall-run panels with light
// streaks, lava, hazard stripes, the spawn pad's black star, laser beams.
const cache = new Map();
const once = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };
const css = (h) => '#' + h.toString(16).padStart(6, '0');
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; }
function seeded(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
const rep = (t) => { t.wrapS = t.wrapT = T.RepeatWrapping; return t; };

// Climb wall (reference: a red panel with a big white chevron, soft pink glow at its tips).
// One tile = one chevron; the wall repeats it upward.
export function chevronTexture() {
    return once('chevron', () => {
        const W = 256, H = 256, c = canvas(W, H), x = c.getContext('2d');
        const bg = x.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#ff1a2e'); bg.addColorStop(1, '#e00a1e');
        x.fillStyle = bg; x.fillRect(0, 0, W, H);
        // Chevron: thick upward arrow, white in the middle fading to pink at the arms
        const g = x.createLinearGradient(0, H * 0.2, 0, H * 0.85);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, '#fff4f6'); g.addColorStop(1, 'rgba(255,190,200,0.85)');
        x.fillStyle = g;
        x.beginPath();
        x.moveTo(W * 0.5, H * 0.18);
        x.lineTo(W * 0.94, H * 0.62); x.lineTo(W * 0.94, H * 0.86);
        x.lineTo(W * 0.5, H * 0.46);
        x.lineTo(W * 0.06, H * 0.86); x.lineTo(W * 0.06, H * 0.62);
        x.closePath(); x.fill();
        // Soft glow around it
        x.globalCompositeOperation = 'lighter';
        x.shadowColor = 'rgba(255,255,255,0.5)'; x.shadowBlur = 18;
        x.strokeStyle = 'rgba(255,255,255,0.18)'; x.lineWidth = 6; x.stroke();
        return rep(texFrom(c));
    });
}
// The lobby path: light cyan with rows of white triangles pointing to Stage 1 (+v)
export function carpetTexture() {
    return once('carpet', () => {
        const N = 256, c = canvas(N), x = c.getContext('2d');
        x.fillStyle = '#6ad4fd'; x.fillRect(0, 0, N, N);
        // Faint studs
        x.strokeStyle = 'rgba(255,255,255,0.12)'; x.lineWidth = 2;
        for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) x.strokeRect(i * 32 + 5, j * 32 + 5, 22, 22);
        x.fillStyle = 'rgba(255,255,255,0.92)';
        for (const [cx, cy] of [[64, 96], [192, 96], [128, 224], [0, 224], [256, 224]]) {
            x.beginPath(); x.moveTo(cx, cy - 46); x.lineTo(cx + 40, cy + 18); x.lineTo(cx - 40, cy + 18); x.closePath(); x.fill();
        }
        return rep(texFrom(c));
    });
}
// Wall-run glass (reference: bright blue panels with long white light streaks)
export function glassTexture() {
    return once('glass', () => {
        const W = 256, H = 256, c = canvas(W, H), x = c.getContext('2d');
        const g = x.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, '#2ec4ff'); g.addColorStop(0.5, '#7ae0ff'); g.addColorStop(1, '#16aaf0');
        x.fillStyle = g; x.fillRect(0, 0, W, H);
        // Studs
        x.strokeStyle = 'rgba(0,60,140,0.18)'; x.lineWidth = 2;
        for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) x.strokeRect(i * 32 + 4, j * 32 + 4, 24, 24);
        // Streaks: slanted white bars
        x.fillStyle = 'rgba(255,255,255,0.92)';
        for (const [x0, w] of [[30, 26], [120, 12], [176, 34]]) {
            x.beginPath(); x.moveTo(x0, 0); x.lineTo(x0 + w, 0); x.lineTo(x0 + w - 70, H); x.lineTo(x0 - 70, H); x.closePath(); x.fill();
            x.beginPath(); x.moveTo(x0 + W, 0); x.lineTo(x0 + w + W, 0); x.lineTo(x0 + w - 70 + W, H); x.lineTo(x0 - 70 + W, H); x.closePath(); x.fill();
        }
        return rep(texFrom(c));
    });
}
// Lava: hot orange studs with brighter cracks (scrolled slowly)
export function lavaTexture(color) {
    return once('lava|' + color, () => {
        const N = 256, c = canvas(N), x = c.getContext('2d'), rnd = seeded(7);
        x.fillStyle = css(color); x.fillRect(0, 0, N, N);
        for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
            x.fillStyle = 'rgba(255,220,120,0.14)'; x.fillRect(i * 32 + 4, j * 32 + 4, 24, 24);
            x.fillStyle = 'rgba(120,20,0,0.18)'; x.fillRect(i * 32 + 4, j * 32 + 26, 24, 2);
        }
        x.strokeStyle = 'rgba(255,240,140,0.55)'; x.lineWidth = 3;
        for (let k = 0; k < 9; k++) {
            x.beginPath();
            let px = rnd() * N, py = rnd() * N;
            x.moveTo(px, py);
            for (let s = 0; s < 5; s++) { px += (rnd() - 0.5) * 60; py += (rnd() - 0.5) * 60; x.lineTo(px, py); }
            x.stroke();
        }
        return rep(texFrom(c));
    });
}
// Hazard stripes (crusher beams): diagonal bands
export function stripeTexture(c1, c2, n) {
    return once('stripe|' + c1 + c2 + n, () => {
        const N = 128, c = canvas(N), x = c.getContext('2d');
        x.fillStyle = css(c1); x.fillRect(0, 0, N, N);
        x.fillStyle = css(c2);
        const w = N / (n * 2);
        for (let k = -n * 2; k < n * 4; k++) {
            if (k % 2) continue;
            x.beginPath(); x.moveTo(k * w, 0); x.lineTo(k * w + w, 0); x.lineTo(k * w + w + N, N); x.lineTo(k * w + N, N); x.fill();
        }
        return rep(texFrom(c));
    });
}
// Spawn pad: white with a black eight-point tribal star
export function spawnTexture() {
    return once('spawn', () => {
        const N = 512, c = canvas(N), x = c.getContext('2d');
        x.fillStyle = '#f4f2ff'; x.fillRect(0, 0, N, N);
        x.translate(N / 2, N / 2);
        x.fillStyle = '#16121f';
        for (let k = 0; k < 8; k++) {
            x.save(); x.rotate(k * Math.PI / 4);
            x.beginPath();
            x.moveTo(0, -30); x.quadraticCurveTo(60, -120, 30, -235); x.quadraticCurveTo(10, -150, -22, -40); x.closePath();
            x.fill();
            x.restore();
        }
        x.beginPath(); x.arc(0, 0, 46, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#f4f2ff'; x.beginPath(); x.arc(0, 0, 26, 0, Math.PI * 2); x.fill();
        return texFrom(c);
    });
}
// Laser beam: bright core fading to the edges across v
export function beamTexture() {
    return once('beam', () => {
        const c = canvas(4, 64), x = c.getContext('2d');
        const g = x.createLinearGradient(0, 0, 0, 64);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.4, 'rgba(255,255,255,0.7)'); g.addColorStop(0.5, 'rgba(255,255,255,1)');
        g.addColorStop(0.6, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(0, 0, 4, 64);
        return texFrom(c);
    });
}
// Rainbow band (x100 treadmill, finale)
export function rainbowTexture() {
    return once('rainbow', () => {
        const N = 256, c = canvas(N, 16), x = c.getContext('2d');
        const g = x.createLinearGradient(0, 0, N, 0);
        ['#ff5a7a', '#ffb84a', '#ffe85a', '#6aff8a', '#5ac8ff', '#b88aff', '#ff5a7a'].forEach((col, i, a) => g.addColorStop(i / (a.length - 1), col));
        x.fillStyle = g; x.fillRect(0, 0, N, 16);
        const t = texFrom(c); t.wrapS = T.RepeatWrapping;
        return t;
    });
}
// Treadmill belt: dark rubber with lighter ribs (scrolled while running)
export function beltTexture() {
    return once('belt', () => {
        const c = canvas(64), x = c.getContext('2d');
        x.fillStyle = '#34376a'; x.fillRect(0, 0, 64, 64);
        x.fillStyle = '#464a86'; for (let i = 0; i < 4; i++) x.fillRect(0, i * 16, 64, 5);
        return rep(texFrom(c));
    });
}
// Soft cloud sprite for the sky over the hall
export function cloudTexture() {
    return once('cloud', () => {
        const N = 256, c = canvas(N, 128), x = c.getContext('2d'), rnd = seeded(11);
        for (let k = 0; k < 14; k++) {
            const cx = 40 + rnd() * 176, cy = 60 + (rnd() - 0.5) * 30, r = 22 + rnd() * 30;
            const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
            g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
            x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
        }
        return texFrom(c);
    });
}

// Animated textures (offsets scrolled every frame)
export const scrolling = [];
export function updateMaterials(dt) {
    for (const s of scrolling) { s.tex.offset.x += s.u * dt; s.tex.offset.y += s.v * dt; }
}
