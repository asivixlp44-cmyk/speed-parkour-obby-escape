import { Room } from 'colyseus';
import { GameState, PlayerState } from './schema.js';
import {
    getProfile, hasProfile, markDirty, saveProfiles, adoptGuestProgress, loadProfile, releaseProfile,
    topProfiles, recordSession, USE_DB,
} from './profiles.js';
import { sealProfile, openSave } from './saves.js';
import { verifyBloxityToken } from './bloxity.js';
import {
    CFG, LOBBY, STAGES, PAD, COURSE_END, FINALE, ESCAPE, shoeById, treadById, trailById, BOOSTS, PACKS, FREE, DAILY,
    GROUP_CHEST, QUESTS, KITS, SKINS, xpFor, maxSpeedFor, rebirthLevel, rebirthWinsMult, eventState, speedMult, stepBase,
    treadmillAt, ownsTread, stageAt, reviveCost, questProgress, dailyStatus, dayKey, rewardText, fmt, clamp,
} from '../../shared/config.js';

const GREEN = '#7dff6b', RED = '#ff5a5a', GOLD = '#ffd028', BLUE = '#6fe0ff';

// Empty string when the player left the name box blank
function cleanName(name) {
    return String(name || '').replace(/[^\w .\-]/g, '').trim().slice(0, 20);
}
const randomName = () => 'Player' + Math.floor(1000 + Math.random() * 9000);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
// Guest ids come from the browser; they can never claim a Bloxity identity
const guestUid = (uid, fallback) => String(uid || fallback).replace(/^legion_/, 'guest_').slice(0, 64);
const cleanAvatar = (av) => (typeof av === 'string' && av.length <= 2000 ? av : '');

export const liveRooms = new Set();

// One shared world: the lavender lobby and the 9-stage parkour hall. Movement is client-side;
// everything that changes progress (Speed, Wins, unlocks, rebirths) is decided here. Nothing is
// sold for real money: every price is in Wins.
export class ParkourRoom extends Room {
    maxClients = CFG.maxPlayers;

    onCreate() {
        liveRooms.add(this);
        this.setState(new GameState());
        this.setPatchRate(50);
        this.sessions = new Map();
        this.joinCount = 0;

        const on = (type, fn) => this.onMessage(type, (client, m) => { try { fn.call(this, client, m || {}); } catch (e) { console.warn('[msg]', type, e.message); } });
        on('move', this.onMove);
        on('pad', this.onPad);
        on('escape', this.onEscape);
        on('revive', this.onRevive);
        on('shoe', this.onShoe);
        on('tread', this.onTread);
        on('trail', this.onTrail);
        on('boost', this.onBoost);
        on('pack', this.onPack);
        on('rebirth', this.onRebirth);
        on('free', this.onFree);
        on('daily', this.onDaily);
        on('chest', this.onChest);
        on('custom', this.onCustom);
        on('auth', this.onBloxityLogin);
        on('avatar', this.onAvatar);
        on('emote', this.onEmote);
        on('chat', this.onChat);
        on('friends', this.onFriends);
        on('died', this.onDied);

        this.setSimulationInterval((dt) => this.tick(dt), 100);
        this.clock.setInterval(() => this.broadcastBoards(), 10000);
        this.lastEvent = eventState(Date.now()).on;
        this.clock.setInterval(() => this.eventTick(), 1000);
    }

    // A Bloxity token is verified with the Bloxity API; anyone else joins as a guest
    async onAuth(client, options) {
        const legion = options && options.token ? await verifyBloxityToken(options.token) : null;
        return legion ? { legion } : { guest: true };
    }

    async onJoin(client, options, auth) {
        options = options || {};
        const guest = guestUid(options.uid, client.sessionId);
        let uid = guest, name = cleanName(options.name);
        if (auth && auth.legion) {
            uid = 'legion_' + auth.legion.id;
            name = cleanName(auth.legion.name) || name;
            await adoptGuestProgress(uid, guest, name);
        }
        await loadProfile(uid);
        // A fresh server on a temporary disk restores the browser's signed backup.
        // With a database the profile is never lost, so backups are not accepted at all.
        const restore = !USE_DB && !hasProfile(uid) && openSave(options.save, [uid, guest]);
        const profile = getProfile(uid, name, randomName());
        if (restore) { Object.assign(profile, restore); markDirty(); }
        const player = new PlayerState();
        player.name = profile.name;
        player.av = cleanAvatar(options.av);
        player.x = LOBBY.spawn.x; player.y = LOBBY.spawn.y; player.z = LOBBY.spawn.z; player.ry = 0;
        player.kit = this.joinCount % KITS.length;
        player.skin = (this.joinCount * 3) % SKINS.length;
        this.joinCount++;
        this.state.players.set(client.sessionId, player);
        this.sessions.set(client.sessionId, {
            client, profile, player,
            moving: false, lastMove: 0, gainT: 0, friends: 0,
            joinedAt: Date.now(), freeClaimed: {}, cooldowns: new Map(), guest, lastChat: 0, padArmed: true, deathStage: -1, deathAt: 0,
            stats: {
                fresh: Date.now() - (profile.firstPlay || 0) < 60000, maxStage: -1, pads: {}, deaths: {}, causes: {}, buys: 0,
                wins0: profile.totalWins, level0: profile.level, rebirths0: profile.rebirths, treadSecs: 0,
            },
        });
        this.syncPublic(client.sessionId);
        client.send('hello', { now: Date.now(), bloxity: uid.startsWith('legion_') });
        this.sendProfile(client.sessionId);
        this.broadcastBoards(client);
    }

    // A dropped connection keeps the player in the world for 30 s so the client can reconnect
    onDrop(client) {
        this.allowReconnection(client, 30);
    }
    onReconnect(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        s.client = client;
        client.send('hello', { now: Date.now(), bloxity: s.profile.uid.startsWith('legion_') });
        this.sendProfile(client.sessionId);
        this.broadcastBoards(client);
    }

    onLeave(client) {
        const s = this.sessions.get(client.sessionId);
        if (s) this.logSession(s);
        this.state.players.delete(client.sessionId);
        this.sessions.delete(client.sessionId);
        markDirty();
        if (s && !isOnline(s.profile.uid)) releaseProfile(s.profile.uid, isOnline);
    }

    // One record per finished session, for /api/stats (no names, no ids)
    logSession(s) {
        const st = s.stats, p = s.profile, pl = s.player;
        if (!st || st.logged) return;
        st.logged = true;
        recordSession({
            at: new Date(), secs: Math.round((Date.now() - s.joinedAt) / 1000), fresh: st.fresh,
            maxStage: st.maxStage, endStage: stageAt(pl.x, pl.y, pl.z), endDead: pl.anim === 3,
            pads: st.pads, deaths: st.deaths, causes: st.causes, buys: st.buys, treadSecs: Math.round(st.treadSecs),
            level0: st.level0, level1: p.level, wins0: st.wins0, wins1: p.totalWins, rebirths: p.rebirths - st.rebirths0,
            bloxity: p.uid.startsWith('legion_'),
        }).catch((e) => console.warn('[stats]', e.message));
    }
    onDied(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !this.cooldown(s, 'died', 0.5)) return;
        const st = STAGES[m.s | 0] ? m.s | 0 : -1;
        const cause = String(m.c || 'fall').replace(/[^a-z ]/g, '').slice(0, 16) || 'fall';
        s.stats.deaths[st] = (s.stats.deaths[st] || 0) + 1;
        s.stats.causes[cause] = (s.stats.causes[cause] || 0) + 1;
        s.deathStage = st; s.deathAt = Date.now();
    }

    // Colyseus awaits this on SIGTERM, which is how Legion stops a pod on every deploy
    onDispose() { liveRooms.delete(this); for (const s of this.sessions.values()) this.logSession(s); markDirty(); return saveProfiles(); }

    // ----- helpers -----
    syncPublic(id) {
        const s = this.sessions.get(id);
        if (!s) return;
        const p = s.profile, pl = s.player;
        pl.speed = p.speed; pl.wins = p.wins; pl.level = p.level; pl.xp = p.xp;
        pl.rebirths = p.rebirths; pl.shoe = p.shoe || ''; pl.trail = p.trail || '';
    }
    sendProfile(id) {
        const s = this.sessions.get(id);
        if (!s) return;
        const p = s.profile;
        s.client.send('profile', {
            shoes: p.shoes, shoe: p.shoe, treads: p.treads, trail: p.trail, treadSteps: p.treadSteps,
            pass2x: p.pass2x, boostUntil: p.boostUntil, customSpeed: p.customSpeed, starterPack: p.starterPack,
            maxStage: p.maxStage, escaped: p.escaped, quest: p.quest, totalWins: p.totalWins,
            firstPlay: p.firstPlay, freeClaimed: s.freeClaimed, joinedAt: s.joinedAt, daily: p.daily, chestAt: p.chestAt,
            save: sealProfile(p),
        });
    }
    toast(s, text, color) { s.client.send('toast', { text, color }); }
    cooldown(s, key, seconds) {
        const now = Date.now();
        if ((s.cooldowns.get(key) || 0) > now) return false;
        s.cooldowns.set(key, now + seconds * 1000);
        return true;
    }
    changed(id) {
        const s = this.sessions.get(id);
        if (s) this.checkQuest(s);
        this.syncPublic(id); this.sendProfile(id); markDirty();
    }
    fx(s, kind) { s.client.send('fx', { kind: kind || 'confetti' }); }
    // Pays with Wins; false (and a toast) when the player can't afford it
    spend(s, cost) {
        if (!(cost >= 0) || s.profile.wins < cost) {
            this.toast(s, 'Not Enough Wins! (need ' + fmt(Math.max(0, cost - s.profile.wins)) + ' more)', RED);
            return false;
        }
        s.profile.wins -= cost;
        s.stats.buys++;
        return true;
    }

    addSpeed(s, amount, boosted) {
        const p = s.profile;
        if (!(amount > 0)) return 0;
        if (boosted) amount = Math.floor(amount * speedMult(p, Date.now(), s.friends) + 0.5);
        p.speed += amount;
        // XP is earned 1:1 with Speed; at MAX level the bar keeps filling up to its cap
        const old = p.level;
        p.xp += amount;
        while (p.level < CFG.maxLevel && p.xp >= xpFor(p.level)) { p.xp -= xpFor(p.level); p.level++; }
        if (p.level >= CFG.maxLevel) p.xp = Math.min(p.xp, xpFor(CFG.maxLevel));
        if (p.level > old) {
            s.client.send('levelUp', { from: old, to: p.level, walk: [maxSpeedFor(old, p.rebirths), maxSpeedFor(p.level, p.rebirths)] });
            this.checkQuest(s);
        }
        markDirty();
        return amount;
    }
    addWins(s, n, boosted) {
        if (boosted) {
            n *= rebirthWinsMult(s.profile.rebirths);
            if (eventState(Date.now()).on) n *= CFG.event.wins;
            n = Math.floor(n);
        }
        s.profile.wins += n;
        s.profile.totalWins = (s.profile.totalWins || 0) + n;
        markDirty();
        return n;
    }
    giveReward(s, r) {
        if (r.speed) this.addSpeed(s, r.speed, false);
        if (r.wins) this.addWins(s, r.wins, false);
        if (r.boost) s.profile.boostUntil = Math.max(Date.now(), s.profile.boostUntil || 0) + r.boost * 60000;
        if (r.shoe) { s.profile.shoes[r.shoe] = true; s.profile.shoe = r.shoe; }
    }
    // The tutorial quests complete themselves: the reward is paid and the next one starts
    checkQuest(s) {
        const p = s.profile;
        for (let guard = 0; guard < QUESTS.length; guard++) {
            const q = QUESTS[p.quest || 0];
            if (!q || questProgress(q, p) < q.n) return;
            p.quest = (p.quest || 0) + 1;
            this.giveReward(s, q.reward);
            s.client.send('quest', { done: q.text, reward: rewardText(q.reward) });
            this.sendProfile(s.client.sessionId);
        }
    }

    // ----- simulation -----
    tick(dt) {
        const now = Date.now();
        for (const [id, s] of this.sessions) {
            const pl = s.player, p = s.profile;
            // Speed from running: a step every gainInterval while the player is moving
            s.gainT += dt / 1000;
            if (s.gainT < CFG.gainInterval) continue;
            s.gainT -= CFG.gainInterval;
            if (s.gainT > CFG.gainInterval) s.gainT = 0;
            if (!s.moving || now - s.lastMove > 700 || pl.anim === 3) continue;
            let mult = 1;
            const tread = treadmillAt(pl.x, pl.y, pl.z);
            if (tread && ownsTread(p, tread)) {
                mult = tread.mult; s.stats.treadSecs += CFG.gainInterval;
                const q = QUESTS[p.quest || 0];
                if (q && q.kind === 'tread') { p.treadSteps = (p.treadSteps || 0) + 1; this.checkQuest(s); this.sendProfile(id); }
            }
            this.addSpeed(s, stepBase(p) * mult, true);
            this.syncPublic(id);
        }
    }

    // Admin Abuse starts / ends: tell everyone
    eventTick() {
        const on = eventState(Date.now()).on;
        if (on === this.lastEvent) return;
        this.lastEvent = on;
        this.broadcast('event', { on });
    }

    broadcastBoards(target) {
        // Database leaders (every pod) merged with the players online here
        const top = (key) => topProfiles(key).map((p) => ({ n: p.name, v: Math.floor(p[key] || 0) }));
        const msg = { speed: top('speed'), wins: top('totalWins'), rebirths: top('rebirths') };
        if (target) target.send('boards', msg); else this.broadcast('boards', msg);
    }

    // ----- messages -----
    onMove(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !finite(m.x) || !finite(m.y) || !finite(m.z)) return;
        const pl = s.player, p = s.profile;
        pl.x = clamp(m.x, -200, 200);
        pl.y = clamp(m.y, -200, COURSE_END.y + 200);
        pl.z = clamp(m.z, LOBBY.z0 - 50, COURSE_END.z + 200);
        pl.ry = finite(m.ry) ? m.ry : 0;
        pl.anim = clamp(m.a | 0, 0, 11);
        s.moving = !!m.mv;
        s.lastMove = Date.now();
        const here = stageAt(pl.x, pl.y, pl.z);
        if (here > s.stats.maxStage) s.stats.maxStage = here;
        if (pl.z < LOBBY.z1 - 2) s.padArmed = true;
        // The furthest stage you've stood in
        if (here > (p.maxStage || 0) && here >= 0 && pl.y >= STAGES[here].y0 - 6) {
            p.maxStage = here;
            client.send('reached', { s: here });
            this.changed(client.sessionId);
        }
    }

    // Wins pad on a stage platform: the player must be standing on it
    onPad(client, m) {
        const s = this.sessions.get(client.sessionId);
        const st = STAGES[m.s | 0], pad = st && st.pads[m.k | 0];
        if (!s || !pad) return;
        const pl = s.player, p = s.profile;
        const near = Math.abs(pl.x - pad.x) <= PAD.w / 2 + 3 && Math.abs(pl.z - pad.z) <= PAD.d / 2 + 4 && pl.y >= pad.y - 2.5 && pl.y <= pad.y + 9;
        if (!near) return;
        if (!s.padArmed || !this.cooldown(s, 'pad', 3)) return;
        s.padArmed = false;
        const got = this.addWins(s, pad.wins, true);
        s.stats.pads[m.s | 0] = (s.stats.pads[m.s | 0] || 0) + 1;
        if ((m.s | 0) + 1 > (p.maxStage || 0) && STAGES[(m.s | 0) + 1]) p.maxStage = (m.s | 0) + 1;
        client.send('wins', { n: got, s: m.s | 0, k: m.k | 0 });
        this.changed(client.sessionId);
    }
    // The ESCAPE pad after Stage 9
    onEscape(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const pl = s.player, p = s.profile;
        if (Math.abs(pl.x - FINALE.x) > 12 || Math.abs(pl.z - FINALE.z) > 12 || pl.y < FINALE.y - 3) return;
        if (!s.padArmed || !this.cooldown(s, 'pad', 3)) return;
        s.padArmed = false;
        const first = !p.escaped;
        p.escaped = (p.escaped || 0) + 1;
        const got = this.addWins(s, ESCAPE.wins, true);
        s.stats.pads[STAGES.length - 1] = (s.stats.pads[STAGES.length - 1] || 0) + 1;
        client.send('wins', { n: got, s: STAGES.length, k: 2, escape: true, first });
        this.broadcast('announce', { text: '👑 ' + p.name + ' ESCAPED THE OBBY!', color: GOLD }, { except: client });
        this.changed(client.sessionId);
    }
    // Revive: pay to go back to the start of the stage you just fell in
    onRevive(client, m) {
        const s = this.sessions.get(client.sessionId);
        const st = m.s | 0;
        if (!s || !STAGES[st] || st < 1) return;
        if (s.deathStage !== st || Date.now() - s.deathAt > (CFG.reviveSecs + 3) * 1000) return;
        if (!this.cooldown(s, 'revive', 2)) return;
        if (!this.spend(s, reviveCost(st))) return;
        s.deathStage = -1;
        client.send('revived', { s: st });
        this.changed(client.sessionId);
    }

    // SHOES: buy (any you can afford) or equip one you own
    onShoe(client, m) {
        const s = this.sessions.get(client.sessionId), d = shoeById[m.id];
        if (!s || !d) return;
        const p = s.profile;
        if (p.shoes[d.id]) {
            if (p.shoe !== d.id) { p.shoe = d.id; this.toast(s, 'Equipped ' + d.name + '! +' + fmt(d.bonus) + ' Speed', BLUE); }
        } else {
            if (d.daily) return this.toast(s, 'Get the ' + d.name + ' from the Daily Rewards!', RED);
            if (!this.spend(s, d.cost)) return;
            p.shoes[d.id] = true;
            p.shoe = d.id;
            this.toast(s, 'Bought ' + d.name + '! +' + fmt(d.bonus) + ' Speed', GREEN);
            this.fx(s);
        }
        this.changed(client.sessionId);
    }
    onTread(client, m) {
        const s = this.sessions.get(client.sessionId), d = treadById[m.id];
        if (!s || !d || d.reb || !d.cost || ownsTread(s.profile, d)) return;
        if (!this.spend(s, d.cost)) return;
        s.profile.treads[d.id] = true;
        this.toast(s, d.label + ' Treadmills unlocked!', GREEN);
        this.fx(s);
        this.changed(client.sessionId);
    }
    onTrail(client, m) {
        const s = this.sessions.get(client.sessionId), d = trailById[m.id];
        if (!s || !d) return;
        const p = s.profile;
        if ((p.rebirths || 0) < d.reb) return this.toast(s, 'You need ' + d.reb + ' Rebirth' + (d.reb > 1 ? 's' : '') + ' for this trail!', RED);
        if (p.trail === d.id) return;
        p.trail = d.id;
        this.toast(s, d.name + ' trail equipped! x' + d.mult + ' Speed', BLUE);
        this.changed(client.sessionId);
    }
    onBoost(client, m) {
        const s = this.sessions.get(client.sessionId), b = BOOSTS[m.id];
        if (!s || !b) return;
        const p = s.profile;
        if (m.id === 'pass2x') {
            if (p.pass2x) return this.toast(s, 'x2 Speed is already yours!', BLUE);
            if (!this.spend(s, b.cost)) return;
            p.pass2x = true;
            this.toast(s, 'x2 Speed unlocked forever!', GOLD);
        } else if (m.id === 'starter') {
            const left = CFG.starterPackMinutes * 60000 - (Date.now() - (p.firstPlay || 0));
            if (p.starterPack || left <= 0) return this.toast(s, 'The Starter Pack is gone!', RED);
            if (!this.spend(s, b.cost)) return;
            p.starterPack = true;
            this.giveReward(s, { speed: b.speed, boost: CFG.boostMinutes, shoe: b.shoe });
            this.toast(s, 'STARTER PACK! Lucky Shoes + x2 Speed!', GOLD);
        }
        this.fx(s);
        this.changed(client.sessionId);
    }
    // "+10k", "+100k", "+1M", "+10M Speed" on the bottom bar
    onPack(client, m) {
        const s = this.sessions.get(client.sessionId);
        const i = m.i | 0, pk = PACKS[i];
        if (!s || !pk) return;
        if (!this.spend(s, pk.cost)) return;
        this.addSpeed(s, pk.n, false);
        client.send('gain', { n: pk.n, pack: 1 });
        this.changed(client.sessionId);
    }

    onRebirth(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile;
        const need = rebirthLevel(p.rebirths);
        if (p.level < need) return this.toast(s, 'Reach Level ' + need + ' to Rebirth!', RED);
        p.rebirths++;
        p.level = 1; p.xp = 0; p.customSpeed = 0;
        this.toast(s, 'REBIRTH! +' + Math.round(p.rebirths * CFG.rebirthStep * 100) + '% Speed for good!', BLUE);
        this.fx(s, 'rebirth');
        this.changed(client.sessionId);
        this.broadcastBoards();
    }

    onFree(client, m) {
        const s = this.sessions.get(client.sessionId);
        const i = m.i | 0, r = FREE[i];
        if (!s || !r || s.freeClaimed[i]) return;
        if ((Date.now() - s.joinedAt) / 60000 < r.min) return;
        s.freeClaimed[i] = true;
        this.giveReward(s, r);
        this.toast(s, 'Claimed ' + rewardText(r) + '!', GREEN);
        this.fx(s);
        this.changed(client.sessionId);
    }
    onDaily(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile, now = Date.now();
        const st = dailyStatus(p.daily, now);
        if (!st.can) return this.toast(s, 'Come back tomorrow for more!', BLUE);
        const r = DAILY[st.day];
        p.daily = { last: dayKey(now), streak: st.streak + 1 };
        this.giveReward(s, r);
        this.toast(s, 'Claimed Day ' + (st.day + 1) + ' reward! ' + rewardText(r), GREEN);
        this.fx(s);
        this.changed(client.sessionId);
    }
    // OP REWARD chest in the lobby: once every GROUP_CHEST.hours
    onChest(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !this.cooldown(s, 'chest', 2)) return;
        const p = s.profile, left = (p.chestAt || 0) + GROUP_CHEST.hours * 3600000 - Date.now();
        if (left > 0) return this.toast(s, 'OP REWARD refills in ' + Math.ceil(left / 3600000) + 'h', BLUE);
        p.chestAt = Date.now();
        this.giveReward(s, GROUP_CHEST);
        this.toast(s, 'OP REWARD! ' + rewardText(GROUP_CHEST), GOLD);
        this.fx(s);
        this.changed(client.sessionId);
    }
    onCustom(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile;
        const max = maxSpeedFor(p.level, p.rebirths);
        const v = Math.floor(Number(m.v) || 0);
        p.customSpeed = v <= 0 || v >= max ? 0 : clamp(v, CFG.minWalk, max);
        this.changed(client.sessionId);
    }

    // ----- Bloxity -----
    // Logged in to Bloxity after joining: move this session onto the Bloxity profile
    async onBloxityLogin(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || s.authing) return;
        s.authing = true;
        const legion = await verifyBloxityToken(m.token);
        s.authing = false;
        if (!legion || !this.sessions.has(client.sessionId)) return;
        const uid = 'legion_' + legion.id;
        if (s.profile.uid === uid) return;
        const name = cleanName(legion.name) || s.profile.name;
        const guestProfile = s.profile;
        await adoptGuestProgress(uid, guestProfile.uid, name);
        await loadProfile(uid);
        if (!this.sessions.has(client.sessionId)) return;
        s.profile = getProfile(uid, name, randomName());
        if (!isOnline(guestProfile.uid)) releaseProfile(guestProfile.uid, isOnline);
        s.player.name = s.profile.name;
        this.changed(client.sessionId);
        client.send('authed', { name: s.profile.name });
        this.toast(s, 'Logged in as ' + s.profile.name, GREEN);
        this.broadcastBoards();
    }
    onAvatar(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (s) s.player.av = cleanAvatar(m.av);
    }
    // Emote ids are opaque catalogue ids; other players play the same clip
    onEmote(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || typeof m.id !== 'string' || m.id.length > 40) return;
        this.broadcast('emote', { s: client.sessionId, id: m.id }, { except: client });
    }
    onChat(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || typeof m.text !== 'string') return;
        const now = Date.now();
        if (now - s.lastChat < 800) return;
        s.lastChat = now;
        const text = m.text.replace(/\s+/g, ' ').trim().slice(0, 120);
        if (text) this.broadcast('chat', { s: client.sessionId, name: s.profile.name, text });
    }
    // Friend Boost: the client counts its Bloxity friends among the names in this room.
    // Only names actually present here are counted, and the bonus is capped.
    onFriends(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !Array.isArray(m.names)) return;
        const here = new Set([...this.sessions.values()].filter((o) => o !== s).map((o) => o.profile.name));
        const n = new Set(m.names.slice(0, 50).map(String).filter((x) => here.has(x))).size;
        const friends = Math.min(CFG.friendMax, n);
        if (friends === s.friends) return;
        s.friends = friends;
        s.player.friends = friends;
    }
}

function isOnline(uid) {
    for (const room of liveRooms) for (const s of room.sessions.values()) if (s.profile.uid === uid) return true;
    return false;
}
