/**
 * DiceMon Arena — collection page.
 *
 * Rolls DiceMon from the PokeAPI, stores the collection locally, tracks the
 * active fighter, and keeps trainer progression in sync with the battle page.
 */

interface PokemonStats {
  hp: number;
  attack: number;
  defense: number;
  specialAttack: number;
  specialDefense: number;
  speed: number;
}

interface Pokemon {
  uid: string;
  name: string;
  type: string;
  types: string[];
  sprite: string;
  shiny: boolean;
  stats: PokemonStats;
}

interface Profile {
  name: string;
  level: number;
  xp: number;
  coins: number;
  wins: number;
  losses: number;
  streak: number;
  bestStreak: number;
}

interface PokemonApiResponse {
  name: string;
  types: Array<{ type: { name: string } }>;
  sprites: {
    front_default: string | null;
    front_shiny: string | null;
  };
  stats: Array<{
    base_stat: number;
    stat: { name: string };
  }>;
}

interface Rarity {
  key: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  label: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const POKEMON_KEY = 'pokemons';
const PROFILE_KEY = 'dicemonProfile';
const ACTIVE_KEY = 'dicemonActive';
const SEARCH_KEY = 'pokemonSearch';
const SOUND_KEY = 'dicemonSound';
const LUCKY_COST = 120;
const LUCKY_POOL = [
  3, 6, 9, 59, 65, 68, 94, 112, 130, 131, 134, 135, 136, 143, 144, 145, 146,
  149, 150, 151, 248, 249, 250, 282, 373, 376, 380, 381, 384, 445, 448, 468,
  483, 484, 487, 493, 635, 637, 700, 784, 887, 998, 1007,
];
const DEFAULT_SPRITE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/1.png';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function num(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatName(value: string): string {
  if (!value) return 'Mysterymon';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return character;
    }
  });
}

function safeType(value: string): string {
  return /^[a-z]+$/.test(value) ? value : 'normal';
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function normalizePokemon(raw: any, index: number): Pokemon | null {
  if (!raw || typeof raw !== 'object') return null;
  const statsSource = raw.stats && typeof raw.stats === 'object' ? raw.stats : {};
  const stats: PokemonStats = {
    hp: clamp(num(statsSource.hp, 50), 5, 255),
    attack: clamp(num(statsSource.attack, 50), 5, 255),
    defense: clamp(num(statsSource.defense, 50), 5, 255),
    specialAttack: clamp(num(statsSource.specialAttack, 50), 5, 255),
    specialDefense: clamp(num(statsSource.specialDefense, 50), 5, 255),
    speed: clamp(num(statsSource.speed, 50), 5, 255),
  };

  let types = Array.isArray(raw.types) ? raw.types : raw.type ? [raw.type] : ['normal'];
  types = types.map((type: any) => String(type).toLowerCase()).filter((type: string) => /^[a-z]+$/.test(type));
  types = [...new Set(types)];
  if (types.length === 0) types = ['normal'];

  const name = String(raw.name || 'Mysterymon').slice(0, 20);
  const sprite = typeof raw.sprite === 'string' && raw.sprite ? raw.sprite : DEFAULT_SPRITE;

  return {
    uid: String(raw.uid || `mon-${index}-${name.toLowerCase()}`),
    name,
    type: types[0],
    types: types.slice(0, 2),
    sprite,
    shiny: Boolean(raw.shiny),
    stats,
  };
}

function loadCollection(): Pokemon[] {
  let raw: any[] = [];
  try {
    raw = JSON.parse(localStorage.getItem(POKEMON_KEY) || '[]');
  } catch {
    raw = [];
  }
  if (!Array.isArray(raw)) raw = [];
  const collection: Pokemon[] = [];
  const used = new Set<string>();
  raw.forEach((entry, index) => {
    const mon = normalizePokemon(entry, index);
    if (!mon) return;
    let uid = mon.uid;
    let suffix = 1;
    while (used.has(uid)) {
      uid = `${mon.uid}-${suffix}`;
      suffix += 1;
    }
    used.add(uid);
    collection.push({ ...mon, uid });
  });
  return collection;
}

function defaultProfile(): Profile {
  return {
    name: 'Trainer',
    level: 1,
    xp: 0,
    coins: 0,
    wins: 0,
    losses: 0,
    streak: 0,
    bestStreak: 0,
  };
}

function loadProfile(): Profile {
  try {
    const raw = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}');
    const base = defaultProfile();
    return {
      name: String(raw.name || base.name).slice(0, 18),
      level: clamp(Math.floor(num(raw.level, 1)), 1, 100),
      xp: Math.max(0, Math.floor(num(raw.xp, 0))),
      coins: Math.max(0, Math.floor(num(raw.coins, 0))),
      wins: Math.max(0, Math.floor(num(raw.wins, 0))),
      losses: Math.max(0, Math.floor(num(raw.losses, 0))),
      streak: Math.max(0, Math.floor(num(raw.streak, 0))),
      bestStreak: Math.max(0, Math.floor(num(raw.bestStreak, 0))),
    };
  } catch {
    return defaultProfile();
  }
}

function saveCollection(): void {
  localStorage.setItem(POKEMON_KEY, JSON.stringify(collection));
}

function saveProfile(): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

// ---------------------------------------------------------------------------
// Sound
// ---------------------------------------------------------------------------

class HomeSfx {
  private ctx: AudioContext | null = null;
  enabled = localStorage.getItem(SOUND_KEY) !== 'off';

  private tone(frequency: number, duration: number, type: OscillatorType = 'sine', gain = 0.045, delay = 0): void {
    if (!this.enabled) return;
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return;
    if (!this.ctx) this.ctx = new Ctor();
    const ctx = this.ctx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
    const start = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator();
    const volume = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    volume.gain.setValueAtTime(0.0001, start);
    volume.gain.exponentialRampToValueAtTime(gain, start + 0.012);
    volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(volume);
    volume.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  click(): void {
    this.tone(520, 0.06, 'triangle', 0.03);
  }

  select(): void {
    this.tone(440, 0.07, 'triangle', 0.035);
    this.tone(660, 0.09, 'triangle', 0.03, 0.06);
  }

  roll(): void {
    this.tone(250, 0.05, 'square', 0.022);
    this.tone(340, 0.05, 'square', 0.022, 0.07);
    this.tone(430, 0.06, 'square', 0.025, 0.14);
  }

  catch(shiny: boolean): void {
    const notes = shiny ? [523, 659, 784, 1047, 1319] : [392, 523, 659];
    notes.forEach((note, index) => this.tone(note, 0.28, 'triangle', 0.05, index * 0.09));
  }
}

const sfx = new HomeSfx();

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const sprite = document.querySelector('.pokemon-sprite') as HTMLImageElement;
const rollBtn = document.querySelector('.js-roll-btn') as HTMLButtonElement;
const pokemonGrid = document.querySelector('.pokemon-grid') as HTMLDivElement;
const searchInput = byId<HTMLInputElement>('searchInput');
const searchIcon = document.querySelector('.search-btn') as HTMLButtonElement;
const trainerHud = byId<HTMLDivElement>('trainerHud');
const selectedHint = byId<HTMLParagraphElement>('selectedHint');
const battleLink = byId<HTMLAnchorElement>('battleLink');
const luckyRollBtn = byId<HTMLButtonElement>('luckyRollBtn');
const luckyCostLabel = byId<HTMLElement>('luckyCostLabel');
const screenCaption = byId<HTMLDivElement>('screenCaption');
const screenShiny = byId<HTMLSpanElement>('screenShiny');
const screen = document.querySelector('.screen') as HTMLElement;
const toastStack = byId<HTMLDivElement>('toastStack');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let collection = loadCollection();
let profile = loadProfile();
if (!localStorage.getItem(PROFILE_KEY)) saveProfile();

let selectedUid = localStorage.getItem(ACTIVE_KEY) || collection[0]?.uid || '';
if (!selectedUid || !collection.some((mon) => mon.uid === selectedUid)) {
  selectedUid = collection[0]?.uid || '';
}
if (selectedUid) localStorage.setItem(ACTIVE_KEY, selectedUid);

let currentSearch = localStorage.getItem(SEARCH_KEY) || '';
let rolling = false;
let flickerId: number | null = null;

// Persist the migrated shape immediately.
saveCollection();

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderHud(): void {
  const streak = profile.streak > 0 ? `🔥 ${profile.streak}` : '—';
  trainerHud.innerHTML = `
    <div class="hud-chip"><span class="hud-icon">⭐</span><span class="hud-body"><b>Lv. ${profile.level}</b><small>Trainer</small></span></div>
    <div class="hud-chip"><span class="hud-icon">🪙</span><span class="hud-body"><b>${profile.coins}</b><small>Coins</small></span></div>
    <div class="hud-chip"><span class="hud-icon">🔥</span><span class="hud-body"><b>${streak}</b><small>Streak</small></span></div>
    <div class="hud-chip"><span class="hud-icon">🏆</span><span class="hud-body"><b>${profile.wins}</b><small>Wins</small></span></div>
  `;
  luckyCostLabel.textContent = `${LUCKY_COST} 🪙`;
  luckyRollBtn.disabled = rolling || profile.coins < LUCKY_COST;
  luckyRollBtn.title = profile.coins < LUCKY_COST
    ? `Earn ${LUCKY_COST - profile.coins} more coins in the arena`
    : `Spend ${LUCKY_COST} coins for a guaranteed strong DiceMon`;
}

function statTotal(mon: Pokemon): number {
  const stats = mon.stats;
  return stats.hp + stats.attack + stats.defense + stats.specialAttack + stats.specialDefense + stats.speed;
}

function rarityFor(mon: Pokemon): Rarity {
  const total = statTotal(mon);
  if (total >= 600) return { key: 'legendary', label: 'Legendary' };
  if (total >= 500) return { key: 'epic', label: 'Epic' };
  if (total >= 420) return { key: 'rare', label: 'Rare' };
  if (total >= 340) return { key: 'uncommon', label: 'Uncommon' };
  return { key: 'common', label: 'Common' };
}

function typeChips(types: string[]): string {
  return types
    .map((type) => `<span class="type-chip type-${safeType(type)}">${escapeHtml(type)}</span>`)
    .join('');
}

function statRow(label: string, value: number): string {
  return `<div class="stat-row"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`;
}

function selectedMon(): Pokemon | undefined {
  return collection.find((mon) => mon.uid === selectedUid) || collection[0];
}

function filteredCollection(): Pokemon[] {
  if (!currentSearch) return collection;
  return collection.filter((mon) => {
    const haystack = `${mon.name} ${mon.types.join(' ')} ${mon.type}`.toLowerCase();
    return haystack.includes(currentSearch);
  });
}

function renderGrid(): void {
  if (collection.length === 0) {
    pokemonGrid.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🎲</span>
        <h3>Your collection is empty</h3>
        <p>Roll the big button to catch your first DiceMon. Every roll is a surprise.</p>
        <button type="button" data-roll="1">Roll a DiceMon</button>
      </div>
    `;
    renderBattleAffordance();
    return;
  }

  const list = filteredCollection();
  if (list.length === 0) {
    pokemonGrid.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🔍</span>
        <h3>No DiceMon found</h3>
        <p>No one in your collection matches “${escapeHtml(currentSearch)}”.</p>
        <button type="button" data-clear-search="1">Clear search</button>
      </div>
    `;
    renderBattleAffordance();
    return;
  }

  pokemonGrid.innerHTML = list
    .map((mon) => {
      const rarity = rarityFor(mon);
      const isSelected = mon.uid === selectedUid;
      return `
        <article class="grid-item rarity-${rarity.key}${isSelected ? ' selected' : ''}${mon.shiny ? ' shiny' : ''}"
                 data-uid="${escapeHtml(mon.uid)}" tabindex="0" role="button"
                 aria-label="${escapeHtml(formatName(mon.name))}, ${rarity.label}${isSelected ? ', selected fighter' : ''}">
          <div class="pokemon-image-container">
            ${mon.shiny ? '<span class="card-shiny">✦</span>' : ''}
            <span class="card-select">⚔ Fighter</span>
            <img src="${escapeHtml(mon.sprite)}" alt="${escapeHtml(formatName(mon.name))} sprite" class="pokemon-image" loading="lazy">
          </div>
          <div class="pokemon-info">
            <div class="card-head">
              <div class="card-identity">
                <p class="card-name">${escapeHtml(formatName(mon.name))}</p>
                <span class="rarity-badge">${rarity.label}</span>
              </div>
              <div class="card-types">${typeChips(mon.types)}</div>
            </div>
            <div class="pokemon-stats">
              ${statRow('HP', mon.stats.hp)}
              ${statRow('Atk', mon.stats.attack)}
              ${statRow('Def', mon.stats.defense)}
              ${statRow('Spd', mon.stats.speed)}
              ${statRow('Sp. Atk', mon.stats.specialAttack)}
              ${statRow('Sp. Def', mon.stats.specialDefense)}
            </div>
          </div>
          <div class="card-footer">
            <span>${isSelected ? 'Your fighter' : 'Click to select'}</span>
            <span class="card-bst">BST ${statTotal(mon)}</span>
          </div>
        </article>
      `;
    })
    .join('');

  renderBattleAffordance();
}

function renderScreen(mon: Pokemon | undefined): void {
  if (!mon) {
    sprite.src = DEFAULT_SPRITE;
    sprite.alt = 'No DiceMon selected';
    screenCaption.textContent = 'Roll to discover';
    screenCaption.classList.remove('shiny');
    screenShiny.hidden = true;
    screen.classList.remove('shiny-screen');
    return;
  }
  sprite.src = mon.sprite;
  sprite.alt = `${formatName(mon.name)} sprite`;
  const rarity = rarityFor(mon);
  screenCaption.textContent = `${formatName(mon.name)} · ${mon.types.join('/')} · ${rarity.label}`;
  screenCaption.classList.toggle('shiny', mon.shiny);
  screenShiny.hidden = !mon.shiny;
  screen.classList.toggle('shiny-screen', mon.shiny);
}

function updateSelectionHint(): void {
  const mon = selectedMon();
  if (!mon) {
    selectedHint.textContent = 'No fighter selected';
    battleLink.classList.add('disabled');
    battleLink.setAttribute('aria-disabled', 'true');
    return;
  }
  selectedHint.innerHTML = `Active fighter: <b>${escapeHtml(formatName(mon.name))}</b>`;
  battleLink.classList.remove('disabled');
  battleLink.removeAttribute('aria-disabled');
}

function renderBattleAffordance(): void {
  updateSelectionHint();
}

function renderAll(): void {
  renderHud();
  renderGrid();
  renderScreen(selectedMon());
}

function selectMon(uid: string): void {
  if (!collection.some((mon) => mon.uid === uid)) return;
  selectedUid = uid;
  localStorage.setItem(ACTIVE_KEY, uid);
  sfx.select();
  renderGrid();
  renderScreen(selectedMon());
}

// ---------------------------------------------------------------------------
// Rolling
// ---------------------------------------------------------------------------

function startSpriteFlicker(): void {
  stopSpriteFlicker();
  const pool = collection.map((mon) => mon.sprite).filter(Boolean);
  if (pool.length === 0) pool.push(DEFAULT_SPRITE);
  if (pool.length === 1) {
    pool.push(
      'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/6.png',
      'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png',
      'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/94.png',
      'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/143.png',
      'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/149.png',
    );
  }
  screen.classList.remove('shiny-screen');
  screenShiny.hidden = true;
  screenCaption.textContent = 'Rolling…';
  screenCaption.classList.remove('shiny');

  flickerId = window.setInterval(() => {
    sprite.src = pool[Math.floor(Math.random() * pool.length)];
  }, 85);
}

function stopSpriteFlicker(): void {
  if (flickerId) {
    window.clearInterval(flickerId);
    flickerId = null;
  }
}

async function fetchRandomPokemon(lucky = false): Promise<PokemonApiResponse> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      const randomId = lucky
        ? LUCKY_POOL[Math.floor(Math.random() * LUCKY_POOL.length)]
        : Math.floor(Math.random() * 1025) + 1;
      const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${randomId}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`PokeAPI returned ${response.status}`);
      return (await response.json()) as PokemonApiResponse;
    } catch (error) {
      lastError = error;
      await sleep(350);
    } finally {
      window.clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not reach the PokeAPI');
}

function mapApiPokemon(data: PokemonApiResponse, shinyChance = 0.08): Pokemon {
  const statByName = new Map<string, number>();
  data.stats.forEach((entry) => statByName.set(entry.stat.name, entry.base_stat));

  const stat = (name: string, fallback: number): number =>
    clamp(num(statByName.get(name), fallback), 5, 255);

  let types = data.types.map((entry) => entry.type.name);
  if (types.length === 0) types = ['normal'];

  const shiny = Math.random() < shinyChance;
  const normalSprite = data.sprites.front_default || '';
  const shinySprite = data.sprites.front_shiny || normalSprite;
  if (!normalSprite && !shinySprite) throw new Error('This DiceMon has no sprite yet.');

  return {
    uid: `mon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: data.name,
    type: types[0],
    types: types.slice(0, 2),
    sprite: shiny ? shinySprite : normalSprite,
    shiny,
    stats: {
      hp: stat('hp', 50),
      attack: stat('attack', 50),
      defense: stat('defense', 50),
      specialAttack: stat('special-attack', 50),
      specialDefense: stat('special-defense', 50),
      speed: stat('speed', 50),
    },
  };
}

async function getPokemon(options: { lucky?: boolean } = {}): Promise<void> {
  if (rolling) return;
  const lucky = Boolean(options.lucky);

  if (lucky && profile.coins < LUCKY_COST) {
    toast(`Lucky Rolls cost ${LUCKY_COST} coins — win battles to earn more.`, 'error');
    return;
  }

  rolling = true;
  rollBtn.classList.add('rolling');
  rollBtn.setAttribute('aria-busy', 'true');
  luckyRollBtn.classList.add('rolling');
  renderHud();

  if (lucky) {
    profile.coins -= LUCKY_COST;
    saveProfile();
    renderHud();
  }

  startSpriteFlicker();
  sfx.roll();

  const minimumWait = sleep(1150);

  try {
    const data = await fetchRandomPokemon(lucky);
    await minimumWait;
    const mon = mapApiPokemon(data, lucky ? 0.2 : 0.08);

    collection.unshift(mon);
    selectedUid = mon.uid;
    localStorage.setItem(ACTIVE_KEY, mon.uid);
    saveCollection();

    stopSpriteFlicker();
    renderGrid();
    renderScreen(mon);
    sfx.catch(mon.shiny);

    const rarity = rarityFor(mon);
    const shinyText = mon.shiny ? '✦ SHINY ' : '';
    toast(
      `${shinyText}${formatName(mon.name)} caught!${lucky ? ' Lucky Roll!' : ''} ${rarity.label} · BST ${statTotal(mon)}`,
      mon.shiny ? 'gold' : 'good',
    );
  } catch (error) {
    await minimumWait;
    stopSpriteFlicker();
    renderScreen(selectedMon());
    if (lucky) {
      profile.coins += LUCKY_COST;
      saveProfile();
      renderHud();
    }
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'The PokeAPI took too long to answer. Try rolling again.'
      : 'The wild signal dropped. Check your connection and roll again.';
    toast(lucky ? `${message} Your ${LUCKY_COST} coins were refunded.` : message, 'error');
    console.error('DiceMon roll failed:', error);
  } finally {
    stopSpriteFlicker();
    rolling = false;
    rollBtn.classList.remove('rolling');
    rollBtn.removeAttribute('aria-busy');
    luckyRollBtn.classList.remove('rolling');
    renderHud();
  }
}

// ---------------------------------------------------------------------------
// Search + events
// ---------------------------------------------------------------------------

function applySearch(): void {
  currentSearch = searchInput.value.trim().toLowerCase();
  localStorage.setItem(SEARCH_KEY, searchInput.value);
  renderGrid();
}

function clearSearch(): void {
  searchInput.value = '';
  currentSearch = '';
  localStorage.removeItem(SEARCH_KEY);
  renderGrid();
  searchInput.focus();
}

searchIcon.addEventListener('click', () => {
  applySearch();
  sfx.click();
});

searchInput.addEventListener('input', applySearch);

searchInput.addEventListener('keyup', (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    applySearch();
    searchInput.blur();
  }
  if (event.key === 'Escape') {
    clearSearch();
  }
});

pokemonGrid.addEventListener('click', (event: MouseEvent) => {
  const target = event.target as HTMLElement;
  if (target.closest('[data-roll]')) {
    getPokemon();
    return;
  }
  if (target.closest('[data-clear-search]')) {
    clearSearch();
    return;
  }
  const card = target.closest('.grid-item') as HTMLElement | null;
  if (!card || !card.dataset.uid) return;
  selectMon(card.dataset.uid);
});

pokemonGrid.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const target = event.target as HTMLElement;
  const card = target.closest('.grid-item') as HTMLElement | null;
  if (!card || !card.dataset.uid) return;
  event.preventDefault();
  selectMon(card.dataset.uid);
});

rollBtn.addEventListener('click', () => getPokemon());
luckyRollBtn.addEventListener('click', () => {
  if (luckyRollBtn.disabled) return;
  getPokemon({ lucky: true });
});

battleLink.addEventListener('click', (event: MouseEvent) => {
  if (collection.length === 0) {
    event.preventDefault();
    toast('Roll a DiceMon before entering the arena!', 'info');
    return;
  }
  sfx.click();
});

document.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.key.toLowerCase() === 'r' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    getPokemon();
  }
});

window.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  profile = loadProfile();
  renderHud();
});

window.addEventListener('pageshow', () => {
  profile = loadProfile();
  renderHud();
});

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

function toast(message: string, kind: 'info' | 'good' | 'error' | 'gold' = 'info'): void {
  const element = document.createElement('div');
  element.className = `toast ${kind}`;
  element.textContent = message;
  toastStack.appendChild(element);
  while (toastStack.children.length > 4) {
    toastStack.removeChild(toastStack.firstElementChild as Node);
  }
  window.setTimeout(() => {
    element.classList.add('leaving');
    window.setTimeout(() => element.remove(), 260);
  }, 4200);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

searchInput.value = localStorage.getItem(SEARCH_KEY) || '';
currentSearch = searchInput.value.trim().toLowerCase();

renderAll();

if (collection.length === 0) {
  getPokemon();
}

export {};
