/**
 * DiceMon Arena — collection page.
 *
 * Rolls DiceMon from the PokeAPI, stores the collection locally, tracks the
 * active fighter, and keeps trainer progression in sync with the battle page.
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var _a, _b;
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
const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function num(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function formatName(value) {
    if (!value)
        return 'Mysterymon';
    return value.charAt(0).toUpperCase() + value.slice(1);
}
function escapeHtml(value) {
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
function safeType(value) {
    return /^[a-z]+$/.test(value) ? value : 'normal';
}
function byId(id) {
    const element = document.getElementById(id);
    if (!element)
        throw new Error(`Missing element #${id}`);
    return element;
}
// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
function normalizePokemon(raw, index) {
    if (!raw || typeof raw !== 'object')
        return null;
    const statsSource = raw.stats && typeof raw.stats === 'object' ? raw.stats : {};
    const stats = {
        hp: clamp(num(statsSource.hp, 50), 5, 255),
        attack: clamp(num(statsSource.attack, 50), 5, 255),
        defense: clamp(num(statsSource.defense, 50), 5, 255),
        specialAttack: clamp(num(statsSource.specialAttack, 50), 5, 255),
        specialDefense: clamp(num(statsSource.specialDefense, 50), 5, 255),
        speed: clamp(num(statsSource.speed, 50), 5, 255),
    };
    let types = Array.isArray(raw.types) ? raw.types : raw.type ? [raw.type] : ['normal'];
    types = types.map((type) => String(type).toLowerCase()).filter((type) => /^[a-z]+$/.test(type));
    types = [...new Set(types)];
    if (types.length === 0)
        types = ['normal'];
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
function loadCollection() {
    let raw = [];
    try {
        raw = JSON.parse(localStorage.getItem(POKEMON_KEY) || '[]');
    }
    catch (_a) {
        raw = [];
    }
    if (!Array.isArray(raw))
        raw = [];
    const collection = [];
    const used = new Set();
    raw.forEach((entry, index) => {
        const mon = normalizePokemon(entry, index);
        if (!mon)
            return;
        let uid = mon.uid;
        let suffix = 1;
        while (used.has(uid)) {
            uid = `${mon.uid}-${suffix}`;
            suffix += 1;
        }
        used.add(uid);
        collection.push(Object.assign(Object.assign({}, mon), { uid }));
    });
    return collection;
}
function defaultProfile() {
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
function loadProfile() {
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
    }
    catch (_a) {
        return defaultProfile();
    }
}
function saveCollection() {
    localStorage.setItem(POKEMON_KEY, JSON.stringify(collection));
}
function saveProfile() {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}
// ---------------------------------------------------------------------------
// Sound
// ---------------------------------------------------------------------------
class HomeSfx {
    constructor() {
        this.ctx = null;
        this.enabled = localStorage.getItem(SOUND_KEY) !== 'off';
    }
    tone(frequency, duration, type = 'sine', gain = 0.045, delay = 0) {
        if (!this.enabled)
            return;
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor)
            return;
        if (!this.ctx)
            this.ctx = new Ctor();
        const ctx = this.ctx;
        if (ctx.state === 'suspended')
            ctx.resume().catch(() => undefined);
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
    click() {
        this.tone(520, 0.06, 'triangle', 0.03);
    }
    select() {
        this.tone(440, 0.07, 'triangle', 0.035);
        this.tone(660, 0.09, 'triangle', 0.03, 0.06);
    }
    roll() {
        this.tone(250, 0.05, 'square', 0.022);
        this.tone(340, 0.05, 'square', 0.022, 0.07);
        this.tone(430, 0.06, 'square', 0.025, 0.14);
    }
    catch(shiny) {
        const notes = shiny ? [523, 659, 784, 1047, 1319] : [392, 523, 659];
        notes.forEach((note, index) => this.tone(note, 0.28, 'triangle', 0.05, index * 0.09));
    }
}
const sfx = new HomeSfx();
// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const sprite = document.querySelector('.pokemon-sprite');
const rollBtn = document.querySelector('.js-roll-btn');
const pokemonGrid = document.querySelector('.pokemon-grid');
const searchInput = byId('searchInput');
const searchIcon = document.querySelector('.search-btn');
const trainerHud = byId('trainerHud');
const selectedHint = byId('selectedHint');
const battleLink = byId('battleLink');
const luckyRollBtn = byId('luckyRollBtn');
const luckyCostLabel = byId('luckyCostLabel');
const screenCaption = byId('screenCaption');
const screenShiny = byId('screenShiny');
const screen = document.querySelector('.screen');
const toastStack = byId('toastStack');
// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let collection = loadCollection();
let profile = loadProfile();
if (!localStorage.getItem(PROFILE_KEY))
    saveProfile();
let selectedUid = localStorage.getItem(ACTIVE_KEY) || ((_a = collection[0]) === null || _a === void 0 ? void 0 : _a.uid) || '';
if (!selectedUid || !collection.some((mon) => mon.uid === selectedUid)) {
    selectedUid = ((_b = collection[0]) === null || _b === void 0 ? void 0 : _b.uid) || '';
}
if (selectedUid)
    localStorage.setItem(ACTIVE_KEY, selectedUid);
let currentSearch = localStorage.getItem(SEARCH_KEY) || '';
let rolling = false;
let flickerId = null;
// Persist the migrated shape immediately.
saveCollection();
// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderHud() {
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
function statTotal(mon) {
    const stats = mon.stats;
    return stats.hp + stats.attack + stats.defense + stats.specialAttack + stats.specialDefense + stats.speed;
}
function rarityFor(mon) {
    const total = statTotal(mon);
    if (total >= 600)
        return { key: 'legendary', label: 'Legendary' };
    if (total >= 500)
        return { key: 'epic', label: 'Epic' };
    if (total >= 420)
        return { key: 'rare', label: 'Rare' };
    if (total >= 340)
        return { key: 'uncommon', label: 'Uncommon' };
    return { key: 'common', label: 'Common' };
}
function typeChips(types) {
    return types
        .map((type) => `<span class="type-chip type-${safeType(type)}">${escapeHtml(type)}</span>`)
        .join('');
}
function statRow(label, value) {
    return `<div class="stat-row"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`;
}
function selectedMon() {
    return collection.find((mon) => mon.uid === selectedUid) || collection[0];
}
function filteredCollection() {
    if (!currentSearch)
        return collection;
    return collection.filter((mon) => {
        const haystack = `${mon.name} ${mon.types.join(' ')} ${mon.type}`.toLowerCase();
        return haystack.includes(currentSearch);
    });
}
function renderGrid() {
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
function renderScreen(mon) {
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
function updateSelectionHint() {
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
function renderBattleAffordance() {
    updateSelectionHint();
}
function renderAll() {
    renderHud();
    renderGrid();
    renderScreen(selectedMon());
}
function selectMon(uid) {
    if (!collection.some((mon) => mon.uid === uid))
        return;
    selectedUid = uid;
    localStorage.setItem(ACTIVE_KEY, uid);
    sfx.select();
    renderGrid();
    renderScreen(selectedMon());
}
// ---------------------------------------------------------------------------
// Rolling
// ---------------------------------------------------------------------------
function startSpriteFlicker() {
    stopSpriteFlicker();
    const pool = collection.map((mon) => mon.sprite).filter(Boolean);
    if (pool.length === 0)
        pool.push(DEFAULT_SPRITE);
    if (pool.length === 1) {
        pool.push('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/6.png', 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png', 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/94.png', 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/143.png', 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/149.png');
    }
    screen.classList.remove('shiny-screen');
    screenShiny.hidden = true;
    screenCaption.textContent = 'Rolling…';
    screenCaption.classList.remove('shiny');
    flickerId = window.setInterval(() => {
        sprite.src = pool[Math.floor(Math.random() * pool.length)];
    }, 85);
}
function stopSpriteFlicker() {
    if (flickerId) {
        window.clearInterval(flickerId);
        flickerId = null;
    }
}
function fetchRandomPokemon() {
    return __awaiter(this, arguments, void 0, function* (lucky = false) {
        let lastError = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(), 12000);
            try {
                const randomId = lucky
                    ? LUCKY_POOL[Math.floor(Math.random() * LUCKY_POOL.length)]
                    : Math.floor(Math.random() * 1025) + 1;
                const response = yield fetch(`https://pokeapi.co/api/v2/pokemon/${randomId}`, {
                    signal: controller.signal,
                });
                if (!response.ok)
                    throw new Error(`PokeAPI returned ${response.status}`);
                return (yield response.json());
            }
            catch (error) {
                lastError = error;
                yield sleep(350);
            }
            finally {
                window.clearTimeout(timeout);
            }
        }
        throw lastError instanceof Error ? lastError : new Error('Could not reach the PokeAPI');
    });
}
function mapApiPokemon(data, shinyChance = 0.08) {
    const statByName = new Map();
    data.stats.forEach((entry) => statByName.set(entry.stat.name, entry.base_stat));
    const stat = (name, fallback) => clamp(num(statByName.get(name), fallback), 5, 255);
    let types = data.types.map((entry) => entry.type.name);
    if (types.length === 0)
        types = ['normal'];
    const shiny = Math.random() < shinyChance;
    const normalSprite = data.sprites.front_default || '';
    const shinySprite = data.sprites.front_shiny || normalSprite;
    if (!normalSprite && !shinySprite)
        throw new Error('This DiceMon has no sprite yet.');
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
function getPokemon() {
    return __awaiter(this, arguments, void 0, function* (options = {}) {
        if (rolling)
            return;
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
            const data = yield fetchRandomPokemon(lucky);
            yield minimumWait;
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
            toast(`${shinyText}${formatName(mon.name)} caught!${lucky ? ' Lucky Roll!' : ''} ${rarity.label} · BST ${statTotal(mon)}`, mon.shiny ? 'gold' : 'good');
        }
        catch (error) {
            yield minimumWait;
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
        }
        finally {
            stopSpriteFlicker();
            rolling = false;
            rollBtn.classList.remove('rolling');
            rollBtn.removeAttribute('aria-busy');
            luckyRollBtn.classList.remove('rolling');
            renderHud();
        }
    });
}
// ---------------------------------------------------------------------------
// Search + events
// ---------------------------------------------------------------------------
function applySearch() {
    currentSearch = searchInput.value.trim().toLowerCase();
    localStorage.setItem(SEARCH_KEY, searchInput.value);
    renderGrid();
}
function clearSearch() {
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
searchInput.addEventListener('keyup', (event) => {
    if (event.key === 'Enter') {
        applySearch();
        searchInput.blur();
    }
    if (event.key === 'Escape') {
        clearSearch();
    }
});
pokemonGrid.addEventListener('click', (event) => {
    const target = event.target;
    if (target.closest('[data-roll]')) {
        getPokemon();
        return;
    }
    if (target.closest('[data-clear-search]')) {
        clearSearch();
        return;
    }
    const card = target.closest('.grid-item');
    if (!card || !card.dataset.uid)
        return;
    selectMon(card.dataset.uid);
});
pokemonGrid.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ')
        return;
    const target = event.target;
    const card = target.closest('.grid-item');
    if (!card || !card.dataset.uid)
        return;
    event.preventDefault();
    selectMon(card.dataset.uid);
});
rollBtn.addEventListener('click', () => getPokemon());
luckyRollBtn.addEventListener('click', () => {
    if (luckyRollBtn.disabled)
        return;
    getPokemon({ lucky: true });
});
battleLink.addEventListener('click', (event) => {
    if (collection.length === 0) {
        event.preventDefault();
        toast('Roll a DiceMon before entering the arena!', 'info');
        return;
    }
    sfx.click();
});
document.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return;
    if (event.key.toLowerCase() === 'r' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        getPokemon();
    }
});
window.addEventListener('visibilitychange', () => {
    if (document.hidden)
        return;
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
function toast(message, kind = 'info') {
    const element = document.createElement('div');
    element.className = `toast ${kind}`;
    element.textContent = message;
    toastStack.appendChild(element);
    while (toastStack.children.length > 4) {
        toastStack.removeChild(toastStack.firstElementChild);
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
