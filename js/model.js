// The DM's Perspective — Lore: the shape of a world. Pure functions, no screen and no storage.
//
// A world starts with no lore at all: just a starting set of sections and entry types, each with a few fact fields.
// Every DM renames, adds or removes them to fit their own world. Nothing about any particular world lives here.

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);

const T = (name, fields) => ({ id: uid(), name, fields });
export function defaultSections() {
  return [
    { id: uid(), name: 'Places', icon: '🗺️', types: [T('Region or Country', ['Government', 'Ruler', 'Capital', 'Population']), T('Settlement', ['Size', 'Population', 'Ruler', 'Region']), T('Landmark or Building', ['Location', 'Owner', 'Purpose']), T('Geography', ['Kind', 'Region', 'Climate']), T('Plane', ['Kind', 'How to reach it', 'Ruler'])] },
    { id: uid(), name: 'People', icon: '👥', types: [T('Character', ['People', 'Role', 'Allegiance', 'Status', 'Location']), T('People or Species', ['Homeland', 'Lifespan', 'Size']), T('Culture', ['Region', 'Language', 'Values']), T('Language', ['Speakers', 'Script', 'Region'])] },
    { id: uid(), name: 'Powers', icon: '⚜️', types: [T('Deity', ['Domains', 'Symbol', 'Alignment', 'Worshippers']), T('Religion', ['Deities', 'Leader', 'Center of worship']), T('Faction or Organization', ['Leader', 'Base', 'Goals', 'Allies', 'Enemies']), T('Military', ['Commander', 'Size', 'Base']), T('Title or Rank', ['Held by', 'Granted by'])] },
    { id: uid(), name: 'Things', icon: '📦', types: [T('Item or Artifact', ['Owner', 'Location', 'Made by']), T('Material', ['Found in', 'Uses']), T('Document or Text', ['Author', 'Location']), T('Technology or Magic', ['Discovered by', 'Uses'])] },
    { id: uid(), name: 'History', icon: '📜', types: [T('Event or Conflict', ['Place', 'Involved', 'Outcome']), T('Myth or Legend', ['Told by', 'Origin']), T('Tradition', ['Practiced by', 'When'])] },
    { id: uid(), name: 'Other', icon: '✨', types: [T('Note', [])] },
  ];
}
export const newWorld = () => ({ app: 'dmp-lore', v: 1, name: 'My World', sections: defaultSections(), entries: [], stamp: 0, settings: {} });

/** Every type with the section it sits in */
export const allTypes = w => (w.sections || []).flatMap(s => (s.types || []).map(t => ({ ...t, section: s })));
export const typeOf = (w, id) => allTypes(w).find(t => t.id === id) || null;
export const sectionOf = (w, e) => typeOf(w, e.type)?.section || (w.sections || []).at(-1) || null;

/* ---------- writing: a few simple marks, links to other entries, and secret blocks ---------- */
// **bold**, *italic*, # Heading, - list items, [[Entry title]] or [[Entry title|shown text]], and
// [secret] ... [/secret] for parts only the DM sees.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export { esc };
/** Take out the secret blocks (what players get) */
export const stripSecrets = text => String(text || '').replace(/\[secret\][\s\S]*?(\[\/secret\]|$)/gi, '').replace(/\n{3,}/g, '\n\n').trim();
const inline = (s, link) => esc(s)
  .replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, t, label) => link(t.trim(), (label || t).trim()))
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<i>$2</i>');
/** Turn written text into HTML. link(title, label) returns the HTML for an [[entry link]]. */
export function render(text, link, { secrets = true } = {}) {
  const src = secrets ? String(text || '') : stripSecrets(text);
  const out = [];
  // split into secret and open parts
  const parts = src.split(/(\[secret\][\s\S]*?(?:\[\/secret\]|$))/i);
  for (const part of parts) {
    if (!part) continue;
    const m = part.match(/^\[secret\]([\s\S]*?)(?:\[\/secret\])?$/i);
    if (m) { out.push(`<div class="secret"><span class="slbl">🔒 Secret: only you see this</span>${blocks(m[1], link)}</div>`); continue; }
    out.push(blocks(part, link));
  }
  return out.join('');
}
function blocks(text, link) {
  // line by line: headings stand alone, list items group into a list, other lines group into paragraphs
  const html = []; let para = [], list = [];
  const flush = () => {
    if (para.length) html.push(`<p>${para.map(l => inline(l, link)).join('<br>')}</p>`);
    if (list.length) html.push(`<ul>${list.map(l => `<li>${inline(l, link)}</li>`).join('')}</ul>`);
    para = []; list = [];
  };
  for (const raw of String(text).split('\n')) {
    const l = raw.replace(/\s+$/, '');
    if (!l.trim()) { flush(); continue; }
    const h = l.match(/^\s*(#{1,3})\s+(.+)$/);
    if (h) { flush(); html.push(`<h${h[1].length + 2}>${inline(h[2], link)}</h${h[1].length + 2}>`); continue; }
    const li = l.match(/^\s*[-*]\s+(.+)$/);
    if (li) { if (para.length) { const keep = list; list = []; flush(); list = keep; } list.push(li[1]); continue; }
    if (list.length) flush();
    para.push(l);
  }
  flush();
  return html.join('');
}
/** The titles an entry links to */
export const linksIn = text => [...String(text || '').matchAll(/\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g)].map(m => m[1].trim().toLowerCase());
/** Rename links when an entry's title changes */
export function renameLinks(text, from, to) {
  const f = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(text || '').replace(new RegExp(`\\[\\[\\s*${f}\\s*(\\|[^\\]]*)?\\]\\]`, 'gi'), (_, label) => `[[${to}${label || ''}]]`);
}

/* ---------- what players get ---------- */
/** A revealed entry, as players see it: no secret blocks, no secret facts, no DM notes */
export function playerCopy(e) {
  return {
    id: e.id, type: e.type || '', title: e.title || '', summary: e.summary || '',
    body: stripSecrets(e.body), img: e.img?.id ? { id: e.img.id } : null,
    facts: (e.facts || []).filter(f => !f.hidden && String(f.v || '').trim()).map(f => ({ k: f.k, v: stripSecrets(f.v) })),
    updated: e.updated || 0,
  };
}
/** The sections and types players need (names and icons only) */
export const playerSections = w => (w.sections || []).map(s => ({ id: s.id, name: s.name, icon: s.icon || '', types: (s.types || []).map(t => ({ id: t.id, name: t.name })) }));

/** A picture stored in Google Drive, viewable by link */
export const imgUrl = (img, w = 1600) => (img?.id ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(img.id)}&sz=w${w}` : '');
export const imgUrl2 = img => (img?.id ? `https://lh3.googleusercontent.com/d/${encodeURIComponent(img.id)}` : '');

/** Search: title first, then summary, facts and text */
export function search(entries, q) {
  q = String(q || '').trim().toLowerCase(); if (!q) return [];
  const score = e => (e.title.toLowerCase().includes(q) ? 3 : 0) + (String(e.summary || '').toLowerCase().includes(q) ? 2 : 0)
    + ((e.facts || []).some(f => String(f.v || '').toLowerCase().includes(q)) ? 1 : 0) + (String(e.body || '').toLowerCase().includes(q) ? 1 : 0);
  return entries.map(e => ({ e, s: score(e) })).filter(x => x.s).sort((a, b) => b.s - a.s || a.e.title.localeCompare(b.e.title)).map(x => x.e);
}
