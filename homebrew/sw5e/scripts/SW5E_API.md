# SW5e API (`sw5eapi.azurewebsites.net`)

Base URL: `https://sw5eapi.azurewebsites.net/api/`

Discovered via [sw5e.com](https://sw5e.com) asset crawl (`crawl-sw5e-api.py`), `dataVersion` row keys, and manual probes. Full probe log: `sw5e-api-endpoints.json`.

## How to read this doc

- **Endpoint** — URL path segment after `/api/` (e.g. `species` → `GET .../api/species`).
- **JSON property** — field *inside* each object returned by an endpoint (e.g. `flavorText` on a species row). These are **not** separate URLs; they tell you which field holds prose, links, or filters.

## Collection endpoints (HTTP 200)

| Endpoint | Count | Content type | Notes |
|----------|------:|--------------|-------|
| `PlayerHandbookRule` | 16 | JSON array | PHB chapters; see below |
| `species` | 141 | JSON array | `contentSource` filter (`PHB`, …) |
| `class` / `Class` | 10 | JSON array | Same data, two casings |
| `archetype` | 137 | JSON array | `className` links to class `name` |
| `background` | 61 | JSON array | |
| `equipment` | 507 | JSON array | `description` field |
| `power` | 465 | JSON array | `powerType`: `force` / `tech` |
| `maneuvers` / `Maneuvers` | 119 | JSON array | Duplicate casing |
| `fightingStyle` | 32 | JSON array | |
| `fightingMastery` | 32 | JSON array | **New** — mastery options |
| `feat` | 119 | JSON array | |
| `feature` / `Feature` | 2723 | JSON array | Class/species features (`text`, `level`, `source`) |
| `enhancedItem` / `EnhancedItem` | 1918 | JSON array | Magic items (`text`, `rarityOptions`, …) |
| `conditions` | 16 | JSON array | |
| `variantRule` / `VariantRule` | 40 | JSON array | `contentMarkdown` |
| `monster` | 271 | JSON array | |
| `skills` | 18 | JSON array | |
| `armorProperty` | 30 | JSON array | Armor property definitions |
| `weaponProperty` | 46 | JSON array | Weapon property definitions |
| `starshipEquipment` | 104 | JSON array | Starship gear |
| `referenceTable` | 33 | JSON array | Named lookup tables (`name`, `content`) |
| `dataVersion` | 41 | JSON array | Version metadata per dataset |
| `credit` | 1 | **text/plain** | Full credits page as markdown |

### Likely exist (in `dataVersion` but not yet confirmed 200)

Probe with `probe-dataversion-endpoints.py` when the API is stable: `lightsaberForms`, `starshipModifications`, `starshipDeployments`, `starships-rules`, `wretched-hives-rules`, `expanded-content`, `weaponFocuses`, `weaponSupremacies`, `classImprovements`, `multiclassImprovements`.

## Per-item URL patterns

Many collections support fetching **one record** by chapter name or row key:

| Collection | List | Single-item examples |
|------------|------|----------------------|
| `PlayerHandbookRule` | `/api/PlayerHandbookRule` | `/api/PlayerHandbookRule/Introduction.json`, `/api/PlayerHandbookRule/Whats%20Different.json` |
| Others | `/api/{endpoint}` | Often `/api/{endpoint}/{rowKey}` or URL-encoded `name` (site-dependent; try list + filter locally) |

`PlayerHandbookRule` items include: `chapterNumber`, `chapterName`, `contentMarkdown`, `contentSource`.

### `PlayerHandbookRule` chapters

| `chapterNumber` | `chapterName` | Markdown |
|----------------:|---------------|----------|
| -2 | Preface | **empty** (legacy; omitted from current PDF) |
| -1 | Whats Different | yes |
| 0 | Introduction | yes |
| 1–10, 13–14 | (chapters) | yes |
| 99 | Changelog | yes |

## Important JSON fields (not endpoints)

| Field | Used on | Meaning |
|-------|---------|---------|
| `contentMarkdown` | `PlayerHandbookRule`, `variantRule` | Chapter/rule prose (markdown) |
| `flavorText` | `species`, `background`, `class` | Descriptive prose |
| `description` | `equipment`, `power`, `maneuvers`, `conditions` | Rules text |
| `text` | `feat`, `feature`, `archetype`, `enhancedItem` | Rules text |
| `className` | `archetype` | Parent class `name` |
| `powerType` | `power` | `force` or `tech` |
| `contentSource` | most content types | `PHB`, etc. — filter for handbook scope |
| `name` | virtually all | Display name / TOC label |

## Site pages without JSON collections

| Page | URL | Source used in homebrew |
|------|-----|-------------------------|
| What's Different | [sw5e.com/rules/phb/whatsDifferent](https://sw5e.com/rules/phb/whatsDifferent) | `PlayerHandbookRule` chapter `-1` (SPA loads same API) |
| Credits | [sw5e.com/credits](https://sw5e.com/credits) | `GET /api/credit` (markdown plaintext) |

## Import pipeline

```bash
python homebrew/sw5e/scripts/phb/import-sw5e-phb-from-api.py
```

Uses `phb/sw5e_md_convert.py` for markdown → 5etools book entries. Existing **Credits** in `book/book-sw5e-phb.json` are preserved on re-import. Entity data lives in sibling pack files (`spells/`, `items/`, `race/`, etc.); see `phb/paths.py`.

Equipment entities (`item[]`) are refreshed separately:

```bash
python homebrew/sw5e/scripts/phb/import-sw5e-phb-data.py
python homebrew/sw5e/scripts/phb/analyze-sw5e-equipment.py
```

All **186** PHB rows from `GET /api/equipment` (`contentSource: PHB`) are imported; stats merge API fields with existing orcnog item data where names match.

Species-only refresh:

```bash
python homebrew/sw5e/scripts/phb/import-sw5e-species.py
```
