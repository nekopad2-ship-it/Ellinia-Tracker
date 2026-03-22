// ═══════════════════════════════════════════════════════════════════
//  ELLINIA TRACKER — SillyTavern Extension
//  Drop into: SillyTavern/public/extensions/third-party/ellinia-tracker/
// ═══════════════════════════════════════════════════════════════════

import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types } from '../../../../script.js';


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

function makeCharacter(name = '', isPlayer = false, preset = {}) {
    return {
        name,
        isPlayer,
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
        skills:          [],
        equipment:       { weapon: null, helm: null, chest: null, gloves: null, boots: null, accessory1: null, accessory2: null },
        inventory:       [],
        mesos:           0,
        statusEffects:   [],
        threadSightLevel: isPlayer ? 1 : 0,   // player-only Goddess skill
        notes:           '',
    };
}

const DEFAULT_SETTINGS = {
    connectionProfile: '',   // ST connection profile ID for extraction
    completionPreset:  '',   // ST completion preset name (informational only for direct calls)
    autoUpdate:        true,
    contextMessages:   3,
    state: {
        player: null,
        npcs:   {}
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
    "notes": string
  }
}

If nothing changed, return [].
Return ONLY the JSON array. No markdown fences, no explanation, no preamble.`;

// ─── RUNTIME STATE ────────────────────────────────────────────────────────────

let settings   = {};
let isParsing  = false;
let _abortCtrl = null;

// ─── SETTINGS INIT ────────────────────────────────────────────────────────────

function initSettings() {
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = structuredClone(DEFAULT_SETTINGS);
        extension_settings[EXT_NAME].state.player = makeCharacter('Ken', true);
    }
    settings = extension_settings[EXT_NAME];
    // Patch any missing keys from defaults
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
        if (settings[k] === undefined) settings[k] = structuredClone(v);
    }
    if (!settings.state) settings.state = { player: makeCharacter('Ken', true), npcs: {} };
    if (!settings.state.player) settings.state.player = makeCharacter('Ken', true);
    if (!settings.state.npcs)   settings.state.npcs   = {};
}

function saveState() {
    extension_settings[EXT_NAME] = settings;
    saveSettingsDebounced();
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

// ─── CHARACTER PANEL RENDERER ─────────────────────────────────────────────────

function renderCharPanel(char) {
    const capped  = SOFT_CAPS[char.classRank] || 20;
    const charId  = char.isPlayer ? '__player__' : char.name;
    const aboIcon = ABO_ICONS[char.aboGender] || '◇';
    const aboColor = STATUS_COLORS[char.aboStatus] || '#888';
    const statusTag = char.aboStatus !== 'neutral'
        ? `<span class="el-abo-active" style="color:${aboColor}">[${char.aboStatus.toUpperCase()}]</span>`
        : '';

    // ── Identity ──────────────────────────────────────────────────────
    const advOptions = RANK_ORDER.filter(r => r !== 'Mythic').map(r =>
        `<option value="${r}" ${char.adventurerRank === r ? 'selected' : ''}>${r}</option>`
    ).join('');

    let html = `<div class="el-identity">
        <div class="el-ident-name el-editable" data-char="${charId}" data-field="name" contenteditable="true" title="Click to edit name">${char.name || '—'}</div>
        <div class="el-ident-sub">
            <span class="el-editable" data-char="${charId}" data-field="class" contenteditable="true" title="Click to edit class">${char.class || '—'}</span>
            ${rankBadge(char.classRank)}
            <span class="el-adv">ADV <select class="el-rank-select" data-char="${charId}" data-field="adventurerRank">${advOptions}</select></span>
        </div>
        <div class="el-ident-sub2">
            <span class="el-abo el-abo-cycle" data-char="${charId}" title="Click to cycle ABO status">${aboIcon} ${char.aboGender} ${statusTag}</span>
            <span class="el-total-lv">∑ Lv.${totalLevel(char)}</span>
        </div>
    </div>`;

    // ── HP / MP ───────────────────────────────────────────────────────
    const hpPct = char.hp.max > 0 ? Math.min(100, Math.round((char.hp.current / char.hp.max) * 100)) : 0;
    const mpPct = char.mana.max > 0 ? Math.min(100, Math.round((char.mana.current / char.mana.max) * 100)) : 0;
    const hpCrit = hpPct < 25;

    html += `<div class="el-section">
        <div class="el-bar-row">
            <span class="el-bar-label">HP</span>
            <div class="el-bar-track">
                <div class="el-bar-fill el-hp${hpCrit ? ' critical' : ''}" style="width:${hpPct}%"></div>
            </div>
            <span class="el-bar-val">
                <input class="el-val-input" type="number" data-char="${charId}" data-field="hp.current" value="${char.hp.current}" min="0" max="${char.hp.max}" title="Current HP"/>
                / <input class="el-val-input" type="number" data-char="${charId}" data-field="hp.max" value="${char.hp.max}" min="1" title="Max HP"/>
            </span>
        </div>
        <div class="el-bar-row">
            <span class="el-bar-label">MP</span>
            <div class="el-bar-track">
                <div class="el-bar-fill el-mp" style="width:${mpPct}%"></div>
            </div>
            <span class="el-bar-val">
                <input class="el-val-input" type="number" data-char="${charId}" data-field="mana.current" value="${char.mana.current}" min="0" max="${char.mana.max}" title="Current MP"/>
                / <input class="el-val-input" type="number" data-char="${charId}" data-field="mana.max" value="${char.mana.max}" min="1" title="Max MP"/>
            </span>
        </div>
    </div>`;

    // ── Thread Sight (player only) ────────────────────────────────────
    if (char.isPlayer) {
        const tsLevel = char.threadSightLevel || 0;
        const tsDesc = ['—', 'Common legible', 'Uncommon legible', 'Rare legible + mana read', 'Weak point detection', 'Epic legible + full HUD'][tsLevel] || '?';
        html += `<div class="el-section el-ts-section">
            <div class="el-sec-title">◈ THREAD SIGHT</div>
            <div class="el-ts-row">
                ${[1,2,3,4,5].map(i =>
                    `<div class="el-ts-pip${i <= tsLevel ? ' active' : ''}" title="Level ${i}"></div>`
                ).join('')}
                <span class="el-ts-desc">Lv.${tsLevel}</span>
                <div class="el-pm-btns">
                    <button class="el-pm-btn" data-char="${charId}" data-field="threadSightLevel" data-delta="-1">−</button>
                    <button class="el-pm-btn" data-char="${charId}" data-field="threadSightLevel" data-delta="1">+</button>
                </div>
            </div>
            <div style="font-size:0.75rem;color:var(--el-text-dim);margin-top:0.25em">${tsDesc}</div>
        </div>`;
    }

    // ── Stats ─────────────────────────────────────────────────────────
    html += `<div class="el-section">
        <div class="el-sec-title">ATTRIBUTES <span class="el-cap-note">soft cap: ${capped}</span></div>
        <div class="el-stats-grid">
            ${STATS.map(s => {
                const val  = char.stats?.[s] || 0;
                const pct  = Math.min(100, Math.round((val / capped) * 100));
                const over = val >= capped;
                return `<div class="el-stat${over ? ' overcap' : ''}">
                    <span class="el-stat-name">${s}</span>
                    <div class="el-stat-track"><div class="el-stat-fill" style="width:${pct}%"></div></div>
                    <div class="el-stat-edit-row">
                        <button class="el-pm-btn" data-char="${charId}" data-field="stats.${s}" data-delta="-1">−</button>
                        <span class="el-stat-val">${val}</span>
                        <button class="el-pm-btn" data-char="${charId}" data-field="stats.${s}" data-delta="1">+</button>
                    </div>
                </div>`;
            }).join('')}
        </div>
    </div>`;

    // ── Disciplines ────────────────────────────────────────────────────
    html += `<div class="el-section">
        <div class="el-sec-title">DISCIPLINES</div>
        ${DISCIPLINES.map(d => {
            const data  = char.disciplines?.[d] || { xp: 0, level: 1 };
            const toNext = Math.max(1, Math.round(100 * Math.pow(data.level, 1.5)));
            const pct   = Math.min(100, Math.round(((data.xp % toNext) / toNext) * 100));
            return `<div class="el-disc-row">
                <span class="el-disc-name">${d}</span>
                <div class="el-bar-track slim"><div class="el-bar-fill el-xp" style="width:${pct}%"></div></div>
                <div class="el-pm-btns">
                    <button class="el-pm-btn small" data-char="${charId}" data-field="disc.${d}" data-delta="-1">−</button>
                    <span class="el-disc-lvl">Lv.${data.level}</span>
                    <button class="el-pm-btn small" data-char="${charId}" data-field="disc.${d}" data-delta="1">+</button>
                </div>
            </div>`;
        }).join('')}
    </div>`;

    // ── Skills ─────────────────────────────────────────────────────────
    if (char.skills?.length > 0) {
        const sid = `skills-${charId.replace(/\s+/g, '_')}`;
        html += `<div class="el-section el-collapse" data-target="${sid}">
            <div class="el-sec-title el-toggle">SKILLS (${char.skills.length}) <span class="el-arrow">▼</span></div>
            <div class="el-collapse-body" id="${sid}">
                ${char.skills.map(sk => `
                <div class="el-skill-row">
                    ${rankBadge(sk.rank)} <span class="el-skill-lv">Lv.${sk.level}</span>
                    <span class="el-skill-name">${sk.name}</span>
                    ${sk.description ? `<div class="el-skill-desc">${sk.description}</div>` : ''}
                </div>`).join('')}
            </div>
        </div>`;
    }

    // ── Equipment ──────────────────────────────────────────────────────
    const eid = `equip-${charId.replace(/\s+/g, '_')}`;
    html += `<div class="el-section el-collapse" data-target="${eid}">
        <div class="el-sec-title el-toggle">EQUIPMENT <span class="el-arrow">▼</span></div>
        <div class="el-collapse-body" id="${eid}">
            <div class="el-equip-grid">
                ${EQUIP_SLOTS.map(slot => {
                    const item = char.equipment?.[slot];
                    return `<div class="el-equip-slot${item ? ' filled' : ''}">
                        <span class="el-slot-label">${SLOT_LABELS[slot]}</span>
                        ${item
                            ? `<span class="el-slot-item">${tierBadge(item.tier)} ${item.name}${item.runes?.length ? ` <span class="el-runes">+${item.runes.length}r</span>` : ''}</span>`
                            : '<span class="el-slot-empty">—</span>'}
                    </div>`;
                }).join('')}
            </div>
        </div>
    </div>`;

    // ── Inventory ──────────────────────────────────────────────────────
    const iid = `inv-${charId.replace(/\s+/g, '_')}`;
    html += `<div class="el-section el-collapse" data-target="${iid}">
        <div class="el-sec-title el-toggle">INVENTORY <span class="el-arrow">▼</span>
            <span class="el-mesos">◎ ${(char.mesos || 0).toLocaleString()}</span>
        </div>
        <div class="el-collapse-body" id="${iid}">
            ${char.inventory?.length > 0
                ? char.inventory.map(item => `
                    <div class="el-inv-row">
                        ${tierBadge(item.tier || 'Common')}
                        <span class="el-inv-name">${item.name}</span>
                        <span class="el-inv-qty">×${item.quantity || 1}</span>
                    </div>`).join('')
                : '<div class="el-empty">Empty</div>'}
        </div>
    </div>`;

    // ── Status Effects ─────────────────────────────────────────────────
    if (char.statusEffects?.length > 0) {
        html += `<div class="el-section el-status-section">
            <div class="el-sec-title">STATUS EFFECTS</div>
            ${char.statusEffects.map(fx => `
            <div class="el-status-row">
                <span class="el-status-name">${fx.name}</span>
                ${fx.duration != null ? `<span class="el-status-dur">${fx.duration}t</span>` : ''}
                ${fx.effect ? `<span class="el-status-desc">${fx.effect}</span>` : ''}
            </div>`).join('')}
        </div>`;
    }

    // ── Notes ──────────────────────────────────────────────────────────
    html += `<div class="el-section">
        <div class="el-sec-title">NOTES</div>
        <div class="el-editable el-notes-edit" data-char="${charId}" data-field="notes" contenteditable="true" title="Click to edit notes">${char.notes || '<span style="opacity:0.4;font-style:italic">Click to add notes…</span>'}</div>
    </div>`;

    return html;
}

// ─── EDIT EVENT BINDING ───────────────────────────────────────────────────────

function getCharByKey(charId) {
    if (charId === '__player__') return settings.state.player;
    return settings.state.npcs[charId] || null;
}

function setNestedField(char, field, value) {
    if (field === 'hp.current')    { char.hp.current = Math.max(0, Math.min(Number(value), char.hp.max)); return; }
    if (field === 'hp.max')        { char.hp.max = Math.max(1, Number(value)); char.hp.current = Math.min(char.hp.current, char.hp.max); return; }
    if (field === 'mana.current')  { char.mana.current = Math.max(0, Math.min(Number(value), char.mana.max)); return; }
    if (field === 'mana.max')      { char.mana.max = Math.max(1, Number(value)); char.mana.current = Math.min(char.mana.current, char.mana.max); return; }
    if (field.startsWith('stats.')) { const s = field.slice(6); if (char.stats?.[s] !== undefined) char.stats[s] = Math.max(0, Number(value)); return; }
    if (field.startsWith('disc.'))  {
        const d = field.slice(5);
        if (char.disciplines?.[d]) {
            char.disciplines[d].level = Math.max(1, Number(value));
        }
        return;
    }
    if (field === 'threadSightLevel') { char.threadSightLevel = Math.max(0, Math.min(5, Number(value))); return; }
    if (field === 'name')          { char.name = String(value).trim(); return; }
    if (field === 'class')         { char.class = String(value).trim(); return; }
    if (field === 'notes')         { char.notes = String(value).trim(); return; }
    if (field === 'adventurerRank') { char.adventurerRank = String(value); return; }
}

function bindEditEvents(root) {
    // +/- buttons
    root.querySelectorAll('.el-pm-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const charId = btn.dataset.char;
            const field  = btn.dataset.field;
            const delta  = parseInt(btn.dataset.delta);
            const char   = getCharByKey(charId);
            if (!char) return;

            if (field.startsWith('stats.')) {
                const s = field.slice(6);
                char.stats[s] = Math.max(0, (char.stats[s] || 0) + delta);
            } else if (field.startsWith('disc.')) {
                const d = field.slice(5);
                if (char.disciplines?.[d]) {
                    char.disciplines[d].level = Math.max(1, (char.disciplines[d].level || 1) + delta);
                }
            } else if (field === 'threadSightLevel') {
                char.threadSightLevel = Math.max(0, Math.min(5, (char.threadSightLevel || 0) + delta));
            }
            saveState();
            renderHUD();
        });
    });

    // HP/MP number inputs
    root.querySelectorAll('.el-val-input').forEach(input => {
        const commit = () => {
            const charId = input.dataset.char;
            const field  = input.dataset.field;
            const char   = getCharByKey(charId);
            if (!char) return;
            setNestedField(char, field, input.value);
            saveState();
            renderHUD();
        };
        input.addEventListener('change', commit);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); e.target.blur(); } });
    });

    // Contenteditable fields (name, class, notes)
    root.querySelectorAll('.el-editable[contenteditable]').forEach(el => {
        el.addEventListener('blur', () => {
            const charId = el.dataset.char;
            const field  = el.dataset.field;
            const char   = getCharByKey(charId);
            if (!char) return;
            // Clear placeholder if needed
            const val = el.innerText.trim();
            setNestedField(char, field, val);
            saveState();
            // Don't re-render on blur — it causes cursor loss
        });
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
        });
    });

    // Adventurer Rank dropdown
    root.querySelectorAll('.el-rank-select').forEach(sel => {
        sel.addEventListener('change', () => {
            const char = getCharByKey(sel.dataset.char);
            if (!char) return;
            char.adventurerRank = sel.value;
            saveState();
            renderHUD();
        });
    });

    // ABO status cycle
    root.querySelectorAll('.el-abo-cycle').forEach(el => {
        el.addEventListener('click', () => {
            const char = getCharByKey(el.dataset.char);
            if (!char) return;
            const cycles = {
                Alpha: ['neutral', 'rut', 'neutral'],
                Omega: ['neutral', 'heat', 'neutral'],
                Beta:  ['neutral'],
            };
            const seq = cycles[char.aboGender] || ['neutral'];
            const idx = seq.indexOf(char.aboStatus);
            char.aboStatus = seq[(idx + 1) % seq.length];
            saveState();
            renderHUD();
        });
    });
}



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
    </div>`;
}

// ─── FULL HUD RENDER ──────────────────────────────────────────────────────────

function renderHUD() {
    const hud = document.getElementById('el-hud');
    if (!hud) return;

    const playerTab   = hud.querySelector('#el-tab-player');
    const npcTab      = hud.querySelector('#el-tab-npcs');
    const settingsTab = hud.querySelector('#el-tab-settings');

    if (playerTab)   playerTab.innerHTML   = renderCharPanel(settings.state.player);
    if (npcTab)      npcTab.innerHTML      = renderNPCTab();
    if (settingsTab) settingsTab.innerHTML = renderSettingsTab();

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
        // Remove old handlers by cloning
        const fresh = toggle.cloneNode(true);
        toggle.replaceWith(fresh);
        fresh.addEventListener('click', (e) => {
            if (e.target.classList.contains('el-remove-npc')) return;
            const body  = document.getElementById(tid);
            if (!body) return;
            const open  = !body.classList.contains('collapsed');
            body.classList.toggle('collapsed', open);
            const arrow = fresh.querySelector('.el-arrow');
            if (arrow) arrow.textContent = open ? '▶' : '▼';
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
        settings.state = { player: makeCharacter('Ken', true), npcs: {} };
        saveState();
        renderHUD();
        showNotif('State reset');
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
        return pm?.getPresetList?.() ?? [];
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
            if (upd.character === 'player') {
                applyUpdates(settings.state.player, upd.updates);
                changed++;
            } else if (settings.state.npcs[upd.character]) {
                applyUpdates(settings.state.npcs[upd.character], upd.updates);
                changed++;
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
    renderHUD();
}

// ─── EVENT HOOKS ──────────────────────────────────────────────────────────────

function hookEvents() {
    eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        if (settings.autoUpdate) {
            // Short delay to ensure ST has fully appended the message
            setTimeout(parseLastMessages, 600);
        }
    });
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

jQuery(async () => {
    initSettings();
    createHUD();
    hookEvents();
    console.log(`[Ellinia Tracker v${EXT_VERSION}] Initialized`);
});
