// ═══════════════════════════════════════════════════════════════════
//  ELLINIA TRACKER — SillyTavern Extension
//  Drop into: SillyTavern/public/extensions/third-party/ellinia-tracker/
// ═══════════════════════════════════════════════════════════════════

import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types, user_avatar, getThumbnailUrl, characters, this_chid, chat_metadata, saveChatDebounced, setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from '../../../../script.js';


// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const EXT_NAME    = 'ellinia_tracker';
const EXT_VERSION = '1.0.0';

const RANK_ORDER  = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'Mythic'];
const RANK_COLORS = {
    F: '#888888', E: '#aaaaaa', D: '#52e05a',
    C: '#52b0e0', B: '#c070f0', A: '#e09c52',
    S: '#f0e050', Mythic: '#ff5ab0'
};
const SOFT_CAPS = { F: 20, E: 35, D: 55, C: 80, B: 120, A: 180, S: 250 };
const DISCIPLINES = ['Combat', 'Crafting', 'Magic', 'Trade', 'Gathering'];
const STATS       = ['STR', 'AGI', 'VIT', 'INT', 'WIS', 'LCK'];
const EQUIP_SLOTS = ['weapon', 'helm', 'chest', 'gloves', 'boots', 'accessory1', 'accessory2'];
const SLOT_LABELS = {
    weapon: '⚔ Weapon', helm: '⛉ Helm', chest: '⚁ Chest',
    gloves: '◌ Gloves', boots: '⬡ Boots', accessory1: '◈ Acc I', accessory2: '◈ Acc II'
};
const TIER_COLORS = {
    Common: '#888888', Uncommon: '#52e05a', Rare: '#5282e0',
    Epic:   '#c070f0', Legendary: '#e09c52', Unique: '#ff5ab0'
};
const ABO_ICONS   = { Alpha: '◆', Beta: '◇', Omega: '○' };
const STATUS_COLORS = { neutral: '#6a8eaa', heat: '#e05252', rut: '#e09c52' };

// NPC presets with known lore data
const NPC_PRESETS = {
    'Hoshi':           { class: 'Dual Blade',     classRank: 'B', aboGender: 'Alpha', adventurerRank: 'B' },
    'Dokyeom':         { class: 'Blacksmith',      classRank: 'F', aboGender: 'Beta',  adventurerRank: 'F' },
    'Mira':            { class: 'Guild Registrar', classRank: 'D', aboGender: 'Beta',  adventurerRank: 'D' },
    'Commander Sera':  { class: 'Warrior',         classRank: 'A', aboGender: 'Beta',  adventurerRank: 'A' },
    'Calder':          { class: 'Warrior',         classRank: 'C', aboGender: 'Beta',  adventurerRank: 'C' },
    'Sable':           { class: 'Rogue',           classRank: 'B', aboGender: 'Beta',  adventurerRank: 'B' },
    'Athena Pierce':   { class: 'Bowmaster',       classRank: 'A', aboGender: 'Beta',  adventurerRank: 'S' },
    'Grendel':         { class: 'Archmage',        classRank: 'S', aboGender: 'Beta',  adventurerRank: 'S' },
};

// ─── DATA FACTORIES ───────────────────────────────────────────────────────────

function makeCharacter(name = '', isPlayer = false, preset = {}, isCharPlayer = false) {
    return {
        name,
        isPlayer,
        isCharPlayer,
        class:          preset.class         || (isPlayer ? 'Blacksmith' : ''),
        classRank:      preset.classRank      || 'F',
        aboGender:      preset.aboGender      || 'Beta',
        aboStatus:      'neutral',
        adventurerRank: preset.adventurerRank || 'F',
        hp:             { current: 100, max: 100 },
        mana:           { current: 50,  max: 50  },
        stats:          { STR: 10, AGI: 10, VIT: 10, INT: 10, WIS: 10, LCK: 10 },
        disciplines: {
            Combat:    { xp: 0, level: 1 },
            Crafting:  { xp: 0, level: 1 },
            Magic:     { xp: 0, level: 1 },
            Trade:     { xp: 0, level: 1 },
            Gathering: { xp: 0, level: 1 },
        },
        skills:           [],
        equipment:        { weapon: null, helm: null, chest: null, gloves: null, boots: null, accessory1: null, accessory2: null },
        inventory:        [],
        mesos:            0,
        statusEffects:    [],
        threadSightLevel: isPlayer ? 1 : 0,
        greatSageLevel:   isCharPlayer ? 1 : 0,
        notes:            '',
    };
}

const DEFAULT_SETTINGS = {
    connectionProfile: '',
    completionPreset:  '',
    autoUpdate:        true,
    contextMessages:   3,
    injectEnabled:     true,
    injectDepth:       0,
    injectSections: {
        player:     true,
        charPlayer: true,
        npcs:       true,
        equipment:  true,
        inventory:  true,
        skills:     true,
        status:     true,
    },
    state: {
        player:     null,
        charPlayer: null,
        npcs:       {}
    }
};

// ─── EXTRACTION SYSTEM PROMPT ─────────────────────────────────────────────────
// World-specific — baked from ellinia_master_v21 entries 5,6,8,9,10,11,13,24,32,33,103,141,151

const EXTRACTION_SYSTEM = `You are a precision stat-tracker for a collaborative roleplay set in Ellinia — a MapleStory-inspired isekai world. Your sole function is to read the provided roleplay excerpt and detect any changes to character state that are implied or stated.

== ELLINIA WORLD RULES ==

STATS (6 core attributes, integer values):
• STR — raw physical force; melee damage, forging quality, carry weight. Primary: Warrior, Blacksmith. Alpha biology adds ~12% STR floor.
• AGI — speed, evasion, precision. Primary: Rogue, Archer. Drops during Omega active heat; spikes during Alpha rut (at cost of precision).
• VIT — maximum HP pool, endurance, physical status resistance, recovery rate. Primary: Warrior. Alpha gain bonus VIT under stress.
• INT — magic damage output, spell efficiency, elemental potency. Primary: Mage. Goddess skills (Thread Sight, Great Sage) scale with INT. Omegas carry slight natural INT uplift.
• WIS — mana pool size, mana recovery rate, skill discovery rate, crafting insight depth. Primary: Priest, Blacksmith secondary. Omega natural WIS advantage.
• LCK — crit rate, loot quality multiplier, skill evolution frequency, rare material yield. Summoned Ones carry passive Goddess-origin LCK bonus.

HP AND MANA:
• HP derives from VIT; has current and max values tracked separately.
• Mana derives from INT+WIS; has current and max values tracked separately.
• Mana depletion causes physical backlash; pushing past 0 is dangerous.

DISCIPLINES (5 XP pools, tracked independently):
• Combat, Crafting, Magic, Trade, Gathering.
• Total level = sum of all discipline levels. A Blacksmith's Crafting XP matters far more than Combat.
• XP thresholds: approximately 100 × level^1.5 XP per level.

SKILLS:
• Every skill has a Rank (F/E/D/C/B/A/S/Mythic) and a Level (1–10 within rank).
• Skills unlock organically through repeated action, danger, or milestone — never from trainers.
• Rank F = common, Rank S = continent-famous. Mythic has no confirmed living bearers this era.
• Level 10 mastery is required before rank evolution is possible.

CLASS SYSTEM:
• Birthright class is immutable. Social rank F–S. Support classes (Blacksmith, Gatherer, Miner, Alchemist, Builder, Merchant, Armourer) are Rank F–D. Combat classes (Warrior, Mage, Rogue, Archer, Priest → advanced forms) are C–S.
• Edge Sovereign is an S-class legendary that hides as Dual Blade (B) until triggered by near-death crisis.

ADVENTURER RANK:
• Separate from class rank. F through S. Capped by class rank — support classes ceiling early.

ABO SUBGENDER (hidden layer, not in Guild records):
• Alpha: +STR floor, bonus VIT under stress, minor AGI spike in rut.
• Omega: minor +INT, +WIS; -AGI and -VIT during active heat.
• Beta: no modifier.
• Active status: neutral / heat (Omega) / rut (Alpha).

THREAD SIGHT (player Ken's Goddess-gifted skill only — no NPC has this):
• Level 1: Common-tier materials legible. Level 2: Uncommon. Level 3: Rare + mana reserve assessment. Level 4: weak point detection in combat. Level 5: Epic-tier, full HUD crafting expansion.

EQUIPMENT:
• Slots: weapon, helm, chest, gloves, boots, accessory1, accessory2.
• Tiers: Common, Uncommon, Rare, Epic, Legendary, Unique.
• Each item has a name, tier, and optional runes array (infusion slots).
• Unique items drop only from Mythical bosses and cannot be crafted.

INVENTORY:
• Items have name, quantity, and tier.
• Material tiers mirror equipment tiers.

CURRENCY:
• Mesos — integer value.

STATUS EFFECTS:
• Named, with duration (in turns) and an effect description.
• Poison halves mana recovery and WIS-modified damage per turn. Mana drain, paralysis, etc. are all possible.

== OUTPUT FORMAT ==
Return ONLY a valid JSON array. Each element represents one character with detected changes:
{
  "character": "player" OR "<NPC name as used in the scene>",
  "updates": {
    // Include ONLY fields that changed. All fields optional.
    "name": string,
    "class": string,
    "classRank": string,
    "aboGender": "Alpha"|"Beta"|"Omega",
    "aboStatus": "neutral"|"heat"|"rut",
    "adventurerRank": string,
    "hp": { "current": number, "max": number },
    "mana": { "current": number, "max": number },
    "stats": { "STR"?: number, "AGI"?: number, "VIT"?: number, "INT"?: number, "WIS"?: number, "LCK"?: number },
    "disciplines": {
      "Combat"?:    { "xp": number, "level": number },
      "Crafting"?:  { "xp": number, "level": number },
      "Magic"?:     { "xp": number, "level": number },
      "Trade"?:     { "xp": number, "level": number },
      "Gathering"?: { "xp": number, "level": number }
    },
    "skills": [
      { "action": "add"|"update"|"remove", "name": string, "rank"?: string, "level"?: number, "description"?: string }
    ],
    "equipment": {
      "weapon"?:     { "name": string, "tier": string, "runes": string[] } | null,
      "helm"?:       { "name": string, "tier": string, "runes": string[] } | null,
      "chest"?:      { "name": string, "tier": string, "runes": string[] } | null,
      "gloves"?:     { "name": string, "tier": string, "runes": string[] } | null,
      "boots"?:      { "name": string, "tier": string, "runes": string[] } | null,
      "accessory1"?: { "name": string, "tier": string, "runes": string[] } | null,
      "accessory2"?: { "name": string, "tier": string, "runes": string[] } | null
    },
    "inventory": [
      { "action": "add"|"remove"|"update", "name": string, "quantity"?: number, "tier"?: string }
    ],
    "mesos": number,
    "statusEffects": [
      { "action": "add"|"remove", "name": string, "duration"?: number, "effect"?: string }
    ],
    "threadSightLevel": number,
    "greatSageLevel": number,
    "notes": string
  }
}

SPECIAL ABILITIES:
• Thread Sight ({{user}} only) — a Goddess-granted sensory skill. Levels 1–5. Upgrades when the narrative explicitly states Ken's Thread Sight improved or leveled up. Do NOT infer upgrades from general perception improvements.
• Great Sage ({{char}} only) — a built-in analytical familiar. Levels 1–5. Stage names and triggers:
  Lv.1 Ledger: outputs raw stats and hit probability only, no inference. Triggers when Great Sage is first invoked or gives basic combat data.
  Lv.2 Ledger: elemental weaknesses and cooldown tracking added. Triggers when Great Sage tracks debuffs or resistances.
  Lv.3 Ledger: multi-target comparison unlocked. Triggers when Great Sage compares multiple enemies or options simultaneously.
  Lv.4 Analyst: reads battlefield flow, first conditional recommendations. Triggers when Great Sage gives if/then tactical advice.
  Lv.5 Analyst: behavioral pattern recognition, basic intent inference in combat. Triggers when Great Sage predicts enemy behavior or intent.
  Only increment greatSageLevel when the narrative explicitly shows Great Sage demonstrating a new capability tier. Do NOT increment for routine use of existing abilities.

If nothing changed, return [].
Return ONLY the JSON array. No markdown fences, no explanation, no preamble.`;

// ─── RUNTIME STATE ────────────────────────────────────────────────────────────

let settings          = {};
let isParsing         = false;
let _abortCtrl        = null;
let _activePlayerView = 'user'; // 'user' | 'char'

// ─── UTILITIES ────────────────────────────────────────────────────────────────

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

const _elLogEntries = [];
function elLog(msg) {
    const ts = new Date().toLocaleTimeString();
    _elLogEntries.unshift(`[${ts}] ${msg}`);
    if (_elLogEntries.length > 50) _elLogEntries.pop();
    const el = document.getElementById('el-debug-log');
    if (el) el.innerHTML = _elLogEntries.map(l =>
        `<div class="el-log-line">${escapeHtml(l)}</div>`
    ).join('');
    console.debug('[EL]', msg);
}

// ─── SETTINGS INIT ────────────────────────────────────────────────────────────

function initSettings() {
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = structuredClone(DEFAULT_SETTINGS);
    }
    settings = extension_settings[EXT_NAME];
    // Patch missing config keys
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
        if (k !== 'state' && settings[k] === undefined) settings[k] = structuredClone(v);
    }
    // State lives in chat_metadata, not extension_settings — init blank placeholder
    if (!settings.state) settings.state = { player: makeCharacter(getContext().name1 || 'Player', true), npcs: {} };
}

// Load per-chat state from chat_metadata (called on init + CHAT_CHANGED)
function loadChatState() {
    const ctx        = getContext();
    const playerName = ctx.name1 || 'Player';
    const charName   = ctx.name2 || 'Character';

    if (chat_metadata?.ellinia_state) {
        settings.state = chat_metadata.ellinia_state;
        if (!settings.state.player)     settings.state.player     = makeCharacter(playerName, true, {}, false);
        if (!settings.state.charPlayer) settings.state.charPlayer = makeCharacter(charName, false, {}, true);
        if (!settings.state.npcs)       settings.state.npcs       = {};
        settings.state.player.isPlayer         = true;
        settings.state.charPlayer.isCharPlayer = true;
    } else {
        settings.state = {
            player:     makeCharacter(playerName, true, {}, false),
            charPlayer: makeCharacter(charName, false, {}, true),
            npcs:       {}
        };
    }
}

function saveState() {
    // Save config keys to extension_settings (global)
    extension_settings[EXT_NAME] = settings;
    saveSettingsDebounced();
    // Save state to chat_metadata (per-chat)
    if (chat_metadata) {
        chat_metadata.ellinia_state = settings.state;
        saveChatDebounced();
    }
}

// ─── RENDER HELPERS ───────────────────────────────────────────────────────────

function rankBadge(rank = 'F') {
    const color = RANK_COLORS[rank] || '#888';
    return `<span class="el-badge el-rank" style="color:${color};border-color:${color}40">${rank}</span>`;
}

function tierBadge(tier = 'Common') {
    const color = TIER_COLORS[tier] || '#888';
    return `<span class="el-badge el-tier" style="color:${color};border-color:${color}40">${tier}</span>`;
}

function hpBar(current, max) {
    const pct = max > 0 ? Math.min(100, Math.round((current / max) * 100)) : 0;
    const critical = pct < 25;
    return `<div class="el-bar-row">
        <span class="el-bar-label">HP</span>
        <div class="el-bar-track">
            <div class="el-bar-fill el-hp${critical ? ' critical' : ''}" style="width:${pct}%"></div>
        </div>
        <span class="el-bar-val">${current}/${max}</span>
    </div>`;
}

function mpBar(current, max) {
    const pct = max > 0 ? Math.min(100, Math.round((current / max) * 100)) : 0;
    return `<div class="el-bar-row">
        <span class="el-bar-label">MP</span>
        <div class="el-bar-track">
            <div class="el-bar-fill el-mp" style="width:${pct}%"></div>
        </div>
        <span class="el-bar-val">${current}/${max}</span>
    </div>`;
}

function discBar(name, data) {
    const toNext  = Math.max(1, Math.round(100 * Math.pow(data.level, 1.5)));
    const xpMod   = data.xp % toNext;
    const pct     = Math.min(100, Math.round((xpMod / toNext) * 100));
    return `<div class="el-disc-row">
        <span class="el-disc-name">${name}</span>
        <div class="el-bar-track slim">
            <div class="el-bar-fill el-xp" style="width:${pct}%"></div>
        </div>
        <span class="el-disc-lvl">Lv.${data.level}</span>
    </div>`;
}

function totalLevel(char) {
    return DISCIPLINES.reduce((s, d) => s + (char.disciplines?.[d]?.level || 0), 0);
}

// ─── PLAYER TAB RENDERER ──────────────────────────────────────────────────────

function renderPlayerTab() {
    // No state yet — show empty placeholder
    if (!chat_metadata?.ellinia_state) {
        return `<div class="el-empty-state">
            <div class="el-empty-glyph">◈</div>
            <div class="el-empty-text">No data yet</div>
            <div class="el-empty-sub">Parse a message or send one to begin tracking</div>
        </div>`;
    }

    const ctx        = getContext();
    const userName   = ctx.name1 || '{{user}}';
    const charName   = ctx.name2 || '{{char}}';
    const userAvatar = getCharAvatar(settings.state.player);
    const charAvatar = getCurrentCharAvatar();
    const isUser     = _activePlayerView === 'user';
    const activeChar = isUser ? settings.state.player : settings.state.charPlayer;

    return `<div class="el-player-switcher">
        <div class="el-psw-wrap ${isUser ? 'active' : ''}" data-view="user" title="Switch to ${userName}">
            ${userAvatar
                ? `<img class="el-avatar el-psw-avatar" src="${userAvatar}" alt="user" onerror="this.style.display='none'"/>`
                : `<div class="el-avatar el-avatar-placeholder">U</div>`}
            <span class="el-avatar-label">${userName}</span>
        </div>
        <div class="el-psw-wrap ${!isUser ? 'active' : ''}" data-view="char" title="Switch to ${charName}">
            ${charAvatar
                ? `<img class="el-avatar el-psw-avatar" src="${charAvatar}" alt="char" onerror="this.style.display='none'"/>`
                : `<div class="el-avatar el-avatar-placeholder">C</div>`}
            <span class="el-avatar-label">${charName}</span>
        </div>
    </div>
    ${renderCharPanel(activeChar)}`;
}

// ─── CHARACTER PANEL RENDERER ─────────────────────────────────────────────────


function getCharAvatar(char) {
    try {
        if (char.isPlayer) {
            const av = user_avatar;
            if (av) return `/User Avatars/${av}`;
            return null;
        } else {
            const name  = char.name?.toLowerCase().trim();
            const match = (getContext().characters || characters)?.find(c => c.name?.toLowerCase().trim() === name);
            if (match?.avatar) return getThumbnailUrl('avatar', match.avatar);
            return null;
        }
    } catch { return null; }
}

function getCurrentCharAvatar() {
    try {
        const ctx  = getContext();
        const chid = ctx.characterId ?? this_chid;
        const char = (ctx.characters || characters)?.[chid];
        if (char?.avatar) return getThumbnailUrl('avatar', char.avatar);
        return null;
    } catch { return null; }
}

function renderCharPanel(char) {
    const capped   = 20;
    const cid      = char.isPlayer ? '__player__' : char.isCharPlayer ? '__char__' : char.name;
    const aboIcon  = ABO_ICONS[char.aboGender] || '◇';
    const aboColor = STATUS_COLORS[char.aboStatus] || 'var(--el-text-dim)';
    const statusTag = char.aboStatus !== 'neutral'
        ? `<span class="el-abo-active" style="color:${aboColor}">[${char.aboStatus.toUpperCase()}]</span>` : '';

    const advOpts = RANK_ORDER.filter(r => r !== 'Mythic').map(r =>
        `<option value="${r}" ${char.adventurerRank === r ? 'selected' : ''}>${r}</option>`).join('');

    // ── Identity ──────────────────────────────────────────────────────
    let html = `<div class="el-identity">
        <div class="el-editable el-ident-name" data-cid="${cid}" data-f="name" contenteditable="true">${escapeHtml(char.name) || '—'}</div>
        <div class="el-ident-row">
            <span class="el-ident-label">Class:</span>
            <span class="el-editable" data-cid="${cid}" data-f="class" contenteditable="true">${escapeHtml(char.class) || '—'}</span>
            ${rankBadge(char.classRank)}
        </div>
        <div class="el-ident-row">
            <span class="el-ident-label">ADV:</span>
            <select class="el-rank-select" data-cid="${cid}" data-f="adventurerRank">${advOpts}</select>
            <span class="el-abo el-abo-cycle" data-cid="${cid}" title="Click to cycle ABO status">${aboIcon} ${char.aboGender} ${statusTag}</span>
            <span class="el-total-lv">∑ Lv.${totalLevel(char)}</span>
        </div>
    </div>`;

    // ── HP / MP ───────────────────────────────────────────────────────
    const hpPct = char.hp.max > 0 ? Math.min(100, Math.round((char.hp.current / char.hp.max) * 100)) : 0;
    const mpPct = char.mana.max > 0 ? Math.min(100, Math.round((char.mana.current / char.mana.max) * 100)) : 0;
    html += `<div class="el-section">
        <div class="el-bar-row">
            <span class="el-bar-label">HP</span>
            <div class="el-bar-track"><div class="el-bar-fill el-hp${hpPct < 25 ? ' critical' : ''}" style="width:${hpPct}%"></div></div>
            <span class="el-hpmp-val"><input class="el-vi" type="number" data-cid="${cid}" data-f="hp.current" value="${char.hp.current}" min="0"/>/<input class="el-vi" type="number" data-cid="${cid}" data-f="hp.max" value="${char.hp.max}" min="1"/></span>
        </div>
        <div class="el-bar-row">
            <span class="el-bar-label">MP</span>
            <div class="el-bar-track"><div class="el-bar-fill el-mp" style="width:${mpPct}%"></div></div>
            <span class="el-hpmp-val"><input class="el-vi" type="number" data-cid="${cid}" data-f="mana.current" value="${char.mana.current}" min="0"/>/<input class="el-vi" type="number" data-cid="${cid}" data-f="mana.max" value="${char.mana.max}" min="1"/></span>
        </div>
    </div>`;

    // ── Thread Sight ({{user}} only) ─────────────────────────────────
    if (char.isPlayer) {
        const tsl = char.threadSightLevel || 0;
        const tsd = ['—','Common legible','Uncommon legible','Rare legible + mana read','Weak point detection','Epic legible + full HUD'][tsl] || '?';
        html += `<div class="el-section el-ts-section">
            <div class="el-sec-title">◈ THREAD SIGHT</div>
            <div class="el-ts-row">
                ${[1,2,3,4,5].map(i=>`<div class="el-ts-pip${i<=tsl?' active':''}" title="Level ${i}"></div>`).join('')}
                <span class="el-ts-desc" style="color:var(--el-text)">Lv.${tsl}</span>
                <div class="el-pm-btns" style="margin-left:auto">
                    <button class="el-pm-btn" data-cid="${cid}" data-f="threadSightLevel" data-d="-1">−</button>
                    <button class="el-pm-btn" data-cid="${cid}" data-f="threadSightLevel" data-d="1">+</button>
                </div>
            </div>
            <div class="el-ts-desc-line">${tsd}</div>
        </div>`;
    }

    // ── Great Sage ({{char}} only) ────────────────────────────────────
    if (char.isCharPlayer) {
        const gsl = char.greatSageLevel || 0;
        const gsd = ['—','Basic analysis','Combat threat alerts','Structural weakness detection','Tactical recommendations','Full battlefield omniscience'][gsl] || '?';
        html += `<div class="el-section el-ts-section">
            <div class="el-sec-title">❋ GREAT SAGE</div>
            <div class="el-ts-row">
                ${[1,2,3,4,5].map(i=>`<div class="el-ts-pip${i<=gsl?' active':''}" title="Level ${i}"></div>`).join('')}
                <span class="el-ts-desc" style="color:var(--el-text)">Lv.${gsl}</span>
                <div class="el-pm-btns" style="margin-left:auto">
                    <button class="el-pm-btn" data-cid="${cid}" data-f="greatSageLevel" data-d="-1">−</button>
                    <button class="el-pm-btn" data-cid="${cid}" data-f="greatSageLevel" data-d="1">+</button>
                </div>
            </div>
            <div class="el-ts-desc-line">${gsd}</div>
        </div>`;
    }

    // ── Stats ─────────────────────────────────────────────────────────
    html += `<div class="el-section">
        <div class="el-sec-title">ATTRIBUTES</div>
        <div class="el-stats-grid">
            ${STATS.map(s => {
                const val = char.stats?.[s] || 0;
                const pct = Math.min(100, Math.round((val/capped)*100));
                const over = val >= capped;
                return `<div class="el-stat${over?' overcap':''}">
                    <span class="el-stat-name">${s}</span>
                    <div class="el-stat-track"><div class="el-stat-fill" style="width:${pct}%"></div></div>
                    <div class="el-stat-edit-row">
                        <button class="el-pm-btn" data-cid="${cid}" data-f="stats.${s}" data-d="-1">−</button>
                        <span class="el-stat-val">${val}</span>
                        <button class="el-pm-btn" data-cid="${cid}" data-f="stats.${s}" data-d="1">+</button>
                    </div>
                </div>`;
            }).join('')}
        </div>
    </div>`;

    // ── Disciplines ────────────────────────────────────────────────────
    const DISC_ICONS = { Combat:'⚔', Crafting:'⚒', Magic:'✦', Trade:'⚖', Gathering:'⛏' };
    html += `<div class="el-section">
        <div class="el-sec-title">DISCIPLINES</div>
        ${DISCIPLINES.map(d => {
            const data   = char.disciplines?.[d] || {xp:0,level:1};
            const toNext = Math.max(1, Math.round(100*Math.pow(data.level,1.5)));
            const pct    = Math.min(100, Math.round(((data.xp%toNext)/toNext)*100));
            return `<div class="el-disc-card">
                <div class="el-disc-icon">${DISC_ICONS[d]||'◆'}</div>
                <div class="el-disc-info">
                    <div class="el-disc-label">${d}</div>
                    <div class="el-bar-track slim"><div class="el-bar-fill el-xp" style="width:${pct}%"></div></div>
                </div>
                <div class="el-pm-btns">
                    <button class="el-pm-btn small" data-cid="${cid}" data-f="disc.${d}" data-d="-1">−</button>
                    <span class="el-disc-lvl">Lv.${data.level}</span>
                    <button class="el-pm-btn small" data-cid="${cid}" data-f="disc.${d}" data-d="1">+</button>
                </div>
            </div>`;
        }).join('')}
    </div>`;

    // ── Skills ─────────────────────────────────────────────────────────
    const sid = `skills-${cid.replace(/\W/g,'_')}`;
    html += `<div class="el-section el-collapse" data-target="${sid}">
        <div class="el-sec-title el-toggle">SKILLS (${char.skills?.length||0}) <span class="el-arrow">▼</span></div>
        <div class="el-collapse-body collapsed" id="${sid}">
            ${(char.skills||[]).map((sk,i) => {
                const rankColor = RANK_COLORS[sk.rank] || '#888';
                return `<div class="el-sk-card" style="--skc:${rankColor}">
                    <button class="el-sk-rank" data-cid="${cid}" data-f="skill.rank.${i}" title="Click to cycle rank">${sk.rank||'F'}</button>
                    <div class="el-sk-body">
                        <div class="el-sk-top">
                            <div class="el-pm-btns">
                                <button class="el-pm-btn small" data-cid="${cid}" data-f="skill.level.${i}" data-d="-1">−</button>
                                <span class="el-sk-lv">Lv.${sk.level}</span>
                                <button class="el-pm-btn small" data-cid="${cid}" data-f="skill.level.${i}" data-d="1">+</button>
                            </div>
                            <span class="el-editable el-sk-name" data-cid="${cid}" data-f="skill.name.${i}" contenteditable="true">${escapeHtml(sk.name)}</span>
                            <button class="el-sk-edit-btn" data-cid="${cid}" data-f="skill.desc.toggle.${i}" title="Edit description">✎</button>
                            <button class="el-rm-btn always-show" data-cid="${cid}" data-f="skill.remove.${i}" title="Remove">✕</button>
                        </div>
                        <div class="el-sk-desc-wrap" id="sk-desc-${cid}-${i}" style="display:none">
                            <div class="el-editable el-sk-desc" data-cid="${cid}" data-f="skill.desc.${i}" contenteditable="true">${escapeHtml(sk.description||'')}</div>
                        </div>
                        ${sk.description ? `<div class="el-sk-desc-preview">${escapeHtml(sk.description)}</div>` : ''}
                    </div>
                </div>`;
            }).join('')}
            <button class="el-btn small el-add-btn" data-cid="${cid}" data-f="skill.add">+ Add Skill</button>
        </div>
    </div>`;

    // ── Equipment ──────────────────────────────────────────────────────
    const eid = `equip-${cid.replace(/\W/g,'_')}`;
    const TIERS = ['Common','Uncommon','Rare','Epic','Legendary','Unique'];
    const TIER_COLORS = { Common:'#9d9d9d', Uncommon:'#1eff00', Rare:'#0070dd', Epic:'#a335ee', Legendary:'#ff8000', Unique:'#e6cc80' };
    html += `<div class="el-section el-collapse" data-target="${eid}">
        <div class="el-sec-title el-toggle">EQUIPMENT <span class="el-arrow">▼</span></div>
        <div class="el-collapse-body collapsed" id="${eid}">
            <div class="el-equip-grid">
                ${EQUIP_SLOTS.map(slot => {
                    const item = char.equipment?.[slot];
                    const tc   = item ? (TIER_COLORS[item.tier] || TIER_COLORS.Common) : 'var(--el-border)';
                    const tierOpts = TIERS.map(t=>`<option value="${t}" ${item?.tier===t?'selected':''}>${t}</option>`).join('');
                    return `<div class="el-equip-slot${item?' filled':''}" style="--tc:${tc};border-left-color:${tc}">
                        <div class="el-equip-slot-top">
                            <span class="el-slot-label">${SLOT_LABELS[slot]}</span>
                            ${item ? `<select class="el-inv-tier-badge" data-cid="${cid}" data-f="equip.tier.${slot}" style="color:${tc};border-color:${tc}40">${tierOpts}</select>` : ''}
                            ${item ? `<button class="el-rm-btn" data-cid="${cid}" data-f="equip.clear.${slot}" title="Clear slot">✕</button>` : ''}
                        </div>
                        <span class="el-editable el-slot-name" data-cid="${cid}" data-f="equip.name.${slot}" contenteditable="true" style="${item ? 'color:'+tc : ''}">${item?.name ? escapeHtml(item.name) : '<span style="opacity:0.3">empty</span>'}</span>
                    </div>`;
                }).join('')}
            </div>
        </div>
    </div>`;

    // ── Inventory ──────────────────────────────────────────────────────
    const iid = `inv-${cid.replace(/\W/g,'_')}`;
    html += `<div class="el-section el-collapse" data-target="${iid}">
        <div class="el-sec-title el-toggle">INVENTORY <span class="el-arrow">▼</span>
            <span class="el-mesos-row">◎ <input class="el-vi el-mesos-input" type="number" data-cid="${cid}" data-f="mesos" value="${char.mesos||0}" min="0"/></span>
        </div>
        <div class="el-collapse-body collapsed" id="${iid}">
            ${(char.inventory||[]).map((item,i) => `
                <div class="el-inv-row">
                    <span class="el-editable el-inv-name" data-cid="${cid}" data-f="inv.name.${i}" contenteditable="true">${escapeHtml(item.name)}</span>
                    <div class="el-pm-btns">
                        <button class="el-pm-btn small" data-cid="${cid}" data-f="inv.qty.${i}" data-d="-1">−</button>
                        <span class="el-inv-qty">×${item.quantity||1}</span>
                        <button class="el-pm-btn small" data-cid="${cid}" data-f="inv.qty.${i}" data-d="1">+</button>
                    </div>
                    <button class="el-rm-btn" data-cid="${cid}" data-f="inv.remove.${i}" title="Remove">✕</button>
                </div>`).join('')}
            ${(char.inventory||[]).length === 0 ? '<div class="el-empty">Empty</div>' : ''}
            <button class="el-btn small el-add-btn" data-cid="${cid}" data-f="inv.add">+ Add Item</button>
        </div>
    </div>`;

    // ── Status Effects ─────────────────────────────────────────────────
    const xid = `status-${cid.replace(/\W/g,'_')}`;
    html += `<div class="el-section el-collapse" data-target="${xid}">
        <div class="el-sec-title el-toggle">STATUS EFFECTS (${(char.statusEffects||[]).length}) <span class="el-arrow">▼</span></div>
        <div class="el-collapse-body collapsed" id="${xid}">
            ${(char.statusEffects||[]).map((fx,i) => `
            <div class="el-status-row">
                <span class="el-editable el-status-name" data-cid="${cid}" data-f="fx.name.${i}" contenteditable="true">${escapeHtml(fx.name)}</span>
                <div class="el-pm-btns">
                    <button class="el-pm-btn small" data-cid="${cid}" data-f="fx.dur.${i}" data-d="-1">−</button>
                    <span class="el-disc-lvl">${fx.duration??'∞'}t</span>
                    <button class="el-pm-btn small" data-cid="${cid}" data-f="fx.dur.${i}" data-d="1">+</button>
                </div>
                <button class="el-rm-btn" data-cid="${cid}" data-f="fx.remove.${i}" title="Remove">✕</button>
                <div class="el-editable el-status-desc" data-cid="${cid}" data-f="fx.desc.${i}" contenteditable="true">${escapeHtml(fx.effect||'')}</div>
            </div>`).join('')}
            ${(char.statusEffects||[]).length === 0 ? '<div class="el-empty">None</div>' : ''}
            <button class="el-btn small el-add-btn" data-cid="${cid}" data-f="fx.add">+ Add Effect</button>
        </div>
    </div>`;

    // ── Notes ──────────────────────────────────────────────────────────
    html += `<div class="el-section">
        <div class="el-sec-title">NOTES</div>
        <div class="el-editable el-notes-edit" data-cid="${cid}" data-f="notes" contenteditable="true">${char.notes||'<span style="opacity:0.4;font-style:italic">Click to add notes…</span>'}</div>
    </div>`;

    return html;
}

// ─── EDIT EVENT DELEGATION ────────────────────────────────────────────────────
// One delegated listener on the permanent HUD root — survives all innerHTML rerenders

function getCharByKey(cid) {
    if (cid === '__player__') return settings.state.player;
    if (cid === '__char__')   return settings.state.charPlayer;
    return settings.state.npcs[cid] || null;
}

function initEditDelegation(hud) {

    // ── Click: +/- buttons, remove, add, ABO cycle ────────────────────
    hud.addEventListener('click', e => {

        const pmBtn = e.target.closest('.el-pm-btn[data-cid]');
        if (pmBtn) {
            e.stopPropagation();
            const char  = getCharByKey(pmBtn.dataset.cid);
            const f     = pmBtn.dataset.f;
            const delta = parseInt(pmBtn.dataset.d);
            if (!char || isNaN(delta)) return;
            if      (f.startsWith('stats.'))      { const s = f.slice(6); char.stats[s] = Math.max(0,(char.stats[s]||0)+delta); }
            else if (f.startsWith('disc.'))       { const d = f.slice(5); if (char.disciplines?.[d]) char.disciplines[d].level = Math.max(1,(char.disciplines[d].level||1)+delta); }
            else if (f === 'threadSightLevel')    { char.threadSightLevel = Math.max(0,Math.min(5,(char.threadSightLevel||0)+delta)); }
            else if (f === 'greatSageLevel')      { char.greatSageLevel   = Math.max(0,Math.min(5,(char.greatSageLevel||0)+delta)); }
            else if (f.startsWith('skill.level.')){ const i=parseInt(f.split('.')[2]); if(char.skills?.[i]) char.skills[i].level=Math.max(1,(char.skills[i].level||1)+delta); }
            else if (f.startsWith('inv.qty.'))    { const i=parseInt(f.split('.')[2]); if(char.inventory?.[i]) char.inventory[i].quantity=Math.max(1,(char.inventory[i].quantity||1)+delta); }
            else if (f.startsWith('fx.dur.'))     { const i=parseInt(f.split('.')[2]); if(char.statusEffects?.[i]) char.statusEffects[i].duration=Math.max(1,(char.statusEffects[i].duration??1)+delta); }
            saveState(); renderHUD(); return;
        }

        const rmBtn = e.target.closest('.el-rm-btn[data-cid]');
        if (rmBtn) {
            e.stopPropagation();
            const char = getCharByKey(rmBtn.dataset.cid);
            const f    = rmBtn.dataset.f;
            if (!char) return;
            if      (f.startsWith('skill.remove.')) char.skills.splice(parseInt(f.split('.')[2]),1);
            else if (f.startsWith('inv.remove.'))   char.inventory.splice(parseInt(f.split('.')[2]),1);
            else if (f.startsWith('equip.clear.'))  char.equipment[f.split('.')[2]] = null;
            else if (f.startsWith('fx.remove.'))    char.statusEffects.splice(parseInt(f.split('.')[2]),1);
            saveState(); renderHUD(); return;
        }

        const addBtn = e.target.closest('.el-add-btn[data-cid]');
        if (addBtn) {
            e.stopPropagation();
            const char = getCharByKey(addBtn.dataset.cid);
            const f    = addBtn.dataset.f;
            if (!char) return;
            if      (f==='skill.add') { if(!char.skills)char.skills=[]; char.skills.push({name:'New Skill',rank:'F',level:1,description:''}); }
            else if (f==='inv.add')   { if(!char.inventory)char.inventory=[]; char.inventory.push({name:'New Item',tier:'Common',quantity:1}); }
            else if (f==='fx.add')    { if(!char.statusEffects)char.statusEffects=[]; char.statusEffects.push({name:'New Effect',duration:1,effect:''}); }
            saveState(); renderHUD(); return;
        }

        const pswWrap = e.target.closest('.el-psw-wrap[data-view]');
        if (pswWrap) { _activePlayerView = pswWrap.dataset.view; renderHUD(); return; }

        // Skill rank badge cycle
        const skRank = e.target.closest('.el-sk-rank[data-cid]');
        if (skRank) {
            e.stopPropagation();
            const char = getCharByKey(skRank.dataset.cid);
            const f    = skRank.dataset.f;
            const i    = parseInt(f.split('.')[2]);
            if (!char?.skills?.[i]) return;
            const idx = RANK_ORDER.indexOf(char.skills[i].rank || 'F');
            char.skills[i].rank = RANK_ORDER[(idx + 1) % RANK_ORDER.length];
            saveState(); renderHUD(); return;
        }

        // Skill description toggle
        const skEditBtn = e.target.closest('.el-sk-edit-btn[data-cid]');
        if (skEditBtn) {
            e.stopPropagation();
            const parts = skEditBtn.dataset.f.split('.');
            const wcid  = skEditBtn.dataset.cid;
            const i     = parts[3];
            const wrap  = document.getElementById(`sk-desc-${wcid}-${i}`);
            if (wrap) {
                const open = wrap.style.display === 'none' || wrap.style.display === '';
                wrap.style.display = open ? 'block' : 'none';
                if (open) wrap.querySelector('[contenteditable]')?.focus();
            }
            return;
        }

        const aboCycle = e.target.closest('.el-abo-cycle[data-cid]');
        if (aboCycle) {
            e.stopPropagation();
            const char = getCharByKey(aboCycle.dataset.cid);
            if (!char) return;
            const cycles = { Alpha:['neutral','rut'], Omega:['neutral','heat'], Beta:['neutral'] };
            const seq = cycles[char.aboGender] || ['neutral'];
            char.aboStatus = seq[(seq.indexOf(char.aboStatus)+1) % seq.length];
            saveState(); renderHUD(); return;
        }
    });

    // ── Change: selects + number inputs ──────────────────────────────
    hud.addEventListener('change', e => {

        const sel = e.target.closest('.el-rank-select[data-cid], .el-mini-sel[data-cid]');
        if (sel) {
            e.stopPropagation();
            const char = getCharByKey(sel.dataset.cid);
            const f=sel.dataset.f, v=sel.value;
            if (!char) return;
            if      (f==='adventurerRank')          char.adventurerRank=v;
            else if (f.startsWith('skill.rank.'))   { const i=parseInt(f.split('.')[2]); if(char.skills?.[i]) char.skills[i].rank=v; }
            else if (f.startsWith('equip.tier.'))   { const slot=f.split('.')[2]; if(char.equipment?.[slot]) char.equipment[slot].tier=v; }
            else if (f.startsWith('inv.tier.'))     { const i=parseInt(f.split('.')[2]); if(char.inventory?.[i]) char.inventory[i].tier=v; }
            saveState(); renderHUD(); return;
        }

        const vi = e.target.closest('.el-vi[data-cid]');
        if (vi) {
            const char=getCharByKey(vi.dataset.cid), f=vi.dataset.f, v=Number(vi.value);
            if (!char) return;
            if      (f==='hp.current')   char.hp.current=Math.max(0,Math.min(v,char.hp.max));
            else if (f==='hp.max')       { char.hp.max=Math.max(1,v); char.hp.current=Math.min(char.hp.current,char.hp.max); }
            else if (f==='mana.current') char.mana.current=Math.max(0,Math.min(v,char.mana.max));
            else if (f==='mana.max')     { char.mana.max=Math.max(1,v); char.mana.current=Math.min(char.mana.current,char.mana.max); }
            else if (f==='mesos')        char.mesos=Math.max(0,v);
            saveState(); renderHUD(); return;
        }
    });

    // ── Focusout: contenteditable save ───────────────────────────────
    hud.addEventListener('focusout', e => {
        const el = e.target.closest('.el-editable[contenteditable][data-cid]');
        if (!el) return;
        const char=getCharByKey(el.dataset.cid), f=el.dataset.f, val=el.innerText.trim();
        if (!char) return;
        if      (f==='name')               char.name=val;
        else if (f==='class')              char.class=val;
        else if (f==='notes')              char.notes=val;
        else if (f.startsWith('skill.name.')){ const i=parseInt(f.split('.')[2]); if(char.skills?.[i]) char.skills[i].name=val; }
        else if (f.startsWith('skill.desc.')){ const i=parseInt(f.split('.')[2]); if(char.skills?.[i]) char.skills[i].description=val; }
        else if (f.startsWith('equip.name.')){ const slot=f.split('.')[2]; if(char.equipment){ if(!char.equipment[slot]&&val) char.equipment[slot]={name:val,tier:'Common'}; else if(char.equipment[slot]){ char.equipment[slot].name=val; if(!val) char.equipment[slot]=null; } } }
        else if (f.startsWith('inv.name.')) { const i=parseInt(f.split('.')[2]); if(char.inventory?.[i]) char.inventory[i].name=val; }
        else if (f.startsWith('fx.name.'))  { const i=parseInt(f.split('.')[2]); if(char.statusEffects?.[i]) char.statusEffects[i].name=val; }
        else if (f.startsWith('fx.desc.'))  { const i=parseInt(f.split('.')[2]); if(char.statusEffects?.[i]) char.statusEffects[i].effect=val; }
        saveState();
    });

    // ── Keydown: Enter blurs contenteditable ─────────────────────────
    hud.addEventListener('keydown', e => {
        if (e.key==='Enter' && !e.shiftKey) {
            const el = e.target.closest('.el-editable[contenteditable]');
            if (el) { e.preventDefault(); el.blur(); }
        }
    });
}

// bindEditEvents kept as no-op — delegation handles everything now
function bindEditEvents() {}


function renderNPCTab() {
    const npcs   = settings.state.npcs;
    const names  = Object.keys(npcs);

    // Build preset options
    const presetOptions = Object.keys(NPC_PRESETS)
        .filter(n => !npcs[n])
        .map(n => `<option value="${n}">${n}</option>`)
        .join('');

    let html = `<div class="el-npc-toolbar">
        ${presetOptions ? `
        <select id="el-preset-select" class="el-select">
            <option value="">— Quick add NPC —</option>
            ${presetOptions}
        </select>
        <button class="el-btn small" id="el-add-preset">Add</button>
        ` : ''}
        <button class="el-btn small" id="el-add-custom-npc">+ Custom</button>
    </div>`;

    if (names.length === 0) {
        html += `<div class="el-empty" style="margin-top:16px">No NPCs tracked. Add from the quick-add menu above.</div>`;
    } else {
        html += names.map(name => {
            const npc = npcs[name];
            const cid = `npc-body-${name.replace(/\s+/g, '_')}`;
            return `<div class="el-npc-card el-collapse" data-target="${cid}">
                <div class="el-npc-header el-toggle">
                    <span class="el-npc-name">${name}</span>
                    <span class="el-npc-meta">${npc.class || '—'} ${rankBadge(npc.classRank)}</span>
                    <button class="el-btn tiny el-remove-npc" data-npc="${name}" title="Remove NPC">✕</button>
                    <span class="el-arrow">▼</span>
                </div>
                <div class="el-collapse-body collapsed el-npc-body" id="${cid}">
                    ${renderCharPanel(npc)}
                </div>
            </div>`;
        }).join('');
    }

    return html;
}

// ─── SETTINGS TAB RENDERER ───────────────────────────────────────────────────

function renderSettingsTab() {
    return `
    <div class="el-settings-group" id="el-api-group">
        <div class="el-settings-title">CONNECTION</div>
        <label class="el-label">Connection Profile
            <select id="el-conn-profile" class="el-input">
                <option value="">— Loading profiles… —</option>
            </select>
        </label>
        <label class="el-label">Completion Preset
            <select id="el-comp-preset" class="el-input">
                <option value="">(Use profile default)</option>
            </select>
        </label>
        <div class="el-btn-row">
            <button class="el-btn" id="el-save-api">Save</button>
            <button class="el-btn" id="el-test-btn">Test Connection</button>
        </div>
    </div>

    <div class="el-settings-group">
        <div class="el-settings-title">PARSE SETTINGS</div>
        <label class="el-label">Context Messages
            <input type="number" id="el-ctx-msgs" class="el-input" value="${settings.contextMessages || 3}" min="1" max="15"/>
        </label>
        <label class="el-label-inline">
            <input type="checkbox" id="el-auto-update" ${settings.autoUpdate ? 'checked' : ''}/>
            Auto-parse after every AI message
        </label>
        <button class="el-btn" id="el-save-parse">Save</button>
    </div>

    <div class="el-settings-group">
        <div class="el-settings-title">PLAYER CHARACTER</div>
        <label class="el-label">Name
            <input type="text" id="el-p-name" class="el-input" value="${settings.state.player.name || ''}"/>
        </label>
        <label class="el-label">Class
            <input type="text" id="el-p-class" class="el-input" value="${settings.state.player.class || ''}"/>
        </label>
        <label class="el-label">Class Rank
            <select id="el-p-classrank" class="el-input">
                ${RANK_ORDER.filter(r => r !== 'Mythic').map(r =>
                    `<option ${settings.state.player.classRank === r ? 'selected' : ''}>${r}</option>`
                ).join('')}
            </select>
        </label>
        <label class="el-label">ABO Subgender
            <select id="el-p-abo" class="el-input">
                ${['Alpha','Beta','Omega'].map(g =>
                    `<option ${settings.state.player.aboGender === g ? 'selected' : ''}>${g}</option>`
                ).join('')}
            </select>
        </label>
        <label class="el-label">Adventurer Rank
            <select id="el-p-advrank" class="el-input">
                ${RANK_ORDER.filter(r => r !== 'Mythic').map(r =>
                    `<option ${settings.state.player.adventurerRank === r ? 'selected' : ''}>${r}</option>`
                ).join('')}
            </select>
        </label>
        <label class="el-label">Thread Sight Level
            <input type="number" id="el-p-ts" class="el-input" value="${settings.state.player.threadSightLevel || 1}" min="0" max="5"/>
        </label>
        <button class="el-btn" id="el-save-player">Save Player</button>
    </div>

    <div class="el-settings-group el-danger-group">
        <div class="el-settings-title">DANGER ZONE</div>
        <button class="el-btn danger" id="el-reset-all">↺ Reset All Tracked State</button>
    </div>

    <div class="el-settings-group">
        <div class="el-settings-title">CONTEXT INJECTION</div>
        <label class="el-label-inline">
            <input type="checkbox" id="el-inject-enabled" ${settings.injectEnabled !== false ? 'checked' : ''}/>
            Inject tracker state before each generation
        </label>
        <label class="el-label">Injection Depth
            <input type="number" id="el-inject-depth" class="el-input" value="${settings.injectDepth ?? 0}" min="0" max="10" style="width:5em"/>
            <span style="font-size:0.75rem;color:var(--el-text-dim);margin-left:0.5em">0 = right before generation</span>
        </label>
        <div class="el-settings-title" style="margin-top:0.5em;font-size:0.7rem">INCLUDE IN INJECTION</div>
        ${[
            ['el-inj-skills',    'injectSections.skills',    'Skills'],
            ['el-inj-equipment', 'injectSections.equipment', 'Equipment'],
            ['el-inj-inventory', 'injectSections.inventory', 'Inventory'],
            ['el-inj-status',    'injectSections.status',    'Status Effects'],
            ['el-inj-npcs',      'injectSections.npcs',      'NPCs (Roster)'],
        ].map(([id, key, label]) => {
            const sec = settings.injectSections || {};
            const field = key.split('.')[1];
            const checked = sec[field] !== false ? 'checked' : '';
            return `<label class="el-label-inline"><input type="checkbox" id="${id}" data-inj="${field}" ${checked}/> ${label}</label>`;
        }).join('')}
        <div id="el-inject-preview" class="el-inject-preview"></div>
        <button class="el-btn small" id="el-preview-inject">Preview Injection</button>
    </div>`;
}

// ─── OPEN STATE TRACKER ───────────────────────────────────────────────────────
// Persists which collapsible IDs are open across re-renders

const _openIds = new Set();

// ─── FULL HUD RENDER ──────────────────────────────────────────────────────────

function renderHUD() {
    const hud = document.getElementById('el-hud');
    if (!hud) return;

    const playerTab   = hud.querySelector('#el-tab-player');
    const npcTab      = hud.querySelector('#el-tab-npcs');
    const settingsTab = hud.querySelector('#el-tab-settings');

    if (playerTab)   playerTab.innerHTML   = renderPlayerTab();
    if (npcTab)      npcTab.innerHTML      = renderNPCTab();
    if (settingsTab) settingsTab.innerHTML = renderSettingsTab();

    // Restore open state from persistent Set
    _openIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.remove('collapsed');
            const arrow = el.closest('.el-collapse')?.querySelector('.el-arrow');
            if (arrow) arrow.textContent = '▼';
        }
    });

    bindCollapsibles(hud);
    bindNPCEvents(hud);
    bindSettingsEvents(hud);
    bindEditEvents(hud);
}

// ─── COLLAPSIBLE BINDING ──────────────────────────────────────────────────────

function bindCollapsibles(root) {
    root.querySelectorAll('.el-collapse').forEach(el => {
        const tid    = el.dataset.target;
        const toggle = el.querySelector('.el-toggle');
        if (!toggle || !tid) return;
        const fresh = toggle.cloneNode(true);
        toggle.replaceWith(fresh);
        fresh.addEventListener('click', (e) => {
            if (e.target.closest('[contenteditable], input, select, button')) return;
            const body = document.getElementById(tid);
            if (!body) return;
            const nowOpen = body.classList.contains('collapsed');
            body.classList.toggle('collapsed', !nowOpen);
            const arrow = fresh.querySelector('.el-arrow');
            if (arrow) arrow.textContent = nowOpen ? '▼' : '▶';
            if (nowOpen) _openIds.add(tid); else _openIds.delete(tid);
        });
    });
}

// ─── NPC EVENTS ──────────────────────────────────────────────────────────────

function bindNPCEvents(root) {
    root.querySelector('#el-add-preset')?.addEventListener('click', () => {
        const sel  = root.querySelector('#el-preset-select');
        const name = sel?.value;
        if (!name) return;
        const preset = NPC_PRESETS[name] || {};
        settings.state.npcs[name] = makeCharacter(name, false, preset);
        saveState();
        renderHUD();
    });

    root.querySelector('#el-add-custom-npc')?.addEventListener('click', () => {
        const name = prompt('NPC name:')?.trim();
        if (!name) return;
        if (settings.state.npcs[name]) { showNotif(`${name} already tracked`); return; }
        settings.state.npcs[name] = makeCharacter(name, false);
        saveState();
        renderHUD();
    });

    root.querySelectorAll('.el-remove-npc').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const name = btn.dataset.npc;
            if (name && confirm(`Remove ${name} from tracker?`)) {
                delete settings.state.npcs[name];
                saveState();
                renderHUD();
            }
        });
    });
}

// ─── SETTINGS EVENTS ─────────────────────────────────────────────────────────

function bindSettingsEvents(root) {
    const profileSel = root.querySelector('#el-conn-profile');
    const presetSel  = root.querySelector('#el-comp-preset');

    // Populate profile dropdown synchronously from connectionManager
    if (profileSel) {
        const profiles = getConnectionProfileList();
        profileSel.innerHTML = '<option value="">— Select profile —</option>' +
            profiles.map(p => `<option value="${p.id}" ${settings.connectionProfile === p.id ? 'selected' : ''}>${p.name}</option>`).join('');
    }

    // Populate preset dropdown
    if (presetSel) {
        const presets = getPresetNames();
        presetSel.innerHTML = '<option value="">(Use profile default)</option>' +
            presets.map(n => `<option value="${n}" ${settings.completionPreset === n ? 'selected' : ''}>${n}</option>`).join('');
    }

    root.querySelector('#el-save-api')?.addEventListener('click', () => {
        settings.connectionProfile = root.querySelector('#el-conn-profile')?.value ?? '';
        settings.completionPreset  = root.querySelector('#el-comp-preset')?.value  ?? '';
        saveState();
        showNotif('✓ Connection saved');
    });

    root.querySelector('#el-test-btn')?.addEventListener('click', testConnection);

    root.querySelector('#el-save-parse')?.addEventListener('click', () => {
        settings.contextMessages = parseInt(root.querySelector('#el-ctx-msgs')?.value) || 3;
        settings.autoUpdate      = root.querySelector('#el-auto-update')?.checked ?? true;
        saveState();
        showNotif('✓ Parse settings saved');
    });

    root.querySelector('#el-save-player')?.addEventListener('click', () => {
        const p = settings.state.player;
        p.name             = root.querySelector('#el-p-name')?.value     || p.name;
        p.class            = root.querySelector('#el-p-class')?.value    || p.class;
        p.classRank        = root.querySelector('#el-p-classrank')?.value|| p.classRank;
        p.aboGender        = root.querySelector('#el-p-abo')?.value      || p.aboGender;
        p.adventurerRank   = root.querySelector('#el-p-advrank')?.value  || p.adventurerRank;
        p.threadSightLevel = parseInt(root.querySelector('#el-p-ts')?.value) || p.threadSightLevel;
        saveState();
        renderHUD();
        showNotif('✓ Player saved');
    });

    root.querySelector('#el-reset-all')?.addEventListener('click', () => {
        if (!confirm('Reset ALL tracked state? This cannot be undone.')) return;
        const ctx = getContext();
        settings.state = {
            player:     makeCharacter(ctx.name1 || 'Player', true, {}, false),
            charPlayer: makeCharacter(ctx.name2 || 'Character', false, {}, true),
            npcs:       {}
        };
        saveState();
        renderHUD();
        showNotif('State reset');
    });

    // Injection toggle
    root.querySelector('#el-inject-enabled')?.addEventListener('change', e => {
        settings.injectEnabled = e.target.checked;
        saveState();
        if (!settings.injectEnabled) clearInjection();
        showNotif(settings.injectEnabled ? 'Injection enabled' : 'Injection disabled');
    });

    // Injection depth
    root.querySelector('#el-inject-depth')?.addEventListener('change', e => {
        settings.injectDepth = Math.max(0, parseInt(e.target.value) || 0);
        saveState();
    });

    // Section toggles
    root.querySelectorAll('[data-inj]').forEach(cb => {
        cb.addEventListener('change', e => {
            if (!settings.injectSections) settings.injectSections = {};
            settings.injectSections[e.target.dataset.inj] = e.target.checked;
            saveState();
        });
    });

    // Preview button
    root.querySelector('#el-preview-inject')?.addEventListener('click', () => {
        const preview = root.querySelector('#el-inject-preview');
        if (!preview) return;
        const text = formatStateForContext();
        preview.textContent = text || '(nothing to inject — no state yet)';
        preview.style.display = 'block';
    });
}

// ─── NOTIFICATION ─────────────────────────────────────────────────────────────

function showNotif(msg, isError = false) {
    document.getElementById('el-notif')?.remove();
    const el = document.createElement('div');
    el.id        = 'el-notif';
    el.className = `el-notif${isError ? ' error' : ''}`;
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('visible'));
    setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 350); }, 2800);
}

// ─── PROVIDER MAP (mirrors TunnelVision sidecar-retrieval.js) ────────────────
// Maps ST's chat_completion_source values to API format, endpoint, and secret key.

const PROVIDER_MAP = {
    openai:      { format: 'openai',    endpoint: 'https://api.openai.com/v1/chat/completions',            secretKey: 'api_key_openai'      },
    claude:      { format: 'anthropic', endpoint: 'https://api.anthropic.com/v1/messages',                 secretKey: 'api_key_claude'      },
    openrouter:  { format: 'openai',    endpoint: 'https://openrouter.ai/api/v1/chat/completions',         secretKey: 'api_key_openrouter'  },
    deepseek:    { format: 'openai',    endpoint: 'https://api.deepseek.com/v1/chat/completions',          secretKey: 'api_key_deepseek'    },
    mistralai:   { format: 'openai',    endpoint: 'https://api.mistral.ai/v1/chat/completions',            secretKey: 'api_key_mistralai'   },
    nanogpt:     { format: 'openai',    endpoint: 'https://nano-gpt.com/api/v1/chat/completions',          secretKey: 'api_key_nanogpt'     },
    groq:        { format: 'openai',    endpoint: 'https://api.groq.com/openai/v1/chat/completions',       secretKey: 'api_key_groq'        },
    makersuite:  { format: 'google',    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models', secretKey: 'api_key_makersuite' },
    google:      { format: 'google',    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models', secretKey: 'api_key_makersuite' },
    xai:         { format: 'openai',    endpoint: 'https://api.x.ai/v1/chat/completions',                 secretKey: 'api_key_xai'         },
    custom:      { format: 'openai',    endpoint: null,                                                     secretKey: 'api_key_custom'      },
};

// ─── CONNECTION PROFILE HELPERS ───────────────────────────────────────────────
// Reads directly from extension_settings.connectionManager.profiles — same as TunnelVision.

function getConnectionProfiles() {
    return Array.isArray(extension_settings?.connectionManager?.profiles)
        ? extension_settings.connectionManager.profiles
        : [];
}

function getConnectionProfileList() {
    // Returns [{id, name}, ...] for populating the dropdown
    return getConnectionProfiles().map(p => ({ id: p.id, name: p.name || p.id }));
}

function findProfileById(id) {
    return getConnectionProfiles().find(p => p.id === id) || null;
}

function getPresetNames() {
    try {
        const pm = SillyTavern.getContext().getPresetManager?.();
        const list = pm?.getPresetList?.() ?? [];
        return Array.isArray(list) ? list : Object.keys(list || {});
    } catch {
        return [];
    }
}

// ─── SECRET KEY FETCHING ──────────────────────────────────────────────────────
// Requires allowKeysExposure: true in ST's config.yaml

let _secretKeyBlocked = false;

async function fetchSecretKey(secretKey) {
    if (!secretKey || _secretKeyBlocked) return null;
    try {
        const resp = await fetch('/api/secrets/find', {
            method:  'POST',
            headers: SillyTavern.getContext().getRequestHeaders(),
            body:    JSON.stringify({ key: secretKey }),
        });
        if (!resp.ok) {
            if (resp.status === 403) {
                _secretKeyBlocked = true;
                showNotif('⚠ Enable allowKeysExposure in ST config.yaml for extraction API', true);
            }
            return null;
        }
        const data = await resp.json();
        return data.value || null;
    } catch {
        return null;
    }
}

// ─── DIRECT API CALL ──────────────────────────────────────────────────────────

async function directGenerate({ systemPrompt, userPrompt, maxTokens = 1200, temperature = 0, signal = null }) {
    const profileId = settings.connectionProfile;
    if (!profileId) {
        showNotif('⚠ No connection profile selected in CONFIG', true);
        return null;
    }

    const profile = findProfileById(profileId);
    if (!profile?.api || !profile?.model) {
        showNotif('⚠ Selected profile has no API or model set', true);
        return null;
    }

    const info    = PROVIDER_MAP[profile.api] || { format: 'openai', endpoint: null, secretKey: null };
    let endpoint  = info.endpoint || profile['api-url'] || null;

    // Strip ST's session-based /subscription/ proxy paths (same fix as TunnelVision)
    if (endpoint?.includes('/subscription/')) {
        endpoint = endpoint.replace('/subscription/', '/');
    }
    if (!info.endpoint && endpoint && info.format === 'openai' && !endpoint.endsWith('/chat/completions')) {
        endpoint = endpoint.replace(/\/+$/, '') + '/chat/completions';
    }

    if (!endpoint) {
        showNotif(`⚠ No endpoint for provider "${profile.api}"`, true);
        return null;
    }

    const apiKey = await fetchSecretKey(info.secretKey);
    if (!apiKey) {
        showNotif(`⚠ No API key found for "${profile.api}". Check allowKeysExposure in config.yaml`, true);
        return null;
    }

    const model = profile.model;

    try {
        if (info.format === 'anthropic') {
            return await _callAnthropic({ endpoint, apiKey, model, systemPrompt, userPrompt, temperature, maxTokens, signal });
        } else if (info.format === 'google') {
            return await _callGoogle({ endpoint, apiKey, model, systemPrompt, userPrompt, temperature, maxTokens, signal });
        } else {
            return await _callOpenAI({ endpoint, apiKey, model, systemPrompt, userPrompt, temperature, maxTokens, provider: profile.api, signal });
        }
    } catch (err) {
        showNotif(`✗ API error: ${err.message.slice(0, 80)}`, true);
        return null;
    }
}

async function _callAnthropic({ endpoint, apiKey, model, systemPrompt, userPrompt, temperature, maxTokens, signal }) {
    const resp = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: maxTokens, system: systemPrompt || '', messages: [{ role: 'user', content: userPrompt }], temperature }),
        signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    return data.content?.find(b => b.type === 'text')?.text ?? '';
}

async function _callGoogle({ endpoint, apiKey, model, systemPrompt, userPrompt, temperature, maxTokens, signal }) {
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n---\n\n${userPrompt}` : userPrompt;
    const resp = await fetch(`${endpoint}/${model}:generateContent`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        signal,
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
            generationConfig: { temperature, maxOutputTokens: maxTokens },
            safetySettings: ['HARM_CATEGORY_HARASSMENT','HARM_CATEGORY_HATE_SPEECH','HARM_CATEGORY_SEXUALLY_EXPLICIT','HARM_CATEGORY_DANGEROUS_CONTENT'].map(c => ({ category: c, threshold: 'BLOCK_NONE' })),
        }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function _callOpenAI({ endpoint, apiKey, model, systemPrompt, userPrompt, temperature, maxTokens, provider, signal }) {
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
    if (provider === 'openrouter') { headers['HTTP-Referer'] = window.location.origin; headers['X-Title'] = 'Ellinia Tracker'; }
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: userPrompt });
    const resp = await fetch(endpoint, {
        method:  'POST',
        headers,
        body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
        signal,
    });
    if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 120)}`);
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content ?? '';
}

// ─── EXTRACTION CALL ──────────────────────────────────────────────────────────

async function callExtractionAPI(messageBlock) {
    _abortCtrl = new AbortController();
    return directGenerate({
        systemPrompt: EXTRACTION_SYSTEM,
        userPrompt:   `Extract stat changes from these roleplay messages:\n\n${messageBlock}`,
        maxTokens:    1200,
        temperature:  0,
        signal:       _abortCtrl.signal,
    });
}

// ─── TEST CONNECTION ──────────────────────────────────────────────────────────

async function testConnection() {
    const btn = document.getElementById('el-test-btn');
    if (btn) { btn.textContent = '…'; btn.disabled = true; }

    try {
        const result = await directGenerate({
            systemPrompt: 'You are a test assistant.',
            userPrompt:   'Reply with only the single word: OK',
            maxTokens:    10,
            temperature:  0,
        });
        showNotif(result ? `✓ Connected — replied: "${result.trim().slice(0, 40)}"` : '✓ Connected (empty reply)');
    } catch (err) {
        showNotif(`✗ ${err.message}`, true);
    } finally {
        if (btn) { btn.textContent = 'Test Connection'; btn.disabled = false; }
    }
}

// ─── APPLY UPDATES ────────────────────────────────────────────────────────────

function applyUpdates(char, updates) {
    if (!char || !updates) return;

    // Scalar top-level fields
    for (const f of ['name', 'class', 'classRank', 'aboGender', 'aboStatus', 'adventurerRank', 'threadSightLevel', 'mesos', 'notes']) {
        if (updates[f] !== undefined) char[f] = updates[f];
    }

    // HP / Mana (partial merge)
    if (updates.hp)   char.hp   = { ...char.hp,   ...updates.hp   };
    if (updates.mana) char.mana = { ...char.mana, ...updates.mana };

    // Stats (partial merge — only override provided keys)
    if (updates.stats) char.stats = { ...char.stats, ...updates.stats };

    // Disciplines
    if (updates.disciplines) {
        for (const [disc, val] of Object.entries(updates.disciplines)) {
            if (char.disciplines[disc]) {
                char.disciplines[disc] = { ...char.disciplines[disc], ...val };
            }
        }
    }

    // Skills (add / update / remove)
    if (updates.skills) {
        for (const sk of updates.skills) {
            if (sk.action === 'add') {
                if (!char.skills.find(s => s.name === sk.name)) {
                    char.skills.push({ name: sk.name, rank: sk.rank || 'F', level: sk.level || 1, description: sk.description || '' });
                }
            } else if (sk.action === 'update') {
                const ex = char.skills.find(s => s.name === sk.name);
                if (ex) Object.assign(ex, { rank: sk.rank ?? ex.rank, level: sk.level ?? ex.level, description: sk.description ?? ex.description });
            } else if (sk.action === 'remove') {
                char.skills = char.skills.filter(s => s.name !== sk.name);
            }
        }
    }

    // Equipment (slot assignment — null removes the slot)
    if (updates.equipment) {
        for (const [slot, item] of Object.entries(updates.equipment)) {
            if (EQUIP_SLOTS.includes(slot)) char.equipment[slot] = item;
        }
    }

    // Inventory
    if (updates.inventory) {
        for (const item of updates.inventory) {
            if (item.action === 'add') {
                const ex = char.inventory.find(i => i.name === item.name);
                if (ex) ex.quantity = (ex.quantity || 1) + (item.quantity || 1);
                else    char.inventory.push({ name: item.name, quantity: item.quantity || 1, tier: item.tier || 'Common' });
            } else if (item.action === 'remove') {
                char.inventory = char.inventory.filter(i => i.name !== item.name);
            } else if (item.action === 'update') {
                const ex = char.inventory.find(i => i.name === item.name);
                if (ex) Object.assign(ex, item);
            }
        }
    }

    // Status effects
    if (updates.statusEffects) {
        for (const fx of updates.statusEffects) {
            if (fx.action === 'add') {
                if (!char.statusEffects.find(s => s.name === fx.name)) {
                    char.statusEffects.push({ name: fx.name, duration: fx.duration, effect: fx.effect || '' });
                }
            } else if (fx.action === 'remove') {
                char.statusEffects = char.statusEffects.filter(s => s.name !== fx.name);
            }
        }
    }
}

// ─── PARSE TRIGGER ────────────────────────────────────────────────────────────

async function parseLastMessages() {
    if (isParsing) return;
    isParsing = true;

    const btn = document.getElementById('el-parse-btn');
    if (btn) btn.classList.add('spinning');
    showNotif('Parsing…');

    try {
        const ctx     = getContext();
        const chat    = ctx.chat || [];
        const count   = Math.min(settings.contextMessages || 3, chat.length);
        const msgs    = chat.slice(-count).map(m =>
            `[${m.is_user ? 'USER' : 'AI'}]: ${(m.mes || '').trim()}`
        );

        if (msgs.length === 0) { showNotif('No messages to parse'); return; }

        const raw = await callExtractionAPI(msgs.join('\n\n'));
        if (!raw) return;

        let updates;
        try {
            updates = JSON.parse(raw.replace(/```(?:json)?|```/g, '').trim());
        } catch {
            showNotif('⚠ Model returned unparseable JSON', true);
            console.warn('[Ellinia Tracker] Raw extraction response:', raw);
            return;
        }

        if (!Array.isArray(updates) || updates.length === 0) {
            showNotif('No state changes detected');
            return;
        }

        let changed = 0;
        for (const upd of updates) {
            if (!upd.character || !upd.updates) continue;
            const charKey    = upd.character.toLowerCase().trim();
            const ctx        = getContext();
            const playerName = (ctx.name1 || settings.state.player.name || '').toLowerCase().trim();
            const charName   = (ctx.name2 || settings.state.charPlayer?.name || '').toLowerCase().trim();

            if (charKey === 'player' || charKey === playerName || charKey === '{{user}}') {
                applyUpdates(settings.state.player, upd.updates);
                changed++;
                elLog(`✓ Updated {{user}}: "${upd.character}"`);
            } else if (charKey === charName || charKey === '{{char}}') {
                applyUpdates(settings.state.charPlayer, upd.updates);
                changed++;
                elLog(`✓ Updated {{char}}: "${upd.character}"`);
            } else {
                const npcKey = Object.keys(settings.state.npcs).find(
                    k => k.toLowerCase().trim() === charKey
                );
                if (npcKey) {
                    applyUpdates(settings.state.npcs[npcKey], upd.updates);
                    changed++;
                    elLog(`✓ Updated NPC: ${npcKey}`);
                } else {
                    elLog(`⚠ No match for: "${upd.character}"`);
                }
            }
        }

        if (changed > 0) {
            saveState();
            renderHUD();
            showNotif(`✓ Updated ${changed} character${changed !== 1 ? 's' : ''}`);
        } else {
            showNotif('No tracked characters found in response');
        }

    } finally {
        isParsing = false;
        if (btn) btn.classList.remove('spinning');
    }
}

// ─── TAB SYSTEM ──────────────────────────────────────────────────────────────

function bindTabs(hud) {
    hud.querySelectorAll('.el-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            hud.querySelectorAll('.el-tab-btn').forEach(b => b.classList.remove('active'));
            hud.querySelectorAll('.el-tab-pane').forEach(p => p.classList.add('hidden'));
            btn.classList.add('active');
            hud.querySelector(`#el-tab-${btn.dataset.tab}`)?.classList.remove('hidden');
        });
    });
}

// ─── ORB (MOBILE TRIGGER) ─────────────────────────────────────────────────────

function createOrb() {
    if (document.getElementById('el-orb')) return;
    const orb = document.createElement('div');
    orb.id          = 'el-orb';
    orb.textContent = '◈';
    orb.title       = 'Ellinia Tracker';
    orb.addEventListener('click', () => toggleMobilePanel());
    document.body.appendChild(orb);
}

function toggleMobilePanel() {
    const hud = document.getElementById('el-hud');
    if (!hud) return;
    hud.classList.toggle('el-mobile-open');
}

// ─── HUD CREATION ─────────────────────────────────────────────────────────────

function createHUD() {
    if (document.getElementById('el-hud')) return;

    const hud = document.createElement('div');
    hud.id = 'el-hud';
    hud.innerHTML = `
        <div class="el-hud-header">
            <div class="el-hud-title">
                <span class="el-hud-glyph">◈</span>
                <span>ELLINIA</span>
                <span class="el-hud-sub">SYSTEM INTERFACE</span>
            </div>
            <div class="el-hud-controls">
                <button class="el-icon-btn" id="el-parse-btn" title="Parse last messages">⟳</button>
                <button class="el-icon-btn" id="el-minimize-btn" title="Collapse sidebar">−</button>
                <button class="el-icon-btn el-mobile-close" id="el-close-btn" title="Close">✕</button>
            </div>
        </div>
        <div class="el-hud-body" id="el-hud-body">
            <div class="el-tabs">
                <button class="el-tab-btn active" data-tab="player">PLAYER</button>
                <button class="el-tab-btn" data-tab="npcs">ROSTER</button>
                <button class="el-tab-btn" data-tab="settings">CONFIG</button>
            </div>
            <div class="el-tab-pane el-scroll" id="el-tab-player"></div>
            <div class="el-tab-pane el-scroll hidden" id="el-tab-npcs"></div>
            <div class="el-tab-pane el-scroll hidden" id="el-tab-settings"></div>
        </div>`;

    document.body.appendChild(hud);

    // Cancel/parse toggle
    hud.querySelector('#el-parse-btn').addEventListener('click', () => {
        if (isParsing) {
            _abortCtrl?.abort();
            isParsing = false;
            const btn = document.getElementById('el-parse-btn');
            if (btn) { btn.classList.remove('spinning'); btn.textContent = '⟳'; }
            showNotif('Parse cancelled');
        } else {
            parseLastMessages();
        }
    });

    // Create the persistent collapse tab
    const tab = document.createElement('div');
    tab.id = 'el-hud-tab';
    tab.textContent = '›';
    document.body.appendChild(tab);

    const toggleCollapse = () => {
        const collapsed = hud.classList.toggle('el-collapsed');
        tab.textContent = collapsed ? '‹' : '›';
    };

    hud.querySelector('#el-minimize-btn').addEventListener('click', toggleCollapse);
    tab.addEventListener('click', toggleCollapse);

    createOrb();
    bindTabs(hud);
    initEditDelegation(hud);
    renderHUD();
}

// ─── CONTEXT INJECTION ────────────────────────────────────────────────────────

const INJECTION_KEY = 'ellinia_tracker_state';

function formatChar(char, sections) {
    if (!char) return null;
    const lines = [];

    // Identity line
    const idParts = [char.name || '?'];
    if (char.class) idParts.push(`${char.class} ${char.classRank || 'F'}`);
    if (char.aboGender) idParts.push(char.aboGender);
    if (char.aboStatus && char.aboStatus !== 'neutral') idParts.push(char.aboStatus.toUpperCase());
    if (char.adventurerRank) idParts.push(`ADV:${char.adventurerRank}`);
    idParts.push(`HP:${char.hp?.current??'?'}/${char.hp?.max??'?'}`);
    idParts.push(`MP:${char.mana?.current??'?'}/${char.mana?.max??'?'}`);
    lines.push(idParts.join(' | '));

    // Stats
    if (char.stats) {
        const s = char.stats;
        lines.push(`STR:${s.STR} AGI:${s.AGI} VIT:${s.VIT} INT:${s.INT} WIS:${s.WIS} LCK:${s.LCK}`);
    }

    // Special abilities
    if (char.isPlayer && char.threadSightLevel > 0) {
        const tsd = ['—','Common legible','Uncommon legible','Rare legible+mana','Weak point detect','Epic+full HUD'][char.threadSightLevel] || `Lv.${char.threadSightLevel}`;
        lines.push(`Thread Sight Lv.${char.threadSightLevel} — ${tsd}`);
    }
    if (char.isCharPlayer && char.greatSageLevel > 0) {
        const gsd = ['—','Ledger: stats+hit%','Ledger: elemental+cooldowns','Ledger: multi-target','Analyst: conditional recs','Analyst: pattern+intent'][char.greatSageLevel] || `Lv.${char.greatSageLevel}`;
        lines.push(`Great Sage Lv.${char.greatSageLevel} — ${gsd}`);
    }

    // Disciplines
    if (char.disciplines) {
        const discs = Object.entries(char.disciplines)
            .filter(([,v]) => v.level > 1)
            .map(([k,v]) => `${k}:${v.level}`)
            .join(' ');
        if (discs) lines.push(`Disciplines: ${discs}`);
    }

    // Skills
    if (sections.skills && char.skills?.length > 0) {
        const sk = char.skills.map(s => `${s.name} ${s.rank}·${s.level}`).join(', ');
        lines.push(`Skills: ${sk}`);
    }

    // Equipment
    if (sections.equipment && char.equipment) {
        const equipped = Object.entries(char.equipment)
            .filter(([,v]) => v?.name)
            .map(([,v]) => `${v.name}${v.tier && v.tier !== 'Common' ? ` [${v.tier}]` : ''}`)
            .join(', ');
        if (equipped) lines.push(`Equip: ${equipped}`);
    }

    // Inventory
    if (sections.inventory && char.inventory?.length > 0) {
        const inv = char.inventory.map(i => `${i.name}×${i.quantity||1}`).join(', ');
        lines.push(`Inv: ${inv}`);
    }

    // Mesos
    if (char.mesos > 0) lines.push(`Mesos: ${char.mesos.toLocaleString()}`);

    // Status effects
    if (sections.status && char.statusEffects?.length > 0) {
        const fx = char.statusEffects.map(f => `${f.name}(${f.duration??'∞'}t)`).join(', ');
        lines.push(`Status: ${fx}`);
    }

    return lines.join('\n');
}

function formatStateForContext() {
    if (!settings.state) return '';
    const sec = settings.injectSections || {};
    const blocks = [];

    if (sec.player !== false && settings.state.player) {
        const block = formatChar(settings.state.player, sec);
        if (block) blocks.push(block);
    }

    if (sec.charPlayer !== false && settings.state.charPlayer) {
        const block = formatChar(settings.state.charPlayer, sec);
        if (block) blocks.push(block);
    }

    if (sec.npcs !== false && settings.state.npcs) {
        for (const npc of Object.values(settings.state.npcs)) {
            const block = formatChar(npc, sec);
            if (block) blocks.push(block);
        }
    }

    if (!blocks.length) return '';
    return `[ELLINIA TRACKER]\n${blocks.join('\n\n')}`;
}

function injectState() {
    if (!settings.injectEnabled) {
        clearInjection();
        return;
    }
    if (!chat_metadata?.ellinia_state) return; // no state yet
    const text = formatStateForContext();
    if (!text) return;
    setExtensionPrompt(
        INJECTION_KEY,
        text,
        extension_prompt_types.IN_CHAT,
        settings.injectDepth ?? 0,
        false,
        extension_prompt_roles.SYSTEM
    );
}

function clearInjection() {
    setExtensionPrompt(INJECTION_KEY, '', extension_prompt_types.IN_CHAT, 0);
}

// ─── EVENT HOOKS ──────────────────────────────────────────────────────────────

function hookEvents() {
    // Debounced render — skips if user is actively editing a field
    let _renderDebounce = null;
    function debouncedRender() {
        clearTimeout(_renderDebounce);
        _renderDebounce = setTimeout(() => {
            // Don't blow away active edits
            if (document.activeElement?.closest?.('#el-hud [contenteditable], #el-hud input, #el-hud select')) return;
            renderHUD();
        }, 1000);
    }

    eventSource.on(event_types.GENERATION_STARTED, injectState);
    eventSource.on(event_types.GENERATION_ENDED,   clearInjection);
    eventSource.on(event_types.GENERATION_STOPPED, clearInjection);

    eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        if (settings.autoUpdate) {
            setTimeout(parseLastMessages, 600);
        }
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        loadChatState();
        renderHUD();
    });

    // These only need to refresh avatars — debounce to avoid thrashing during RP
    eventSource.on(event_types.USER_MESSAGE_RENDERED, debouncedRender);
    eventSource.on(event_types.SETTINGS_UPDATED, debouncedRender);

    // Re-render when ST settings change (persona switch etc)
    eventSource.on(event_types.SETTINGS_UPDATED, () => {
        renderHUD();
    });
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

jQuery(async () => {
    initSettings();
    loadChatState();
    createHUD();
    hookEvents();
    console.log(`[Ellinia Tracker v${EXT_VERSION}] Initialized`);
});
