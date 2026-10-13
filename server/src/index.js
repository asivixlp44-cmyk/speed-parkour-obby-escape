import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config, { listen } from '@colyseus/tools';
import { defineRoom } from 'colyseus';
import express from 'express';
import { ParkourRoom } from './ParkourRoom.js';
import { installStatReporter } from './bloxity.js';
import { statsSummary } from './stats.js';

// Serves the built client (client/dist) and the game room on the same port,
// so one Node host is enough to run the whole game.
const CLIENT_DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');

// Play stats are private: /api/stats needs ?key=<stats key>. Only the key's SHA-256 lives in the
// public repo; locally (not on Legion) the stats are open.
const STATS_KEY_SHA256 = '4cb254dc1f80e94287fa7b26c7a75ecac75b9f9d0e123efcbf594b849beed182';
const ON_LEGION = !!process.env.BLOXITY_GAME_ID;
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();
const keyOk = (key) => !!key && crypto.timingSafeEqual(sha256(key), Buffer.from(STATS_KEY_SHA256, 'hex'));

const app = config({
    rooms: {
        parkour: defineRoom(ParkourRoom),
    },
    initializeExpress: (expressApp) => {
        expressApp.get('/health', (req, res) => res.json({ ok: true }));
        // Play stats (aggregate, no names): /api/stats?key=<stats key>&days=7
        expressApp.get('/api/stats', async (req, res) => {
            const key = typeof req.query.key === 'string' ? req.query.key : '';
            if (ON_LEGION && !keyOk(key)) return res.status(401).json({ error: 'bad key' });
            const days = Math.min(60, Math.max(1, Number(req.query.days) || 7));
            try { res.json(await statsSummary(days)); } catch (e) { res.status(503).json({ error: e.message }); }
        });
        if (fs.existsSync(CLIENT_DIST)) expressApp.use(express.static(CLIENT_DIST));
    },
});

const reporter = installStatReporter();
process.once('beforeExit', () => { reporter.flush(); });

// 2599 locally so this game can run beside the other Legion games; Legion sets PORT
listen(app, Number(process.env.PORT) || 2599);
