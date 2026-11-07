/**
 * DiceMon Arena — battle client.
 *
 * Handles the lobby, WebSocket multiplayer connection, live battle playback,
 * reactions, rematches and local trainer progression.
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
// Constants & helpers
// ---------------------------------------------------------------------------
const POKEMON_KEY = 'pokemons';
const PROFILE_KEY = 'dicemonProfile';
const ACTIVE_KEY = 'dicemonActive';
const TOKEN_KEY = 'dicemonToken';
const SOUND_KEY = 'dicemonSound';
const TURN_MS = 30000;
const MAX_ENERGY = 5;
const ACTION_META = {
    strike: { label: 'Strike', icon: '⚔️', verb: 'used Strike' },
    blast: { label: 'Blast', icon: '🔥', verb: 'unleashed Blast' },
    guard: { label: 'Guard', icon: '🛡️', verb: 'guarded' },
    focus: { label: 'Focus', icon: '🧠', verb: 'focused' },
};
const EMOTE_MAP = {
    nice: '😎',
    wow: '😱',
    fire: '🔥',
    oops: '😅',
    gg: '👏',
};
const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
function byId(id) {
    const element = document.getElementById(id);
    if (!element)
        throw new Error(`Missing element #${id}`);
    return element;
}
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
function typeBadges(types) {
    return types
        .map((type) => `<span class="type-badge type-${safeType(type)}">${escapeHtml(type)}</span>`)
        .join('');
}
function normalizeMon(raw, index) {
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
    return {
        uid: String(raw.uid || `mon-${index}-${name.toLowerCase()}`),
        name,
        type: types[0],
        types: types.slice(0, 2),
        sprite: String(raw.sprite || ''),
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
        const mon = normalizeMon(entry, index);
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
// ---------------------------------------------------------------------------
// Sound engine (WebAudio, no asset files)
// ---------------------------------------------------------------------------
class Sfx {
    constructor() {
        this.ctx = null;
        this.enabled = localStorage.getItem(SOUND_KEY) !== 'off';
    }
    ensure() {
        if (!this.enabled)
            return null;
        if (!this.ctx) {
            const Ctor = window.AudioContext || window.webkitAudioContext;
            if (!Ctor)
                return null;
            this.ctx = new Ctor();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => undefined);
        }
        return this.ctx;
    }
    tone(frequency, duration, options = {}) {
        var _a;
        const ctx = this.ensure();
        if (!ctx)
            return;
        const start = ctx.currentTime + (options.delay || 0);
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = options.type || 'sine';
        oscillator.frequency.setValueAtTime(frequency, start);
        if (options.slide) {
            oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, frequency + options.slide), start + duration);
        }
        const volume = (_a = options.gain) !== null && _a !== void 0 ? _a : 0.06;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(start);
        oscillator.stop(start + duration + 0.02);
    }
    play(kind) {
        if (!this.enabled)
            return;
        switch (kind) {
            case 'click':
                this.tone(520, 0.06, { type: 'triangle', gain: 0.035 });
                break;
            case 'hover':
                this.tone(300, 0.04, { type: 'sine', gain: 0.015 });
                break;
            case 'select':
                this.tone(420, 0.08, { type: 'triangle', gain: 0.04 });
                this.tone(660, 0.1, { type: 'triangle', gain: 0.035, delay: 0.06 });
                break;
            case 'roll':
                this.tone(240, 0.05, { type: 'square', gain: 0.025 });
                this.tone(320, 0.05, { type: 'square', gain: 0.025, delay: 0.06 });
                this.tone(410, 0.07, { type: 'square', gain: 0.03, delay: 0.12 });
                break;
            case 'hit':
                this.tone(150, 0.16, { type: 'sawtooth', gain: 0.09, slide: -70 });
                this.tone(80, 0.2, { type: 'triangle', gain: 0.07 });
                break;
            case 'crit':
                this.tone(240, 0.1, { type: 'sawtooth', gain: 0.09 });
                this.tone(380, 0.1, { type: 'square', gain: 0.07, delay: 0.06 });
                this.tone(640, 0.18, { type: 'triangle', gain: 0.08, delay: 0.13 });
                break;
            case 'heal':
                this.tone(500, 0.12, { type: 'sine', gain: 0.05, slide: 240 });
                break;
            case 'guard':
                this.tone(220, 0.12, { type: 'triangle', gain: 0.045 });
                this.tone(330, 0.16, { type: 'triangle', gain: 0.045, delay: 0.08 });
                break;
            case 'focus':
                this.tone(180, 0.2, { type: 'sine', gain: 0.04, slide: 260 });
                break;
            case 'win':
                [523, 659, 784, 1047].forEach((frequency, index) => {
                    this.tone(frequency, 0.32, { type: 'triangle', gain: 0.06, delay: index * 0.11 });
                });
                break;
            case 'lose':
                [392, 330, 262].forEach((frequency, index) => {
                    this.tone(frequency, 0.4, { type: 'sine', gain: 0.055, delay: index * 0.15 });
                });
                break;
            case 'match':
                [392, 523, 659].forEach((frequency, index) => {
                    this.tone(frequency, 0.2, { type: 'triangle', gain: 0.05, delay: index * 0.1 });
                });
                break;
            case 'tick':
                this.tone(880, 0.04, { type: 'square', gain: 0.02 });
                break;
            default:
                break;
        }
    }
}
const sfx = new Sfx();
// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const onlinePill = byId('onlinePill');
const onlineCount = byId('onlineCount');
const soundBtn = byId('soundBtn');
const lobbyScreen = byId('lobbyScreen');
const battleScreen = byId('battleScreen');
const loadoutPreview = byId('loadoutPreview');
const trainerNameInput = byId('trainerName');
const quickMatchBtn = byId('quickMatchBtn');
const createRoomBtn = byId('createRoomBtn');
const joinRoomBtn = byId('joinRoomBtn');
const roomCodeInput = byId('roomCode');
const botBtn = byId('botBtn');
const lobbyStatus = byId('lobbyStatus');
const lobbyStatusText = byId('lobbyStatusText');
const cancelQueueBtn = byId('cancelQueueBtn');
const rosterGrid = byId('rosterGrid');
const rosterCount = byId('rosterCount');
const rosterEmpty = byId('rosterEmpty');
const miniStats = byId('miniStats');
const roomBanner = byId('roomBanner');
const roomCodeDisplay = byId('roomCodeDisplay');
const copyCodeBtn = byId('copyCodeBtn');
const cancelRoomBtn = byId('cancelRoomBtn');
const roundNumber = byId('roundNumber');
const battleMode = byId('battleMode');
const timerWrap = byId('timerFill').parentElement;
const timerFill = byId('timerFill');
const timerText = byId('timerText');
const youName = byId('youName');
const youLevel = byId('youLevel');
const youTypes = byId('youTypes');
const youHpFill = byId('youHpFill');
const youHpText = byId('youHpText');
const youEnergy = byId('youEnergy');
const youStatus = byId('youStatus');
const foeName = byId('foeName');
const foeLevel = byId('foeLevel');
const foeTypes = byId('foeTypes');
const foeHpFill = byId('foeHpFill');
const foeHpText = byId('foeHpText');
const foeEnergy = byId('foeEnergy');
const foeStatus = byId('foeStatus');
const youSprite = byId('youSprite');
const foeSprite = byId('foeSprite');
const youFigure = byId('youFigure');
const foeFigure = byId('foeFigure');
const youShiny = byId('youShiny');
const foeShiny = byId('foeShiny');
const youBubble = byId('youBubble');
const foeBubble = byId('foeBubble');
const fxLayer = byId('fxLayer');
const arenaStage = byId('arenaStage');
const diceStage = byId('diceStage');
const dice = byId('dice');
const diceFace = byId('diceFace');
const diceCaption = byId('diceCaption');
const roundFlash = byId('roundFlash');
const actionGrid = byId('actionGrid');
const actionPrompt = byId('actionPrompt');
const battleLog = byId('battleLog');
const turnStat = byId('turnStat');
const waitingOverlay = byId('waitingOverlay');
const waitingText = byId('waitingText');
const waitingSub = byId('waitingSub');
const forfeitBtn = byId('forfeitBtn');
const emoteRow = byId('emoteRow');
const resultOverlay = byId('resultOverlay');
const resultCard = byId('resultCard');
const resultEyebrow = byId('resultEyebrow');
const resultTitle = byId('resultTitle');
const resultSubtitle = byId('resultSubtitle');
const rewardRow = byId('rewardRow');
const resultStats = byId('resultStats');
const rematchBtn = byId('rematchBtn');
const lobbyBtn = byId('lobbyBtn');
const rematchStatus = byId('rematchStatus');
const confettiCanvas = byId('confettiCanvas');
const toastStack = byId('toastStack');
// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let collection = loadCollection();
let profile = loadProfile();
let selectedUid = localStorage.getItem(ACTIVE_KEY) || ((_a = collection[0]) === null || _a === void 0 ? void 0 : _a.uid) || '';
let clientName = profile.name || 'Trainer';
let socket = null;
let connected = false;
let reconnectAttempts = 0;
let reconnectTimer = null;
let pendingAction = null;
let serverToken = localStorage.getItem(TOKEN_KEY) || '';
let mySide = 'a';
let matchId = null;
let mode = 'pvp';
let phase = 'lobby';
let you = null;
let foe = null;
let round = 1;
let deadline = 0;
let acted = false;
let foeActed = false;
let resolving = false;
let resultShown = false;
let lastEndedMatch = '';
let timerInterval = null;
let timeoutWarned = false;
let searchState = 'idle';
let currentRoom = '';
let opponentRematch = false;
let rematchRequested = false;
let lastTickSecond = 30;
let confettiFrame = 0;
let bubbleTimers = { you: null, foe: null };
// Normalise + persist the collection so old saves keep working.
localStorage.setItem(POKEMON_KEY, JSON.stringify(collection));
if (!selectedUid || !collection.some((mon) => mon.uid === selectedUid)) {
    selectedUid = ((_b = collection[0]) === null || _b === void 0 ? void 0 : _b.uid) || '';
}
localStorage.setItem(ACTIVE_KEY, selectedUid);
trainerNameInput.value = clientName;
soundBtn.textContent = sfx.enabled ? '🔊' : '🔇';
function selectedMon() {
    return collection.find((mon) => mon.uid === selectedUid) || collection[0];
}
function saveProfile() {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}
function saveCollection() {
    localStorage.setItem(POKEMON_KEY, JSON.stringify(collection));
}
function setName(name) {
    clientName = name.trim().slice(0, 18) || 'Trainer';
    profile.name = clientName;
    saveProfile();
    if (connected)
        send({ type: 'hello', name: clientName, token: serverToken });
}
// ---------------------------------------------------------------------------
// Lobby rendering
// ---------------------------------------------------------------------------
function renderMiniStats() {
    const streak = profile.streak > 0 ? `🔥 ${profile.streak}` : '—';
    miniStats.innerHTML = `
    <div class="mini-stat"><span class="mini-icon">⭐</span><div class="mini-body"><b>Lv. ${profile.level}</b><small>Trainer</small></div></div>
    <div class="mini-stat"><span class="mini-icon">🪙</span><div class="mini-body"><b>${profile.coins}</b><small>Coins</small></div></div>
    <div class="mini-stat"><span class="mini-icon">🔥</span><div class="mini-body"><b>${streak}</b><small>Win streak</small></div></div>
    <div class="mini-stat"><span class="mini-icon">🏆</span><div class="mini-body"><b>${profile.wins}</b><small>Victories</small></div></div>
  `;
}
function renderRoster() {
    rosterCount.textContent = String(collection.length);
    rosterEmpty.hidden = collection.length > 0;
    rosterGrid.innerHTML = collection
        .map((mon) => {
        const stats = mon.stats;
        const total = stats.hp + stats.attack + stats.defense + stats.specialAttack + stats.specialDefense + stats.speed;
        return `
        <button type="button" class="roster-card${mon.uid === selectedUid ? ' selected' : ''}" data-uid="${escapeHtml(mon.uid)}">
          <span class="roster-sprite"><img src="${escapeHtml(mon.sprite)}" alt="${escapeHtml(mon.name)}" loading="lazy"></span>
          <span class="roster-info">
            <h4>${escapeHtml(formatName(mon.name))}${mon.shiny ? ' ✦' : ''}</h4>
            <small>${escapeHtml(mon.types.join(' / '))} · BST ${total}</small>
          </span>
        </button>
      `;
    })
        .join('');
}
function statBar(label, value, max = 180) {
    const percent = clamp(Math.round((value / max) * 100), 4, 100);
    return `<div class="stat-bar"><span>${label}</span><span class="bar"><i style="width:${percent}%"></i></span><b>${value}</b></div>`;
}
function renderLoadout() {
    const mon = selectedMon();
    if (!mon) {
        loadoutPreview.innerHTML = `
      <div class="loadout-main">
        <div class="loadout-sprite">🎲</div>
        <div class="loadout-info">
          <h3>No DiceMon yet</h3>
          <p style="color:var(--muted);font-size:1.15rem;line-height:1.5">Head to your collection, roll a DiceMon, then come back to battle.</p>
        </div>
      </div>
    `;
        setLobbyButtonsEnabled(false);
        return;
    }
    const stats = mon.stats;
    loadoutPreview.innerHTML = `
    <div class="loadout-main">
      <div class="loadout-sprite"><img src="${escapeHtml(mon.sprite)}" alt="${escapeHtml(mon.name)}"></div>
      <div class="loadout-info">
        <h3>${escapeHtml(formatName(mon.name))}${mon.shiny ? ' <span style="color:var(--gold)">✦</span>' : ''}</h3>
        <div class="type-row">${typeBadges(mon.types)}</div>
        <div class="stat-bars">
          ${statBar('HP', stats.hp)}
          ${statBar('ATK', Math.max(stats.attack, stats.specialAttack))}
          ${statBar('DEF', Math.max(stats.defense, stats.specialDefense))}
          ${statBar('SPD', stats.speed)}
        </div>
      </div>
    </div>
  `;
    setLobbyButtonsEnabled(true);
}
function setLobbyButtonsEnabled(enabled) {
    const busy = searchState !== 'idle';
    const lock = !enabled || busy || phase !== 'lobby';
    quickMatchBtn.disabled = lock;
    createRoomBtn.disabled = lock;
    joinRoomBtn.disabled = lock;
    botBtn.disabled = lock;
    roomCodeInput.disabled = lock;
}
function setLobbyStatus(text, options = {}) {
    if (!text) {
        lobbyStatus.hidden = true;
        cancelQueueBtn.hidden = true;
        return;
    }
    lobbyStatus.hidden = false;
    lobbyStatusText.textContent = text;
    cancelQueueBtn.hidden = !options.cancel;
    const dot = lobbyStatus.querySelector('.status-dot');
    if (dot)
        dot.style.background = options.searching ? 'var(--blue)' : 'var(--gold)';
}
function resetSearchUi() {
    searchState = 'idle';
    currentRoom = '';
    roomBanner.hidden = true;
    setLobbyStatus(null);
    cancelQueueBtn.hidden = true;
    setLobbyButtonsEnabled(Boolean(selectedMon()) && phase === 'lobby');
}
function showRoomBanner(code) {
    searchState = 'room';
    currentRoom = code;
    roomCodeDisplay.textContent = code;
    roomBanner.hidden = false;
    setLobbyStatus('Room is open — share the code with a friend.', { searching: true });
    setLobbyButtonsEnabled(Boolean(selectedMon()));
}
function renderAll() {
    renderMiniStats();
    renderRoster();
    renderLoadout();
}
function selectMon(uid) {
    if (!collection.some((mon) => mon.uid === uid))
        return;
    selectedUid = uid;
    localStorage.setItem(ACTIVE_KEY, uid);
    sfx.play('select');
    renderRoster();
    renderLoadout();
}
// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
function send(message) {
    if (!socket || socket.readyState !== WebSocket.OPEN)
        return false;
    socket.send(JSON.stringify(message));
    return true;
}
function setOnlineState(isOnline) {
    connected = isOnline;
    onlinePill.classList.toggle('offline', !isOnline);
    if (!isOnline)
        onlineCount.textContent = '0';
}
function scheduleReconnect() {
    if (reconnectTimer)
        return;
    reconnectAttempts = Math.min(reconnectAttempts + 1, 8);
    const delay = Math.min(700 * reconnectAttempts, 5000);
    reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
    }, delay);
}
function connect() {
    if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN))
        return;
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.host || 'localhost:8000';
    try {
        socket = new WebSocket(`${protocol}://${host}/ws`);
    }
    catch (_a) {
        scheduleReconnect();
        return;
    }
    socket.onopen = () => {
        setOnlineState(true);
        reconnectAttempts = 0;
        send({ type: 'hello', name: clientName, token: serverToken || undefined });
        if (pendingAction) {
            const action = pendingAction;
            pendingAction = null;
            window.setTimeout(action, 80);
        }
    };
    socket.onmessage = (event) => {
        let message;
        try {
            message = JSON.parse(String(event.data));
        }
        catch (_a) {
            return;
        }
        handleMessage(message);
    };
    socket.onclose = () => {
        setOnlineState(false);
        socket = null;
        if (phase === 'battle') {
            waitingOverlay.hidden = false;
            waitingText.textContent = 'Reconnecting to your battle…';
            waitingSub.textContent = 'Hold tight';
        }
        scheduleReconnect();
    };
    socket.onerror = () => {
        setOnlineState(false);
    };
}
function ensureConnected(action) {
    if (connected && socket && socket.readyState === WebSocket.OPEN) {
        action();
        return;
    }
    pendingAction = action;
    setLobbyStatus('Connecting to the arena…', { searching: true });
    connect();
    if (!socket || socket.readyState === WebSocket.CLOSED) {
        toast('Could not reach the game server. Run `npm start` and reload.', 'error');
    }
}
function handleMessage(message) {
    switch (message.type) {
        case 'welcome': {
            if (typeof message.token === 'string' && message.token.length > 4) {
                serverToken = message.token;
                localStorage.setItem(TOKEN_KEY, serverToken);
            }
            if (typeof message.online === 'number') {
                onlineCount.textContent = String(message.online);
            }
            break;
        }
        case 'online': {
            onlineCount.textContent = String(Math.max(0, num(message.count, 0)));
            break;
        }
        case 'queue': {
            if (message.status === 'searching') {
                searchState = 'queue';
                setLobbyStatus('Searching for a rival trainer…', { cancel: true, searching: true });
                setLobbyButtonsEnabled(Boolean(selectedMon()));
            }
            else if (message.status === 'idle') {
                resetSearchUi();
                setLobbyStatus(null);
            }
            break;
        }
        case 'room': {
            if (message.status === 'waiting' && typeof message.code === 'string') {
                showRoomBanner(message.code);
                setLobbyButtonsEnabled(Boolean(selectedMon()));
            }
            else {
                if (message.status === 'expired')
                    toast('That room expired. Create a new one.', 'info');
                resetSearchUi();
            }
            break;
        }
        case 'match': {
            startMatch(message);
            break;
        }
        case 'round': {
            if (message.matchId !== matchId)
                return;
            handleRound(message);
            break;
        }
        case 'end': {
            if (message.matchId !== matchId)
                return;
            handleEnd(message);
            break;
        }
        case 'action-ack': {
            if (message.matchId && message.matchId !== matchId)
                return;
            acted = true;
            foeActed = Boolean(message.foeActed);
            updateActionButtons();
            renderStatuses();
            markPicked(String(message.action || ''));
            if (typeof message.energy === 'number' && you) {
                you.energy = message.energy;
                updateEnergy('you', message.energy);
            }
            if (message.foeActed) {
                showWaiting('Resolving the round…', 'Both moves locked in');
            }
            else {
                showWaiting('Waiting for your rival…', 'Move locked in');
            }
            break;
        }
        case 'emote': {
            const emoji = EMOTE_MAP[String(message.id)] || '💬';
            showBubble('foe', emoji);
            break;
        }
        case 'opponent-left': {
            if (foe) {
                foe.connected = false;
                renderStatuses();
            }
            toast(String(message.message || 'Your rival disconnected…'), 'error');
            const grace = num(message.grace, 20);
            if (phase === 'battle') {
                actionPrompt.textContent = `Rival disconnected — forfeit in ${grace}s unless they return`;
            }
            break;
        }
        case 'opponent-back': {
            if (foe) {
                foe.connected = true;
                renderStatuses();
            }
            toast(String(message.message || 'Your rival is back!'), 'good');
            if (phase === 'battle' && !acted && !resolving)
                actionPrompt.textContent = 'Choose your move';
            break;
        }
        case 'rematch': {
            if (message.status === 'challenge') {
                opponentRematch = true;
                rematchStatus.hidden = false;
                rematchStatus.textContent = `${String(message.from || 'Rival')} wants a rematch — hit Rematch!`;
                rematchBtn.disabled = false;
                rematchBtn.textContent = 'Accept Rematch';
            }
            else if (message.status === 'requested') {
                rematchStatus.hidden = false;
                rematchStatus.textContent = 'Rematch request sent… waiting for your rival.';
            }
            break;
        }
        case 'notice': {
            addLog(String(message.message || ''), 'system', '⏱');
            break;
        }
        case 'left': {
            resetToLobby(false);
            break;
        }
        case 'error': {
            const text = String(message.message || 'Something went wrong.');
            toast(text, 'error');
            if (searchState !== 'idle' && !matchId) {
                resetSearchUi();
            }
            break;
        }
        default:
            break;
    }
}
// ---------------------------------------------------------------------------
// Match lifecycle
// ---------------------------------------------------------------------------
function startMatch(message) {
    matchId = String(message.matchId);
    mySide = message.side === 'b' ? 'b' : 'a';
    mode = message.mode === 'bot' ? 'bot' : 'pvp';
    you = message.you;
    foe = message.foe;
    round = num(message.round, 1);
    deadline = num(message.deadline, Date.now() + TURN_MS);
    acted = Boolean(message.youActed);
    foeActed = Boolean(message.foeActed);
    resolving = false;
    phase = 'battle';
    resultShown = false;
    lastEndedMatch = '';
    rematchRequested = false;
    opponentRematch = false;
    timeoutWarned = false;
    resetSearchUi();
    resultOverlay.hidden = true;
    lobbyScreen.hidden = true;
    battleScreen.hidden = false;
    waitingOverlay.hidden = true;
    waitingOverlay.style.position = '';
    waitingOverlay.style.inset = '';
    battleMode.textContent = mode === 'bot'
        ? 'PRACTICE · WILD BOT'
        : `PVP · ${String(foe.name || 'Rival').toUpperCase()}`;
    battleLog.innerHTML = '';
    addLog(`A wild ${formatName(foe.mon.name)} appears!`, 'system', '⚡');
    addLog(`${you.name} sent out ${formatName(you.mon.name)}.`, 'system', '🎲');
    addLog(`${formatName(foe.mon.name)} is ready. Round 1 — choose your move!`, 'system', '🔔');
    renderBattle();
    startTimer();
    sfx.play('match');
    if (message.resumed) {
        toast('Reconnected to your battle.', 'good');
    }
    if (acted && !resolving) {
        showWaiting('Waiting for your rival…', 'Move locked in');
    }
}
function renderBattle() {
    if (!you || !foe)
        return;
    const setFighterChrome = (side, fighter, nameEl, levelEl, typesEl, spriteEl, figureEl, shinyEl) => {
        nameEl.textContent = formatName(fighter.mon.name);
        nameEl.title = `${fighter.name}'s DiceMon`;
        levelEl.textContent = `Lv.${fighter.mon.level || profile.level}`;
        typesEl.innerHTML = typeBadges(fighter.mon.types || [fighter.mon.type || 'normal']);
        if (fighter.mon.sprite)
            spriteEl.src = fighter.mon.sprite;
        spriteEl.alt = `${side === 'you' ? 'Your' : 'Rival'} ${formatName(fighter.mon.name)}`;
        figureEl.classList.toggle('shiny-glow', Boolean(fighter.mon.shiny));
        shinyEl.hidden = !fighter.mon.shiny;
    };
    setFighterChrome('you', you, youName, youLevel, youTypes, youSprite, youFigure, youShiny);
    setFighterChrome('foe', foe, foeName, foeLevel, foeTypes, foeSprite, foeFigure, foeShiny);
    updateHp('you', you.hp, you.maxHp);
    updateHp('foe', foe.hp, foe.maxHp);
    updateEnergy('you', you.energy);
    updateEnergy('foe', foe.energy);
    renderStatuses();
    roundNumber.textContent = String(round);
    turnStat.textContent = `${round} round${round === 1 ? '' : 's'} · ${you.name} vs ${foe.name}`;
    updateActionButtons();
}
function updateHp(side, hp, maxHp) {
    const fill = side === 'you' ? youHpFill : foeHpFill;
    const label = side === 'you' ? youHpText : foeHpText;
    const safeMax = Math.max(1, maxHp);
    const percent = clamp((hp / safeMax) * 100, 0, 100);
    fill.style.width = `${percent}%`;
    fill.classList.toggle('low', percent <= 25);
    fill.classList.toggle('mid', percent > 25 && percent <= 55);
    label.textContent = `${Math.max(0, Math.round(hp))} / ${Math.round(maxHp)}`;
}
function updateEnergy(side, energy) {
    const container = side === 'you' ? youEnergy : foeEnergy;
    const safeEnergy = clamp(Math.round(energy), 0, MAX_ENERGY);
    container.innerHTML = Array.from({ length: MAX_ENERGY }, (_, index) => `<span class="pip${index < safeEnergy ? ' on' : ''}"></span>`).join('');
}
function renderStatuses() {
    if (!you || !foe)
        return;
    const build = (fighter, lockedIn) => {
        const badges = [];
        if (fighter.guarding)
            badges.push('<span class="status-badge guard">🛡 Guarding</span>');
        if (fighter.charged)
            badges.push('<span class="status-badge focus">🧠 Charged 1.5×</span>');
        if (!fighter.connected)
            badges.push('<span class="status-badge vulnerable">🔌 Disconnected</span>');
        if (lockedIn && phase === 'battle')
            badges.push('<span class="status-badge waiting">✓ Locked in</span>');
        return badges.join('');
    };
    youStatus.innerHTML = build(you, acted);
    foeStatus.innerHTML = build(foe, foeActed);
    updateActionButtons();
}
function updateActionButtons() {
    if (!you || !foe || phase !== 'battle') {
        actionGrid.querySelectorAll('.action-btn').forEach((button) => {
            button.disabled = true;
        });
        return;
    }
    const lock = acted || resolving || !foe.connected;
    actionGrid.querySelectorAll('.action-btn').forEach((button) => {
        const action = button.dataset.action || '';
        const needsEnergy = action === 'blast' && you.energy < 2;
        button.disabled = lock || needsEnergy;
        button.classList.toggle('picked', acted && button.classList.contains('picked'));
        button.classList.toggle('blast-locked', action === 'blast' && you.energy < 2);
    });
    if (!acted && !resolving && foe.connected) {
        actionPrompt.textContent = foeActed ? 'Rival locked in — your move' : 'Choose your move';
    }
}
function showWaiting(text, sub) {
    waitingOverlay.hidden = false;
    waitingText.textContent = text;
    waitingSub.textContent = sub;
}
function hideWaiting() {
    waitingOverlay.hidden = true;
}
function startTimer() {
    stopTimer();
    lastTickSecond = TURN_MS / 1000;
    updateTimer();
    timerInterval = window.setInterval(updateTimer, 120);
}
function stopTimer() {
    if (timerInterval) {
        window.clearInterval(timerInterval);
        timerInterval = null;
    }
}
function updateTimer() {
    const remaining = Math.max(0, deadline - Date.now());
    const ratio = clamp(remaining / TURN_MS, 0, 1);
    timerFill.style.transform = `scaleX(${ratio})`;
    const seconds = Math.ceil(remaining / 1000);
    timerText.textContent = String(seconds);
    timerWrap.classList.toggle('urgent', remaining <= 8000);
    if (seconds <= 5 && seconds !== lastTickSecond && seconds > 0 && phase === 'battle' && !acted) {
        sfx.play('tick');
    }
    lastTickSecond = seconds;
    if (remaining <= 0 && !acted && phase === 'battle' && !resolving && !timeoutWarned) {
        timeoutWarned = true;
        doAction('strike', true);
    }
}
function markPicked(action) {
    actionGrid.querySelectorAll('.action-btn').forEach((button) => {
        button.classList.toggle('picked', button.dataset.action === action);
    });
    const meta = ACTION_META[action];
    if (meta)
        actionPrompt.textContent = `${meta.icon} ${meta.label} locked in`;
}
function doAction(action, auto = false) {
    if (phase !== 'battle' || acted || resolving || !you)
        return;
    if (action === 'blast' && you.energy < 2) {
        toast('Not enough energy for Blast — try Strike or Guard.', 'info');
        return;
    }
    if (!ACTION_META[action])
        return;
    const sent = send({ type: 'action', action });
    if (!sent) {
        toast('Not connected — reconnecting…', 'error');
        return;
    }
    acted = true;
    timeoutWarned = false;
    markPicked(action);
    updateActionButtons();
    renderStatuses();
    showWaiting(auto ? 'Time up — auto-strike!' : 'Waiting for your rival…', auto ? 'Auto action sent' : 'Move locked in');
    addLog(`You ${ACTION_META[action].verb}${auto ? ' (auto)' : ''}.`, 'system', ACTION_META[action].icon);
    sfx.play('click');
}
// ---------------------------------------------------------------------------
// Round animation
// ---------------------------------------------------------------------------
function sideOf(actor) {
    return actor === mySide ? 'you' : 'foe';
}
function fighterOn(side) {
    return side === 'you' ? you : foe;
}
function figureFor(side) {
    return side === 'you' ? youFigure : foeFigure;
}
function nameOn(side) {
    var _a;
    return formatName(((_a = fighterOn(side)) === null || _a === void 0 ? void 0 : _a.mon.name) || (side === 'you' ? 'You' : 'Rival'));
}
function animateClass(element, className, duration) {
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
    window.setTimeout(() => element.classList.remove(className), duration);
}
function stageCenter() {
    const stageRect = arenaStage.getBoundingClientRect();
    return { x: stageRect.width / 2, y: stageRect.height / 2 };
}
function figureCenter(side) {
    const stageRect = arenaStage.getBoundingClientRect();
    const rect = figureFor(side).getBoundingClientRect();
    return {
        x: rect.left - stageRect.left + rect.width / 2,
        y: rect.top - stageRect.top + rect.height / 2,
    };
}
function spawnFloat(side, text, kind) {
    const center = figureCenter(side);
    const element = document.createElement('div');
    element.className = `float-text ${kind}`;
    element.textContent = text;
    element.style.left = `${center.x}px`;
    element.style.top = `${center.y}px`;
    fxLayer.appendChild(element);
    window.setTimeout(() => element.remove(), 1000);
}
function spawnSpark(side) {
    const center = figureCenter(side);
    for (let index = 0; index < 3; index += 1) {
        const spark = document.createElement('span');
        spark.className = 'hit-spark';
        spark.style.left = `${center.x + (Math.random() * 46 - 23)}px`;
        spark.style.top = `${center.y + (Math.random() * 46 - 23)}px`;
        spark.style.animationDelay = `${index * 40}ms`;
        fxLayer.appendChild(spark);
        window.setTimeout(() => spark.remove(), 640);
    }
}
function stageFlash() {
    const flash = document.createElement('div');
    flash.className = 'stage-flash';
    arenaStage.appendChild(flash);
    window.setTimeout(() => flash.remove(), 340);
}
function showDice(side, roll, sides, crit) {
    return __awaiter(this, void 0, void 0, function* () {
        diceStage.hidden = false;
        dice.classList.remove('crit');
        dice.classList.remove('rolling');
        void dice.offsetWidth;
        dice.classList.add('rolling');
        diceCaption.textContent = `${nameOn(side)} rolls d${sides}…`;
        sfx.play('roll');
        const flicker = window.setInterval(() => {
            diceFace.textContent = String(1 + Math.floor(Math.random() * sides));
        }, 70);
        yield sleep(560);
        window.clearInterval(flicker);
        diceFace.textContent = String(roll);
        if (crit) {
            dice.classList.add('crit');
            diceCaption.textContent = `NATURAL ${roll}! Critical hit!`;
        }
        else {
            diceCaption.textContent = `${nameOn(side)} rolled ${roll}`;
        }
        yield sleep(620);
        diceStage.hidden = true;
    });
}
function effectivenessPhrase(event) {
    if (event.effectiveness === 'super')
        return 'Super effective!';
    if (event.effectiveness === 'weak')
        return 'Not very effective…';
    if (event.effectiveness === 'immune')
        return 'It had no effect…';
    return '';
}
function addLog(text, kind = '', icon = '•') {
    const line = document.createElement('div');
    line.className = `log-line ${kind}`;
    const iconElement = document.createElement('span');
    iconElement.className = 'log-icon';
    iconElement.textContent = icon;
    const textElement = document.createElement('span');
    textElement.textContent = text;
    line.append(iconElement, textElement);
    battleLog.appendChild(line);
    while (battleLog.children.length > 80) {
        battleLog.removeChild(battleLog.firstElementChild);
    }
    battleLog.scrollTop = battleLog.scrollHeight;
}
function playAttackEvent(event) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const actor = sideOf(event.actor);
        const target = sideOf(event.target);
        const action = String(event.action || 'strike');
        const meta = ACTION_META[action] || ACTION_META.strike;
        animateClass(figureFor(actor), actor === 'you' ? 'attacking-you' : 'attacking-foe', 460);
        yield showDice(actor, num(event.roll, 1), num(event.sides, 6), Boolean(event.crit));
        yield sleep(80);
        animateClass(figureFor(target), 'hurt', 460);
        spawnSpark(target);
        spawnFloat(target, `-${num(event.damage, 0)}`, event.crit ? 'damage crit' : 'damage');
        if (event.crit) {
            stageFlash();
            sfx.play('crit');
        }
        else {
            sfx.play('hit');
        }
        const targetMax = ((_a = fighterOn(target)) === null || _a === void 0 ? void 0 : _a.maxHp) || 100;
        updateHp(target, num(event.hpAfter, 0), targetMax);
        if (fighterOn(target)) {
            fighterOn(target).hp = num(event.hpAfter, 0);
        }
        const phrases = [];
        if (event.crit)
            phrases.push('CRITICAL HIT');
        if (event.charged)
            phrases.push('charged 1.5×');
        const effectiveness = effectivenessPhrase(event);
        if (effectiveness)
            phrases.push(effectiveness);
        addLog(`${nameOn(actor)} ${meta.verb} — rolled ${num(event.roll, 1)}/${num(event.sides, 6)} for ${num(event.damage, 0)} damage${phrases.length ? ` · ${phrases.join(' · ')}` : ''}.`, event.crit ? 'crit' : actor === 'you' ? 'good' : 'bad', event.crit ? '💥' : meta.icon);
        yield sleep(650);
    });
}
function playEvents(events) {
    return __awaiter(this, void 0, void 0, function* () {
        for (const event of events) {
            switch (event.kind) {
                case 'guard': {
                    const side = sideOf(event.actor);
                    spawnFloat(side, `+${num(event.heal, 0)}`, 'heal');
                    stageFlash();
                    sfx.play('guard');
                    addLog(`${nameOn(side)} raised a guard, healing ${num(event.heal, 0)} HP.`, side === 'you' ? 'good' : 'bad', '🛡️');
                    if (fighterOn(side)) {
                        fighterOn(side).guarding = true;
                        fighterOn(side).hp = Math.min(fighterOn(side).maxHp, fighterOn(side).hp + num(event.heal, 0));
                    }
                    renderStatuses();
                    yield sleep(520);
                    break;
                }
                case 'focus': {
                    const side = sideOf(event.actor);
                    animateClass(figureFor(side), 'charging', 900);
                    spawnFloat(side, '+2⚡', 'energy');
                    sfx.play('focus');
                    addLog(`${nameOn(side)} focused — next attack deals 1.5× damage!`, side === 'you' ? 'good' : 'bad', '🧠');
                    if (fighterOn(side))
                        fighterOn(side).charged = true;
                    if (typeof event.energy === 'number')
                        updateEnergy(side, event.energy);
                    renderStatuses();
                    yield sleep(620);
                    break;
                }
                case 'no-energy': {
                    const side = sideOf(event.actor);
                    addLog(`${nameOn(side)} fizzled — not enough energy, downgraded to Strike.`, 'system', '⚠️');
                    yield sleep(420);
                    break;
                }
                case 'attack': {
                    yield playAttackEvent(event);
                    if (typeof event.energy === 'number')
                        updateEnergy(sideOf(event.actor), event.energy);
                    break;
                }
                case 'faint': {
                    const side = sideOf(event.actor);
                    figureFor(side).classList.add('fainted');
                    addLog(`${nameOn(side)} fainted!`, side === 'you' ? 'bad' : 'good', '💫');
                    sfx.play(side === 'you' ? 'lose' : 'win');
                    yield sleep(700);
                    break;
                }
                case 'round-end': {
                    if (event.energy && typeof event.energy === 'object') {
                        updateEnergy(mySide === 'a' ? 'you' : 'foe', event.energy.a);
                        updateEnergy(mySide === 'b' ? 'you' : 'foe', event.energy.b);
                    }
                    yield sleep(220);
                    break;
                }
                case 'end': {
                    yield sleep(150);
                    break;
                }
                default:
                    break;
            }
        }
    });
}
function applyFinalState(message) {
    if (message.you)
        you = message.you;
    if (message.foe)
        foe = message.foe;
    if (typeof message.round === 'number')
        round = message.round;
    if (typeof message.deadline === 'number')
        deadline = message.deadline;
    resultShown = false;
    renderBattle();
}
function handleRound(message) {
    return __awaiter(this, void 0, void 0, function* () {
        if (resolving || phase !== 'battle')
            return;
        resolving = true;
        stopTimer();
        hideWaiting();
        setActionButtonsLocked(true);
        const events = Array.isArray(message.events) ? message.events : [];
        yield playEvents(events);
        you = message.you;
        foe = message.foe;
        round = num(message.round, round + 1);
        deadline = num(message.deadline, Date.now() + TURN_MS);
        acted = false;
        foeActed = false;
        resolving = false;
        timeoutWarned = false;
        renderBattle();
        hideWaiting();
        sfx.play('tick');
        startTimer();
    });
}
function setActionButtonsLocked(locked) {
    actionGrid.querySelectorAll('.action-btn').forEach((button) => {
        button.disabled = locked;
    });
    if (locked)
        actionPrompt.textContent = 'Resolving the round…';
}
function handleEnd(message) {
    return __awaiter(this, void 0, void 0, function* () {
        if (phase === 'ended' || resultShown)
            return;
        phase = 'ended';
        resolving = false;
        stopTimer();
        hideWaiting();
        setActionButtonsLocked(true);
        const events = Array.isArray(message.events) ? message.events : [];
        if (events.length) {
            yield playEvents(events);
        }
        you = message.you || you;
        foe = message.foe || foe;
        renderBattle();
        resultShown = true;
        lastEndedMatch = matchId || '';
        const outcome = String(message.winner || 'draw');
        const reason = String(message.reason || 'ko');
        const rewards = message.rewards || { coins: 0, xp: 0 };
        const baseCoins = Math.max(0, num(rewards.coins, 0));
        const baseXp = Math.max(0, num(rewards.xp, 0));
        let streakBonus = 0;
        let xpBonus = 0;
        let levelUps = 0;
        if (outcome === 'you') {
            profile.wins += 1;
            profile.streak += 1;
            profile.bestStreak = Math.max(profile.bestStreak, profile.streak);
            streakBonus = profile.streak * 5;
            xpBonus = profile.streak * 3;
        }
        else if (outcome === 'foe') {
            profile.losses += 1;
            profile.streak = 0;
        }
        profile.coins += baseCoins + streakBonus;
        profile.xp += baseXp + xpBonus;
        let threshold = profile.level * 100;
        while (profile.xp >= threshold && profile.level < 100) {
            profile.xp -= threshold;
            profile.level += 1;
            profile.coins += 60;
            levelUps += 1;
            threshold = profile.level * 100;
        }
        saveProfile();
        renderMiniStats();
        const totalCoins = baseCoins + streakBonus;
        const totalXp = baseXp + xpBonus;
        resultCard.classList.toggle('win', outcome === 'you');
        resultCard.classList.toggle('loss', outcome === 'foe');
        resultEyebrow.textContent = outcome === 'draw' ? 'DRAW' : outcome === 'you' ? 'BATTLE WON' : 'BATTLE LOST';
        resultTitle.textContent = outcome === 'you' ? 'Victory!' : outcome === 'foe' ? 'Defeat' : 'Draw';
        resultSubtitle.textContent = reason === 'disconnect'
            ? 'Your rival lost connection. The arena rewards patience.'
            : reason === 'forfeit'
                ? 'Your rival forfeited the battle.'
                : outcome === 'you'
                    ? 'The dice favored the bold. Beautifully played.'
                    : outcome === 'foe'
                        ? 'A tough roll. Regroup and take the rematch.'
                        : 'Both DiceMon went down swinging.';
        rewardRow.innerHTML = `
    <span class="reward-chip gold">🪙 +${totalCoins} coins</span>
    <span class="reward-chip xp">✨ +${totalXp} XP</span>
    ${streakBonus > 0 ? `<span class="reward-chip streak">🔥 ${profile.streak} win streak · +${streakBonus}</span>` : ''}
    ${levelUps > 0 ? `<span class="reward-chip levelup">⭐ Level ${profile.level}!</span>` : ''}
  `;
        resultStats.innerHTML = `
    <span>Rounds <b>${Math.max(1, round - 1)}</b></span>
    <span>Your HP <b>${Math.max(0, Math.round((you === null || you === void 0 ? void 0 : you.hp) || 0))}</b></span>
    <span>Streak <b>${profile.streak}</b></span>
    <span>Record <b>${profile.wins}W · ${profile.losses}L</b></span>
  `;
        rematchBtn.disabled = false;
        rematchBtn.textContent = 'Request Rematch';
        rematchStatus.hidden = true;
        resultOverlay.hidden = false;
        if (outcome === 'you') {
            sfx.play('win');
            launchConfetti(3200);
        }
        else if (outcome === 'foe') {
            sfx.play('lose');
        }
        if (opponentRematch) {
            rematchBtn.textContent = 'Accept Rematch';
            rematchStatus.hidden = false;
            rematchStatus.textContent = 'Your rival already asked for a rematch!';
        }
    });
}
function launchConfetti(duration) {
    const canvas = confettiCanvas;
    const context = canvas.getContext('2d');
    if (!context)
        return;
    if (confettiFrame)
        window.cancelAnimationFrame(confettiFrame);
    canvas.hidden = false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const colors = ['#ffcb57', '#ff4d5e', '#4da6ff', '#46e08a', '#a772ff', '#ff6fb5', '#ffffff'];
    const pieces = Array.from({ length: 160 }, () => ({
        x: Math.random() * window.innerWidth,
        y: -30 - Math.random() * window.innerHeight * 0.55,
        w: 5 + Math.random() * 7,
        h: 8 + Math.random() * 11,
        vx: -1.1 + Math.random() * 2.2,
        vy: 2.2 + Math.random() * 4.4,
        rotate: Math.random() * Math.PI,
        spin: -0.12 + Math.random() * 0.24,
        color: colors[Math.floor(Math.random() * colors.length)],
    }));
    const started = performance.now();
    const frame = (now) => {
        context.clearRect(0, 0, window.innerWidth, window.innerHeight);
        for (const piece of pieces) {
            piece.x += piece.vx;
            piece.y += piece.vy;
            piece.vy += 0.035;
            piece.rotate += piece.spin;
            if (piece.y > window.innerHeight + 40) {
                piece.y = -20;
                piece.x = Math.random() * window.innerWidth;
                piece.vy = 2.2 + Math.random() * 4;
            }
            context.save();
            context.translate(piece.x, piece.y);
            context.rotate(piece.rotate);
            context.fillStyle = piece.color;
            context.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h);
            context.restore();
        }
        if (now - started < duration) {
            confettiFrame = window.requestAnimationFrame(frame);
        }
        else {
            context.clearRect(0, 0, window.innerWidth, window.innerHeight);
            canvas.hidden = true;
            confettiFrame = 0;
        }
    };
    confettiFrame = window.requestAnimationFrame(frame);
}
function stopConfetti() {
    if (confettiFrame)
        window.cancelAnimationFrame(confettiFrame);
    confettiFrame = 0;
    confettiCanvas.hidden = true;
    const context = confettiCanvas.getContext('2d');
    if (context)
        context.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
}
// ---------------------------------------------------------------------------
// Bubbles, toasts, lobby reset
// ---------------------------------------------------------------------------
function showBubble(side, emoji) {
    const bubble = side === 'you' ? youBubble : foeBubble;
    bubble.hidden = false;
    bubble.textContent = emoji;
    bubble.classList.remove('bubble');
    void bubble.offsetWidth;
    bubble.classList.add('bubble');
    if (bubbleTimers[side])
        window.clearTimeout(bubbleTimers[side]);
    bubbleTimers[side] = window.setTimeout(() => {
        bubble.hidden = true;
    }, 2200);
}
function toast(text, kind = 'info') {
    const element = document.createElement('div');
    element.className = `toast ${kind}`;
    element.textContent = text;
    toastStack.appendChild(element);
    while (toastStack.children.length > 4) {
        toastStack.removeChild(toastStack.firstElementChild);
    }
    window.setTimeout(() => {
        element.classList.add('leaving');
        window.setTimeout(() => element.remove(), 260);
    }, 3800);
}
function resetToLobby(tellServer = true) {
    if (tellServer)
        send({ type: 'leave' });
    stopTimer();
    stopConfetti();
    phase = 'lobby';
    matchId = null;
    you = null;
    foe = null;
    acted = false;
    foeActed = false;
    resolving = false;
    resultShown = false;
    currentRoom = '';
    opponentRematch = false;
    rematchRequested = false;
    resultOverlay.hidden = true;
    waitingOverlay.hidden = true;
    battleScreen.hidden = true;
    lobbyScreen.hidden = false;
    resetSearchUi();
    renderAll();
    timerFill.style.transform = 'scaleX(1)';
    timerText.textContent = '30';
    timerWrap.classList.remove('urgent');
}
// ---------------------------------------------------------------------------
// Lobby actions
// ---------------------------------------------------------------------------
function wireMon() {
    const mon = selectedMon();
    if (!mon) {
        toast('Roll a DiceMon on the home page first!', 'info');
        return null;
    }
    return {
        name: mon.name,
        sprite: mon.sprite,
        shiny: Boolean(mon.shiny),
        types: mon.types,
        level: profile.level,
        stats: mon.stats,
    };
}
function beginSearch() {
    const mon = wireMon();
    if (!mon)
        return;
    setName(trainerNameInput.value);
    ensureConnected(() => {
        const sent = send({ type: 'queue', mon });
        if (!sent) {
            resetSearchUi();
            toast('Not connected to the arena yet. Try again in a second.', 'error');
            return;
        }
        searchState = 'queue';
        setLobbyStatus('Searching for a rival trainer…', { cancel: true, searching: true });
        setLobbyButtonsEnabled(Boolean(selectedMon()));
        sfx.play('click');
    });
}
function createRoom() {
    const mon = wireMon();
    if (!mon)
        return;
    setName(trainerNameInput.value);
    ensureConnected(() => {
        const sent = send({ type: 'create-room', mon });
        if (!sent) {
            toast('Not connected to the arena yet. Try again in a second.', 'error');
            return;
        }
        searchState = 'room';
        setLobbyButtonsEnabled(Boolean(selectedMon()));
        sfx.play('click');
    });
}
function joinRoom() {
    const code = roomCodeInput.value.trim().toUpperCase();
    if (code.length !== 4) {
        toast('Enter the 4-character room code.', 'info');
        return;
    }
    const mon = wireMon();
    if (!mon)
        return;
    setName(trainerNameInput.value);
    ensureConnected(() => {
        const sent = send({ type: 'join-room', code, mon });
        if (!sent) {
            toast('Not connected to the arena yet. Try again in a second.', 'error');
            return;
        }
        searchState = 'room';
        setLobbyStatus(`Joining room ${code}…`, { searching: true });
        sfx.play('click');
    });
}
function startBotMatch() {
    const mon = wireMon();
    if (!mon)
        return;
    setName(trainerNameInput.value);
    ensureConnected(() => {
        const sent = send({ type: 'bot', mon });
        if (!sent) {
            toast('Not connected to the arena yet. Try again in a second.', 'error');
            return;
        }
        setLobbyStatus('Summoning a wild BOT…', { searching: true });
        sfx.play('click');
    });
}
function cancelSearch() {
    if (searchState === 'queue') {
        send({ type: 'dequeue' });
    }
    else if (searchState === 'room') {
        send({ type: 'cancel-room' });
    }
    resetSearchUi();
    sfx.play('click');
}
// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------
quickMatchBtn.addEventListener('click', beginSearch);
createRoomBtn.addEventListener('click', createRoom);
joinRoomBtn.addEventListener('click', joinRoom);
botBtn.addEventListener('click', startBotMatch);
cancelQueueBtn.addEventListener('click', cancelSearch);
cancelRoomBtn.addEventListener('click', cancelSearch);
roomCodeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter')
        joinRoom();
});
roomCodeInput.addEventListener('input', () => {
    roomCodeInput.value = roomCodeInput.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 4);
});
copyCodeBtn.addEventListener('click', () => {
    if (!currentRoom)
        return;
    const done = () => toast(`Room code ${currentRoom} copied!`, 'good');
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(currentRoom).then(done).catch(() => {
            toast(`Room code: ${currentRoom}`, 'info');
        });
    }
    else {
        toast(`Room code: ${currentRoom}`, 'info');
    }
});
trainerNameInput.addEventListener('change', () => {
    setName(trainerNameInput.value);
    trainerNameInput.value = clientName;
    sfx.play('click');
});
rosterGrid.addEventListener('click', (event) => {
    const target = event.target;
    const card = target.closest('.roster-card');
    if (!card || !card.dataset.uid)
        return;
    selectMon(card.dataset.uid);
});
actionGrid.addEventListener('click', (event) => {
    const target = event.target;
    const button = target.closest('.action-btn');
    if (!button || button.disabled)
        return;
    const action = button.dataset.action;
    if (action)
        doAction(action);
});
emoteRow.addEventListener('click', (event) => {
    const target = event.target;
    const button = target.closest('button[data-emote]');
    if (!button || !button.dataset.emote)
        return;
    const id = button.dataset.emote;
    const emoji = EMOTE_MAP[id];
    if (!emoji)
        return;
    if (!send({ type: 'emote', id })) {
        toast('Emotes need a live connection.', 'error');
        return;
    }
    showBubble('you', emoji);
    sfx.play('click');
});
forfeitBtn.addEventListener('click', () => {
    if (phase !== 'battle')
        return;
    if (!window.confirm('Forfeit this battle? Your rival will take the win.'))
        return;
    send({ type: 'leave' });
    resetToLobby(false);
});
rematchBtn.addEventListener('click', () => {
    if (phase !== 'ended' || rematchRequested)
        return;
    rematchRequested = true;
    rematchBtn.disabled = true;
    rematchBtn.textContent = 'Rematch requested';
    rematchStatus.hidden = false;
    rematchStatus.textContent = mode === 'bot'
        ? 'Rolling a new wild BOT…'
        : 'Rematch request sent… waiting for your rival.';
    if (!send({ type: 'rematch' })) {
        toast('Not connected — cannot request a rematch.', 'error');
        rematchBtn.disabled = false;
        rematchBtn.textContent = 'Request Rematch';
    }
    sfx.play('click');
});
lobbyBtn.addEventListener('click', () => {
    send({ type: 'leave' });
    resetToLobby(false);
});
soundBtn.addEventListener('click', () => {
    sfx.enabled = !sfx.enabled;
    localStorage.setItem(SOUND_KEY, sfx.enabled ? 'on' : 'off');
    soundBtn.textContent = sfx.enabled ? '🔊' : '🔇';
    if (sfx.enabled) {
        sfx.play('select');
        toast('Sound on', 'good');
    }
    else {
        toast('Sound off', 'info');
    }
});
document.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return;
    if (phase !== 'battle' || resultOverlay.hidden === false)
        return;
    const map = { '1': 'strike', '2': 'blast', '3': 'guard', '4': 'focus' };
    const action = map[event.key];
    if (!action)
        return;
    event.preventDefault();
    doAction(action);
});
window.addEventListener('online', () => connect());
window.addEventListener('beforeunload', () => {
    if (phase === 'battle')
        send({ type: 'leave' });
});
// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
renderAll();
resetSearchUi();
connect();
// Refresh the battle timer label once a second even when the tab was asleep.
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && phase === 'battle')
        updateTimer();
});
export {};
