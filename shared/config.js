// Game data shared by the client and the Colyseus server.
// +1 Speed Parkour Obby Escape: every step is +Speed, Speed fills your Level, and every level makes
// you run faster. Climb walls, swing on poles, wall-run, Super Jump, Dash, Slide and Double Jump
// through 9 stages, touching the Wins pads at the end of each. Fall or touch the lava and you are
// back in the lobby. There are no in-app purchases: everything is bought with Wins.

export const CFG = {
    maxLevel: 500,
    // "Level 17 > Level 18 / Speed 42 > Speed 44" (reference): Speed = 8 + 2 per level
    walkBase: 8,
    walkPerLevel: 2,
    rebirthWalk: 2,
    minWalk: 8,
    maxWalk: 400,
    // Roblox defaults: jump power 50, gravity 196.2 (a jump rises about 6.4 studs)
    jumpV: 50,
    grav: 196.2,
    superV: 78,           // Super Jump (F): rises about 15.5 studs
    superBoost: 0.3,      // ...and pushes you forward by 30% of your run speed
    superCd: 2.0,
    dashCd: 1.5,
    dashTime: 0.22,
    dashMult: 1.6,        // Dash (E): a burst of 1.6x your run speed
    slideCd: 1.0,
    slideTime: 0.75,
    wallrunMax: 2.4,      // seconds of wall running per jump
    gainInterval: 0.5,    // a step every 0.5 s while you run (about the reference's pace)
    voidDepth: 40,
    respawnDelay: 1.3,
    reviveSecs: 6,
    // Rebirth: from Level 25 (+5 per rebirth, up to 90). Level back to 1, +50% Speed, +25% Wins,
    // +2 walk speed for good
    rebirthBase: 25,
    rebirthInc: 5,
    rebirthCap: 90,
    rebirthStep: 0.5,
    rebirthWins: 0.25,
    // Admin Abuse event on the server clock: every 30 min for 5 min, x2 Speed and x2 Wins for everyone
    event: { every: 30 * 60, length: 5 * 60, speed: 2, wins: 2 },
    boostMult: 2,
    boostMinutes: 15,
    starterPackMinutes: 12,
    friendBoost: 0.1,
    friendMax: 5,
    maxPlayers: 24,
};

// XP to finish each level, read off the reference (12 at Level 1 ... 145 at Level 21, 165 at 22),
// then x1.135 a level. XP is earned 1:1 with Speed ("Total Speed").
const XP_TABLE = [12, 14, 15, 17, 20, 22, 25, 28, 32, 36, 41, 47, 53, 60, 68, 78, 88, 100, 113, 128, 145, 165];
export const xpFor = (L) => (L <= XP_TABLE.length ? XP_TABLE[Math.max(1, L) - 1] : Math.round(165 * Math.pow(1.135, L - XP_TABLE.length)));
// The Speed number (walk speed) at a level, as the HUD shows it ("MAX: 44")
export const maxSpeedFor = (L, R) => Math.min(CFG.maxWalk, CFG.walkBase + CFG.walkPerLevel * Math.max(1, L || 1) + CFG.rebirthWalk * (R || 0));
// How fast that really moves you, in studs per second. Up to 24 it is the same number; above that
// it grows more gently (24 -> 24, 44 -> 36, 80 -> 50, 115 -> 63, cap 90), so a fast character
// stays easy to control. Every gap in the course is sized with this.
export const runSpeed = (v) => Math.min(90, v <= 24 ? Math.max(6, v) : 24 * Math.pow(v / 24, 0.62));
export const rebirthLevel = (R) => Math.min(CFG.rebirthCap, CFG.rebirthBase + CFG.rebirthInc * (R || 0));
export const rebirthMult = (R) => 1 + CFG.rebirthStep * (R || 0);
export const rebirthWinsMult = (R) => 1 + CFG.rebirthWins * (R || 0);

// Admin Abuse: { on, left (s until it ends or starts) } at server time `now` (ms)
export function eventState(now) {
    const E = CFG.event, t = now / 1000, c = ((t % E.every) + E.every) % E.every;
    return c < E.length ? { on: true, left: E.length - c } : { on: false, left: E.every - c };
}

// =====================================================================================
// The course: one long lavender hall north (+z) out of the lobby, laid out like the reference video.
// Each stage is a run of obstacle segments and ends on a raised platform with two Wins pads: yellow
// (+N) on the floor on the right and purple (about 2N) on a block on the left. That platform is where
// the next stage starts. Gaps are sized from the stage's recommended Speed with runSpeed().
//   Stage 1: climb wall right inside the door, run, swing on the pole up onto the platform
//   Stage 2: blue glass wall run over spiked lava, landing, "Press Super Jump!" up onto the platform
//   Stage 3: corridor of ceiling crushers with spikes along the sides, lava edges, stairs, wall run
//   Stage 4: slide through the "STAGE 4 / Slide Under!" block, climb wall, step pyramid with a
//            second Slide Under block, three Double Jump walls
//   Stage 5: navy room of round pillars with sweeping red lasers (the video ends here)
//   Stages 6-9 mix the same obstacles, harder
// =====================================================================================
export const HALL_W = 40;               // corridor width: x from -20 to 20
export const LOBBY = { halfX: 86, z0: -100, z1: 44, wallHeight: 46, spawn: { x: 0, y: 0, z: -38 } };
export const PLATFORM_LEN = 44;
export const WALLRUN_HALF = 5.5;        // wall-run corridors are 11 wide (blue glass at x = +-5.5)
export const TUNNEL_H = 3.2;            // Slide Under blocks: the gap under them
// Stage platforms are rooms wider than the hall (x from -32 to 32). Pads: yellow on the floor on the
// right (-x), purple on a raised block on the left (+x)
export const PLAT_HALF = 32;
export const PAD = { w: 8, d: 8, yellowX: -20, purpleX: 20 };

const S_ = (name, hint, need, wins, theme, segs) => ({ name, hint, need, wins, theme, segs });
// Segments: [type, ...params]. Lengths come from the stage's need speed.
export const STAGES = [
    S_('Stage 1', 'Walk towards the wall to climb it!', 10, [1, 2], 'lavender',
        [['run', 22, 'door'], ['climb', 36], ['run', 26, 'pole'], ['pole', 5], ['platform', 3.5]]),
    S_('Stage 2', 'Wall Run & Super Jump!', 24, [4, 10], 'lavender',
        [['run', 4], ['wallrun'], ['run', 12, 'super'], ['superjump', 6], ['platform', 6]]),
    S_('Stage 3', 'Dodge the Crushers!', 34, [8, 20], 'lavender',
        [['run', 8], ['crushers', 3], ['edgeLava', 16], ['stairs', 4.5], ['wallrun'], ['platform', 6]]),
    S_('Stage 4', 'Slide Under!', 44, [15, 30], 'lavender',
        [['tunnel', 12, 'stage'], ['run', 30], ['climb', 36], ['run', 10], ['pyramid'], ['dbjump', 3], ['platform', 6]]),
    S_('Stage 5', 'Laser Pillars!', 54, [30, 65], 'lavender',
        [['run', 8], ['pillarRoom', 4], ['run', 22, 'super'], ['superjump', 6], ['platform', 6]]),
    S_('Stage 6', 'Crusher Run!', 66, [60, 130], 'night',
        [['run', 8], ['crushers', 4], ['edgeLava', 14], ['wallrun', 'zig'], ['run', 22, 'pole'], ['pole', 5], ['platform', 6]]),
    S_('Stage 7', 'Slide & Climb!', 80, [125, 260], 'dusk',
        [['tunnel', 12, 'stage'], ['run', 24], ['climb', 42], ['run', 10], ['pyramid'], ['dbjump', 4], ['platform', 6]]),
    S_('Stage 8', 'Dash Across!', 96, [250, 500], 'neon',
        [['run', 8], ['pillarRoom', 5], ['run', 22], ['wallrun'], ['run', 12, 'super'], ['superjump', 6], ['platform', 6]]),
    S_('Stage 9', 'Final Escape!', 115, [500, 1000], 'gold',
        [['run', 10], ['climb', 44], ['run', 10], ['wallrun', 'zig'], ['crushers', 3], ['dbjump', 3], ['run', 12, 'super'], ['superjump', 6], ['finale']]),
];
export const ESCAPE = { wins: 2500 };

// Stage looks: floor / walls / trims / sky haze / lava. The first five are the reference's lavender
// hall (colours sampled from the video); the higher stages get darker, then golden
export const THEMES = {
    lavender: { floor: 0x8a7abc, wall: 0xa08ed0, trim: 0xd8ccf6, pillar: 0xc4b6ec, sky: 0xb4a8ec, lava: 0xff7000, accent: 0x6fd8ff },
    night: { floor: 0x24306a, wall: 0x1e2a5e, trim: 0x4a6ad8, pillar: 0x34428a, sky: 0x2a2a6a, lava: 0xff3a5a, accent: 0xff3a5a },
    dusk: { floor: 0x9a5aa0, wall: 0xa86aa8, trim: 0xffb0d8, pillar: 0xd8a8dc, sky: 0xf0a0c8, lava: 0xff6a1e, accent: 0xff6ad8 },
    neon: { floor: 0x261a46, wall: 0x1c1434, trim: 0x2affd8, pillar: 0x342864, sky: 0x4a3a9a, lava: 0xff2ad0, accent: 0x2affd8 },
    gold: { floor: 0xc8a448, wall: 0xd4b464, trim: 0xfff0c0, pillar: 0xf0dca0, sky: 0xffe0a0, lava: 0xff5a1e, accent: 0xffd028 },
};

// ----- gap sizes from the stage's need speed (see main.js for the moves) -----
const G = (need) => runSpeed(need);
export const PILLAR_R = 4.5;           // round pillars in the pillar rooms
export const GAPS = {
    pole: () => 16,                                                         // the pole throws you about 22 studs
    wallrun: (need) => Math.round(2.0 * G(need)),                          // ~2.4 s of wall running
    superjump: (need) => Math.round(1.0 * G(need)),                        // Super Jump + Double Jump, up 6
    pillar: (need) => Math.round(0.42 * G(need)),                          // a jump between pillars, over the laser
};
const SEG_LEN = {
    run: (s, p) => p[1],
    climb: () => 8,
    pole: (s) => GAPS.pole(s.need),
    wallrun: (s) => GAPS.wallrun(s.need) + 8,
    superjump: (s) => GAPS.superjump(s.need),
    crushers: (s, p) => 10 + p[1] * 26,
    edgeLava: (s, p) => p[1],
    stairs: (s, p) => Math.ceil(p[1] / 1.5) * 3,
    tunnel: (s, p) => p[1],
    pyramid: () => 3 * 4 + 12 + 6,
    dbjump: (s, p) => p[1] * 24 + 6,
    pillarRoom: (s, p) => (p[1] + 1) * GAPS.pillar(s.need) + p[1] * PILLAR_R * 2,
    platform: () => PLATFORM_LEN,
    finale: () => 90,
};
// How much higher the floor is after a segment (the platform's own pad block is separate)
const SEG_RISE = { climb: (p) => p[1], stairs: (p) => p[1], pole: (p) => p[1], superjump: (p) => p[1] };

{
    let z = LOBBY.z1, y = 0;
    STAGES.forEach((s, i) => {
        s.i = i;
        s.zS = z; s.y0 = y;
        s.segList = s.segs.map((p) => {
            const len = SEG_LEN[p[0]](s, p);
            const rise = SEG_RISE[p[0]] ? SEG_RISE[p[0]](p) : 0;
            const seg = { k: p[0], p, z0: z, z1: z + len, y0: y, y1: y + rise };
            z += len; y += rise;
            return seg;
        });
        s.zE = z; s.y1 = y;
        // The end platform: pads and the next stage's start (and the revive point)
        const pf = s.segList[s.segList.length - 1];
        s.platform = { z0: pf.z0, z1: pf.z1, y: pf.y0 };
        s.spawn = { x: 0, y: pf.y0, z: pf.z0 + (pf.k === 'finale' ? 20 : 10) };
        if (pf.k === 'platform') {
            const pz = pf.z0 + 9, block = pf.p[1] || 6;
            s.pads = [
                { k: 0, x: PAD.yellowX, y: pf.y0, z: pz, wins: s.wins[0] },
                { k: 1, x: PAD.purpleX, y: pf.y0 + block, z: pz, wins: s.wins[1], block },
            ];
        } else s.pads = [];
    });
}
export const COURSE_END = { z: STAGES[STAGES.length - 1].zE, y: STAGES[STAGES.length - 1].y1 };
const FIN = STAGES[STAGES.length - 1].segList[STAGES[STAGES.length - 1].segList.length - 1];
export const FINALE = { x: 0, y: FIN.y0, z: FIN.z0 + 62, z0: FIN.z0, z1: FIN.z1 };

// Stage index at a position (-1 in the lobby). A stage owns its segments up to the end of its
// platform... except the platform itself counts as the *next* stage's start for the progress bar.
export function stageAt(x, y, z) {
    if (z < LOBBY.z1) return -1;
    for (let i = 0; i < STAGES.length; i++) if (z < STAGES[i].zE) return i;
    return STAGES.length - 1;
}
// 0..9 along the course, for the progress bar on top (lobby = 0, finishing stage 9 = 9)
export function courseProgress(x, y, z) {
    const i = stageAt(x, y, z);
    if (i < 0) return 0;
    const s = STAGES[i];
    return i + Math.min(1, Math.max(0, (z - s.zS) / (s.platform.z0 + 10 - s.zS)));
}

// =====================================================================================
// Treadmills: free "TRAIN HERE" ones and paid multipliers, in the lobby's TRAIN SPEED area and on the
// stage platforms. Standing on one you own runs you automatically: every step counts xN.
// =====================================================================================
export const TREADS = [
    { id: 'n', mult: 1, cost: 0, color: 0x9a96d8, label: 'TRAIN HERE' },
    { id: 'r1', mult: 1.5, reb: 1, color: 0xffd028, label: 'x1.5 Steps' },
    { id: 'r3', mult: 2, reb: 3, color: 0x46ec50, label: 'x2 Steps' },
    { id: 'x5', mult: 5, cost: 15, color: 0xffc414, label: 'x5 Steps', fx: 'bolt' },
    { id: 'x10', mult: 10, cost: 60, color: 0x5ad8ff, label: 'x10 Steps', fx: 'ice' },
    { id: 'x25', mult: 25, cost: 250, color: 0xff3ad8, label: 'x25 Steps', fx: 'magic' },
    { id: 'x100', mult: 100, cost: 2000, color: 0xffffff, label: 'x100 Steps', fx: 'rainbow' },
    { id: 'x1000', mult: 1000, cost: 40000, color: 0xff5a14, label: 'x1000 Steps', fx: 'fire' },
];
export const treadById = Object.fromEntries(TREADS.map((d) => [d.id, d]));
export const TREAD = { len: 12, width: 5.6, top: 1.2 };
// Where each treadmill stands (belt centre). dir: the way you face running on it (toward the
// console): +z by default; the lobby's are turned to face the TRAIN SPEED wall (-x).
// The lobby's TRAIN SPEED row is on the right of the spawn (-x, as in the reference), then one or
// two on every stage platform.
export const TREAD_SPOTS = [];
export const LOBBY_TREAD_X = -70;
{
    ['x1000', 'x100', 'x25', 'x10', 'x5', 'n', 'n', 'n', 'n', 'r1', 'r3'].forEach((id, k) => TREAD_SPOTS.push({ id, x: LOBBY_TREAD_X, z: -80 + k * 8.6, y: 0.3, zone: -1, dir: -1, ax: 'x' }));
    const per = [['x5', 'n'], ['x25', 'n'], ['x10', 'n'], ['x100', 'n'], ['x100', 'n'], ['x1000', 'n'], ['x1000', 'n'], ['x1000', 'n']];
    STAGES.forEach((s, i) => {
        if (!per[i]) return;
        // The paid one on the left behind the purple pad, a TRAIN HERE one on the right (as in the reference)
        per[i].forEach((id, k) => TREAD_SPOTS.push({ id, x: k ? -14 : 12, z: s.platform.z0 + 27, y: s.platform.y, zone: i }));
    });
}
export function treadmillAt(x, y, z) {
    for (const t of TREAD_SPOTS) {
        const hx = (t.ax === 'x' ? TREAD.len : TREAD.width) / 2 + 0.3, hz = (t.ax === 'x' ? TREAD.width : TREAD.len) / 2 + 0.3;
        if (Math.abs(x - t.x) <= hx && Math.abs(z - t.z) <= hz && y >= t.y + TREAD.top - 0.8 && y <= t.y + TREAD.top + 2.5) return treadById[t.id];
    }
    return null;
}
export const ownsTread = (p, d) => !!d && (d.reb ? (p.rebirths || 0) >= d.reb : !d.cost || !!(p.treads && p.treads[d.id]));

// =====================================================================================
// WINS SHOP: shoes, "+N Speed" on every step (the first is "+1 Speed / 1 Wins Required", as in the
// reference). OP Shoes: the special stands by the Stage 1 door and the Hacker Shoes.
// =====================================================================================
const SH = (id, name, bonus, cost, color, accent, extra) => Object.assign({ id, name, bonus, cost, color, accent }, extra || {});
export const SHOES = [
    SH('basic', 'Starter Kicks', 1, 1, 0xffd028, 0xffffff),
    SH('sky', 'Sky Runners', 2, 3, 0x3ad8ff, 0xffffff),
    SH('bubble', 'Bubble Sprinters', 4, 8, 0xff6ad8, 0xffffff),
    SH('lime', 'Lime Dashers', 7, 20, 0x46ec50, 0x1a3a10),
    SH('cherry', 'Cherry Boosters', 12, 45, 0xff3a4a, 0xffffff),
    SH('ocean', 'Ocean Runners', 20, 90, 0x2a6aff, 0x8ae8ff),
    SH('grape', 'Grape Jumpers', 35, 180, 0x9a4aff, 0xffd028),
    SH('mint', 'Mint Striders', 60, 350, 0x5affc0, 0xffffff, { glow: 0x5affc0 }),
    SH('sunset', 'Sunset Sprinters', 100, 700, 0xff8a3a, 0xffe05a, { glow: 0xff8a3a }),
    SH('frost', 'Frost Walkers', 175, 1400, 0xbaf0ff, 0xffffff, { glow: 0x9ae8ff, fx: 'frost' }),
    SH('thunder', 'Thunder Kicks', 300, 2800, 0xffe05a, 0x2a2a3a, { glow: 0xffe05a, fx: 'spark' }),
    SH('royal', 'Royal Gold', 500, 5500, 0xffc828, 0xffffff, { glow: 0xffd028, fx: 'star' }),
];
export const OP_SHOES = [
    SH('lucky', 'Lucky Shoes', 50, 300, 0xffe05a, 0x46ec50, { glow: 0xffe05a, fx: 'star', op: true }),
    SH('flame', 'Flame Shoes', 125, 900, 0xff5a14, 0xffd028, { glow: 0xff6a14, fx: 'fire', op: true }),
    SH('dragon', 'Dragon Shoes', 400, 4000, 0xb85aff, 0xff3ad8, { glow: 0xc85aff, fx: 'fire', op: true, wings: true }),
    SH('hacker', 'Hacker Shoes', 5000, 60000, 0x14ff5a, 0x0a2a14, { glow: 0x2aff6a, fx: 'spark', op: true }),
];
// The Day 7 daily reward
export const SECRET_SHOE = SH('galaxy', 'Galaxy Shoes', 2500, 0, 0x5a1ebe, 0xff50e6, { glow: 0xb85aff, fx: 'rainbow', daily: true, wings: true });
export const ALL_SHOES = [...SHOES, ...OP_SHOES, SECRET_SHOE];
export const shoeById = Object.fromEntries(ALL_SHOES.map((d) => [d.id, d]));

// TRAILS (left HUD tile, "New!"): unlocked by rebirths, multiply every step
export const TRAILS = [
    { id: 'starter', name: 'Starter', mult: 1, reb: 0, color: 0xffffff },
    { id: 'pink', name: 'Pink Flash', mult: 1.5, reb: 1, color: 0xff6ad8 },
    { id: 'blue', name: 'Blue Streak', mult: 2, reb: 3, color: 0x3ad8ff },
    { id: 'green', name: 'Toxic', mult: 3, reb: 5, color: 0x46ec50 },
    { id: 'fire', name: 'Fire Dash', mult: 5, reb: 10, color: 0xff6a14 },
    { id: 'rainbow', name: 'Rainbow', mult: 8, reb: 20, color: 0xffffff, rainbow: true },
];
export const trailById = Object.fromEntries(TRAILS.map((d) => [d.id, d]));

// HUD buys, all in Wins
export const BOOSTS = {
    pass2x: { name: 'x2 Speed', cost: 25, desc: 'Double all the Speed you earn. Forever!' },
    starter: { name: 'STARTER PACK', cost: 5, desc: '+2.5K Speed, 15 min x2 Speed and the Lucky Shoes', speed: 2500, shoe: 'lucky' },
};
// Bottom bar: "+10k", "+100k", "+1M", "+10M Speed" (fixed amounts, as in the reference)
export const PACKS = [
    { n: 10000, cost: 30, label: '+10k', cls: 'g-yellow' },
    { n: 100000, cost: 250, label: '+100k', cls: 'g-yellow' },
    { n: 1000000, cost: 2000, label: '+1M', cls: 'g-rainbow' },
    { n: 10000000, cost: 15000, label: '+10M Speed', cls: 'g-hot' },
];
// "Revive? (5.2) ONLY 🏆N": back to the start of the stage you fell in
export const reviveCost = (stage) => (stage <= 0 ? 1 : Math.max(1, Math.ceil(STAGES[stage - 1].wins[0] / 2)));

// Lobby freebies: the OP REWARD chest (Like + Join Group!), once a day
export const GROUP_CHEST = { hours: 24, speed: 500, wins: 3 };
// "Claim!" (left tile): playtime rewards (minutes since joining)
export const FREE = [
    { min: 2, speed: 200 }, { min: 5, wins: 2 }, { min: 10, speed: 2500 },
    { min: 15, wins: 5 }, { min: 25, speed: 25000 }, { min: 40, wins: 25 }, { min: 60, boost: 15 },
];
// Daily Rewards, as in the reference: +1 Win, 5k Speed, +100 Wins, 50k Speed, +500 Wins,
// 100k Speed, SECRET Reward (the Galaxy Shoes). One a day; missing a day restarts the week.
export const DAILY = [
    { wins: 1 }, { speed: 5000 }, { wins: 100 }, { speed: 50000 }, { wins: 500 }, { speed: 100000 }, { shoe: 'galaxy', secret: true },
];
export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
export function dailyStatus(d, now) {
    d = d || {};
    const today = dayKey(now), yesterday = dayKey(now - 86400000);
    const can = d.last !== today;
    const streak = d.last === today || d.last === yesterday ? d.streak || 0 : 0;
    return { can, streak, day: Math.min(DAILY.length - 1, can ? streak % DAILY.length : Math.max(0, streak - 1) % DAILY.length) };
}
export const rewardText = (r) => [
    r.speed ? '+' + fmt(r.speed) + ' Speed' : '',
    r.wins ? '+' + fmt(r.wins) + ' Win' + (r.wins > 1 ? 's' : '') : '',
    r.boost ? r.boost + ' min x2 Speed' : '',
    r.shoe ? shoeById[r.shoe].name : '',
].filter(Boolean).join(' & ');

// The tutorial on the top band (as in the reference), then the stage bar takes its place
export const QUESTS = [
    { text: 'Train on the treadmill!', kind: 'tread', n: 10, reward: { speed: 25 } },
    { text: 'Get your first Win!', kind: 'wins', n: 1, reward: { speed: 50 } },
    { text: 'Buy a Shoe!', kind: 'shoe', n: 1, reward: { speed: 100 } },
];
export function questProgress(q, p) {
    if (!q) return 0;
    switch (q.kind) {
        case 'tread': return p.treadSteps || 0;
        case 'wins': return p.totalWins || 0;
        case 'shoe': return Object.keys(p.shoes || {}).length;
        default: return 0;
    }
}

// Player outfits for the blocky fallback body (cycle by join order); the reference's default
// black hoodie and jeans first
export const KITS = [
    { shirt: 0x14141e, shorts: 0x2a3a5a, socks: 0x2a3a5a, hair: 0xb8541c },
    { shirt: 0xff6ac8, shorts: 0x5a2a8a, socks: 0x5a2a8a, hair: 0x3a2618 },
    { shirt: 0x3ad8ff, shorts: 0x1e3a6a, socks: 0x1e3a6a, hair: 0xffd028 },
    { shirt: 0x46ec50, shorts: 0x1e2a44, socks: 0x1e2a44, hair: 0x3a2618 },
    { shirt: 0xffc828, shorts: 0x6a3a1e, socks: 0x6a3a1e, hair: 0x1a1420 },
    { shirt: 0x9a4aff, shorts: 0x1e1a3a, socks: 0x1e1a3a, hair: 0xff8ad8 },
    { shirt: 0xff4a5a, shorts: 0x14141e, socks: 0x14141e, hair: 0x3a2618 },
    { shirt: 0xffffff, shorts: 0x3a3a5a, socks: 0x3a3a5a, hair: 0x8a5a32 },
];
export const SKINS = [0xf2c9a0, 0xe1af87, 0xc88c5f, 0x8c5a3c, 0x5f3c28];

// Every multiplier on earned Speed
export function multipliers(p, now, friends, onTread) {
    const ev = eventState(now);
    const trail = trailById[p.trail];
    return {
        global: ev.on ? CFG.event.speed : 1,
        pass: (p.pass2x ? 2 : 1) * ((now || Date.now()) < (p.boostUntil || 0) ? CFG.boostMult : 1),
        trail: trail ? trail.mult : 1,
        rebirth: rebirthMult(p.rebirths),
        friends: 1 + CFG.friendBoost * Math.min(CFG.friendMax, friends || 0),
        tread: onTread || 1,
    };
}
export function speedMult(p, now, friends) {
    const m = multipliers(p, now, friends);
    return m.global * m.pass * m.trail * m.rebirth * m.friends;
}
// Speed per step before multipliers: 1 + the shoes' "+N Speed"
export const stepBase = (p) => 1 + ((shoeById[p.shoe] || {}).bonus || 0);

const SUF = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
// 2700 -> "2.7K", 1000000 -> "1M", 950 -> "950"
export function fmt(v) {
    v = Math.floor(v || 0);
    if (v < 1000) return String(v);
    let i = -1, s = v;
    while (s >= 1000 && i < SUF.length - 1) { s /= 1000; i++; }
    const t = s >= 100 ? String(Math.floor(s)) : (Math.floor(s * 10) / 10).toFixed(1).replace(/\.0$/, '');
    return t + SUF[i];
}
// "Total Speed: 1.1k" (the reference uses a lowercase k)
export function fmtK(v) {
    v = Math.floor(v || 0);
    if (v < 1000) return String(v);
    return fmt(v).replace(/K$/, 'k');
}
export function clock(s) {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + sec : m + ':' + sec;
}
// "09:12:98" style countdown (minutes:seconds:hundredths) of the reference's Starter Pack
export function clockCs(s) {
    s = Math.max(0, s);
    const p = (n) => String(Math.floor(n)).padStart(2, '0');
    return p(s / 60) + ':' + p(s % 60) + ':' + p((s * 100) % 100);
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function rngFrom(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
