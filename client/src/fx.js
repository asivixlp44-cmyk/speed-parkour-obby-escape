import { T, V3, $, renderer, scene, camera, sun } from './engine.js';

// ----- quality presets -----
// No post-processing (bloom, colour grade) and no reflections in any preset: the scene is drawn
// straight to the screen. The presets change the resolution and the shadows only.
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
export const QUALITIES = {
    low: { label: 'Low', ratio: 0.85, shadows: false, shadowMap: 512 },
    medium: { label: 'Medium', ratio: 1, shadows: true, shadowMap: 1024 },
    high: { label: 'High', ratio: 1.5, shadows: true, shadowMap: 2048 },
};
let quality = isTouch ? 'low' : 'medium';
try { quality = localStorage.getItem('spo_quality2') || quality; } catch (e) { /* default */ }
if (!QUALITIES[quality]) quality = 'medium';

// Neutral tone mapping keeps every colour close to its authored sRGB value
renderer.toneMapping = T.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;

const setShadows = (on) => { renderer.shadowMap.enabled = on; sun.castShadow = on; };
let applying = 0;
async function applyQuality(now) {
    const q = QUALITIES[quality], token = ++applying;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, q.ratio));
    resizeFx();
    if (sun.shadow.mapSize.x !== q.shadowMap) {
        sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    const was = renderer.shadowMap.enabled;
    if (was === q.shadows) return;
    if (now) { setShadows(q.shadows); return; }
    // Shadows on or off changes every lit shader. Compile the new ones in the background while
    // the game keeps drawing with the old ones, then switch: no freeze on a slow PC.
    setShadows(q.shadows);
    let ready = null;
    try { ready = renderer.compileAsync(scene, camera); } catch (e) { /* switch straight away */ }
    setShadows(was);
    syncLights();
    if (ready) { try { await ready; } catch (e) { /* switch anyway */ } }
    if (token === applying) { setShadows(q.shadows); syncLights(); }
}
// three draws the shadow pass with the lights as they were last set up (it sets them up after
// that pass), so after a compile or a switch set them up for what's drawn next: otherwise the
// shadow pass compiles new depth shaders on the spot
const noObjects = new T.Group();
function syncLights() {
    try { renderer.compile(noObjects, camera, scene); } catch (e) { /* next frame sets them up */ }
}
export function getQuality() { return quality; }
// auto: a step down made by the frame-rate watcher (main.js); anything else is the player's choice
let autoAllowed = true;
export const autoQualityAllowed = () => autoAllowed;
export function setQuality(q, auto) {
    if (!QUALITIES[q]) return;
    if (!auto && q !== quality) autoAllowed = false;
    quality = q;
    try { localStorage.setItem('spo_quality2', q); } catch (e) { /* ignore */ }
    applyQuality();
}
function resizeFx() {
    lines.width = Math.round(innerWidth * Math.min(devicePixelRatio || 1, 1.5));
    lines.height = Math.round(innerHeight * Math.min(devicePixelRatio || 1, 1.5));
}
addEventListener('resize', resizeFx);

export function render() { renderer.render(scene, camera); }

// ----- speed lines (2D overlay) -----
const lines = $('#speedLines');
const lctx = lines.getContext('2d');
const streaks = Array.from({ length: 70 }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random(), l: 0.1 + Math.random() * 0.25, w: 1 + Math.random() * 2.5 }));
let lineAmt = 0;
export function setSpeedLines(target, dt) {
    const was = lineAmt;
    lineAmt += (target - lineAmt) * Math.min(1, dt * 6);
    if (lineAmt < 0.02 && was < 0.02) return;
    const w = lines.width, h = lines.height;
    lctx.clearRect(0, 0, w, h);
    if (lineAmt < 0.02) return;
    const cx = w / 2, cy = h * 0.46, R = Math.hypot(w, h) / 2;
    lctx.lineCap = 'round';
    for (const s of streaks) {
        s.r += dt * (1.6 + s.l * 4);
        if (s.r > 1) { s.r = 0.35 + Math.random() * 0.2; s.a = Math.random() * Math.PI * 2; }
        const r0 = R * s.r, r1 = R * Math.min(1.1, s.r + s.l);
        lctx.strokeStyle = `rgba(255,255,255,${(0.7 * lineAmt * s.r).toFixed(3)})`;
        lctx.lineWidth = s.w;
        lctx.beginPath();
        lctx.moveTo(cx + Math.cos(s.a) * r0, cy + Math.sin(s.a) * r0);
        lctx.lineTo(cx + Math.cos(s.a) * r1, cy + Math.sin(s.a) * r1);
        lctx.stroke();
    }
}

// ----- soft sprite particles (dust, sparkles, fireworks) -----
const softTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
    return t;
})();
// Four-point star for sparkles
const starTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath();
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, r = k % 2 ? 7 : 31; x.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
    x.closePath(); x.fill();
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
    return t;
})();
const sprites = [];
const MAX_SPRITES = 900;
function spawn(pos, vel, color, size, life, opts) {
    if (sprites.length > MAX_SPRITES) return;
    opts = opts || {};
    const m = new T.SpriteMaterial({ map: opts.star ? starTex : softTex, color, transparent: true, depthWrite: false, blending: opts.add ? T.AdditiveBlending : T.NormalBlending, opacity: opts.opacity || 1 });
    if (opts.hdr) m.color.multiplyScalar(opts.hdr);
    const s = new T.Sprite(m);
    s.position.copy(pos); s.scale.setScalar(size);
    scene.add(s);
    sprites.push({ s, v: vel, life, max: life, grow: opts.grow || 0, grav: opts.grav || 0, drag: opts.drag || 0, size, fade0: opts.opacity || 1, spin: opts.spin || 0 });
}
export function dust(pos, n, strength, color) {
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = (2 + Math.random() * 4) * strength;
        spawn(new V3(pos.x + Math.cos(a) * 0.6, pos.y + 0.3, pos.z + Math.sin(a) * 0.6), new V3(Math.cos(a) * sp, 1.5 + Math.random() * 2, Math.sin(a) * sp),
            color || 0xf4e0ff, 0.55 + Math.random() * 0.4, 0.35 + Math.random() * 0.2, { grow: 1.6, drag: 3.5, opacity: 0.4 });
    }
}
export function sparkleColumn(pos, color) {
    for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI * 2, r = 1.8 + Math.random() * 1.2;
        spawn(new V3(pos.x + Math.cos(a) * r, pos.y + Math.random() * 2, pos.z + Math.sin(a) * r), new V3(0, 7 + Math.random() * 8, 0),
            color, 0.4 + Math.random() * 0.35, 0.7 + Math.random() * 0.4, { add: true, hdr: 1.6, drag: 0.6, star: true });
    }
}
// A backflip: a ring of sparkles puffs out sideways around the body, in the trail colour
export function flipBurst(pos, color) {
    for (let i = 0; i < 14; i++) {
        const a = i / 14 * Math.PI * 2;
        spawn(new V3(pos.x, pos.y + 2.4, pos.z), new V3(Math.cos(a) * 9, Math.sin(a) * 5 - 3, Math.sin(a) * 9), i % 3 ? color : 0xffffff,
            0.45 + Math.random() * 0.25, 0.35 + Math.random() * 0.15, { add: true, hdr: 1.7, drag: 3, star: i % 2 === 0 });
    }
}
// Dash: a white flash and streaks shooting back along the dash (the reference's white burst)
export function dashBurst(pos, dir) {
    const c = new V3(pos.x, pos.y + 2.5, pos.z);
    spawn(c.clone(), new V3(0, 0, 0), 0xffffff, 5, 0.18, { add: true, hdr: 2.2, grow: 1.4, opacity: 0.85 });
    for (let i = 0; i < 18; i++) {
        const back = dir.clone().multiplyScalar(-(14 + Math.random() * 16));
        back.x += (Math.random() - 0.5) * 8; back.y = (Math.random() - 0.4) * 6; back.z += (Math.random() - 0.5) * 8;
        spawn(c.clone().add(new V3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2)), back, i % 3 ? 0xffffff : 0xbfe8ff, 0.5 + Math.random() * 0.4, 0.28, { add: true, hdr: 1.8, drag: 3, star: i % 4 === 0 });
    }
}
// Super Jump: a shockwave ring and a column of sparks launching up
export function superRing(pos) {
    ring(pos, 0xffffff, 8, 0.5);
    ring(pos, 0x8ae8ff, 12, 0.7);
    for (let i = 0; i < 22; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 1.5;
        spawn(new V3(pos.x + Math.cos(a) * r, pos.y + 0.4, pos.z + Math.sin(a) * r), new V3(Math.cos(a) * 4, 14 + Math.random() * 16, Math.sin(a) * 4), i % 2 ? 0xffffff : 0x8ae8ff, 0.45 + Math.random() * 0.3, 0.5, { add: true, hdr: 1.8, drag: 2, star: i % 3 === 0 });
    }
    dust(pos, 14, 1.8);
}
// Shoes with an effect leave it at the feet as you walk
export function shoeFx(pos, kind, color) {
    const p = new V3(pos.x + (Math.random() - 0.5) * 1.6, pos.y + 0.3, pos.z + (Math.random() - 0.5) * 1.6);
    if (kind === 'fire') spawn(p, new V3((Math.random() - 0.5) * 1.5, 3 + Math.random() * 3, (Math.random() - 0.5) * 1.5), Math.random() < 0.5 ? 0xff6a14 : 0xffc414, 0.6 + Math.random() * 0.4, 0.4, { add: true, hdr: 1.4, grow: -0.6 });
    else if (kind === 'frost') spawn(p, new V3((Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2), 0xcaf4ff, 0.4 + Math.random() * 0.3, 0.6, { add: true, hdr: 1.4, star: true });
    else if (kind === 'spark') spawn(p, new V3((Math.random() - 0.5) * 6, 2 + Math.random() * 4, (Math.random() - 0.5) * 6), color || 0x2affd8, 0.25, 0.3, { add: true, hdr: 2, grav: 20 });
    else if (kind === 'star') spawn(p, new V3(0, 1.5 + Math.random() * 2, 0), color || 0xfff0b0, 0.45 + Math.random() * 0.3, 0.7, { add: true, hdr: 1.6, star: true });
    else if (kind === 'rainbow') spawn(p, new V3((Math.random() - 0.5) * 2, 2 + Math.random() * 3, (Math.random() - 0.5) * 2), new T.Color().setHSL(Math.random(), 1, 0.6).getHex(), 0.5, 0.6, { add: true, hdr: 1.7, star: Math.random() < 0.5 });
}

// Trail streaming behind the player while they move: a vertical ribbon through the last few
// positions, tapering and fading toward the tail (rainbow trails cycle their colour)
export function makeTrail(color) {
    const N = 28, pts = [];
    const pos = new Float32Array(N * 2 * 3), col = new Float32Array(N * 2 * 3);
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    const idx = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    const mesh = new T.Mesh(geo, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, toneMapped: false }));
    mesh.frustumCulled = false;
    scene.add(mesh);
    const c = new T.Color(color), tmp = new T.Color();
    let acc = 0;
    return {
        color, rainbow: false, width: 1,
        setColor(hex, rainbow) { this.color = hex; this.rainbow = !!rainbow; c.set(hex); },
        update(at, on, dt, t) {
            acc += dt;
            if (acc >= 0.03) {
                acc = 0;
                if (on) pts.unshift(at.clone()); else pts.pop();
                if (pts.length > N) pts.length = N;
            }
            if (pts.length && on) pts[0].copy(at);
            for (let i = 0; i < N; i++) {
                const p = pts[Math.min(i, pts.length - 1)];
                const k = pts.length > 1 ? 1 - i / (pts.length - 1) : 0;
                const h = i < pts.length ? this.width * k : 0;
                if (this.rainbow) tmp.setHSL(((t || 0) * 0.4 + i / N) % 1, 1, 0.6); else tmp.copy(c);
                for (let s = 0; s < 2; s++) {
                    const o = (i * 2 + s) * 3;
                    if (p) { pos[o] = p.x; pos[o + 1] = p.y + (s ? h : -h); pos[o + 2] = p.z; }
                    col[o] = tmp.r * k * 1.3; col[o + 1] = tmp.g * k * 1.3; col[o + 2] = tmp.b * k * 1.3;
                }
            }
            geo.attributes.position.needsUpdate = true;
            geo.attributes.color.needsUpdate = true;
            mesh.visible = pts.length > 1;
        },
        dispose() { scene.remove(mesh); geo.dispose(); mesh.material.dispose(); },
    };
}

// One of each effect material, put in the scene for the loading warm-up (main.js) so the first
// sparkle, ring or trail in play doesn't stop the game to compile its shader. Kept, never disposed,
// so those shaders stay alive.
export function fxWarmGroup() {
    const g = new T.Group();
    for (const map of [softTex, starTex]) g.add(new T.Sprite(new T.SpriteMaterial({ map, transparent: true, depthWrite: false })));
    const tg = new T.BufferGeometry();
    tg.setAttribute('position', new T.BufferAttribute(new Float32Array(9), 3));
    tg.setAttribute('color', new T.BufferAttribute(new Float32Array(9), 3));
    g.add(new T.Mesh(tg, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, toneMapped: false })));
    g.add(new T.Mesh(new T.RingGeometry(0.8, 1, 8), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: T.DoubleSide })));
    return g;
}

// Fire puff (jetpack flames)
export function flame(at, spread, size, vel) {
    const p = new V3(at.x + (Math.random() - 0.5) * spread, at.y + (Math.random() - 0.5) * spread * 0.5, at.z + (Math.random() - 0.5) * spread);
    const v = vel ? vel.clone().multiplyScalar(0.7 + Math.random() * 0.6) : new V3(0, 0, 0);
    v.x += (Math.random() - 0.5) * 3; v.y += 3 + Math.random() * 5; v.z += (Math.random() - 0.5) * 3;
    spawn(p, v, Math.random() < 0.45 ? 0xff5a14 : Math.random() < 0.6 ? 0xffb51c : 0xfff0a0,
        (size || 1.4) * (0.7 + Math.random() * 0.6), 0.45 + Math.random() * 0.35, { add: true, hdr: 1.3, grow: -0.5, drag: 1.5, opacity: 0.95 });
}

// Treadmill sparkles in the treadmill's colour; the faster ones fizz harder
export function emitTread(at, mult, len, width, color) {
    const p = new V3(at.x + (Math.random() - 0.5) * width, at.y, at.z + (Math.random() - 0.5) * len);
    if (mult >= 100) {
        const c = mult >= 200 ? new T.Color().setHSL(Math.random(), 1, 0.6).getHex() : color;
        spawn(p, new V3((Math.random() - 0.5) * 3, 6 + Math.random() * 6, (Math.random() - 0.5) * 3), c, 0.5 + Math.random() * 0.5, 0.5 + Math.random() * 0.4, { add: true, hdr: 1.8, grow: -0.4, star: Math.random() < 0.4 });
    } else if (mult >= 18) {
        spawn(p.setY(at.y + Math.random() * 2.5), new V3((Math.random() - 0.5) * 6, (Math.random() - 0.2) * 5, (Math.random() - 0.5) * 6), color, 0.35 + Math.random() * 0.3, 0.25 + Math.random() * 0.15, { add: true, hdr: 1.6 });
    } else {
        spawn(p.setY(at.y + Math.random() * 3), new V3(0, 1 + Math.random() * 2, 0), Math.random() < 0.6 ? 0xffffff : color, 0.3 + Math.random() * 0.35, 0.6 + Math.random() * 0.5, { add: true, hdr: 1.4, star: true });
    }
}

// Expanding neon ring on the ground (level up, big landings)
const rings = [];
export function ring(pos, color, maxR, life) {
    const m = new T.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: T.DoubleSide });
    m.color.multiplyScalar(2.2);
    const mesh = new T.Mesh(new T.RingGeometry(0.8, 1, 48), m);
    mesh.rotation.x = -Math.PI / 2; mesh.position.copy(pos).setY(pos.y + 0.2);
    scene.add(mesh);
    rings.push({ mesh, t: 0, life: life || 0.7, maxR: maxR || 9 });
}

// Fireworks: a glowing rocket that bursts into coloured sparks
const rockets = [];
const FW_COLORS = [0xffd028, 0x46ec50, 0x28c8ff, 0xff3fa0, 0xc428ff, 0xff6e14];
export function fireworks(center, count, onBurst) {
    for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 10;
        rockets.push({
            p: new V3(center.x + Math.cos(a) * r, center.y + 1, center.z + Math.sin(a) * r),
            v: new V3((Math.random() * 2 - 1) * 3, 34 + Math.random() * 10, (Math.random() * 2 - 1) * 3),
            t: 0.7 + Math.random() * 0.3 + i * 0.18, trail: 0, color: FW_COLORS[(Math.random() * FW_COLORS.length) | 0], onBurst,
        });
    }
}
function burstFw(p, color) {
    for (let i = 0; i < 46; i++) {
        const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        const sp = 16 + Math.random() * 8;
        spawn(p.clone(), new V3(s * Math.cos(th) * sp, u * sp, s * Math.sin(th) * sp), i % 5 ? color : 0xffffff, 0.9 + Math.random() * 0.5, 1.1 + Math.random() * 0.5, { add: true, hdr: 2.5, grav: 14, drag: 1.4, star: i % 4 === 0 });
    }
}

export function updateFx(dt) {
    for (let i = sprites.length - 1; i >= 0; i--) {
        const p = sprites[i];
        p.life -= dt;
        if (p.life <= 0) { scene.remove(p.s); p.s.material.dispose(); sprites.splice(i, 1); continue; }
        p.v.y -= p.grav * dt;
        if (p.drag) p.v.multiplyScalar(Math.exp(-p.drag * dt));
        p.s.position.addScaledVector(p.v, dt);
        const k = p.life / p.max;
        p.s.material.opacity = p.fade0 * Math.min(1, k * 2);
        if (p.grow) p.s.scale.setScalar(Math.max(0.05, p.size * (1 + p.grow * (1 - k))));
    }
    for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.t += dt;
        const k = r.t / r.life;
        if (k >= 1) { scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); rings.splice(i, 1); continue; }
        const e = 1 - Math.pow(1 - k, 3);
        r.mesh.scale.setScalar(1 + e * r.maxR);
        r.mesh.material.opacity = 1 - k;
    }
    for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.v.y -= 20 * dt;
        r.p.addScaledVector(r.v, dt);
        r.trail -= dt;
        if (r.trail <= 0) { r.trail = 0.03; spawn(r.p.clone(), new V3(0, -2, 0), 0xffe7a8, 0.7, 0.35, { add: true, hdr: 2 }); }
        r.t -= dt;
        if (r.t <= 0) { burstFw(r.p, r.color); if (r.onBurst) r.onBurst(); rockets.splice(i, 1); }
    }
}

applyQuality(true);
