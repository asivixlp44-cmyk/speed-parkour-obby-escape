# +1 Speed Parkour Obby Escape

A multiplayer "+1 Speed" parkour obby for the browser, built with **Three.js** and **Colyseus** for Bloxity. Every step gives +Speed, Speed fills your Level, and every level makes you run faster. Climb walls, swing on poles, wall-run over lava, Super Jump, Dash, Slide and Double Jump through 9 stages. It clones the Roblox game *[+1 Speed Parkour Obby Escape](https://www.roblox.com/games/133457381057432/1-Speed-Parkour-Obby-Escape)* (see `reference/Gameplay.mp4`).

**There are no in-app purchases.** Shoes, treadmills, the x2 Speed pass, the Speed packs and revives are all bought with **Wins**, which you get from the pads at the end of every stage.

It shares its engine with Backflip Keyboard Escape (server, profiles, saves, Bloxity login and avatars, effects). The parkour moves, the lavender hall, the 9 stages, the HUD and the soundtrack are new.

## Project layout

| Folder | What it is |
|---|---|
| `client/` | Vite + Three.js client: `main.js` (player, parkour moves, camera, network), `world.js` (lobby, 9 stages, hazards), `props.js` (shoes, trophies), `textures.js` (climb chevrons, arrow carpet, wall-run glass, lava), `ui.js` (HUD and panels), `audio.js` (music and sounds), `fx.js` (bloom, speed lines, dash and super-jump bursts) |
| `server/` | Colyseus 0.18 server: the `parkour` room (`ParkourRoom.js`), profiles, leaderboards, play stats |
| `shared/` | Game data and formulas used by both sides (`config.js`): stages, gaps, shoes, treadmills, trails, prices, levels |

## Run it locally

Needs Node 20 or newer. Double-click `start-local.bat`, or:

```sh
npm --prefix server install && npm --prefix client install
npm run build        # builds the client into client/dist
npm start            # server + game on http://localhost:2599
```

For development run `npm run dev:server` and `npm run dev:client`, then open the Vite URL (the client talks to the server on port 2599; `VITE_SERVER_URL` overrides that). Dev builds expose `window.__qa` for automated test runs (`__qa.sim` runs the game without rendering, `__qa.stage(i)` jumps to a stage).

## Gameplay (from the reference)

- **Every step is +Speed** ("👟+2" pops up beside you). Speed is also XP: Level 1 needs 12, then 14, 15, 17, 20 … 145 at Level 21 and 165 at Level 22 (as in the reference), then x1.135 a level. Each level is **+2 Speed** ("Level 17 > Level 18 / Speed 42 > Speed 44" under the stage bar). **Custom Speed** (top right) lets you run slower than your MAX.
- **Speed vs. movement**: up to 24 the Speed number is your run speed; above that it grows gently (44 Speed runs at 35 studs/s, 115 at 63), so the character stays easy to control. Every gap in the course is sized from this.
- **Tutorial** (the reference's top band): "Train on the treadmill! (0/10)" → "Get your first Win!" → "Buy a Shoe!". After it the stage bar (1-9 with everyone's heads), the left tiles and the right column appear, and the Daily Rewards pop up.
- **Moves** (the reference's Controls panel, bottom right, with cooldowns):
  - **Double Jump** (Space in the air, with a front flip)
  - **Super Jump** (F, from the ground: about 15 studs up and a push forward, 2 s cooldown)
  - **Dash** (E, on the ground or once per jump in the air, 1.5 s cooldown)
  - **Slide** (C or Shift: low enough to pass under the Slide Under walls)
  - **Climb**: walk into a red chevron wall. **Swing**: touch a white pole over the lava and you're spun round it and thrown forward. **Wall run**: jump at the blue glass walls; jump again to kick off. Let go of the keys in the air to stop and aim your landing.
- **9 stages in one long hall** north of the lobby. Each has a navy gate ("STAGE 4 / Slide Under! / ⚡ 44 Speed", green once you're fast enough) and ends on a platform with a **yellow Wins pad** and a **purple pad** across a lava gap, treadmills, and the next stage's gate. A pad pays out and sends you to the lobby. Fall in the lava or a pit, touch spikes, lasers or crushers and you go back to the lobby, or press **Revive? (6.0) ONLY 🏆N** to restart the stage you were on.

  | # | Stage | Obstacles (Stages 1-5 laid out as in the reference video) | Speed | Wins |
  |---|---|---|---|---|
  | 1 | Climb | red chevron climb wall just inside the door, then swing on the pole up onto the platform | 10 | 1 / 2 |
  | 2 | Wall Run & Super Jump | blue glass wall run over spiked lava, then "Press Super Jump!" up onto the platform | 24 | 4 / 10 |
  | 3 | Crushers | corridor of striped crushers on white pistons with spikes along the sides, lava edges, stairs, wall run | 34 | 8 / 20 |
  | 4 | Slide Under | slide through the STAGE 4 block, climb wall, step pyramid with a second Slide Under block, three Double Jump walls | 44 | 15 / 30 |
  | 5 | Laser Pillars | navy room of round pillars with red bands over a pit, red lasers sweeping up and down (jump when one drops) | 54 | 30 / 65 |
  | 6 | Crusher Run (night) | crushers, lava edges, zig-zag wall run, pole swing | 66 | 60 / 130 |
  | 7 | Slide & Climb (dusk) | Slide Under gate, tall climb wall, pyramid, four Double Jump walls | 80 | 125 / 260 |
  | 8 | Dash Across (neon) | longer laser pillar room, wall run, Super Jump | 96 | 250 / 500 |
  | 9 | Final Escape (gold) | 44-stud climb, zig-zag wall run, crushers, Double Jump walls, Super Jump, then **ESCAPE! +2.5K Wins** | 115 | 500 / 1K |

  Each stage ends on a platform with a yellow Wins pad on the floor and a purple pad up on a block (jump onto it), a paid treadmill and a TRAIN HERE one, and the next stage's navy gate.
  Hazards run on the server clock, so everyone sees the same thing. Every stage was played through by a scripted bot at exactly its recommended Speed. Each rebirth adds +25% Wins; Admin Abuse doubles them.
- **Lobby** (lavender hall, cyan arrow carpet to the red Stage 1 door, as in the reference):
  - **TRAIN SPEED** (right): free TRAIN HERE treadmills, the rebirth ones (x1.5, x2) and the paid x5 (15 Wins), x10 (60), x25 (250), x100 (2K) and x1000 (40K). Stand on an owned one and you run on your own; every step counts xN. Buying one unlocks it on the stage platforms too.
  - **WINS SHOP** (left): 12 shoes from "+1 Speed / 1 Wins Required" to Royal Gold (+500, 5.5K Wins). **OP Shoes!** by the door: Lucky (+50), Flame (+125), Dragon (+400); Hacker Shoes (+5K, 60K Wins) at the back.
  - The NEW UPD board with the Admin Abuse countdown, the OP REWARD chest (Like + Join Group!, daily), the Invite pad, Top Speed / Top Wins / Top Rebirths boards and the World 2 portal (2,500 Wins, next update).
- **HUD** (as in the reference): stage bar with players' heads at the top, Invite and sound top right, Wins and the TRAILS / REBIRTH / DAILY / Claim! tiles on the left, STARTER PACK countdown, Custom Speed and **x2 Speed ONLY 🏆25** on the right, Total Speed, Rebirth %, the Level bar and **+10k / +100k / +1M / +10M Speed** at the bottom, the Controls panel bottom right.
- **Prices in Wins**: x2 Speed forever (25), STARTER PACK (5 Wins for the first 12 minutes: Lucky Shoes, 15 min x2 Speed, +2.5K Speed), Speed packs +10k (30), +100k (250), +1M (2K), +10M (15K), revive (half the last stage's Wins).
- **Rebirth** from Level 25 (+5 per rebirth, up to 90): back to Level 1 for +50% Speed, +25% Wins and +2 Speed per level for good; unlocks trails and the rebirth treadmills.
- **Daily Rewards** as in the reference: +1 Win, 5k Speed, +100 Wins, 50k Speed, +500 Wins, 100k Speed, and the **SECRET Reward** on Day 7 (Galaxy Shoes, +2.5K). **Claim!** playtime rewards. **Admin Abuse** event every 30 minutes: 5 minutes of x2 Speed and x2 Wins. Friend Boost +10% per Bloxity friend in the server.
- **Soundtrack**: "Parkour Rush", an original code-generated 150 BPM electro-pop track in E minor with a rolling bass and a climbing lead hook. Footsteps, wall-run rush, swing whoosh, Super Jump boom and the classic "oof". No audio files.

## Controls

| Action | Keyboard / mouse | Controller | Touch |
|---|---|---|---|
| Move | WASD / arrows | Left stick | Joystick |
| Jump / Double Jump | Space (again in the air) | A | JUMP |
| Super Jump | F | Y | Controls panel |
| Dash | E | RB / LB | Controls panel |
| Slide | C or Shift | X | Controls panel |
| Camera | Drag, wheel to zoom | Right stick, D-pad zoom | Drag |

## Multiplayer and saves

- One shared `parkour` room (up to 24 players). Movement and hazards are client-side; Speed, Wins, levels, purchases, pads (position checks), revives and rebirths are decided by the server.
- Progress is saved per browser or per Bloxity account: MongoDB on Legion (`MONGODB_URI`), `server/data/profiles.json` locally, plus a signed backup in the browser.
- Play stats: `GET /api/stats?key=<stats key>&days=7` (the key is in `server/STATS_KEY.local.txt`, not in the repo; locally the stats are open).

## Deploy (Bloxity hosting)

Pushing `main` (prod) or `dev` runs `.github/workflows/deploy.yml`: server image `ghcr.io/asivixlp44-cmyk/speed-parkour-obby-escape-server`, Legion rollout, client upload. Play at https://speed-parkour-obby-escape.play.bloxity.io once the app `speed-parkour-obby-escape` exists on hosting.bloxity.io and the repo has the `LEGION_DEPLOY_TOKEN` secret.
