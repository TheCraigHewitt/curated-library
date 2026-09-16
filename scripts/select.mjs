#!/usr/bin/env node
/**
 * Pick 3 library IDs from a campaign prompt. Same rules as the web app.
 *
 *   node scripts/select.mjs "Landing-page hero for a fiber growth campaign"
 *   node scripts/select.mjs --demo
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_PROMPTS, selectThree } from './select-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const lib = JSON.parse(await readFile(join(ROOT, 'data', 'library.json'), 'utf8'));
const demo = process.argv.includes('--demo');
const prompt = demo
  ? DEMO_PROMPTS[0].text
  : process.argv.slice(2).filter((a) => a !== '--demo').join(' ').trim();

if (!prompt) {
  console.error('Usage: node scripts/select.mjs "<campaign prompt>"');
  console.error('       node scripts/select.mjs --demo');
  process.exit(1);
}

const picks = selectThree(lib.records || [], prompt);
console.log(`Prompt: ${prompt}\n`);
picks.forEach((p, i) => {
  console.log(`pick_${i + 1}  ${p.r.id}  score ${p.score}`);
  console.log(`  ${p.r.title}`);
  console.log(`  ${p.r.llm_description}`);
  console.log(`  why: ${p.why.join(' · ')}\n`);
});
