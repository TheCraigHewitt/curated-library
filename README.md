# curated-library

Tagged image library for ABM ads, email banners, and landing-page sections. Ingest ~200 stills, vision-tag them, pick from the index with a prompt.

Public stock (Pexels + Pixabay) for the POC. Swap the fetch adapter to Adobe Stock for production. The selector and web app do not change.

## Run the demo

```bash
cd ~/Coding/curated-library
npx serve .
```

Open the printed URL. Click an image for its tags. **Prompt selector** returns 3 IDs for a campaign brief.

## Rebuild / re-tag

Copy `.env.example` to `.env` and add keys.

```bash
node scripts/ingest.mjs              # fetch + tag + write data/library.json
node scripts/ingest.mjs --fetch-only
node scripts/ingest.mjs --tag-only
node scripts/ingest.mjs --thumbs-only
node scripts/select.mjs --demo
```

`SOURCE=adobe` is the production swap. Needs an Adobe Stock Enterprise API key. Record shape stays the same (`source: "adobe"`, `adobe_asset_id`).

## Layout

```
scripts/ingest.mjs     fetch + vision tag
scripts/select.mjs     CLI: prompt → 3 IDs
data/queries.json      mix / category briefs
data/library.json      tagged index Claude reads
data/thumbs/           local previews
index.html             browse + selector
```
