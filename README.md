# Ellinia Tracker — SillyTavern Extension
Version 1.0.0 | Built for ellinia_master_v21

A world-specific HUD overlay for tracking character state in your Ellinia RP. 
Mirrors the in-world Summoned One interface described in the lorebook.

---

## Installation

1. Copy the `ellinia-tracker/` folder into:
   ```
   SillyTavern/public/extensions/third-party/ellinia-tracker/
   ```
2. Restart SillyTavern (or reload the page).
3. Go to **Extensions** (the puzzle piece icon) → find **Ellinia Tracker** → enable it.
4. The HUD appears top-right. Drag by the header to reposition.

---

## First-Time Setup (CONFIG tab)

| Field | What to put |
|---|---|
| Provider | OpenAI-compatible (for most APIs incl. local) or Anthropic |
| Endpoint URL | Your secondary API URL. For OpenAI: `https://api.openai.com/v1/chat/completions`. For Anthropic: `https://api.anthropic.com/v1/messages` |
| API Key | Key for the **secondary/extraction model** (separate from your main ST API) |
| Model | A fast, cheap model works fine here — `gpt-4o-mini`, `claude-haiku-4-5-20251001`, or any OpenAI-compatible local model |
| Messages sent per parse | How many recent messages to send for extraction. 3 is usually enough; raise to 5-6 for complex scenes |
| Auto-parse | If ON, the tracker will automatically call the extraction API after every AI reply |

After filling in, hit **Save API Config**.

Also set your Player basics (name, class, rank, ABO) in the **Player** section of CONFIG, then **Save Player**.

---

## Usage

### Auto-parse
With auto-parse ON, the extension fires ~0.6 seconds after every AI message, sends the last N messages to your extraction API, and updates the HUD with any detected changes. A toast notification confirms what changed.

### Manual parse
Click the **⟳** button in the HUD header at any time to force-parse the last N messages.

### Adding NPCs
Go to the **ROSTER** tab. Use the quick-add dropdown (pre-populated with major lore characters) or click **+ Custom** to add any NPC by name. Each NPC gets a collapsible card with the same full stat layout as the player.

Pre-loaded quick-add NPCs and their defaults:
- **Hoshi** — Dual Blade, Class Rank B, Alpha, Adv Rank B
- **Dokyeom** — Blacksmith, Class Rank F, Beta, Adv Rank F  
- **Mira** — Guild Registrar, Class Rank D
- **Commander Sera** — Warrior, Class Rank A
- **Calder** — Warrior, Class Rank C
- **Sable** — Rogue, Class Rank B
- **Athena Pierce** — Bowmaster, Class Rank A, Adv Rank S
- **Grendel** — Archmage, Class Rank S, Adv Rank S

You can still edit any NPC's details after adding — manually or via the extraction API if that character appears in the scene.

### What gets tracked
| Field | Notes |
|---|---|
| STR / AGI / VIT / INT / WIS / LCK | With soft-cap bar (per Class Rank) |
| HP / Mana | Live current/max bars. HP flashes red below 25% |
| Thread Sight | Player-only, 5-pip visual. Each pip shows tier legibility on hover |
| Discipline XP (5 pools) | Combat, Crafting, Magic, Trade, Gathering with level + XP bar |
| Skills | Rank (F–Mythic) + Level (1–10). Add/update/remove via API or manually |
| Class + Class Rank | Immutable after set |
| Adventurer Rank | Mutable |
| ABO subgender + active status | Alpha/Beta/Omega; heat/rut states trigger colored badge |
| Equipment (7 slots) | With tier colour and rune count |
| Inventory | With tier badges and quantity |
| Mesos | Shown inline in Inventory header |
| Status Effects | Name, duration (turns), effect description |
| Notes | Free text field per character |

---

## Extraction Model Notes

The system prompt is baked from your lorebook (entries 5, 6, 8, 9, 10, 11, 13, 24, 32, 33, 103, 141, 151). It knows:
- All 6 stats and their class primary associations
- ABO biological modifiers
- The 5 discipline XP pool structure
- Skill rank/level semantics (surface-through-action, not trainer-taught)
- Thread Sight tier descriptions
- Equipment/material tier system
- Mesos, status effects, adventurer rank gating

**Recommended extraction models:** `gpt-4o-mini` (fast, cheap, accurate JSON), `claude-haiku-4-5-20251001` (Anthropic), any decent local model via Ollama/LM Studio with OpenAI-compatible endpoint.

**Important:** Keep temperature at 0 for the extraction model. The system prompt instructs it to return only a JSON array — no markdown, no explanation.

---

## Troubleshooting

**HUD doesn't appear:**  
Make sure the extension is enabled in the Extensions panel and that `manifest.json` is in the correct folder.

**"No API key set" notification:**  
Go to CONFIG tab → fill in API Key → Save API Config.

**"Model returned unparseable JSON":**  
Your extraction model is outputting markdown fences or preamble. Try a smarter model, or reduce context messages to 1-2 to reduce noise.

**NPC changes not being applied:**  
The extraction API matches NPC names exactly as they appear in the scene. Make sure the name in ROSTER matches how the AI writes the character (e.g. "Hoshi" not "Kwon Soonyoung").

**Stats not updating when I expect them to:**  
The extraction model only updates fields it can infer from the text. Subtle narrative changes (e.g. "he felt marginally stronger") may not produce an update. You can always manually edit state — planned for v1.1.

---

## Manual Stat Editing (v1.1 planned)
Direct inline editing of any stat from the HUD is on the roadmap. For now, state can be adjusted by triggering a parse on a manually written OOC note like:
```
[TRACKER: Ken Crafting XP +200, Crafting level up to 3. Iron Ore ×5 added to inventory. Mesos +80]
```
The extraction model will read this and apply the update.

---

## File Structure
```
ellinia-tracker/
  manifest.json   — Extension metadata
  index.js        — All logic, rendering, API calls
  style.css       — HUD visual styling
  README.md       — This file
```
