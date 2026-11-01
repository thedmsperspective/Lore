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
const fromPub = (meta, e) => ({ name: meta?.name || 'Lore', sections: (meta?.sections || []).map(s => ({ ...s, types: Object.values(s.types || {}) })),
  entries: Object.values(e || {}).map(x => ({ ...x, facts: Object.values(x.facts || {}), revealed: true })) });
function view() {
  if (isPlayer()) return fromPub(P?.meta, P?.e);
  if (ui.preview) return fromPub({ name: W.name, sections: M.playerSections(W) }, Object.fromEntries(W.entries.filter(e => e.revealed).map(e => [e.id, M.playerCopy(e)])));
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
const normalize = w => ({ ...M.newWorld(), ...w, sections: w?.sections?.length ? w.sections : M.defaultSections(), entries: (w?.entries || []).map(e => ({ facts: [], ...e })), settings: { ...(w?.settings || {}) } });

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
    const meta = { name: W.name, sections: M.playerSections(W) };
    const next = Object.fromEntries(W.entries.filter(e => e.revealed).map(e => [e.id, M.playerCopy(e)]));
    if (!published) { await T.setLore(t, tid, { meta, e: next }); }
    else {
      const patch = {};
      if (JSON.stringify(meta) !== published.meta) patch.meta = meta;
      for (const [id, x] of Object.entries(next)) if (published.e[id] !== JSON.stringify(x)) patch[`e/${id}`] = x;
      for (const id of Object.keys(published.e)) if (!next[id]) patch[`e/${id}`] = null;
      if (Object.keys(patch).length) await T.updateLore(t, tid, patch);
    }
    published = { meta: JSON.stringify(meta), e: Object.fromEntries(Object.entries(next).map(([id, x]) => [id, JSON.stringify(x)])) };
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
  $('#previewBtn').hidden = isPlayer() || !['home', 'section', 'entry'].includes(ui.view);
  $('#previewBtn').setAttribute('aria-pressed', String(ui.preview));
  document.body.classList.toggle('preview', ui.preview);
  if (isPlayer()) {
    if (!P || P.none || P.loading) { app.innerHTML = `<div class="card"><p>${esc(P?.none || 'Opening your world…')}</p>${P?.none ? '<p><a href="/index.html" style="color:inherit">Open the launcher</a></p>' : ''}</div>`; return; }
  }
  const w = view();
  $('#crumb').textContent = w.name || '';
  if (ui.view === 'section') return sectionView(app, w);
  if (ui.view === 'entry' && entry(ui.id)) return entryView(app, w);
  if (ui.view === 'edit' && !reader()) return editView(app);
  if (ui.view === 'settings' && !reader()) return settingsView(app);
  ui.view = 'home'; homeView(app, w);
}

function row(w, e) {
  return `<button class="erow" data-go="${e.id}">${e.img?.id ? pic(e.img, 160, 'thumb') : `<span class="thumb ph">${esc(M.sectionOf(w, e)?.icon || '✨')}</span>`}
    <span class="et"><b>${esc(e.title || 'Untitled')}</b><span class="mu small">${esc(typeName(w, e.type))}${!reader() && !e.revealed ? ' · <span class="tag hid">Hidden from players</span>' : ''}</span>
    ${e.summary ? `<span class="small sum">${esc(e.summary)}</span>` : ''}</span></button>`;
}
function homeView(app, w) {
  const list = ui.q ? M.search(w.entries, ui.q) : null;
  const recent = [...w.entries].sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 8);
  app.innerHTML = `
  <div class="card"><div class="row"><h2 class="grow">${esc(w.name || 'Lore')}</h2>${reader() ? '' : '<button class="pri" id="newE">+ New entry</button>'}</div>
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
}
function bindRows(app) {
  app.querySelectorAll('[data-go]').forEach(b => { b.onclick = e => { e.preventDefault(); go('entry', { id: b.dataset.go }); }; });
  app.querySelectorAll('[data-new]').forEach(b => { b.onclick = e => { e.preventDefault(); go('edit', { id: '', newTitle: b.dataset.new }); }; });
}
function sectionView(app, w) {
  const s = w.sections.find(x => x.id === ui.sec); if (!s) return go('home');
  const types = s.types || [], ids = new Set(types.map(t => t.id));
  const es = w.entries.filter(e => ids.has(e.type) && (!ui.type || e.type === ui.type)).sort((a, b) => a.title.localeCompare(b.title));
  app.innerHTML = `<div class="card"><div class="row"><h2 class="grow">${esc(s.icon || '')} ${esc(s.name)}</h2>${reader() ? '' : '<button class="pri" id="newE">+ New entry</button>'}</div>
    <div class="row chips"><button class="sm" data-t="" aria-pressed="${!ui.type}">All</button>${types.map(t => `<button class="sm" data-t="${t.id}" aria-pressed="${ui.type === t.id}">${esc(t.name)}</button>`).join('')}</div></div>
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
    <div class="row"><div class="grow"><h2>${esc(e.title)}</h2><span class="mu">${esc(t?.name || 'Entry')}${t ? ` · ${esc(t.section.name)}` : ''}</span></div>
      ${reader() ? '' : `<button id="reveal" class="${e.revealed ? 'ok' : ''}" aria-pressed="${!!e.revealed}">${e.revealed ? '👁 Players can see this' : '🔒 Hidden from players'}</button><button id="edit">Edit</button>`}</div>
    ${e.summary ? `<p class="lead">${esc(e.summary)}</p>` : ''}
    ${facts.length ? `<dl class="facts">${facts.map(f => `<dt>${esc(f.k)}${f.hidden ? ' <span title="Only you see this">🔒</span>' : ''}</dt><dd>${M.render(f.v, link)}</dd>`).join('')}</dl>` : ''}
    <div class="body">${M.render(e.body, link, { secrets: !reader() }) || (reader() ? '' : '<p class="mu">Nothing written yet. Tap Edit to write about it.</p>')}</div>
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

function settingsView(app) {
  const used = id => W.entries.filter(e => e.type === id).length;
  app.innerHTML = `<div class="card"><h2>Your world</h2><label>Name</label><input id="wn" value="${esc(W.name)}"></div>
    <div class="card"><h2>Sections and types</h2><p class="mu small">Rename anything, add your own types and the facts each one keeps. Facts are listed with commas between them.</p>
      ${W.sections.map((s, si) => `<div class="secedit"><div class="row"><input class="icon" data-si="${si}" data-k="icon" value="${esc(s.icon || '')}" aria-label="Icon"><input class="grow" data-si="${si}" data-k="name" value="${esc(s.name)}" aria-label="Section name">${s.types.some(t => used(t.id)) ? '' : `<button class="sm bad" data-delsec="${si}">Remove</button>`}</div>
        ${s.types.map((t, ti) => `<div class="typeedit"><input data-si="${si}" data-ti="${ti}" data-k="tname" value="${esc(t.name)}" aria-label="Type name"><input data-si="${si}" data-ti="${ti}" data-k="fields" value="${esc((t.fields || []).join(', '))}" placeholder="Facts, with commas" aria-label="Facts"><span class="mu small" title="Entries of this type">${used(t.id) || ''}</span>${used(t.id) ? '<span></span>' : `<button class="sm" data-deltype="${si}.${ti}" aria-label="Remove type">✕</button>`}</div>`).join('')}
        <button class="sm" data-addtype="${si}">+ Add a type</button></div>`).join('')}
      <button id="addsec">+ Add a section</button></div>
    <div class="card"><h2>Google Drive</h2><div class="row"><button id="syncNow" class="pri">Sync now</button><span class="mu">${esc(syncMsg)}</span></div>
      <p class="mu small">Your world is kept privately in your Google Drive. Pictures go in a "Lore pictures" folder there, viewable by link, so your players see them without any extra steps.</p></div>
    <div class="card"><h2>Backup</h2><div class="row"><button id="exp">Save a backup file</button><label class="filebtn">Load a backup<input type="file" id="imp" accept=".json" hidden></label></div></div>`;
  $('#wn').onchange = e => { W.name = e.target.value.trim() || 'My World'; save(); };
  app.querySelectorAll('[data-si]').forEach(i => {
    i.onchange = () => {
      const s = W.sections[i.dataset.si], k = i.dataset.k;
      if (k === 'icon') s.icon = i.value.trim();
      else if (k === 'name') s.name = i.value.trim() || s.name;
      else { const t = s.types[i.dataset.ti]; if (k === 'tname') t.name = i.value.trim() || t.name; else t.fields = i.value.split(',').map(x => x.trim()).filter(Boolean); }
      save();
    };
  });
  app.querySelectorAll('[data-addtype]').forEach(b => { b.onclick = () => { const n = prompt('Name of the new type'); if (!n?.trim()) return; W.sections[b.dataset.addtype].types.push({ id: M.uid(), name: n.trim(), fields: [] }); save(); render(); }; });
  app.querySelectorAll('[data-deltype]').forEach(b => { b.onclick = () => { const [si, ti] = b.dataset.deltype.split('.').map(Number); W.sections[si].types.splice(ti, 1); save(); render(); }; });
  app.querySelectorAll('[data-delsec]').forEach(b => { b.onclick = () => { if (!confirm('Remove this section and its types?')) return; W.sections.splice(Number(b.dataset.delsec), 1); save(); render(); }; });
  $('#addsec').onclick = () => { const n = prompt('Name of the new section'); if (!n?.trim()) return; W.sections.push({ id: M.uid(), name: n.trim(), icon: '✨', types: [{ id: M.uid(), name: n.trim(), fields: [] }] }); save(); render(); };
  $('#syncNow').onclick = () => sync(true).then(render);
  $('#exp').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(W, null, 1)], { type: 'application/json' })); a.download = `lore-${(W.name || 'world').replace(/[^\w-]+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`; a.click(); };
  $('#imp').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const o = JSON.parse(await f.text()); if (o?.app !== 'dmp-lore') throw new Error("That isn't a Lore backup."); if (!confirm(`Replace everything here with ${o.name || 'the backup'}?`)) return; W = normalize(o); await save(); go('home'); } catch (err) { toast(err.message); } };
}

/* ---------- start ---------- */
$('#back').onclick = () => {
  if (ui.view === 'entry') { const e = entry(ui.id); const s = e && M.sectionOf(view(), e); return s ? go('section', { sec: s.id, type: '' }) : go('home'); }
  if (ui.view === 'edit' && ui.id) return go('entry', { id: ui.id });
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
