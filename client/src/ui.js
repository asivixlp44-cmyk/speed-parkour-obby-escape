import { $ } from './engine.js';
import { S, actions, net } from './state.js';
import * as BX from './bloxity.js';
import { sfx, getVolumes, setVolume, toggleMusic, musicMuted, setMusicDuck } from './audio.js';
import { QUALITIES, getQuality, setQuality } from './fx.js';
import {
    CFG, STAGES, TRAILS, BOOSTS, PACKS, FREE, DAILY, QUESTS, KITS,
    xpFor, maxSpeedFor, rebirthLevel, rebirthMult, questProgress, dailyStatus, rewardText, reviveCost, courseProgress,
    fmt, fmtK, clock, clockCs, clamp, shoeById,
} from '../../shared/config.js';

const W = (n) => '🏆' + fmt(n);
function setHtml(node, html) { if (node && node.innerHTML !== html) node.innerHTML = html; }
function setText(node, t) { if (node && node.textContent !== t) node.textContent = t; }

const el = {
    wins: $('#winsVal'), speed: $('#speedVal'), reb: $('#rebPct'),
    xpFill: $('#xpFill'), levelTxt: $('#levelTxt'), xpTxt: $('#xpTxt'),
    maxSpeed: $('#maxSpeedTxt'), input: $('#speedInput'), price2x: $('#price2x'),
    freeBadge: $('#freeBadge'), dailyBadge: $('#dailyBadge'),
    questTxt: $('#questTxt'), band: $('#questBand'), starter: $('#starter'), starterTime: $('#starterTime'), starterPrice: $('#starterPrice'),
    revive: $('#revive'), reviveQ: $('#reviveQ'), reviveC: $('#reviveC'), bar: $('#stageBar'),
};
const packBtns = [...document.querySelectorAll('[data-pack]')];

// ----- counters -----
const shown = { wins: null, speed: null };
export function animateCounters(dt) {
    for (const key of ['wins', 'speed']) {
        const target = S[key];
        if (shown[key] === null) shown[key] = target;
        if (shown[key] === target) continue;
        if (target > shown[key] && key === 'wins') { const c = $('#winsCur'); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
        const diff = target - shown[key];
        shown[key] = Math.abs(diff) < 1 ? target : shown[key] + diff * Math.min(1, dt * 7);
        if (Math.abs(target - shown[key]) < Math.max(1, target * 0.002)) shown[key] = target;
        el[key].textContent = key === 'speed' ? fmtK(shown[key]) : fmt(shown[key]);
    }
}

// ----- HUD, ten times a second -----
let lastQuestKey = '', tutWas = null;
export function updateHud() {
    const now = net.now();
    setText(el.reb, 'Rebirth: +' + Math.round((rebirthMult(S.rebirths) - 1) * 100) + '%');
    const need = xpFor(Math.min(S.level, CFG.maxLevel));
    el.xpFill.style.width = clamp(S.xp / need * 100, 0, 100) + '%';
    setText(el.levelTxt, S.level >= CFG.maxLevel ? 'Level MAX' : 'Level ' + S.level);
    setText(el.xpTxt, fmt(S.xp) + '/' + fmt(need));
    const max = maxSpeedFor(S.level, S.rebirths);
    setText(el.maxSpeed, 'MAX: ' + max);
    const cur = S.customSpeed > 0 && S.customSpeed <= max ? S.customSpeed : max;
    if (document.activeElement !== el.input) el.input.value = cur;
    setHtml(el.price2x, S.pass2x ? '✅ OWNED' : 'ONLY ' + W(BOOSTS.pass2x.cost));
    // Tutorial band, then the stage bar and the side columns (as in the reference)
    const tut = (S.quest || 0) < QUESTS.length;
    if (tut !== tutWas) {
        document.body.classList.toggle('tut', tut);
        if (tutWas === true && !tut) setTimeout(openDailyOnJoin, 600);
        tutWas = tut;
    }
    const q = QUESTS[S.quest || 0];
    const qText = q ? (q.text + (q.n > 1 ? ' (' + fmt(Math.min(q.n, questProgress(q, S))) + '/' + fmt(q.n) + ')' : '')) : '';
    if (qText !== lastQuestKey) { lastQuestKey = qText; el.questTxt.textContent = qText; }
    // Badges
    const mins = (now - S.joinedAt) / 60000;
    el.freeBadge.hidden = !FREE.some((r, i) => mins >= r.min && !S.freeClaimed[i]);
    el.dailyBadge.hidden = !(S.daily && dailyStatus(S.daily, now).can);
    // STARTER PACK: the first minutes after you first play, with the reference's 00:00:00 countdown
    const left = CFG.starterPackMinutes * 60 - (now - S.firstPlay) / 1000;
    el.starter.hidden = S.starterPack || left <= 0;
    if (!el.starter.hidden) { setText(el.starterTime, clockCs(left)); setText(el.starterPrice, W(BOOSTS.starter.cost)); }
    packBtns.forEach((b, i) => setText(b.querySelector('.p'), W(PACKS[i].cost)));
    $('#btnSound').classList.toggle('off', musicMuted());
    if (!$('#modal').hidden && (modalKind === 'free' || modalKind === 'rebirth')) renderModal();
    if (!$('#daily').hidden) renderDaily();
    if (revive.until) updateRevive();
}

// ----- the stage bar: 1-9 and everyone's head at their place on the course -----
const dots = [];
for (let k = 0; k < STAGES.length; k++) {
    const d = document.createElement('div');
    d.className = 'dot o1'; d.textContent = String(k + 1);
    d.style.left = (4 + 92 * k / (STAGES.length - 1)) + '%';
    el.bar.appendChild(d); dots.push(d);
}
const heads = new Map();
export function updateStageBar(people) {
    const seen = new Set();
    for (const p of people) {
        const key = (p.me ? '*' : '') + p.name;
        seen.add(key);
        let h = heads.get(key);
        if (!h) {
            h = document.createElement('div');
            h.className = 'head o1' + (p.me ? ' me' : '');
            h.textContent = (p.name || '?').slice(0, 1).toUpperCase();
            h.style.background = '#' + KITS[(p.kit || 0) % KITS.length].shirt.toString(16).padStart(6, '0');
            el.bar.appendChild(h); heads.set(key, h);
        }
        const prog = courseProgress(p.x, p.y, p.z);
        h.style.left = (4 + 92 * clamp(prog, 0, STAGES.length - 1) / (STAGES.length - 1)) + '%';
    }
    for (const [k, h] of heads) if (!seen.has(k)) { h.remove(); heads.delete(k); }
    const best = S.maxStage || 0;
    dots.forEach((d, i) => d.classList.toggle('dim', i > best + 1));
}

// ----- Controls panel: cooldowns on the tiles ("1.3s"), tap them on touch screens -----
const ck = { super: $('#ckSuper'), dash: $('#ckDash'), slide: $('#ckSlide'), jump: $('#ckDouble') };
const ckLabel = { super: 'Super<br>Jump', dash: 'Dash', slide: 'Slide', jump: 'Double<br>Jump<small>(IN AIR)</small>' };
const ckShown = {};
export function updateControls(P) {
    const show = (k, cd, on) => {
        const html = cd > 0.05 ? cd.toFixed(1) + 's' : ckLabel[k];
        const key = html + (on ? 1 : 0);
        if (ckShown[k] === key) return;
        ckShown[k] = key;
        ck[k].innerHTML = html;
        ck[k].classList.toggle('cd', cd > 0.05);
        ck[k].classList.toggle('on', !!on);
    };
    show('super', P.superCd, P.superT > 0);
    show('dash', P.dashCd, P.dashT > 0);
    show('slide', P.slideCd, P.slideT > 0);
    show('jump', 0, !P.onGround && P.doubleUsed);
}
for (const b of document.querySelectorAll('[data-move]')) {
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); if (actions.press) actions.press(b.dataset.move); });
}
$('#ctrlToggle').addEventListener('click', () => { $('#controls').classList.toggle('min'); });

export function toast(text, color) {
    const d = document.createElement('div');
    d.className = 'toast o'; d.textContent = text; d.style.color = color || '#fff';
    const box = $('#toasts');
    box.appendChild(d);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => d.remove(), 2800);
}
export function showWin(n, escape) {
    const g = $('#winPop');
    g.querySelector('.goal').textContent = escape ? '👑 ESCAPED! 👑' : '+' + fmt(n) + ' WIN' + (n > 1 ? 'S' : '') + '!';
    $('#winSub').textContent = escape ? '+' + fmt(n) + ' Wins! Back to the lobby…' : 'Back to the lobby…';
    g.hidden = false;
    g.classList.remove('show'); void g.offsetWidth; g.classList.add('show');
    clearTimeout(showWin.t);
    showWin.t = setTimeout(() => { g.hidden = true; }, 2800);
}
export function showOof() {
    const f = $('#flash'); f.classList.remove('show'); f.classList.add('dead'); void f.offsetWidth; f.classList.add('show');
    clearTimeout(showOof.t); showOof.t = setTimeout(() => { f.classList.remove('dead'); }, 900);
}
// "Level 17 > Level 18 / Speed 42 > Speed 44"
export function levelUp(m) {
    const f = $('#flash'); f.classList.remove('show', 'dead'); void f.offsetWidth; f.classList.add('show');
    $('#lvlA').textContent = 'Level ' + m.from + ' > Level ' + m.to;
    $('#lvlB').textContent = 'Speed ' + m.walk[0] + ' > Speed ' + m.walk[1];
    const d = $('#lvlBanner');
    d.classList.remove('show'); void d.offsetWidth; d.classList.add('show');
}
let titleTimer;
export function showStageTitle(s) {
    if (!s) return;
    $('#stageName').textContent = s.name.toUpperCase();
    const sub = $('#stageSub'); sub.textContent = s.hint || ''; sub.style.color = '#ffe36b';
    const t = $('#stageTitle'); t.style.opacity = 1;
    t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
    clearTimeout(titleTimer);
    titleTimer = setTimeout(() => { t.style.opacity = 0; }, 2400);
}
export function questDone(m) {
    el.band.classList.remove('done'); void el.band.offsetWidth; el.band.classList.add('done');
    toast('✅ ' + m.done + '  ' + m.reward, '#7dff6b');
    sfx('quest');
}

// ----- Revive: "Revive? (5.2) ONLY 🏆N", back to the start of the stage you fell in -----
const revive = { until: 0, stage: -1 };
export function showRevive(stage, secs) {
    revive.until = performance.now() + secs * 1000; revive.stage = stage;
    el.revive.hidden = false;
    updateRevive();
}
export function hideRevive() { revive.until = 0; el.revive.hidden = true; }
function updateRevive() {
    const left = (revive.until - performance.now()) / 1000;
    if (left <= 0) { hideRevive(); return; }
    const cost = reviveCost(revive.stage);
    setText(el.reviveQ, 'Revive? (' + left.toFixed(1) + ')');
    setText(el.reviveC, 'ONLY ' + W(cost));
    el.revive.classList.toggle('poor', S.wins < cost);
}
setInterval(() => { if (revive.until) updateRevive(); }, 100);
el.revive.addEventListener('click', () => {
    const cost = reviveCost(revive.stage);
    if (S.wins < cost) { toast('Not Enough Wins! (need ' + fmt(cost) + ')', '#ff5a5a'); sfx('denied'); return; }
    net.send('revive', { s: revive.stage });
});

// ----- buying with Wins -----
let pendingConfirm = null;
export function confirmBuy(o) {
    if (S.wins < o.cost) { toast('Not Enough Wins! (need ' + fmt(o.cost - S.wins) + ' more)', '#ff5a5a'); sfx('denied'); return; }
    if (o.quick && o.cost <= Math.max(3, S.wins * 0.1)) { o.onYes(); return; }
    pendingConfirm = o;
    $('#confirmIc').textContent = o.ic || '🛒';
    $('#confirmTitle').textContent = o.title || 'Buy?';
    $('#confirmText').textContent = o.text || '';
    $('#confirmCost').textContent = '🏆 ' + fmt(o.cost) + ' Wins';
    $('#confirm').hidden = false;
}
$('#confirmYes').addEventListener('click', () => { $('#confirm').hidden = true; if (pendingConfirm) pendingConfirm.onYes(); pendingConfirm = null; });
for (const id of ['#confirmNo', '#confirmClose']) $(id).addEventListener('click', () => { $('#confirm').hidden = true; pendingConfirm = null; });

export function buyBoost(id) {
    const b = BOOSTS[id];
    if (id === 'pass2x' && S.pass2x) { toast('x2 Speed is already yours!', '#6fe0ff'); return; }
    confirmBuy({ ic: id === 'pass2x' ? '⚡' : '🎁', title: b.name, text: b.desc, cost: b.cost, onYes: () => net.send('boost', { id }) });
}
function buyPack(i) {
    const p = PACKS[i];
    confirmBuy({ ic: '👟', title: p.label + (i < 3 ? ' Speed' : ''), text: '+' + fmt(p.n) + ' Speed right now (counts toward your level)', cost: p.cost, onYes: () => net.send('pack', { i }) });
}
export function buyShoe(d) {
    if (S.shoes[d.id]) { net.send('shoe', { id: d.id }); return; }
    if (d.daily) { toast('The ' + d.name + ' are the Day 7 daily reward!', '#ffd028'); return; }
    confirmBuy({ ic: '👟', title: d.name, text: '+' + fmt(d.bonus) + ' Speed on every step', cost: d.cost, quick: true, onYes: () => net.send('shoe', { id: d.id }) });
}
export function buyTread(d) {
    confirmBuy({ ic: '🏃', title: d.label + ' Treadmill', text: 'Every step on it counts x' + d.mult + '. Works on every ' + d.label + ' treadmill!', cost: d.cost, onYes: () => net.send('tread', { id: d.id }) });
}

// ----- custom speed -----
const sendCustom = (v) => net.send('custom', { v: Number(v) || 0 });
el.input.addEventListener('change', () => sendCustom(el.input.value));
el.input.addEventListener('keydown', (e) => e.stopPropagation());

// ----- buttons -----
$('#btn2x').addEventListener('click', () => buyBoost('pass2x'));
$('#starter').addEventListener('click', () => buyBoost('starter'));
packBtns.forEach((b, i) => b.addEventListener('click', () => buyPack(i)));
$('#btnRebirth').addEventListener('click', () => openModal('rebirth'));
$('#btnTrails').addEventListener('click', () => openModal('trails'));
$('#btnClaim').addEventListener('click', () => openModal('free'));
$('#btnDaily').addEventListener('click', () => openDaily());
$('#btnInvite').addEventListener('click', () => openModal('friends'));
$('#btnSettings').addEventListener('click', () => openModal('settings'));
$('#btnSound').addEventListener('click', () => { const on = toggleMusic(); toast(on ? '🎵 Music on' : '🔇 Music off', '#ffffff'); });
// Every button clicks (pointerdown, so it feels instant)
document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest && e.target.closest('button, .btn, .rbx, #starter, .dcard.today');
    if (b && !b.disabled && !b.dataset.move) sfx(b.matches('.g-green, .claim') ? 'clickBuy' : 'click');
}, true);

// ----- panels -----
let modalKind = null;
export function openModal(kind) { modalKind = kind; renderModal(); $('#modal').hidden = false; setMusicDuck(true); }
export function closeModal() { $('#modal').hidden = true; modalKind = null; setMusicDuck(false); }
export function refreshModal() { if (!$('#modal').hidden) renderModal(); }
export const modalOpen = () => !$('#modal').hidden;
$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'modal') closeModal(); });

function rowCard(ic, name, desc, btnText, btnClass, onClick, disabled, on) {
    const d = document.createElement('div');
    d.className = 'row-card' + (on ? ' on' : '');
    d.innerHTML = '<div class="ic"></div><div><div class="nm o1"></div><div class="ds"></div></div><button class="btn o1"></button>';
    d.querySelector('.ic').textContent = ic;
    d.querySelector('.nm').textContent = name;
    d.querySelector('.ds').textContent = desc;
    const b = d.querySelector('button');
    b.classList.add(btnClass);
    b.textContent = btnText; b.disabled = !!disabled;
    b.addEventListener('click', onClick);
    return d;
}
function note(body, text) { const p = document.createElement('p'); p.className = 'note'; p.textContent = text; body.appendChild(p); return p; }

function renderModal() {
    const body = $('#modalBody'), title = $('#modalTitle');
    body.innerHTML = '';
    const k = modalKind;
    if (k === 'trails') { title.textContent = 'Trails'; renderTrails(body); }
    else if (k === 'rebirth') { title.textContent = 'Rebirth'; renderRebirth(body); }
    else if (k === 'free') { title.textContent = 'FREE Rewards'; renderFree(body); }
    else if (k === 'friends') { title.textContent = 'Invite Friends'; renderFriends(body); }
    else if (k === 'settings') { title.textContent = 'Settings'; renderSettings(body); }
}
function renderTrails(body) {
    note(body, 'Trails follow you as you run and multiply every step. Rebirth to unlock more!');
    for (const d of TRAILS) {
        const ok = S.rebirths >= d.reb, on = S.trail === d.id;
        const how = d.reb ? d.reb + ' Rebirth' + (d.reb > 1 ? 's' : '') : 'Free';
        body.appendChild(rowCard('✨', d.name + ' Trail', 'x' + d.mult + ' Speed · ' + how, on ? 'EQUIPPED' : ok ? 'Equip' : '🔒 Locked', on || !ok ? 'g-grey' : 'g-green', () => net.send('trail', { id: d.id }), on || !ok, on));
    }
}
function renderRebirth(body) {
    const need = rebirthLevel(S.rebirths), ready = S.level >= need;
    const cur = rebirthMult(S.rebirths), next = rebirthMult(S.rebirths + 1);
    const w = document.createElement('div');
    w.className = 'rebirth-box';
    const pct = Math.min(100, (S.level - 1) / Math.max(1, need - 1) * 100);
    w.innerHTML = `<div class="big o">🔄 ${S.rebirths} Rebirth${S.rebirths === 1 ? '' : 's'}</div>
        <div class="mult o"><span style="color:#6fe0ff">+${Math.round((cur - 1) * 100)}%</span><span>➜</span><span style="color:#7dff6b">+${Math.round((next - 1) * 100)}%</span></div>
        <div class="prog"><i style="width:${pct.toFixed(0)}%"></i><span class="o1">Level ${S.level} / ${need}</span></div>
        <p>Rebirth: your Level goes back to 1, but you keep for good <b>+50% Speed</b> and <b>+25% Wins</b> per rebirth, <b>+2 Speed</b> on every level, and new Trails and treadmills unlock. You keep your Wins, shoes and treadmills.</p>`;
    const b = document.createElement('button');
    b.className = 'btn o ' + (ready ? 'g-green' : 'g-grey');
    b.textContent = ready ? 'REBIRTH!' : 'Reach Level ' + need;
    b.disabled = !ready;
    b.addEventListener('click', () => { net.send('rebirth'); });
    w.appendChild(b);
    body.appendChild(w);
}
let freeSig = '';
function renderFree(body) {
    const mins = (net.now() - S.joinedAt) / 60000;
    const sig = FREE.map((r, i) => (S.freeClaimed[i] ? 'c' : mins >= r.min ? 'r' : Math.ceil(r.min * 60 - mins * 60))).join(',');
    if (sig === freeSig && body.children.length) return;
    freeSig = sig;
    body.innerHTML = '';
    FREE.forEach((r, i) => {
        const claimed = !!S.freeClaimed[i], ready = mins >= r.min;
        const btn = claimed ? 'Claimed' : ready ? 'CLAIM' : clock(r.min * 60 - mins * 60);
        body.appendChild(rowCard(r.speed ? '👟' : r.wins ? '🏆' : '⚡', rewardText(r), 'Play for ' + r.min + ' min', btn,
            claimed ? 'g-grey' : ready ? 'g-green' : 'g-blue', () => { if (!claimed && ready) net.send('free', { i }); }, claimed || !ready));
    });
}

// ----- Daily Rewards (reference layout: six cards and the big SECRET Reward on Day 7) -----
let dailyAuto = false;
export function openDailyOnJoin() {
    if (dailyAuto || !S.daily || !net.room || (S.quest || 0) < QUESTS.length) return;
    dailyAuto = true;
    if (dailyStatus(S.daily, net.now()).can) setTimeout(openDaily, 1200);
}
function openDaily() { renderDaily(true); $('#daily').hidden = false; }
$('#dailyClose').addEventListener('click', () => { $('#daily').hidden = true; });
$('#daily').addEventListener('pointerdown', (e) => { if (e.target.id === 'daily') $('#daily').hidden = true; });
let dailySig = '';
function renderDaily(force) {
    const st = dailyStatus(S.daily, net.now());
    const sig = st.can + '|' + st.streak + '|' + st.day;
    if (force || sig !== dailySig) {
        dailySig = sig;
        const cards = $('#dailyCards');
        cards.innerHTML = '';
        DAILY.forEach((r, i) => {
            const done = i < (st.streak % DAILY.length) && (i < st.day || !st.can);
            const today = i === st.day && st.can;
            const d = document.createElement('div');
            d.className = 'dcard' + (done ? ' done' : '') + (today ? ' today' : '') + (i === 6 ? ' d7' : '');
            const ic = r.secret ? '🎁' : r.wins ? '🏆' : '👟';
            const label = r.secret ? 'SECRET Reward!' : r.wins ? '+' + fmt(r.wins) + ' Win' + (r.wins > 1 ? 's' : '') : fmt(r.speed) + ' Speed';
            d.innerHTML = '<span class="dn o1"></span><span class="di"></span><span class="dr o1"></span><span class="st o1"></span>';
            d.querySelector('.dn').textContent = 'Day ' + (i + 1);
            d.querySelector('.di').textContent = ic;
            d.querySelector('.dr').textContent = label;
            d.querySelector('.st').textContent = today ? 'Claim' : done ? 'Claimed' : 'Locked';
            if (today) d.addEventListener('click', () => { net.send('daily'); setTimeout(() => { $('#daily').hidden = true; }, 700); });
            cards.appendChild(d);
        });
    }
    const now = net.now(), next = Math.ceil((now + 1) / 86400000) * 86400000;
    $('#dailyLeft').textContent = st.can ? 'Your daily reward is ready!' : 'Next reward in ' + clock((next - now) / 1000) + (st.day === 6 ? ' (Day 7: ' + shoeById.galaxy.name + '!)' : '');
}

// ----- Friends, Settings -----
function renderFriends(body) {
    note(body, 'Every Bloxity friend playing in your server gives you +10% Speed (up to +50%)!');
    if (!BX.bloxity.ready) { note(body, 'Bloxity is not available right now.'); return; }
    const id = BX.identity();
    const link = document.createElement('div');
    link.className = 'invite-row';
    link.innerHTML = '<input id="inviteLink" readonly aria-label="Invite link"><button class="btn g-green o1">Copy link</button>';
    body.appendChild(link);
    const input = link.querySelector('input');
    input.value = BX.getInviteLink();
    link.querySelector('button').addEventListener('click', async () => {
        input.select();
        try { await navigator.clipboard.writeText(input.value); toast('Invite link copied!', '#7dff6b'); } catch (e) { toast('Select the link and copy it', '#ffb51c'); }
    });
    if (!id.loggedIn) {
        note(body, 'Log in with Bloxity to see your friends and invite them into this server.');
        const b = document.createElement('button');
        b.className = 'btn g-blue o1'; b.textContent = 'Log in with Bloxity';
        b.addEventListener('click', () => BX.login());
        body.appendChild(b);
        return;
    }
    const loading = note(body, 'Loading friends…');
    BX.getFriends().then((friends) => {
        if (modalKind !== 'friends') return;
        loading.remove();
        if (!friends.length) { note(body, 'No friends yet. Share the invite link above!'); return; }
        const order = { 'in-game': 0, online: 1, away: 2, offline: 3 };
        friends.sort((a, b) => (order[a.presence && a.presence.status] ?? 4) - (order[b.presence && b.presence.status] ?? 4));
        for (const f of friends) {
            const st = (f.presence && f.presence.status) || 'offline';
            const where = st === 'in-game' && f.presence.gameName ? 'Playing ' + f.presence.gameName : st;
            body.appendChild(rowCard(st === 'offline' ? '⚫' : st === 'away' ? '🟡' : '🟢', f.displayName || f.username, where, 'Invite', 'g-green', async (e) => {
                e.currentTarget.disabled = true;
                const ok = await BX.inviteFriend(f._id);
                toast(ok ? 'Invite sent to ' + (f.displayName || f.username) : 'Could not send the invite', ok ? '#7dff6b' : '#ff5a5a');
            }));
        }
    });
}
function renderSettings(body) {
    const vols = getVolumes();
    const w = document.createElement('div');
    w.className = 'settings';
    w.innerHTML = `
        <label class="set-row o1" for="volMusic"><span>🎵 Music</span><input id="volMusic" type="range" min="0" max="100" value="${Math.round(vols.music * 100)}"></label>
        <label class="set-row o1" for="volSfx"><span>🔊 Sounds</span><input id="volSfx" type="range" min="0" max="100" value="${Math.round(vols.sfx * 100)}"></label>
        <div class="set-row o1"><span>✨ Graphics</span><div class="seg" role="radiogroup" aria-label="Graphics quality"></div></div>
        <p class="note">Low turns off glow and shadows for older phones. Now playing: "Parkour Rush" 🏃</p>`;
    w.querySelector('#volMusic').addEventListener('input', (e) => setVolume('music', e.target.value / 100));
    w.querySelector('#volSfx').addEventListener('input', (e) => setVolume('sfx', e.target.value / 100));
    const seg = w.querySelector('.seg');
    for (const [key, q] of Object.entries(QUALITIES)) {
        const b = document.createElement('button');
        b.className = 'btn o1 ' + (getQuality() === key ? 'g-green' : 'g-grey');
        b.textContent = q.label;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(getQuality() === key));
        b.addEventListener('click', () => { setQuality(key); renderModal(); });
        seg.appendChild(b);
    }
    body.appendChild(w);
}
