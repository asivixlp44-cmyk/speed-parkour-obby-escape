import {
    T, V3, scene, mat, candy, studMaterial, aabb, solids, kills, triggers, tickers,
    texFrom, billboard, textPlane, camera,
} from './engine.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildShoe, trophy } from './props.js';
import {
    chevronTexture, carpetTexture, glassTexture, lavaTexture, stripeTexture, spawnTexture, beamTexture, rainbowTexture,
    beltTexture, cloudTexture, scrolling,
} from './textures.js';
import { emitTread } from './fx.js';
import { S, actions, net } from './state.js';
import {
    CFG, LOBBY, STAGES, HALL_W, PLAT_HALF, PAD, WALLRUN_HALF, PILLAR, THEMES, TREAD, TREAD_SPOTS, treadById, ownsTread,
    SHOES, OP_SHOES, FINALE, ESCAPE, fmt, rngFrom, eventState, maxSpeedFor,
} from '../../shared/config.js';

const HW = HALL_W / 2;                  // 20: half the hall width
const LX = LOBBY.halfX, LZ0 = LOBBY.z0, LZ1 = LOBBY.z1;
export const SPAWN = new V3(LOBBY.spawn.x, LOBBY.spawn.y, LOBBY.spawn.z);
// The reference's palette (sampled from the video)
const C = {
    floor: 0x9a88cf, wall: 0xb9a6e6, wallDark: 0x8e7ab7, pillar: 0xe2dafc, trim: 0xd8ccff,
    red: 0xea001b, cyan: 0x68d2fd, navy: 0x1a2a6a, navyDeep: 0x06205d, spike: 0x7a6cb0,
    yellow: 0xfeda20, purple: 0xc81cff, frame: 0x8985c7, belt: 0x36396b, white: 0xf4f2ff,
};

// =====================================================================================
// Zones: the lobby (-1) and one per stage. Each zone's meshes live in their own group, so far
// stages can be hidden, and the player only collides with nearby zones.
// =====================================================================================
const zoneGroups = new Map();
export function zoneGroup(i) {
    let g = zoneGroups.get(i);
    if (!g) { g = new T.Group(); g.userData.zone = i; scene.add(g); zoneGroups.set(i, g); }
    return g;
}
// Shows the lobby and the stages around `stage` (-1 = lobby). The hall is straight, so the next
// two stages stay drawn: you can see where you're going.
export function cullZones(stage) {
    for (const [i, g] of zoneGroups) {
        g.visible = i === -1 ? stage <= 0 : (i >= stage - 1 && i <= stage + 2) || (stage < 0 && i <= 1);
    }
}

// ----- static geometry, merged per zone and material at the end -----
const geoBatches = new Map();
function addGeo(zone, geo, material, cast) {
    const k = zone + '|' + material.uuid + '|' + (cast ? 1 : 0);
    let b = geoBatches.get(k);
    if (!b) { b = { zone, material, cast, list: [] }; geoBatches.set(k, b); }
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
    if (!geo.index) { const idx = []; for (let i = 0; i < geo.attributes.position.count; i++) idx.push(i); geo.setIndex(idx); }
    b.list.push(geo);
}
function flushGeo() {
    for (const b of geoBatches.values()) {
        const mesh = new T.Mesh(mergeGeometries(b.list), b.material);
        mesh.receiveShadow = true; mesh.castShadow = !!b.cast;
        mesh.matrixAutoUpdate = false;
        zoneGroup(b.zone).add(mesh);
        for (const g of b.list) g.dispose();
    }
    geoBatches.clear();
}
function solid(zone, x, y, z, sx, sy, sz, extra) {
    const c = aabb(x, y, z, sx, sy, sz);
    c.zone = zone;
    if (extra) Object.assign(c, extra);
    solids.push(c);
    return c;
}
// Box with Roblox studs: UVs in world units / 8 so the stud tile keeps its size on any face
function studBox(zone, sx, sy, sz, x, y, z, color, o) {
    o = o || {};
    const g = new T.BoxGeometry(sx, sy, sz);
    const uv = g.attributes.uv;
    const faces = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        uv.setXY(i, uv.getX(i) * faces[f][0] / 16, uv.getY(i) * faces[f][1] / 16);
    }
    g.translate(x, y, z);
    addGeo(zone, g, studMaterial(color, { rough: o.rough ?? 0.42 }), o.cast);
    if (o.solid !== false) return solid(zone, x, y, z, sx, sy, sz, o.extra);
    return null;
}
// Floor slab with its top at `top`
const floor = (zone, x0, x1, z0, z1, top, color, extra, thick) => studBox(zone, x1 - x0, thick || 4, z1 - z0, (x0 + x1) / 2, top - (thick || 4) / 2, (z0 + z1) / 2, color, { extra });
function plainBox(zone, sx, sy, sz, x, y, z, material, o) {
    o = o || {};
    const g = new T.BoxGeometry(sx, sy, sz);
    if (o.rx) g.rotateX(o.rx);
    if (o.rz) g.rotateZ(o.rz);
    if (o.ry) g.rotateY(o.ry);
    g.translate(x, y, z);
    addGeo(zone, g, material, o.cast);
    if (o.solid) return solid(zone, x, y, z, sx, sy, sz, o.extra);
    return null;
}
function roundBox(zone, sx, sy, sz, x, y, z, material, r, o) {
    o = o || {};
    const g = new RoundedBoxGeometry(sx, sy, sz, 2, Math.min(r, sx / 2 - 0.01, sy / 2 - 0.01, sz / 2 - 0.01));
    g.translate(x, y, z);
    addGeo(zone, g, material, o.cast);
    if (o.solid) return solid(zone, x, y, z, sx, sy, sz, o.extra);
    return null;
}
const glowMat = (c, k) => mat(c, { neon: true, boost: k });
function glowBox(zone, sx, sy, sz, x, y, z, color, k) { plainBox(zone, sx, sy, sz, x, y, z, glowMat(color, k)); }
function cyl(zone, r0, r1, h, x, y, z, material, seg, o) {
    o = o || {};
    const g = new T.CylinderGeometry(r0, r1, h, seg || 24);
    if (o.rx) g.rotateX(o.rx);
    if (o.rz) g.rotateZ(o.rz);
    g.translate(x, y, z);
    addGeo(zone, g, material, o.cast);
}
const shade = (c, k) => new T.Color(c).multiplyScalar(k).getHex();
const lighten = (c, k) => new T.Color(c).lerp(new T.Color(0xffffff), k).getHex();
const css = (h) => '#' + h.toString(16).padStart(6, '0');

// A plane whose UVs are in world units / tile, so a repeating texture keeps its size
function uvPlane(w, h, tw, th) {
    const g = new T.PlaneGeometry(w, h);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tw, uv.getY(i) * h / (th || tw));
    return g;
}
// Shared textured materials
let chevMat, glassMat, carpetMat;
const lavaMats = new Map();
function lavaMat(color) {
    let m = lavaMats.get(color);
    if (!m) {
        const tex = lavaTexture(color);
        m = new T.MeshStandardMaterial({ map: tex, emissive: new T.Color(color), emissiveIntensity: 0.55, emissiveMap: tex, roughness: 0.5 });
        lavaMats.set(color, m);
        if (!scrolling.some((s) => s.tex === tex)) scrolling.push({ tex, u: 0.02, v: 0.05 });
    }
    return m;
}

// ----- signs -----
// White boards with dark, slanted hand-lettering ("Walk towards the wall to climb it!")
function signCanvas(lines, W, H, o) {
    o = o || {};
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    x.fillStyle = o.border || '#2a2440'; x.beginPath(); x.roundRect(4, 4, W - 8, H - 8, 26); x.fill();
    x.fillStyle = o.bg || '#ffffff'; x.beginPath(); x.roundRect(16, 16, W - 32, H - 32, 18); x.fill();
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const n = lines.length;
    lines.forEach((l, i) => {
        let px = l.px || 96;
        const font = (p) => `italic 700 ${p}px Fredoka, "Comic Sans MS", sans-serif`;
        x.font = font(px);
        while (x.measureText(l.t).width > W - 80 && px > 20) { px -= 4; x.font = font(px); }
        const y = H / 2 + (i - (n - 1) / 2) * (H - 60) / n;
        if (l.s) { x.lineJoin = 'round'; x.lineWidth = px * 0.18; x.strokeStyle = l.s; x.strokeText(l.t, W / 2, y); }
        x.fillStyle = l.c || '#2a2440'; x.fillText(l.t, W / 2, y);
    });
    return cv;
}
function sign(zone, lines, w, h, pos, yaw, tilt) {
    const cv = signCanvas(lines, 1024, Math.round(1024 * h / w));
    const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: texFrom(cv), toneMapped: false }));
    m.position.copy(pos); m.rotation.set(0, yaw || 0, tilt || 0);
    zoneGroup(zone).add(m);
    // Back of the board
    const back = new T.Mesh(new T.PlaneGeometry(w, h), mat(0xe8e4f4));
    back.position.copy(pos); back.rotation.set(0, (yaw || 0) + Math.PI, -(tilt || 0));
    back.translateZ(0.05);
    zoneGroup(zone).add(back);
    return m;
}
// Big outlined title text floating in the world (STAGE 2 over a platform, WINS SHOP ...)
function bigText(zone, text, w, pos, yaw, colors, sub, subColor) {
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = sub ? 300 : 200;
    const x = cv.getContext('2d');
    let px = 132;
    x.font = `800 ${px}px Montserrat, Fredoka, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    while (x.measureText(text).width > 980 && px > 40) { px -= 4; x.font = `800 ${px}px Montserrat, Fredoka, sans-serif`; }
    x.lineJoin = 'round'; x.lineWidth = 20; x.strokeStyle = '#1c1530'; x.strokeText(text, 512, 100);
    const g = x.createLinearGradient(0, 40, 0, 160);
    g.addColorStop(0, colors[0]); g.addColorStop(1, colors[1]);
    x.fillStyle = g; x.fillText(text, 512, 100);
    if (sub) {
        let sp = 64;
        x.font = `700 ${sp}px Fredoka, sans-serif`;
        while (x.measureText(sub).width > 990 && sp > 20) { sp -= 2; x.font = `700 ${sp}px Fredoka, sans-serif`; }
        x.lineWidth = 12; x.strokeText(sub, 512, 236);
        x.fillStyle = subColor || '#ffd028'; x.fillText(sub, 512, 236);
    }
    const m = new T.Mesh(new T.PlaneGeometry(w, w * cv.height / 1024), new T.MeshBasicMaterial({ map: texFrom(cv), transparent: true, depthWrite: false, side: T.DoubleSide, toneMapped: false }));
    m.position.copy(pos); m.rotation.y = yaw || 0;
    zoneGroup(zone).add(m);
    return m;
}
function canvasPlane(zone, w, h, pxW, pxH, pos, yaw) {
    const cv = document.createElement('canvas'); cv.width = pxW; cv.height = pxH;
    const tex = texFrom(cv);
    const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
    m.position.copy(pos); m.rotation.y = yaw || 0;
    zoneGroup(zone).add(m);
    return { cv, tex, m };
}

// =====================================================================================
// Hazards. Everything moves on the server clock, so every player sees the same thing.
// =====================================================================================
const hazards = [];   // { zone, update(t, dt) }
function hz(zone, update) { hazards.push({ zone, update }); }
function killBox(zone, cause) {
    const k = { min: new V3(), max: new V3(), active: false, cause, zone };
    kills.push(k);
    return k;
}
function killTest(zone, cause, test) {
    const k = { test, active: true, cause, zone };
    kills.push(k);
    return k;
}
const cyc = (t, period, phase) => ((((t + (phase || 0)) % period) + period) % period) / period;
// Lava under a pit: a glowing plane and a kill box just above it
function lava(zone, x0, x1, z0, z1, y, color) {
    const m = new T.Mesh(uvPlane(x1 - x0, z1 - z0, 16), lavaMat(color));
    m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    m.receiveShadow = true;
    zoneGroup(zone).add(m);
    // A dark rim under the lava so the pit has walls
    studBox(zone, x1 - x0, 4, z1 - z0, (x0 + x1) / 2, y - 2.05, (z0 + z1) / 2, shade(color, 0.35), { solid: false });
    const k = killBox(zone, 'lava');
    k.min.set(x0, y - 30, z0); k.max.set(x1, y + 0.6, z1); k.active = true;
}
// Grey cone spikes standing on the lava (reference): deadly to touch
const spikeGeo = new T.ConeGeometry(1.5, 6, 8);
function spikes(zone, list, y) {
    const m = new T.InstancedMesh(spikeGeo, candy(C.spike, { rough: 0.45 }), list.length);
    const mx = new T.Matrix4();
    list.forEach((p, i) => { mx.makeScale(p.s, p.s, p.s).setPosition(p.x, y + 3 * p.s, p.z); m.setMatrixAt(i, mx); });
    m.castShadow = true;
    zoneGroup(zone).add(m);
    killTest(zone, 'spikes', (pos) => {
        for (const p of list) {
            const top = y + 6 * p.s;
            if (pos.y > top - 0.3 || pos.y + 5 < y) continue;
            const r = 1.5 * p.s * (1 - (Math.max(y, pos.y) - y) / (6 * p.s)) + 0.7;
            if ((pos.x - p.x) ** 2 + (pos.z - p.z) ** 2 < r * r) return true;
        }
        return false;
    });
}
function scatterSpikes(zone, x0, x1, z0, z1, y, rng, density) {
    const list = [], n = Math.max(2, Math.round((x1 - x0) * (z1 - z0) / (density || 70)));
    for (let k = 0; k < n; k++) list.push({ x: x0 + 2 + rng() * (x1 - x0 - 4), z: z0 + 2 + rng() * (z1 - z0 - 4), s: 0.7 + rng() * 0.6 });
    spikes(zone, list, y);
}

// ----- lasers: red beams across the hall, moving up and down -----
const beamGeo = new T.PlaneGeometry(1, 1);
function laserBeam(zone, color, width) {
    const grp = new T.Group();
    const m = new T.MeshBasicMaterial({ map: beamTexture(), color, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, toneMapped: false });
    m.color.multiplyScalar(3);
    const a = new T.Mesh(beamGeo, m), b = new T.Mesh(beamGeo, m);
    b.rotation.x = Math.PI / 2;
    grp.add(a, b);
    const core = new T.Mesh(new T.CylinderGeometry(0.14, 0.14, 1, 6), glowMat(0xffffff, 2.2));
    core.rotation.z = Math.PI / 2;
    grp.add(core);
    grp.scale.set(width, 1.1, 1);
    zoneGroup(zone).add(grp);
    return grp;
}
function sweepLaser(zone, z, y0, y1, period, phase, color, width) {
    const beam = laserBeam(zone, color || 0xff1e3c, width || HALL_W);
    const emit = [];
    for (const s of [-1, 1]) {
        const e = new T.Mesh(new RoundedBoxGeometry(1.6, 1.6, 2.4, 2, 0.3), candy(0x1a1a2a, { rough: 0.3 }));
        e.position.set(s * ((width || HALL_W) / 2 - 0.4), y0, z); zoneGroup(zone).add(e); emit.push(e);
    }
    const k = killBox(zone, 'laser');
    hz(zone, (t) => {
        const c = 0.5 - 0.5 * Math.cos(2 * Math.PI * cyc(t, period, phase));
        const y = y0 + (y1 - y0) * c;
        beam.position.set(0, y, z);
        for (const e of emit) e.position.y = y;
        k.min.set(-(width || HALL_W) / 2, y - 0.4, z - 1); k.max.set((width || HALL_W) / 2, y + 0.4, z + 1); k.active = true;
    });
}

// =====================================================================================
// Lobby: the lavender hall with the cyan arrow carpet from the spawn to the Stage 1 door.
// Right of the spawn (-x): TRAIN SPEED (treadmills). Left (+x): WINS SHOP (shoes). By the door: OP
// Shoes and the NEW UPD board. Behind the spawn: World 2 portal, OP REWARD chest, leaderboards.
// =====================================================================================
const shopItems = [];   // shoe pads, treadmills, gates: labels refreshed when they change
const boards = {};
const signs = {};
export const treadOwned = (def) => ownsTread(S, def);

function lobbyPillar(Z, x, z, h) {
    studBox(Z, 7, h, 7, x, h / 2, z, C.pillar, { cast: false });
    roundBox(Z, 8.4, 1.6, 8.4, x, h + 0.8, z, candy(C.trim, { rough: 0.35 }), 0.4);
    roundBox(Z, 8.4, 1.6, 8.4, x, 0.8, z, candy(C.trim, { rough: 0.35 }), 0.4);
}
function buildLobby() {
    const Z = -1;
    const g = zoneGroup(Z);
    // Floor
    floor(Z, -LX, LX, LZ0, LZ1, 0, C.floor);
    // Cyan arrow carpet from behind the spawn to the Stage 1 door (reference)
    carpetMat = new T.MeshStandardMaterial({ map: carpetTexture(), roughness: 0.4, emissive: 0x2a7ab0, emissiveIntensity: 0.25 });
    const carpet = new T.Mesh(uvPlane(24, LZ1 - (SPAWN.z - 14), 12, 12), carpetMat);
    carpet.rotation.x = -Math.PI / 2; carpet.position.set(0, 0.05, (LZ1 + SPAWN.z - 14) / 2); carpet.receiveShadow = true; g.add(carpet);
    // Spawn pad: white with the black star
    const sp = new T.Mesh(new T.BoxGeometry(14, 0.5, 14), [mat(C.white), mat(C.white), new T.MeshStandardMaterial({ map: spawnTexture(), roughness: 0.4 }), mat(C.white), mat(C.white), mat(C.white)]);
    sp.position.set(SPAWN.x, 0.25, SPAWN.z); sp.receiveShadow = true; g.add(sp);
    solid(Z, SPAWN.x, 0.25, SPAWN.z, 14, 0.5, 14);

    // Walls with big pillars and a trim, the Stage 1 doorway in the north wall
    const WH = LOBBY.wallHeight;
    studBox(Z, 2, WH, LZ1 - LZ0 + 4, LX + 1, WH / 2, (LZ0 + LZ1) / 2, C.wall);
    studBox(Z, 2, WH, LZ1 - LZ0 + 4, -LX - 1, WH / 2, (LZ0 + LZ1) / 2, C.wall);
    studBox(Z, LX * 2 + 4, WH, 2, 0, WH / 2, LZ0 - 1, C.wall);
    for (const s of [-1, 1]) studBox(Z, LX - HW, WH, 2, s * (HW + (LX - HW) / 2), WH / 2, LZ1 + 1, C.wall);
    studBox(Z, HALL_W, WH - 30, 2, 0, 30 + (WH - 30) / 2, LZ1 + 1, C.wall);
    for (const x of [-LX + 4, -58, -30, 30, 58, LX - 4]) lobbyPillar(Z, x, LZ1 - 3, WH);
    for (const x of [-LX + 4, -44, 0, 44, LX - 4]) lobbyPillar(Z, x, LZ0 + 3, WH);
    for (const z of [-60, -20]) { lobbyPillar(Z, LX - 3, z, WH); lobbyPillar(Z, -LX + 3, z, WH); }
    // Doorway frame and the STAGE 1 sign over it
    for (const s of [-1, 1]) roundBox(Z, 3.4, 30, 4, s * (HW + 1.7), 15, LZ1, candy(C.pillar, { rough: 0.35 }), 0.5);
    roundBox(Z, HALL_W + 6.8, 3.4, 4, 0, 30, LZ1, candy(C.pillar, { rough: 0.35 }), 0.5);
    bigText(Z, 'STAGE 1', 22, new V3(0, 35, LZ1 - 2.2), Math.PI, ['#ffffff', '#e8e0ff']);
    // Wall trim along the top
    for (const [sx, sz, x, z] of [[2.6, LZ1 - LZ0 + 4, LX + 1, (LZ0 + LZ1) / 2], [2.6, LZ1 - LZ0 + 4, -LX - 1, (LZ0 + LZ1) / 2], [LX * 2 + 4, 2.6, 0, LZ0 - 1], [LX * 2 + 4, 2.6, 0, LZ1 + 1]]) {
        roundBox(Z, sx, 1.6, sz, x, WH + 0.8, z, candy(C.trim, { rough: 0.3 }), 0.5);
    }
    // Lavender wainscot band round the walls (the reference's darker lower panels)
    for (const s of [-1, 1]) studBox(Z, 1, 8, LZ1 - LZ0, s * (LX - 0.4), 4, (LZ0 + LZ1) / 2, C.wallDark, { solid: false });

    buildBoards(Z);
    buildChest(Z);
    buildEventBoard(Z);
    buildOpShoes(Z);
    buildPortal(Z);
    buildLobbyTreads(Z);
    buildWinsShop(Z);
    sign(Z, [{ t: 'Jump twice to' }, { t: 'Double Jump!' }], 13, 5.6, new V3(-30, 9, LZ1 - 1.2), Math.PI, 0.05);
}

// ----- leaderboards: Top Speed (blue), Top Wins (gold), Top Rebirths (purple), as in the reference -----
function leaderboard(Z, pos, title, color, yaw) {
    const grp = new T.Group(); grp.position.copy(pos); grp.rotation.y = yaw; zoneGroup(Z).add(grp);
    const frameM = studMaterial(color, { rough: 0.35, rx: 2, ry: 3 });
    const add = (geo, m, x, y, z) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; grp.add(o); return o; };
    add(new T.BoxGeometry(17, 24, 1.6), frameM, 0, 13.5, 0);
    add(new T.BoxGeometry(18.4, 1.6, 2.4), candy(lighten(color, 0.3)), 0, 25.8, 0);
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 640;
    const tex = texFrom(cv);
    const scr = new T.Mesh(new T.PlaneGeometry(15, 18.75), new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
    scr.position.set(0, 12.6, 0.82); grp.add(scr);
    const head = textPlane([{ t: title, c: '#ffffff', s: '#1c1530', px: 92 }], 15, 1024, new V3(), new V3(0, 0, 1), grp);
    head.position.set(0, 23.4, 0.85);
    solids.push(Object.assign(aabb(pos.x, 13, pos.z, 12, 26, 12), { zone: Z }));
    return { cv, tex, color };
}
function buildBoards(Z) {
    boards.speed = leaderboard(Z, new V3(-24, 0, LZ0 + 8), '👟 Top Speed', 0x3a8cff, 0);
    boards.rebirths = leaderboard(Z, new V3(24, 0, LZ0 + 8), '🔄 Top Rebirths', 0xb84aff, 0);
    boards.wins = leaderboard(Z, new V3(-58, 0, LZ0 + 6), '🏆 Top Wins', 0xffb81c, 0);
}
function drawBoard(b, rows, kind) {
    const x = b.cv.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 640);
    g.addColorStop(0, '#2a2060'); g.addColorStop(1, '#14103a');
    x.fillStyle = g; x.fillRect(0, 0, 512, 640);
    x.font = '700 32px Fredoka, sans-serif'; x.textBaseline = 'middle';
    if (!rows.length) { x.textAlign = 'center'; x.fillStyle = '#ffffff'; x.fillText('Be the first!', 256, 320); }
    rows.forEach((r, i) => {
        const y = 34 + i * 62;
        if (i % 2 === 0) { x.fillStyle = 'rgba(255,255,255,0.06)'; x.fillRect(0, y - 31, 512, 62); }
        x.textAlign = 'left'; x.fillStyle = r.you ? '#7dff6b' : i < 3 ? ['#ffd028', '#e0e6f0', '#e8a060'][i] : '#ffffff';
        x.fillText('#' + (i + 1), 14, y);
        x.fillText(r.n.slice(0, 13), 78, y);
        x.textAlign = 'right'; x.fillStyle = kind === 'speed' ? '#6fe0ff' : kind === 'wins' ? '#ffd028' : '#e08aff';
        x.fillText(fmt(r.v), 500, y);
    });
    b.tex.needsUpdate = true;
}
// msg = { speed: [{n, v}], wins: [...], rebirths: [...] } from the server, top 10 each
export function renderBoards(msg) {
    if (!boards.speed || !msg) return;
    for (const kind of ['speed', 'wins', 'rebirths']) drawBoard(boards[kind], (msg[kind] || []).map((r) => ({ n: r.n, v: r.v, you: r.n === S.name })), kind);
}

// ----- OP REWARD chest: "Like + Join Group!" (the daily group reward) -----
function buildChest(Z) {
    const x = 8, z = LZ0 + 10;
    const grp = new T.Group(); grp.position.set(x, 0, z); grp.rotation.y = 0.15; zoneGroup(Z).add(grp);
    const add = (geo, m, px, py, pz, rx) => { const o = new T.Mesh(geo, m); o.position.set(px, py, pz); if (rx) o.rotation.x = rx; o.castShadow = true; grp.add(o); return o; };
    const bodyM = candy(0xffc414, { rough: 0.3, clear: true }), trimM = candy(0xe8202a, { rough: 0.3 });
    add(new RoundedBoxGeometry(9, 5, 6, 2, 0.5), bodyM, 0, 2.5, 0);
    add(new RoundedBoxGeometry(9.2, 2.6, 6.2, 2, 0.7), bodyM, 0, 5.8, -0.3, -0.18);
    for (const sx of [-3, 0, 3]) add(new T.BoxGeometry(0.8, 5.2, 6.3), trimM, sx, 2.6, 0);
    add(new RoundedBoxGeometry(1.6, 1.8, 0.6, 2, 0.2), candy(0xffffff), 0, 3.9, 3.1);
    billboard([{ t: 'OP REWARD!', c: '#ffd028', s: '#1c1530', px: 70 }, { t: 'Like + Join Group!', c: '#ffffff', s: '#1c1530', px: 50 }], 12, 512, new V3(x, 12, z), zoneGroup(Z));
    solids.push(Object.assign(aabb(x, 3, z, 9, 6, 6), { zone: Z }));
    const tr = aabb(x, 3, z + 5, 12, 6, 5); tr.enter = () => actions.chest(); tr.zone = Z; triggers.push(tr);
}

// ----- NEW UPD board ("4D 9H 2M 13S / NEW UPDATE / Admin Abuse!!!"): here the Admin Abuse countdown -----
function buildEventBoard(Z) {
    const x = -32, z = LZ1 - 8;
    for (const s of [-1, 1]) roundBox(Z, 1.2, 14, 1.2, x + s * 8, 7, z, candy(0x2a2a3a, { rough: 0.4 }), 0.3);
    const p = canvasPlane(Z, 18, 10.5, 768, 448, new V3(x, 14, z - 0.7), Math.PI);
    roundBox(Z, 19, 11.5, 1, x, 14, z, candy(0x14141e, { rough: 0.4 }), 0.4);
    signs.event = { cv: p.cv, tex: p.tex, last: '' };
    solids.push(Object.assign(aabb(x, 8, z, 18, 16, 3), { zone: Z }));
}
function drawEventBoard() {
    const e = signs.event;
    if (!e) return;
    const ev = eventState(net.now());
    const key = ev.on + '|' + Math.floor(ev.left);
    if (key === e.last) return;
    e.last = key;
    const x = e.cv.getContext('2d'), W = e.cv.width, H = e.cv.height;
    const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#2a1440'); g.addColorStop(1, '#0e0a24');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
    const line = (t, y, px, col, stroke) => { x.font = `800 ${px}px Montserrat, Fredoka, sans-serif`; if (stroke) { x.lineWidth = px * 0.2; x.strokeStyle = '#000'; x.strokeText(t, W / 2, y); } x.fillStyle = col; x.fillText(t, W / 2, y); };
    const m = Math.floor(ev.left / 60), s = Math.floor(ev.left % 60);
    if (ev.on) {
        line('ADMIN ABUSE!!!', 80, 74, '#ffd028', true);
        line('x2 SPEED & x2 WINS', 200, 56, '#7dff6b', true);
        line('Ends in ' + m + 'M ' + String(s).padStart(2, '0') + 'S', 320, 54, '#ffffff', true);
    } else {
        line(m + 'M ' + String(s).padStart(2, '0') + 'S', 70, 70, '#ffffff', true);
        line('🔥 NEXT EVENT 🔥', 150, 40, '#ffb04a');
        line('NEW UPD', 250, 100, '#ffffff', true);
        line('+ Admin Abuse!!!', 350, 56, '#ffd028', true);
        line('x2 Speed & Wins for everyone', 420, 30, '#7dff6b');
    }
    e.tex.needsUpdate = true;
}

// ----- OP Shoes by the door (left: Lucky, Flame, the Invite pad; right: Dragon), Hacker Shoes at the back -----
function shoeStand(Z, d, x, z, padColor, yaw) {
    roundBox(Z, 8, 1.2, 8, x, 0.6, z, candy(padColor, { rough: 0.3, clear: true }), 0.4, { solid: true });
    glowBox(Z, 7.6, 0.12, 7.6, x, 1.25, z, padColor, 1.3);
    const shoe = buildShoe(d); shoe.scale.setScalar(2); shoe.position.set(x, 3, z); shoe.rotation.y = yaw || 0;
    zoneGroup(Z).add(shoe);
    const at = new V3(x, 3, z);
    tickers.push((dt, t) => { if (zoneGroup(Z).visible && camera.position.distanceToSquared(at) < 160 * 160) { shoe.rotation.y += dt * 0.7; shoe.position.y = 3 + Math.sin(t * 2 + x) * 0.3; } });
    const sp = billboard(shoeLines(d), 9, 512, new V3(x, 9.6, z), zoneGroup(Z));
    shopItems.push({ kind: 'shoe', def: d, sp, sig: '' });
    const tr = aabb(x, 2, z, 8, 4, 8); tr.zone = Z; tr.enter = () => actions.shoe(d); triggers.push(tr);
}
function buildOpShoes(Z) {
    bigText(Z, 'OP Shoes!', 16, new V3(33, 15, LZ1 - 15), Math.PI, ['#ff5ab8', '#ffd028']);
    shoeStand(Z, OP_SHOES[0], 26, LZ1 - 14, 0x46ec50);
    shoeStand(Z, OP_SHOES[1], 40, LZ1 - 14, 0x46ec50);
    shoeStand(Z, OP_SHOES[2], -46, LZ1 - 14, 0x46ec50);
    // "Invite All Of Your Friends! +500 Speed": the Friends panel (Friend Boost)
    roundBox(Z, 8, 1, 8, 54, 0.5, LZ1 - 14, candy(0xff8a1e, { rough: 0.3 }), 0.4, { solid: true });
    const inv = buildShoe({ color: 0xffd028, accent: 0xffffff }); inv.scale.setScalar(1.6); inv.position.set(54, 2.6, LZ1 - 14); zoneGroup(Z).add(inv);
    tickers.push((dt) => { if (zoneGroup(Z).visible) inv.rotation.y += dt * 1.2; });
    billboard([{ t: 'Invite All Of Your', c: '#ffd028', s: '#1c1530', px: 52 }, { t: 'Friends!', c: '#ffd028', s: '#1c1530', px: 52 }, { t: '+10% Speed each', c: '#ffffff', s: '#1c1530', px: 46 }], 10, 512, new V3(54, 9, LZ1 - 14), zoneGroup(Z));
    const tr = aabb(54, 2, LZ1 - 14, 8, 4, 8); tr.zone = Z; tr.enter = () => actions.invite(); triggers.push(tr);
    // Hacker Shoes, by the WINS SHOP
    shoeStand(Z, OP_SHOES[3], 66, LZ0 + 16, 0x2aff6a);
}

// ----- WORLD 2 portal (2,500 Wins) behind the spawn -----
function buildPortal(Z) {
    const x = 50, z = LZ0 + 4;
    for (const s of [-1, 1]) studBox(Z, 3, 20, 3, x + s * 7, 10, z, 0x1e1640);
    studBox(Z, 17, 3, 3, x, 21.5, z, 0x1e1640);
    const sw = new T.Mesh(new T.CircleGeometry(5.6, 40), new T.MeshBasicMaterial({ color: 0xff3ad8, toneMapped: false }));
    sw.material.color.multiplyScalar(1.5);
    sw.position.set(x, 10, z + 1.6); sw.scale.set(1, 1.6, 1); zoneGroup(Z).add(sw);
    const swirl = textPlane([{ t: '@', c: '#ffffff', px: 300 }], 7, 256, new V3(x, 10, z + 1.7), new V3(x, 10, z + 10), zoneGroup(Z));
    tickers.push((dt, t) => { if (zoneGroup(Z).visible) swirl.rotation.z = -t * 2; });
    billboard([{ t: 'WORLD 2', c: '#ffffff', s: '#1c1530', px: 84 }, { t: '🏆 2,500', c: '#ffd028', s: '#1c1530', px: 66 }], 11, 512, new V3(x, 27, z + 2), zoneGroup(Z));
    const tr = aabb(x, 3, z + 3, 10, 6, 3); tr.zone = Z; tr.enter = () => actions.portal(); triggers.push(tr);
}

// ----- treadmills -----
let beltTex;
function treadLines(def) {
    const owned = ownsTread(S, def);
    if (def.id === 'n') return [{ t: 'TRAIN HERE', c: '#ffffff', s: '#1c1530', px: 60 }];
    const lines = [{ t: def.label, c: css(lighten(def.color, 0.15)), s: '#1c1530', px: 70 }];
    if (owned) lines.push({ t: '✓ OWNED', c: '#7dff6b', s: '#1c1530', px: 46 });
    else if (def.reb) lines.push({ t: def.reb + ' Rebirth' + (def.reb > 1 ? 's' : ''), c: '#ffffff', s: '#1c1530', px: 52 });
    else lines.push({ t: '🏆 ' + fmt(def.cost), c: S.wins >= def.cost ? '#7dff6b' : '#ffd028', s: '#1c1530', px: 56 });
    return lines;
}
function treadmill(Z, spot) {
    const def = treadById[spot.id], g = TREAD, cx = spot.x, cz = spot.z, y = spot.y, top = y + g.top;
    const fancy = def.id !== 'n';
    const frameC = fancy ? def.color : C.frame;
    // Frame round the belt (lavender studs, or the treadmill's colour)
    studBox(Z, g.width + 2.4, g.top, g.len + 2.4, cx, y + g.top / 2 - 0.15, cz, frameC === 0xffffff ? 0xe8e8f8 : frameC, { solid: false });
    solid(Z, cx, y + g.top / 2 - 0.15, cz, g.width + 2.4, g.top - 0.3, g.len + 2.4);
    const belt = new T.Mesh(new T.BoxGeometry(g.width, 0.3, g.len), new T.MeshStandardMaterial({ map: beltTex, roughness: 0.6 }));
    belt.position.set(cx, top + 0.15, cz); belt.receiveShadow = true; zoneGroup(Z).add(belt);
    solid(Z, cx, top, cz, g.width, 0.3, g.len, { tread: def });
    for (const s of [-1, 1]) {
        if (fancy) glowBox(Z, 0.4, 0.5, g.len + 1, cx + s * (g.width / 2 + 0.7), top + 0.35, cz, def.id === 'x100' ? 0xffffff : def.color, 1.5);
        roundBox(Z, 0.5, 4, 0.5, cx + s * (g.width / 2 + 0.6), top + 2, cz + g.len / 2 - 0.5, candy(0xe8e4f4, { rough: 0.3 }), 0.2);
    }
    roundBox(Z, g.width + 1.6, 0.6, 1.4, cx, top + 4, cz + g.len / 2 - 0.5, candy(fancy ? frameC : 0x6a64a8, { rough: 0.3 }), 0.25);
    const small = spot.zone >= 0;
    const sp = billboard(treadLines(def), (def.id === 'n' ? 8 : 9.5) * (small ? 0.7 : 1), 512, new V3(cx, top + (small ? 6.5 : 9), cz), zoneGroup(Z));
    shopItems.push({ kind: 'tread', def, sp, sig: '' });
    if (fancy) {
        const at = new V3(cx, top + 0.4, cz);
        let acc = Math.random();
        tickers.push((dt) => {
            if (!zoneGroup(Z).visible || camera.position.distanceToSquared(at) > 110 * 110) return;
            acc += dt * (ownsTread(S, def) ? 5 : 1.5);
            while (acc > 1) { acc -= 1; emitTread(at, def.mult, g.width * 0.8, g.len * 0.9, def.id === 'x100' ? 0xffffff : def.color); }
        });
    }
    // Locked: stepping on it says so and offers it
    const tr = aabb(cx, top + 2, cz, g.width, 3, g.len); tr.zone = Z;
    tr.enter = () => { if (!ownsTread(S, def)) actions.treadBuy(def); };
    triggers.push(tr);
}
function buildLobbyTreads(Z) {
    // The TRAIN SPEED floor: a blue studded deck
    floor(Z, -LX + 2, -24, -92, -8, 0.3, 0x4a8cff, null, 0.6);
    bigText(Z, 'TRAIN SPEED', 40, new V3(-LX + 0.6, 30, -50), Math.PI / 2, ['#ffffff', '#8ae8ff']);
    for (const spot of TREAD_SPOTS) if (spot.zone === -1) treadmill(Z, { ...spot, y: 0.3 });
}

// ----- WINS SHOP: a row of shoe pedestals along the west wall (+x), "+1 Speed / 1 Wins Required" -----
function shoeLines(d) {
    let sub;
    if (S.shoe === d.id) sub = { t: 'EQUIPPED', c: '#6fe0ff' };
    else if (S.shoes[d.id]) sub = { t: 'OWNED · step to equip', c: '#7dff6b' };
    else if (d.daily) sub = { t: 'Daily Reward Day 7', c: '#ffd028' };
    else sub = { t: fmt(d.cost) + ' Wins Required', c: S.wins >= d.cost ? '#7dff6b' : '#ffd028' };
    const lines = [{ t: '+' + fmt(d.bonus) + ' Speed', c: '#ffffff', s: '#1c1530', px: 66 }, { ...sub, s: '#1c1530', px: 46 }];
    if (d.op) lines.unshift({ t: d.name.toUpperCase(), c: css(lighten(d.color, 0.25)), s: '#1c1530', px: 54 });
    else lines.push({ t: d.name, c: css(lighten(d.color, 0.35)), s: '#1c1530', px: 34 });
    return lines;
}
function buildWinsShop(Z) {
    const x = LX - 12;
    // Raised ledge along the wall with dark pads
    studBox(Z, 18, 1.6, 120, x + 2, 0.8, -36, 0x6a5aa8);
    bigText(Z, 'WINS SHOP', 40, new V3(LX - 0.6, 30, -36), -Math.PI / 2, ['#ffffff', '#ffe36b']);
    const cup = trophy(2.6); cup.position.set(LX - 1.2, 22, -8); zoneGroup(Z).add(cup);
    SHOES.forEach((d, i) => {
        const z = -88 + i * 9.6, top = 1.6;
        roundBox(Z, 7.6, 0.6, 7.6, x, top + 0.3, z, candy(0x22203a, { rough: 0.35 }), 0.3);
        glowBox(Z, 7.8, 0.1, 7.8, x, top + 0.02, z, d.color, 1.2);
        const shoe = buildShoe(d); shoe.scale.setScalar(1.7); shoe.position.set(x, top + 2.4, z); shoe.rotation.y = -Math.PI / 2 + 0.5;
        zoneGroup(Z).add(shoe);
        const at = new V3(x, top + 2, z);
        tickers.push((dt, t) => { if (zoneGroup(Z).visible && camera.position.distanceToSquared(at) < 140 * 140) { shoe.rotation.y += dt * 0.6; shoe.position.y = top + 2.4 + Math.sin(t * 2 + i) * 0.25; } });
        const sp = billboard(shoeLines(d), 8.2, 512, new V3(x, top + 8.2, z), zoneGroup(Z));
        shopItems.push({ kind: 'shoe', def: d, sp, sig: '' });
        const tr = aabb(x, top + 2, z, 7, 4, 7); tr.zone = Z; tr.enter = () => actions.shoe(d); triggers.push(tr);
    });
}

// Labels on the shoe pads, treadmills and stage gates, redrawn only when what they show changes
export function refreshShop() {
    const speed = maxSpeedFor(S.level, S.rebirths);
    for (const it of shopItems) {
        let sig;
        if (it.kind === 'shoe') sig = S.shoe + (S.shoes[it.def.id] ? 1 : 0) + (S.wins >= it.def.cost ? 'w' : '');
        else if (it.kind === 'tread') sig = (ownsTread(S, it.def) ? 'o' : '') + (S.wins >= (it.def.cost || 0) ? 'w' : '') + S.rebirths;
        else sig = speed >= it.def.need ? 'ok' : 'no';
        if (sig === it.sig) continue;
        it.sig = sig;
        if (it.kind === 'gate') it.redraw(speed >= it.def.need);
        else it.sp.userData.set(it.kind === 'shoe' ? shoeLines(it.def) : treadLines(it.def));
    }
}
export function updateLobbySigns() { drawEventBoard(); }

// =====================================================================================
// Stages
// =====================================================================================
export const poles = [];          // { x0, x1, y, z, zone }
export const checkpoints = [];    // stage platform spawns
const sideWalls = (Z, s, z0, z1, yLow, yHigh, half) => {
    const th = THEMES[s.theme], len = z1 - z0;
    if (len <= 0) return;
    for (const side of [-1, 1]) studBox(Z, 2, yHigh - yLow, len, side * ((half || HW) + 1), (yHigh + yLow) / 2, (z0 + z1) / 2, th.wall);
};
// Pillars along the hall walls every ~28 studs (reference: tall lighter columns)
function hallPillars(Z, s, z0, z1, yLow, yHigh) {
    const th = THEMES[s.theme];
    for (let z = z0 + 12; z < z1 - 6; z += 28) for (const side of [-1, 1]) studBox(Z, 3, yHigh - yLow, 5, side * (HW - 0.5), (yHigh + yLow) / 2, z, th.pillar, { solid: false });
}

// The stage gate at the start of each stage: a frame across the hall with a navy board:
// "STAGE 4 / Slide Under! / ⚡ 44 Speed" (the reference's signs, plus the speed it takes)
function stageGate(s, z, y) {
    const Z = s.i > 0 ? s.i - 1 : 0, th = THEMES[s.theme];
    const stripe = stripeTexture(0x16121f, 0xffd028, 4);
    const sm = new T.MeshStandardMaterial({ map: stripe, roughness: 0.4 });
    for (const sx of [-1, 1]) roundBox(Z, 2.4, 24, 2.4, sx * (HW - 1.2), y + 12, z, candy(C.pillar, { rough: 0.35 }), 0.4);
    const bar = new T.Mesh(new T.BoxGeometry(HALL_W, 2, 2.6), sm); bar.position.set(0, y + 25, z); zoneGroup(Z).add(bar);
    const p = canvasPlane(Z, 18, 8.4, 900, 420, new V3(0, y + 19.6, z - 1.4), Math.PI);
    roundBox(Z, 19, 9.4, 1.4, 0, y + 19.6, z, candy(C.navyDeep, { rough: 0.35 }), 0.4);
    const draw = (ok) => {
        const x = p.cv.getContext('2d'), W = p.cv.width, H = p.cv.height;
        x.fillStyle = '#0b1640'; x.fillRect(0, 0, W, H);
        x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
        x.font = '800 140px Montserrat, Fredoka, sans-serif'; x.lineWidth = 18; x.strokeStyle = '#000'; x.strokeText(s.name.toUpperCase(), W / 2, 120);
        x.fillStyle = '#ffffff'; x.fillText(s.name.toUpperCase(), W / 2, 120);
        let px = 74; x.font = `700 ${px}px Fredoka, sans-serif`;
        while (x.measureText(s.hint).width > W - 60 && px > 30) { px -= 4; x.font = `700 ${px}px Fredoka, sans-serif`; }
        x.fillStyle = css(lighten(th.accent, 0.3)); x.fillText(s.hint, W / 2, 252);
        x.font = '700 60px Fredoka, sans-serif';
        x.fillStyle = ok ? '#7dff6b' : '#ff5a5a';
        x.fillText('⚡ ' + s.need + ' Speed', W / 2, 352);
        p.tex.needsUpdate = true;
    };
    draw(false);
    shopItems.push({ kind: 'gate', def: s, redraw: draw, sig: '' });
}

// ----- segments -----
const SEG = {
    run(s, g, Z, rng) {
        floor(Z, -HW, HW, g.z0, g.z1, g.y0, THEMES[s.theme].floor);
        const tag = g.p[2];
        if (tag === 'lobbyHall') {
            sign(Z, [{ t: 'Walk towards' }, { t: 'the wall to' }, { t: 'climb it!' }], 11, 7, new V3(-HW + 0.6, g.y0 + 8, g.z1 - 14), Math.PI / 2, -0.06);
            sign(Z, [{ t: 'Jump twice to' }, { t: 'Double Jump!' }], 12, 5.4, new V3(HW - 0.6, g.y0 + 8, g.z0 + 16), -Math.PI / 2, 0.05);
        } else if (tag === 'pole') {
            sign(Z, [{ t: 'Touch the' }, { t: 'pole to swing!' }], 12, 6, new V3(HW - 0.6, g.y0 + 8, g.z0 + 8), -Math.PI / 2, 0.06);
        } else if (tag === 'super') {
            sign(Z, [{ t: 'Press' }, { t: 'Super Jump!' }], 12, 6.4, new V3(-HW + 4, g.y0 + 8, g.z1 - 3), Math.PI - 0.5, -0.06);
        }
        void rng;
    },
    climb(s, g, Z) {
        const H = g.y1 - g.y0, th = THEMES[s.theme];
        // The wall block: lavender sides, red chevron panel in the middle (the only climbable part)
        studBox(Z, 8, H, g.z1 - g.z0, -HW + 4, g.y0 + H / 2, (g.z0 + g.z1) / 2, th.wall);
        studBox(Z, 8, H, g.z1 - g.z0, HW - 4, g.y0 + H / 2, (g.z0 + g.z1) / 2, th.wall);
        studBox(Z, 24, H, g.z1 - g.z0, 0, g.y0 + H / 2, (g.z0 + g.z1) / 2, C.red, { solid: false });
        solid(Z, 0, g.y0 + H / 2, (g.z0 + g.z1) / 2, 24, H, g.z1 - g.z0, { climb: { top: g.y1, face: g.z0 } });
        const m = new T.Mesh(uvPlane(24, H, 24, 24), chevMat);
        m.position.set(0, g.y0 + H / 2, g.z0 - 0.06); m.rotation.y = Math.PI;
        zoneGroup(Z).add(m);
        // White frame round the climb panel
        for (const sx of [-1, 1]) roundBox(Z, 1, H, 1, sx * 12.4, g.y0 + H / 2, g.z0 - 0.3, candy(0xffffff, { rough: 0.3 }), 0.3);
        roundBox(Z, HALL_W, 1.2, g.z1 - g.z0 + 0.6, 0, g.y1 + 0.2, (g.z0 + g.z1) / 2, candy(th.trim, { rough: 0.3 }), 0.4);
    },
    pole(s, g, Z) {
        const th = THEMES[s.theme], len = g.z1 - g.z0, lavaY = g.y0 - 5;
        lava(Z, -HW, HW, g.z0, g.z1, lavaY, th.lava);
        const z = g.z0 + 4, y = g.y0 + 6.6;
        const pole = new T.Mesh(new T.CylinderGeometry(0.45, 0.45, HALL_W, 16), candy(0xffffff, { rough: 0.25, clear: true }));
        pole.rotation.z = Math.PI / 2; pole.position.set(0, y, z); pole.castShadow = true; zoneGroup(Z).add(pole);
        for (const sx of [-1, 1]) roundBox(Z, 1.6, 1.6, 1.6, sx * (HW - 0.6), y, z, candy(0x2a2a3a, { rough: 0.3 }), 0.3);
        poles.push({ x0: -HW + 1, x1: HW - 1, y, z, zone: Z, mesh: pole });
        // The gap's far lip
        void len;
    },
    wallrun(s, g, Z, rng) {
        const th = THEMES[s.theme], lavaY = g.y0 - 5, a = g.z0 + 4, b = g.z1 - 4, H = 26, wH = WALLRUN_HALF;
        floor(Z, -HW, HW, g.z0, a, g.y0, th.floor);
        floor(Z, -HW, HW, b, g.z1, g.y0, th.floor);
        lava(Z, -wH, wH, a, b, lavaY, th.lava);
        scatterSpikes(Z, -wH, wH, a, b, lavaY, rng, 110);
        // Solid fill beside the narrow corridor, blue glass faces toward it
        for (const side of [-1, 1]) {
            studBox(Z, HW - wH, H + 6, b - a, side * (wH + (HW - wH) / 2), g.y0 + H / 2 - 3, (a + b) / 2, th.wall, { solid: false });
            solid(Z, side * (wH + (HW - wH) / 2), g.y0 + H / 2 - 3, (a + b) / 2, HW - wH, H + 6, b - a, { wallrun: side });
            const m = new T.Mesh(uvPlane(b - a, H, 16, 16), glassMat);
            m.position.set(side * (wH + 0.05), g.y0 + H / 2 - 4, (a + b) / 2); m.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
            zoneGroup(Z).add(m);
            roundBox(Z, 1, 1, b - a, side * (wH + 0.3), g.y0 + H - 4, (a + b) / 2, candy(0xffffff, { rough: 0.3 }), 0.4);
        }
    },
    superjump(s, g, Z, rng) {
        const th = THEMES[s.theme], lavaY = g.y0 - 5;
        lava(Z, -HW, HW, g.z0, g.z1, lavaY, th.lava);
        scatterSpikes(Z, -HW, HW, g.z0, g.z1, lavaY, rng, 90);
    },
    crushers(s, g, Z, rng) {
        const th = THEMES[s.theme], n = g.p[1];
        floor(Z, -HW, HW, g.z0, g.z1, g.y0, th.floor);
        const stripe = stripeTexture(0x16121f, 0xffd028, 5).clone(); stripe.needsUpdate = true; stripe.repeat.set(6, 1);
        const beamM = new T.MeshStandardMaterial({ map: stripe, roughness: 0.4 });
        const sideSpikes = [];
        for (let k = 0; k < n; k++) {
            const z = g.z0 + 14 + k * 26 + 6;
            // Red danger zone under the beam
            const red = new T.Mesh(new T.PlaneGeometry(HALL_W, 8), mat(0xff2a3a));
            red.rotation.x = -Math.PI / 2; red.position.set(0, g.y0 + 0.04, z); zoneGroup(Z).add(red);
            const beam = new T.Mesh(new T.BoxGeometry(HALL_W - 1, 3, 5), beamM); beam.castShadow = true; zoneGroup(Z).add(beam);
            const kb = killBox(Z, 'crusher');
            const period = Math.max(2.2, 3.4 - s.i * 0.15), phase = k * 0.9 + rng();
            hz(Z, (t) => {
                const c = cyc(t, period, phase) * period;
                // up (12 high) 1.2 s, shake 0.4 s, slam 0.14 s, stay down 0.4 s, rise
                let h;
                if (c < 1.2) h = 12;
                else if (c < 1.6) h = 12 + Math.sin(c * 50) * 0.18;
                else if (c < 1.74) h = 12 * (1 - (c - 1.6) / 0.14);
                else if (c < 2.14) h = 0;
                else h = Math.min(12, 12 * (c - 2.14) / Math.max(0.3, period - 2.14));
                beam.position.set(0, g.y0 + h + 1.5, z);
                red.material = c >= 1.2 && c < 2.14 ? mat(0xff2a3a) : mat(0xd84a5a);
                kb.active = h < 4.8;
                kb.min.set(-HW, g.y0 + h - 0.2, z - 2.4); kb.max.set(HW, g.y0 + h + 3, z + 2.4);
            });
            for (const side of [-1, 1]) sideSpikes.push({ x: side * (HW - 2.2), z: z + (rng() - 0.5) * 6, s: 0.9 });
        }
        spikes(Z, sideSpikes, g.y0);
    },
    stairs(s, g, Z) {
        const th = THEMES[s.theme], steps = Math.ceil((g.y1 - g.y0) / 1.5);
        for (let k = 0; k < steps; k++) {
            const top = g.y0 + (g.y1 - g.y0) * (k + 1) / steps;
            studBox(Z, HALL_W, top - g.y0 + 4, 2.4, 0, (top + g.y0 - 4) / 2, g.z0 + (k + 0.5) * 2.4, th.floor);
        }
    },
    slidebar(s, g, Z) {
        // The next stage's gate: a low navy panel ("STAGE 4 / Slide Under!") to slide under
        const th = THEMES[s.theme], nx = STAGES[s.i + 1] || s;
        floor(Z, -HW, HW, g.z0, g.z1, g.y0, th.floor);
        const z = g.z0 + 5;
        studBox(Z, HALL_W, 12, 3, 0, g.y0 + 3 + 6, z, C.navyDeep);
        bigText(Z, nx.name.toUpperCase(), 14, new V3(0, g.y0 + 10.6, z - 1.6), Math.PI, ['#ffffff', '#dfe8ff'], nx.hint, '#ffffff');
    },
    slidewall(s, g, Z) {
        const th = THEMES[s.theme];
        floor(Z, -HW, HW, g.z0, g.z1, g.y0, th.floor);
        const top = g.y0 + 40, low = g.y0 + 3;
        studBox(Z, HALL_W, top - low, g.z1 - g.z0, 0, (top + low) / 2, (g.z0 + g.z1) / 2, C.navyDeep);
        bigText(Z, '⬇ Slide Under! ⬇', 34, new V3(0, low + 9, g.z0 - 0.2), Math.PI, ['#ffffff', '#e0f0ff']);
        glowBox(Z, HALL_W, 0.3, 0.3, 0, low + 0.1, g.z0 - 0.2, 0x5ad8ff, 1.6);
    },
    pillars(s, g, Z, rng) {
        const th = THEMES[s.theme], n = g.p[1], W = PILLAR, gap = (g.z1 - g.z0 - n * W) / (n + 1), lavaY = g.y0 - 5;
        lava(Z, -HW, HW, g.z0, g.z1, lavaY, th.lava);
        const list = [];
        for (let k = 0; k < n; k++) {
            const zc = g.z0 + gap * (k + 1) + W * k + W / 2, x = (k % 2 ? 1 : -1) * 5;
            studBox(Z, W, g.y0 - lavaY + 6, W, x, (g.y0 + lavaY - 6) / 2, zc, th.wall);
            studBox(Z, W + 0.2, 0.6, W + 0.2, x, g.y0 - 0.25, zc, C.navyDeep, { solid: false });
            list.push({ x: -x + (rng() - 0.5) * 6, z: zc + (rng() - 0.5) * 4, s: 1 });
        }
        spikes(Z, list, lavaY);
    },
    dbjump(s, g, Z) {
        const th = THEMES[s.theme], n = g.p[1];
        floor(Z, -HW, HW, g.z0, g.z1, g.y0, th.floor);
        for (let k = 0; k < n; k++) {
            const z = g.z0 + 10 + k * 20, h = 11.2;
            studBox(Z, HALL_W, h, 2, 0, g.y0 + h / 2, z, th.wall);
            roundBox(Z, HALL_W, 0.8, 2.6, 0, g.y0 + h, z, candy(0xffffff, { rough: 0.3 }), 0.3);
            // Blue arrow-up tile + "Double Jump!" on the face
            const icon = new T.Mesh(new T.PlaneGeometry(4.4, 4.4), new T.MeshBasicMaterial({ map: arrowIcon(), transparent: true, toneMapped: false }));
            icon.position.set(-9, g.y0 + h / 2, z - 1.05); icon.rotation.y = Math.PI; zoneGroup(Z).add(icon);
            bigText(Z, 'Double Jump!', 22, new V3(3, g.y0 + h / 2, z - 1.06), Math.PI, ['#ffffff', '#e8f0ff']);
        }
    },
    lasers(s, g, Z) {
        const th = THEMES[s.theme], n = g.p[1], gap = (g.z1 - g.z0 - n * 9) / (n + 1), lavaY = g.y0 - 6;
        lava(Z, -HW, HW, g.z0, g.z1, lavaY, th.lava);
        for (let k = 0; k < n; k++) {
            const zc = g.z0 + gap * (k + 1) + 9 * k + 4.5, x = (k % 2 ? 1 : -1) * 4;
            const colH = g.y0 - lavaY + 6;
            cyl(Z, 4.5, 4.5, colH, x, (g.y0 + lavaY - 6) / 2, zc, studMaterial(C.navyDeep, { rough: 0.4 }), 28);
            solids.push(Object.assign(aabb(x, (g.y0 + lavaY - 6) / 2, zc, 8, colH, 8), { zone: Z }));
            cyl(Z, 4.6, 4.6, 0.6, x, g.y0 - 1.4, zc, glowMat(0xff1e3c, 1.3), 28);
        }
        // A laser in every gap, sweeping up and down
        for (let k = 0; k <= n; k++) {
            const zc = g.z0 + gap * (k + 0.5) + 9 * k;
            sweepLaser(Z, zc, g.y0 + 0.8, g.y0 + 12, 3.2 - Math.min(0.8, s.i * 0.08), k * 0.7);
        }
    },
    platform(s, g, Z, rng) {
        const th = THEMES[s.theme], y = g.y0, ph = PLAT_HALF;
        const [py, pp] = s.pads, xGapR = pp.x - PAD.w / 2, xGapL = xGapR - pp.gap;
        floor(Z, -ph, xGapL, g.z0, g.z1, y, th.floor);
        floor(Z, xGapR, ph, g.z0, g.z1, y, th.floor);
        lava(Z, xGapL, xGapR, g.z0, g.z1, y - 5, th.lava);
        // Room walls (wider than the hall) and the connecting walls at both ends
        sideWalls(Z, s, g.z0, g.z1, y - 12, y + 46, ph);
        for (const zz of [g.z0, g.z1]) for (const side of [-1, 1]) studBox(Z, ph - HW, 58, 2, side * (HW + (ph - HW) / 2), y + 17, zz, th.wall);
        // Wins pads: yellow (+N) and purple (+2N) with spinning trophies
        for (const p of s.pads) {
            const c = p.k ? C.purple : C.yellow;
            studBox(Z, PAD.w, 1, PAD.d, p.x, y + 0.5, p.z, c, { extra: { pad: true } });
            glowBox(Z, PAD.w + 0.2, 0.15, PAD.d + 0.2, p.x, y + 0.05, p.z, c, 1.3);
            const cup = trophy(1.4); cup.position.set(p.x, y + 6, p.z); zoneGroup(Z).add(cup);
            tickers.push((dt, t) => { if (zoneGroup(Z).visible) { cup.rotation.y = t * 1.6 + p.k; cup.position.y = y + 6 + Math.sin(t * 2 + p.k) * 0.35; } });
            billboard([{ t: '+' + fmt(p.wins) + ' WIN' + (p.wins > 1 ? 'S' : ''), c: '#ffffff', s: '#1c1530', px: 80 }], 7, 512, new V3(p.x, y + 4.4, p.z), zoneGroup(Z));
            const tr = aabb(p.x, y + 2.5, p.z, PAD.w, 4, PAD.d); tr.zone = Z;
            tr.enter = () => actions.pad(s.i, p.k);
            triggers.push(tr);
        }
        // Treadmills on this platform
        for (const spot of TREAD_SPOTS) if (spot.zone === s.i) treadmill(Z, spot);
        // Big floating "STAGE N" over the platform; landing on it shows the title and sets the revive point
        const nx = STAGES[s.i + 1];
        if (nx) bigText(Z, nx.name.toUpperCase(), 26, new V3(0, y + 30, g.z0 + 6), Math.PI, ['#ffffff', '#e8e0ff']);
        const tr = aabb(0, y + 3, g.z0 + 8, ph * 2, 8, 12); tr.zone = Z;
        tr.enter = () => actions.platform(s.i);
        triggers.push(tr);
        checkpoints[s.i] = new V3(s.spawn.x, s.spawn.y, s.spawn.z);
        if (nx) stageGate(nx, g.z1 - 2, y);
        void rng;
    },
    finale(s, g, Z) {
        const y = g.y0, ph = PLAT_HALF;
        floor(Z, -ph, ph, g.z0, g.z1, y, 0xffd86a);
        sideWalls(Z, s, g.z0, g.z1, y - 12, y + 60, ph);
        studBox(Z, ph * 2 + 4, 72, 2, 0, y + 24, g.z1 + 1, THEMES.gold.wall);
        for (const side of [-1, 1]) studBox(Z, ph - HW, 72, 2, side * (HW + (ph - HW) / 2), y + 24, g.z0, THEMES.gold.wall);
        // Rainbow carpet to the ESCAPE pad, a giant trophy behind it
        const rb = new T.Mesh(new T.PlaneGeometry(12, FINALE.z - g.z0), new T.MeshBasicMaterial({ map: rainbowTexture(), toneMapped: false }));
        rb.rotation.x = -Math.PI / 2; rb.position.set(0, y + 0.05, (g.z0 + FINALE.z) / 2); zoneGroup(Z).add(rb);
        const big = trophy(9); big.position.set(0, y, g.z1 - 14); zoneGroup(Z).add(big);
        tickers.push((dt, t) => { if (zoneGroup(Z).visible) big.rotation.y = Math.sin(t * 0.5) * 0.5; });
        bigText(Z, '👑 YOU ESCAPED! 👑', 44, new V3(0, y + 40, g.z1 - 4), Math.PI, ['#ffffff', '#ffd028'], 'You beat all 9 stages!');
        studBox(Z, 14, 1, 10, FINALE.x, y + 0.5, FINALE.z, 0xffd028);
        glowBox(Z, 13.4, 0.12, 9.4, FINALE.x, y + 1.06, FINALE.z, 0xffe06a, 1.6);
        billboard([{ t: 'ESCAPE!', c: '#ffd028', s: '#1c1530', px: 96 }, { t: '+' + fmt(ESCAPE.wins) + ' Wins', c: '#ffffff', s: '#1c1530', px: 60 }], 11, 512, new V3(FINALE.x, y + 8, FINALE.z), zoneGroup(Z));
        const tr = aabb(FINALE.x, y + 2.5, FINALE.z, 14, 4, 10); tr.zone = Z; tr.enter = () => actions.escape(); triggers.push(tr);
        checkpoints[s.i] = new V3(s.spawn.x, s.spawn.y, s.spawn.z);
    },
};
// Blue rounded tile with a white up arrow (Double Jump walls)
let arrowTex = null;
function arrowIcon() {
    if (arrowTex) return arrowTex;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#2a9aff'; x.beginPath(); x.roundRect(6, 6, 116, 116, 22); x.fill();
    x.fillStyle = '#ffffff'; x.beginPath(); x.moveTo(64, 22); x.lineTo(104, 66); x.lineTo(78, 66); x.lineTo(78, 106); x.lineTo(50, 106); x.lineTo(50, 66); x.lineTo(24, 66); x.closePath(); x.fill();
    arrowTex = texFrom(c);
    return arrowTex;
}

function buildStage(s) {
    const rng = rngFrom(100 + s.i * 37), Z = s.i, th = THEMES[s.theme];
    for (const g of s.segList) {
        SEG[g.k](s, g, Z, rng);
        if (g.k !== 'platform' && g.k !== 'finale') {
            const lo = Math.min(g.y0, g.y1) - 14, hi = Math.max(g.y0, g.y1) + 46;
            sideWalls(Z, s, g.z0, g.z1, lo, hi);
            hallPillars(Z, s, g.z0, g.z1, lo, hi);
            roundBox(Z, 2.8, 1.4, g.z1 - g.z0, -HW - 1, hi + 0.7, (g.z0 + g.z1) / 2, candy(th.trim, { rough: 0.3 }), 0.5);
            roundBox(Z, 2.8, 1.4, g.z1 - g.z0, HW + 1, hi + 0.7, (g.z0 + g.z1) / 2, candy(th.trim, { rough: 0.3 }), 0.5);
        }
    }
    // Night / neon stages: glowing strips along the walls
    if (s.theme === 'night' || s.theme === 'neon') {
        for (const side of [-1, 1]) glowBox(Z, 0.3, 0.4, s.zE - s.zS, side * (HW - 0.2), s.y0 + 14, (s.zS + s.zE) / 2, th.accent, 1.5);
    }
}

// Clouds high over the open-roof hall
function buildClouds() {
    const tex = cloudTexture(), rng = rngFrom(5);
    const m = new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0.9 });
    for (let k = 0; k < 40; k++) {
        const sp = new T.Sprite(m);
        const z = LZ0 - 100 + rng() * (STAGES[STAGES.length - 1].zE - LZ0 + 300);
        sp.position.set((rng() - 0.5) * 600, 150 + rng() * 120, z);
        const s = 70 + rng() * 90; sp.scale.set(s, s / 2, 1);
        scene.add(sp);
    }
}

// =====================================================================================
// Per frame: hazards near the player
// =====================================================================================
export function updateWorld(dt, stage, tOverride) {
    const t = tOverride ?? net.now() / 1000;
    for (const h of hazards) if (h.zone === -1 || Math.abs(h.zone - Math.max(0, stage)) <= 1) h.update(t, dt);
}
export function buildWorld() {
    chevMat = new T.MeshStandardMaterial({ map: chevronTexture(), roughness: 0.4, emissive: 0x400008, emissiveIntensity: 0.4 });
    glassMat = new T.MeshStandardMaterial({ map: glassTexture(), roughness: 0.15, metalness: 0.1, emissive: 0x1a8ae0, emissiveIntensity: 0.55 });
    beltTex = beltTexture();
    scrolling.push({ tex: beltTex, u: 0, v: -1.4 });
    buildLobby();
    STAGES.forEach((s) => buildStage(s));
    buildClouds();
    flushGeo();
    refreshShop();
    drawEventBoard();
    cullZones(-1);
}
// Where a revive (or the QA hook) puts you at the start of stage i: the platform before it
export function stageSpawn(i) {
    if (i <= 0) return { pos: SPAWN.clone(), yaw: 0 };
    const cp = checkpoints[i - 1];
    return { pos: cp ? cp.clone() : SPAWN.clone(), yaw: 0 };
}
