import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { T, V3, $, renderer, scene, camera, sun } from './engine.js';

// ----- quality presets -----
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
export const QUALITIES = {
    low: { label: 'Low', ratio: 0.85, shadows: false, bloom: false, shadowMap: 512 },
    medium: { label: 'Medium', ratio: 1, shadows: true, bloom: true, shadowMap: 1024 },
    high: { label: 'High', ratio: 1.5, shadows: true, bloom: true, shadowMap: 2048 },
};
let quality = isTouch ? 'medium' : 'high';
try { quality = localStorage.getItem('spo_quality') || quality; } catch (e) { /* default */ }
if (!QUALITIES[quality]) quality = 'high';

// Neon materials are HDR (brighter than 1) so only they cross the bloom threshold;
// neutral tone mapping keeps every other colour close to its authored sRGB value.
renderer.toneMapping = T.NeutralToneMapping;
renderer.toneMappingExposure = 1.02;

// Final grade, after tone mapping: a little more saturation and contrast (the punchy candy look),
// a soft vignette and a faint pink lift in the shadows
const GradeShader = {
    uniforms: { tDiffuse: { value: null }, uSat: { value: 1.16 }, uContrast: { value: 1.06 }, uVignette: { value: 0.24 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uSat; uniform float uContrast; uniform float uVignette; varying vec2 vUv;
        void main() {
            vec4 c = texture2D(tDiffuse, vUv);
            float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
            vec3 col = mix(vec3(l), c.rgb, uSat);
            col = (col - 0.5) * uContrast + 0.5;
            col += vec3(0.035, 0.0, 0.03) * (1.0 - smoothstep(0.0, 0.45, l));
            vec2 q = vUv - 0.5;
            col *= 1.0 - uVignette * smoothstep(0.35, 0.85, length(q * vec2(1.0, 0.85)) * 1.25);
            gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
        }`,
};

let composer = null, bloomPass = null;
function buildComposer() {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(new T.Vector2(innerWidth / 2, innerHeight / 2), 0.32, 0.38, 1.85);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    composer.addPass(new ShaderPass(GradeShader));
}
function applyQuality() {
    const q = QUALITIES[quality];
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, q.ratio));
    renderer.shadowMap.enabled = q.shadows;
    sun.castShadow = q.shadows;
    if (sun.shadow.mapSize.x !== q.shadowMap) {
        sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    scene.traverse((o) => { if (o.material) { const m = Array.isArray(o.material) ? o.material : [o.material]; m.forEach((x) => { x.needsUpdate = true; }); } });
    if (q.bloom && !composer) buildComposer();
    resizeFx();
}
export function getQuality() { return quality; }
// auto: a step down made by the frame-rate watcher (main.js); anything else is the player's choice
let autoAllowed = true;
export const autoQualityAllowed = () => autoAllowed;
export function setQuality(q, auto) {
    if (!QUALITIES[q]) return;
    if (!auto && q !== quality) autoAllowed = false;
    quality = q;
    try { localStorage.setItem('spo_quality', q); } catch (e) { /* ignore */ }
    applyQuality();
}
function resizeFx() {
    if (composer) {
        composer.setPixelRatio(renderer.getPixelRatio());
        composer.setSize(innerWidth, innerHeight);
        bloomPass.resolution.set(innerWidth / 2, innerHeight / 2);
    }
    lines.width = Math.round(innerWidth * Math.min(devicePixelRatio || 1, 1.5));
    lines.height = Math.round(innerHeight * Math.min(devicePixelRatio || 1, 1.5));
}
addEventListener('resize', resizeFx);

export function render() {
    if (QUALITIES[quality].bloom && composer) composer.render();
    else renderer.render(scene, camera);
}

// ----- speed lines (2D overlay) -----
const lines = $('#speedLines');
const lctx = lines.getContext('2d');
const streaks = Array.from({ length: 70 }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random(), l: 0.1 + Math.random() * 0.25, w: 1 + Math.random() * 2.5 }));
let lineAmt = 0;
export function setSpeedLines(target, dt) {
    lineAmt += (target - lineAmt) * Math.min(1, dt * 6);
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

// ----- ambient glitter: sparkles drifting up all around the camera, tinted by the stage -----
const AMB = 260;
const ambGeo = new T.BufferGeometry();
{
    const pos = new Float32Array(AMB * 3), seed = new Float32Array(AMB);
    for (let i = 0; i < AMB; i++) { pos[i * 3] = Math.random(); pos[i * 3 + 1] = Math.random(); pos[i * 3 + 2] = Math.random(); seed[i] = Math.random(); }
    ambGeo.setAttribute('position', new T.BufferAttribute(pos, 3));
    ambGeo.setAttribute('aSeed', new T.BufferAttribute(seed, 1));
}
const ambMat = new T.ShaderMaterial({
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uCam: { value: new V3() }, uColor: { value: new T.Color(0xff8ad8) }, uSize: { value: 260 } },
    vertexShader: `attribute float aSeed; uniform float uTime; uniform vec3 uCam; uniform float uSize; varying float vA; varying float vS;
        void main() {
            vec3 box = vec3(90.0, 60.0, 90.0);
            vec3 p = position * box;
            p.y += uTime * (1.2 + aSeed * 2.5);
            p.x += sin(uTime * 0.5 + aSeed * 20.0) * 2.5;
            vec3 rel = mod(p - uCam + box * 0.5, box) - box * 0.5;
            vec4 mv = modelViewMatrix * vec4(uCam + rel, 1.0);
            gl_Position = projectionMatrix * mv;
            float tw = 0.5 + 0.5 * sin(uTime * (2.0 + aSeed * 3.0) + aSeed * 40.0);
            vA = tw * smoothstep(44.0, 14.0, length(rel)) * smoothstep(2.0, 6.0, length(rel));
            vS = aSeed;
            gl_PointSize = uSize * (0.35 + aSeed * 0.65) * (0.6 + tw * 0.4) / max(1.0, -mv.z);
        }`,
    fragmentShader: `uniform vec3 uColor; varying float vA; varying float vS;
        void main() {
            vec2 q = gl_PointCoord - 0.5;
            float core = pow(max(0.0, 1.0 - length(q) * 2.0), 2.0);
            float rays = max(0.0, 1.0 - abs(q.x) * 12.0) * max(0.0, 1.0 - abs(q.y) * 2.4) + max(0.0, 1.0 - abs(q.y) * 12.0) * max(0.0, 1.0 - abs(q.x) * 2.4);
            vec3 c = mix(uColor, vec3(1.0), 0.35 + 0.35 * sin(vS * 31.0));
            gl_FragColor = vec4(c * 1.6, (core + rays * 0.55) * vA);
        }`,
});
const ambient = new T.Points(ambGeo, ambMat);
ambient.frustumCulled = false;
ambient.renderOrder = 5;
scene.add(ambient);
const ambTmp = new T.Color();
export function updateAmbient(camPos, t, color) {
    ambMat.uniforms.uTime.value = t;
    ambMat.uniforms.uCam.value.copy(camPos);
    ambMat.uniforms.uColor.value.lerp(ambTmp.set(color), 0.03);
}

applyQuality();
