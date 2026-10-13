// Local mirror of this player's progress. The server owns the real values:
// public stats arrive through the room state, private ones in "profile" messages.
export const S = {
    speed: 0, wins: 0, totalWins: 0, level: 1, xp: 0, rebirths: 0, friends: 0,
    shoes: {}, shoe: '', treads: {}, trail: 'starter', treadSteps: 0,
    pass2x: false, boostUntil: 0, customSpeed: 0, starterPack: false,
    maxStage: 0, escaped: 0, quest: 0, daily: null, chestAt: 0,
    firstPlay: Date.now(), freeClaimed: {}, joinedAt: Date.now(), name: '',
};

// Game actions that world objects (pads, shoe stands, chests) trigger; filled in by main.js / ui.js
export const actions = {};

export const net = {
    room: null,
    offset: 0,
    send(type, msg) { if (this.room) this.room.send(type, msg || {}); },
    // Server clock in ms, so hazards, events and timers line up for everyone
    now() { return Date.now() + this.offset; },
};
