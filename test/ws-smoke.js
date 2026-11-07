'use strict';

/**
 * End-to-end WebSocket smoke test for DiceMon Arena.
 * Run with the server already listening: `npm run test:ws`
 */

const { WebSocket } = require('ws');

const URL = process.env.WS_URL || 'ws://localhost:8000/ws';
const TIMEOUT = 8000;

function makeClient(name) {
  const ws = new WebSocket(URL);
  const inbox = [];
  const waiters = [];

  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (process.env.WS_DEBUG) {
      console.log(
        `${name} <- ${message.type}${message.round !== undefined ? ` r${message.round}` : ''}` +
        `${message.action ? ` ${message.action}` : ''}${message.message ? ` (${message.message})` : ''}`,
      );
    }
    for (let index = 0; index < waiters.length; index += 1) {
      const waiter = waiters[index];
      if (waiter.predicate(message)) {
        waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
        return;
      }
    }
    inbox.push(message);
  });

  function wait(predicate, label = 'message', timeout = TIMEOUT) {
    const existingIndex = inbox.findIndex(predicate);
    if (existingIndex >= 0) {
      return Promise.resolve(inbox.splice(existingIndex, 1)[0]);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = waiters.findIndex((entry) => entry.timer === timer);
        if (pending >= 0) waiters.splice(pending, 1);
        reject(new Error(`[${name}] timed out waiting for ${label}`));
      }, timeout);
      waiters.push({ predicate, resolve, timer });
    });
  }

  function send(message) {
    ws.send(JSON.stringify(message));
  }

  function open() {
    return new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
  }

  async function hello() {
    await open();
    send({ type: 'hello', name });
    return wait((message) => message.type === 'welcome', 'welcome');
  }

  return { name, ws, wait, send, hello };
}

function mon(name, type, stats) {
  return {
    name,
    sprite: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png',
    types: [type, type],
    level: 1,
    stats: stats || {
      hp: 70,
      attack: 80,
      defense: 70,
      specialAttack: 80,
      specialDefense: 70,
      speed: 80,
    },
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function playToEnd(client, firstMessage, pickAction) {
  let message = firstMessage;
  let guard = 0;
  while (message.type !== 'end') {
    assert(message.type === 'round' || message.type === 'match', `${client.name} expected round/match, got ${message.type}`);
    guard += 1;
    if (guard > 60) throw new Error('Battle exceeded 60 rounds');
    assert(message.you && message.foe, 'round includes both fighters');
    assert(message.you.hp >= 0 && message.foe.hp >= 0, 'hp never negative');
    assert(message.you.energy >= 0 && message.you.energy <= 5, 'energy bounded');
    const action = pickAction(message);
    client.send({ type: 'action', action });
    message = await client.wait(
      (incoming) => incoming.type === 'round' || incoming.type === 'end',
      'next round/end',
    );
  }
  return message;
}

async function testQuickMatch() {
  const a = makeClient('Alpha');
  const b = makeClient('Beta');
  await Promise.all([a.hello(), b.hello()]);

  a.send({ type: 'queue', mon: mon('Sparky', 'electric') });
  b.send({ type: 'queue', mon: mon('Aqua', 'water') });
  const [matchA, matchB] = await Promise.all([
    a.wait((message) => message.type === 'match', 'match A'),
    b.wait((message) => message.type === 'match', 'match B'),
  ]);
  assert(matchA.matchId === matchB.matchId, 'both players share a match id');
  assert(matchA.side !== matchB.side, 'players have opposite sides');
  assert(matchA.mode === 'pvp', 'quick match is pvp');

  // First round actions: strike vs guard to exercise both paths.
  a.send({ type: 'action', action: 'strike' });
  b.send({ type: 'action', action: 'guard' });

  const [nextA, nextB] = await Promise.all([
    a.wait((message) => message.type === 'round' || message.type === 'end', 'round A'),
    b.wait((message) => message.type === 'round' || message.type === 'end', 'round B'),
  ]);
  assert(Array.isArray(nextA.events) && nextA.events.length > 0, 'round has events');
  assert(nextA.events.some((event) => event.kind === 'guard'), 'guard event is present');
  assert(nextA.events.length === nextB.events.length, 'both clients receive the same timeline');

  const pick = (message) => (message.you.energy >= 2 ? 'blast' : 'strike');
  const [endA, endB] = await Promise.all([
    playToEnd(a, nextA, pick),
    playToEnd(b, nextB, pick),
  ]);
  assert(endA.winner === endB.winner || (endA.winner === 'you' && endB.winner === 'foe') || (endA.winner === 'foe' && endB.winner === 'you'), 'winner is consistent');
  assert(endA.rewards && endA.rewards.coins > 0, 'rewards are sent');
  assert(endA.events.some((event) => event.kind === 'end'), 'end event is present');

  a.ws.close();
  b.ws.close();
  console.log('  ✓ quick match, round resolution and rewards');
}

async function testPrivateRoom() {
  const host = makeClient('Host');
  const guest = makeClient('Guest');
  await Promise.all([host.hello(), guest.hello()]);

  host.send({ type: 'create-room', mon: mon('Bulba', 'grass') });
  const room = await host.wait((message) => message.type === 'room', 'room');
  assert(room.code && room.code.length === 4, 'room has a 4-character code');

  guest.send({ type: 'join-room', code: room.code, mon: mon('Charm', 'fire') });
  const [matchHost, matchGuest] = await Promise.all([
    host.wait((message) => message.type === 'match', 'host match'),
    guest.wait((message) => message.type === 'match', 'guest match'),
  ]);
  assert(matchHost.matchId === matchGuest.matchId, 'room match is shared');
  assert(matchHost.mode === 'pvp', 'room match is pvp');

  // Forfeit ends the match immediately.
  guest.send({ type: 'leave' });
  const end = await host.wait((message) => message.type === 'end', 'forfeit end');
  assert(end.winner === 'you', 'host wins by forfeit');
  assert(end.reason === 'forfeit', 'forfeit reason is reported');

  host.ws.close();
  guest.ws.close();
  console.log('  ✓ private rooms, join and forfeit');
}

async function testBot() {
  const player = makeClient('Solo');
  await player.hello();
  player.send({ type: 'bot', mon: mon('Pika', 'electric') });
  const match = await player.wait((message) => message.type === 'match', 'bot match');
  assert(match.mode === 'bot', 'bot mode');
  assert(match.foe.name === 'Wild BOT', 'bot opponent name');
  assert(match.foe.mon.name, 'bot has a DiceMon');

  player.send({ type: 'action', action: 'strike' });
  let next = await player.wait((message) => message.type === 'round' || message.type === 'end', 'bot round');
  assert(next.events.some((event) => event.actor === 'b'), 'bot acted');
  const end = await playToEnd(player, next, (message) => (message.you.energy >= 2 ? 'blast' : 'strike'));
  assert(end.type === 'end', 'bot battle ends');
  assert(end.rewards.coins > 0, 'bot rewards are sent');

  // Rematch should immediately reset the same match.
  player.send({ type: 'rematch' });
  const rematch = await player.wait((message) => message.type === 'match', 'bot rematch');
  assert(rematch.matchId === match.matchId, 'bot rematch reuses the match');
  assert(rematch.rematch === true, 'rematch flag is set');

  player.ws.close();
  console.log('  ✓ bot practice, AI action and instant rematch');
}

async function testGuardsAndFocus() {
  const a = makeClient('Focuser');
  const b = makeClient('Guardian');
  await Promise.all([a.hello(), b.hello()]);
  a.send({ type: 'queue', mon: mon('Zap', 'electric') });
  b.send({ type: 'queue', mon: mon('Rocky', 'rock') });
  const [matchA] = await Promise.all([
    a.wait((message) => message.type === 'match', 'match'),
    b.wait((message) => message.type === 'match', 'match'),
  ]);

  a.send({ type: 'action', action: 'focus' });
  b.send({ type: 'action', action: 'guard' });
  const roundA = await a.wait((message) => message.type === 'round' || message.type === 'end', 'focus round');
  assert(roundA.events.some((event) => event.kind === 'focus'), 'focus event exists');
  assert(roundA.you.charged === true, 'focus grants charged status');
  assert(roundA.events.some((event) => event.kind === 'guard'), 'guard event exists');
  assert(roundA.you.energy >= 3, 'focus grants energy');

  a.ws.close();
  b.ws.close();
  console.log('  ✓ focus and guard statuses');
}

async function main() {
  console.log('DiceMon Arena WebSocket smoke test');
  await testQuickMatch();
  await testPrivateRoom();
  await testBot();
  await testGuardsAndFocus();
  console.log('All multiplayer tests passed.\n');
}

main().catch((error) => {
  console.error('\nTest failed:', error.message);
  process.exitCode = 1;
});
