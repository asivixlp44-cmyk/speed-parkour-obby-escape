import { Client } from '@colyseus/sdk';
import {
    T, V3, $, canvas, scene, camera, sun, renderer, solids, kills, triggers, tickers,
    billboard, buildRig, animRig, airPose, poseRig, burst, confettiAt, floatText, updateEffects, lerpAngle, updateSky, FOG,
} from './engine.js';
import { S, actions, net } from './state.js';
import { initAudio, resumeAudio, audioDebug, startMusic, sfx, setVolume, setMusicIntensity, audioSuspended, footstep, setWallrunSound } from './audio.js';
import * as BX from './bloxity.js';
import { createAvatar, loadBase, packAvatar, unpackAvatar, avatarStats } from './avatar.js';
import { updateMaterials } from './textures.js';
import { pad, pollGamepad, rumble, onGamepadConnection } from './gamepad.js';
import { render, setSpeedLines, updateFx, dust, sparkleColumn, ring, fireworks, setQuality, getQuality, autoQualityAllowed, shoeFx, makeTrail, dashBurst, superRing } from './fx.js';
import {
    buildWorld, warmUp, SPAWN, refreshShop, renderBoards, updateLobbySigns, updateWorld, cullZones, checkpoints, stageSpawn, poles, treadOwned,
} from './world.js';
import {
    updateHud, toast, levelUp, showStageTitle, showWin, showOof, animateCounters, openDailyOnJoin, refreshModal,
    closeModal, openModal, buyShoe, buyTread, questDone, modalOpen, showRevive, hideRevive, updateControls, updateStageBar,
} from './ui.js';
import {
    CFG, STAGES, THEMES, LOBBY, trailById, shoeById, KITS, SKINS, FINALE, maxSpeedFor, runSpeed, stageAt, fmt, clamp,
} from '../../shared/config.js';

// =====================================================================================
// Local player
// =====================================================================================
const HW = 1, PH = 5, PH_LOW = 2.4, STEP = 1.7, GRAV = CFG.grav, JUMP_V = CFG.jumpV, PIVOT = 2.6;
const P = {
    pos: SPAWN.clone(), vy: 0, hv: new V3(), boost: new V3(), boostDecay: 4, onGround: false, ground: null, facing: 0,
    dead: false, deadT: 0, stage: -1, moving: false, animPhase: 0, lockToastT: -9, ph: PH,
    coyote: 0, jumpPress: -9, doubleUsed: false, airDashUsed: false, airTime: 0, lastStep: 0, squash: 1, squashV: 0,
    superCd: 0, dashCd: 0, slideCd: 0, dashT: 0, slideT: 0, slideDir: new V3(), crouched: false,
    wall: 0, wallT: 0, wallTotal: 0, wallCd: 0, wallLast: 0, climb: null, climbHit: null, swing: null, poleCd: 0,
    flipT: 0, superT: 0, cp: -1, padLock: false, deathStage: -1, act: 0,
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let shake = 0;
function addShake(a) { if (!reduceMotion) shake = Math.min(1.2, shake + a); }
let rig = null, headLabel, nameLabelText = '';

// ----- a character: rig (feet, yaw) -> pivot (hips: flips, slide lean) -> body (blocky or Bloxity) -----
function buildCharacter(kit, skin) {
    const g = new T.Group();
    const pivot = new T.Group(); pivot.position.y = PIVOT; g.add(pivot);
    const k = KITS[kit % KITS.length];
    const body = buildRig({ ...k, skin: SKINS[skin % SKINS.length] });
    body.position.y = -PIVOT;
    pivot.add(body);
    g.userData = { pivot, body, flip: 0, lean: 0, roll: 0, shoeId: '', trail: null, trailId: '' };
    return g;
}
// Blocky shoes take the colour of the equipped pair
function setShoe(g, id) {
    const u = g.userData;
    if (u.shoeId === (id || '')) return;
    u.shoeId = id || '';
    const d = shoeById[id];
    const shoes = u.body.userData.shoes || [];
    for (const s of shoes) s.material = new T.MeshLambertMaterial({ color: d ? d.color : 0x141418, emissive: d && d.glow ? d.glow : 0x000000, emissiveIntensity: d && d.glow ? 0.35 : 0 });
}
function setTrail(g, id) {
    const u = g.userData;
    const d = trailById[id] || trailById.starter;
    if (!u.trail) u.trail = makeTrail(d.color);
    if (u.trailId !== d.id) {
        u.trailId = d.id;
        u.trail.setColor(d.color, d.rainbow);
        u.trail.width = 0.7 + Math.min(1.1, (d.mult - 1) * 0.15);
    }
}
// Pose a character's pivot for the move it is doing: slide lean, wall-run roll, flips, dash lean.
// pose: '', 'slide', 'wallL', 'wallR', 'climb', 'swing', 'dash', 'flip', 'super'
function poseCharacter(g, pose, dt, extra) {
    const u = g.userData, k = 1 - Math.exp(-dt * 14);
    let lean = 0, roll = 0;
    if (pose === 'slide') lean = -0.85;
    else if (pose === 'dash') lean = 0.45;
    else if (pose === 'wallL') roll = -0.55;
    else if (pose === 'wallR') roll = 0.55;
    u.lean += (lean - u.lean) * k;
    u.roll += (roll - u.roll) * k;
    // A front flip on the double jump, a tucked spin on the Super Jump
    if (pose === 'flip' || pose === 'super') u.flip = Math.min(Math.PI * 2, u.flip + dt * (pose === 'super' ? 13 : 16));
    else u.flip = 0;
    u.pivot.rotation.set(u.lean + (u.flip > 0 && u.flip < Math.PI * 2 ? u.flip : 0), 0, u.roll);
    u.pivot.position.y = pose === 'slide' ? PIVOT - 1.1 : PIVOT;
    void extra;
}

// ----- Bloxity avatars: replace the blocky body's meshes, keep the pivot and labels -----
function dressRig(group, avatar) {
    const body = group.userData.body;
    body.children.forEach((c) => { c.visible = false; });
    body.add(avatar.root);
    group.userData.blox = avatar;
}
let localAvatar = null, localAvatarReq = 0;
async function setupLocalAvatar() {
    const req = ++localAvatarReq;
    const a = await createAvatar(BX.currentAvatar(), BX.getSkinTextureUrl());
    if (!a) return;
    if (req !== localAvatarReq || !rig) { a.dispose(); return; }
    if (localAvatar) localAvatar.dispose();
    localAvatar = a;
    dressRig(rig, a);
}
function syncMyAvatar() {
    const av = BX.currentAvatar();
    if (localAvatar && av) { localAvatar.setProportions(av.proportions); localAvatar.setEquipped(av, BX.getSkinTextureUrl()); }
    net.send('avatar', { av: packAvatar(av) });
}
async function playEmoteOn(avatar, id) {
    if (!avatar) return;
    const cat = await BX.loadEmotes();
    const e = cat.get(id);
    if (e && e.clip) avatar.playEmote(e.clip);
}
function chatBubble(group, text) {
    if (!group) return;
    if (group.userData.bubble) { group.remove(group.userData.bubble); group.userData.bubble.material.map.dispose(); }
    const b = billboard([{ t: '💬 ' + text, c: '#ffffff', s: '#1c1030', px: 44 }], 9, 1024, new V3(0, 9.4, 0), group);
    group.userData.bubble = b;
    setTimeout(() => { if (group.userData.bubble === b) { group.remove(b); b.material.map.dispose(); group.userData.bubble = null; } }, 5000);
}
function buildPlayer(kit, skin) {
    if (rig) { scene.remove(rig); if (rig.userData.trail) rig.userData.trail.dispose(); }
    rig = buildCharacter(kit, skin);
    scene.add(rig);
    nameLabelText = '';
    headLabel = billboard([{ t: S.name || ' ', c: '#ffffff', s: '#1c1030', px: 60 }], 6.5, 512, new V3(0, 7.6, 0), rig);
    // Like Roblox: you don't see your own name over your head (it is still there for chat bubbles)
    headLabel.visible = false;
    rig.position.copy(P.pos);
    localAvatar = null;
    setupLocalAvatar();
}

// ----- collision against the solids near the player -----
let near = solids, nearKills = kills, nearTriggers = triggers, nearPoles = poles, nearZoneKey = '';
function refreshNear(stage) {
    const zs = new Set([stage - 1, stage, stage + 1]);
    if (stage <= 0) zs.add(-1);
    const key = [...zs].join(',');
    if (key === nearZoneKey) return;
    nearZoneKey = key;
    const ok = (o) => o.zone === undefined || zs.has(o.zone);
    near = solids.filter(ok); nearKills = kills.filter(ok); nearTriggers = triggers.filter(ok); nearPoles = poles.filter(ok);
    cullZones(stage);
}
const overlapsH = (c, x, y, z, h) => !c.off && c.max.x > x - HW && c.min.x < x + HW && c.max.y > y && c.min.y < y + h && c.max.z > z - HW && c.min.z < z + HW;
const overlaps = (c, x, y, z) => overlapsH(c, x, y, z, P.ph);
function freeAt(x, y, z, h) {
    for (const c of near) if (overlapsH(c, x, y, z, h || P.ph)) return false;
    return true;
}
function moveAxis(axis, d) {
    if (d === 0) return;
    const p = P.pos;
    p[axis] += d;
    for (const c of near) {
        if (!overlaps(c, p.x, p.y, p.z)) continue;
        if (axis === 'y') {
            if (d < 0) { p.y = c.max.y; P.vy = Math.max(0, P.vy); P.onGround = true; P.ground = c; }
            else { p.y = c.min.y - P.ph - 1e-4; if (P.vy > 0) P.vy = 0; }
        } else {
            const rise = c.max.y - p.y;
            if (rise > 0 && rise <= STEP && (P.onGround || P.vy <= 0) && freeAt(p.x, c.max.y + 0.01, p.z)) { p.y = c.max.y + 0.001; continue; }
            // Walking into the red climbing wall (from the front) starts a climb
            if (axis === 'z' && d > 0 && c.climb && p.x > c.min.x + 0.4 && p.x < c.max.x - 0.4) P.climbHit = c;
            if (d > 0) p[axis] = c.min[axis] - HW - 1e-4; else p[axis] = c.max[axis] + HW + 1e-4;
            if (axis === 'x') { P.hv.x = 0; P.boost.x = 0; } else { P.hv.z = 0; P.boost.z = 0; }
        }
    }
}
// Wall-run glass next to the player: { side: +1 (wall on +x) / -1, x: where to stand } or null.
// Generous: within 2.2 studs of the glass counts, and you're pulled onto it.
function wallBeside() {
    const p = P.pos;
    for (const c of near) {
        if (!c.wallrun || c.off) continue;
        if (p.z < c.min.z - 0.5 || p.z > c.max.z + 0.5 || c.max.y < p.y + 1 || c.min.y > p.y + P.ph - 1) continue;
        if (c.wallrun > 0 && c.min.x - (p.x + HW) < 2.2 && c.min.x - (p.x + HW) > -0.3) return { side: 1, x: c.min.x - HW - 0.02 };
        if (c.wallrun < 0 && (p.x - HW) - c.max.x < 2.2 && (p.x - HW) - c.max.x > -0.3) return { side: -1, x: c.max.x + HW + 0.02 };
    }
    return null;
}
// In the air over a wall-run pit, drift toward the nearer glass (so a jump from the middle still catches it)
function wallMagnet(dt) {
    const p = P.pos;
    for (const c of near) {
        if (!c.wallrun || c.off || p.z < c.min.z || p.z > c.max.z || c.min.y > p.y + 3) continue;
        const toward = c.wallrun > 0 ? c.min.x - HW - p.x : c.max.x + HW - p.x;
        if (Math.abs(toward) < 7 && Math.sign(toward) === c.wallrun) { P.hv.x += Math.sign(toward) * 26 * dt; return; }
    }
}
function speedNumber() {
    const max = maxSpeedFor(S.level, S.rebirths);
    return qaWalk || (S.customSpeed > 0 && S.customSpeed <= max ? S.customSpeed : max);
}
const rs = () => runSpeed(speedNumber());

function teleport(pos, yaw) {
    P.pos.copy(pos); P.vy = 0; P.hv.set(0, 0, 0); P.boost.set(0, 0, 0);
    P.facing = yaw || 0; cam.yaw = (yaw || 0) + Math.PI;
    P.climb = null; P.swing = null; P.wall = 0; P.slideT = 0; P.dashT = 0; P.ph = PH; P.crouched = false;
    P.stage = stageAt(pos.x, pos.y, pos.z);
    refreshNear(P.stage);
    for (const t of nearTriggers) t.inside = overlapsBox(t, pos);
    sendMove(true);
}
const overlapsBox = (t, p) => t.max.x > p.x - HW && t.min.x < p.x + HW && t.max.y > p.y && t.min.y < p.y + P.ph && t.max.z > p.z - HW && t.min.z < p.z + HW;
function teleportLobby() { P.cp = -1; P.padLock = false; teleport(SPAWN, 0); }

// =====================================================================================
// Dying, reviving, pads, the escape
// =====================================================================================
let deaths = 0;
// Roblox-style: the body falls apart into its blocks
function breakApart(pos) {
    const cols = [0xf2c9a0, 0x14141e, 0x2a3a5a, 0xb8541c];
    for (let i = 0; i < 6; i++) burst(pos.clone().add(new V3((Math.random() - 0.5) * 2, 1 + i * 0.7, (Math.random() - 0.5) * 2)), cols[i % cols.length], 1.6, 1);
}
function die(cause) {
    if (P.dead) return;
    P.dead = true; P.deadT = CFG.respawnDelay; deaths++; P.cause = cause;
    P.deathStage = Math.max(-1, P.stage);
    breakApart(P.pos);
    burst(P.pos.clone().add(new V3(0, 2.5, 0)), 0xffffff, 0.5, 18);
    sfx('death'); addShake(0.8); rumble(1, 350); showOof(cause);
    if (cause === 'laser') sfx('zap'); else if (cause === 'crusher') sfx('crush'); else if (cause === 'lava') sfx('sizzle');
    P.climb = null; P.swing = null; P.wall = 0;
    sendMove(true);
    net.send('died', { s: P.deathStage, c: cause || 'fall' });
    // Revive back at the start of this stage (the platform before it)
    if (P.cp >= 0 && P.deathStage > 0) showRevive(P.deathStage, CFG.reviveSecs);
    // Too slow for this stage? Say so
    const st = STAGES[P.deathStage];
    if (st && speedNumber() < st.need) setTimeout(() => toast('⚡ ' + st.name + ' needs ' + st.need + ' Speed (you: ' + speedNumber() + '). Train on a treadmill!', '#ffd028'), 900);
}
function respawn() {
    P.dead = false;
    teleportLobby();
    sfx('teleport');
}
actions.revived = (stage) => {
    hideRevive();
    const sp = stageSpawn(stage);
    P.dead = false;
    P.cp = stage - 1;
    P.padLock = false;
    teleport(sp.pos, sp.yaw);
    showStageTitle(STAGES[stage]);
    sfx('teleport'); sparkleColumn(P.pos, 0x7dff6b);
};
// Landing on a stage platform: the revive point, and the big "STAGE N" title (reference)
actions.platform = (i) => {
    if (P.dead || i <= P.cp) return;
    P.cp = i;
    const nx = STAGES[i + 1];
    if (nx) { showStageTitle(nx); sfx('gate'); }
};
// Wins pad: tell the server (it checks where you are), then home you go
actions.pad = (s, k) => {
    if (P.dead || P.padLock) return;
    P.padLock = true;
    sendMove(true);
    net.send('pad', { s, k });
    setTimeout(() => { teleportLobby(); }, 1700);
};
actions.escape = () => {
    if (P.dead || P.padLock) return;
    P.padLock = true;
    sendMove(true);
    net.send('escape');
    setTimeout(() => { teleportLobby(); }, 2600);
};
// ----- lobby things -----
actions.shoe = (d) => buyShoe(d);
actions.treadBuy = (d) => {
    if (P.lockToastT + 2 > clockT) return;
    P.lockToastT = clockT;
    toast('Locked! Buy it to unlock this treadmill.', '#ff5a5a');
    if (d.reb) toast('Needs ' + d.reb + ' Rebirth' + (d.reb > 1 ? 's' : '') + '!', '#ffffff');
    else buyTread(d);
};
actions.chest = () => net.send('chest');
actions.portal = () => toast(S.wins >= 2500 ? '🌀 World 2 opens in the next update!' : '🌀 World 2 needs 🏆 2,500 Wins!', '#ff8ad8');
actions.invite = () => openModal('friends');

// =====================================================================================
// Friend Boost
// =====================================================================================
let friendNames = [], friendsT = 3, friendSyncT = 5;
async function refreshFriends() {
    if (!BX.bloxity.ready || !BX.identity().loggedIn) return;
    const list = await BX.getFriends();
    friendNames = list.map((f) => f.displayName || f.username).filter(Boolean);
    syncFriends();
}
function syncFriends() {
    const room = net.room;
    if (!room || !room.state || !room.state.players || !friendNames.length) return;
    const here = [];
    room.state.players.forEach((p, id) => { if (id !== room.sessionId && friendNames.includes(p.name)) here.push(p.name); });
    net.send('friends', { names: here });
}

// =====================================================================================
// Other players. anim: 0 idle, 1 run, 2 air, 3 dead, 4 slide, 5 wall-run left, 6 wall-run right,
// 7 climb, 8 swing, 9 dash, 10 double jump flip, 11 super jump
// =====================================================================================
const ANIM_POSE = { 4: 'slide', 5: 'wallL', 6: 'wallR', 7: 'climb', 8: 'swing', 9: 'dash', 10: 'flip', 11: 'super' };
const remotes = new Map();
let joinSynced = false;
class Remote {
    constructor(p) {
        this.rig = buildCharacter(p.kit, p.skin);
        this.rig.position.set(p.x, p.y, p.z);
        this.rig.rotation.y = p.ry;
        scene.add(this.rig);
        this.label = billboard([{ t: p.name, c: '#ffffff', s: '#1c1030', px: 56 }], 6, 512, new V3(0, 7.6, 0), this.rig);
        this.labelText = p.name;
        this.av = null; this.blox = null; this.dead = false; this.phase = 0; this.vel = 0;
        this.lastX = p.x; this.lastZ = p.z;
        this.setAvatar(p.av);
    }
    setAvatar(av) {
        this.av = av;
        const data = av ? unpackAvatar(av) : null;
        if (this.blox) { this.blox.setProportions(data && data.proportions); this.blox.setEquipped(data || {}); return; }
        if (this.loading) return;
        this.loading = true;
        createAvatar(data).then((a) => {
            this.loading = false;
            if (!a) return;
            if (this.dead) { a.dispose(); return; }
            this.blox = a;
            dressRig(this.rig, a);
            if (this.av !== av) this.setAvatar(this.av);
        });
    }
    update(p, dt, t) {
        const r = this.rig, u = r.userData;
        const k = 1 - Math.exp(-dt * 12);
        if ((r.position.x - p.x) ** 2 + (r.position.z - p.z) ** 2 + (r.position.y - p.y) ** 2 > 900) r.position.set(p.x, p.y, p.z);
        else { r.position.x += (p.x - r.position.x) * k; r.position.y += (p.y - r.position.y) * k; r.position.z += (p.z - r.position.z) * k; }
        r.rotation.y = lerpAngle(r.rotation.y, p.ry, k);
        r.visible = p.anim !== 3;
        if (p.av !== this.av) this.setAvatar(p.av);
        const pose = ANIM_POSE[p.anim] || '';
        const air = p.anim === 2 || pose === 'flip' || pose === 'super';
        poseCharacter(r, pose, dt);
        const moved = Math.hypot(r.position.x - this.lastX, r.position.z - this.lastZ);
        this.vel += ((dt > 0 ? moved / dt : 0) - this.vel) * Math.min(1, dt * 6);
        this.lastX = r.position.x; this.lastZ = r.position.z;
        const moving = (p.anim === 1 || pose === 'wallL' || pose === 'wallR') && this.vel > 1;
        this.phase += dt * (moving ? Math.min(18, 4 + this.vel * 0.25) : pose === 'climb' ? 9 : 0);
        const bp = pose === 'wallL' || pose === 'wallR' ? 'wallrun' : pose;
        if (bp && bp !== 'super') poseRig(u.body, bp, this.phase);
        else if (air) airPose(u.body, pose === 'super' ? 1 : 0);
        else if (moving) animRig(u.body, this.phase, 0.85); else animRig(u.body, 0, 0);
        if (this.blox) this.blox.update(dt, { moving, air, speed: this.vel, t, pose: bp === 'super' ? 'flip' : bp });
        setShoe(r, p.shoe); setTrail(r, p.trail);
        u.trail.update(trailAt(r), (moving || air) && r.visible, dt, t);
        if (p.name !== this.labelText) { this.labelText = p.name; this.label.userData.set([{ t: p.name, c: '#ffffff', s: '#1c1030', px: 56 }]); }
        // Name tags fade out when the player is right next to the camera (else they fill the screen)
        const cd = camera.position.distanceTo(r.position);
        this.label.material.opacity = Math.min(1, Math.max(0, (cd - 7) / 6));
        this.label.visible = r.visible && cd > 7 && cd < 160;
    }
    dispose() {
        this.dead = true;
        if (this.blox) this.blox.dispose();
        if (this.rig.userData.trail) this.rig.userData.trail.dispose();
        scene.remove(this.rig);
    }
}
const trailTmp = new V3();
function trailAt(r) { return trailTmp.set(r.position.x - Math.sin(r.rotation.y) * 0.9, r.position.y + 2.6, r.position.z - Math.cos(r.rotation.y) * 0.9); }

// "+N" with a shoe pops up beside the player every time Speed goes up, like the reference
let speedSeen = false, popT = 0, popAcc = 0;
function popGain(n) {
    popAcc += n;
    if (clockT - popT < 0.4 && n < 1000) return;
    popT = clockT;
    const side = new V3(-Math.cos(P.facing) * 3.4, 4.6 + Math.random() * 1.6, Math.sin(P.facing) * 3.4);
    floatText('👟+' + fmt(popAcc), '#ffffff', P.pos.clone().add(side), 4);
    popAcc = 0;
    sfx('gain');
}
function syncRemotes(dt, t) {
    const room = net.room;
    if (!room || !room.state || !room.state.players) return [];
    const seen = new Set(), list = [];
    room.state.players.forEach((p, id) => {
        if (id === room.sessionId) {
            if (speedSeen && p.speed > S.speed) popGain(p.speed - S.speed);
            speedSeen = true;
            const oldLevel = S.level;
            S.name = p.name; S.speed = p.speed; S.wins = p.wins; S.level = p.level; S.xp = p.xp; S.rebirths = p.rebirths; S.friends = p.friends;
            if (!rig || rig.userData.kit !== p.kit) { buildPlayer(p.kit, p.skin); rig.userData.kit = p.kit; }
            if (oldLevel !== S.level) refreshModal();
            list.push({ me: true, name: p.name, kit: p.kit, x: P.pos.x, y: P.pos.y, z: P.pos.z });
            return;
        }
        seen.add(id);
        let r = remotes.get(id);
        if (!r) {
            r = new Remote(p); remotes.set(id, r);
            if (joinSynced) BX.playerJoined(p.name); else BX.playerInRoom(p.name);
        }
        r.update(p, dt, t);
        list.push({ me: false, name: p.name, kit: p.kit, x: p.x, y: p.y, z: p.z });
    });
    for (const [id, r] of remotes) if (!seen.has(id)) { r.dispose(); remotes.delete(id); }
    joinSynced = true;
    return list;
}

// =====================================================================================
// Networking
// =====================================================================================
const BLOXITY_GAME_ID = import.meta.env.VITE_BLOXITY_GAME_ID || '';
const ON_BLOXITY_HOST = /\.play\.bloxity\.io$/.test(location.hostname);
const DEV_CHANNEL = /\.dev\.play\.bloxity\.io$/.test(location.hostname);
const SERVER_URL = import.meta.env.VITE_SERVER_URL
    || (ON_BLOXITY_HOST ? `https://${location.hostname.replace(/\.play\.bloxity\.io$/, '.host.bloxity.io')}`
        : BLOXITY_GAME_ID ? `https://${BLOXITY_GAME_ID}.host.bloxity.io`
        : import.meta.env.DEV ? `${location.protocol}//${location.hostname}:2599` : location.origin);
async function serverEndpoint() {
    let url = SERVER_URL;
    if (BLOXITY_GAME_ID) {
        const r = await BX.resolveEndpoint(BLOXITY_GAME_ID, DEV_CHANNEL ? 'preview' : undefined);
        if (r && r.cold) $('#loading').textContent = 'Waking up a server…';
        url = (r && r.endpoint) || SERVER_URL;
    }
    if (!/^https?:/i.test(url)) return url;
    if (!(await serverUp(url))) {
        $('#loading').textContent = 'Waking up a server…';
        const until = Date.now() + 60000;
        while (Date.now() < until) {
            await new Promise((res) => setTimeout(res, 2000));
            if (await serverUp(url)) break;
        }
    }
    return url;
}
async function serverUp(url) {
    try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 4000);
        const r = await fetch(url.replace(/\/$/, '') + '/health', { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(t);
        return r.ok;
    } catch (e) { return false; }
}
let lastMoveSent = 0, lastMoveKey = '';
function animCode() {
    if (P.dead) return 3;
    if (P.swing) return 8;
    if (P.climb) return 7;
    if (P.wall) return P.wall > 0 ? 6 : 5;
    if (P.slideT > 0 || P.crouched) return 4;
    if (P.dashT > 0) return 9;
    if (!P.onGround) return P.superT > 0 ? 11 : P.flipT > 0 ? 10 : 2;
    return P.moving ? 1 : 0;
}
function sendMove(force) {
    const now = performance.now();
    if (!force && now - lastMoveSent < 66) return;
    const a = animCode();
    const m = { x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2), ry: +P.facing.toFixed(3), a, mv: P.moving && !P.dead ? 1 : 0 };
    const key = m.x + ',' + m.y + ',' + m.z + ',' + m.ry + ',' + a + ',' + m.mv;
    if (!force && key === lastMoveKey && now - lastMoveSent < 500) return;
    lastMoveKey = key; lastMoveSent = now;
    net.send('move', m);
}

function storageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
function playerUid() {
    let uid = storageGet('spo_uid');
    if (!uid) {
        uid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
        storageSet('spo_uid', uid);
    }
    return uid;
}

async function connect(name) {
    const client = new Client(await serverEndpoint());
    const id = BX.identity();
    const room = await client.joinOrCreate('parkour', {
        uid: playerUid(), name: name || id.name, token: id.token, av: packAvatar(BX.currentAvatar()),
        save: storageGet('spo_save') || '',
    });
    net.room = room;
    joinSynced = false;
    room.onMessage('hello', (m) => { net.offset = m.now - Date.now(); net.bloxity = !!m.bloxity; });
    room.onMessage('authed', () => { net.bloxity = true; });
    room.onMessage('emote', (m) => { const r = remotes.get(m.s); if (r) playEmoteOn(r.blox, m.id); });
    room.onMessage('chat', (m) => {
        toast(m.name + ': ' + m.text, '#ffffff');
        chatBubble(m.s === room.sessionId ? rig : remotes.get(m.s) && remotes.get(m.s).rig, m.text);
    });
    BX.updateRoom(room.roomId);
    BX.gameplayStart();
    room.onMessage('profile', (m) => {
        if (m.save) storageSet('spo_save', m.save);
        delete m.save;
        Object.assign(S, m);
        refreshShop(); refreshModal();
        openDailyOnJoin();
    });
    room.onMessage('toast', (m) => toast(m.text, m.color));
    room.onMessage('levelUp', (m) => {
        levelUp(m);
        sfx('levelUp'); rumble(0.3, 150);
        ring(P.pos, 0x5ae0ff, 10, 0.8);
        sparkleColumn(P.pos, 0x7dff6b);
    });
    room.onMessage('gain', (m) => { if (m.pack) { floatText('+' + fmt(m.n) + ' Speed', '#7dff6b', P.pos.clone().add(new V3(0, 6, 0))); sfx('buy'); } });
    room.onMessage('wins', (m) => {
        refreshShop();
        showWin(m.n, m.escape);
        sfx('cheer'); rumble(0.7, 500);
        confettiAt(P.pos.clone().add(new V3(0, 4, 0)));
        fireworks(P.pos, m.escape ? 14 : 5, () => sfx('firework'));
    });
    room.onMessage('revived', (m) => actions.revived(m.s | 0));
    room.onMessage('reached', (m) => {
        const s = STAGES[m.s];
        if (s) toast('🔓 ' + s.name + ' reached!', '#ffd028');
    });
    room.onMessage('quest', (m) => questDone(m));
    room.onMessage('announce', (m) => toast(m.text, m.color));
    room.onMessage('event', (m) => {
        if (m.on) { toast('🔥 ADMIN ABUSE! x2 Speed & x2 Wins for 5 minutes!', '#ffd028'); sfx('gate'); fireworks(P.pos, 5, () => sfx('firework')); }
        else toast('Admin Abuse is over. Next one in 25 minutes!', '#ffffff');
    });
    room.onMessage('fx', (m) => {
        confettiAt(P.pos.clone().add(new V3(0, 4, 0)));
        sparkleColumn(P.pos, m.kind === 'rebirth' ? 0x5ae0ff : 0xffd028);
        sfx('buy');
        if (m.kind === 'rebirth') { fireworks(P.pos, 8, () => sfx('firework')); ring(P.pos, 0xff8ad8, 14, 1); }
    });
    room.onMessage('boards', renderBoards);
    room.onLeave((code, reason) => {
        console.warn('[net] left room', code, reason || '');
        net.room = null;
        if (code !== 1000) $('#offline').hidden = false;
    });
    return room;
}

// =====================================================================================
// Camera & input
// =====================================================================================
const cam = { yaw: Math.PI, pitch: 0.32, dist: 22, target: new V3() };
let camSens = 1;
const keys = {};
const touchMove = { x: 0, y: 0 };
let running = false;
const press = { jump: -9, super: -9, dash: -9, slide: -9 };
function pressMove(kind) { press[kind] = clockT; if (kind === 'jump') P.jumpPress = clockT; }
actions.press = pressMove;

addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) { if (e.key === 'Enter') e.target.blur(); return; }
    keys[e.code] = true;
    if (running && !e.repeat) {
        if (e.code === 'Space') pressMove('jump');
        else if (e.code === 'KeyF') pressMove('super');
        else if (e.code === 'KeyE') pressMove('dash');
        else if (e.code === 'KeyC' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') pressMove('slide');
    }
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.code === 'Escape') {
        for (const id of ['#confirm', '#daily']) if (!$(id).hidden) { $(id).hidden = true; return; }
        if (modalOpen()) closeModal();
        else if (running && BX.isEmbedded()) BX.showPortalMenu();
    }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const drags = new Map();
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); drags.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.focus(); });
canvas.addEventListener('pointermove', (e) => {
    const d = drags.get(e.pointerId);
    if (!d) return;
    const k = (e.pointerType === 'touch' ? 0.008 : 0.005) * camSens;
    cam.yaw -= (e.clientX - d.x) * k;
    cam.pitch = clamp(cam.pitch + (e.clientY - d.y) * k, -0.6, 1.35);
    d.x = e.clientX; d.y = e.clientY;
});
const endDrag = (e) => drags.delete(e.pointerId);
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => { cam.dist = clamp(cam.dist + Math.sign(e.deltaY) * 2.5, 8, 60); e.preventDefault(); }, { passive: false });

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');
let touchJump = false;
(function joystick() {
    const stick = $('#stick'), knob = $('#knob');
    let id = null;
    const set = (e) => {
        const r = stick.getBoundingClientRect();
        let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        const max = r.width / 2, l = Math.hypot(dx, dy);
        if (l > max) { dx *= max / l; dy *= max / l; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        touchMove.x = dx / max; touchMove.y = dy / max;
    };
    stick.addEventListener('pointerdown', (e) => { id = e.pointerId; stick.setPointerCapture(id); set(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
    const end = (e) => { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; touchMove.x = touchMove.y = 0; };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
    const jb = $('#jumpBtn');
    jb.addEventListener('pointerdown', (e) => { e.preventDefault(); touchJump = true; pressMove('jump'); });
    jb.addEventListener('pointerup', () => { touchJump = false; });
    jb.addEventListener('pointercancel', () => { touchJump = false; });
})();

function rayHit(o, d, maxT) {
    let best = maxT;
    for (const c of near) {
        if (c.off || c.mover) continue;
        let t0 = 0, t1 = best, hit = true;
        for (const a of ['x', 'y', 'z']) {
            if (Math.abs(d[a]) < 1e-9) { if (o[a] < c.min[a] || o[a] > c.max[a]) { hit = false; break; } continue; }
            let ta = (c.min[a] - o[a]) / d[a], tb = (c.max[a] - o[a]) / d[a];
            if (ta > tb) { const q = ta; ta = tb; tb = q; }
            t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
            if (t0 > t1) { hit = false; break; }
        }
        if (hit && t0 > 0 && t0 < best) best = t0;
    }
    return best;
}
const camDir = new V3(), camGoal = new V3(), camPos = new V3();
let baseFov = camera.fov, fovKick = 0;
const skyTint = new T.Color(FOG);
function updateCamera(dt) {
    const t = performance.now() / 1000;
    if (!running) {
        camera.position.set(Math.sin(t * 0.08) * 40, 26, -40 + Math.cos(t * 0.08) * 30);
        camera.lookAt(0, 12, 20);
        baseFov = camera.fov;
        updateSky(camera.position, t, skyTint.set(FOG), dt, 0);
        return;
    }
    cam.target.lerp(camGoal.set(P.pos.x, P.pos.y + 4.5, P.pos.z), 1 - Math.exp(-dt * 16));
    const cp = Math.cos(cam.pitch);
    camDir.set(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp);
    const dist = Math.max(3, rayHit(cam.target, camDir, cam.dist) - 0.8);
    camPos.copy(cam.target).addScaledVector(camDir, dist);
    camera.position.copy(camPos);
    camera.lookAt(cam.target);
    if (shake > 0.001) {
        const s = shake * shake * 0.9;
        camera.position.x += (Math.random() * 2 - 1) * s;
        camera.position.y += (Math.random() * 2 - 1) * s;
        shake = Math.max(0, shake - dt * 2.2);
    }
    // Wider view the faster you go, a kick on Dash and Super Jump
    const fovBase = innerWidth < innerHeight ? 85 : 70;
    const sp = P.moving ? Math.hypot(P.hv.x + P.boost.x, P.hv.z + P.boost.z) : 0;
    fovKick = Math.max(0, fovKick - dt * 22);
    const want = fovBase + Math.min(10, Math.max(0, sp - 22) * 0.18) + fovKick;
    baseFov += (want - baseFov) * Math.min(1, dt * 6);
    if (Math.abs(camera.fov - baseFov) > 0.01) { camera.fov = baseFov; camera.updateProjectionMatrix(); }
    sun.position.set(P.pos.x + 40, P.pos.y + 90, P.pos.z - 60);
    sun.target.position.copy(P.pos);
    const s = STAGES[P.stage], th = s ? THEMES[s.theme] : null;
    skyTint.set(th ? th.sky : FOG);
    updateSky(camera.position, t, skyTint, dt, s && (s.theme === 'night' || s.theme === 'neon') ? 1 : 0);
}

// Controller buttons: popups and panels first, then gameplay
const shownEl = (sel) => { const e = $(sel); return !!e && !e.hidden; };
function focusStep(container, dir) {
    const items = [...container.querySelectorAll('button:not(:disabled), input[type=range]')];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    const next = items[i < 0 ? 0 : (i + dir + items.length) % items.length];
    next.focus({ preventScroll: false });
    next.scrollIntoView({ block: 'nearest' });
}
let padWas = {};
function padButtons() {
    const edge = (k, v) => { const r = v && !padWas[k]; padWas[k] = v; return r; };
    if (running) {
        if (edge('jump', pad.jump)) pressMove('jump');
    }
    const p = pad.pressed;
    if (!p.size) return;
    const overlay = ['#start', '#offline', '#confirm', '#daily', '#modal'].find(shownEl);
    if (overlay === '#start') { if ((p.has('A') || p.has('START')) && shownEl('#playBtn')) play(); return; }
    if (overlay === '#offline') { if (p.has('A')) $('#reconnectBtn').click(); return; }
    if (overlay === '#confirm') { if (p.has('A')) $('#confirmYes').click(); else if (p.has('B')) $('#confirmNo').click(); return; }
    if (overlay === '#daily') { if (p.has('A') && !$('#dailyClaim').disabled) $('#dailyClaim').click(); else if (p.has('A') || p.has('B')) $('#dailyClose').click(); return; }
    if (overlay === '#modal') {
        const body = $(overlay);
        const el = document.activeElement;
        if (p.has('DOWN') || p.has('RIGHT')) focusStep(body, 1);
        else if (p.has('UP') || p.has('LEFT')) focusStep(body, -1);
        else if (p.has('A') && el && body.contains(el) && el.tagName === 'BUTTON') el.click();
        else if (p.has('B') || p.has('BACK') || p.has('START')) { closeModal(); canvas.focus(); }
        return;
    }
    if (!running) return;
    // Y Super Jump, X Slide, RB Dash (the reference's controller hints), B revive
    if (p.has('Y')) pressMove('super');
    if (p.has('X')) pressMove('slide');
    if (p.has('RB') || p.has('LB')) pressMove('dash');
    if (p.has('B') && shownEl('#revive')) $('#revive').click();
    if (p.has('BACK')) openModal('rebirth');
    if (p.has('START')) openModal('settings');
    if (p.has('UP')) cam.dist = clamp(cam.dist - 4, 8, 60);
    if (p.has('DOWN')) cam.dist = clamp(cam.dist + 4, 8, 60);
}
onGamepadConnection((g, on) => { if (running) toast(on ? '🎮 Controller connected' : '🎮 Controller disconnected', on ? '#7dff6b' : '#ffb51c'); });

// =====================================================================================
// Movement and the parkour moves
// =====================================================================================
const botInput = { f: 0, r: 0, jump: false };
let qaWalk = 0, qaClock = null;
let clockT = 0, hudT = 0, footT = 0, stepClock = 0;
const tmpF = new V3(), tmpR = new V3(), mv = new V3(), fwd = new V3();
const pressed = (kind, win) => clockT - press[kind] < (win || 0.18);
const consume = (kind) => { press[kind] = -9; if (kind === 'jump') P.jumpPress = -9; };
function facingDir(out) { return out.set(Math.sin(P.facing), 0, Math.cos(P.facing)); }

function doJump(v) {
    P.vy = v; P.onGround = false; P.ground = null; P.coyote = 0;
    consume('jump');
}
// Space: jump on the ground (or just after leaving it), a front-flipping Double Jump in the air
function jumpLogic() {
    if (P.onGround) { P.coyote = 0.1; P.doubleUsed = false; P.airDashUsed = false; P.wallTotal = 0; }
    if (!pressed('jump')) return;
    if (P.onGround || P.coyote > 0) {
        if (P.slideT > 0 || P.crouched) { if (!freeAt(P.pos.x, P.pos.y, P.pos.z, PH)) return; P.slideT = 0; P.crouched = false; P.ph = PH; }
        doJump(JUMP_V);
        sfx('jump'); P.squashV += 5; dust(P.pos, 5, 0.7);
        return;
    }
    if (P.doubleUsed) return;
    P.doubleUsed = true; P.flipT = 0.45; P.superT = 0; P.act++;
    doJump(JUMP_V);
    sfx('double'); ring(P.pos.clone().setY(P.pos.y + 0.5), 0xffffff, 3.5, 0.35);
    if (rig) rig.userData.flip = 0.01;
}
// F: Super Jump from the ground
function superLogic() {
    if (!pressed('super') || P.superCd > 0) return;
    if (!(P.onGround || P.coyote > 0)) { if (pressed('super', 0.05)) toast('Super Jump works from the ground!', '#ffffff'); consume('super'); return; }
    consume('super');
    P.superCd = CFG.superCd; P.superT = 0.7; P.act++;
    if (P.slideT > 0 || P.crouched) { P.slideT = 0; P.crouched = false; P.ph = PH; }
    doJump(CFG.superV);
    const f = facingDir(fwd);
    if (mv.lengthSq() > 0.01) f.copy(mv).normalize();
    P.boost.addScaledVector(f, CFG.superBoost * rs()); P.boostDecay = 0.7;
    sfx('superJump'); superRing(P.pos); addShake(0.25); fovKick = 6; rumble(0.5, 160);
    if (rig) rig.userData.flip = 0.01;
}
// E: Dash, on the ground or once per jump in the air
function dashLogic() {
    if (!pressed('dash') || P.dashCd > 0 || P.climb || P.swing) return;
    if (!P.onGround && P.airDashUsed) return;
    consume('dash');
    if (!P.onGround) P.airDashUsed = true;
    P.dashCd = CFG.dashCd; P.dashT = CFG.dashTime; P.act++;
    const d = mv.lengthSq() > 0.01 ? mv.clone().normalize() : facingDir(new V3());
    P.boost.copy(d).multiplyScalar(Math.max(26, CFG.dashMult * rs())); P.boostDecay = 5;
    P.facing = Math.atan2(d.x, d.z);
    if (P.vy < 0) P.vy = 0;
    if (P.wall) { P.wall = 0; P.wallCd = 0.3; }
    sfx('dash'); dashBurst(P.pos, d); fovKick = 9; addShake(0.15);
}
// C / Shift: Slide along the ground, low enough to pass under the Slide Under walls
function slideLogic() {
    if (!pressed('slide') || P.slideCd > 0 || !P.onGround || P.slideT > 0) return;
    consume('slide');
    P.slideCd = CFG.slideCd; P.slideT = CFG.slideTime; P.act++;
    const d = mv.lengthSq() > 0.01 ? mv.clone().normalize() : facingDir(new V3());
    P.slideDir.copy(d);
    P.boost.copy(d).multiplyScalar(0.45 * rs()); P.boostDecay = 2.5;
    P.ph = PH_LOW;
    sfx('slide'); dust(P.pos, 8, 1);
}

function update(dt) {
    clockT += dt;
    const t = clockT;
    let f = botInput.f, r = botInput.r;
    if (keys.KeyW || keys.ArrowUp) f += 1;
    if (keys.KeyS || keys.ArrowDown) f -= 1;
    if (keys.KeyD || keys.ArrowRight) r += 1;
    if (keys.KeyA || keys.ArrowLeft) r -= 1;
    f -= touchMove.y + pad.ly; r += touchMove.x + pad.lx;
    cam.yaw -= pad.rx * 2.8 * dt;
    cam.pitch = clamp(cam.pitch + pad.ry * 1.8 * dt, -0.6, 1.35);
    tmpF.set(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
    tmpR.set(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
    mv.set(0, 0, 0).addScaledVector(tmpF, f).addScaledVector(tmpR, r);
    if (mv.lengthSq() > 1) mv.normalize();
    if (P.dead) mv.set(0, 0, 0);
    const tread = P.onGround && P.ground && P.ground.tread;
    const treadRun = tread && treadOwned(tread) && mv.lengthSq() < 0.01 && !P.dead;
    P.moving = mv.lengthSq() > 0.01 || !!treadRun || !!P.wall || !!P.climb;

    if (qaClock !== null) qaClock += dt;
    updateWorld(dt, P.stage, qaClock ?? undefined);

    for (const k of ['superCd', 'dashCd', 'slideCd', 'poleCd', 'wallCd', 'flipT', 'superT']) P[k] = Math.max(0, P[k] - dt);
    if (!P.dead) {
        const speed = rs();
        if (!P.onGround) P.coyote -= dt;
        if (P.swing) swingStep(dt);
        else if (P.climb) climbStep(dt, f, r);
        else {
            jumpLogic(); superLogic(); dashLogic(); slideLogic();
            // ----- horizontal velocity -----
            const tx = mv.x * speed, tz = mv.z * speed;
            if (P.onGround) {
                const k = 1 - Math.exp(-dt * 16);
                P.hv.x += (tx - P.hv.x) * k; P.hv.z += (tz - P.hv.z) * k;
            } else if (mv.lengthSq() > 0.01) {
                // In the air you steer, but momentum carries: pushing the way you're already going
                // keeps any speed above your run speed (pole launches, wall jumps), bleeding it slowly
                const cur = Math.hypot(P.hv.x, P.hv.z), along = cur > 0.1 ? (P.hv.x * mv.x + P.hv.z * mv.z) / cur : 0;
                const keep = along > 0.3 ? Math.max(speed, cur * Math.exp(-dt * 0.25)) : speed;
                const len = Math.hypot(mv.x, mv.z) || 1, k = 1 - Math.exp(-dt * 5);
                P.hv.x += (mv.x / len * keep * Math.min(1, len) - P.hv.x) * k; P.hv.z += (mv.z / len * keep * Math.min(1, len) - P.hv.z) * k;
            } else P.hv.multiplyScalar(Math.exp(-dt * 5));   // let go in the air and you stop (Roblox air control)
            // Slide: locked direction, can't steer much
            if (P.slideT > 0) {
                P.slideT -= dt;
                P.hv.copy(P.slideDir).multiplyScalar(speed * 1.05);
                if (P.slideT <= 0) {
                    if (freeAt(P.pos.x, P.pos.y, P.pos.z, PH)) { P.ph = PH; P.crouched = false; } else P.crouched = true;
                }
            } else if (P.crouched) {
                // Still under something low: keep sliding through
                P.hv.copy(P.slideDir).multiplyScalar(Math.max(8, speed * 0.6));
                if (freeAt(P.pos.x, P.pos.y, P.pos.z, PH)) { P.ph = PH; P.crouched = false; }
            }
            if (P.dashT > 0) { P.dashT -= dt; if (P.vy < 0) P.vy = 0; } else P.boost.multiplyScalar(Math.exp(-dt * (P.onGround && P.boostDecay < 2 ? 4 : P.boostDecay)));
            // ----- wall run on the blue glass -----
            const wb = !P.onGround && P.wallCd <= 0 && P.wallTotal < CFG.wallrunMax ? wallBeside() : null;
            const side = wb ? wb.side : 0;
            if (side && (Math.abs(P.hv.z) + Math.abs(P.boost.z) > 4 || P.wall)) {
                if (!P.wall) { P.wall = side; P.vy = clamp(P.vy, -4, 12); P.doubleUsed = false; P.airDashUsed = false; sfx('wallGrab'); setWallrunSound(true); }
                P.wall = side;
                P.wallTotal += dt;
                // Glued to the glass: drift to a stop vertically and hold the height
                P.vy *= Math.exp(-dt * 5);
                P.pos.x += (wb.x - P.pos.x) * Math.min(1, dt * 20);
                const dir = Math.sign(P.hv.z + P.boost.z) || 1;
                P.hv.z = dir * Math.max(speed, Math.abs(P.hv.z));
                P.hv.x = side * 3;
                P.facing = dir > 0 ? 0 : Math.PI;
                if (pressed('jump')) {
                    // Wall jump: up and away, the double jump comes back
                    consume('jump');
                    P.vy = JUMP_V * 0.95; P.hv.x = -side * 22; P.wall = 0; P.wallCd = 0.28; P.doubleUsed = false;
                    sfx('jump'); setWallrunSound(false);
                }
            } else if (P.wall) { P.wall = 0; P.wallCd = 0.15; setWallrunSound(false); }
            else if (!P.onGround && P.wallTotal < CFG.wallrunMax) wallMagnet(dt);
            if (!P.wall) P.vy -= GRAV * dt;
            let vx = P.hv.x + P.boost.x, vz = P.hv.z + P.boost.z;
            // Treadmills: an owned one runs you in place; a locked one pushes you off the back
            if (tread) {
                const td = P.ground.treadDir || { x: 0, z: 1 }, ty = Math.atan2(td.x, td.z);
                if (treadRun) { vx = 0; vz = 0; P.facing = lerpAngle(P.facing, ty, 1 - Math.exp(-dt * 10)); }
                else if (!treadOwned(tread)) { vx -= td.x * 6; vz -= td.z * 6; }
                else {
                    // Walking forward on an owned belt barely moves you
                    const along = vx * td.x + vz * td.z;
                    if (along > 0) { vx -= td.x * along * 0.85; vz -= td.z * along * 0.85; }
                }
            }
            const dist = Math.max(Math.abs(vx), Math.abs(vz), Math.abs(P.vy)) * dt;
            const n = Math.max(1, Math.ceil(dist / 0.6));
            const sdt = dt / n;
            const wasGround = P.ground;
            P.onGround = false; P.ground = null; P.climbHit = null;
            let vy = P.wall ? P.vy : P.vy + 0.5 * GRAV * dt;
            for (let i = 0; i < n; i++) {
                moveAxis('x', vx * sdt);
                moveAxis('z', vz * sdt);
                const before = P.vy;
                moveAxis('y', vy * sdt);
                if (P.vy !== before) vy = P.vy;
            }
            // Stick to the floor going down steps
            if (!P.onGround && wasGround && P.vy <= 0 && P.vy > -40) {
                const y0 = P.pos.y;
                moveAxis('y', -0.35);
                if (!P.onGround) P.pos.y = y0;
            }
            if (P.onGround) {
                if (P.wall) { P.wall = 0; setWallrunSound(false); }
                if (P.airTime > 0.3) {
                    sfx('land');
                    dust(P.pos, P.airTime > 0.8 ? 12 : 6, P.airTime > 0.8 ? 1.4 : 1);
                    P.squashV -= Math.min(9, 3 + P.airTime * 6);
                    if (P.airTime > 1) { ring(P.pos, 0xffffff, 5, 0.45); addShake(0.25); rumble(0.4, 120); }
                }
                P.airTime = 0;
            } else P.airTime += dt;
            // Walked into the red wall while pushing toward it: climb
            if (P.climbHit && mv.z > 0.3 && !P.dead) startClimb(P.climbHit);
            // Grab a pole
            if (!P.onGround && P.poleCd <= 0) for (const pl of nearPoles) {
                if (P.pos.x < pl.x0 || P.pos.x > pl.x1) continue;
                const dy = P.pos.y + 3.2 - pl.y, dz = P.pos.z - pl.z;
                if (dy * dy + dz * dz < 3.4 * 3.4) { startSwing(pl); break; }
            }
            if (treadRun) { const td = P.ground && P.ground.treadDir; P.facing = lerpAngle(P.facing, td ? Math.atan2(td.x, td.z) : 0, 1 - Math.exp(-dt * 14)); }
            else if (!P.wall && P.slideT <= 0 && !P.crouched && mv.lengthSq() > 0.01) P.facing = lerpAngle(P.facing, Math.atan2(mv.x, mv.z), 1 - Math.exp(-dt * 14));
        }

        // Stage you're in, the void under it, hazards
        const here = stageAt(P.pos.x, P.pos.y, P.pos.z);
        if (here !== P.stage) {
            P.stage = here;
            refreshNear(here);
            setMusicIntensity(here >= 5 ? 1 : here >= 2 ? 0.5 : 0);
        }
        const voidY = here >= 0 ? Math.min(STAGES[here].y0, STAGES[here].y1) - CFG.voidDepth : -30;
        if (P.pos.y < voidY) die('fall');
        if (!P.dead) for (const k of nearKills) {
            if (!k.active) continue;
            if (k.test ? k.test(P.pos) : (k.max.x > P.pos.x - HW + 0.25 && k.min.x < P.pos.x + HW - 0.25 && k.max.y > P.pos.y + 0.1 && k.min.y < P.pos.y + P.ph - 0.2 && k.max.z > P.pos.z - HW + 0.25 && k.min.z < P.pos.z + HW - 0.25)) { die(k.cause); break; }
        }
        if (!P.dead) for (const tr of nearTriggers) {
            const inside = overlapsBox(tr, P.pos);
            if (inside && !tr.inside && tr.enter) tr.enter();
            tr.inside = inside;
            if (P.dead) break;
        }
    } else {
        P.deadT -= dt;
        if (P.deadT <= 0) respawn();
    }

    if (S.name && S.name !== nameLabelText && headLabel) { nameLabelText = S.name; headLabel.userData.set([{ t: S.name, c: '#ffffff', s: '#1c1030', px: 60 }]); }
    updateEffects(dt);
    updateFx(dt);
    updateMaterials(dt);
    for (const fn of tickers) fn(dt, t);

    const people = syncRemotes(dt, t);
    friendsT -= dt; friendSyncT -= dt;
    if (friendsT <= 0) { friendsT = 30; friendSyncT = 5; refreshFriends(); }
    else if (friendSyncT <= 0) { friendSyncT = 5; syncFriends(); }

    // The local character
    if (rig) animateLocal(dt, t, treadRun);
    sendMove(false);
    animateCounters(dt);
    updateControls(P, CFG);
    hudT -= dt;
    if (hudT <= 0) { hudT = 0.1; updateHud(); refreshShop(); updateLobbySigns(); updateStageBar(people); }
}

// ----- climbing the red walls -----
function startClimb(c) {
    if (P.climb || P.swing) return;
    P.climb = { c };
    P.vy = 0; P.hv.set(0, 0, 0); P.boost.set(0, 0, 0); P.wall = 0; P.slideT = 0; P.crouched = false; P.ph = PH;
    P.facing = 0;
    sfx('grab');
}
function climbStep(dt, f, r) {
    const c = P.climb.c;
    const speed = clamp(0.75 * rs(), 12, 40);
    // Hold toward the wall to climb, back off to let go
    if (pressed('jump')) {
        consume('jump');
        P.climb = null; P.vy = 38; P.hv.set(0, 0, -14); P.poleCd = 0.2;
        sfx('jump');
        return;
    }
    if (f < -0.3) { P.climb = null; P.hv.set(0, 0, -6); return; }
    P.pos.z = c.min.z - HW - 0.02;
    P.pos.x = clamp(P.pos.x + r * 8 * dt, c.min.x + 1.2, c.max.x - 1.2);
    const up = f > 0.2 || Math.abs(r) > 0.2 ? speed : 0;
    P.pos.y += up * dt;
    stepClock += dt * (up ? 1 : 0);
    if (up && stepClock > 0.22) { stepClock = 0; sfx('climbStep'); }
    // Over the top: step onto the ledge
    if (P.pos.y >= c.climb.top - 0.6) {
        P.pos.y = c.climb.top + 0.02;
        P.pos.z = c.min.z + HW + 1.4;
        P.climb = null; P.vy = 0; P.onGround = true; P.hv.set(0, 0, speed * 0.5);
        sfx('land'); dust(P.pos, 6, 1);
    }
}
// ----- swinging round a pole: a full giant swing, then you're thrown forward and up -----
function startSwing(pl) {
    const entry = Math.max(Math.hypot(P.hv.x + P.boost.x, P.hv.z + P.boost.z), rs());
    P.swing = { pl, t: 0, x: clamp(P.pos.x, pl.x0, pl.x1), entry };
    P.vy = 0; P.hv.set(0, 0, 0); P.boost.set(0, 0, 0); P.wall = 0; P.slideT = 0; P.crouched = false; P.ph = PH;
    P.facing = 0; P.doubleUsed = false; P.airDashUsed = false;
    sfx('grab'); sfx('swing');
}
const SWING_T = 0.8, SWING_A0 = -0.5, SWING_A1 = Math.PI * 2 + 0.75, SWING_R = 5.2;
function swingStep(dt) {
    const s = P.swing, pl = s.pl;
    s.t += dt;
    const k = Math.min(1, s.t / SWING_T);
    s.a = SWING_A0 + (SWING_A1 - SWING_A0) * (k * k * (1.6 - 0.6 * k));
    P.pos.set(s.x, pl.y - SWING_R * Math.cos(s.a), pl.z + SWING_R * Math.sin(s.a));
    if (k >= 1) {
        const L = Math.max(32, 1.05 * s.entry);
        P.swing = null; P.poleCd = 0.6;
        P.vy = 52; P.hv.set(0, 0, L); P.airTime = 0.01;
        sfx('whoosh'); fovKick = 6;
    }
}

function animateLocal(dt, t, treadRun) {
    const u = rig.userData;
    let pose = '';
    if (P.swing) pose = 'swing';
    else if (P.climb) pose = 'climb';
    else if (P.wall) pose = P.wall > 0 ? 'wallR' : 'wallL';
    else if (P.slideT > 0 || P.crouched) pose = 'slide';
    else if (P.dashT > 0) pose = 'dash';
    else if (!P.onGround && P.superT > 0) pose = 'super';
    else if (!P.onGround && P.flipT > 0) pose = 'flip';
    if (P.swing) {
        // Hang from the pole and spin round it: the body points from the feet to the bar
        rig.position.copy(P.pos);
        rig.rotation.set(-P.swing.a, 0, 0);
        u.pivot.rotation.set(0, 0, 0); u.pivot.position.y = PIVOT;
    } else {
        rig.position.copy(P.pos);
        rig.rotation.set(0, P.facing, 0);
        poseCharacter(rig, pose, dt);
    }
    const hs = P.moving ? Math.hypot(P.hv.x, P.hv.z) || rs() : 0;
    P.animPhase += dt * (P.onGround || P.wall ? Math.min(19, 4 + hs * 0.28) : P.climb ? 9 : 0);
    const bp = pose === 'wallL' || pose === 'wallR' ? 'wallrun' : pose;
    if (bp && bp !== 'super') poseRig(u.body, bp, P.animPhase);
    else if (!P.onGround) airPose(u.body, pose === 'super' ? 1 : 0);
    else if (P.moving) animRig(u.body, P.animPhase, 0.85);
    else animRig(u.body, 0, 0);
    if (localAvatar) localAvatar.update(dt, { moving: P.moving && (P.onGround || !!P.wall), air: !P.onGround && !P.climb && !P.wall, speed: hs, t, pose: bp === 'super' ? 'flip' : bp });
    setShoe(rig, S.shoe); setTrail(rig, S.trail);
    u.trail.update(trailAt(rig), (P.moving || !P.onGround) && !P.dead, dt, t);
    // Shoe sparkles, footsteps, dust when fast
    const sd = shoeById[S.shoe];
    footT -= dt;
    if (sd && sd.fx && P.moving && P.onGround && footT <= 0 && !P.dead) { footT = 0.06; shoeFx(P.pos, sd.fx, sd.glow); }
    const stepN = Math.floor(P.animPhase / Math.PI);
    if ((P.onGround || P.wall) && P.moving && !P.dead && stepN !== P.lastStep) {
        footstep(P.wall ? 1.2 : treadRun ? 0.6 : 1);
        if (hs > 34 && stepN % 2 === 0) dust(P.pos, 1, 0.5);
    }
    P.lastStep = stepN;
    P.squashV += (1 - P.squash) * 180 * dt;
    P.squashV *= Math.exp(-12 * dt);
    P.squash = clamp(P.squash + P.squashV * dt, 0.7, 1.3);
    if (!P.swing) rig.scale.set(1 / Math.sqrt(P.squash), P.squash, 1 / Math.sqrt(P.squash)); else rig.scale.set(1, 1, 1);
    rig.visible = !P.dead;
    const fast = Math.hypot(P.hv.x + P.boost.x, P.hv.z + P.boost.z);
    setSpeedLines(!P.dead && !reduceMotion && (P.dashT > 0 || fast > 30 || P.superT > 0.3) ? Math.min(0.9, 0.35 + (fast - 30) * 0.012 + (P.dashT > 0 ? 0.4 : 0)) : 0, dt);
}

// =====================================================================================
// Boot
// =====================================================================================
let lastFrame = 0, loadingSignaled = false, fpsAcc = 0, fpsFrames = 0, showFps = false;
// Slow PC? After joining, if the game keeps running under ~40 FPS for 3 s (tab visible), step the
// graphics down one level (High -> Medium -> Low). It stops once the player picks a quality.
const fpsWatch = { t: 0, low: 0 };
function watchFps(fps) {
    if (!running || document.hidden || !autoQualityAllowed()) return;
    fpsWatch.t += 0.5;
    if (fpsWatch.t < 4) return;
    fpsWatch.low = fps < 40 ? fpsWatch.low + 0.5 : 0;
    if (fpsWatch.low < 3) return;
    fpsWatch.low = 0;
    const next = { high: 'medium', medium: 'low' }[getQuality()];
    if (!next) return;
    setQuality(next, true);
    toast('⚙️ Graphics set to ' + (next === 'medium' ? 'Medium' : 'Low') + ' for smoother play', '#7de8ff');
}
function frame(now) {
    const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
    fpsAcc += (now - (lastFrame || now)) / 1000; fpsFrames++;
    if (fpsAcc >= 0.5) { if (showFps) $('#fps').textContent = Math.round(fpsFrames / fpsAcc) + ' FPS'; watchFps(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }
    lastFrame = now;
    if (!loadingSignaled) { loadingSignaled = true; BX.triggerAllSettings(); }
    pollGamepad();
    padButtons();
    // Nothing is drawn behind the loading screen: the page stays free to load and connect
    if (running) { update(dt); updateCamera(dt); render(); }
    requestAnimationFrame(frame);
}

// Straight into the game: no menu. Joins with the Bloxity name (or guest name) automatically.
// The server join starts right away and runs while the world is being built.
let joining = false, joinTask = null, worldReady = null;
async function joinServer() {
    await waitForLogin(1200);
    const saved = (storageGet('spo_name') || '').slice(0, 20);
    for (let attempt = 0; ; attempt++) {
        try { return await connect(BX.identity().loggedIn ? '' : saved); } catch (e) {
            if (attempt >= 4) throw e;
            console.warn('[join] attempt', attempt + 1, 'failed:', e && e.message);
            $('#loading').textContent = 'Waking up a server…';
            await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
        }
    }
}
async function play() {
    if (joining || running) return;
    joining = true;
    const err = $('#connectErr'), retry = $('#playBtn');
    err.hidden = true; retry.hidden = true;
    $('#loading').hidden = false;
    if (!joinTask) joinTask = joinServer();
    initAudio();
    try {
        await worldReady;
        $('#loading').textContent = 'Joining…';
        BX.loadingStep('Joining a server…');
        const room = await joinTask;
        const me = room.state.players && room.state.players.get(room.sessionId);
        S.name = me ? me.name : S.name;
        refreshShop();
    } catch (e) {
        joinTask = null;
        console.error(e);
        joining = false;
        $('#loading').hidden = true;
        err.hidden = false;
        err.textContent = 'Could not reach the game server. Check your connection and try again.';
        retry.hidden = false;
        BX.loadingEnd();
        return;
    }
    joining = false;
    running = true;
    startMusic();
    $('#start').hidden = true;
    $('#hud').hidden = false;
    $('#touch').hidden = !isTouch;
    if (!rig) buildPlayer(0, 0);
    teleportLobby();
    // Straight behind the character, no fly-in
    cam.target.set(P.pos.x, P.pos.y + 4.5, P.pos.z);
    showTips();
    setTimeout(() => { if (audioSuspended()) toast('🔊 Click or tap anywhere to turn on the music!', '#ffd028'); }, 3500);
    canvas.focus();
    BX.loadingEnd();
}
function waitForLogin(ms) {
    if (!BX.bloxity.ready || BX.identity().loggedIn) return Promise.resolve();
    return new Promise((res) => {
        const t0 = performance.now();
        (function check() { if (BX.identity().loggedIn || performance.now() - t0 > ms) res(); else setTimeout(check, 100); })();
    });
}
function showTips() {
    const el = $('#tips');
    const k = (key, what) => `<span><kbd>${key}</kbd>${what}</span>`;
    el.innerHTML = pad.connected
        ? k('L', 'Move') + k('A', 'Jump ×2') + k('Y', 'Super Jump') + k('RB', 'Dash') + k('X', 'Slide')
        : isTouch
            ? '<span>Joystick to move · JUMP twice to Double Jump · tap the Controls buttons for Super Jump, Dash and Slide</span>'
            : k('WASD', 'Move') + k('Space', 'Jump · again in the air: Double Jump') + k('F', 'Super Jump') + k('E', 'Dash') + k('C', 'Slide');
    el.hidden = false; el.style.opacity = 1;
    setTimeout(() => { el.style.opacity = 0; }, 10000);
    setTimeout(() => { el.hidden = true; }, 10900);
}
function unlockAudioOnGesture() {
    const unlock = () => {
        resumeAudio();
        if (!audioSuspended()) for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'click']) removeEventListener(ev, unlock, true);
    };
    for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'click']) addEventListener(ev, unlock, true);
}
function wirePortalSettings() {
    const embedded = (fn) => (v) => { if (BX.isEmbedded()) fn(v); };
    const pct = (v) => { const n = parseFloat(String(v)); if (!isFinite(n)) return undefined; return clamp(n > 1 ? n / 100 : n, 0, 1); };
    BX.listenSetting('master_volume', embedded((v) => { const p = pct(v); if (p !== undefined) setVolume('master', p); }));
    BX.listenSetting('music_volume', embedded((v) => { const p = pct(v); if (p !== undefined) setVolume('music', p); }));
    BX.listenSetting('graphics_quality', embedded((v) => setQuality(v === 'Low' ? 'low' : v === 'Medium' ? 'medium' : 'high', true)));
    BX.listenSetting('camera_sensitivity', embedded((v) => { camSens = clamp(parseFloat(v) || 1, 0.1, 5); }));
    BX.listenSetting('show_fps', (v) => { showFps = v === 'true'; $('#fps').hidden = !showFps; });
}
function wirePortalEvents() {
    BX.onPortalEvent((event, data) => {
        if (event === 'respawn_request') { if (P.dead) respawn(); else if (running) teleportLobby(); }
        else if (event === 'chat_message_sent' && data) net.send('chat', { text: String(data) });
        else if (event === 'play_emote' && data) { playEmoteOn(localAvatar, String(data)); net.send('emote', { id: String(data) }); }
    });
    BX.onAvatarChanged(() => syncMyAvatar());
    BX.onProportionsChanged(() => syncMyAvatar());
}

const pause = () => new Promise((r) => setTimeout(r, 0));
async function prepareWorld() {
    const step = (t) => { $('#loading').textContent = t; BX.loadingStep(t); };
    step('Loading fonts…');
    try { await Promise.race([Promise.all([document.fonts.load('700 40px Fredoka'), document.fonts.load('800 40px Montserrat')]), new Promise((r) => setTimeout(r, 2500))]); } catch (e) { /* fallback font */ }
    step('Building the obby…');
    await buildWorld(pause);
    refreshNear(-1);
    step('Preparing graphics…');
    // From the spawn view, so the first frame needs nothing new
    camera.position.set(0, 9, -60); camera.lookAt(0, 6, -38); camera.updateMatrixWorld();
    await warmUp(renderer, camera, pause, null);
    // A throw-away player model stands at the spawn for one hidden frame, so the character shaders
    // (skinned, and their shadows) are ready too and joining doesn't stutter
    try {
        const base = await Promise.race([loadBase(), new Promise((r) => setTimeout(r, 4000))]);
        const a = base ? await createAvatar(null) : null;
        if (a) {
            a.root.position.copy(SPAWN);
            scene.add(a.root);
            a.update(1 / 60, { t: 0 });
            render();
            scene.remove(a.root);
            a.dispose();
        } else render();
    } catch (e) { render(); }
}
async function boot() {
    BX.initBloxity();
    // Join the server and load the player model while the world is being built
    joinTask = joinServer();
    joinTask.catch(() => {});
    loadBase().catch(() => {});
    worldReady = prepareWorld();
    wirePortalSettings();
    wirePortalEvents();
    BX.onIdentity((id) => {
        if (net.room && id.loggedIn && id.token && !net.bloxity) net.send('auth', { token: id.token });
        if (net.room) { setupLocalAvatar(); syncMyAvatar(); }
    });
    $('#playBtn').addEventListener('click', play);
    $('#reconnectBtn').addEventListener('click', () => location.reload());
    unlockAudioOnGesture();
    requestAnimationFrame(frame);
    play();
}
boot();

// Dev-only hooks for automated QA runs (stripped from production builds)
if (import.meta.env.DEV) {
    window.__qa = {
        audio: () => audioDebug(), input: (o) => Object.assign(botInput, o), press: (k) => pressMove(k), solids, cam, P, S, STAGES, avatarStats, scene, camera, net, renderer: () => renderer,
        teleport: (x, y, z, yaw) => { P.padLock = false; P.dead = false; teleport(new V3(x, y, z), yaw || 0); },
        stage: (i) => { const sp = stageSpawn(i); P.dead = false; P.padLock = false; P.cp = i - 1; teleport(sp.pos, 0); },
        kills, poles, clock: () => clockT,
        walk: (n) => { qaWalk = n; }, deaths: () => deaths, near: () => near.length, checkpoints, LOBBY, FINALE,
        // Runs the game at 60 steps a second without rendering. script(i) -> { f, r, press } per step
        sim: (secs, f, script) => {
            if (qaClock === null) qaClock = net.now() / 1000;
            for (let i = 0; i < Math.round(secs * 60); i++) {
                botInput.f = f || 0;
                if (script) { const o = script(i, window.__qa.state()) || {}; if (o.f !== undefined) botInput.f = o.f; botInput.r = o.r || 0; if (o.press) pressMove(o.press); }
                update(1 / 60);
            }
            botInput.f = 0; botInput.r = 0;
            return window.__qa.state();
        },
        look: (yaw, pitch, dist) => { cam.yaw = yaw; cam.pitch = pitch; cam.dist = dist; },
        state: () => ({ cause: P.cause, x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2), dead: P.dead, stage: P.stage, cp: P.cp, wins: S.wins, level: S.level, speed: S.speed, onGround: P.onGround, wall: P.wall, climb: !!P.climb, swing: !!P.swing, ph: P.ph, vy: +P.vy.toFixed(2) }),
    };
}
