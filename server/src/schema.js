import { schema, t } from '@colyseus/schema';

// Public, synced to every client. Private progress (owned shoes, treadmills, daily streak...)
// is sent only to its owner with the "profile" message.
export const PlayerState = schema({
    name: t.string().default(''),
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    ry: t.angle(),
    // 0 idle, 1 run, 2 air, 3 dead, 4 slide, 5/6 wall run (wall on -x / +x), 7 climb, 8 swing,
    // 9 dash, 10 double jump flip, 11 super jump
    anim: t.uint8().default(0),
    speed: t.number().default(0),
    wins: t.number().default(0),
    level: t.uint16().default(1),
    xp: t.number().default(0),
    rebirths: t.uint16().default(0),
    shoe: t.string().default(''),
    trail: t.string().default(''),
    friends: t.uint8().default(0), // Friend Boost: Bloxity friends in this server
    kit: t.uint8().default(0),
    skin: t.uint8().default(0),
    av: t.string().default(''), // packed Bloxity avatar (equipped ids + proportions)
}, 'PlayerState');

export const GameState = schema({
    players: t.map(PlayerState),
}, 'GameState');
