# 🎲 DiceMon Arena

A real-time multiplayer dice-battle game built on top of a Pokémon collection
page. Roll for DiceMon, build a roster, then duel other trainers (or the wild
BOT) in simultaneous-choice, server-authoritative battles.

The original static page is still there — the Gameboy-style collector — but now
it feeds a live battle arena.

![Node](https://img.shields.io/badge/node-%3E%3D18-339933) ![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6) ![WebSocket](https://img.shields.io/badge/realtime-WebSocket-ffcb57)

---

## Quick start

```bash
npm install      # installs ws + typescript
npm start        # compiles TypeScript, then serves on http://localhost:8000
```

Open <http://localhost:8000/> in two browser tabs (or two devices on your LAN)
to test multiplayer.

| Script | What it does |
| --- | --- |
| `npm run build` | Compile `src/*.ts` to `build/js/` |
| `npm start` | `npm run build` + start the game server |
| `npm run test:ws` | End-to-end WebSocket tests (server must be running) |

Environment variables: `PORT` (default `8000`) and `HOST` (default `0.0.0.0`).

---

## Features

### 🧬 Collection
- Roll a random Pokémon from the [PokeAPI](https://pokeapi.co) (1,025 species).
- **8% shiny chance** (20% with a Lucky Roll), full stat display, rarity tiers,
  type chips, search by name or type, and keyboard support (`R` to roll).
- Pick any DiceMon as your active fighter. The choice carries into the arena.

### ⚔️ Battles
- **Quick Match** — automatic matchmaking against another connected trainer.
- **Private Rooms** — create a 4-character room code and share it with a friend.
- **Wild BOT** — instant practice match against an AI with its own roster.
- **Rematches** — request one more duel from the result screen.
- **Emotes**, a live battle log, round timer, reconnects, and forfeits.
- 30-second turn timer with automatic strike if you run out of time.

### 📈 Progression
- Trainer level and XP, coins, win/loss record, and win streaks (with bonuses).
- Coins can be spent on a **Lucky Roll** (120 🪙) for a guaranteed strong
  DiceMon from a curated high-BST pool and a higher shiny chance.
- Progression is stored locally in `localStorage` and shared by both pages.

---

## How to play

Every round both trainers secretly choose an action. When both lock in, the
server resolves the round and streams a timeline of events for the client to
animate.

| Action | Cost | Effect |
| --- | --- | --- |
| ⚔️ **Strike** | free | Roll a d6 (`roll + 4` power). Reliable physical damage. |
| 🔥 **Blast** | 2 ⚡ | Roll a d10 (`roll + 7` power). Special damage. |
| 🛡️ **Guard** | free | Heal 6% max HP, gain 1 ⚡, and take 55% less damage this round. |
| 🧠 **Focus** | free | Gain 2 ⚡ and charge your next attack for 1.5× damage — but take 25% more damage this round. |

- Each DiceMon has **5 energy** (starts at 2, +1 per round).
- **Speed** decides who acts first.
- A **natural max roll** is a critical hit (1.8× damage).
- **Type effectiveness** and same-type attack bonus (1.15×) apply. Your primary
  type powers Strike; your secondary type powers Blast.
- Drain your rival's HP to win. If both faint, it's a draw.
- Keyboard shortcuts: `1` Strike, `2` Blast, `3` Guard, `4` Focus.

### Modes and rewards

| Mode | Win | Loss |
| --- | --- | --- |
| Ranked (Quick Match / Rooms) | 70 🪙 + 55 XP | 18 🪙 + 22 XP |
| Practice vs BOT | 35 🪙 + 28 XP | 8 🪙 + 10 XP |

Win streaks add `5 × streak` bonus coins and `3 × streak` bonus XP. Level-ups
grant 60 bonus coins.

---

## Project structure

```
server/
  server.js      HTTP static server + authoritative WebSocket match server
  game.js        Battle rules, type chart, bot AI, rewards, sanitisation
src/
  homeScript.ts  Collection, rolling, selection, search, trainer HUD
  battlePage.ts  Lobby, matchmaking, live battle playback, progression
build/
  html/          Page markup
  styles/        Collection + arena styling
  js/            Compiled TypeScript (do not edit by hand)
  Images/        Original artwork
test/
  ws-smoke.js    Multiplayer end-to-end tests
```

### Real-time protocol

All messages are JSON over `ws://<host>/ws`.

Client → server: `hello`, `queue`, `dequeue`, `create-room`, `join-room`,
`cancel-room`, `bot`, `action`, `emote`, `rematch`, `leave`, `ping`.

Server → client: `welcome`, `online`, `queue`, `room`, `match`, `round`,
`action-ack`, `end`, `emote`, `notice`, `opponent-left`, `opponent-back`,
`rematch`, `left`, `error`, `pong`.

The server owns HP, energy, dice rolls, damage, turn order, and rewards. Clients
only send their chosen action, so the result cannot be tampered with from the
browser.

---

## Testing

With the server running:

```bash
npm run test:ws
```

Covers quick match + round resolution + rewards, private rooms + forfeit, bot
practice + rematch, and Focus/Guard statuses. The test client drives both
players in parallel so rounds resolve immediately.

For a quick manual check:

```bash
curl http://localhost:8000/health
```

---

## Notes

- Sprites and species data come from the PokeAPI / PokeAPI sprites repositories.
- Trainer identity is a random token kept in `localStorage`; there are no
  accounts, passwords, or server-side persistence.
- Multiple tabs in the same browser share the same trainer token and may
  reconnect to the same match. Use two different browsers or profiles for
  local PvP testing.
- The server also serves the original static collection page, so the project
  still works as a simple Pokédex collector if you never enter the arena.
