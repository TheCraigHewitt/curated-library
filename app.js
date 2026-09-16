/* global ABM_LIBRARY */
const TARGETS = { people: 60, industry: 50, solution: 40, background: 30, vector: 20 };

const DEMO_PROMPTS = [
  { label: 'Telecom fiber hero', text: 'Landing-page hero for a fiber growth campaign. Field technician, telecom, face readable, room for headline on the left.' },
  { label: 'Banking collections banner', text: 'Email banner for a cards program. BFSI, calm collections conversation, no laptop stare, landscape crop-safe.' },
  { label: 'Healthcare ops section', text: 'Landing-page section for healthcare admin operations. Clinic hallway or records, real staff, not bedside drama.' },
  { label: 'Thin tower fallback', text: '160x600 tower ad. Need a tower-safe background or a simple vector. No small faces.' },
];

const state = {
  tab: 'library',
  filters: { category: '', use: '', gender: '', ethnicity: '', vertical: '', q: '' },
  selected: null,
  picks: [],
  prompt: DEMO_PROMPTS[0].text,
};

function records() {
  return (window.ABM_LIBRARY && window.ABM_LIBRARY.records) || [];
}

function report() {
  return (window.ABM_LIBRARY && window.ABM_LIBRARY.report) || { category: {}, gender: {}, ethnicity_presentation: {}, total: 0 };
}

function $(sel) { return document.querySelector(sel); }

function unique(keyFn) {
  return [...new Set(records().flatMap(keyFn).filter(Boolean))].sort();
}

function optionList(values, empty = 'Any') {
  return `<option value="">${empty}</option>` + values.map((v) => `<option value="${v}">${v}</option>`).join('');
}

function applyFilters(list) {
  const f = state.filters;
  const q = f.q.toLowerCase();
  return list.filter((r) => {
    if (f.category && r.category !== f.category) return false;
    if (f.use && !(r.uses || []).includes(f.use)) return false;
    if (f.gender && r.people?.gender !== f.gender) return false;
    if (f.ethnicity && r.people?.ethnicity_presentation !== f.ethnicity) return false;
    if (f.vertical && !(r.verticals || []).includes(f.vertical)) return false;
    if (q) {
      const hay = [r.title, r.llm_description, ...(r.keywords || []), ...(r.jobs || [])].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function scoreRecord(r, prompt) {
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
  if (/vector|diagram|icon|tower-safe background/.test(p) && r.category === 'vector') {
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

  const no = ['laptop', 'handshake', 'phone', 'rocket'];
  if (no.some((w) => (r.keywords || []).join(' ').includes(w) && (r.llm_description || '').toLowerCase().includes(w))) {
    score -= 3;
  }

  if (!why.length) why.push('general library match');
  return { score, why: why.slice(0, 3) };
}

function selectThree(prompt) {
  return records()
    .map((r) => ({ r, ...scoreRecord(r, prompt) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function renderMix() {
  const cat = report().category || {};
  const bars = Object.entries(TARGETS).map(([k, target]) => {
    const n = cat[k] || 0;
    const pct = Math.min(100, Math.round((n / target) * 100));
    return `<div class="mix-row"><span>${k}</span><div class="bar"><i style="width:${pct}%"></i></div><b>${n}/${target}</b></div>`;
  }).join('');
  const g = report().gender || {};
  const e = report().ethnicity_presentation || {};
  $('#mix').innerHTML = `
    <div class="mix-grid">${bars}</div>
    <p class="mix-note">${report().total || 0} tagged images · gender ${Object.entries(g).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>
    <p class="mix-note">ethnicity ${Object.entries(e).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>
  `;
}

function renderFilters() {
  $('#f-category').innerHTML = optionList(['people', 'industry', 'solution', 'background', 'vector'], 'All categories');
  $('#f-use').innerHTML = optionList(unique((r) => r.uses || []), 'All uses');
  $('#f-gender').innerHTML = optionList(unique((r) => [r.people?.gender]), 'Any gender');
  $('#f-ethnicity').innerHTML = optionList(unique((r) => [r.people?.ethnicity_presentation]), 'Any ethnicity');
  $('#f-vertical').innerHTML = optionList(unique((r) => r.verticals || []), 'All verticals');
}

function renderGrid() {
  const list = applyFilters(records());
  $('#count').textContent = `${list.length} images`;
  $('#grid').innerHTML = list.map((r) => `
    <button class="card ${state.selected?.id === r.id ? 'on' : ''}" data-id="${r.id}">
      <img src="${r.files.local || r.files.thumb || r.files.preview}" alt="${r.title}" loading="lazy">
      <div class="meta">
        <strong>${r.id}</strong>
        <span>${r.category}${r.people?.gender && r.people.gender !== 'none' ? ' · ' + r.people.gender : ''}</span>
      </div>
    </button>
  `).join('') || '<p class="empty">No images match those filters.</p>';
}

function chips(values) {
  const list = (values || []).filter(Boolean);
  if (!list.length) return '<span class="muted">—</span>';
  return list.map((v) => `<span class="chip">${escapeHtml(String(v))}</span>`).join('');
}

function row(label, value) {
  return `<div class="kv"><span>${label}</span><div>${value || '<span class="muted">—</span>'}</div></div>`;
}

function openDetail(r) {
  state.selected = r;
  renderGrid();
  renderDetail(r);
  $('#detail').classList.add('open');
  $('#detail').scrollTop = 0;
}

function closeDetail() {
  state.selected = null;
  renderGrid();
  renderDetail(null);
  $('#detail').classList.remove('open');
}

function renderDetail(r) {
  if (!r) {
    $('#detail').innerHTML = '<p class="empty">Click an image to see its tags. Every file has a full record — this is what Claude reads when it picks a hero or banner.</p>';
    return;
  }
  const p = r.people || {};
  const c = r.composition || {};
  const shown = {
    id: r.id,
    source: r.source,
    source_id: r.source_id,
    source_url: r.source_url,
    title: r.title,
    category: r.category,
    verticals: r.verticals,
    jobs: r.jobs,
    uses: r.uses,
    llm_description: r.llm_description,
    keywords: r.keywords,
    composition: r.composition,
    people: r.people,
    do_not_use_for: r.do_not_use_for,
    license: r.license,
    photographer: r.photographer,
    width: r.width,
    height: r.height,
    canva_asset_id: r.canva_asset_id,
    adobe_asset_id: r.adobe_asset_id,
    query_id: r.query_id,
    tagged_by: r.tagged_by,
  };
  $('#detail').innerHTML = `
    <button type="button" class="detail-close" id="detail-close" aria-label="Close">×</button>
    <img src="${r.files.local || r.files.preview}" alt="${r.title}">
    <h3>${escapeHtml(r.id)} · ${escapeHtml(r.title || '')}</h3>
    <p class="desc">${escapeHtml(r.llm_description || '')}</p>
    ${row('Category', `<strong>${escapeHtml(r.category || '')}</strong>`)}
    ${row('Uses', chips(r.uses))}
    ${row('Verticals', chips(r.verticals))}
    ${row('Jobs', chips(r.jobs))}
    ${row('People', p.present
      ? chips([p.gender, p.ethnicity_presentation, p.age_band, p.count != null ? `${p.count} in frame` : null])
      : '<span class="muted">no people</span>')}
    ${row('Composition', chips([c.master, c.face, ...(c.crop_safety || []), c.cutout ? 'cutout-ready' : 'full-scene']))}
    ${row('Keywords', chips(r.keywords))}
    ${row('Do not use for', chips(r.do_not_use_for))}
    ${row('Source', `${escapeHtml(r.source || '')} · ${escapeHtml(r.source_id || '')}`)}
    ${row('License', escapeHtml(r.license || ''))}
    ${row('Photographer', escapeHtml(r.photographer || ''))}
    ${row('Size', r.width && r.height ? `${r.width} × ${r.height}` : '')}
    ${row('Canva asset', r.canva_asset_id || '<span class="muted">not uploaded yet</span>')}
    ${row('Adobe id', r.adobe_asset_id || '<span class="muted">swap source later</span>')}
    <details>
      <summary>Full JSON record</summary>
      <pre>${escapeHtml(JSON.stringify(shown, null, 2))}</pre>
    </details>
  `;
}

function renderPicks() {
  const picks = selectThree(state.prompt);
  state.picks = picks;
  $('#picks').innerHTML = picks.map((p, i) => `
    <article class="pick" data-id="${p.r.id}" title="Open metadata">
      <img src="${p.r.files.local || p.r.files.preview}" alt="${p.r.title}">
      <div>
        <strong>pick_${i + 1} · ${p.r.id}</strong>
        <em>score ${p.score}</em>
        <p>${p.r.llm_description}</p>
        <small>${p.why.join(' · ')}</small>
      </div>
    </article>
  `).join('');
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function showTab(name) {
  state.tab = name;
  document.querySelectorAll('[data-tab]').forEach((el) => {
    el.classList.toggle('on', el.dataset.tab === name);
  });
  document.querySelectorAll('.panel').forEach((el) => {
    el.hidden = el.id !== `panel-${name}`;
  });
}

function bind() {
  document.querySelectorAll('nav button').forEach((b) => {
    b.addEventListener('click', () => showTab(b.dataset.tab));
  });
  ['category', 'use', 'gender', 'ethnicity', 'vertical'].forEach((k) => {
    $(`#f-${k}`).addEventListener('change', (e) => {
      state.filters[k] = e.target.value;
      renderGrid();
    });
  });
  $('#f-q').addEventListener('input', (e) => {
    state.filters.q = e.target.value;
    renderGrid();
  });
  $('#grid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-id]');
    if (!btn) return;
    const rec = records().find((r) => r.id === btn.dataset.id);
    if (rec) openDetail(rec);
  });
  $('#detail').addEventListener('click', (e) => {
    if (e.target.id === 'detail-close') closeDetail();
  });
  $('#picks').addEventListener('click', (e) => {
    const card = e.target.closest('.pick');
    if (!card) return;
    const id = card.dataset.id;
    const rec = records().find((r) => r.id === id);
    if (!rec) return;
    showTab('library');
    openDetail(rec);
  });
  $('#prompt').addEventListener('input', (e) => { state.prompt = e.target.value; });
  $('#run').addEventListener('click', renderPicks);
  $('#chips').innerHTML = DEMO_PROMPTS.map((d, i) => `<button type="button" data-demo="${i}">${d.label}</button>`).join('');
  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-demo]');
    if (!b) return;
    state.prompt = DEMO_PROMPTS[Number(b.dataset.demo)].text;
    $('#prompt').value = state.prompt;
    renderPicks();
  });
}

function init() {
  if (!records().length) {
    $('#app').innerHTML = '<p class="empty">Library not generated yet. Run <code>node scripts/ingest.mjs</code>.</p>';
    return;
  }
  renderMix();
  renderFilters();
  renderGrid();
  renderDetail(null);
  $('#prompt').value = state.prompt;
  bind();
  renderPicks();
}

init();
