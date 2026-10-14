import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const T = THREE;
export const V3 = THREE.Vector3;
export const $ = (s) => document.querySelector(s);
export const hexCss = (h) => '#' + h.toString(16).padStart(6, '0');

// ----- renderer, scene, camera, lights -----
export const canvas = $('#view');
export const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = true;
// Shader error checks cost extra blocking GPU calls per shader; only in development
renderer.debug.checkShaderErrors = import.meta.env.DEV;
// PCFShadowMap: three r186 removed PCFSoft and switches it at the first shadow frame, which
// recompiles every material at once (a long freeze when the game starts)
renderer.shadowMap.type = T.PCFShadowMap;

export const scene = new T.Scene();
export const FOG = 0xb8acec;
scene.fog = new T.Fog(FOG, 420, 1600);
scene.background = new T.Color(FOG);

// ----- sky: a dome that follows the camera -----
// A clear Roblox-blue sky over the open-roof hall, pale lilac at the horizon (the reference's look),
// a warm sun and soft cloud bands. uTint pulls the horizon toward the stage's haze colour; uNight
// darkens it to a starry night for the night / neon stages.
const SUN_DIR = new T.Vector3(0.42, 0.5, 0.76).normalize();
const skyMat = new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false,
    uniforms: { uAlt: { value: 0 }, uSun: { value: SUN_DIR }, uTime: { value: 0 }, uTint: { value: new T.Color(FOG) }, uNight: { value: 0 } },
    vertexShader: `varying vec3 vDir;
        void main() { vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform float uAlt; uniform vec3 uSun; uniform float uTime; uniform vec3 uTint; uniform float uNight; varying vec3 vDir;
        float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        void main() {
            vec3 d = normalize(vDir);
            float a = clamp(max(uAlt, uNight), 0.0, 1.0);
            vec3 zen = mix(vec3(0.22, 0.52, 1.0), vec3(0.03, 0.04, 0.16), a);
            vec3 hor = mix(mix(vec3(0.82, 0.88, 1.0), uTint, 0.35), mix(vec3(0.16, 0.14, 0.4), uTint, 0.3), a);
            vec3 low = mix(vec3(0.78, 0.74, 1.0), vec3(0.08, 0.06, 0.2), a);
            float h = d.y;
            vec3 col = h > 0.0 ? mix(hor, zen, pow(h, 0.55)) : mix(hor, low, pow(-h, 0.45));
            // Soft cloud bands drifting across the upper sky
            float cl = sin(d.x * 6.0 + uTime * 0.02) * sin(d.z * 5.0 - uTime * 0.015) + sin((d.x + d.z) * 11.0 + uTime * 0.03) * 0.5;
            col = mix(col, vec3(1.0), smoothstep(0.55, 1.2, cl) * smoothstep(0.05, 0.3, h) * 0.75 * (1.0 - a));
            float s = max(dot(d, uSun), 0.0);
            col += vec3(1.0, 0.92, 0.82) * (pow(s, 900.0) * 3.0 + pow(s, 60.0) * 0.4 + pow(s, 8.0) * 0.14 * (1.0 - a));
            // Stars appear as the sky darkens, and a few twinkle all the time
            vec3 q = floor(d * 380.0);
            float st = step(0.9965, hash(q)) * mix(0.18, 1.0, smoothstep(0.25, 0.75, a)) * smoothstep(-0.05, 0.25, h);
            col += vec3(1.0, 0.9, 1.0) * st * (0.6 + 0.4 * sin(uTime * 2.0 + hash(q + 3.1) * 40.0));
            gl_FragColor = vec4(col, 1.0);
        }`,
});
const skyDome = new T.Mesh(new T.SphereGeometry(3000, 32, 16), skyMat);
skyDome.renderOrder = -10;
skyDome.frustumCulled = false;
scene.add(skyDome);
const fogLow = new T.Color(FOG), fogHigh = new T.Color(0x1e1a48), fogTmp = new T.Color();
export const SKY_TOP = 3000;
// tint: the haze colour of the stage the camera is in
export function updateSky(pos, t, tint, dt, night) {
    const a = Math.min(1, Math.max(0, pos.y / SKY_TOP));
    skyMat.uniforms.uAlt.value = a;
    skyMat.uniforms.uNight.value += ((night || 0) - skyMat.uniforms.uNight.value) * Math.min(1, dt * 1.5);
    skyMat.uniforms.uTime.value = t;
    skyMat.uniforms.uTint.value.lerp(tint, Math.min(1, dt * 1.5));
    skyDome.position.copy(pos);
    fogTmp.copy(fogLow).lerp(skyMat.uniforms.uTint.value, 0.55).lerp(fogHigh, Math.max(a, skyMat.uniforms.uNight.value) * 0.85);
    scene.fog.color.copy(fogTmp);
    scene.background.copy(fogTmp);
}
export const SUN_DIRECTION = SUN_DIR;

export const camera = new T.PerspectiveCamera(70, 1, 0.3, 2600);
function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < h ? 85 : 70;
    camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// No image-based environment map: building one (PMREM blur shaders) froze slow PCs for about two
// seconds at load. A stronger sky / ground hemisphere light gives the same soft fill instead, and
// the sun adds direction and shadows on top.
// Tuned so the matte lobby matches the reference video (floor about #8c7bb6) with dark shaded sides
export const hemi = new T.HemisphereLight(0xf2eeff, 0x6a5a98, 2.2);
export const ambient = new T.AmbientLight(0xffffff, 0.35);
scene.add(hemi, ambient);
export const sun = new T.DirectionalLight(0xfff2e6, 3.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 340 });
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.04;
sun.shadow.radius = 2;
scene.add(sun, sun.target);

// ----- materials & textures -----
export const UNIT = new T.BoxGeometry(1, 1, 1);
// Glowing parts are drawn unlit and a little brighter than their colour (there is no bloom)
export const NEON_BOOST = 1.25;
const matCache = new Map();
// Flat plastic in one colour (Roblox-style), matte
// Matte, non-reflective plastic (Lambert): cheap to draw and no specular gloss or reflections.
// Takes MeshStandardMaterial-style parameters and drops the ones a matte material doesn't have.
export function matte(p) {
    p = { ...(p || {}) };
    for (const k of ['roughness', 'metalness', 'clearcoat', 'clearcoatRoughness']) delete p[k];
    return new T.MeshLambertMaterial(p);
}
export function mat(color, o) {
    o = o || {};
    const key = color + '|' + (o.neon ? 1 : 0) + '|' + (o.opacity || 1) + '|' + (o.rough ?? '') + '|' + (o.side || 0);
    let m = matCache.get(key);
    if (!m) {
        m = o.neon ? new T.MeshBasicMaterial({ color }) : new T.MeshLambertMaterial({ color });
        // Neon is HDR (brighter than 1) so the bloom pass picks it up
        if (o.neon) m.color.multiplyScalar(NEON_BOOST * (o.boost ? o.boost / 1.4 : 1));
        if (o.opacity && o.opacity < 1) { m.transparent = true; m.opacity = o.opacity; m.depthWrite = false; }
        if (o.side) m.side = T.DoubleSide;
        matCache.set(key, m);
    }
    return m;
}
// Glossy candy: lacquered sugar shell (donut glaze, lollipops, gumballs)
export function candy(color, o) {
    o = o || {};
    const key = 'candy|' + color + '|' + (o.rough ?? 0.22) + '|' + (o.clear ? 1 : 0) + '|' + (o.emissive || 0);
    let m = matCache.get(key);
    if (!m) {
        m = o.clear
            ? new T.MeshLambertMaterial({ color })
            : new T.MeshLambertMaterial({ color });
        if (o.map) m.map = o.map;
        if (o.emissive) { m.emissive = new T.Color(o.emissive); m.emissiveIntensity = o.emissiveIntensity ?? 0.6; }
        matCache.set(key, m);
    }
    return m;
}
export function texFrom(cv) {
    const t = new T.CanvasTexture(cv);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
}
// A text texture by its content: the same label ("+1 WIN", "Slide Under!", "+1 Speed") is drawn
// and uploaded to the GPU once and shared by every sign that shows it. Never dispose these.
const sharedTexs = new Map();
export function sharedTex(key, draw) {
    let t = sharedTexs.get(key);
    if (!t) { t = texFrom(draw()); sharedTexs.set(key, t); }
    return t;
}

// ----- Roblox studs -----
// One texture tile is 8 x 8 studs (8 x 8 units, a stud per unit, like Roblox). Each stud is a
// raised square with bevelled edges: a height field turned into a normal map, so the studs catch
// the sun and the sky light from any angle, plus a soft albedo with darker grooves.
const STUD_TEX = (() => {
    const N = 256, C = 32, INSET = 4, BEVEL = 5;
    const h = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const lx = x % C + 0.5, ly = y % C + 0.5;
        const d = Math.min(lx - INSET, C - INSET - lx, ly - INSET, C - INSET - ly);
        h[y * N + x] = d <= 0 ? 0 : Math.min(1, d / BEVEL) ** 0.8;
    }
    const albedo = document.createElement('canvas'); albedo.width = albedo.height = N;
    const normal = document.createElement('canvas'); normal.width = normal.height = N;
    const ai = albedo.getContext('2d').createImageData(N, N), ni = normal.getContext('2d').createImageData(N, N);
    const at = (x, y) => h[((y + N) % N) * N + ((x + N) % N)];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const i = (y * N + x) * 4, v = at(x, y);
        const lx = x % C, ly = y % C, edge = lx < 1 || ly < 1;
        const g = edge ? 205 : v === 0 ? 228 : 236 + v * 19;
        ai.data[i] = ai.data[i + 1] = ai.data[i + 2] = g; ai.data[i + 3] = 255;
        const dx = (at(x + 1, y) - at(x - 1, y)) * 2.2, dy = (at(x, y + 1) - at(x, y - 1)) * 2.2;
        const len = Math.hypot(dx, dy, 1);
        ni.data[i] = Math.round((-dx / len * 0.5 + 0.5) * 255);
        ni.data[i + 1] = Math.round((dy / len * 0.5 + 0.5) * 255);
        ni.data[i + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
        ni.data[i + 3] = 255;
    }
    albedo.getContext('2d').putImageData(ai, 0, 0);
    normal.getContext('2d').putImageData(ni, 0, 0);
    const map = texFrom(albedo), nrm = new T.CanvasTexture(normal);
    nrm.colorSpace = T.NoColorSpace;
    for (const t of [map, nrm]) { t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); }
    return { map, nrm };
})();
// Studded plastic in a colour. UVs in world units / 8 (one tile = 8 x 8 studs): use the default
// repeat with world-scaled UVs, or o.rx / o.ry to repeat the tile on plain 0..1 UVs.
// Studded plastic for the merged world boxes: one material for every colour (the colour is in the
// vertices), sharing the stud textures, so the whole world needs only a couple of materials
export function studVCMaterial(rough) {
    const key = 'studvc|' + rough;
    let m = matCache.get(key);
    if (!m) {
        m = matte({ color: 0xffffff, vertexColors: true, map: STUD_TEX.map, normalMap: STUD_TEX.nrm, normalScale: new T.Vector2(0.6, 0.6) });
        matCache.set(key, m);
    }
    return m;
}
export function studMaterial(color, o) {
    o = o || {};
    const rx = Math.max(1, Math.round(o.rx || 1)), ry = Math.max(1, Math.round(o.ry || 1));
    const key = 'studpbr|' + color + '|' + rx + '|' + ry + '|' + (o.rough ?? 0.5);
    let m = matCache.get(key);
    if (!m) {
        const map = STUD_TEX.map.clone(), nrm = STUD_TEX.nrm.clone();
        for (const t of [map, nrm]) { t.repeat.set(rx, ry); t.needsUpdate = true; }
        m = matte({ color, map, normalMap: nrm, normalScale: new T.Vector2(0.6, 0.6) });
        matCache.set(key, m);
    }
    return m;
}

// ----- world collections -----
export const solids = [];   // {min,max, belt, tread, ice, bounce, mover, zone}
export const kills = [];    // {min,max,active,cause} or {test(pos) -> bool, active, cause}
export const triggers = []; // {min,max,enter,inside}
export const prompts = [];  // {pos,r,label(),act()}
export const tickers = [];  // per-frame callbacks (dt, t)

export function aabb(x, y, z, sx, sy, sz) {
    return { min: new V3(x - sx / 2, y - sy / 2, z - sz / 2), max: new V3(x + sx / 2, y + sy / 2, z + sz / 2) };
}

// box(sx,sy,sz, x,y,z, color, {neon, opacity, decor, kill, cast, parent, material})
export function box(sx, sy, sz, x, y, z, color, o) {
    o = o || {};
    const m = new T.Mesh(UNIT, o.material || mat(color, o));
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    if (!o.neon) m.receiveShadow = true;
    if (o.cast) m.castShadow = true;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    (o.parent || scene).add(m);
    if (o.kill) {
        const k = aabb(x, y, z, sx, sy, sz); k.active = true; k.cause = o.cause || 'hazard'; kills.push(k);
    } else if (!o.decor) {
        const c = aabb(x, y, z, sx, sy, sz); c.zone = o.zone ?? -1; solids.push(c);
    }
    return m;
}

// ----- text -----
export function textCanvas(lines, W) {
    const pad = 10;
    let H = pad * 2;
    for (const l of lines) H += l.px * 1.2;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = Math.ceil(H);
    const x = cv.getContext('2d');
    let y = pad;
    for (const l of lines) {
        let px = l.px;
        const font = (p) => `${l.w || 700} ${p}px Fredoka, "Arial Rounded MT Bold", sans-serif`;
        x.font = font(px);
        while (x.measureText(l.t).width > W - 24 && px > 8) { px -= 2; x.font = font(px); }
        x.textAlign = 'center'; x.textBaseline = 'middle';
        const cy = y + l.px * 0.62;
        if (l.s) { x.lineJoin = 'round'; x.lineWidth = Math.max(4, px * 0.22); x.strokeStyle = l.s; x.strokeText(l.t, W / 2, cy); }
        if (l.g) {
            const g = x.createLinearGradient(0, cy - px / 2, 0, cy + px / 2);
            g.addColorStop(0, l.g[0]); g.addColorStop(1, l.g[1]);
            x.fillStyle = g;
        } else x.fillStyle = l.c || '#fff';
        x.fillText(l.t, W / 2, cy);
        y += l.px * 1.2;
    }
    return cv;
}
// shared: a fixed label whose texture can be shared with others (see sharedTex); its own
// texture is made only when the text changes (set)
export function billboard(lines, worldW, W, pos, parent, shared) {
    W = W || 512;
    const map = shared ? sharedTex('bb|' + W + '|' + JSON.stringify(lines), () => textCanvas(lines, W)) : texFrom(textCanvas(lines, W));
    const cv = map.image;
    const sp = new T.Sprite(new T.SpriteMaterial({ map, transparent: true, depthWrite: false, toneMapped: false }));
    sp.scale.set(worldW, worldW * cv.height / cv.width, 1);
    if (pos) sp.position.copy(pos);
    sp.userData.ownTex = !shared;
    sp.userData.set = (nl) => {
        const c2 = textCanvas(nl, W);
        if (sp.userData.ownTex) sp.material.map.dispose();
        sp.userData.ownTex = true;
        sp.material.map = texFrom(c2);
        sp.material.needsUpdate = true;
        sp.scale.set(worldW, worldW * c2.height / c2.width, 1);
    };
    (parent || scene).add(sp);
    return sp;
}
export function textPlane(lines, worldW, W, pos, look, parent) {
    const cv = textCanvas(lines, W || 512);
    const h = worldW * cv.height / cv.width;
    const m = new T.Mesh(new T.PlaneGeometry(worldW, h), new T.MeshBasicMaterial({ map: texFrom(cv), transparent: true, depthWrite: false, toneMapped: false }));
    m.position.copy(pos);
    m.lookAt(look);
    (parent || scene).add(m);
    return m;
}

// ----- blocky fallback body (used until / unless the Bloxity avatar loads) -----
function buildHair(part, c) {
    part(1.3, 0.35, 1.3, 0, 5.33, -0.02, c);
    part(1.3, 0.75, 0.3, 0, 4.95, -0.5, c);
    part(1.3, 0.16, 0.2, 0, 5.16, 0.56, c);
}
export function buildRig(d) {
    const g = new T.Group();
    const part = (sx, sy, sz, x, y, z, c, parent) => {
        const m = new T.Mesh(UNIT, mat(c)); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true; (parent || g).add(m); return m;
    };
    part(2, 2, 1, 0, 3, 0, d.shirt);
    part(2.02, 0.12, 1.02, 0, 2.06, 0, d.shorts);
    const head = new T.Group(); g.add(head);
    part(1.2, 1.2, 1.2, 0, 4.6, 0, d.skin, head);
    for (const sx of [-0.26, 0.26]) {
        part(0.26, 0.24, 0.04, sx, 4.72, 0.605, 0xffffff, head);
        part(0.13, 0.18, 0.04, sx + (sx > 0 ? -0.04 : 0.04), 4.71, 0.625, 0x1a1420, head);
    }
    part(0.36, 0.07, 0.04, 0, 4.34, 0.64, 0x6b2a2a, head);
    buildHair((sx, sy, sz, x, y, z, c) => part(sx, sy, sz, x, y, z, c, head), d.hair ?? 0x3a2618);
    const legs = [], arms = [], shoes = [];
    for (const side of [-0.5, 0.5]) {
        const p = new T.Group(); p.position.set(side, 2, 0); g.add(p);
        part(1, 0.9, 1, 0, -0.45, 0, d.shorts, p);
        part(0.98, 1.1, 0.98, 0, -1.45, 0, d.socks, p);
        shoes.push(part(1.05, 0.42, 1.34, 0, -1.84, 0.12, 0x141418, p));
        legs.push(p);
    }
    for (const side of [-1.5, 1.5]) {
        const p = new T.Group(); p.position.set(side, 3.9, 0); g.add(p);
        part(1, 0.8, 1, 0, -0.4, 0, d.shirt, p);
        part(0.98, 1.2, 0.98, 0, -1.4, 0, d.skin, p);
        arms.push(p);
    }
    g.userData.legs = legs; g.userData.arms = arms; g.userData.head = head; g.userData.shoes = shoes;
    return g;
}
export function animRig(g, phase, amt) {
    const s = Math.sin(phase) * amt;
    const u = g.userData;
    u.legs[0].rotation.set(s, 0, 0); u.legs[1].rotation.set(-s, 0, 0);
    u.arms[0].rotation.set(-s * 0.9, 0, 0); u.arms[1].rotation.set(s * 0.9, 0, 0);
}
// Parkour poses for the blocky body: slide (legs forward, one arm back), climb (arms and legs
// alternating up the wall), swing (arms straight up holding the pole), wall run (arms out),
// dash (arms back)
export function poseRig(g, pose, phase) {
    const u = g.userData, s = Math.sin(phase || 0);
    const L = u.legs, A = u.arms;
    if (pose === 'slide') { L[0].rotation.set(-1.45, 0, 0); L[1].rotation.set(-1.25, 0, 0); A[0].rotation.set(-0.4, 0, 0.5); A[1].rotation.set(0.9, 0, -0.3); return; }
    if (pose === 'climb') { L[0].rotation.set(-0.6 - s * 0.5, 0, 0); L[1].rotation.set(-0.6 + s * 0.5, 0, 0); A[0].rotation.set(-2.6 + s * 0.5, 0, 0); A[1].rotation.set(-2.6 - s * 0.5, 0, 0); return; }
    if (pose === 'swing') { L[0].rotation.set(0.15, 0, 0); L[1].rotation.set(0.15, 0, 0); A[0].rotation.set(-3.1, 0, 0); A[1].rotation.set(-3.1, 0, 0); return; }
    if (pose === 'wallrun') { L[0].rotation.set(s * 1.1, 0, 0); L[1].rotation.set(-s * 1.1, 0, 0); A[0].rotation.set(-0.6, 0, -1.2); A[1].rotation.set(-0.6, 0, 1.2); return; }
    if (pose === 'dash') { L[0].rotation.set(0.6, 0, 0); L[1].rotation.set(-0.5, 0, 0); A[0].rotation.set(1.2, 0, -0.2); A[1].rotation.set(1.2, 0, 0.2); return; }
    airPose(g, pose === 'flip' ? 1 : 0);
}
// In the air: arms up; tucked into a ball while flipping
export function airPose(g, tuck) {
    const u = g.userData;
    if (tuck > 0) {
        u.legs[0].rotation.set(-1.6 * tuck, 0, 0); u.legs[1].rotation.set(-1.6 * tuck, 0, 0);
        u.arms[0].rotation.set(-1.2 * tuck, 0, -0.3 * tuck); u.arms[1].rotation.set(-1.2 * tuck, 0, 0.3 * tuck);
        return;
    }
    u.legs[0].rotation.set(0.5, 0, 0); u.legs[1].rotation.set(-0.3, 0, 0);
    u.arms[0].rotation.set(-2.6, 0, 0); u.arms[1].rotation.set(-2.6, 0, 0);
}

// ----- particles & floating text -----
const particles = [];
export function burst(pos, color, size, count) {
    for (let i = 0; i < (count || 26); i++) {
        const m = new T.Mesh(UNIT, mat(i % 3 ? color : 0xffffff));
        m.scale.setScalar((size || 1) * (0.5 + Math.random() * 0.5));
        m.position.copy(pos);
        scene.add(m);
        particles.push({ m, v: new V3((Math.random() * 2 - 1) * 25, Math.random() * 30 + 5, (Math.random() * 2 - 1) * 25), t: 1.2 });
    }
}
export function confettiAt(pos) {
    for (const c of [0xffd028, 0x46ec50, 0x28c8ff, 0xff5ab8, 0xc428ff]) burst(pos, c, 0.4, 12);
}
const floaters = [];
export function floatText(text, color, pos, size) {
    const sp = billboard([{ t: text, c: color, s: '#16121f', px: 70 }], size || 5, 512, pos, null, true);
    floaters.push({ sp, t: 1.1 });
}
export function updateEffects(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.t -= dt; p.v.y -= 80 * dt;
        p.m.position.addScaledVector(p.v, dt);
        p.m.rotation.x += dt * 5; p.m.rotation.y += dt * 4;
        if (p.t <= 0) { scene.remove(p.m); particles.splice(i, 1); }
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i];
        f.t -= dt; f.sp.position.y += dt * 4; f.sp.material.opacity = Math.min(1, f.t * 2);
        if (f.t <= 0) { scene.remove(f.sp); f.sp.material.dispose(); floaters.splice(i, 1); }
    }
}

export function lerpAngle(a, b, k) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * k;
}

// Merges every mesh under root into one mesh per material (for objects that never animate
// their parts, like the shoe displays): dozens of draw calls become a handful
export function mergeChildren(root) {
    root.updateMatrixWorld(true);
    const inv = new T.Matrix4().copy(root.matrixWorld).invert(), m4 = new T.Matrix4();
    const buckets = new Map(), done = [];
    root.traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material)) return;
        const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        if (!g.attributes.uv) return;
        g.applyMatrix4(m4.multiplyMatrices(inv, o.matrixWorld));
        if (!buckets.has(o.material)) buckets.set(o.material, { list: [], shadow: false });
        const b = buckets.get(o.material);
        b.list.push(g); b.shadow = b.shadow || o.castShadow;
        done.push(o);
    });
    for (const o of done) o.parent.remove(o);
    for (const [material, b] of buckets) {
        const mesh = new T.Mesh(mergeGeometries(b.list), material);
        mesh.castShadow = b.shadow;
        root.add(mesh);
        for (const g of b.list) g.dispose();
    }
}
