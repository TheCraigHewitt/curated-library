# curated-library

Finite, vision-tagged stills for ads, email banners, and landing-page sections. An agent (or the prompt selector) reads `data/library.json` and returns 3 IDs. Nobody searches a stock site per campaign.

Public stock (Pexels + Pixabay) ships as the demo. Adobe Stock is the production source. The selector and web app do not change when the source changes.

Requires **Node 20+** (`process.loadEnvFile`).

---

## 1. Clone and view the demo (no keys)

The repo already contains a 200-image tagged index (`data/library.json`, `library-data.js`). Thumbs are not in git. The UI loads remote preview URLs.

```bash
git clone https://github.com/TheCraigHewitt/curated-library.git
cd curated-library
npx serve .
```

Open the printed URL. **Library** browses and filters. Click an image for tags. **Prompt selector** returns 3 IDs from a campaign brief.

```bash
node scripts/select.mjs --demo
node scripts/select.mjs "Landing-page hero for a fiber growth campaign. Field technician, telecom."
```

---

## 2. Rebuild from public stock

Copy `.env.example` to `.env` and add keys. Pexels + Pixabay are required to fetch. OpenAI is optional (vision tags with `gpt-4o-mini`; without it, ingest uses heuristics).

```bash
cp .env.example .env
# edit .env

node scripts/ingest.mjs              # fetch + tag + write library.json + library-data.js
node scripts/ingest.mjs --fetch-only
node scripts/ingest.mjs --tag-only
node scripts/ingest.mjs --thumbs-only
```

`data/queries.json` is the mix brief: ~200 stills, 60 people / 50 industry / 40 solution / 30 background / 20 vector.

---

## 3. Rebuild from Adobe Stock

Adobe Stock Search API is **Enterprise-only** (since Nov 2024). A Stock seat in the Creative Cloud admin console is not enough. You need Stock for Enterprise, then API credentials in the [Adobe Developer Console](https://developer.adobe.com/console). If the org cannot add Stock API credentials, they do not have the right license.

Docs:

- [Getting started](https://developer.adobe.com/stock/docs/getting-started/)
- [Authentication / headers](https://developer.adobe.com/stock/docs/getting-started/03-api-authentication)
- [Search/Files](https://developer.adobe.com/stock/docs/api/11-search-reference)

### Env

```bash
SOURCE=adobe
ADOBE_STOCK_API_KEY=          # x-api-key from Developer Console
ADOBE_STOCK_PRODUCT=curated-library/1.0
# optional, only if you need license state or licensed URLs:
# ADOBE_STOCK_ACCESS_TOKEN=
OPENAI_API_KEY=               # still recommended for vision tags
```

Pexels / Pixabay are ignored when `SOURCE=adobe`.

```bash
SOURCE=adobe node scripts/ingest.mjs
```

That searches Adobe with the same query mix, vision-tags the hits, and writes a new `library.json`. Each record gets `source: "adobe"`, `adobe_asset_id`, and `adobe_url`. The selector keeps working.

### What ingest does vs what it does not

| Step | This repo |
|---|---|
| Search + preview thumbs | Yes. `GET https://stock.adobe.io/Rest/Media/1/Search/Files` |
| Vision-tag into the schema | Yes, same as public ingest |
| License / download the hi-res file | No. Search without a bearer token returns comps. Licensing is `POST /Rest/Libraries/1/Content/License` and needs `Authorization: Bearer` plus a Stock-for-Enterprise entitlement. Do that in the production publish path, not here. |

`scripts/ingest.mjs` already implements Search/Files. If a fork still has a stub, implement it against this contract and leave `toRecord()` alone.

### Search/Files contract (for agents)

Headers (required): `x-api-key`, `X-Product`. Optional: `Authorization: Bearer <token>`.

Map each Adobe `files[]` item to the same candidate shape Pexels uses:

| Candidate field | Adobe field |
|---|---|
| `source` | `"adobe"` |
| `source_id` | `String(file.id)` |
| `source_url` | `https://stock.adobe.com/${id}` |
| `preview_url` | `thumbnail_1000_url` or `thumbnail_500_url` or `thumbnail_url` |
| `thumb_url` | `thumbnail_url` |
| `download_url` | same as preview until licensed |
| `width` / `height` | `file.width` / `file.height` |
| `title` / `alt` | `file.title` |
| `photographer` | `file.creator_name` |
| `license` | `"Adobe Stock"` |
| `query_id`, `category`, `verticals`, `jobs`, `uses`, `people_hint` | copy from `data/queries.json` |

Filters:

- Photos: `search_parameters[filters][content_type:photo]=1` and `orientation=horizontal`
- Vectors (queries with `source: "pixabay"` or `category: "vector"`): `content_type:vector=1`

Then `toRecord()` must set:

```js
adobe_asset_id: source_id
adobe_url: source_url
```

Do not invent a new schema. Do not make the web app call Adobe live. The tagged JSON is the source of truth.

---

## Record shape

Every image in `data/library.json` looks like this. Claude / any agent picks from this file.

```json
{
  "id": "stk-0042",
  "source": "pexels",
  "source_id": "7018658",
  "adobe_asset_id": null,
  "adobe_url": null,
  "canva_asset_id": null,
  "category": "people",
  "verticals": ["telecom"],
  "jobs": ["field-ops"],
  "uses": ["ad-hero", "lp-hero", "email-banner"],
  "llm_description": "Two sentences. Setting, people, mood, what it is not.",
  "composition": { "master": "landscape-master", "face": "face-left", "crop_safety": ["banner-safe"] },
  "people": { "present": true, "gender": "female", "ethnicity_presentation": "black" },
  "files": { "preview": "https://…", "thumb": "https://…", "original": "https://…" }
}
```

`uses`: `ad-hero` · `email-banner` · `lp-hero` · `lp-section` · `organic` · `background` · `diagram`

---

## Layout

```
scripts/ingest.mjs       fetch + vision tag (public or Adobe)
scripts/select.mjs       CLI: prompt → 3 IDs
scripts/select-core.mjs  scoring (shared with the web app)
data/queries.json        mix / category briefs
data/library.json        tagged index the agent reads
data/thumbs/             local previews (gitignored)
index.html               browse + selector
library-data.js          same index, inlined for the static demo
```

---

## Notes

- Keys live in `.env`. Never commit them.
- The library is finite on purpose. Do not browse Adobe (or Pexels) at selection time.
- Canva autofill needs a `canva_asset_id` after upload. That is a later step, not ingest.
