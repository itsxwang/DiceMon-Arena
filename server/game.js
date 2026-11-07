'use strict';

/**
 * DiceMon Arena — authoritative battle rules.
 *
 * Everything that decides the outcome of a match lives here on the server so
 * that clients cannot fudge dice rolls, stats or health values.
 */

const MAX_ENERGY = 5;
const START_ENERGY = 2;
const ACTIONS = new Set(['strike', 'blast', 'guard', 'focus']);
const STAB = 1.15;

const TYPE_CHART = {
  normal: { rock: 0.5, steel: 0.5, ghost: 0 },
  fire: { grass: 2, ice: 2, bug: 2, steel: 2, fire: 0.5, water: 0.5, rock: 0.5, dragon: 0.5 },
  water: { fire: 2, ground: 2, rock: 2, water: 0.5, grass: 0.5, dragon: 0.5 },
  electric: { water: 2, flying: 2, electric: 0.5, grass: 0.5, dragon: 0.5, ground: 0 },
  grass: { water: 2, ground: 2, rock: 2, fire: 0.5, grass: 0.5, poison: 0.5, flying: 0.5, bug: 0.5, dragon: 0.5, steel: 0.5 },
  ice: { grass: 2, ground: 2, flying: 2, dragon: 2, fire: 0.5, water: 0.5, ice: 0.5, steel: 0.5 },
  fighting: { normal: 2, ice: 2, rock: 2, dark: 2, steel: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, fairy: 0.5, ghost: 0 },
  poison: { grass: 2, fairy: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0 },
  ground: { fire: 2, electric: 2, poison: 2, rock: 2, grass: 0.5, bug: 0.5, flying: 0 },
  flying: { grass: 2, fighting: 2, bug: 2, electric: 0.5, rock: 0.5, steel: 0.5 },
  psychic: { fighting: 2, poison: 2, psychic: 0.5, steel: 0.5, dark: 0 },
  bug: { grass: 2, psychic: 2, dark: 2, fire: 0.5, fighting: 0.5, poison: 0.5, flying: 0.5, ghost: 0.5, steel: 0.5, fairy: 0.5 },
  rock: { fire: 2, ice: 2, flying: 2, bug: 2, fighting: 0.5, ground: 0.5, steel: 0.5 },
  ghost: { psychic: 2, ghost: 2, dark: 0.5, normal: 0 },
  dragon: { dragon: 2, steel: 0.5, fairy: 0 },
  dark: { psychic: 2, ghost: 2, fighting: 0.5, dark: 0.5, fairy: 0.5 },
  steel: { ice: 2, rock: 2, fairy: 2, fire: 0.5, water: 0.5, electric: 0.5, steel: 0.5 },
  fairy: { fighting: 2, dragon: 2, dark: 2, fire: 0.5, poison: 0.5, steel: 0.5 },
};

const KNOWN_TYPES = Object.keys(TYPE_CHART);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function number(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cleanName(value, fallback) {
  const name = String(value || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 18);
  return name || fallback;
}

function cleanSprite(value) {
  const url = String(value || '');
  if (/^https:\/\/raw\.githubusercontent\.com\/PokeAPI\/sprites\//.test(url)) {
    return url.slice(0, 300);
  }
  return 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png';
}

/**
 * Turn untrusted client data into a safe, balanced fighter definition.
 */
function sanitizeMon(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const stats = source.stats && typeof source.stats === 'object' ? source.stats : {};

  let types = Array.isArray(source.types) ? source.types : source.type ? [source.type] : [];
  types = types
    .map((type) => String(type).toLowerCase())
    .filter((type) => KNOWN_TYPES.includes(type))
    .slice(0, 2);
  types = [...new Set(types)];
  if (types.length === 0) types = ['normal'];

  const stat = (key, fallback) => clamp(number(stats[key], fallback), 5, 255);

  return {
    name: cleanName(source.name, 'Mysterymon').slice(0, 20),
    sprite: cleanSprite(source.sprite),
    shiny: Boolean(source.shiny),
    types,
    level: clamp(Math.floor(number(source.level, 1)), 1, 50),
    stats: {
      hp: stat('hp', 60),
      attack: stat('attack', 60),
      defense: stat('defense', 60),
      specialAttack: stat('specialAttack', 60),
      specialDefense: stat('specialDefense', 60),
      speed: stat('speed', 60),
    },
  };
}

function createFighter({ mon, name, token, id }) {
  const safeMon = sanitizeMon(mon);
  const maxHp = Math.round(112 + safeMon.stats.hp * 0.78 + (safeMon.level - 1) * 1.6);

  return {
    id,
    token,
    name: cleanName(name, 'Trainer'),
    mon: safeMon,
    hp: maxHp,
    maxHp,
    energy: START_ENERGY,
    guarding: false,
    chargeBonus: false,
    vulnerable: false,
    action: null,
    connected: true,
    lastAction: null,
    rematch: false,
    emoteAt: 0,
  };
}

function resetFighter(fighter) {
  fighter.hp = fighter.maxHp;
  fighter.energy = START_ENERGY;
  fighter.guarding = false;
  fighter.chargeBonus = false;
  fighter.vulnerable = false;
  fighter.action = null;
  fighter.connected = true;
  fighter.lastAction = null;
  fighter.rematch = false;
  fighter.emoteAt = 0;
}

function levelMultiplier(mon) {
  return 1 + (mon.level - 1) * 0.008;
}

/**
 * Primary type powers physical strikes, secondary type powers special blasts.
 */
function attackType(mon, action) {
  if (action === 'blast' && mon.types.length > 1) return mon.types[1];
  return mon.types[0];
}

function typeMultiplier(attackingType, defenderTypes) {
  const row = TYPE_CHART[attackingType] || {};
  let multiplier = 1;
  for (const defenderType of defenderTypes) {
    const value = row[defenderType];
    if (value !== undefined) multiplier *= value;
  }
  return multiplier;
}

function effectivenessLabel(multiplier) {
  if (multiplier <= 0) return 'immune';
  if (multiplier >= 1.9) return 'super';
  if (multiplier <= 0.55) return 'weak';
  return 'normal';
}

function publicFighter(fighter) {
  return {
    name: fighter.name,
    mon: fighter.mon,
    hp: fighter.hp,
    maxHp: fighter.maxHp,
    energy: fighter.energy,
    guarding: fighter.guarding,
    charged: fighter.chargeBonus,
    connected: fighter.connected,
  };
}

/**
 * Resolve one simultaneous round. Both actions must already be set on the
 * fighters. Mutates the match and returns a timeline for the clients to play
 * back with animations.
 */
function resolveRound(match) {
  const order = ['a', 'b'];
  const events = [];
  const a = match.a;
  const b = match.b;
  const fighterOf = (key) => (key === 'a' ? a : b);
  const otherKey = (key) => (key === 'a' ? 'b' : 'a');

  // Normalise actions / fall back to strike.
  for (const key of order) {
    const fighter = fighterOf(key);
    if (!ACTIONS.has(fighter.action)) fighter.action = 'strike';
    fighter.lastAction = fighter.action;
  }

  // ------- Stance phase: guards, heals and focus charges happen first -------
  for (const key of order) {
    const fighter = fighterOf(key);
    fighter.guarding = false;
    fighter.vulnerable = false;

    if (fighter.action === 'guard') {
      fighter.guarding = true;
      const heal = Math.max(1, Math.round(fighter.maxHp * 0.06));
      const before = fighter.hp;
      fighter.hp = Math.min(fighter.maxHp, fighter.hp + heal);
      fighter.energy = Math.min(MAX_ENERGY, fighter.energy + 1);
      events.push({
        kind: 'guard',
        actor: key,
        heal: fighter.hp - before,
        energy: fighter.energy,
      });
    } else if (fighter.action === 'focus') {
      fighter.vulnerable = true;
      fighter.chargeBonus = true;
      fighter.energy = Math.min(MAX_ENERGY, fighter.energy + 2);
      events.push({ kind: 'focus', actor: key, energy: fighter.energy });
    }
  }

  // ------- Attack phase: faster DiceMon strikes first -------
  const speed = (key) => {
    const fighter = fighterOf(key);
    return fighter.mon.stats.speed * levelMultiplier(fighter.mon);
  };
  const turnOrder = speed('a') === speed('b')
    ? (Math.random() < 0.5 ? ['a', 'b'] : ['b', 'a'])
    : speed('a') > speed('b')
      ? ['a', 'b']
      : ['b', 'a'];

  for (const key of turnOrder) {
    const fighter = fighterOf(key);
    const foeKey = otherKey(key);
    const foe = fighterOf(foeKey);

    if (fighter.hp <= 0 || foe.hp <= 0) continue;
    if (fighter.action !== 'strike' && fighter.action !== 'blast') continue;

    let action = fighter.action;
    let energy = fighter.energy;

    if (action === 'blast' && energy < 2) {
      action = 'strike';
      events.push({ kind: 'no-energy', actor: key });
    }

    const sides = action === 'blast' ? 10 : 6;
    const roll = 1 + Math.floor(Math.random() * sides);
    const power = action === 'blast' ? roll + 7 : roll + 4;
    const attackStat = action === 'blast' ? 'specialAttack' : 'attack';
    const defenseStat = action === 'blast' ? 'specialDefense' : 'defense';

    if (action === 'blast') {
      fighter.energy = Math.max(0, fighter.energy - 2);
    }

    const attackValue = fighter.mon.stats[attackStat] * levelMultiplier(fighter.mon);
    const defenseValue = foe.mon.stats[defenseStat] * levelMultiplier(foe.mon);
    const attackingType = attackType(fighter.mon, action);

    let multiplier = typeMultiplier(attackingType, foe.mon.types) * STAB;
    const effectiveness = effectivenessLabel(multiplier);
    const crit = roll === sides;

    let damage = power * 2.45 * ((attackValue + 55) / (defenseValue + 55));
    if (crit) damage *= 1.8;
    if (fighter.chargeBonus) damage *= 1.5;
    if (foe.vulnerable) damage *= 1.25;
    if (foe.guarding) damage *= 0.45;
    damage *= multiplier;

    const charged = fighter.chargeBonus;
    fighter.chargeBonus = false;
    if (crit) fighter.energy = Math.min(MAX_ENERGY, fighter.energy + 1);

    const dealt = Math.max(1, Math.round(damage));
    foe.hp = Math.max(0, foe.hp - dealt);

    events.push({
      kind: 'attack',
      actor: key,
      target: foeKey,
      action,
      roll,
      sides,
      crit,
      charged,
      effectiveness,
      multiplier: Math.round(multiplier * 100) / 100,
      type: attackingType,
      damage: dealt,
      hpAfter: foe.hp,
      energy: fighter.energy,
    });

    if (foe.hp <= 0) {
      events.push({ kind: 'faint', actor: foeKey });
    }
  }

  // ------- End-of-round upkeep -------
  for (const key of order) {
    const fighter = fighterOf(key);
    if (fighter.hp > 0) {
      fighter.energy = Math.min(MAX_ENERGY, fighter.energy + 1);
    }
    fighter.action = null;
    fighter.guarding = false;
    fighter.vulnerable = false;
  }

  let winner = null;
  if (a.hp <= 0 && b.hp <= 0) winner = 'draw';
  else if (a.hp <= 0) winner = 'b';
  else if (b.hp <= 0) winner = 'a';

  const round = match.round;
  match.round += 1;

  events.push({
    kind: 'round-end',
    round,
    energy: { a: a.energy, b: b.energy },
    hp: { a: a.hp, b: b.hp },
  });
  if (winner) {
    events.push({ kind: 'end', winner });
    match.winner = winner;
  }

  return { events, winner, round };
}

/**
 * Lightweight bot brain. It reacts to the player's habits so practice matches
 * still feel like a duel instead of a punching bag.
 */
function chooseBotAction(match, botKey) {
  const bot = match[botKey];
  const foe = match[botKey === 'a' ? 'b' : 'a'];
  const hpRatio = bot.hp / bot.maxHp;
  const foeRatio = foe.hp / foe.maxHp;
  const roll = Math.random();

  // Try to finish the fight when the opponent is in range.
  if (bot.energy >= 2 && foe.hp <= bot.maxHp * 0.22 && roll < 0.75) return 'blast';

  // Respect a telegraphed charge or a guard.
  if (foe.lastAction === 'focus' && roll < 0.45) return 'guard';
  if (foe.lastAction === 'guard' && bot.energy >= 2 && roll < 0.55) return 'blast';

  if (hpRatio < 0.32 && roll < 0.5) return 'guard';
  if (bot.energy >= 2 && roll < 0.42) return 'blast';
  if (bot.energy < 2 && roll < 0.38) return 'focus';
  if (foeRatio < 0.25 && roll < 0.5) return 'strike';
  if (roll < 0.18) return 'guard';
  if (roll < 0.3) return 'focus';
  return 'strike';
}

function matchRewards(winnerKey, mode) {
  const win = winnerKey === 'a' || winnerKey === 'b';
  if (mode === 'bot') {
    return win ? { coins: 35, xp: 28 } : { coins: 8, xp: 10 };
  }
  return win ? { coins: 70, xp: 55 } : { coins: 18, xp: 22 };
}

module.exports = {
  ACTIONS,
  MAX_ENERGY,
  TYPE_CHART,
  sanitizeMon,
  createFighter,
  resetFighter,
  publicFighter,
  resolveRound,
  chooseBotAction,
  matchRewards,
};
