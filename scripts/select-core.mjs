export function scoreRecord(r, prompt) {
  const p = prompt.toLowerCase();
  let score = 0;
  const why = [];

  const useMap = [
    [/hero|landing hero|lp hero/, 'lp-hero'],
    [/banner|email/, 'email-banner'],
    [/tower|skyscraper|160/, 'background'],
    [/section|inline/, 'lp-section'],
    [/ad |linkedin|organic/, 'ad-hero'],
    [/vector|diagram|icon/, 'diagram'],
  ];
  for (const [re, use] of useMap) {
    if (re.test(p) && (r.uses || []).includes(use)) {
      score += 4;
      why.push(`use: ${use}`);
    }
  }

  if (/tower|160|skyscraper/.test(p)) {
    if ((r.composition?.crop_safety || []).includes('tower-safe') || r.category === 'background' || r.category === 'vector') {
      score += 5;
      why.push('tower-safe / no small face');
    } else if (r.people?.present) {
      score -= 4;
      why.push('risky face crop for a tower');
    }
  }

  const verts = ['telecom', 'healthcare', 'bfsi', 'retail', 'travel', 'auto', 'tech', 'public-sector'];
  for (const v of verts) {
    if (p.includes(v) && (r.verticals || []).includes(v)) {
      score += 3;
      why.push(`vertical: ${v}`);
    }
  }
  if (/fiber|5g|network|connectivity/.test(p) && (r.verticals || []).includes('telecom')) {
    score += 3;
    why.push('telecom / fiber');
  }
  if (/cards|bank|claims|collections/.test(p) && (r.verticals || []).includes('bfsi')) {
    score += 3;
    why.push('BFSI');
  }

  const jobs = ['contact-center', 'network-ops', 'claims', 'collections', 'onboarding', 'field-ops', 'executive', 'team', 'customer'];
  for (const j of jobs) {
    if (p.includes(j.replace('-', ' ')) || p.includes(j)) {
      if ((r.jobs || []).includes(j)) {
        score += 2;
        why.push(`job: ${j}`);
      }
    }
  }
  if (/technician|field|plant|utility/.test(p) && (r.jobs || []).includes('field-ops')) {
    score += 2;
    why.push('field ops');
  }

  if (/woman|female/.test(p) && r.people?.gender === 'female') { score += 2; why.push('female'); }
  if (/\bman\b|male|technician/.test(p) && r.people?.gender === 'male') { score += 2; why.push('male'); }
  if (/face|hero|technician|agent|staff|people|person/.test(p)) {
    if (r.category === 'people' || r.people?.present) {
      score += 4;
      why.push('people in frame');
    } else if (r.category === 'industry' || r.category === 'background') {
      score -= 3;
    }
  }
  if (/vector|diagram|icon/.test(p) && r.category === 'vector') {
    score += 4;
    why.push('vector');
  }

  const desc = (r.llm_description || '').toLowerCase();
  for (const word of p.split(/\W+/).filter((w) => w.length > 4)) {
    if (desc.includes(word)) score += 1;
  }

  if ((r.do_not_use_for || []).some((d) => p.includes(d.toLowerCase()))) {
    score -= 6;
    why.push('do-not-use overlap');
  }

  if (!why.length) why.push('general library match');
  return { score, why: why.slice(0, 3) };
}

export function selectThree(records, prompt) {
  return records
    .map((r) => ({ r, ...scoreRecord(r, prompt) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

export const DEMO_PROMPTS = [
  { label: 'Telecom fiber hero', text: 'Landing-page hero for a fiber growth campaign. Field technician, telecom, face readable, room for headline on the left.' },
  { label: 'Banking collections banner', text: 'Email banner for a cards program. BFSI, calm collections conversation, no laptop stare, landscape crop-safe.' },
  { label: 'Healthcare ops section', text: 'Landing-page section for healthcare admin operations. Clinic hallway or records, real staff, not bedside drama.' },
  { label: 'Thin tower fallback', text: '160x600 tower ad. Need a tower-safe background or a simple vector. No small faces.' },
];
