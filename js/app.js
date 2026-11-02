// The DM's Perspective — Lore. One place for everything about a world: places, people, powers, things and history,
// with secrets only the DM sees. The DM writes; players read whatever the DM has revealed, live, at the table.
// The DM's world is kept on this device and in a private file in their Google Drive (like the other apps). Pictures
// go in a folder in their Drive, viewable by link, so players just open the app and see them.
import * as M from './model.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = M.esc;

/* ---------- the suite core (sign-in, table) ---------- */
let core = null;
const coreReady = import('/core/suite.js').then(m => { core = m; }).catch(() => {});
const isPlayer = () => core?.tableRole?.() === 'player';
const amDm = () => core?.tableRole?.() === 'dm' && core.currentTable?.()?.id;
const tablePass = async () => { let p = core.signedIn(''); if (!p && core.refreshNow) p = await core.refreshNow(); return p?.value || null; };

/* ---------- storage: this device (IndexedDB) ---------- */
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('dmp-lore', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const idbGet = k => idb().then(db => new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result ?? null); q.onerror = () => res(null); })).catch(() => null);
const idbPut = (k, v) => idb().then(db => new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(true); t.onerror = () => res(false); })).catch(() => false);

let W = M.newWorld();      // the DM's world
let P = null;              // what a player has been shown: { meta: { name, sections }, e: { id: entry } }
const ui = { view: 'home', sec: '', type: '', id: '', q: '', preview: false };

async function save() {
  W.stamp = Date.now();
  await idbPut('world', W);
  syncSoon(); publishSoon();
}

/* ---------- whose world is on screen: the DM's own, a player's revealed copy, or the DM previewing that ---------- */
const reader = () => isPlayer() || ui.preview;
const fromPub = (meta, e, ev, mp) => ({ name: meta?.name || 'Lore', sections: Object.values(meta?.sections || {}).map(s => ({ ...s, types: Object.values(s.types || {}) })),
  eras: Object.values(meta?.eras || {}), calendar: { months: Object.values(meta?.months || {}) },
  entries: Object.values(e || {}).map(x => ({ ...x, facts: Object.values(x.facts || {}), revealed: true })),
  events: Object.values(ev || {}).map(x => ({ ...x, revealed: true })),
  maps: Object.values(mp || {}).map(m => ({ ...m, pins: Object.values(m.pins || {}).map(p => ({ ...p, revealed: true })), revealed: true })) });
const pubMaps = () => { const ve = id => W.entries.some(e => e.id === id && e.revealed), vm = id => (W.maps || []).some(m => m.id === id && m.revealed);
  return Object.fromEntries((W.maps || []).filter(m => m.revealed && m.img?.id).map(m => [m.id, M.playerMap(m, ve, vm)])); };
const pubMeta = () => ({ name: W.name, sections: M.playerSections(W), eras: (W.eras || []).map(x => ({ id: x.id, name: x.name, abbr: x.abbr || '', ...(x.down ? { down: true } : {}) })), months: (W.calendar?.months || []).map(m => ({ name: m.name, length: m.length })) });
function view() {
  if (isPlayer()) return fromPub(P?.meta, P?.e, P?.ev, P?.maps);
  if (ui.preview) return fromPub(pubMeta(), Object.fromEntries(W.entries.filter(e => e.revealed).map(e => [e.id, M.playerCopy(e)])), Object.fromEntries((W.events || []).filter(x => x.revealed).map(x => [x.id, M.playerEvent(x)])), pubMaps());
  return W;
}

/* ---------- Google Drive: a private file for the world, and a folder of pictures ---------- */
const FILE = 'dmp-lore.json', API = 'https://www.googleapis.com/drive/v3', UP = 'https://www.googleapis.com/upload/drive/v3';
let syncT = null, syncing = false, syncMsg = '';
const pill = m => { syncMsg = m; const e = $('#syncpill'); if (e) e.textContent = m; };
async function getToken(interactive, scope) {
  await coreReady; if (!core) throw new Error("Couldn't load the suite's sign-in.");
  scope = scope || core.SCOPES.appdata;
  let t = core.signedIn(scope, { app: 'lore' });
  if (!t && core.staysSignedIn?.()) { await core.refreshNow(); t = core.signedIn(scope, { app: 'lore' }); }
  if ((!t || !(t.exp > Date.now() + 60000)) && interactive) t = await core.signInLong(scope, { app: 'lore' });
  if (!t?.value) throw new Error('Sign in with Google in the launcher to keep your world in your Drive.');
  return t.value;
}
function syncSoon() { clearTimeout(syncT); syncT = setTimeout(() => sync(false), 2500); }
async function sync(interactive) {
  if (syncing || isPlayer()) return; syncing = true;
  try {
    pill('syncing…');
    const t = await getToken(interactive);
    const rem = await core.readAppdata(t, FILE);
    if (rem?.app === 'dmp-lore' && (rem.stamp || 0) > (W.stamp || 0)) { W = normalize(rem); await idbPut('world', W); render(); publishSoon(); }
    else if (!rem || (W.stamp || 0) > (rem.stamp || 0)) await core.writeAppdata(t, FILE, W);
    pill(`✓ saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
  } catch (e) { pill(interactive ? `⚠ ${e.message}` : '● not synced'); if (interactive) toast(e.message); }
  finally { syncing = false; }
}
const withIcons = secs => secs.map(s => ({ ...s, types: (s.types || []).map(t => ((t.icon == null || (t.name === 'Document or Text' && t.icon === '📜')) && M.TYPE_ICONS[t.name] ? { ...t, icon: M.TYPE_ICONS[t.name] } : t)) }));
const normalize = w => ({ ...M.newWorld(), ...w, sections: w?.sections?.length ? withIcons(w.sections) : M.defaultSections(), entries: (w?.entries || []).map(e => ({ facts: [], ...e })), events: w?.events || [], maps: w?.maps || [], eras: w?.eras || [], calendar: { months: w?.calendar?.months || [] }, settings: { ...(w?.settings || {}) } });

// Pictures: shrunk on this device, put in a "Lore pictures" folder in the DM's Drive, viewable by anyone with the link
async function shrink(file, max) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  const blob = await new Promise(r => cv.toBlob(r, 'image/webp', 0.86));
  return blob && blob.type === 'image/webp' ? blob : new Promise(r => cv.toBlob(r, 'image/jpeg', 0.88));
}
async function driveFetch(t, url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${t}`, ...(opts.headers || {}) } });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error?.message || `Google Drive answered ${r.status}.`); }
  return r.json().catch(() => ({}));
}
async function uploadPicture(file, max = 1600) {
  const t = await getToken(true, core.SCOPES.file);
  if (!W.settings.imgFolder) {
    const f = await driveFetch(t, `${API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Lore pictures', mimeType: 'application/vnd.google-apps.folder' }) });
    W.settings.imgFolder = f.id;
  }
  const blob = await shrink(file, max);
  const meta = { name: `${file.name.replace(/\.[^.]+$/, '') || 'picture'}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`, parents: [W.settings.imgFolder], mimeType: blob.type };
  const body = new FormData();
  body.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  body.append('file', blob);
  let up;
  try { up = await driveFetch(t, `${UP}/files?uploadType=multipart&fields=id`, { method: 'POST', body }); }
  catch (e) { if (/not found|parent/i.test(e.message)) { W.settings.imgFolder = ''; return uploadPicture(file, max); } throw e; }
  await driveFetch(t, `${API}/files/${up.id}/permissions?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'reader', type: 'anyone' }) });
  return { id: up.id };
}
async function trashPicture(img) {
  if (!img?.id) return;
  try { const t = await getToken(false, core.SCOPES.file); await driveFetch(t, `${API}/files/${img.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) }); } catch { /* it stays in the folder */ }
}
const pic = (img, w, cls = '') => (img?.id ? `<img class="${cls}" src="${M.imgUrl(img, w)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${M.imgUrl2(img)}'">` : '');

/* ---------- the table: players see what's revealed, live ---------- */
let pubT = null, published = null;
function publishSoon() { clearTimeout(pubT); pubT = setTimeout(publish, 800); }
async function publish() {
  if (!amDm()) return;
  try {
    const T = await core.tables(), tid = core.currentTable().id, t = await tablePass();
    const meta = pubMeta();
    const next = Object.fromEntries(W.entries.filter(e => e.revealed).map(e => [e.id, M.playerCopy(e)]));
    const nextEv = Object.fromEntries((W.events || []).filter(x => x.revealed).map(x => [x.id, M.playerEvent(x)]));
    const nextMp = pubMaps();
    if (!published) { await T.setLore(t, tid, { meta, e: next, ev: nextEv, maps: nextMp }); }
    else {
      const patch = {};
      if (JSON.stringify(meta) !== published.meta) patch.meta = meta;
      for (const [k, cur, was] of [['e', next, published.e], ['ev', nextEv, published.ev], ['maps', nextMp, published.maps]]) {
        for (const [id, x] of Object.entries(cur)) if (was[id] !== JSON.stringify(x)) patch[`${k}/${id}`] = x;
        for (const id of Object.keys(was)) if (!cur[id]) patch[`${k}/${id}`] = null;
      }
      if (Object.keys(patch).length) await T.updateLore(t, tid, patch);
    }
    const strs = o => Object.fromEntries(Object.entries(o).map(([id, x]) => [id, JSON.stringify(x)]));
    published = { meta: JSON.stringify(meta), e: strs(next), ev: strs(nextEv), maps: strs(nextMp) };
  } catch (e) { console.warn('publish lore', e); }
}
let stopWatch = null;
async function startPlayer() {
  const table = core.currentTable?.();
  if (!table?.id) { P = { none: 'Join your DM\'s table in the launcher first.' }; return render(); }
  if (table.status && table.status !== 'approved') { P = { none: "Your DM hasn't let you into the table yet." }; return render(); }
  P = { loading: true }; render();
  const T = await core.tables();
  stopWatch?.(); stopWatch = T.watchLore(await tablePass(), table.id, v => { P = v || { meta: null, e: {} }; render(); });
}

/* ---------- little screen helpers ---------- */
function modal(html, mount) { const m = $('#modal'); m.innerHTML = `<div class="box">${html}</div>`; m.hidden = false; m.onclick = e => { if (e.target === m) closeModal(); }; mount?.(m); }
const closeModal = () => { $('#modal').hidden = true; $('#modal').innerHTML = ''; };
let toastT; function toast(t) { let el = $('#toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.append(el); } el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 3800); }
const go = (v, a = {}) => { Object.assign(ui, { view: v }, a); render(); window.scrollTo(0, 0); };
const entry = id => view().entries.find(e => e.id === id);
const typeName = (w, id) => M.typeOf(w, id)?.name || 'Entry';
// [[links]]: to an entry that exists (and that this reader can see), or, for the DM, a tap to create it
function linker(w) {
  const by = new Map(w.entries.map(e => [e.title.toLowerCase(), e]));
  return (title, label) => {
    const e = by.get(title.toLowerCase());
    if (e) return `<a class="lk${!reader() && !e.revealed ? ' hid' : ''}" data-go="${e.id}">${label}</a>`;
    return reader() ? label : `<a class="lk miss" data-new="${esc(title)}" title="No entry yet: tap to write it">${label}</a>`;
  };
}

/* ---------- screens ---------- */
function render() {
  const app = $('#app');
  $('#back').hidden = ui.view === 'home';
  $('#settingsBtn').hidden = isPlayer();
  $('#previewBtn').hidden = isPlayer() || !['home', 'section', 'entry', 'timeline', 'maps', 'map'].includes(ui.view);
  $('#previewBtn').setAttribute('aria-pressed', String(ui.preview));
  document.body.classList.toggle('preview', ui.preview);
  if (isPlayer()) {
    if (!P || P.none || P.loading) { app.innerHTML = `<div class="card"><p>${esc(P?.none || 'Opening your world…')}</p>${P?.none ? '<p><a href="/index.html" style="color:inherit">Open the launcher</a></p>' : ''}</div>`; return; }
  }
  const w = view();
  $('#crumb').textContent = w.name || '';
  if (ui.view === 'section') return sectionView(app, w);
  if (ui.view === 'timeline') return timelineView(app, w);
  if (ui.view === 'maps') return mapsView(app, w);
  if (ui.view === 'map' && (w.maps || []).some(m => m.id === ui.map)) return mapView(app, w);
  if (ui.view === 'entry' && entry(ui.id)) return entryView(app, w);
  if (ui.view === 'edit' && !reader()) return editView(app);
  if (ui.view === 'settings' && !reader()) return settingsView(app);
  ui.view = 'home'; homeView(app, w);
}

function row(w, e) {
  return `<button class="erow" data-go="${e.id}">${e.img?.id ? pic(e.img, 160, 'thumb') : `<span class="thumb ph">${esc(M.iconOf(w, e))}</span>`}
    <span class="et"><b>${esc(e.title || 'Untitled')}</b><span class="mu small">${esc(typeName(w, e.type))}${!reader() && !e.revealed ? ' · <span class="tag hid">Hidden from players</span>' : ''}</span>
    ${e.summary ? `<span class="small sum">${esc(e.summary)}</span>` : ''}</span></button>`;
}
function homeView(app, w) {
  const list = ui.q ? M.search(w.entries, ui.q) : null;
  const recent = [...w.entries].sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 8);
  app.innerHTML = `
  <div class="card"><div class="row"><h2 class="grow">${esc(w.name || 'Lore')}</h2><button id="tl">🕰 Timeline</button><button id="mp">🗺 Maps</button>${reader() ? '' : '<button class="pri" id="newE">+ New entry</button>'}</div>
    ${ui.preview ? '<p class="note">👁 This is what your players see right now.</p>' : ''}
    <input id="q" type="search" placeholder="Search ${esc(w.name || 'the lore')}" value="${esc(ui.q)}" autocomplete="off"></div>
  ${list ? `<div class="card"><h3 style="margin-top:0">${list.length} found</h3><div class="elist">${list.map(e => row(w, e)).join('') || '<p class="mu">Nothing matches.</p>'}</div></div>` : `
  <div class="grid">${w.sections.map(s => { const ids = new Set((s.types || []).map(t => t.id)), es = w.entries.filter(e => ids.has(e.type)); const hid = es.filter(e => !e.revealed).length;
    return `<button class="tile sec" data-sec="${s.id}"><span class="icon">${esc(s.icon || '✨')}</span><b>${esc(s.name)}</b><span class="mu">${es.length} entr${es.length === 1 ? 'y' : 'ies'}${!reader() && hid ? ` · ${hid} hidden` : ''}</span></button>`; }).join('')}</div>
  ${recent.length ? `<div class="card"><h3 style="margin-top:0">Recently changed</h3><div class="elist">${recent.map(e => row(w, e)).join('')}</div></div>`
    : `<div class="card"><p class="mu">${reader() ? "Your DM hasn't revealed anything yet." : 'Nothing written yet. Tap “+ New entry” to start your world, or the ⚙ to name it and shape its sections.'}</p></div>`}`}`;
  const q = $('#q'); q.oninput = () => { ui.q = q.value; const p = q.selectionStart; homeView(app, w); const n = $('#q'); n.focus(); n.setSelectionRange(p, p); };
  bindRows(app);
  app.querySelectorAll('[data-sec]').forEach(b => { b.onclick = () => go('section', { sec: b.dataset.sec, type: '' }); });
  const n = $('#newE'); if (n) n.onclick = () => go('edit', { id: '' });
  $('#tl').onclick = () => go('timeline');
  $('#mp').onclick = () => go('maps');
}
function bindRows(app) {
  app.querySelectorAll('[data-map]').forEach(b => { b.onclick = e => { e.preventDefault(); go('map', { map: b.dataset.map, pin: b.dataset.pin || '' }); }; });
  app.querySelectorAll('[data-go]').forEach(b => { b.onclick = e => { e.preventDefault(); go('entry', { id: b.dataset.go }); }; });
  app.querySelectorAll('[data-new]').forEach(b => { b.onclick = e => { e.preventDefault(); go('edit', { id: '', newTitle: b.dataset.new }); }; });
}
function sectionView(app, w) {
  const s = w.sections.find(x => x.id === ui.sec); if (!s) return go('home');
  const types = s.types || [], ids = new Set(types.map(t => t.id));
  const es = w.entries.filter(e => ids.has(e.type) && (!ui.type || e.type === ui.type)).sort((a, b) => a.title.localeCompare(b.title));
  app.innerHTML = `<div class="card"><div class="row"><h2 class="grow">${esc(s.icon || '')} ${esc(s.name)}</h2>${reader() ? '' : '<button class="pri" id="newE">+ New entry</button>'}</div>
    <div class="row chips"><button class="sm" data-t="" aria-pressed="${!ui.type}">All</button>${types.map(t => `<button class="sm" data-t="${t.id}" aria-pressed="${ui.type === t.id}">${t.icon ? `${esc(t.icon)} ` : ''}${esc(t.name)}</button>`).join('')}</div></div>
    <div class="card"><div class="elist">${es.map(e => row(w, e)).join('') || `<p class="mu">${reader() ? 'Nothing here yet.' : 'Nothing here yet.'}</p>`}</div></div>`;
  bindRows(app);
  app.querySelectorAll('[data-t]').forEach(b => { b.onclick = () => { ui.type = b.dataset.t; render(); }; });
  const n = $('#newE'); if (n) n.onclick = () => go('edit', { id: '', newType: ui.type || types[0]?.id || '' });
}
function entryView(app, w) {
  const e = entry(ui.id), link = linker(w), t = M.typeOf(w, e.type);
  const facts = (e.facts || []).filter(f => String(f.v || '').trim() && (!reader() || !f.hidden));
  const backs = w.entries.filter(x => x.id !== e.id && [x.body, ...(x.facts || []).map(f => f.v)].some(txt => M.linksIn(txt).includes(e.title.toLowerCase())));
  app.innerHTML = `
  <article class="card entry">
    ${e.img?.id ? `<div class="hero">${pic(e.img, 1600)}</div>` : ''}
    <div class="row"><div class="grow"><h2>${esc(e.title)}</h2><span class="mu">${esc(M.iconOf(w, e))} ${esc(t?.name || 'Entry')}${t ? ` · ${esc(t.section.name)}` : ''}</span>${M.hasDate(e.date) ? `<div class="when">🕰 ${esc(M.dateText(w, e.date))}${M.hasDate(e.dateEnd) ? ` – ${esc(M.dateText(w, e.dateEnd))}` : ''}</div>` : ''}</div>
      ${reader() ? '' : `<button id="reveal" class="${e.revealed ? 'ok' : ''}" aria-pressed="${!!e.revealed}">${e.revealed ? '👁 Players can see this' : '🔒 Hidden from players'}</button><button id="edit">Edit</button>`}</div>
    ${e.summary ? `<p class="lead">${esc(e.summary)}</p>` : ''}
    ${facts.length ? `<dl class="facts">${facts.map(f => `<dt>${esc(f.k)}${f.hidden ? ' <span title="Only you see this">🔒</span>' : ''}</dt><dd>${M.render(f.v, link)}</dd>`).join('')}</dl>` : ''}
    <div class="body">${M.render(e.body, link, { secrets: !reader() }) || (reader() ? '' : '<p class="mu">Nothing written yet. Tap Edit to write about it.</p>')}</div>
    ${(w.maps || []).filter(m => (m.pins || []).some(p => p.entry === e.id)).length ? `<div class="backs"><h3>On the map</h3><div class="row">${w.maps.filter(m => (m.pins || []).some(p => p.entry === e.id)).map(m => `<a class="lk" data-map="${m.id}" data-pin="${m.pins.find(p => p.entry === e.id).id}">🗺 ${esc(m.title)}</a>`).join('')}</div></div>` : ''}
    ${backs.length ? `<div class="backs"><h3>Mentioned in</h3><div class="row">${backs.map(x => `<a class="lk${!reader() && !x.revealed ? ' hid' : ''}" data-go="${x.id}">${esc(x.title)}</a>`).join('')}</div></div>` : ''}
  </article>
  ${reader() ? '' : `<div class="card"><button class="bad" id="del">Delete this entry</button></div>`}`;
  bindRows(app);
  if (reader()) return;
  $('#reveal').onclick = () => { const x = W.entries.find(y => y.id === e.id); x.revealed = !x.revealed; save(); render(); toast(x.revealed ? `${x.title} is now visible to your players.` : `${x.title} is hidden from your players again.`); };
  $('#edit').onclick = () => go('edit', { id: e.id });
  $('#del').onclick = async () => {
    if (!confirm(`Delete ${e.title}? Links to it from other entries stay, and show as "not written yet".`)) return;
    const x = W.entries.find(y => y.id === e.id); W.entries = W.entries.filter(y => y.id !== e.id); await save(); trashPicture(x?.img);
    toast('Deleted.'); go('home');
  };
}

function editView(app) {
  const was = W.entries.find(e => e.id === ui.id) || null;
  const e = was ? JSON.parse(JSON.stringify(was)) : { id: M.uid(), title: ui.newTitle || '', type: ui.newType || M.allTypes(W)[0]?.id || '', summary: '', body: '', facts: [], img: null, revealed: false };
  ui.newTitle = ''; ui.newType = '';
  const draw = () => {
    const t = M.typeOf(W, e.type), fields = t?.fields || [];
    const facts = [...fields.map(k => e.facts.find(f => f.k === k) || { k, v: '', hidden: false }), ...e.facts.filter(f => !fields.includes(f.k))];
    e.facts = facts;
    app.innerHTML = `<div class="card edit"><h2>${was ? 'Edit' : 'New entry'}</h2>
      <label>Title</label><input id="et" value="${esc(e.title)}" placeholder="What is it called?">
      <label>Type</label><select id="ety">${W.sections.map(s => `<optgroup label="${esc(s.name)}">${(s.types || []).map(x => `<option value="${x.id}" ${x.id === e.type ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</optgroup>`).join('')}</select>
      <label>Picture</label><div class="row">${e.img?.id ? pic(e.img, 400, 'thumb big') : ''}<label class="filebtn">${e.img?.id ? 'Change picture' : 'Add a picture'}<input type="file" id="ei" accept="image/*" hidden></label>${e.img?.id ? '<button class="sm" id="erm">Remove</button>' : ''}<span class="mu small" id="eis"></span></div>
      <label>When (puts it on the Timeline; leave the era empty for no date)</label>${dateFields('ed', e.date)}
      <details ${M.hasDate(e.dateEnd) ? 'open' : ''}><summary class="mu small">It lasted a while: add an end date</summary>${dateFields('ee', e.dateEnd)}</details>
      <label>Summary (a line or two)</label><textarea id="es" rows="2" placeholder="The one thing everyone knows about it">${esc(e.summary)}</textarea>
      <label>Facts</label><div class="factedit">${facts.map((f, i) => `<input class="fk" data-fk="${i}" value="${esc(f.k)}" ${fields.includes(f.k) ? 'readonly' : ''}><input data-fv="${i}" value="${esc(f.v)}"><label class="lock" title="Secret: only you see this fact"><input type="checkbox" data-fh="${i}" ${f.hidden ? 'checked' : ''}> 🔒</label>`).join('')}</div>
      <button class="sm" id="addf">+ Add a fact</button>
      <label>Write about it</label>
      <div class="row tools"><button class="sm" data-w="b"><b>B</b></button><button class="sm" data-w="i"><i>I</i></button><button class="sm" data-w="h">Heading</button><button class="sm" data-w="l">• List</button><button class="sm" data-w="link">🔗 Link an entry</button><button class="sm" data-w="secret">🔒 Secret part</button></div>
      <textarea id="eb" rows="14" placeholder="Everything about it. Link other entries with [[Their title]]. Put things only you should see between [secret] and [/secret].">${esc(e.body)}</textarea>
      <p class="mu small">[[Title]] links another entry (one that isn't written yet shows in red, and you can tap it to write it). Anything between [secret] and [/secret] stays hidden from your players, even when the entry is revealed.</p>
      <label class="chk"><input type="checkbox" id="erv" ${e.revealed ? 'checked' : ''}> Players can see this entry</label>
      <div class="row" style="margin-top:12px"><button class="pri" id="esv">Save</button><button id="ecx">Cancel</button></div></div>`;
    const keep = () => {
      e.title = $('#et').value.trim(); e.summary = $('#es').value.trim(); e.body = $('#eb').value; e.revealed = $('#erv').checked;
      app.querySelectorAll('[data-fv]').forEach(i => { e.facts[i.dataset.fv].v = i.value; });
      app.querySelectorAll('[data-fk]').forEach(i => { e.facts[i.dataset.fk].k = i.value.trim(); });
      app.querySelectorAll('[data-fh]').forEach(i => { e.facts[i.dataset.fh].hidden = i.checked; });
      e.date = readDate('ed', app); e.dateEnd = readDate('ee', app);
    };
    $('#ety').onchange = () => { keep(); e.type = $('#ety').value; draw(); };
    $('#addf').onclick = () => { keep(); const k = prompt('Name of the fact (for example: Founded)'); if (k?.trim()) e.facts.push({ k: k.trim(), v: '', hidden: false }); draw(); };
    $('#ei').onchange = async ev => {
      const f = ev.target.files[0]; if (!f) return; keep();
      $('#eis').textContent = 'Uploading to your Drive…';
      try { const old = e.img; e.img = await uploadPicture(f); if (old?.id && old.id !== was?.img?.id) trashPicture(old); draw(); }
      catch (err) { $('#eis').textContent = ''; toast(err.message); }
    };
    const rm = $('#erm'); if (rm) rm.onclick = () => { keep(); if (e.img?.id !== was?.img?.id) trashPicture(e.img); e.img = null; draw(); };
    app.querySelectorAll('[data-w]').forEach(b => { b.onclick = () => write(b.dataset.w); });
    $('#ecx').onclick = () => { if (e.img?.id && e.img.id !== was?.img?.id) trashPicture(e.img); go(was ? 'entry' : 'home', { id: was?.id || '' }); };
    $('#esv').onclick = async () => {
      keep();
      if (!e.title) return toast('Give it a title.');
      if (W.entries.some(x => x.id !== e.id && x.title.toLowerCase() === e.title.toLowerCase())) return toast(`There's already an entry called ${e.title}. Give this one a different title, so links know which one you mean.`);
      e.facts = e.facts.filter(f => f.k && (String(f.v).trim() || (M.typeOf(W, e.type)?.fields || []).includes(f.k)));
      e.updated = Date.now();
      if (was && was.title !== e.title) for (const x of W.entries) { x.body = M.renameLinks(x.body, was.title, e.title); for (const f of x.facts || []) f.v = M.renameLinks(f.v, was.title, e.title); }
      if (was && was.img?.id && was.img.id !== e.img?.id) trashPicture(was.img);
      if (was) W.entries[W.entries.findIndex(x => x.id === e.id)] = e; else W.entries.push(e);
      if (was && was.title !== e.title) for (const x of W.entries) if (x.id === e.id) x.body = M.renameLinks(x.body, was.title, e.title);
      await save(); toast('Saved.'); go('entry', { id: e.id });
    };
  };
  // the writing buttons wrap the selected text (or add an example where nothing is selected)
  const write = kind => {
    const ta = $('#eb'), a = ta.selectionStart, b = ta.selectionEnd, sel = ta.value.slice(a, b);
    const put = (txt, from = 0, len = 0) => { ta.setRangeText(txt, a, b, 'select'); if (len) ta.setSelectionRange(a + from, a + from + len); ta.focus(); };
    if (kind === 'b') put(`**${sel || 'bold'}**`, 2, (sel || 'bold').length);
    if (kind === 'i') put(`*${sel || 'italic'}*`, 1, (sel || 'italic').length);
    if (kind === 'h') put(`\n\n# ${sel || 'Heading'}\n\n`, 4, (sel || 'Heading').length);
    if (kind === 'l') put((sel || 'First thing\nSecond thing').split('\n').map(x => `- ${x}`).join('\n'));
    if (kind === 'secret') put(`\n[secret]\n${sel || 'Only you see this.'}\n[/secret]\n`, 10, (sel || 'Only you see this.').length);
    if (kind === 'link') pickEntry(title => { ta.setSelectionRange(a, b); ta.setRangeText(`[[${title}${sel && sel !== title ? `|${sel}` : ''}]]`, a, b, 'end'); ta.focus(); });
  };
  draw();
}
function pickEntry(done) {
  modal(`<h2>Link an entry</h2><input id="pq" placeholder="Search, or type a new title" autocomplete="off"><div class="elist" id="pl" style="max-height:50vh;overflow:auto;margin-top:8px"></div>
    <div class="row" style="margin-top:10px"><button id="pnew" class="sm">Link a new title (write it later)</button><button id="px">Cancel</button></div>`, m => {
    const list = () => { const q = $('#pq', m).value.trim(); const es = (q ? M.search(W.entries, q) : [...W.entries].sort((a, b) => a.title.localeCompare(b.title))).slice(0, 40);
      $('#pl', m).innerHTML = es.map(e => `<button class="erow" data-pick="${esc(e.title)}"><span class="et"><b>${esc(e.title)}</b><span class="mu small">${esc(typeName(W, e.type))}</span></span></button>`).join('') || '<p class="mu">No match. Use the button below to link it anyway.</p>';
      m.querySelectorAll('[data-pick]').forEach(b => { b.onclick = () => { closeModal(); done(b.dataset.pick); }; }); };
    $('#pq', m).oninput = list; list(); $('#pq', m).focus();
    $('#px', m).onclick = closeModal;
    $('#pnew', m).onclick = () => { const t = $('#pq', m).value.trim(); if (!t) return toast('Type the title first.'); closeModal(); done(t); };
  });
}

/* ---------- maps ---------- */
function mapsView(app, w) {
  const maps = w.maps || [];
  app.innerHTML = `<div class="card"><div class="row"><h2 class="grow">🗺 Maps</h2>${reader() ? '' : '<label class="filebtn pri">+ New map<input type="file" id="newMap" accept="image/*" hidden></label>'}</div>
    <p class="mu small" id="mapMsg">${reader() ? 'The maps your party has.' : 'Upload a map, then pin places on it. Pins can open entries or other maps. Big maps are kept sharp up to 4000 pixels.'}</p></div>
    <div class="grid">${maps.map(m => `<button class="tile mapt" data-map="${m.id}">${pic(m.img, 600, 'mthumb')}<b>${esc(m.title || 'Untitled map')}</b><span class="mu">${(m.pins || []).length} pin${(m.pins || []).length === 1 ? '' : 's'}${!reader() && !m.revealed ? ' · <span class="tag hid">Hidden</span>' : ''}</span></button>`).join('') || `<p class="mu card">${reader() ? 'No maps yet.' : 'No maps yet.'}</p>`}</div>`;
  bindRows(app);
  const f = $('#newMap'); if (f) f.onchange = async ev => {
    const file = ev.target.files[0]; if (!file) return;
    const title = prompt('Name of the map', file.name.replace(/\.[^.]+$/, '')); if (title == null) return;
    $('#mapMsg').textContent = 'Uploading to your Drive…';
    try { const img = await uploadPicture(file, 4000); const m = { id: M.uid(), title: title.trim() || 'Untitled map', img, pins: [], revealed: false }; W.maps = [...(W.maps || []), m]; await save(); go('map', { map: m.id, pin: '' }); }
    catch (err) { toast(err.message); render(); }
  };
}
// Pan with a finger or the mouse, pinch or scroll to zoom; pins keep their size
function mapView(app, w) {
  const m = w.maps.find(x => x.id === ui.map), dm = !reader();
  const pinsHtml = () => (m.pins || []).map(p => `<button class="pin${dm && !p.revealed ? ' hid' : ''}${ui.pin === p.id ? ' on' : ''}" data-p="${p.id}" style="left:${p.x * 100}%;top:${p.y * 100}%" title="${esc(p.label)}"><span>${esc(p.label || '•')}</span></button>`).join('');
  app.innerHTML = `<div class="card"><div class="row"><h2 class="grow">${esc(m.title)}</h2>
      ${dm ? `<button id="addPin" aria-pressed="${!!ui.adding}">${ui.adding ? 'Tap the map to place it…' : '📍 Add a pin'}</button><button id="mrev" class="${m.revealed ? 'ok' : ''}">${m.revealed ? '👁 Players can see this' : '🔒 Hidden from players'}</button><button id="medit">⋯</button>` : ''}</div></div>
    <div class="mapwrap" id="mw"><div class="mapinner" id="mi">${pic(m.img, 4000, 'mapimg')}${pinsHtml()}</div>
      <div class="zoom"><button id="zin" aria-label="Zoom in">+</button><button id="zout" aria-label="Zoom out">−</button><button id="zfit" aria-label="Fit">⤢</button></div></div>
    <div id="pinbox"></div>`;
  const wrap = $('#mw'), inner = $('#mi'), img = inner.querySelector('img');
  const st = { s: 1, x: 0, y: 0 };
  const apply = () => { inner.style.transform = `translate(${st.x}px,${st.y}px) scale(${st.s})`; inner.style.setProperty('--ps', 1 / st.s); };
  const fit = () => { const W0 = wrap.clientWidth, H0 = wrap.clientHeight, iw = img.naturalWidth || 1000, ih = img.naturalHeight || 700; inner.style.width = `${iw}px`; inner.style.height = `${ih}px`; st.s = Math.min(W0 / iw, H0 / ih); st.x = (W0 - iw * st.s) / 2; st.y = (H0 - ih * st.s) / 2; apply(); };
  const zoomAt = (k, cx, cy) => { const ns = Math.max(0.05, Math.min(8, st.s * k)); st.x = cx - (cx - st.x) * (ns / st.s); st.y = cy - (cy - st.y) * (ns / st.s); st.s = ns; apply(); };
  if (img.complete && img.naturalWidth) fit(); else img.onload = fit;
  window.onresize = () => { if (ui.view === 'map') fit(); };
  $('#zin').onclick = () => zoomAt(1.4, wrap.clientWidth / 2, wrap.clientHeight / 2);
  $('#zout').onclick = () => zoomAt(1 / 1.4, wrap.clientWidth / 2, wrap.clientHeight / 2);
  $('#zfit').onclick = fit;
  wrap.onwheel = e => { e.preventDefault(); const r = wrap.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); };
  const pts = new Map(); let moved = false, last = null;
  wrap.onpointerdown = e => { if (e.target.closest('.zoom,.pin')) return; wrap.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = false; last = null; };
  wrap.onpointermove = e => {
    if (!pts.has(e.pointerId)) return;
    const p0 = pts.get(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { const dx = e.clientX - p0.x, dy = e.clientY - p0.y; if (Math.abs(dx) + Math.abs(dy) > 2) moved = true; st.x += dx; st.y += dy; apply(); }
    else if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y), r = wrap.getBoundingClientRect(); if (last) zoomAt(d / last, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); last = d; moved = true; }
  };
  const up = e => {
    const was = pts.has(e.pointerId); pts.delete(e.pointerId); if (pts.size < 2) last = null;
    if (!was || moved || !ui.adding || !dm) return;
    const r = inner.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    ui.adding = false; pinDialog(m, { id: M.uid(), x, y, label: '', revealed: false }, true);
  };
  wrap.onpointerup = up; wrap.onpointercancel = up;
  // a pin: what it is, and where it leads
  const showPin = id => {
    const p = (m.pins || []).find(x => x.id === id); ui.pin = id;
    inner.querySelectorAll('.pin').forEach(b => b.classList.toggle('on', b.dataset.p === id));
    const e = p?.entry && w.entries.find(x => x.id === p.entry), mm = p?.map && w.maps.find(x => x.id === p.map);
    $('#pinbox').innerHTML = p ? `<div class="card"><div class="row"><b class="grow">📍 ${esc(p.label || (e?.title) || (mm?.title) || 'A pin')}</b>${dm && !p.revealed ? '<span class="tag hid">Hidden</span>' : ''}</div>
      ${e ? `<p>${esc(e.summary || '')}</p>` : ''}
      <div class="row">${e ? `<button class="pri" data-go="${e.id}">Open ${esc(e.title)}</button>` : ''}${mm ? `<button class="pri" data-map="${mm.id}">🗺 Open ${esc(mm.title)}</button>` : ''}${dm ? '<button id="pedit">Edit pin</button>' : ''}</div></div>` : '';
    bindRows($('#pinbox'));
    const pe = $('#pedit'); if (pe) pe.onclick = () => pinDialog(m, p, false);
  };
  inner.querySelectorAll('.pin').forEach(b => { b.onclick = e => { e.stopPropagation(); showPin(b.dataset.p); }; });
  if (ui.pin) showPin(ui.pin);
  if (!dm) return;
  $('#addPin').onclick = () => { ui.adding = !ui.adding; $('#addPin').textContent = ui.adding ? 'Tap the map to place it…' : '📍 Add a pin'; $('#addPin').setAttribute('aria-pressed', String(ui.adding)); };
  $('#mrev').onclick = () => { const x = W.maps.find(y => y.id === m.id); x.revealed = !x.revealed; save(); render(); toast(x.revealed ? 'Players can see this map (and its revealed pins).' : 'Map hidden from players.'); };
  $('#medit').onclick = () => modal(`<h2>${esc(m.title)}</h2><label>Name</label><input id="mn" value="${esc(m.title)}">
    <div class="row" style="margin-top:12px"><button class="pri" id="ms">Save</button><button id="mc">Cancel</button><span class="grow"></span><button class="bad" id="md">Delete map</button></div>`, md => {
    $('#mc', md).onclick = closeModal;
    $('#ms', md).onclick = () => { const x = W.maps.find(y => y.id === m.id); x.title = $('#mn', md).value.trim() || x.title; save(); closeModal(); render(); };
    $('#md', md).onclick = () => { if (!confirm(`Delete ${m.title} and its pins?`)) return; const x = W.maps.find(y => y.id === m.id); W.maps = W.maps.filter(y => y.id !== m.id); for (const o of W.maps) o.pins = (o.pins || []).filter(p => p.map !== m.id); save(); trashPicture(x.img); closeModal(); go('maps'); };
  });
}
function pinDialog(m, p, isNew) {
  const e0 = p.entry ? W.entries.find(x => x.id === p.entry) : null;
  const others = (W.maps || []).filter(x => x.id !== m.id);
  modal(`<h2>${isNew ? 'New pin' : 'Pin'}</h2><label>Label</label><input id="pl" value="${esc(p.label)}" placeholder="Leave empty to use the entry's title">
    <label>Opens this entry</label><div class="row"><span class="grow" id="pe">${e0 ? esc(e0.title) : '<span class="mu">None</span>'}</span><button class="sm" id="pep">Choose</button>${e0 ? '<button class="sm" id="pex">Clear</button>' : ''}</div>
    ${others.length ? `<label>Or opens this map</label><select id="pm"><option value="">None</option>${others.map(x => `<option value="${x.id}" ${p.map === x.id ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select>` : ''}
    <label class="chk"><input type="checkbox" id="pr" ${p.revealed ? 'checked' : ''}> Players can see this pin</label>
    <div class="row" style="margin-top:12px"><button class="pri" id="ps">Save</button><button id="pc">Cancel</button><span class="grow"></span>${isNew ? '' : '<button class="bad" id="pd">Remove pin</button>'}</div>`, md => {
    let entry = p.entry || '';
    $('#pc', md).onclick = closeModal;
    $('#pep', md).onclick = () => { const keep = { label: $('#pl', md).value, map: $('#pm', md)?.value || '', rev: $('#pr', md).checked }; pickEntry(title => { const e = W.entries.find(x => x.title.toLowerCase() === title.toLowerCase()); pinDialog(m, { ...p, label: keep.label, map: keep.map, revealed: keep.rev, entry: e?.id || '' }, isNew); if (!e) toast('Write that entry first, then pin it.'); }); };
    const cx = $('#pex', md); if (cx) cx.onclick = () => pinDialog(m, { ...p, label: $('#pl', md).value, entry: '' }, isNew);
    $('#ps', md).onclick = () => {
      const x = W.maps.find(y => y.id === m.id);
      const pin = { ...p, label: $('#pl', md).value.trim(), entry, map: $('#pm', md)?.value || '', revealed: $('#pr', md).checked };
      if (!pin.label && !pin.entry && !pin.map) return toast('Give the pin a label, or choose what it opens.');
      if (!pin.label) pin.label = W.entries.find(y => y.id === pin.entry)?.title || W.maps.find(y => y.id === pin.map)?.title || '';
      x.pins = [...(x.pins || []).filter(y => y.id !== pin.id), pin];
      save(); closeModal(); ui.pin = pin.id; render();
    };
    const d = $('#pd', md); if (d) d.onclick = () => { const x = W.maps.find(y => y.id === m.id); x.pins = x.pins.filter(y => y.id !== p.id); ui.pin = ''; save(); closeModal(); render(); };
  });
}

/* ---------- the Timeline ---------- */
// The date boxes: an era, a year, and (if known) a month and day; "around" for when nobody's sure
function dateFields(p, d) {
  d = d || {};
  if (!(W.eras || []).length) return `<p class="mu small">Add an era first (in ⚙, under Timeline) to give things dates.</p>`;
  const months = W.calendar?.months || [];
  return `<div class="row datef"><select data-d="${p}-era" style="width:auto"><option value="">No date</option>${W.eras.map(x => `<option value="${x.id}" ${d.era === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
    <input data-d="${p}-year" class="n" inputmode="numeric" placeholder="Year" value="${esc(d.year ?? '')}">
    ${months.length ? `<select data-d="${p}-month" style="width:auto"><option value="">Month</option>${months.map((m, i) => `<option value="${i}" ${String(d.month) === String(i) ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>`
      : `<input data-d="${p}-month" class="n" inputmode="numeric" placeholder="Month #" value="${d.month === '' || d.month == null ? '' : Number(d.month) + 1}">`}
    <input data-d="${p}-day" class="n" inputmode="numeric" placeholder="Day" value="${esc(d.day ?? '')}">
    <label class="chk" style="margin:0"><input type="checkbox" data-d="${p}-approx" ${d.approx ? 'checked' : ''}> Around</label></div>`;
}
function readDate(p, root) {
  const v = k => root.querySelector(`[data-d="${p}-${k}"]`);
  if (!v('era') || !v('era').value || v('year').value.trim() === '') return null;
  const months = W.calendar?.months || [];
  let month = v('month').value.trim(); month = month === '' ? '' : months.length ? Number(month) : Math.max(0, Number(month) - 1);
  return { era: v('era').value, year: Number(v('year').value) || 0, month, day: month === '' ? '' : (Number(v('day').value) || ''), approx: v('approx').checked || undefined };
}
function timelineView(app, w) {
  const items = M.timeline(w), link = linker(w);
  const eraOf = it => (w.eras || []).find(x => x.id === it.date.era);
  let last = null;
  app.innerHTML = `<div class="card"><div class="row"><h2 class="grow">🕰 Timeline</h2>${reader() ? '' : '<button class="pri" id="addEv">+ Add an event</button>'}</div>
    <p class="mu small">${reader() ? 'What you know of the world\'s history.' : 'Every entry with a date shows here, with the events you add. Hidden ones stay hidden from your players.'}${!reader() && !(W.eras || []).length ? ' Start by naming an era in ⚙.' : ''}</p></div>
  <div class="card"><ol class="tline">${items.map(it => { const era = eraOf(it), head = era && era !== last ? `<li class="era"><b>${esc(era.name)}</b>${era.abbr ? ` <span class="mu">(${esc(era.abbr)})</span>` : ''}</li>` : ''; last = era;
    return `${head}<li class="ev${!reader() && !it.revealed ? ' hid' : ''}" ${it.kind === 'entry' ? `data-go="${it.id}"` : `data-ev="${it.id}"`}><span class="d">${esc(M.dateText(w, it.date))}${M.hasDate(it.end) ? ` – ${esc(M.dateText(w, it.end))}` : ''}</span>
      <span class="t"><b>${esc(it.title)}</b>${it.kind === 'entry' ? ` <span class="mu small">${esc(typeName(w, it.type))}</span>` : ''}${!reader() && !it.revealed ? ' <span class="tag hid">Hidden</span>' : ''}</span>
      ${it.text ? `<span class="x">${it.kind === 'event' ? M.render(it.text, link, { secrets: !reader() }) : esc(it.text)}</span>` : ''}</li>`; }).join('') || `<li class="mu">${reader() ? 'Nothing here yet.' : 'Nothing dated yet. Give an entry a date, or add an event.'}</li>`}</ol></div>`;
  app.querySelectorAll('[data-go]').forEach(b => { b.onclick = e => { e.preventDefault(); e.stopPropagation(); go('entry', { id: b.dataset.go }); }; });
  app.querySelectorAll('[data-new]').forEach(b => { b.onclick = e => { e.stopPropagation(); go('edit', { id: '', newTitle: b.dataset.new }); }; });
  if (reader()) return;
  app.querySelectorAll('li[data-ev]').forEach(li => { li.onclick = e => { if (e.target.closest('a')) return; eventDialog(li.dataset.ev); }; });
  const a = $('#addEv'); if (a) a.onclick = () => eventDialog('');
}
function eventDialog(id) {
  const was = (W.events || []).find(x => x.id === id);
  const x = was ? JSON.parse(JSON.stringify(was)) : { id: M.uid(), title: '', date: null, dateEnd: null, text: '', revealed: false };
  modal(`<h2>${was ? 'Event' : 'New event'}</h2><label>What happened</label><input id="vt" value="${esc(x.title)}" placeholder="The harbor burns">
    <label>When</label>${dateFields('vd', x.date)}<details ${M.hasDate(x.dateEnd) ? 'open' : ''}><summary class="mu small">It lasted a while: add an end date</summary>${dateFields('ve', x.dateEnd)}</details>
    <label>More about it (optional; [[links]] and [secret] parts work here too)</label><textarea id="vx" rows="5">${esc(x.text)}</textarea>
    <label class="chk"><input type="checkbox" id="vr" ${x.revealed ? 'checked' : ''}> Players can see this event</label>
    <div class="row" style="margin-top:12px"><button class="pri" id="vs">Save</button><button id="vc">Cancel</button><span class="grow"></span>${was ? '<button class="bad" id="vdel">Delete</button>' : ''}</div>`, m => {
    $('#vc', m).onclick = closeModal;
    $('#vs', m).onclick = () => {
      x.title = $('#vt', m).value.trim(); if (!x.title) return toast('Say what happened.');
      x.date = readDate('vd', m); if (!x.date) return toast('Give it a date (an era and a year).');
      x.dateEnd = readDate('ve', m); x.text = $('#vx', m).value; x.revealed = $('#vr', m).checked;
      W.events = W.events || [];
      if (was) W.events[W.events.indexOf(was)] = x; else W.events.push(x);
      save(); closeModal(); render();
    };
    const d = $('#vdel', m); if (d) d.onclick = () => { if (!confirm('Delete this event?')) return; W.events = W.events.filter(y => y.id !== id); save(); closeModal(); render(); };
  });
}

const eraUsed = id => [...W.entries.flatMap(e => [e.date, e.dateEnd]), ...(W.events || []).flatMap(x => [x.date, x.dateEnd])].some(d => d?.era === id);
function settingsView(app) {
  const used = id => W.entries.filter(e => e.type === id).length;
  app.innerHTML = `<div class="card"><h2>Your world</h2><label>Name</label><input id="wn" value="${esc(W.name)}"></div>
    <div class="card"><h2>Sections and types</h2><p class="mu small">Rename anything, add your own types and the facts each one keeps. Facts are listed with commas between them.</p>
      ${W.sections.map((s, si) => `<div class="secedit"><div class="row"><input class="icon" data-si="${si}" data-k="icon" value="${esc(s.icon || '')}" aria-label="Icon"><input class="grow" data-si="${si}" data-k="name" value="${esc(s.name)}" aria-label="Section name">${s.types.some(t => used(t.id)) ? '' : `<button class="sm bad" data-delsec="${si}">Remove</button>`}</div>
        ${s.types.map((t, ti) => `<div class="typeedit"><input class="icon" data-si="${si}" data-ti="${ti}" data-k="ticon" value="${esc(t.icon || '')}" aria-label="Type icon" placeholder="${esc(s.icon || '')}"><input data-si="${si}" data-ti="${ti}" data-k="tname" value="${esc(t.name)}" aria-label="Type name"><input data-si="${si}" data-ti="${ti}" data-k="fields" value="${esc((t.fields || []).join(', '))}" placeholder="Facts, with commas" aria-label="Facts"><span class="mu small" title="Entries of this type">${used(t.id) || ''}</span>${used(t.id) ? '<span></span>' : `<button class="sm" data-deltype="${si}.${ti}" aria-label="Remove type">✕</button>`}</div>`).join('')}
        <button class="sm" data-addtype="${si}">+ Add a type</button></div>`).join('')}
      <button id="addsec">+ Add a section</button></div>
    <div class="card"><h2>Timeline</h2><p class="mu small">Name your world's eras, oldest first. Years count up within an era, unless you tick "counts down" (like years before a great event).</p>
      ${(W.eras || []).map((x, i) => `<div class="eraedit"><input data-era="${i}" data-k="name" value="${esc(x.name)}" placeholder="Era name" aria-label="Era name"><input data-era="${i}" data-k="abbr" value="${esc(x.abbr || '')}" placeholder="Short" aria-label="Short name" class="n">
        <label class="chk" style="margin:0"><input type="checkbox" data-era="${i}" data-k="down" ${x.down ? 'checked' : ''}> counts down</label>
        <button class="sm" data-eramove="${i}" ${i ? '' : 'disabled'} aria-label="Move up">↑</button>${eraUsed(x.id) ? '<span></span>' : `<button class="sm" data-eradel="${i}" aria-label="Remove">✕</button>`}</div>`).join('') || '<p class="mu">No eras yet.</p>'}
      <button id="addEra">+ Add an era</button>
      <h3>Months</h3><p class="mu small">For exact dates. One per line: the name, then the number of days.</p>
      <textarea id="months" rows="5" placeholder="First Month, 30">${esc((W.calendar?.months || []).map(m => `${m.name}, ${m.length}`).join('\n'))}</textarea>
      <div class="row"><button class="sm" id="snCal">Use my Session Notes calendar</button></div></div>
    <div class="card"><h2>Google Drive</h2><div class="row"><button id="syncNow" class="pri">Sync now</button><span class="mu">${esc(syncMsg)}</span></div>
      <p class="mu small">Your world is kept privately in your Google Drive. Pictures go in a "Lore pictures" folder there, viewable by link, so your players see them without any extra steps.</p></div>
    <div class="card"><h2>Backup</h2><div class="row"><button id="exp">Save a backup file</button><label class="filebtn">Load a backup<input type="file" id="imp" accept=".json" hidden></label></div></div>`;
  $('#wn').onchange = e => { W.name = e.target.value.trim() || 'My World'; save(); };
  app.querySelectorAll('[data-si]').forEach(i => {
    i.onchange = () => {
      const s = W.sections[i.dataset.si], k = i.dataset.k;
      if (k === 'icon') s.icon = i.value.trim();
      else if (k === 'name') s.name = i.value.trim() || s.name;
      else { const t = s.types[i.dataset.ti]; if (k === 'tname') t.name = i.value.trim() || t.name; else if (k === 'ticon') t.icon = i.value.trim(); else t.fields = i.value.split(',').map(x => x.trim()).filter(Boolean); }
      save();
    };
  });
  app.querySelectorAll('[data-addtype]').forEach(b => { b.onclick = () => { const n = prompt('Name of the new type'); if (!n?.trim()) return; W.sections[b.dataset.addtype].types.push({ id: M.uid(), name: n.trim(), fields: [] }); save(); render(); }; });
  app.querySelectorAll('[data-deltype]').forEach(b => { b.onclick = () => { const [si, ti] = b.dataset.deltype.split('.').map(Number); W.sections[si].types.splice(ti, 1); save(); render(); }; });
  app.querySelectorAll('[data-delsec]').forEach(b => { b.onclick = () => { if (!confirm('Remove this section and its types?')) return; W.sections.splice(Number(b.dataset.delsec), 1); save(); render(); }; });
  $('#addsec').onclick = () => { const n = prompt('Name of the new section'); if (!n?.trim()) return; W.sections.push({ id: M.uid(), name: n.trim(), icon: '✨', types: [{ id: M.uid(), name: n.trim(), fields: [] }] }); save(); render(); };
  $('#syncNow').onclick = () => sync(true).then(render);
  app.querySelectorAll('[data-era]').forEach(i => { i.onchange = () => { const x = W.eras[i.dataset.era]; if (i.dataset.k === 'down') x.down = i.checked || undefined; else x[i.dataset.k] = i.value.trim(); save(); }; });
  app.querySelectorAll('[data-eramove]').forEach(b => { b.onclick = () => { const i = Number(b.dataset.eramove); [W.eras[i - 1], W.eras[i]] = [W.eras[i], W.eras[i - 1]]; save(); render(); }; });
  app.querySelectorAll('[data-eradel]').forEach(b => { b.onclick = () => { W.eras.splice(Number(b.dataset.eradel), 1); save(); render(); }; });
  $('#addEra').onclick = () => { const n = prompt('Name of the era (for example: The Old Kingdom)'); if (!n?.trim()) return; W.eras = [...(W.eras || []), { id: M.uid(), name: n.trim(), abbr: '' }]; save(); render(); };
  $('#months').onchange = e => {
    const months = e.target.value.split('\n').map(l => l.match(/^(.*?)[,\s]+(\d+)\s*$/)).filter(Boolean).map(m => ({ name: m[1].trim(), length: Number(m[2]) }));
    W.calendar = { months }; save(); toast(months.length ? `${months.length} months saved.` : 'Months cleared.');
  };
  $('#snCal').onclick = async () => {
    try {
      const t = await getToken(true), sn = await core.readAppdata(t, 'session-notes-sync.json');
      const camps = (sn?.campaigns || []).filter(c => !c.deleted && c.calendar?.months?.length);
      if (!camps.length) return toast("Couldn't find a calendar in Session Notes.");
      const cur = core.currentCampaign?.()?.id, c = camps.find(x => x.id === cur) || camps[0];
      W.calendar = { months: c.calendar.months.map(m => ({ name: m.name, length: m.length })) }; save(); render();
      toast(`Using the months from ${c.name || 'your campaign'}'s calendar.`);
    } catch (err) { toast(err.message); }
  };
  $('#exp').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(W, null, 1)], { type: 'application/json' })); a.download = `lore-${(W.name || 'world').replace(/[^\w-]+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`; a.click(); };
  $('#imp').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const o = JSON.parse(await f.text()); if (o?.app !== 'dmp-lore') throw new Error("That isn't a Lore backup."); if (!confirm(`Replace everything here with ${o.name || 'the backup'}?`)) return; W = normalize(o); await save(); go('home'); } catch (err) { toast(err.message); } };
}

/* ---------- start ---------- */
$('#back').onclick = () => {
  if (ui.view === 'entry') { const e = entry(ui.id); const s = e && M.sectionOf(view(), e); return s ? go('section', { sec: s.id, type: '' }) : go('home'); }
  if (ui.view === 'edit' && ui.id) return go('entry', { id: ui.id });
  if (ui.view === 'map') { const up = (view().maps || []).find(m => (m.pins || []).some(p => p.map === ui.map)); return up ? go('map', { map: up.id, pin: '' }) : go('maps'); }
  go('home');
};
$('#settingsBtn').onclick = () => { ui.preview = false; go('settings'); };
$('#previewBtn').onclick = () => { ui.preview = !ui.preview; if (ui.view === 'entry' && ui.preview && !W.entries.find(e => e.id === ui.id)?.revealed) ui.view = 'home'; render(); };
(async () => {
  const st = await idbGet('world');
  if (st) W = normalize(st);
  await coreReady;
  if (isPlayer()) return startPlayer();
  render();
  if (core?.signedIn?.(core.SCOPES.appdata, { app: 'lore' }) || core?.staysSignedIn?.()) sync(false);
  publishSoon();
})();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
