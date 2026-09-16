#!/usr/bin/env node
/**
 * Fetch ~200 stock images, vision-tag them, write library.json.
 *
 *   node scripts/ingest.mjs
 *   node scripts/ingest.mjs --fetch-only
 *   node scripts/ingest.mjs --tag-only
 *
 * Env: PEXELS_API_KEY, PIXABAY_API_KEY, OPENAI_API_KEY (optional, falls back
 * to heuristic tags if missing). Loads this folder's .env.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const THUMBS = join(DATA, 'thumbs');

const FETCH_ONLY = process.argv.includes('--fetch-only');
const TAG_ONLY = process.argv.includes('--tag-only');
const THUMBS_ONLY = process.argv.includes('--thumbs-only');
const SOURCE_MODE = process.env.SOURCE || 'public';
const CONCURRENCY = 6;

const NO_LIST = [
  'handshake', 'rocket', 'whiteboard', 'puzzle', 'tablet glow',
  'staring at laptop', 'staring at phone', 'ai generated', 'synthetic',
];

function loadEnv(path) {
  try { process.loadEnvFile(path); } catch { /* missing is fine */ }
}
loadEnv(join(ROOT, '.env'));

const PEXELS = process.env.PEXELS_API_KEY;
const PIXABAY = process.env.PIXABAY_API_KEY;
const OPENAI = process.env.OPENAI_API_KEY;

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function looksNoList(text) {
  const t = (text || '').toLowerCase();
  return NO_LIST.some((w) => t.includes(w)) ||
    (/\b(laptop|notebook|phone|smartphone|tablet)\b/.test(t) && /\b(using|typing|looking|staring|glow)\b/.test(t));
}

function compositionFromSize(w, h) {
  const ratio = w / h;
  return ratio > 1.25 ? 'landscape-master' : 'square-master';
}

async function searchAdobe(_query) {
  throw new Error(
    'SOURCE=adobe is the production swap. Set ADOBE_STOCK_API_KEY and implement Search/Files here. The record shape stays the same (source: "adobe", adobe_asset_id). POC ingest uses SOURCE=public (Pexels + Pixabay).',
  );
}

async function downloadThumb(record) {
  const url = record.files?.thumb || record.files?.preview;
  if (!url) return null;
  const ext = url.includes('.png') || record.category === 'vector' ? 'jpg' : 'jpg';
  const dest = join(THUMBS, `${record.id}.${ext}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`thumb ${record.id} ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  return `data/thumbs/${record.id}.${ext}`;
}

async function writeThumbs(records) {
  await mkdir(THUMBS, { recursive: true });
  let ok = 0;
  await mapLimit(records, 8, async (r) => {
    try {
      const local = await downloadThumb(r);
      if (local) {
        r.files = { ...r.files, local };
        ok++;
      }
    } catch (err) {
      console.warn(`  thumb skip ${r.id}: ${err.message}`);
    }
  });
  console.log(`Downloaded ${ok}/${records.length} thumbs → data/thumbs/`);
  return records;
}

async function searchPexels(query, perPage = 15) {
  const url = new URL('https://api.pexels.com/v1/search');
  url.searchParams.set('query', query.q);
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('orientation', query.category === 'people' ? 'landscape' : 'landscape');
  const res = await fetch(url, { headers: { Authorization: PEXELS } });
  if (!res.ok) throw new Error(`Pexels ${res.status} ${await res.text()}`);
  const data = await res.json();
  return (data.photos || []).map((p) => ({
    source: 'pexels',
    source_id: String(p.id),
    source_url: p.url,
    preview_url: p.src.large || p.src.medium,
    thumb_url: p.src.medium,
    download_url: p.src.large2x || p.src.large,
    width: p.width,
    height: p.height,
    title: p.alt || query.q,
    alt: p.alt || '',
    photographer: p.photographer,
    license: 'Pexels License (POC stand-in for Adobe Stock Enterprise)',
    query_id: query.id,
    category: query.category,
    verticals: query.verticals,
    jobs: query.jobs,
    uses: query.uses,
    people_hint: query.people_hint,
  }));
}

async function searchPixabay(query, perPage = 15) {
  const url = new URL('https://pixabay.com/api/');
  url.searchParams.set('key', PIXABAY);
  url.searchParams.set('q', query.q);
  url.searchParams.set('image_type', query.image_type || 'vector');
  url.searchParams.set('safesearch', 'true');
  url.searchParams.set('per_page', String(Math.max(perPage, 20)));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pixabay ${res.status} ${await res.text()}`);
  const data = await res.json();
  return (data.hits || []).map((p) => ({
    source: 'pixabay',
    source_id: String(p.id),
    source_url: p.pageURL,
    preview_url: p.largeImageURL || p.webformatURL,
    thumb_url: p.webformatURL || p.previewURL,
    download_url: p.largeImageURL || p.webformatURL,
    width: p.imageWidth,
    height: p.imageHeight,
    title: p.tags || query.q,
    alt: p.tags || '',
    photographer: p.user,
    license: 'Pixabay License (POC stand-in for Adobe Stock Enterprise)',
    query_id: query.id,
    category: query.category,
    verticals: query.verticals,
    jobs: query.jobs,
    uses: query.uses,
    people_hint: query.people_hint,
  }));
}

async function fetchCandidates(queries) {
  if (SOURCE_MODE === 'adobe') {
    await searchAdobe(queries[0]);
  }
  if (!PEXELS) throw new Error('PEXELS_API_KEY missing');
  if (!PIXABAY) throw new Error('PIXABAY_API_KEY missing');

  const seen = new Set();
  const candidates = [];

  for (const query of queries) {
    const take = query.target + 2;
    let hits = [];
    try {
      hits = query.source === 'pixabay'
        ? await searchPixabay(query, 20)
        : await searchPexels(query, 15);
    } catch (err) {
      console.warn(`  skip ${query.id}: ${err.message}`);
      await sleep(400);
      continue;
    }

    let kept = 0;
    for (const hit of hits) {
      const key = `${hit.source}:${hit.source_id}`;
      if (seen.has(key)) continue;
      if (looksNoList(`${hit.alt} ${hit.title}`)) continue;
      seen.add(key);
      candidates.push(hit);
      kept++;
      if (kept >= take) break;
    }
    console.log(`  ${query.id}: ${kept}/${hits.length}`);
    await sleep(query.source === 'pexels' ? 80 : 120);
  }

  return candidates;
}

function heuristicTag(c, idx) {
  const master = compositionFromSize(c.width || 1600, c.height || 1000);
  const peoplePresent = c.category === 'people' || Boolean(c.people_hint);
  return {
    keep: true,
    title: (c.title || c.q || 'Untitled').slice(0, 80),
    category: c.category,
    verticals: c.verticals || [],
    jobs: c.jobs || [],
    uses: c.uses || [],
    llm_description: `${c.title || c.category} scene. ${peoplePresent ? 'People are present and usable as a campaign subject.' : 'No hero subject — atmospheric or diagram use.'} Not a laptop-stare or handshake cliché.`,
    keywords: (c.alt || '').split(/[,\s]+/).filter(Boolean).slice(0, 8),
    composition: {
      master,
      face: peoplePresent ? 'face-center' : 'no-face',
      crop_safety: master === 'landscape-master' ? ['banner-safe'] : ['square-only'],
      cutout: false,
    },
    people: {
      present: peoplePresent,
      count: peoplePresent ? (c.people_hint?.gender === 'mixed' ? 2 : 1) : 0,
      gender: c.people_hint?.gender || (peoplePresent ? 'unspecified' : 'none'),
      ethnicity_presentation: c.people_hint?.ethnicity_presentation || (peoplePresent ? 'unspecified' : 'none'),
      age_band: peoplePresent ? 'adult' : 'none',
    },
    do_not_use_for: [],
    tagged_by: 'heuristic',
  };
}

const TAG_SCHEMA = `Return ONLY JSON (no markdown) with this shape:
{
  "keep": true,
  "reject_reason": null,
  "title": "short human title",
  "category": "people|industry|solution|background|vector",
  "verticals": ["telecom","healthcare","bfsi","retail","travel","auto","tech","public-sector","horizontal"],
  "jobs": ["contact-center","network-ops","claims","collections","onboarding","field-ops","executive","team","customer"],
  "uses": ["ad-hero","email-banner","lp-hero","lp-section","organic","background","diagram"],
  "llm_description": "Two sentences. Name the setting, the people, the mood, and what the image is not.",
  "keywords": ["short","tags"],
  "composition": {
    "master": "landscape-master|square-master",
    "face": "face-left|face-right|face-center|no-face",
    "crop_safety": ["tower-safe","banner-safe","square-only"],
    "cutout": false
  },
  "people": {
    "present": true,
    "count": 0,
    "gender": "female|male|mixed|none",
    "ethnicity_presentation": "black|south_asian|east_asian|latino|white|middle_eastern|mixed|unspecified|none",
    "age_band": "young_adult|adult|midlife|senior|mixed|none"
  },
  "do_not_use_for": []
}

REJECT (keep=false) if: person staring at a laptop/phone/tablet as the main action; handshake; rocket/puzzle/whiteboard-pointing cliché; obvious AI/synthetic skin; text baked into the photo; faces too small to survive a 160x600 crop when the intended category is people.
ethnicity_presentation is a visual matching tag for campaign selection, not an identity claim.
Prefer natural workplaces. Keep the intended category unless the photo clearly belongs elsewhere.`;

async function visionTag(c) {
  if (!OPENAI) return heuristicTag(c);

  const intended = {
    category: c.category,
    verticals: c.verticals,
    jobs: c.jobs,
    uses: c.uses,
    people_hint: c.people_hint,
    alt: c.alt,
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: TAG_SCHEMA },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Intended metadata (correct if the photo disagrees):\n${JSON.stringify(intended)}` },
            { type: 'image_url', image_url: { url: c.preview_url, detail: 'low' } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI ${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  parsed.tagged_by = 'gpt-4o-mini';
  return parsed;
}

const ETH = new Set(['black', 'south_asian', 'east_asian', 'latino', 'white', 'middle_eastern', 'mixed', 'unspecified', 'none']);
const GENDER = new Set(['female', 'male', 'mixed', 'none']);

function normalizePeople(people) {
  const p = { ...(people || {}) };
  let eth = String(p.ethnicity_presentation || 'unspecified');
  if (eth.includes('|') || eth.includes(',')) eth = 'mixed';
  if (!ETH.has(eth)) eth = p.present ? 'unspecified' : 'none';
  let gender = String(p.gender || 'none');
  if (!GENDER.has(gender)) gender = p.present ? 'mixed' : 'none';
  return { ...p, ethnicity_presentation: eth, gender };
}

function toRecord(c, tag, n) {
  const id = `stk-${String(n).padStart(4, '0')}`;
  tag.people = normalizePeople(tag.people);
  return {
    id,
    source: c.source,
    source_id: c.source_id,
    source_url: c.source_url,
    adobe_asset_id: null,
    adobe_url: null,
    canva_asset_id: null,
    license: c.license,
    title: tag.title || c.title,
    category: tag.category || c.category,
    verticals: tag.verticals?.length ? tag.verticals : c.verticals,
    jobs: tag.jobs?.length ? tag.jobs : c.jobs,
    uses: tag.uses?.length ? tag.uses : c.uses,
    llm_description: tag.llm_description,
    keywords: tag.keywords || [],
    composition: tag.composition,
    people: tag.people,
    files: {
      preview: c.preview_url,
      thumb: c.thumb_url,
      original: c.download_url,
    },
    do_not_use_for: tag.do_not_use_for || [],
    brand_notes: 'POC imagery — swap source to Adobe Stock Enterprise for production.',
    approved_by: null,
    approved_on: null,
    query_id: c.query_id,
    tagged_by: tag.tagged_by,
    photographer: c.photographer,
    width: c.width,
    height: c.height,
  };
}

function diversityKey(row) {
  const p = row.tag.people || {};
  return `${p.gender || 'x'}|${p.ethnicity_presentation || 'x'}`;
}

function fillQuotas(tagged, quotas) {
  const counts = Object.fromEntries(Object.keys(quotas).map((k) => [k, 0]));
  const kept = [];
  const rejected = [];
  const mix = {};
  const used = new Set();

  const keepers = [];
  for (const row of tagged) {
    if (row.tag.keep) keepers.push(row);
    else rejected.push({ source_id: row.c.source_id, reason: row.tag.reject_reason });
  }

  const remaining = () => Object.entries(quotas).some(([cat, n]) => (counts[cat] || 0) < n);

  while (remaining()) {
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < keepers.length; i++) {
      if (used.has(i)) continue;
      const row = keepers[i];
      const cat = row.tag.category || row.c.category;
      if ((counts[cat] || 0) >= (quotas[cat] || 0)) continue;
      const score = mix[diversityKey(row)] || 0;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best === -1) break;
    const row = keepers[best];
    const cat = row.tag.category || row.c.category;
    used.add(best);
    counts[cat] = (counts[cat] || 0) + 1;
    mix[diversityKey(row)] = (mix[diversityKey(row)] || 0) + 1;
    kept.push(row);
  }

  return { kept, rejected, counts };
}

function mixReport(records) {
  const cat = {};
  const gender = {};
  const eth = {};
  const uses = {};
  for (const r of records) {
    cat[r.category] = (cat[r.category] || 0) + 1;
    const g = r.people?.gender || 'none';
    const e = r.people?.ethnicity_presentation || 'none';
    gender[g] = (gender[g] || 0) + 1;
    eth[e] = (eth[e] || 0) + 1;
    for (const u of r.uses || []) uses[u] = (uses[u] || 0) + 1;
  }
  return { category: cat, gender, ethnicity_presentation: eth, uses, total: records.length };
}

function writeLibraryJs(records, report) {
  const payload = `window.ABM_LIBRARY = ${JSON.stringify({ generated_at: new Date().toISOString(), report, records }, null, 2)};\n`;
  return writeFile(join(ROOT, 'library-data.js'), payload);
}

async function main() {
  const spec = await readJson(join(DATA, 'queries.json'));
  const candPath = join(DATA, 'candidates.json');
  const libPath = join(DATA, 'library.json');
  const existingLib = await readJson(libPath, { records: [] });

  if (THUMBS_ONLY) {
    if (!existingLib.records?.length) throw new Error('No library.json yet');
    const records = await writeThumbs(existingLib.records);
    const report = existingLib.report || mixReport(records);
    await writeJson(libPath, { ...existingLib, records, report });
    await writeLibraryJs(records, report);
    return;
  }
  const haveIds = new Set((existingLib.records || []).map((r) => `${r.source}:${r.source_id}`));

  let candidates = await readJson(candPath, []);

  if (!TAG_ONLY) {
    console.log('Fetching candidates…');
    const fresh = await fetchCandidates(spec.queries);
    const merged = [...candidates];
    const seen = new Set(candidates.map((c) => `${c.source}:${c.source_id}`));
    for (const c of fresh) {
      const key = `${c.source}:${c.source_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(c);
    }
    candidates = merged;
    await writeJson(candPath, candidates);
    console.log(`Fetched pool: ${candidates.length} candidates`);
  }

  const FILL_GAPS = process.argv.includes('--fill-gaps');
  if (FILL_GAPS && existingLib.records?.length) {
    const knownQueries = new Set(existingLib.records.map((r) => r.query_id));
    candidates = candidates.filter((c) => {
      if (haveIds.has(`${c.source}:${c.source_id}`)) return false;
      return !knownQueries.has(c.query_id);
    });
    console.log(`Fill-gaps: ${candidates.length} unused candidates from new queries`);
  }

  if (FETCH_ONLY) return;

  console.log(`Tagging ${candidates.length} images${OPENAI ? ' with gpt-4o-mini' : ' with heuristics (no OPENAI_API_KEY)'}…`);
  let failures = 0;
  const tagged = await mapLimit(candidates, CONCURRENCY, async (c, i) => {
    try {
      const tag = await visionTag(c);
      if ((i + 1) % 10 === 0) console.log(`  tagged ${i + 1}/${candidates.length}`);
      return { c, tag };
    } catch (err) {
      failures++;
      console.warn(`  fallback ${c.source_id}: ${err.message}`);
      return { c, tag: heuristicTag(c) };
    }
  });

  let records;
  let rejected = [];
  let counts = {};

  if (FILL_GAPS && existingLib.records?.length) {
    records = existingLib.records.map((r) => ({
      ...r,
      people: normalizePeople(r.people),
    }));
    counts = mixReport(records).category;
    const need = Object.entries(spec.quotas).filter(([cat, n]) => (counts[cat] || 0) < n);
    const extras = [];
    for (const row of tagged) {
      if (!row.tag.keep) {
        rejected.push({ source_id: row.c.source_id, reason: row.tag.reject_reason });
        continue;
      }
      const cat = row.tag.category || row.c.category;
      if ((counts[cat] || 0) >= (spec.quotas[cat] || 0)) continue;
      counts[cat] = (counts[cat] || 0) + 1;
      extras.push(row);
    }
    const start = records.length;
    for (const row of extras) {
      records.push(toRecord(row.c, row.tag, records.length + 1));
    }
    console.log(`Fill-gaps added ${records.length - start} (${need.map(([c, n]) => `${c}→${n}`).join(', ')})`);
  } else {
    const filled = fillQuotas(tagged, spec.quotas);
    rejected = filled.rejected;
    counts = filled.counts;
    records = filled.kept.map((row, i) => toRecord(row.c, row.tag, i + 1));
  }

  const report = { ...mixReport(records), quota_fill: counts, rejected: rejected.length, vision_failures: failures };

  records = await writeThumbs(records);
  await writeJson(libPath, { generated_at: new Date().toISOString(), report, records });
  await writeLibraryJs(records, report);
  await writeJson(join(DATA, 'rejected.json'), rejected);

  console.log('\nLibrary ready');
  console.log(JSON.stringify(report, null, 2));
  console.log(`Wrote ${records.length} records → data/library.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
