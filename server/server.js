'use strict';

/**
 * DiceMon Arena server.
 *
 * - Serves the static build in ../build
 * - Runs authoritative WebSocket matches on /ws
 * - Supports quick match, private room codes, bot practice, rematches,
 *   emotes, turn timers and reconnects.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const game = require('./game');

const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || '0.0.0.0';
const BUILD_DIR = path.join(__dirname, '..', 'build');
const TURN_MS = 30000;
const DISCONNECT_GRACE_MS = 20000;
const ROOM_TTL_MS = 15 * 60 * 1000;
const MATCH_TTL_MS = 10 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';

// A small, hand-tuned roster so bot practice has variety without depending on
// a third-party API call at match time.
const BOT_ROSTER = [
  { name: 'Charizard', id: 6, types: ['fire', 'flying'], stats: { hp: 78, attack: 84, defense: 78, specialAttack: 109, specialDefense: 85, speed: 100 } },
  { name: 'Blastoise', id: 9, types: ['water'], stats: { hp: 79, attack: 83, defense: 100, specialAttack: 85, specialDefense: 105, speed: 78 } },
  { name: 'Venusaur', id: 3, types: ['grass', 'poison'], stats: { hp: 80, attack: 82, defense: 83, specialAttack: 100, specialDefense: 100, speed: 80 } },
  { name: 'Pikachu', id: 25, types: ['electric'], stats: { hp: 45, attack: 55, defense: 40, specialAttack: 65, specialDefense: 50, speed: 90 } },
  { name: 'Machamp', id: 68, types: ['fighting'], stats: { hp: 90, attack: 130, defense: 80, specialAttack: 65, specialDefense: 85, speed: 55 } },
  { name: 'Alakazam', id: 65, types: ['psychic'], stats: { hp: 55, attack: 50, defense: 45, specialAttack: 135, specialDefense: 95, speed: 120 } },
  { name: 'Gengar', id: 94, types: ['ghost', 'poison'], stats: { hp: 60, attack: 65, defense: 60, specialAttack: 130, specialDefense: 75, speed: 110 } },
  { name: 'Snorlax', id: 143, types: ['normal'], stats: { hp: 160, attack: 110, defense: 65, specialAttack: 65, specialDefense: 110, speed: 30 } },
  { name: 'Gyarados', id: 130, types: ['water', 'flying'], stats: { hp: 95, attack: 125, defense: 79, specialAttack: 60, specialDefense: 100, speed: 81 } },
  { name: 'Dragonite', id: 149, types: ['dragon', 'flying'], stats: { hp: 91, attack: 134, defense: 95, specialAttack: 100, specialDefense: 100, speed: 80 } },
];

function pickBotMon(playerMon) {
  const template = BOT_ROSTER[Math.floor(Math.random() * BOT_ROSTER.length)];
  const baseLevel = playerMon && playerMon.level ? playerMon.level : 1;
  const level = Math.max(1, Math.min(50, baseLevel + Math.floor(Math.random() * 3) - 1));
  const shiny = Math.random() < 0.08;
  return {
    ...template,
    level,
    shiny,
    sprite: `${SPRITE_BASE}/${shiny ? 'shiny/' : ''}${template.id}.png`,
  };
}

// ---------------------------------------------------------------------------
// Static file server
// ---------------------------------------------------------------------------

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method not allowed');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }

  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      ok: true,
      online: connectedClients.size,
      matches: matches.size,
      queued: queue.length,
      rooms: rooms.size,
      uptime: Math.round(process.uptime()),
      version: '1.0.0',
    }));
    return;
  }

  if (pathname === '/') {
    res.writeHead(302, { Location: '/html/homePage.html' });
    res.end();
    return;
  }

  const filePath = path.normalize(path.join(BUILD_DIR, pathname));
  if (!filePath.startsWith(BUILD_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>404</h1><p>That page rolled a natural 1.</p><p><a href="/">Back to DiceMon Arena</a></p>');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache',
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(serveStatic);

// ---------------------------------------------------------------------------
// Realtime game state
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
const connectedClients = new Set();
const matches = new Map();
const rooms = new Map();
const queue = [];
let clientSeq = 0;
let matchSeq = 0;

function makeId(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let code = '';
    for (let i = 0; i < 4; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!rooms.has(code)) return code;
  }
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

function send(ws, message) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

function sendFighter(fighter, message) {
  if (!fighter || fighter.bot) return;
  send(fighter.ws, message);
}

function onlineCount() {
  return connectedClients.size;
}

function broadcastOnline() {
  const payload = { type: 'online', count: onlineCount() };
  for (const client of connectedClients) send(client.ws, payload);
}

function activeMatchFor(client) {
  const match = client.match;
  if (!match) return null;
  if (match.phase !== 'battle' && match.phase !== 'ended') return null;
  return match;
}

function otherSide(side) {
  return side === 'a' ? 'b' : 'a';
}

function fighterState(match, side) {
  const fighter = match[side];
  const foe = match[otherSide(side)];
  return {
    you: game.publicFighter(fighter),
    foe: game.publicFighter(foe),
    youActed: Boolean(fighter.action),
    foeActed: Boolean(foe.action),
  };
}

function sendMatch(match, options = {}) {
  for (const side of ['a', 'b']) {
    const fighter = match[side];
    const state = fighterState(match, side);
    sendFighter(fighter, {
      type: 'match',
      matchId: match.id,
      mode: match.mode,
      side,
      round: match.round,
      deadline: match.deadline,
      rematch: Boolean(options.rematch),
      ...state,
    });
  }
}

function clearTimers(match) {
  for (const key of ['turnTimer', 'botTimer', 'resolveTimer', 'disconnectTimer', 'cleanupTimer']) {
    if (match[key]) {
      clearTimeout(match[key]);
      match[key] = null;
    }
  }
}

function scheduleCleanup(match) {
  if (match.cleanupTimer) clearTimeout(match.cleanupTimer);
  match.cleanupTimer = setTimeout(() => {
    matches.delete(match.id);
  }, MATCH_TTL_MS);
}

function detachClient(client, reason) {
  if (!client.match) return;
  const match = client.match;
  const side = client.side;
  const fighter = match[side];
  if (!fighter) return;

  if (match.phase === 'battle') {
    fighter.connected = false;
    fighter.ws = null;
    sendFighter(match[otherSide(side)], {
      type: 'opponent-left',
      grace: Math.round(DISCONNECT_GRACE_MS / 1000),
      message: `${fighter.name} lost connection…`,
    });
    if (match.disconnectTimer) clearTimeout(match.disconnectTimer);
    match.disconnectTimer = setTimeout(() => {
      if (match.phase !== 'battle' || fighter.connected) return;
      endMatch(match, otherSide(side), 'disconnect', []);
    }, DISCONNECT_GRACE_MS);
  }
  client.match = null;
  client.side = null;
}

function endMatch(match, winner, reason, events) {
  if (match.phase === 'ended') return;
  match.phase = 'ended';
  match.winner = winner;
  clearTimers(match);

  const winnerKey = winner === 'draw' ? 'draw' : winner;
  const rewards = game.matchRewards(winnerKey, match.mode === 'bot' ? 'bot' : 'pvp');

  for (const side of ['a', 'b']) {
    const fighter = match[side];
    const state = fighterState(match, side);
    sendFighter(fighter, {
      type: 'end',
      matchId: match.id,
      side,
      winner: winner === 'draw' ? 'draw' : winner === side ? 'you' : 'foe',
      reason,
      events: events || [],
      rewards,
      ...state,
    });
  }

  scheduleCleanup(match);
}

function maybeResolve(match) {
  if (!match || match.phase !== 'battle') return;
  if (!match.a.action || !match.b.action) return;
  if (match.resolveTimer) return;

  if (match.turnTimer) {
    clearTimeout(match.turnTimer);
    match.turnTimer = null;
  }
  if (match.botTimer) {
    clearTimeout(match.botTimer);
    match.botTimer = null;
  }

  match.resolveTimer = setTimeout(() => {
    match.resolveTimer = null;
    if (match.phase !== 'battle') return;

    const { events, winner } = game.resolveRound(match);

    if (winner) {
      endMatch(match, winner, 'ko', events);
      return;
    }

    match.deadline = Date.now() + TURN_MS;
    for (const side of ['a', 'b']) {
      const fighter = match[side];
      const state = fighterState(match, side);
      sendFighter(fighter, {
        type: 'round',
        matchId: match.id,
        side,
        round: match.round,
        deadline: match.deadline,
        events,
        ...state,
      });
    }
    scheduleRound(match);
  }, 420);
}

function scheduleBot(match) {
  if (!match.b.bot || match.phase !== 'battle') return;
  if (match.botTimer) clearTimeout(match.botTimer);
  match.botTimer = setTimeout(() => {
    match.botTimer = null;
    if (match.phase !== 'battle' || match.b.action) return;
    match.b.action = game.chooseBotAction(match, 'b');
    maybeResolve(match);
  }, 900 + Math.random() * 1200);
}

function scheduleRound(match) {
  clearTimeout(match.turnTimer);
  match.turnTimer = setTimeout(() => {
    match.turnTimer = null;
    if (match.phase !== 'battle') return;

    const timedOut = [];
    for (const side of ['a', 'b']) {
      if (!match[side].action) {
        match[side].action = 'strike';
        timedOut.push(side);
      }
    }
    if (timedOut.length) {
      for (const side of ['a', 'b']) {
        sendFighter(match[side], {
          type: 'notice',
          message: timedOut.length === 1 ? 'Time up — auto-strike!' : 'Time up — both auto-strike!',
        });
      }
    }
    maybeResolve(match);
  }, Math.max(1000, match.deadline - Date.now()));

  scheduleBot(match);
}

function prepareRound(match) {
  match.deadline = Date.now() + TURN_MS;
  sendMatch(match, { rematch: match.round === 1 && match.rematchFlag });
  scheduleRound(match);
}

function createMatch(aClient, aMon, bClient, bMon, options = {}) {
  const id = `m${(matchSeq += 1)}`;
  const aFighter = game.createFighter({
    mon: aMon,
    name: aClient ? aClient.name : 'Trainer',
    token: aClient ? aClient.token : crypto.randomUUID(),
    id: aClient ? aClient.id : `bot-${id}`,
  });
  const bFighter = game.createFighter({
    mon: bMon,
    name: bClient ? bClient.name : (options.botName || 'Wild BOT'),
    token: bClient ? bClient.token : `bot-${id}`,
    id: bClient ? bClient.id : `bot-${id}`,
  });

  aFighter.ws = aClient ? aClient.ws : null;
  bFighter.ws = bClient ? bClient.ws : null;
  aFighter.bot = !aClient;
  bFighter.bot = !bClient;

  const match = {
    id,
    mode: bClient ? 'pvp' : 'bot',
    round: 1,
    phase: 'battle',
    winner: null,
    rematchFlag: false,
    a: aFighter,
    b: bFighter,
    turnTimer: null,
    botTimer: null,
    resolveTimer: null,
    disconnectTimer: null,
    cleanupTimer: null,
    createdAt: Date.now(),
    deadline: 0,
  };

  if (aClient) {
    aClient.match = match;
    aClient.side = 'a';
  }
  if (bClient) {
    bClient.match = match;
    bClient.side = 'b';
  }

  matches.set(id, match);
  prepareRound(match);
  return match;
}

function resetMatch(match) {
  if (match.phase !== 'ended') return;
  clearTimers(match);
  match.phase = 'battle';
  match.winner = null;
  match.round = 1;
  match.rematchFlag = true;
  game.resetFighter(match.a);
  game.resetFighter(match.b);
  prepareRound(match);
}

function findMatchByToken(token) {
  if (!token) return null;
  for (const match of matches.values()) {
    if (match.phase !== 'battle') continue;
    for (const side of ['a', 'b']) {
      const fighter = match[side];
      if (!fighter.bot && fighter.token === token) return { match, side };
    }
  }
  return null;
}

function attachClientToMatch(client, match, side) {
  const fighter = match[side];
  const oldSocket = fighter.ws;
  if (oldSocket && oldSocket !== client.ws) {
    const oldClient = oldSocket.client;
    if (oldClient && oldClient !== client) {
      oldClient.match = null;
      oldClient.side = null;
    }
    if (oldSocket.readyState === WebSocket.OPEN) {
      try {
        oldSocket.close(4001, 'Reconnected elsewhere');
      } catch {
        /* ignore */
      }
    }
  }

  fighter.ws = client.ws;
  fighter.connected = true;
  client.match = match;
  client.side = side;
  if (match.disconnectTimer) {
    clearTimeout(match.disconnectTimer);
    match.disconnectTimer = null;
  }

  if (match.phase === 'battle') {
    const state = fighterState(match, side);
    sendFighter(fighter, {
      type: 'match',
      matchId: match.id,
      mode: match.mode,
      side,
      round: match.round,
      deadline: match.deadline,
      rematch: false,
      resumed: true,
      ...state,
    });
    sendFighter(match[otherSide(side)], {
      type: 'opponent-back',
      message: `${fighter.name} reconnected!`,
    });
  }
}

function removeFromQueue(client) {
  const index = queue.findIndex((entry) => entry.client === client);
  if (index >= 0) queue.splice(index, 1);
}

function tryPairQueue() {
  for (let i = 0; i < queue.length; i += 1) {
    for (let j = i + 1; j < queue.length; j += 1) {
      const first = queue[i];
      const second = queue[j];
      if (!first.client.match && !second.client.match) {
        queue.splice(j, 1);
        queue.splice(i, 1);
        createMatch(first.client, first.mon, second.client, second.mon);
        return true;
      }
    }
  }
  return false;
}

function dropRoomForClient(client) {
  if (client.pendingRoom && rooms.has(client.pendingRoom)) {
    rooms.delete(client.pendingRoom);
  }
  client.pendingRoom = null;
}

function cleanupRoom(room) {
  rooms.delete(room.code);
  if (room.hostClient.pendingRoom === room.code) room.hostClient.pendingRoom = null;
}

function handleMessage(client, raw) {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    send(client.ws, { type: 'error', message: 'That message was not valid JSON.' });
    return;
  }
  if (!message || typeof message !== 'object') return;

  switch (message.type) {
    case 'hello': {
      client.name = String(message.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 18) || client.name;
      if (typeof message.token === 'string' && message.token.length >= 6) {
        client.token = message.token.slice(0, 64);
      }
      send(client.ws, {
        type: 'welcome',
        id: client.id,
        token: client.token,
        name: client.name,
        online: onlineCount(),
      });

      if (!client.match) {
        const found = findMatchByToken(client.token);
        if (found && found.match[found.side].connected === false) {
          attachClientToMatch(client, found.match, found.side);
        } else if (found && found.match[found.side].ws !== client.ws) {
          attachClientToMatch(client, found.match, found.side);
        }
      }
      break;
    }

    case 'queue': {
      if (client.match) {
        send(client.ws, { type: 'error', message: 'You are already in a match.' });
        return;
      }
      dropRoomForClient(client);
      removeFromQueue(client);
      queue.push({ client, mon: game.sanitizeMon(message.mon), queuedAt: Date.now() });
      send(client.ws, { type: 'queue', status: 'searching', position: queue.length });
      tryPairQueue();
      break;
    }

    case 'dequeue': {
      removeFromQueue(client);
      send(client.ws, { type: 'queue', status: 'idle' });
      break;
    }

    case 'create-room': {
      if (client.match) {
        send(client.ws, { type: 'error', message: 'You are already in a match.' });
        return;
      }
      removeFromQueue(client);
      dropRoomForClient(client);
      const code = makeRoomCode();
      const room = {
        code,
        hostClient: client,
        mon: game.sanitizeMon(message.mon),
        createdAt: Date.now(),
      };
      rooms.set(code, room);
      client.pendingRoom = code;
      send(client.ws, { type: 'room', status: 'waiting', code });
      break;
    }

    case 'join-room': {
      if (client.match) {
        send(client.ws, { type: 'error', message: 'You are already in a match.' });
        return;
      }
      const code = String(message.code || '').trim().toUpperCase().slice(0, 4);
      const room = rooms.get(code);
      if (!room) {
        send(client.ws, { type: 'error', message: 'Room not found. Check the code!' });
        return;
      }
      if (room.hostClient === client) {
        send(client.ws, { type: 'error', message: 'That is your own room.' });
        return;
      }
      cleanupRoom(room);
      createMatch(room.hostClient, room.mon, client, game.sanitizeMon(message.mon));
      break;
    }

    case 'cancel-room': {
      dropRoomForClient(client);
      send(client.ws, { type: 'room', status: 'idle' });
      break;
    }

    case 'bot': {
      if (client.match) {
        send(client.ws, { type: 'error', message: 'You are already in a match.' });
        return;
      }
      removeFromQueue(client);
      dropRoomForClient(client);
      const playerMon = game.sanitizeMon(message.mon);
      createMatch(client, playerMon, null, pickBotMon(playerMon), {
        botName: 'Wild BOT',
      });
      break;
    }

    case 'action': {
      const match = activeMatchFor(client);
      if (!match || match.phase !== 'battle') {
        send(client.ws, { type: 'error', message: 'No active battle.' });
        return;
      }
      const action = String(message.action || '');
      if (!game.ACTIONS.has(action)) {
        send(client.ws, { type: 'error', message: 'Unknown move.' });
        return;
      }
      const fighter = match[client.side];
      if (fighter.action) {
        send(client.ws, { type: 'error', message: 'You already locked in this round.' });
        return;
      }
      if (action === 'blast' && fighter.energy < 2) {
        send(client.ws, { type: 'error', message: 'Not enough energy for Blast. Try Strike or Guard.' });
        return;
      }

      fighter.action = action;
      send(client.ws, {
        type: 'action-ack',
        action,
        youActed: true,
        foeActed: Boolean(match[otherSide(client.side)].action),
        energy: fighter.energy,
        deadline: match.deadline,
      });
      maybeResolve(match);
      break;
    }

    case 'emote': {
      const match = client.match;
      if (!match || !match.phase) return;
      const allowed = new Set(['nice', 'oops', 'fire', 'gg', 'wow']);
      if (!allowed.has(message.id)) return;
      const now = Date.now();
      const fighter = match[client.side];
      if (!fighter || now - fighter.emoteAt < 1800) return;
      fighter.emoteAt = now;
      sendFighter(match[otherSide(client.side)], {
        type: 'emote',
        from: 'foe',
        id: message.id,
      });
      break;
    }

    case 'rematch': {
      const match = client.match;
      if (!match || match.phase !== 'ended') {
        send(client.ws, { type: 'error', message: 'No finished match to rematch.' });
        return;
      }
      const fighter = match[client.side];
      const foe = match[otherSide(client.side)];
      fighter.rematch = true;

      if (match.mode === 'bot') {
        resetMatch(match);
        return;
      }

      if (foe.rematch) {
        resetMatch(match);
      } else {
        sendFighter(client.ws, { type: 'rematch', status: 'requested' });
        sendFighter(foe, { type: 'rematch', status: 'challenge', from: fighter.name });
      }
      break;
    }

    case 'leave': {
      removeFromQueue(client);
      dropRoomForClient(client);
      const match = client.match;
      if (match) {
        if (match.phase === 'battle') {
          endMatch(match, otherSide(client.side), 'forfeit', []);
        }
        client.match = null;
        client.side = null;
      }
      send(client.ws, { type: 'left' });
      break;
    }

    case 'ping': {
      send(client.ws, { type: 'pong', at: Date.now() });
      break;
    }

    default:
      send(client.ws, { type: 'error', message: 'Unknown message type.' });
  }
}

// ---------------------------------------------------------------------------
// Socket lifecycle
// ---------------------------------------------------------------------------

wss.on('connection', (ws) => {
  clientSeq += 1;
  const client = {
    id: `c${clientSeq}`,
    token: crypto.randomUUID(),
    name: `Trainer ${clientSeq}`,
    ws,
    match: null,
    side: null,
    pendingRoom: null,
    isAlive: true,
  };
  connectedClients.add(client);
  ws.client = client;

  send(ws, {
    type: 'welcome',
    id: client.id,
    token: client.token,
    name: client.name,
    online: onlineCount(),
  });
  broadcastOnline();

  ws.on('message', (raw) => handleMessage(client, raw));

  ws.on('pong', () => {
    client.isAlive = true;
  });

  ws.on('close', () => {
    connectedClients.delete(client);
    removeFromQueue(client);
    dropRoomForClient(client);
    detachClient(client, 'disconnect');
    broadcastOnline();
  });

  ws.on('error', () => {
    /* close handler does the cleanup */
  });
});

const heartbeat = setInterval(() => {
  for (const client of connectedClients) {
    if (client.isAlive === false) {
      try {
        client.ws.terminate();
      } catch {
        /* ignore */
      }
      continue;
    }
    client.isAlive = false;
    try {
      client.ws.ping();
    } catch {
      /* ignore */
    }
  }
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.createdAt > ROOM_TTL_MS) {
      rooms.delete(code);
      send(room.hostClient.ws, { type: 'room', status: 'expired' });
    }
  }
}, 60000).unref();

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  🎲 DiceMon Arena is live');
  console.log(`  ➜  http://localhost:${PORT}/`);
  console.log(`  ➜  WebSocket ws://localhost:${PORT}/ws`);
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\nShutting down DiceMon Arena…');
  clearInterval(heartbeat);
  for (const client of connectedClients) {
    try {
      client.ws.close(1001, 'Server shutting down');
    } catch {
      /* ignore */
    }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
});

process.on('SIGTERM', () => {
  process.emit('SIGINT');
});

module.exports = { server, wss };
