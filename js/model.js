// The DM's Perspective — Lore: the shape of a world. Pure functions, no screen and no storage.
//
// A world starts with no lore at all: just a starting set of sections and entry types, each with a few fact fields.
// Every DM renames, adds or removes them to fit their own world. Nothing about any particular world lives here.

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);

const T = (name, fields) => ({ id: uid(), name, fields, icon: TYPE_ICONS[name] || '' });
// Each starting type's own symbol (the DM can change any of them)
export const TYPE_ICONS = {
  'Region or Country': '🏰', Settlement: '🏘️', 'Landmark or Building': '🏛️', Geography: '⛰️', Plane: '🌀',
  Character: '🧑', 'People or Species': '🧝', Culture: '🎭', Language: '🗣️',
  Deity: '☀️', Religion: '🕯️', 'Faction or Organization': '🛡️', Military: '⚔️', 'Title or Rank': '👑',
  'Item or Artifact': '💎', Material: '🪨', 'Document or Text': '📖', 'Technology or Magic': '🔮',
  'Event or Conflict': '🔥', 'Myth or Legend': '🐉', Tradition: '🎉', Note: '📝',
};
/** The symbol for an entry: its type's, else its section's */
export const iconOf = (w, e) => { const t = typeOf(w, e.type); return t?.icon || t?.section?.icon || '✨'; };
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
export const newWorld = () => ({ app: 'dmp-lore', v: 1, name: 'My World', sections: defaultSections(), entries: [], events: [], eras: [], calendar: { months: [] }, maps: [], stamp: 0, settings: {} });

/** Every type with the section it sits in */
export const allTypes = w => (w.sections || []).flatMap(s => (s.types || []).map(t => ({ ...t, section: s })));
export const typeOf = (w, id) => allTypes(w).find(t => t.id === id) || null;
export const sectionOf = (w, e) => typeOf(w, e.type)?.section || (w.sections || []).at(-1) || null;

/* ---------- writing: a few simple marks, links to other entries, and secret blocks ---------- */
// **bold**, *italic*, # Heading, - list items (indent a line to nest it; 1. for numbered), [[Entry title]] or [[Entry title|shown text]], and
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
// How far a line is indented: each tab, or each 4 spaces (2 or more counts), is one step
const levelOf = l => { let c = 0; for (const ch of /^[\t ]*/.exec(l)[0]) c += ch === '\t' ? 4 : 1; return c ? Math.max(1, Math.round(c / 4)) : 0; };
const BULLET = /^([-*•]|\d+[.)])\s+/;
function blocks(text, link) {
  // line by line: headings stand alone; "- ", "* " and "1. " lines make lists, indented under each other to nest;
  // other lines group into paragraphs, and an indented one keeps its indent
  const html = []; let para = null; const stack = [];
  const flushPara = () => { if (para) html.push(`<p${para.lv ? ` style="padding-left:${para.lv * 1.5}em"` : ''}>${para.lines.map(l => inline(l, link)).join('<br>')}</p>`); para = null; };
  const closeTo = lv => { while (stack.length && stack[stack.length - 1].level >= lv) html.push(`</li></${stack.pop().tag}>`); };
  for (const raw of String(text).split('\n')) {
    const l = raw.replace(/\s+$/, ''), body = l.replace(/^[\t ]+/, ''), lv = levelOf(l);
    if (!body) { flushPara(); closeTo(0); continue; }
    const h = body.match(/^(#{1,3})\s+(.+)$/);
    if (h) { flushPara(); closeTo(0); html.push(`<h${h[1].length + 2}>${inline(h[2], link)}</h${h[1].length + 2}>`); continue; }
    const b = BULLET.exec(body);
    if (b) {
      flushPara();
      const tag = /\d/.test(b[1]) ? 'ol' : 'ul';
      closeTo(lv + 1);
      const top = stack[stack.length - 1];
      if (top && top.level === lv && top.tag === tag) html.push('</li><li>');
      else {
        if (top && top.level === lv) html.push(`</li></${stack.pop().tag}>`);
        const n = parseInt(b[1], 10);
        html.push(`<${tag}${tag === 'ol' && n !== 1 ? ` start="${n}"` : ''}><li>`);
        stack.push({ tag, level: lv });
      }
      html.push(inline(body.slice(b[0].length), link));
      continue;
    }
    // a plain line indented under a list item carries on that item
    const top = stack[stack.length - 1];
    if (top && lv > top.level) { closeTo(lv); html.push(`<br>${inline(body, link)}`); continue; }
    closeTo(0);
    if (para && para.lv !== lv) flushPara();
    if (!para) para = { lv, lines: [] };
    para.lines.push(body);
  }
  flushPara(); closeTo(0);
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
    ...(hasDate(e.date) ? { date: e.date } : {}), ...(hasDate(e.dateEnd) ? { dateEnd: e.dateEnd } : {}),
    updated: e.updated || 0,
  };
}
/** The sections and types players need (names and icons only) */
export const playerSections = w => (w.sections || []).map(s => ({ id: s.id, name: s.name, icon: s.icon || '', types: (s.types || []).map(t => ({ id: t.id, name: t.name, icon: t.icon || '' })) }));

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

/* ---------- the Timeline: eras the DM names, and dates within them ---------- */
// A date: { era: eraId, year, month (0-based, optional), day (optional), approx }. Eras are listed oldest first; an era
// that "counts down" (like years before a great event) puts bigger years earlier.
export const hasDate = d => !!(d && d.era && Number.isFinite(Number(d.year)) && String(d.year) !== '');
export function dateKey(w, d) {
  if (!hasDate(d)) return -Infinity;
  const eras = w.eras || [], i = eras.findIndex(x => x.id === d.era), era = eras[i];
  const y = Number(d.year) * (era?.down ? -1 : 1);
  const m = d.month === '' || d.month == null ? -1 : Number(d.month), day = Number(d.day) || 0;
  return (i < 0 ? 999 : i) * 1e12 + (y + 5e8) * 1000 + (m + 1) * 40 + day;
}
export function dateText(w, d) {
  if (!hasDate(d)) return '';
  const era = (w.eras || []).find(x => x.id === d.era);
  const months = w.calendar?.months || [];
  const mi = d.month === '' || d.month == null ? -1 : Number(d.month);
  const mname = mi >= 0 ? (months[mi]?.name || `Month ${mi + 1}`) : '';
  const yr = era?.abbr ? `${d.year} ${era.abbr}` : `Year ${d.year}${era ? `, ${era.name}` : ''}`;
  const day = mname && Number(d.day) ? `${Number(d.day)} ` : '';
  return `${d.approx ? 'Around ' : ''}${mname ? `${day}${mname}, ` : ''}${yr}`;
}
/** Everything on the Timeline, in order: dated entries and standalone events. */
export function timeline(w) {
  const items = [
    ...(w.entries || []).filter(e => hasDate(e.date)).map(e => ({ kind: 'entry', id: e.id, title: e.title, date: e.date, end: e.dateEnd, text: e.summary || '', revealed: e.revealed, type: e.type, img: e.img })),
    ...(w.events || []).filter(x => hasDate(x.date)).map(x => ({ kind: 'event', id: x.id, title: x.title, date: x.date, end: x.dateEnd, text: x.text || '', revealed: x.revealed })),
  ];
  return items.sort((a, b) => dateKey(w, a.date) - dateKey(w, b.date) || a.title.localeCompare(b.title));
}
/** A standalone event as players see it */
export const playerEvent = x => ({ id: x.id, title: x.title || '', date: x.date || null, dateEnd: x.dateEnd || null, text: stripSecrets(x.text) });

/* ---------- maps: a picture with pins that open entries or other maps ---------- */
// A map: { id, title, img: { id }, revealed, pins: [{ id, x, y (0–1 across and down), label, entry, map, revealed }] }
/** A revealed map as players see it: only revealed pins, and links only to things they can see */
export function playerMap(m, visibleEntry, visibleMap) {
  return {
    id: m.id, title: m.title || '', img: m.img?.id ? { id: m.img.id } : null,
    pins: (m.pins || []).filter(p => p.revealed).map(p => ({ id: p.id, x: p.x, y: p.y, label: p.label || '', ...(p.entry && visibleEntry(p.entry) ? { entry: p.entry } : {}), ...(p.map && visibleMap(p.map) ? { map: p.map } : {}) })),
  };
}
