/* Journal familial — application (phase 4 : observations structurées)
 * Aucune bibliothèque externe. Les observations sont chiffrées (AES-GCM 256) avant d'être écrites
 * dans le stockage du navigateur, puis envoyées en HTTPS à Supabase pour les deux parents (js/sync.js).
 * L'organisation des récits se fait dans le téléphone, par des règles explicables (js/organize.js).
 */
(() => {
  'use strict';

  // ---------- Constantes ----------
  const APP_VERSION = '0.5.0';
  const CFG = window.JF_CONFIG;
  const JS = window.JFSync;
  const OR = window.JFOrganize;
  const ST = window.JFStats;
  const RP = window.JFReport;
  const STRUCT_FIELDS = ['context', 'description', 'childReaction', 'intervention', 'outcome', 'impressions'];
  const SYNC_EVERY_MS = 60 * 1000;
  const DB_NAME = 'journal-familial';
  const NEUTRAL_TITLE = 'Journal familial';
  const DB_VER = 1;
  const PIN_ITER = 200000;
  const EXPORT_ITER = 310000;
  const TRASH_DAYS = 30;
  const BACKUP_REMINDER_DAYS = 30;
  const MIN_YEAR = 2026;

  const COLORS = ['vert', 'jaune', 'orange', 'rouge'];
  const RANK = { vert: 0, jaune: 1, orange: 2, rouge: 3 };
  const COLOR_LABEL = { vert: 'Vert', jaune: 'Jaune', orange: 'Orange', rouge: 'Rouge' };
  const COLOR_DESC = { vert: 'Très belle', jaune: 'Mineure', orange: 'Modérée', rouge: 'Intense' };
  const TYPES = { difficulte: 'Difficulté', crise: 'Crise', reussite: 'Réussite', beau_moment: 'Beau moment', autre: 'Autre' };
  const HARD_TYPES = ['difficulte', 'crise'];
  const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const DOW = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const PLACES = ['Maison', 'École', 'Garderie', 'Voiture', 'Sortie', 'Parc', 'Chez la famille', 'Magasin'];
  const EDITABLE = ['date', 'time', 'intensity', 'type', 'note', 'markedComplete', 'duration', 'place', 'people', 'stateBefore', 'context', 'description', 'adultReaction', 'intervention', 'childReaction', 'outcome', 'impressions', 'calmTime', 'helped', 'extra'];
  // Les 6 sections de l'observation structurée (mêmes champs que la fiche détaillée)
  const SECTION_LABELS = { context: 'Contexte', description: 'Ce qui s\'est passé', childReaction: 'Réaction {de_enfant}', intervention: 'Intervention du parent', outcome: 'Résultat observé', impressions: 'Impressions du parent' };
  const SECTION_HINTS = { context: 'Où et quand', description: 'Les faits observés', childReaction: 'Ses paroles, gestes ou comportements', intervention: 'Ce que Papa ou Maman a fait', outcome: 'Comment la situation s\'est terminée', impressions: 'Ce que vous pensez ou supposez (pas un fait observé)' };
  const DETAIL_FIELDS = [
    ['context', SECTION_LABELS.context, 'area'],
    ['description', SECTION_LABELS.description, 'area'],
    ['childReaction', SECTION_LABELS.childReaction, 'area'],
    ['intervention', SECTION_LABELS.intervention, 'area'],
    ['outcome', SECTION_LABELS.outcome, 'area'],
    ['impressions', SECTION_LABELS.impressions, 'area'],
    ['duration', 'Durée approximative (minutes)', 'number'],
    ['place', 'Endroit', 'place'],
    ['people', 'Personnes présentes', 'text'],
    ['stateBefore', 'État apparent {de_enfant} avant', 'text'],
    ['adultReaction', 'Réaction des adultes', 'area'],
    ['calmTime', 'Temps pour retrouver le calme (minutes)', 'number'],
    ['helped', 'Ce qui semble avoir aidé', 'area'],
    ['extra', 'Notes supplémentaires', 'area'],
  ];

  // ---------- Icônes (SVG en trait) ----------
  const P = {
    cal: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    doc: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    left: '<path d="M15 6l-6 6 6 6"/>', right: '<path d="M9 6l6 6-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    star: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    back: '<path d="M21 5H9l-6 7 6 7h12z"/><path d="M17 9l-5 6M12 9l5 6"/>',
  };
  const ico = (name, size = 22) => `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[name]}</svg>`;

  // ---------- Utilitaires ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => ymd(new Date());
  const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const fmtLong = (s) => { const d = parseYmd(s); return `${cap(DOW[d.getDay()])} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
  const fmtShort = (s) => { const d = parseYmd(s); return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 4).replace(/\.$/, '')}.`; };
  const fmtTime = (t) => (t ? t.replace(':', ' h ') : '');
  const fmtStamp = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]} à ${pad(d.getHours())} h ${pad(d.getMinutes())}`; };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));
  const nowIso = () => new Date().toISOString();
  const b64 = (buf) => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // ---------- Stockage (IndexedDB) ----------
  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const r = indexedDB.open(DB_NAME, DB_VER);
        r.onupgradeneeded = () => {
          const d = r.result;
          if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
          if (!d.objectStoreNames.contains('records')) d.createObjectStore('records', { keyPath: 'id' });
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    }
    return dbPromise;
  }
  function txDone(t) { return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); }
  async function metaGet(k) { const d = await db(); return new Promise((res, rej) => { const r = d.transaction('meta').objectStore('meta').get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function metaSet(k, v) { const d = await db(); const t = d.transaction('meta', 'readwrite'); t.objectStore('meta').put(v, k); return txDone(t); }
  async function recAll() { const d = await db(); return new Promise((res, rej) => { const r = d.transaction('records').objectStore('records').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function recPut(list) { const d = await db(); const t = d.transaction('records', 'readwrite'); const s = t.objectStore('records'); list.forEach((x) => s.put(x)); return txDone(t); }
  async function recGet(id) { const d = await db(); return new Promise((res, rej) => { const r = d.transaction('records').objectStore('records').get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function recDelete(ids) { const d = await db(); const t = d.transaction('records', 'readwrite'); const s = t.objectStore('records'); ids.forEach((id) => s.delete(id)); return txDone(t); }
  async function wipeAll() {
    try { const d = await db(); d.close(); } catch (e) { /* rien */ }
    dbPromise = null;
    await new Promise((res) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => res(); });
    try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /* rien */ }
  }

  // ---------- Chiffrement ----------
  let DEK = null; // clé de données, en mémoire seulement quand l'app est déverrouillée
  async function loadDek() {
    let k = await metaGet('dek');
    if (!k) {
      // Clé non exportable : le JavaScript peut l'utiliser mais jamais lire ses octets.
      k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await metaSet('dek', k);
    }
    return k;
  }
  async function seal(obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, DEK, enc.encode(JSON.stringify(obj)));
    return { id: obj.id, iv, ct };
  }
  async function unseal(rec) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, DEK, rec.ct);
    return JSON.parse(dec.decode(pt));
  }
  async function pbkdf2(secret, salt, iter) {
    const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits', 'deriveKey']);
    return { base, bits: async () => new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, 256)) };
  }
  async function pinHash(pin, salt, iter) { return (await pbkdf2(pin, salt, iter)).bits(); }
  function sameBytes(a, b) { if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a[i] ^ b[i]; return x === 0; }
  async function passwordKey(password, salt, iter) {
    const { base } = await pbkdf2(password, salt, iter);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  // ---------- État ----------
  const S = {
    unlocked: false,
    events: new Map(),
    days: new Map(), // date -> jour
    drafts: new Map(), // brouillons d'observation (chiffrés, jamais envoyés)
    settings: null,
    view: 'calendar',
    month: null, // {y, m}
    selected: today(),
    jFilter: 'tous',
    jQuery: '',
    // Phase 5 : filtres du Journal, statistiques, rapports (en mémoire seulement, jamais enregistrés)
    jf: null, jfOpen: false,
    evo: { range: '4w', unit: 'week' },
    rep: null,
    syncState: null, // curseurs, noms des parents, dernière synchro (chiffré)
    sync: { status: 'idle', msg: '' }, // idle | running | ok | offline | error | auth | denied | none
    loggedIn: false,
  };
  const defaultSettings = () => ({ id: 'settings', kind: 'settings', parent: '', lastExport: null, createdAt: nowIso() });

  async function loadAll() {
    S.events.clear(); S.days.clear(); S.drafts.clear();
    S.settings = null; S.syncState = null;
    const recs = await recAll();
    for (const r of recs) {
      if (r.id === 'session') continue; // lu seulement par le client de synchro
      let o;
      try { o = await unseal(r); } catch (e) { console.warn('Enregistrement illisible ignoré'); continue; }
      if (o.kind === 'event') S.events.set(o.id, o);
      else if (o.kind === 'day') { const ex = S.days.get(o.date); if (!ex || ex.updatedAt < o.updatedAt) S.days.set(o.date, o); }
      else if (o.kind === 'settings') S.settings = o;
      else if (o.kind === 'sync') S.syncState = o;
      else if (o.kind === 'draft') S.drafts.set(o.id, o);
    }
    if (!S.settings) { S.settings = defaultSettings(); await saveSettings(); }
    if (!S.syncState) S.syncState = { id: 'sync', kind: 'sync', names: {} };
    await purgeTrash();
  }
  async function saveRecord(o) { await recPut([await seal(o)]); }
  async function saveSettings() { await saveRecord(S.settings); }
  async function saveEvent(ev, { touch = true } = {}) {
    if (touch) { ev.updatedAt = nowIso(); ev.updatedBy = S.settings.parent || ''; ev.version = (ev.version || 0) + 1; ev.dirty = true; ev.rev = (ev.rev || 0) + 1; ev.syncError = null; }
    S.events.set(ev.id, ev);
    await saveRecord(ev);
    scheduleSync();
  }
  async function saveDay(day) {
    day.updatedAt = nowIso(); day.updatedBy = S.settings.parent || ''; day.version = (day.version || 0) + 1; day.dirty = true; day.localOnly = false; day.rev = (day.rev || 0) + 1; day.syncError = null;
    S.days.set(day.date, day);
    await saveRecord(day);
    scheduleSync();
  }
  function getDay(date) { return S.days.get(date) || { id: uid(), kind: 'day', date, rating: null, belle: false, createdAt: nowIso() }; }
  // Effacement local après 30 jours, seulement pour ce qui n'a jamais été partagé.
  // Les fiches partagées sont effacées par la synchro, avec l'accord du serveur.
  async function purgeTrash() {
    const limit = Date.now() - TRASH_DAYS * 864e5;
    const old = [...S.events.values()].filter((e) => e.deletedAt && Date.parse(e.deletedAt) < limit && (e.localOnly || e.syncVersion == null));
    if (old.length) { old.forEach((e) => S.events.delete(e.id)); await recDelete(old.map((e) => e.id)); }
  }

  // ---------- Synchronisation ----------
  let client = null;
  let engine = null;
  let syncTimer = null;
  let syncInterval = null;
  let renderNeeded = false;
  const pendingCount = () => [...S.events.values(), ...S.days.values()].filter(JS.isPending).length
    + [...S.events.values()].reduce((n, e) => n + (e.comments || []).filter((c) => c.pending).length, 0);
  const conflicts = () => [...[...S.events.values()].filter((e) => e.conflict).map((e) => ({ kind: 'event', id: e.id, o: e })), ...[...S.days.values()].filter((d) => d.conflict).map((d) => ({ kind: 'day', id: d.date, o: d }))];
  const syncErrors = () => [...S.events.values(), ...S.days.values()].filter((r) => r.syncError && !r.localOnly);
  const neverShared = () => [...S.events.values(), ...S.days.values()].filter((r) => !r.localOnly && r.syncVersion == null);

  function setupSync() {
    const syncStore = {
      names: (S.syncState && S.syncState.names) || {},
      events: () => S.events.values(), getEvent: (id) => S.events.get(id),
      putEvent: async (e) => { if (!DEK) throw new Error('verrouillé'); S.events.set(e.id, e); await saveRecord(e); renderNeeded = true; },
      removeEvent: async (id) => { S.events.delete(id); await recDelete([id]); renderNeeded = true; },
      days: () => S.days.values(), getDay: (d) => S.days.get(d),
      putDay: async (d) => { if (!DEK) throw new Error('verrouillé'); S.days.set(d.date, d); await saveRecord(d); renderNeeded = true; },
      getState: () => S.syncState,
      setState: async (st) => { S.syncState = { ...st, id: 'sync', kind: 'sync', names: syncStore.names }; await saveRecord(S.syncState); },
      myName: () => S.settings.parent || '', uid, now: () => Date.now(),
    };
    client = JS.createClient({
      url: CFG.url, key: CFG.key,
      loadSession: async () => { const r = await recGet('session'); if (!r || !DEK) return null; try { return (await unseal(r)).s; } catch (e) { return null; } },
      saveSession: async (s) => { if (!s) { await recDelete(['session']); S.loggedIn = false; return; } if (DEK) await recPut([await seal({ id: 'session', kind: 'session', s })]); S.loggedIn = true; },
    });
    engine = JS.createEngine({ client, store: syncStore });
  }
  function scheduleSync(delay = 1500) {
    if (!S.loggedIn || !engine) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(runSync, delay);
  }
  async function runSync({ manual = false } = {}) {
    if (!S.unlocked || !engine || !S.loggedIn) return;
    S.sync = { status: 'running', msg: '' }; paintSync();
    try {
      await engine.sync({ trashDays: TRASH_DAYS });
      const me = S.session && S.session.user && S.syncState.names[S.session.user.id];
      if (me && S.settings.parent !== me) { S.settings.parent = me; await saveSettings(); renderNeeded = true; }
      S.sync = { status: 'ok', msg: '' };
      if (manual) toast(pendingCount() ? 'Synchronisé, sauf les éléments signalés' : 'Tout est synchronisé');
    } catch (e) {
      if (!S.unlocked) return;
      const kind = e && e.kind;
      if (kind === 'offline') S.sync = { status: 'offline', msg: 'Hors ligne' };
      else if (kind === 'auth') { S.sync = { status: 'auth', msg: e.message }; S.loggedIn = false; renderNeeded = true; }
      else if (kind === 'denied') S.sync = { status: 'denied', msg: e.message };
      else S.sync = { status: 'error', msg: (e && e.message) || 'Erreur de synchronisation' };
      if (manual) toast(S.sync.msg);
    }
    paintSync();
    const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest('#view') && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    if (renderNeeded && !typing) { renderNeeded = false; render(); }
  }
  function startSyncLoop() {
    clearInterval(syncInterval);
    syncInterval = setInterval(() => { if (!document.hidden) runSync(); }, SYNC_EVERY_MS);
  }
  function stopSync() { clearTimeout(syncTimer); clearInterval(syncInterval); syncTimer = null; syncInterval = null; if (client) client.forget(); client = null; engine = null; }
  window.addEventListener('online', () => scheduleSync(300));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleSync(500); });

  function syncLabel() {
    const n = pendingCount();
    const c = conflicts().length;
    if (!S.loggedIn) return { cls: 'warn', txt: S.sync.status === 'auth' ? 'Reconnexion requise' : 'Non connecté' };
    if (c) return { cls: 'warn', txt: `${c} conflit${c > 1 ? 's' : ''}` };
    if (S.sync.status === 'running') return { cls: '', txt: 'Synchro…' };
    if (S.sync.status === 'offline') return { cls: 'warn', txt: n ? `Hors ligne · ${n} en attente` : 'Hors ligne' };
    if (S.sync.status === 'error' || S.sync.status === 'denied' || syncErrors().length) return { cls: 'err', txt: 'Problème de synchro' };
    if (n) return { cls: '', txt: `${n} en attente` };
    return { cls: 'ok', txt: 'Synchronisé' };
  }
  function paintSync() {
    const b = $('#syncChip');
    if (!b || !S.unlocked) return;
    const l = syncLabel();
    b.className = 'sync-chip ' + l.cls;
    b.textContent = l.txt;
  }

  // ---------- Prénom (paramètre privé, chiffré ; jamais dans le code public) ----------
  const childName = () => ((S.settings && S.settings.childName) || '').trim();
  const deChild = () => { const n = childName(); return n ? (/^[aeiouyhâàéèêîôûAEIOUYHÂÀÉÈÊÎÔÛ]/.test(n) ? `d'${n}` : `de ${n}`) : "de l'enfant"; };
  const appTitle = () => (childName() ? `Journal ${deChild()}` : NEUTRAL_TITLE);
  const fieldLabel = (l) => l.replace('{de_enfant}', deChild());
  function applyTitles(unlocked) { const t = unlocked ? appTitle() : NEUTRAL_TITLE; document.title = t; const s = $('#topSub'); if (s) s.textContent = t; }

  // ---------- Règles métier ----------
  const liveEvents = () => [...S.events.values()].filter((e) => !e.deletedAt);
  const sortEv = (a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''));
  const eventsOn = (date) => liveEvents().filter((e) => e.date === date).sort(sortEv);
  function isIncomplete(e) {
    if (e.markedComplete) return false;
    if (!e.type) return true;
    if (HARD_TYPES.includes(e.type)) return !e.intensity || !(e.description || e.note);
    return false;
  }
  function suggestColor(date) {
    let best = null;
    for (const e of eventsOn(date)) if (e.intensity && (best === null || RANK[e.intensity] > RANK[best])) best = e.intensity;
    return best;
  }
  function evTitle(e) {
    const t = e.type ? TYPES[e.type] : 'Événement';
    return e.intensity && e.type !== 'reussite' && e.type !== 'beau_moment' ? `${t} · ${COLOR_DESC[e.intensity].toLowerCase()}` : t;
  }
  function evText(e) { return e.note || e.description || e.context || ''; }
  const isPositive = (e) => e.type === 'reussite' || e.type === 'beau_moment';
  // Observation structurée (phase 4) et approbation
  const isStructured = (e) => JS.usesStructure(e);
  // « Approuvée » seulement quand le SERVEUR a confirmé l'approbation (jamais sur la seule demande)
  const isApproved = (e) => !e.approveRequest && !!e.approval && !e.approvalVoid;
  const isApprovalPending = (e) => !!e.approveRequest;
  const parentName = (id) => ((S.syncState && S.syncState.names) || {})[id] || '';
  function approvalLine(e) {
    if (e.approveRequest) {
      if (e.conflict) return 'Approbation non enregistrée : la fiche a aussi été modifiée sur l\'autre téléphone. Choisissez la version, relisez, puis approuvez.';
      if (e.syncError) return `Approbation non enregistrée : ${esc(e.syncError)}`;
      return 'Approbation demandée · en attente de confirmation du serveur';
    }
    if (isApproved(e)) return `Approuvée${parentName(e.approval.byId) || e.approval.by ? ' par ' + esc(parentName(e.approval.byId) || e.approval.by) : ''} le ${fmtStamp(e.approval.at)}`;
    return 'Non approuvée';
  }
  // Contenu approuvé : tout sauf la corbeille et la case « Fiche complète » (même règle que le serveur, script 04)
  function contentKey(e) { const r = JS.eventToRow({ ...e, hasStructure: true }); delete r.id; delete r.marked_complete; delete r.deleted_at; delete r.approved_at; return JSON.stringify(r); }
  const catTags = (e) => (e.categories || []).map((c) => `<span class="chip-tag soft">${esc(OR.CATEGORY_LABEL[c] || c)}</span>`).join('');

  // ---------- Interface commune ----------
  const view = () => $('#view');
  function toast(msg, action) {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button" id="toastAct">${esc(action.label)}</button>` : ''}`;
    t.hidden = false;
    clearTimeout(toast._t);
    if (action) $('#toastAct').onclick = () => { t.hidden = true; action.run(); };
    toast._t = setTimeout(() => { t.hidden = true; }, action ? 6000 : 2800);
  }
  function ask({ title, text = '', ok = 'Confirmer', cancel = 'Annuler', danger = false, input = null }) {
    return new Promise((resolve) => {
      const root = $('#modal-root');
      root.innerHTML = `<div class="modal-wrap" role="dialog" aria-modal="true" aria-labelledby="mTitle"><div class="modal">
        <h2 id="mTitle">${esc(title)}</h2>${text ? `<p>${text}</p>` : ''}
        ${input ? `<label class="field"><span class="lbl">${esc(input.label)}</span><input class="input" id="mInput" type="${input.type || 'text'}" autocomplete="off" ${input.mode ? `inputmode="${input.mode}"` : ''}></label>` : ''}
        ${input && input.confirm ? `<label class="field"><span class="lbl">${esc(input.confirm)}</span><input class="input" id="mInput2" type="${input.type || 'text'}" autocomplete="off"></label>` : ''}
        <p class="small" id="mErr" hidden></p>
        <div class="actions">${cancel ? `<button type="button" class="btn quiet small" id="mNo">${esc(cancel)}</button>` : ''}<button type="button" class="btn small ${danger ? 'danger' : ''}" id="mYes">${esc(ok)}</button></div>
      </div></div>`;
      const close = (v) => { root.innerHTML = ''; resolve(v); };
      const inp = $('#mInput');
      if (inp) setTimeout(() => inp.focus(), 50);
      if ($('#mNo')) $('#mNo').onclick = () => close(null);
      $('#mYes').onclick = () => {
        if (!input) return close(true);
        const v = inp.value;
        if (input.validate) { const err = input.validate(v, $('#mInput2') ? $('#mInput2').value : undefined); if (err) { const e = $('#mErr'); e.textContent = err; e.hidden = false; return; } }
        close(v);
      };
    });
  }
  // Fermer un écran ne perd jamais un brouillon : il est écrit (chiffré) et peut être repris
  function closeSheets() {
    const d = liveDraft;
    const kept = d && $('#sheet-root').innerHTML && draftHasContent(d);
    if (d) flushDraft(); // écrit immédiatement, pendant que la clé est disponible
    liveDraft = null;
    $('#sheet-root').innerHTML = '';
    clearReport(); // un rapport prévisualisé n'est gardé nulle part
    if (S.unlocked) applyTitles(true);
    if (kept) { S.drafts.set(d.id, d); if (S.unlocked) render(); toast('Brouillon gardé', { label: 'Reprendre', run: () => resumeDraft(d.id) }); }
  }
  function resumeDraft(id) { const d = S.drafts.get(id); if (!d) { toast('Ce brouillon n\'existe plus.'); return; } if (d.step === 'review') openReview(id); else openQuick(null, d); }

  function renderNav() {
    const tabs = [['calendar', 'Calendrier', 'cal'], ['journal', 'Journal', 'book'], null, ['evolution', 'Évolution', 'chart'], ['reports', 'Rapports', 'doc']];
    $('#bottomNav').innerHTML = tabs.map((t) => t
      ? `<button type="button" class="tab" data-act="nav" data-view="${t[0]}" ${S.view === t[0] ? 'aria-current="page"' : ''}>${ico(t[2])}<span>${t[1]}</span></button>`
      : `<button type="button" class="fab" data-act="quick" aria-label="Ajouter un événement">${ico('plus', 28)}</button>`).join('');
    $('#gearBtn').innerHTML = ico('gear', 20);
  }
  const TITLES = { calendar: 'Calendrier', journal: 'Journal', evolution: 'Évolution', reports: 'Rapports', settings: 'Paramètres' };
  function render() {
    if (!S.unlocked) return;
    $('#topTitle').textContent = TITLES[S.view];
    applyTitles(true);
    renderNav();
    paintSync();
    if (S.view === 'calendar') renderCalendar();
    else if (S.view === 'journal') renderJournal();
    else if (S.view === 'settings') renderSettings();
    else if (S.view === 'evolution') renderEvolution();
    else if (S.view === 'reports') renderReports();
  }
  // Filtres et options des rapports : remis à zéro à chaque déverrouillage (jamais enregistrés)
  function resetPhase5() {
    S.jf = ST.emptyFilter(); S.jfOpen = false; S.jQuery = '';
    S.evo = { range: '4w', unit: 'week' };
    S.rep = { kind: 'summary', preset: '4w', from: '', to: '', filter: ST.emptyFilter(), filtersOpen: false, includeUnapproved: false, impressions: false, original: false, hide: true };
  }

  // ---------- Calendrier ----------
  function backupBanner() {
    const n = liveEvents().length + S.days.size;
    if (!n) return '';
    const last = S.settings.lastExport ? Date.parse(S.settings.lastExport) : null;
    if (last && Date.now() - last < BACKUP_REMINDER_DAYS * 864e5) return '';
    const txt = last ? `Dernière sauvegarde il y a ${Math.floor((Date.now() - last) / 864e5)} jours.` : 'Aucune sauvegarde n\'a encore été faite.';
    return `<div class="banner warn"><span class="spacer">${txt}</span><button type="button" class="btn small quiet" data-act="nav" data-view="settings">Sauvegarder</button></div>`;
  }
  function syncBanner() {
    const c = conflicts().length;
    let out = '';
    if (c) out += `<div class="banner warn"><span class="spacer">${c === 1 ? 'Une fiche a été modifiée' : `${c} fiches ont été modifiées`} sur les deux téléphones en même temps. Choisissez la version à garder.</span><button type="button" class="btn small quiet" data-act="conflicts">Voir</button></div>`;
    if (!S.loggedIn && !S.settings.loginLater) out += `<div class="banner"><span class="spacer">${S.sync.status === 'auth' ? 'Reconnectez-vous pour reprendre la synchronisation. Vos observations restent dans ce téléphone.' : 'Connectez-vous pour partager le journal entre vos deux téléphones.'}</span><button type="button" class="btn small quiet" data-act="login">Se connecter</button></div>`;
    else if (S.loggedIn && engine && engine.needsUpdate()) out += `<div class="banner warn"><span class="spacer">Une version plus récente du journal est nécessaire pour envoyer vos modifications. Elles sont gardées dans ce téléphone.</span><button type="button" class="btn small quiet" data-act="reload">Recharger</button></div>`;
    else if (S.loggedIn && syncErrors().length) out +=`<div class="banner warn"><span class="spacer">Certaines observations n'ont pas pu être envoyées. Elles sont gardées dans ce téléphone.</span><button type="button" class="btn small quiet" data-act="nav" data-view="settings">Détails</button></div>`;
    return out;
  }
  function draftBanner() {
    const list = [...S.drafts.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return list.map((d) => `<div class="banner"><span class="spacer"><strong>Brouillon non terminé</strong> · ${fmtShort(d.date)}${d.text ? ` · « ${esc(d.text.slice(0, 50))}${d.text.length > 50 ? '…' : ''} »` : ''}<br><span class="small">Gardé chiffré dans ce téléphone, pas encore enregistré dans le journal.</span></span><button type="button" class="btn small quiet" data-act="resumeDraft" data-id="${esc(d.id)}">Reprendre</button></div>`).join('');
  }
  function renderCalendar() {
    if (!S.month) { const d = parseYmd(S.selected); S.month = { y: d.getFullYear(), m: d.getMonth() }; }
    const { y, m } = S.month;
    const first = new Date(y, m, 1);
    const daysIn = new Date(y, m + 1, 0).getDate();
    const t = today();
    let cells = ['D', 'L', 'M', 'M', 'J', 'V', 'S'].map((x, i) => `<span class="dow" aria-hidden="true" title="${DOW[i]}">${x}</span>`).join('');
    for (let i = 0; i < first.getDay(); i++) cells += '<span class="day empty" aria-hidden="true"></span>';
    for (let d = 1; d <= daysIn; d++) {
      const date = `${y}-${pad(m + 1)}-${pad(d)}`;
      const day = S.days.get(date);
      const evs = eventsOn(date);
      const cls = ['day'];
      let state = '';
      if (day && day.rating) { cls.push('c-' + day.rating); state = `journée ${COLOR_LABEL[day.rating].toLowerCase()}`; }
      else if (evs.length) { cls.push('obs'); state = 'observations, journée non évaluée'; }
      else if (date < t) { cls.push('none'); state = 'aucune observation'; }
      if (date === t) cls.push('today');
      if (date === S.selected) cls.push('sel');
      const pos = evs.some(isPositive) || (day && day.belle);
      const todo = evs.some(isIncomplete);
      const marks = `<span class="marks">${pos ? '<span class="mark"></span>' : ''}${todo ? '<span class="mark todo"></span>' : ''}</span>`;
      cells += `<button type="button" class="${cls.join(' ')}" data-act="pick" data-date="${date}" aria-label="${d} ${MONTHS[m]}${state ? ', ' + state : ''}${date === t ? ", aujourd'hui" : ''}" ${date === S.selected ? 'aria-pressed="true"' : ''}>${d}${marks}</button>`;
    }
    const canPrev = !(y === MIN_YEAR && m === 0);
    const legend = COLORS.map((c) => `<span><i class="sw c-${c}"></i>${COLOR_LABEL[c]}</span>`).join('') + '<span><i class="sw none"></i>Aucune observation</span><span><i class="mark"></i>Réussite</span><span><i class="mark todo"></i>À compléter</span>';
    view().innerHTML = `${draftBanner()}${syncBanner()}${backupBanner()}
      <section class="card" aria-label="Calendrier du mois">
        <div class="cal-head">
          <button type="button" class="icon-btn plain" data-act="month" data-d="-1" aria-label="Mois précédent" ${canPrev ? '' : 'disabled'}>${ico('left', 20)}</button>
          <span class="month" aria-live="polite">${MONTHS[m]} ${y}</span>
          <button type="button" class="icon-btn plain" data-act="month" data-d="1" aria-label="Mois suivant">${ico('right', 20)}</button>
        </div>
        <div class="cal-grid">${cells}</div>
        <div class="legend">${legend}</div>
      </section>
      <div class="chips"><button type="button" class="btn small quiet" data-act="today">Aujourd'hui</button></div>
      ${dayCard(S.selected)}`;
  }
  function dayCard(date) {
    const day = S.days.get(date);
    const evs = eventsOn(date);
    const sug = suggestColor(date);
    const rating = day ? day.rating : null;
    const rateBtns = COLORS.map((c) => `<button type="button" class="rate c-${c}" role="radio" aria-checked="${rating === c}" data-act="rate" data-c="${c}">${COLOR_LABEL[c]}</button>`).join('')
      + `<button type="button" class="rate none" role="radio" aria-checked="${!rating}" data-act="rate" data-c="">Non évaluée</button>`;
    let sugLine = '';
    if (sug && sug !== rating) sugLine = `<p class="hint">Suggestion : ${COLOR_LABEL[sug].toLowerCase()} (l'événement le plus intense de la journée). <button type="button" class="linkish" data-act="rate" data-c="${sug}">Appliquer</button></p>`;
    else if (sug && sug === rating) sugLine = '<p class="hint">Correspond à l\'événement le plus intense de la journée.</p>';
    const isFuture = date > today();
    const belle = day && day.belle;
    return `<section class="card" aria-label="Journée sélectionnée">
      <div class="row"><strong class="spacer">${fmtLong(date)}</strong></div>
      ${isFuture ? '<p class="hint">Journée à venir.</p>' : `
      <div class="row wrap"><button type="button" class="btn-belle" data-act="belle" aria-pressed="${!!belle}">${ico('star', 18)}${belle ? 'Belle journée ✓' : 'Belle journée'}</button><span class="hint">Un toucher : journée verte, sans fiche.</span></div>
      <span class="lbl">Couleur de la journée</span>
      <div class="rating" role="radiogroup" aria-label="Couleur de la journée">${rateBtns}</div>${sugLine}`}
      <span class="lbl">Événements</span>
      <div class="list">${evs.length ? evs.map((e) => evRow(e)).join('') : '<p class="empty-note">Aucun événement noté pour cette journée.</p>'}</div>
      <button type="button" class="btn ghost block" data-act="quick" data-date="${date}">${ico('plus', 18)}Ajouter un événement ce jour-là</button>
    </section>`;
  }
  function evRow(e, onWhite = false, showDate = false) {
    const who = e.author ? ` · ${esc(e.author)}` : '';
    return `<button type="button" class="ev${onWhite ? ' on-white' : ''}" data-act="open" data-id="${e.id}">
      <span class="bar ${e.intensity ? 'c-' + e.intensity : ''}"></span>
      <span class="body"><span class="meta"><span class="kind">${esc(evTitle(e))}</span><span>${showDate ? fmtShort(e.date) + ' · ' : ''}${fmtTime(e.time)}${who}</span></span>
      ${evText(e) ? `<span class="txt">${esc(evText(e))}</span>` : ''}
      ${(e.categories || []).length ? `<span class="row wrap tags">${catTags(e)}</span>` : ''}
      ${isIncomplete(e) ? '<span class="todo-tag">À compléter</span>' : ''}${isApprovalPending(e) ? '<span class="todo-tag">Approbation en attente</span>' : isStructured(e) && !isApproved(e) ? '<span class="todo-tag">Non approuvée</span>' : ''}</span></button>`;
  }

  // ---------- Ajout rapide ----------
  // ---------- Brouillons (chiffrés, jamais envoyés, jamais perdus en silence) ----------
  let draftTimer = null;
  let liveDraft = null; // brouillon en cours d'édition (lu par flushDraft avant verrouillage ou fermeture)
  const draftHasContent = (d) => !!(d && ((d.text || '').trim() || d.intensity || d.type || d.step === 'review'));
  async function writeDraft(d) {
    if (!DEK || !d) return;
    if (!draftHasContent(d) && !d.eventId) { if (S.drafts.has(d.id)) { S.drafts.delete(d.id); await recDelete([d.id]); } return; }
    d.updatedAt = nowIso();
    S.drafts.set(d.id, d);
    await saveRecord(d);
  }
  function queueDraft(d) { liveDraft = d; clearTimeout(draftTimer); draftTimer = setTimeout(() => { writeDraft(d).catch(() => toast('Le brouillon n\'a pas pu être enregistré. Gardez l\'écran ouvert et réessayez.')); }, 300); }
  async function flushDraft() { clearTimeout(draftTimer); if (liveDraft) { try { await writeDraft(liveDraft); } catch (e) { /* rien */ } } }
  async function dropDraft(id) { clearTimeout(draftTimer); if (liveDraft && liveDraft.id === id) liveDraft = null; S.drafts.delete(id); await recDelete([id]); }
  const newDraft = (f) => ({ id: 'draft-' + uid(), kind: 'draft', v: 1, step: 'text', createdAt: nowIso(), updatedAt: nowIso(), date: today(), time: nowTime(), intensity: null, type: null, text: '', ...f });
  // Fermeture de l'onglet, mise en arrière-plan ou mise à jour de l'app : on écrit tout de suite
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushDraft(); });
  window.addEventListener('pagehide', () => { flushDraft(); });

  function openQuick(date, resume = null) {
    const d = date || (S.view === 'calendar' ? S.selected : today());
    const q = resume || newDraft({ date: d > today() ? today() : d });
    liveDraft = q;
    const root = $('#sheet-root');
    root.innerHTML = `<div class="overlay" data-act="closeSheet"><section class="sheet" role="dialog" aria-modal="true" aria-labelledby="qTitle">
      <span class="grab"></span>
      <div class="sheet-head"><h2 id="qTitle">${resume ? 'Brouillon repris' : 'Nouvel événement'}</h2><button type="button" class="icon-btn plain" data-act="closeSheet" aria-label="Fermer">${ico('x', 20)}</button></div>
      <div class="two"><label class="field"><span class="lbl">Date</span><input class="input" type="date" id="qDate" value="${esc(q.date)}" min="${MIN_YEAR}-01-01" max="${today()}"></label>
      <label class="field"><span class="lbl">Heure</span><input class="input" type="time" id="qTime" value="${esc(q.time)}"></label></div>
      <div class="field"><span class="lbl">1. Intensité</span><div class="swatches">${COLORS.map((c) => `<button type="button" class="swatch c-${c}" data-q="intensity" data-v="${c}" aria-pressed="${q.intensity === c}">${COLOR_LABEL[c]}<small>${COLOR_DESC[c]}</small></button>`).join('')}</div></div>
      <div class="field"><span class="lbl">2. Type</span><div class="row wrap">${Object.entries(TYPES).map(([k, v]) => `<button type="button" class="pill" data-q="type" data-v="${k}" aria-pressed="${q.type === k}">${v}</button>`).join('')}</div></div>
      <div class="field"><label class="lbl" for="qNote">3. Récit (dicté ou tapé)</label>
        <textarea class="input" id="qNote" rows="5" placeholder="Racontez ce qui s'est passé : où, ce qu'il a fait ou dit, ce que vous avez fait, comment ça s'est terminé…">${esc(q.text)}</textarea>
        <button type="button" class="btn soft block" data-act="dictate">${ico('mic', 22)}Dicter avec le clavier</button>
        <p class="hint">Touchez le micro du clavier. Pour que votre voix reste dans le téléphone, activez la dictée hors ligne (Paramètres › Dictée vocale). Relisez et corrigez le texte avant de continuer.</p></div>
      <button type="button" class="btn block" id="qOrganize">Organiser l'observation</button>
      ${q.eventId ? '' : '<button type="button" class="btn quiet block" id="qSave">Enregistrer sans organiser</button>'}
      <p class="hint">Le brouillon est gardé automatiquement (chiffré) : vous pouvez fermer et reprendre plus tard.</p>
    </section></div>`;
    const sync = () => { q.date = $('#qDate').value || today(); q.time = $('#qTime').value || ''; q.text = $('#qNote').value; queueDraft(q); };
    ['#qDate', '#qTime', '#qNote'].forEach((s) => $(s).addEventListener('input', sync));
    $('.sheet', root).addEventListener('click', (ev) => {
      ev.stopPropagation();
      const b = ev.target.closest('[data-q]');
      if (b) {
        const key = b.dataset.q; const val = b.dataset.v;
        q[key] = q[key] === val ? null : val;
        $$(`[data-q="${key}"]`, root).forEach((x) => x.setAttribute('aria-pressed', String(q[key] === x.dataset.v)));
        sync();
        return;
      }
      const a = ev.target.closest('[data-act]');
      if (a) handleAct(a, ev);
    });
    if ($('#qSave')) $('#qSave').onclick = async () => {
      sync();
      const note = q.text.trim();
      if (!q.intensity && !q.type && !note) { toast('Choisissez au moins une intensité, un type ou écrivez une note.'); return; }
      const ev = { id: uid(), kind: 'event', date: q.date, time: q.time, type: q.type, intensity: q.intensity, note, author: S.settings.parent || '', createdAt: nowIso(), comments: [] };
      await saveEvent(ev);
      await dropDraft(q.id);
      closeSheets();
      S.selected = ev.date; S.month = null;
      if (S.view !== 'journal') S.view = 'calendar';
      render();
      toast(isIncomplete(ev) ? 'Enregistré · à compléter plus tard' : 'Événement enregistré', { label: 'Détails', run: () => openDetail(ev.id) });
    };
    $('#qOrganize').onclick = async () => {
      sync();
      if (!q.text.trim()) { toast('Écrivez ou dictez d\'abord le récit.'); $('#qNote').focus(); return; }
      startReview(q);
      await writeDraft(q);
      openReview(q.id);
    };
  }

  // ---------- Organisation et validation ----------
  // Prépare le brouillon pour l'écran de vérification (classement local, rien n'est envoyé)
  function startReview(d, existing = null) {
    const r = OR.organize(d.text, { type: d.type, childName: childName() });
    d.step = 'review';
    d.original = d.text; // figé : c'est ce texte qui sera conservé tel quel
    d.items = r.items;
    d.sections = { ...r.sections };
    // Fiche déjà existante : ce qui était déjà écrit dans une section est gardé en tête (rien n'est perdu)
    if (existing) for (const k of STRUCT_FIELDS) { const old = (existing[k] || '').trim(); if (old && !d.sections[k].includes(old)) d.sections[k] = d.sections[k] ? `${old}\n${d.sections[k]}` : old; }
    d.kept = existing ? Object.fromEntries(STRUCT_FIELDS.map((k) => [k, (existing[k] || '').trim()])) : null;
    d.categories = existing && (existing.categories || []).length ? [...existing.categories] : r.categories.map((c) => c.key);
    d.catWhy = Object.fromEntries(r.categories.map((c) => [c.key, c.why]));
    d.questions = r.questions;
    d.flags = r.flags;
    d.edited = false;
  }
  function rebuildFromItems(d) {
    const b = OR.build(d.items, { type: d.type, text: d.original });
    d.sections = { ...b.sections };
    if (d.kept) for (const k of STRUCT_FIELDS) { const old = d.kept[k]; if (old && !d.sections[k].includes(old)) d.sections[k] = d.sections[k] ? `${old}\n${d.sections[k]}` : old; }
    d.questions = b.questions.filter((qq) => !d.sections[qq.section]);
  }

  function openReview(draftId) {
    const d = S.drafts.get(draftId) || (liveDraft && liveDraft.id === draftId ? liveDraft : null);
    if (!d) { toast('Ce brouillon n\'existe plus.'); return; }
    liveDraft = d;
    const root = $('#sheet-root');
    const label = (k) => esc(fieldLabel(SECTION_LABELS[k]));
    const opts = (sel) => STRUCT_FIELDS.map((k) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${label(k)}</option>`).join('');
    const flags = (d.flags || []).length ? `<div class="banner warn"><span class="spacer"><strong>À vérifier :</strong> ${d.flags.map((f) => `« ${esc(f.word)} »`).join(', ')}.<br><span class="small">${esc(d.flags[0].tip)} L'application ne réécrit pas vos phrases : vous pouvez les corriger ci-dessous.</span></span></div>` : '';
    root.innerHTML = `<div class="panel" role="dialog" aria-modal="true" aria-labelledby="rTitle"><div class="panel-inner">
      <div class="panel-head"><button type="button" class="icon-btn plain" data-r="back" aria-label="Retour">${ico('left', 20)}</button><span class="title" id="rTitle">Vérifier l'observation</span></div>
      <p class="hint pad-hint">Proposition faite dans ce téléphone par des règles simples, sans intelligence artificielle : vos phrases sont rangées, pas réécrites. Rien n'est enregistré dans le journal avant votre approbation.</p>
      <section class="card"><details><summary><strong>Texte original</strong> <span class="small muted">(conservé tel quel)</span></summary><p class="original">${esc(d.original)}</p></details></section>
      ${flags}
      <section class="card"><h3 class="card-title">Classement proposé</h3>
        <p class="hint">Chaque phrase est rangée dans une section. Changez la section si elle ne convient pas.</p>
        <div class="list">${d.items.map((it, i) => `<div class="sent"><p>${esc(it.text)}</p><label class="sr" for="it${i}">Section</label><select class="input" id="it${i}" data-item="${i}">${opts(it.section)}</select><p class="small muted">Pourquoi : ${esc(it.why)}</p></div>`).join('') || '<p class="empty-note">Aucune phrase.</p>'}</div></section>
      ${(d.questions || []).length ? `<section class="card"><h3 class="card-title">Questions facultatives</h3><p class="hint">Répondez si vous le souhaitez, ou ignorez-les.</p>
        ${d.questions.map((qq, i) => `<div class="field"><label class="lbl" for="q${i}">${esc(qq.text)}</label><textarea class="input" rows="2" id="q${i}"></textarea><div class="row"><button type="button" class="btn small quiet" data-qa="${i}">Ajouter à « ${label(qq.section)} »</button><button type="button" class="btn small quiet" data-qi="${i}">Ignorer</button></div></div>`).join('')}</section>` : ''}
      <section class="card"><h3 class="card-title">Observation structurée</h3>
        <p class="hint">Corrigez librement chaque section. Une section sans information reste vide.</p>
        ${STRUCT_FIELDS.map((k) => `<label class="field"><span class="lbl">${label(k)} <span class="small muted">· ${esc(SECTION_HINTS[k])}</span></span><textarea class="input" rows="${d.sections[k] ? 3 : 2}" data-sec="${k}">${esc(d.sections[k])}</textarea></label>`).join('')}</section>
      <section class="card"><h3 class="card-title">Catégories</h3><p class="hint">Suggérées selon les mots du récit. Touchez pour ajouter ou retirer.</p>
        <div class="row wrap">${OR.CATEGORIES.map(([k, l]) => `<button type="button" class="pill" data-cat="${k}" aria-pressed="${d.categories.includes(k)}">${esc(l)}</button>`).join('')}</div>
        ${Object.keys(d.catWhy || {}).length ? `<p class="small muted">Mots repérés : ${Object.entries(d.catWhy).map(([k, w]) => `${esc(OR.CATEGORY_LABEL[k])} (${esc(w.join(', '))})`).join(' · ')}</p>` : ''}</section>
      <section class="card"><button type="button" class="btn block" id="rApprove">Approuver et enregistrer</button>
        <p class="hint">Vous approuvez cette version, au nom de ${esc(S.settings.parent || 'ce téléphone')}. Le texte original est conservé avec elle.</p>
        <button type="button" class="btn quiet block" data-r="later">Garder en brouillon</button>
        <button type="button" class="btn danger-ghost block" data-r="discard">Supprimer le brouillon</button></section>
    </div></div>`;
    const panel = $('.panel', root);
    const readSections = () => { $$('[data-sec]', panel).forEach((t) => { d.sections[t.dataset.sec] = t.value; }); };
    $$('[data-sec]', panel).forEach((t) => t.addEventListener('input', () => { d.edited = true; readSections(); queueDraft(d); }));
    $$('[data-item]', panel).forEach((s) => s.addEventListener('change', async () => {
      if (d.edited && !(await ask({ title: 'Reclasser la phrase ?', text: 'Les sections seront reconstruites à partir du classement : vos corrections manuelles dans les sections seront remplacées.', ok: 'Reclasser' }))) { s.value = d.items[Number(s.dataset.item)].section; return; }
      d.items[Number(s.dataset.item)].section = s.value;
      d.items[Number(s.dataset.item)].why = 'choisi par vous';
      d.edited = false;
      rebuildFromItems(d);
      await writeDraft(d);
      const y = panel.scrollTop; openReview(d.id); $('.panel').scrollTop = y;
    }));
    panel.addEventListener('click', async (ev) => {
      const cat = ev.target.closest('[data-cat]');
      if (cat) { const k = cat.dataset.cat; d.categories = d.categories.includes(k) ? d.categories.filter((x) => x !== k) : [...d.categories, k]; cat.setAttribute('aria-pressed', String(d.categories.includes(k))); queueDraft(d); return; }
      const qa = ev.target.closest('[data-qa]'); const qi = ev.target.closest('[data-qi]');
      if (qa || qi) {
        const i = Number((qa || qi).dataset.qa ?? (qa || qi).dataset.qi);
        const qq = d.questions[i];
        if (qa) {
          const ans = $(`#q${i}`).value.trim();
          if (!ans) { toast('Écrivez une réponse, ou touchez « Ignorer ».'); return; }
          readSections();
          d.sections[qq.section] = d.sections[qq.section] ? `${d.sections[qq.section]} ${OR.tidy(ans)}` : OR.tidy(ans);
          d.answers = [...(d.answers || []), { q: qq.text, a: ans }];
          d.edited = true;
        }
        d.questions = d.questions.filter((_, j) => j !== i);
        await writeDraft(d);
        const y = panel.scrollTop; openReview(d.id); $('.panel').scrollTop = y;
        return;
      }
      const r = ev.target.closest('[data-r]');
      if (!r) return;
      if (r.dataset.r === 'back') { d.step = 'text'; readSections(); await writeDraft(d); openQuick(null, d); return; }
      if (r.dataset.r === 'later') { readSections(); await writeDraft(d); liveDraft = null; closeSheets(); render(); toast('Brouillon gardé'); return; }
      if (r.dataset.r === 'discard') {
        if (!(await ask({ title: 'Supprimer ce brouillon ?', text: 'Le récit et l\'organisation proposée seront effacés de ce téléphone. Rien n\'a encore été enregistré dans le journal.', ok: 'Supprimer', danger: true }))) return;
        await dropDraft(d.id); closeSheets(); render(); toast('Brouillon supprimé');
      }
    });
    $('#rApprove').onclick = async () => {
      readSections();
      const sec = Object.fromEntries(STRUCT_FIELDS.map((k) => [k, (d.sections[k] || '').trim()]));
      if (!Object.values(sec).some(Boolean)) { toast('Toutes les sections sont vides.'); return; }
      const ok = await ask({ title: 'Approuver cette observation ?', text: 'Elle sera enregistrée dans le journal, partagée avec l\'autre parent, avec le texte original. Vous pourrez encore la modifier ensuite (il faudra alors l\'approuver de nouveau).', ok: 'Approuver' });
      if (!ok) return;
      let ev = d.eventId ? S.events.get(d.eventId) : null;
      let changedUnder = null;
      if (ev && d.baseVersion != null && ev.syncVersion !== d.baseVersion && !ev.conflict) changedUnder = { ...JS.eventToRow(ev), version: ev.syncVersion, created_at: ev.createdAt, updated_at: ev.updatedAt, author_id: ev.authorId, updated_by: ev.updatedById };
      if (!ev) ev = { id: uid(), kind: 'event', date: d.date, time: d.time, type: d.type, intensity: d.intensity, note: d.original.trim(), author: S.settings.parent || '', createdAt: nowIso(), comments: [] };
      else { ev.type = ev.type || d.type; ev.intensity = ev.intensity || d.intensity; }
      Object.assign(ev, sec);
      if (!ev.originalText) ev.originalText = d.original; // jamais remplacé une fois enregistré
      ev.categories = JS.CATEGORY_ORDER.filter((c) => d.categories.includes(c));
      ev.hasStructure = true; ev.approvalVoid = false; ev.approveRequest = uid(); // demande d'approbation explicite (envoyée avec la version relue)
      if (changedUnder) ev.conflict = { row: changedUnder, at: nowIso() };
      await saveEvent(ev);
      await dropDraft(d.id);
      closeSheets(); S.selected = ev.date; S.month = null; if (S.view !== 'journal') S.view = 'calendar'; render();
      toast(changedUnder ? 'Approuvée · l\'autre parent a aussi modifié la fiche, choisissez la version' : 'Observation enregistrée · approbation envoyée, en attente de confirmation', { label: 'Voir', run: () => openDetail(ev.id) });
    };
  }
  function organizeExisting(id) {
    const e = S.events.get(id);
    if (!e) return;
    const existing = [...S.drafts.values()].find((x) => x.eventId === id);
    if (existing) { if (existing.step === 'review') openReview(existing.id); else openQuick(null, existing); return; }
    const text = e.originalText || e.note || '';
    const d = newDraft({ date: e.date, time: e.time || '', intensity: e.intensity, type: e.type, text, eventId: id, baseVersion: e.syncVersion ?? null });
    if (!text.trim()) { liveDraft = d; openQuick(null, d); return; }
    startReview(d, e);
    writeDraft(d).then(() => openReview(d.id));
  }

  // ---------- Fiche détaillée ----------
  function openDetail(id) {
    const e = S.events.get(id);
    if (!e) return;
    const draft = JSON.parse(JSON.stringify(e));
    const root = $('#sheet-root');
    const fieldHtml = DETAIL_FIELDS.map(([k, rawLabel, kind]) => {
      const label = esc(fieldLabel(rawLabel));
      const v = esc(draft[k] ?? '');
      if (kind === 'area') return `<label class="field"><span class="lbl">${label}</span><textarea class="input" rows="2" data-f="${k}">${v}</textarea></label>`;
      if (kind === 'number') return `<label class="field"><span class="lbl">${label}</span><input class="input" type="number" min="0" max="1440" inputmode="numeric" data-f="${k}" value="${v}"></label>`;
      if (kind === 'place') return `<label class="field"><span class="lbl">${label}</span><input class="input" list="placesList" data-f="${k}" value="${v}"><datalist id="placesList">${PLACES.map((p) => `<option value="${p}"></option>`).join('')}</datalist></label>`;
      return `<label class="field"><span class="lbl">${label}</span><input class="input" data-f="${k}" value="${v}"></label>`;
    }).join('');
    const baseVersion = e.syncVersion;
    const comments = (draft.comments || []).map((c) => `<div class="comment"><strong>${esc(c.author || 'Parent')}</strong> <span class="small muted">${fmtStamp(c.at)}${c.pending ? ' · en attente d\'envoi' : ''}</span><br>${esc(c.text)}</div>`).join('');
    root.innerHTML = `<div class="panel" role="dialog" aria-modal="true" aria-labelledby="dTitle"><div class="panel-inner">
      <div class="panel-head"><button type="button" class="icon-btn plain" data-act="closeSheet" aria-label="Retour">${ico('left', 20)}</button><span class="title" id="dTitle">Fiche de l'événement</span><button type="button" class="btn small" id="dSave">Enregistrer</button></div>
      ${e.conflict ? `<div class="banner warn"><span class="spacer">Cette fiche a aussi été modifiée sur l'autre téléphone.</span><button type="button" class="btn small quiet" data-act="conflicts">Choisir</button></div>` : ''}
      ${e.syncError ? `<div class="banner warn"><span class="spacer">Pas encore envoyée : ${esc(e.syncError)}</span></div>` : ''}
      ${isStructured(e) ? `<section class="card"><div class="row"><strong class="spacer">${isApproved(e) ? '✓ ' : ''}${approvalLine(e)}</strong>${isApproved(e) || (isApprovalPending(e) && !e.conflict && !e.syncError) ? '' : '<button type="button" class="btn small" id="dApprove">Approuver</button>'}</div>
        ${isApproved(e) ? '<p class="hint">Si vous modifiez son contenu (sections, note, date, heure, endroit, catégories…), il faudra l\'approuver de nouveau.</p>' : isApprovalPending(e) && !e.conflict && !e.syncError ? '<p class="hint">La fiche n\'est pas encore approuvée : le serveur doit d\'abord confirmer.</p>' : '<p class="hint">Relisez les sections ci-dessous, puis approuvez cette version.</p>'}
        ${e.originalText ? `<details><summary>Texte original <span class="small muted">(verrouillé, jamais modifié)</span></summary><p class="original">${esc(e.originalText)}</p></details>` : ''}</section>`
        : (e.note || '').trim() ? `<section class="card"><button type="button" class="btn soft block" id="dOrganize">Organiser ce récit en sections</button><p class="hint">Proposition faite dans ce téléphone, à vérifier et approuver. Rien n'est remplacé sans votre accord.</p></section>` : ''}
      <section class="card">
        <div class="row wrap">${e.intensity ? `<span class="chip-tag c-${e.intensity}">${COLOR_LABEL[e.intensity]} · ${COLOR_DESC[e.intensity]}</span>` : ''}${e.type ? `<span class="chip-tag">${TYPES[e.type]}</span>` : ''}${isIncomplete(e) ? '<span class="chip-tag outline">À compléter</span>' : ''}</div>
        <p class="hint">Noté par ${esc(e.author || 'un parent')} le ${fmtStamp(e.createdAt)}${e.updatedAt && e.updatedAt !== e.createdAt && e.version > 1 ? ` · modifié${e.updatedBy ? ' par ' + esc(e.updatedBy) : ''} le ${fmtStamp(e.updatedAt)}` : ''}</p>
        <div class="two"><label class="field"><span class="lbl">Date</span><input class="input" type="date" data-f="date" value="${esc(draft.date)}" min="${MIN_YEAR}-01-01"></label>
        <label class="field"><span class="lbl">Heure</span><input class="input" type="time" data-f="time" value="${esc(draft.time || '')}"></label></div>
        <div class="field"><span class="lbl">Intensité</span><div class="swatches">${COLORS.map((c) => `<button type="button" class="swatch c-${c}" data-d="intensity" data-v="${c}" aria-pressed="${draft.intensity === c}">${COLOR_LABEL[c]}<small>${COLOR_DESC[c]}</small></button>`).join('')}</div></div>
        <div class="field"><span class="lbl">Type</span><div class="row wrap">${Object.entries(TYPES).map(([k, v]) => `<button type="button" class="pill" data-d="type" data-v="${k}" aria-pressed="${draft.type === k}">${v}</button>`).join('')}</div></div>
        <label class="field"><span class="lbl">Note rapide</span><textarea class="input" rows="3" data-f="note">${esc(draft.note || '')}</textarea></label>
        <p class="hint">Tous les champs ci-dessous sont facultatifs.</p>
        ${fieldHtml}
        <div class="field"><span class="lbl">Catégories</span><div class="row wrap">${OR.CATEGORIES.map(([k, l]) => `<button type="button" class="pill" data-dcat="${k}" aria-pressed="${(draft.categories || []).includes(k)}">${esc(l)}</button>`).join('')}</div></div>
        <label class="check"><input type="checkbox" id="dComplete" ${draft.markedComplete ? 'checked' : ''}> Fiche complète (retirer « À compléter »)</label>
      </section>
      <section class="card"><h3 class="card-title">Commentaires</h3>${comments || '<p class="empty-note">Aucun commentaire.</p>'}
        <label class="field"><span class="sr">Nouveau commentaire</span><textarea class="input" rows="2" id="dComment" placeholder="Ajouter une information complémentaire…"></textarea></label>
        <button type="button" class="btn quiet" id="dAddComment">Ajouter le commentaire</button></section>
      <section class="card"><button type="button" class="btn danger-ghost block" id="dDelete">Supprimer cet événement</button><p class="hint">L'événement va dans la corbeille pendant 30 jours avant d'être effacé.</p></section>
    </div></div>`;
    const panel = $('.panel', root);
    const snap = () => JSON.stringify([draft.intensity, draft.type, draft.categories || [], ...$$('[data-f]', panel).map((i) => i.value), $('#dComplete').checked, $('#dComment').value]);
    const initial = snap();
    panel.addEventListener('click', async (ev) => {
      const back = ev.target.closest('[data-act="closeSheet"]');
      if (back) {
        if (snap() !== initial && !(await ask({ title: 'Quitter sans enregistrer ?', text: 'Vos modifications de cette fiche seront perdues.', ok: 'Quitter', danger: true }))) return;
        closeSheets(); return;
      }
      const b = ev.target.closest('[data-d]');
      if (b) { const k = b.dataset.d; draft[k] = draft[k] === b.dataset.v ? null : b.dataset.v; $$(`[data-d="${k}"]`, panel).forEach((x) => x.setAttribute('aria-pressed', String(draft[k] === x.dataset.v))); return; }
      const c = ev.target.closest('[data-dcat]');
      if (c) { const k = c.dataset.dcat; const cur = draft.categories || []; draft.categories = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]; c.setAttribute('aria-pressed', String(draft.categories.includes(k))); return; }
      if (ev.target.closest('#dOrganize')) {
        if (snap() !== initial && !(await ask({ title: 'Organiser sans enregistrer ?', text: 'Vos modifications non enregistrées de cette fiche seront perdues. Enregistrez d\'abord si vous voulez les garder.', ok: 'Continuer', danger: true }))) return;
        organizeExisting(id); return;
      }
      const a = ev.target.closest('[data-act]');
      if (a) handleAct(a, ev);
    });
    const collect = () => {
      $$('[data-f]', panel).forEach((inp) => {
        const k = inp.dataset.f; let v = inp.value.trim();
        if (inp.type === 'number') v = v === '' ? '' : String(Math.max(0, Math.min(1440, Math.round(Number(v)) || 0)));
        draft[k] = v;
      });
      draft.markedComplete = $('#dComplete').checked;
    };
    const save = async (approve) => {
      collect();
      if (!draft.date) { toast('La date est obligatoire.'); return; }
      const cur = S.events.get(id);
      if (!cur) { toast('Cette fiche n\'existe plus (effacée de la corbeille).'); closeSheets(); render(); return; }
      if (approve && !(await ask({ title: 'Approuver cette version ?', text: `Vous approuvez les sections et les catégories telles qu'elles sont affichées, au nom de ${esc(S.settings.parent || 'ce téléphone')}.`, ok: 'Approuver' }))) return;
      // Si l'autre parent a modifié la fiche pendant qu'elle était ouverte, on ne l'écrase pas : conflit à trancher.
      const changedUnder = baseVersion != null && cur.syncVersion !== baseVersion && !cur.conflict;
      const before = changedUnder ? { ...JS.eventToRow(cur), version: cur.syncVersion, created_at: cur.createdAt, updated_at: cur.updatedAt, author_id: cur.authorId, updated_by: cur.updatedById } : null;
      const contentBefore = contentKey(cur);
      for (const k of EDITABLE) if (draft[k] !== undefined) cur[k] = draft[k];
      cur.categories = JS.CATEGORY_ORDER.filter((c) => (draft.categories || []).includes(c));
      const structChanged = contentBefore !== contentKey(cur); // tout changement de contenu (comme le serveur)
      if (approve) { cur.hasStructure = true; cur.approvalVoid = false; cur.approveRequest = uid(); } // demande d'approbation explicite (envoyée avec la version relue)
      else if (structChanged) { cur.approveRequest = null; if (cur.approval) cur.approvalVoid = true; } // le serveur retire aussi l'approbation
      if (before) cur.conflict = { row: before, at: nowIso() };
      await saveEvent(cur);
      closeSheets(); S.selected = cur.date; S.month = null; render();
      toast(before ? 'Enregistrée · l\'autre parent l\'a aussi modifiée, choisissez la version' : approve ? 'Approbation envoyée, en attente de confirmation' : structChanged && isStructured(cur) ? 'Fiche enregistrée · à approuver de nouveau' : 'Fiche enregistrée');
    };
    $('#dSave').onclick = () => save(false);
    if ($('#dApprove')) $('#dApprove').onclick = () => save(true);
    $('#dAddComment').onclick = async () => {
      const text = $('#dComment').value.trim();
      if (!text) return;
      const cur = S.events.get(id);
      cur.comments = [...(cur.comments || []), { id: uid(), author: S.settings.parent || '', text, at: nowIso(), pending: true }];
      await saveEvent(cur, { touch: false }); // un commentaire s'ajoute sans modifier la fiche
      collect();
      const keep = { ...draft };
      openDetail(id);
      // conserve les modifications non enregistrées de la fiche
      $$('[data-f]', $('.panel')).forEach((inp) => { if (keep[inp.dataset.f] !== undefined) inp.value = keep[inp.dataset.f]; });
      toast('Commentaire ajouté');
    };
    $('#dDelete').onclick = async () => {
      const ok = await ask({ title: 'Supprimer cet événement ?', text: 'Il sera placé dans la corbeille pendant 30 jours. Vous pourrez le restaurer depuis les Paramètres.', ok: 'Supprimer', danger: true });
      if (!ok) return;
      const cur = S.events.get(id);
      cur.deletedAt = nowIso();
      await saveEvent(cur);
      closeSheets(); render();
      toast('Événement supprimé', { label: 'Annuler', run: async () => { delete cur.deletedAt; await saveEvent(cur); render(); } });
    };
  }

  // ---------- Filtres combinables (phase 5) : Journal et Rapports utilisent le même modèle ----------
  const statsCtx = { isApproved, isIncomplete, categoryLabel: (k) => OR.CATEGORY_LABEL[k] || k };
  const filterOf = (scope) => (scope === 'r' ? S.rep.filter : S.jf);
  const knownPlaces = () => { const set = new Map(PLACES.map((p) => [ST.norm(p), p])); for (const e of liveEvents()) { const p = String(e.place || '').trim(); if (p && !set.has(ST.norm(p))) set.set(ST.norm(p), p); } return [...set.values()]; };
  const knownAuthors = () => [...new Set(liveEvents().map((e) => e.author).filter(Boolean))].sort();
  function pills(scope, key, options) {
    const f = filterOf(scope);
    return `<div class="row wrap">${options.map(([v, l]) => `<button type="button" class="pill small-pill" data-act="fl" data-scope="${scope}" data-k="${key}" data-v="${esc(v)}" aria-pressed="${(f[key] || []).includes(v)}">${esc(l)}</button>`).join('')}</div>`;
  }
  function filterPanel(scope) {
    const f = filterOf(scope);
    const authors = knownAuthors();
    return `<div class="filters">
      ${scope === 'j' ? `<div class="two"><label class="field"><span class="lbl">Du</span><input class="input" type="date" data-fdate="from" data-scope="j" value="${esc(f.from)}" min="${MIN_YEAR}-01-01"></label>
        <label class="field"><span class="lbl">Au</span><input class="input" type="date" data-fdate="to" data-scope="j" value="${esc(f.to)}" min="${MIN_YEAR}-01-01"></label></div>` : `<label class="field"><span class="lbl">Mots dans les observations (facultatif)</span><input class="input" type="search" data-fq="r" value="${esc(f.q)}" placeholder="ex. : transition, école"></label>`}
      <span class="lbl">Type</span>${pills(scope, 'types', Object.entries(TYPES))}
      <span class="lbl">Intensité</span>${pills(scope, 'intensities', [...COLORS.map((c) => [c, `${COLOR_LABEL[c]} · ${COLOR_DESC[c].toLowerCase()}`]), ['none', 'Sans intensité']])}
      <span class="lbl">Catégories</span>${pills(scope, 'categories', OR.CATEGORIES)}
      <span class="lbl">Endroit</span>${pills(scope, 'places', knownPlaces().map((p) => [p, p]))}
      ${authors.length > 1 ? `<span class="lbl">Noté par</span>${pills(scope, 'authors', authors.map((a) => [a, a]))}` : ''}
      ${scope === 'j' ? `<span class="lbl">Approbation</span><div class="seg">${[['all', 'Toutes'], ['approved', 'Approuvées'], ['not_approved', 'Non approuvées']].map(([v, l]) => `<button type="button" data-act="flApproval" data-v="${v}" aria-pressed="${f.approval === v}">${l}</button>`).join('')}</div>
        <label class="check"><input type="checkbox" data-ftodo="j" ${f.todo ? 'checked' : ''}> Seulement les fiches « À compléter »</label>` : ''}
      <button type="button" class="btn quiet small" data-act="flReset" data-scope="${scope}">Effacer les filtres</button>
    </div>`;
  }
  // Description lisible des critères (affichée dans le rapport)
  function criteriaText(f) {
    const out = [];
    if ((f.types || []).length) out.push(`types : ${f.types.map((t) => TYPES[t] || t).join(', ')}`);
    if ((f.intensities || []).length) out.push(`intensités : ${f.intensities.map((c) => (c === 'none' ? 'sans intensité' : COLOR_LABEL[c].toLowerCase())).join(', ')}`);
    if ((f.categories || []).length) out.push(`catégories : ${f.categories.map((c) => OR.CATEGORY_LABEL[c] || c).join(', ')}`);
    if ((f.places || []).length) out.push(`endroits : ${f.places.join(', ')}`);
    if ((f.authors || []).length) out.push(`notées par : ${f.authors.join(', ')}`);
    if ((f.q || '').trim()) out.push(`mots : « ${f.q.trim()} »`);
    return out;
  }
  function attachFilterInputs() {
    $$('[data-fdate]').forEach((inp) => inp.addEventListener('change', () => { filterOf(inp.dataset.scope)[inp.dataset.fdate] = inp.value; render(); }));
    $$('[data-ftodo]').forEach((inp) => inp.addEventListener('change', () => { S.jf.todo = inp.checked; render(); }));
    $$('[data-fq]').forEach((inp) => inp.addEventListener('change', () => { S.rep.filter.q = inp.value; render(); }));
  }

  // ---------- Journal ----------
  const QUICK = [['todo', 'À compléter'], ['hard', 'Difficultés et crises'], ['intense', 'Crises intenses'], ['pos', 'Réussites et beaux moments']];
  const same = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());
  function quickOn(k) {
    const f = S.jf;
    if (k === 'todo') return f.todo;
    if (k === 'hard') return same(f.types, HARD_TYPES);
    if (k === 'intense') return same(f.intensities, ['rouge']);
    if (k === 'pos') return same(f.types, ['reussite', 'beau_moment']);
    return false;
  }
  function renderJournal() {
    const f = S.jf;
    f.q = S.jQuery;
    const list = ST.filterEvents(liveEvents(), f, statsCtx).sort((a, b) => sortEv(b, a));
    const nAct = ST.activeCount({ ...f, q: '' });
    let html = `<div class="search">${ico('search', 20)}<label class="sr" for="jq">Rechercher</label><input id="jq" type="search" placeholder="Rechercher (ex. : parc, transition, école)" value="${esc(S.jQuery)}"></div>
      <div class="chips">${QUICK.map(([k, l]) => `<button type="button" class="pill" data-act="quickF" data-f="${k}" aria-pressed="${quickOn(k)}">${l}</button>`).join('')}
        <button type="button" class="pill" data-act="jfOpen" aria-expanded="${!!S.jfOpen}">Filtres${nAct ? ` (${nAct})` : ''} ${S.jfOpen ? '▴' : '▾'}</button></div>
      ${S.jfOpen ? `<section class="card">${filterPanel('j')}</section>` : ''}
      <div class="row wrap pad-row"><span class="hint spacer">${list.length} observation${list.length > 1 ? 's' : ''}${nAct || S.jQuery.trim() ? ' correspondent aux filtres' : ''}</span>
        ${list.length ? '<button type="button" class="btn small quiet" data-act="jToReport">Créer un rapport avec ces filtres</button>' : ''}</div>`;
    if (!list.length) html += '<div class="placeholder">Aucun événement ne correspond.</div>';
    let cur = '';
    for (const e of list) {
      const month = `${MONTHS[parseYmd(e.date).getMonth()]} ${parseYmd(e.date).getFullYear()}`;
      if (month !== cur) { if (cur) html += '</div>'; html += `<p class="group-date">${month}</p><div class="list pad">`; cur = month; }
      html += evRow(e, true, true);
    }
    if (cur) html += '</div>';
    view().innerHTML = html;
    attachFilterInputs();
    const inp = $('#jq');
    inp.addEventListener('input', () => { S.jQuery = inp.value; const pos = inp.selectionStart; renderJournal(); const n = $('#jq'); n.focus(); n.setSelectionRange(pos, pos); });
  }

  // ---------- Périodes ----------
  function presetRange(key) {
    const to = today();
    const minus = (months) => { const d = parseYmd(to); d.setMonth(d.getMonth() - months); d.setDate(d.getDate() + 1); return ymd(d); };
    let from = to;
    if (key === '4w') from = ST.addDays(to, -27);
    else if (key === '3m') from = minus(3);
    else if (key === '6m') from = minus(6);
    else if (key === '12m') from = minus(12);
    else if (key === 'all') { const dates = [...liveEvents().map((e) => e.date), ...[...S.days.values()].filter((d) => d.rating).map((d) => d.date)].sort(); from = dates[0] || ST.addDays(to, -27); }
    if (from < `${MIN_YEAR}-01-01`) from = `${MIN_YEAR}-01-01`;
    return { from, to };
  }
  const getDayFn = (d) => S.days.get(d) || null;

  // ---------- Évolution (statistiques) ----------
  function renderEvolution() {
    const ev = S.evo;
    const { from, to } = presetRange(ev.range);
    const events = ST.filterEvents(liveEvents(), { ...ST.emptyFilter(), from, to }, statsCtx);
    const sum = ST.summarize(getDayFn, events, from, to);
    const buckets = ev.unit === 'month' ? sum.months : sum.weeks;
    const ranges = [['4w', '4 semaines'], ['3m', '3 mois'], ['12m', '12 mois'], ['all', 'Tout']];
    view().innerHTML = `<div class="chips"><div class="seg grow">${ranges.map(([k, l]) => `<button type="button" data-act="evoRange" data-v="${k}" aria-pressed="${ev.range === k}">${l}</button>`).join('')}</div></div>
      <section class="card stat-scope"><p class="hint"><strong>Basé sur ${sum.n} observation${sum.n > 1 ? 's' : ''}</strong> du ${ST.fmtDay(from)} au ${ST.fmtDay(to)} (${sum.days.total} jours)${sum.examples ? `, dont ${sum.examples} fiche${sum.examples > 1 ? 's' : ''} d'exemple` : ''}. Toutes les observations sont comptées, approuvées ou non.</p></section>
      <section class="card"><h3 class="card-title">Journées</h3>${RP.daysTable(sum.days)}
        <div class="seg">${[['week', 'Par semaine'], ['month', 'Par mois']].map(([k, l]) => `<button type="button" data-act="evoUnit" data-v="${k}" aria-pressed="${ev.unit === k}">${l}</button>`).join('')}</div>
        ${RP.dayChart(buckets, 360)}
        <p class="hint">Une journée non évaluée n'a pas reçu de couleur : elle n'est jamais comptée comme une journée sans difficulté.</p></section>
      <section class="card"><h3 class="card-title">Tendances ${ev.unit === 'month' ? 'par mois' : 'par semaine'}</h3><div class="cmp-wrap">${RP.trendTable(buckets)}</div></section>
      <section class="card"><h3 class="card-title">Observations</h3>
        <p class="hint">Difficultés et crises : <strong>${sum.hard}</strong> (dont ${sum.intense} rouges) · Réussites et beaux moments : <strong>${sum.positive}</strong></p>
        <p class="hint">Retour au calme : ${RP.esc(RP.calmText(sum.calm))}.</p></section>
      <section class="card"><h3 class="card-title">Catégories les plus fréquentes</h3><p class="hint">Sur ${sum.categories.n} observations (${sum.categories.withCategory} avec au moins une catégorie).</p>${RP.freqList(sum.categories.items, sum.categories.n, (x) => OR.CATEGORY_LABEL[x.key] || x.key, 5)}</section>
      <section class="card"><h3 class="card-title">Contextes des difficultés et crises</h3><p class="hint">Sur ${sum.contexts.n} difficultés et crises.</p>
        <span class="lbl">Endroits (${sum.contexts.places.n} précisés)</span>${RP.freqList(sum.contexts.places.items, sum.contexts.n, (x) => x.key, 4)}
        <span class="lbl">Moments de la journée (${sum.contexts.moments.n} avec l'heure)</span>${RP.freqList(sum.contexts.moments.items, sum.contexts.n, (x) => x.label, 5)}
        <span class="lbl">Jours de la semaine</span>${RP.freqList(sum.contexts.weekdays.items, sum.contexts.n, (x) => x.key, 7)}</section>
      <section class="card"><h3 class="card-title">Interventions et retour au calme</h3>${RP.interventionBlock(sum.interventions, 5)}</section>
      <p class="hint pad-hint">Calculé dans ce téléphone, rien n'est envoyé. Les statistiques ne valent que pour les observations notées.</p>`;
  }

  // ---------- Rapports ----------
  function reportSelection() {
    const r = S.rep;
    const { from, to } = r.preset === 'custom' ? { from: r.from, to: r.to } : presetRange(r.preset);
    const f = { ...r.filter, from, to, approval: r.includeUnapproved ? 'all' : 'approved', examples: false };
    const events = ST.filterEvents(liveEvents(), f, statsCtx);
    const prevRange = ST.previousPeriod(from, to);
    const prevEvents = ST.filterEvents(liveEvents(), { ...f, ...prevRange }, statsCtx);
    const all = ST.filterEvents(liveEvents(), { ...f, approval: 'all' }, statsCtx);
    return { from, to, f, events, prev: { ...prevRange, events: prevEvents }, notApprovedLeftOut: r.includeUnapproved ? 0 : all.length - events.length };
  }
  function renderReports() {
    const r = S.rep;
    const sel = reportSelection();
    const nAct = ST.activeCount({ ...r.filter, approval: 'all', examples: true });
    const presets = [['4w', '4 semaines'], ['3m', '3 mois'], ['6m', '6 mois'], ['custom', 'Autre']];
    const okDates = sel.from && sel.to && sel.from <= sel.to;
    view().innerHTML = `<section class="card"><h3 class="card-title">Type de rapport</h3>
        <div class="seg">${[['summary', 'Résumé (1 page)'], ['detailed', 'Rapport détaillé']].map(([k, l]) => `<button type="button" data-act="repKind" data-v="${k}" aria-pressed="${r.kind === k}">${l}</button>`).join('')}</div>
        <p class="hint">${r.kind === 'summary' ? 'Une page de synthèse : journées, observations, catégories, contextes et interventions. Aucune impression des parents.' : 'La page de synthèse, les tendances, puis chaque observation (faits observés), et en option les impressions des parents dans une section séparée.'}</p></section>
      <section class="card"><h3 class="card-title">Période</h3>
        <div class="seg">${presets.map(([k, l]) => `<button type="button" data-act="repPreset" data-v="${k}" aria-pressed="${r.preset === k}">${l}</button>`).join('')}</div>
        ${r.preset === 'custom' ? `<div class="two"><label class="field"><span class="lbl">Du</span><input class="input" type="date" id="rFrom" value="${esc(r.from)}" min="${MIN_YEAR}-01-01" max="${today()}"></label><label class="field"><span class="lbl">Au</span><input class="input" type="date" id="rTo" value="${esc(r.to)}" min="${MIN_YEAR}-01-01" max="${today()}"></label></div>` : ''}
        <p class="hint">${okDates ? `Du ${ST.fmtDay(sel.from)} au ${ST.fmtDay(sel.to)}.` : 'Choisissez une date de début et une date de fin.'}</p></section>
      <section class="card"><h3 class="card-title">Observations incluses</h3>
        <p class="sel-count"><strong>${sel.events.length}</strong> observation${sel.events.length > 1 ? 's' : ''} sélectionnée${sel.events.length > 1 ? 's' : ''}${sel.notApprovedLeftOut ? ` · ${sel.notApprovedLeftOut} non approuvée${sel.notApprovedLeftOut > 1 ? 's' : ''} laissée${sel.notApprovedLeftOut > 1 ? 's' : ''} de côté` : ''}</p>
        <label class="check"><input type="checkbox" id="rUnapproved" ${r.includeUnapproved ? 'checked' : ''}> Inclure aussi les fiches non approuvées (elles seront marquées « non approuvée »)</label>
        <div class="row wrap"><button type="button" class="pill" data-act="repFilters" aria-expanded="${!!r.filtersOpen}">Filtres${nAct ? ` (${nAct})` : ''} ${r.filtersOpen ? '▴' : '▾'}</button>
          <button type="button" class="btn small quiet" data-act="repFromJournal">Reprendre les filtres du Journal</button></div>
        ${r.filtersOpen ? filterPanel('r') : ''}
        <p class="hint">Les fiches d'exemple et celles de la corbeille ne sont jamais incluses.</p></section>
      <section class="card"><h3 class="card-title">Contenu et confidentialité</h3>
        <label class="check"><input type="checkbox" id="rHide" ${r.hide ? 'checked' : ''}> Masquer les renseignements personnels (prénom de l'enfant, noms des parents, personnes présentes)</label>
        <label class="check"><input type="checkbox" id="rImp" ${r.impressions ? 'checked' : ''} ${r.kind === 'summary' ? 'disabled' : ''}> Ajouter les impressions des parents (section séparée des faits)</label>
        <label class="check"><input type="checkbox" id="rOrig" ${r.original ? 'checked' : ''} ${r.kind === 'summary' ? 'disabled' : ''}> Ajouter les textes originaux dictés (en annexe)</label>
        ${r.hide ? '<p class="hint">Le masquage remplace le prénom enregistré dans les Paramètres. Relisez l\'aperçu : un autre nom écrit dans une observation n\'est pas détecté automatiquement.</p>' : ''}</section>
      <div class="pad-row"><button type="button" class="btn block" data-act="repPreview" ${okDates ? '' : 'disabled'}>Prévisualiser le rapport</button>
        <p class="hint">Le rapport est préparé dans ce téléphone. Il n'est ni envoyé, ni enregistré par l'application : c'est vous qui choisissez de l'imprimer ou de l'enregistrer en PDF.</p></div>`;
    attachFilterInputs();
    const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener('change', () => { fn(el); render(); }); };
    bind('#rFrom', (el) => { r.from = el.value; });
    bind('#rTo', (el) => { r.to = el.value; });
    bind('#rUnapproved', (el) => { r.includeUnapproved = el.checked; });
    bind('#rHide', (el) => { r.hide = el.checked; });
    bind('#rImp', (el) => { r.impressions = el.checked; });
    bind('#rOrig', (el) => { r.original = el.checked; });
  }
  function approvalTextFor(e, hide) {
    if (!isApproved(e)) return 'NON APPROUVÉE';
    const d = e.approval.at ? new Date(e.approval.at) : null;
    const when = d ? ` le ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '';
    const who = hide ? '' : (parentName(e.approval.byId) || e.approval.by || '');
    return `Approuvée${who ? ` par ${who}` : ''}${when}`;
  }
  // Aperçu : le rapport n'existe qu'en mémoire, dans la page ; il est effacé à la fermeture et au verrouillage
  function clearReport() { const p = $('#print-root'); if (p) p.innerHTML = ''; }
  function openReportPreview() {
    const r = S.rep;
    const sel = reportSelection();
    const html = RP.build({
      kind: r.kind, events: sel.events, getDay: getDayFn, from: sel.from, to: sel.to, prev: sel.prev,
      includeImpressions: r.kind === 'detailed' && r.impressions, includeOriginal: r.kind === 'detailed' && r.original, hideIdentity: r.hide,
      childName: childName(), isApproved, approvalText: approvalTextFor, generatedAt: nowIso(), criteria: criteriaText(r.filter), categoryLabel: (k) => OR.CATEGORY_LABEL[k] || k,
    });
    $('#print-root').innerHTML = html;
    const root = $('#sheet-root');
    root.innerHTML = `<div class="panel" role="dialog" aria-modal="true" aria-labelledby="pTitle"><div class="panel-inner wide">
      <div class="panel-head"><button type="button" class="icon-btn plain" id="pBack" aria-label="Retour">${ico('left', 20)}</button><span class="title" id="pTitle">Aperçu du rapport</span><button type="button" class="btn small" id="pPrint">Imprimer ou PDF</button></div>
      <div class="banner"><span class="spacer">Relisez avant d'imprimer. Pour un PDF : dans la fenêtre d'impression, choisissez « Enregistrer au format PDF » (Android) ou utilisez « Partager » puis « Enregistrer dans Fichiers » (iPhone). Rien n'est envoyé par l'application.</span></div>
      <div class="paper">${html}</div></div></div>`;
    $('#pBack').onclick = () => closeSheets();
    $('#pPrint').onclick = () => printReport(sel);
  }
  function printReport(sel) {
    // Nom proposé pour le PDF : sans prénom si les renseignements sont masqués
    document.title = `Rapport d'observation ${sel.from} au ${sel.to}${!S.rep.hide && childName() ? ` - ${childName()}` : ''}`;
    window.print();
  }
  window.addEventListener('afterprint', () => { if (S.unlocked) applyTitles(true); });

  // ---------- Paramètres ----------
  function renderSettings() {
    const trash = [...S.events.values()].filter((e) => e.deletedAt).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    const last = S.settings.lastExport ? fmtStamp(S.settings.lastExport) : 'jamais';
    const n = pendingCount();
    const errs = syncErrors();
    const cf = conflicts().length;
    const lastSync = S.syncState && S.syncState.lastSync ? fmtStamp(S.syncState.lastSync) : 'jamais';
    const email = S.session && S.session.user ? S.session.user.email : '';
    const account = S.loggedIn ? `
      <section class="card"><h3 class="card-title">Compte et synchronisation</h3>
        <div class="set-row"><span>Connecté</span><strong>${esc(S.settings.parent || '…')}</strong></div>
        <p class="hint">${esc(email)}</p>
        <div class="set-row"><span>État</span><span class="sync-chip ${syncLabel().cls}">${esc(syncLabel().txt)}</span></div>
        <div class="set-row"><span>Dernière synchro</span><span class="muted">${lastSync}</span></div>
        <div class="set-row"><span>En attente d'envoi</span><span class="muted">${n}</span></div>
        ${cf ? `<button type="button" class="btn block" data-act="conflicts">Résoudre ${cf} conflit${cf > 1 ? 's' : ''}</button>` : ''}
        ${errs.length ? `<div class="list">${errs.map((r) => `<div class="comment"><strong>${r.kind === 'day' ? 'Journée du ' + fmtShort(r.date) : esc(evTitle(r)) + ' · ' + fmtShort(r.date)}</strong><br>${esc(r.syncError)}</div>`).join('')}</div><p class="hint">Ces éléments restent dans ce téléphone. Corrigez la fiche (par exemple la date) et elle sera renvoyée.</p>` : ''}
        <button type="button" class="btn quiet block" data-act="syncNow">Synchroniser maintenant</button>
        <button type="button" class="btn quiet block" data-act="logout">Se déconnecter</button>
        <p class="hint">Les observations sont envoyées chiffrées (HTTPS) à votre espace Supabase privé. Seuls les comptes de Papa et Maman peuvent les lire. Sans réseau, tout est gardé dans ce téléphone et envoyé au retour de la connexion.</p></section>`
      : `
      <section class="card"><h3 class="card-title">Compte et synchronisation</h3>
        <p class="hint">${S.sync.status === 'auth' ? 'La connexion a expiré. ' : ''}Connectez-vous avec votre compte pour partager le journal entre vos deux téléphones.${n ? ` ${n} élément(s) attendent d'être envoyés.` : ''}</p>
        <button type="button" class="btn block" data-act="login">Se connecter</button></section>
      <section class="card"><h3 class="card-title">Qui utilise ce téléphone ?</h3>
        <div class="seg">${['Papa', 'Maman'].map((p) => `<button type="button" data-act="parent" data-p="${p}" aria-pressed="${S.settings.parent === p}">${p}</button>`).join('')}</div>
        <p class="hint">Indiqué sur chaque observation. Une fois connecté, le nom vient de votre compte.</p></section>`;
    view().innerHTML = `${account}
      <section class="card"><h3 class="card-title">Prénom de l'enfant</h3>
        <div class="row"><label class="sr" for="childName">Prénom</label><input class="input" id="childName" maxlength="40" autocomplete="off" value="${esc(childName())}" placeholder="Prénom (facultatif)"><button type="button" class="btn small" data-act="saveChild">Enregistrer</button></div>
        <p class="hint">Affiché seulement quand l'application est déverrouillée. Enregistré chiffré dans ce téléphone, jamais dans le code public. L'écran de verrouillage et l'icône affichent « ${NEUTRAL_TITLE} ».</p></section>
      <section class="card"><h3 class="card-title">Dictée vocale</h3>
        <p class="hint">L'application n'écoute jamais le micro elle-même : la dictée passe par le <strong>micro du clavier</strong> (Gboard sur Android). Par défaut, ce clavier peut envoyer la voix à Google pour la transformer en texte. Pour qu'elle reste dans le téléphone :</p>
        <ol class="steps"><li>Paramètres Android › Système › Clavier › Gboard › <strong>Saisie vocale</strong> : activez <strong>Reconnaissance vocale hors ligne</strong> (ou « Saisie vocale plus rapide ») et téléchargez le <strong>français</strong>.</li>
        <li>Gboard › Confidentialité : désactivez le partage d'extraits audio (« Améliorer la reconnaissance vocale » ou équivalent), s'il est proposé.</li>
        <li><strong>Vérification</strong> : activez le <strong>mode avion</strong>, ouvrez « Nouvel événement » et dictez une phrase. Si le texte apparaît, la reconnaissance se fait dans le téléphone.</li></ol>
        <p class="hint">Limites : les noms des réglages varient selon le téléphone ; le mode hors ligne peut être un peu moins précis ; Google peut faire évoluer son clavier. En cas de doute, tapez le texte. Les récits eux-mêmes ne sont jamais envoyés à un service d'analyse : l'organisation se fait dans l'application.</p></section>
      <section class="card"><h3 class="card-title">Sécurité de ce téléphone</h3>
        <div class="set-row"><span>Verrouillage automatique</span><span class="muted">après 5 min</span></div>
        <button type="button" class="btn quiet block" data-act="lockNow">${ico('lock', 18)}Verrouiller maintenant</button>
        <button type="button" class="btn quiet block" data-act="changePin">Changer le code</button>
        <p class="hint">Les observations sont chiffrées dans ce téléphone. Le code empêche l'ouverture de l'app par une autre personne ; la protection principale reste le verrouillage d'écran de votre téléphone (voir « Confidentialité »).</p></section>
      <section class="card"><h3 class="card-title">Sauvegarde</h3>
        <p class="hint">Dernière sauvegarde : ${last}. Gardez le fichier dans un endroit privé.</p>
        <button type="button" class="btn block" data-act="export" data-mode="enc">Sauvegarder (fichier protégé par mot de passe)</button>
        <button type="button" class="btn quiet block" data-act="export" data-mode="plain">Exporter en clair (lisible, non protégé)</button>
        <label class="btn quiet block" for="importFile">Restaurer une sauvegarde</label>
        <input type="file" id="importFile" accept=".json,application/json" class="sr">
        <p class="hint">La restauration ajoute les observations manquantes et garde la version la plus récente de chacune ; rien n'est effacé.</p></section>
      <section class="card"><h3 class="card-title">Corbeille (${trash.length})</h3>
        ${trash.length ? `<div class="list">${trash.map((e) => `<div class="ev"><span class="bar ${e.intensity ? 'c-' + e.intensity : ''}"></span><span class="body"><span class="meta"><span class="kind">${esc(evTitle(e))}</span><span>${fmtShort(e.date)}</span></span><span class="txt">${esc(evText(e))}</span>
          <span class="row"><button type="button" class="btn small quiet" data-act="restore" data-id="${e.id}">Restaurer</button>${e.localOnly || e.syncVersion == null ? `<button type="button" class="btn small danger-ghost" data-act="purge" data-id="${e.id}">Effacer</button>` : ''}</span></span></div>`).join('')}</div>` : '<p class="empty-note">La corbeille est vide.</p>'}
        <p class="hint">Les éléments sont effacés définitivement après 30 jours, sur les deux téléphones. Avant, l'un ou l'autre parent peut les restaurer.</p></section>
      <section class="card"><h3 class="card-title">Essais</h3>
        <button type="button" class="btn quiet block" data-act="demo">Ajouter des données fictives</button>
        <p class="hint">Pour tester l'application. Ces exemples sont inventés et marqués « [Exemple] ».</p>
        <button type="button" class="btn danger-ghost block" data-act="wipe">Effacer toutes les données de ce téléphone</button></section>
      <section class="card"><h3 class="card-title">Confidentialité</h3>
        <p class="hint">Dans ce téléphone, les observations et la connexion sont chiffrées (AES-256) avec une clé que l'application peut utiliser mais pas lire. Une fois connecté, elles sont aussi envoyées en HTTPS à votre espace Supabase privé, lisible seulement par les comptes de Papa et Maman. Les données fictives (« [Exemple] ») et les brouillons restent dans ce téléphone. L'organisation des récits en sections se fait dans l'application, par des règles simples : aucun récit n'est envoyé à un service d'analyse ou d'intelligence artificielle. Limite : quelqu'un qui aurait votre téléphone déverrouillé et des outils techniques avancés pourrait contourner le code de l'app ; d'où l'importance du verrouillage d'écran Android. Aucun diagnostic n'est établi par cette application.</p>
        <p class="hint">Version ${APP_VERSION}</p></section>`;
    $('#importFile').addEventListener('change', importFile);
  }

  // ---------- Sauvegarde / restauration ----------
  function download(name, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function snapshot() { return { events: [...S.events.values()], days: [...S.days.values()], drafts: [...S.drafts.values()] }; }
  async function doExport(mode) {
    const stamp = today();
    let file;
    if (mode === 'enc') {
      const pw = await ask({ title: 'Protéger la sauvegarde', text: 'Choisissez un mot de passe d\'au moins 10 caractères. <strong>Sans lui, le fichier ne pourra pas être restauré.</strong> Notez-le dans un endroit sûr.', ok: 'Créer la sauvegarde', input: { label: 'Mot de passe', type: 'password', confirm: 'Confirmer le mot de passe', validate: (a, b) => (a.length < 10 ? 'Au moins 10 caractères.' : a !== b ? 'Les deux mots de passe sont différents.' : null) } });
      if (!pw) return;
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const key = await passwordKey(pw, salt, EXPORT_ITER);
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(snapshot())));
      file = { format: 'journal-familial-sauvegarde', version: 1, createdAt: nowIso(), encrypted: true, kdf: { name: 'PBKDF2-SHA256', iterations: EXPORT_ITER, salt: b64(salt) }, iv: b64(iv), data: b64(ct) };
    } else {
      const ok = await ask({ title: 'Exporter en clair ?', text: 'Le fichier sera lisible par toute personne qui y a accès. Utilisez plutôt la sauvegarde protégée, sauf pour consulter vos données dans un autre logiciel.', ok: 'Exporter quand même' });
      if (!ok) return;
      file = { format: 'journal-familial-sauvegarde', version: 1, createdAt: nowIso(), encrypted: false, data: snapshot() };
    }
    download(`journal-familial-${stamp}${mode === 'enc' ? '-protege' : '-lisible'}.json`, JSON.stringify(file, null, mode === 'enc' ? 0 : 2));
    S.settings.lastExport = nowIso();
    await saveSettings();
    render();
    toast('Sauvegarde créée (dossier Téléchargements)');
  }
  function validEvent(e) { return e && typeof e.id === 'string' && e.kind === 'event' && /^\d{4}-\d{2}-\d{2}$/.test(e.date || '') && (!e.intensity || COLORS.includes(e.intensity)) && (!e.type || TYPES[e.type]); }
  function validDay(d) { return d && typeof d.id === 'string' && d.kind === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(d.date || '') && (!d.rating || COLORS.includes(d.rating)); }
  async function importFile(ev) {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { toast('Fichier trop volumineux.'); return; }
    let file;
    try { file = JSON.parse(await f.text()); } catch (e) { toast('Ce fichier n\'est pas une sauvegarde valide.'); return; }
    if (!file || file.format !== 'journal-familial-sauvegarde') { toast('Ce fichier n\'est pas une sauvegarde de ce journal.'); return; }
    let data = file.data;
    if (file.encrypted) {
      const pw = await ask({ title: 'Mot de passe de la sauvegarde', ok: 'Restaurer', input: { label: 'Mot de passe', type: 'password' } });
      if (!pw) return;
      try {
        const key = await passwordKey(pw, unb64(file.kdf.salt), file.kdf.iterations);
        data = JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(file.iv) }, key, unb64(file.data))));
      } catch (e) { toast('Mot de passe incorrect ou fichier endommagé.'); return; }
    }
    const evs = (data.events || []).filter(validEvent);
    const days = (data.days || []).filter(validDay);
    const toWrite = [];
    let added = 0, updated = 0;
    // Ce qui est restauré est renvoyé au serveur ; une différence avec la version partagée devient un conflit à trancher.
    // Une approbation n'est jamais reprise d'un fichier : seule une approbation faite dans l'app compte.
    const mark = (o, cur) => { o.conflict = null; o.syncError = null; o.syncVersion = cur ? cur.syncVersion : o.syncVersion; o.rev = ((cur && cur.rev) || 0) + 1; o.dirty = !o.localOnly; if (o.kind === 'event') { o.approveRequest = null; o.approval = cur ? cur.approval || null : null; o.approvalVoid = false; if (cur && cur.originalText) o.originalText = cur.originalText; } if (cur && cur.comments && o.kind === 'event') { const ids = new Set((o.comments || []).map((c) => c.id)); o.comments = [...(o.comments || []), ...cur.comments.filter((c) => !ids.has(c.id))]; } };
    for (const e of evs) {
      const cur = S.events.get(e.id);
      if (!cur) { added++; mark(e, null); S.events.set(e.id, e); toWrite.push(e); }
      else if ((e.updatedAt || '') > (cur.updatedAt || '')) { updated++; mark(e, cur); S.events.set(e.id, e); toWrite.push(e); }
    }
    for (const d of days) {
      const cur = S.days.get(d.date);
      if (!cur || (d.updatedAt || '') > (cur.updatedAt || '')) { if (cur) d.id = cur.id; mark(d, cur); S.days.set(d.date, d); toWrite.push(d); if (cur) updated++; else added++; }
    }
    // Brouillons de la sauvegarde : ajoutés s'ils manquent (jamais envoyés au serveur)
    for (const d of (data.drafts || []).filter((x) => x && x.kind === 'draft' && /^draft-/.test(String(x.id)))) {
      const cur = S.drafts.get(d.id);
      if (!cur || (d.updatedAt || '') > (cur.updatedAt || '')) { S.drafts.set(d.id, d); toWrite.push(d); if (cur) updated++; else added++; }
    }
    const sealed = [];
    for (const o of toWrite) sealed.push(await seal(o));
    await recPut(sealed);
    render();
    scheduleSync();
    await ask({ title: 'Restauration terminée', text: `${added} élément(s) ajouté(s), ${updated} mis à jour. Rien n'a été effacé.`, ok: 'OK', cancel: null });
  }

  // ---------- Données fictives ----------
  async function addDemo() {
    const base = new Date(); const out = [];
    const mk = (daysAgo, time, type, intensity, note, extra = {}) => {
      const d = new Date(base); d.setDate(d.getDate() - daysAgo);
      if (d.getFullYear() < MIN_YEAR) return;
      out.push({ id: uid(), kind: 'event', date: ymd(d), time, type, intensity, note: '[Exemple] ' + note, author: daysAgo % 2 ? 'Papa' : 'Maman', createdAt: nowIso(), comments: [], localOnly: true, ...extra });
    };
    mk(0, '16:05', 'crise', 'orange', 'Refus de quitter le parc, cris environ 10 minutes.', { place: 'Parc', duration: '10', intervention: 'Laisser de l\'espace, puis accompagner' });
    mk(0, '18:30', 'reussite', null, 'A dit « je suis fâché » au lieu de lancer son jouet.');
    mk(1, '07:40', 'difficulte', 'jaune', 'Difficulté à s\'habiller, réglé avec le tableau de routine.', { description: 'Refus de mettre son manteau, 3 minutes.', place: 'Maison' });
    mk(2, '17:10', 'crise', 'rouge', 'Fin de l\'écran avant le souper.');
    mk(3, '15:30', 'beau_moment', null, 'A partagé ses blocs avec son cousin.');
    mk(4, '19:20', 'difficulte', null, 'Pleurs au coucher (intensité à préciser).');
    const daysOut = [];
    const setDay = (daysAgo, rating, belle = false) => { const d = new Date(base); d.setDate(d.getDate() - daysAgo); if (d.getFullYear() < MIN_YEAR) return; const day = getDay(ymd(d)); if (day.syncVersion != null || day.dirty) return; day.localOnly = true; day.rating = rating; day.belle = belle; day.updatedAt = nowIso(); day.version = (day.version || 0) + 1; S.days.set(day.date, day); daysOut.push(day); };
    setDay(1, 'jaune'); setDay(2, 'rouge'); setDay(3, 'vert', true); setDay(5, 'vert', true); setDay(6, 'jaune');
    out.forEach((e) => { e.updatedAt = e.createdAt; e.version = 1; S.events.set(e.id, e); });
    const sealed = [];
    for (const o of [...out, ...daysOut]) sealed.push(await seal(o));
    await recPut(sealed);
    S.view = 'calendar'; S.selected = today(); S.month = null; render(); window.scrollTo(0, 0);
    toast('Données fictives ajoutées');
  }

  // ---------- Connexion ----------
  function openLogin({ first = false } = {}) {
    return new Promise((resolve) => {
      const root = $('#modal-root');
      root.innerHTML = `<div class="modal-wrap" role="dialog" aria-modal="true" aria-labelledby="lTitle"><div class="modal">
        <h2 id="lTitle">Se connecter</h2>
        <p>Utilisez votre compte du journal (le même sur vos deux téléphones). Vous ne le ferez qu'une fois sur ce téléphone.</p>
        <label class="field"><span class="lbl">Courriel</span><input class="input" id="lEmail" type="email" autocomplete="username" inputmode="email" autocapitalize="off" spellcheck="false"></label>
        <label class="field"><span class="lbl">Mot de passe</span><input class="input" id="lPw" type="password" autocomplete="current-password"></label>
        <p class="small" id="lErr" role="alert" hidden></p>
        <div class="actions"><button type="button" class="btn quiet small" id="lLater">${first ? 'Plus tard' : 'Annuler'}</button><button type="button" class="btn small" id="lGo">Se connecter</button></div>
      </div></div>`;
      const err = (t) => { const e = $('#lErr'); e.textContent = t; e.hidden = !t; };
      setTimeout(() => $('#lEmail').focus(), 50);
      const done = async (ok) => {
        root.innerHTML = '';
        if (!ok) { if (first) { S.settings.loginLater = true; await saveSettings(); if (!S.settings.parent) askParent(); } render(); return resolve(false); }
        resolve(true);
      };
      $('#lLater').onclick = () => done(false);
      const go = async () => {
        const email = $('#lEmail').value.trim(); const pw = $('#lPw').value;
        if (!email || !pw) { err('Entrez votre courriel et votre mot de passe.'); return; }
        const btn = $('#lGo'); btn.disabled = true; btn.textContent = 'Connexion…'; err('');
        try {
          if (!client) setupSync();
          S.session = await client.signIn(email, pw);
        } catch (e) {
          btn.disabled = false; btn.textContent = 'Se connecter';
          err(e.kind === 'offline' ? 'Pas de connexion Internet. Réessayez quand le réseau revient.' : e.message || 'Connexion impossible.');
          return;
        }
        $('#lPw').value = '';
        S.loggedIn = true; S.settings.loginLater = false; await saveSettings();
        root.innerHTML = '';
        await afterLogin();
        resolve(true);
      };
      $('#lGo').onclick = go;
      $$('.input', root).forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }));
    });
  }
  async function afterLogin() {
    const local = neverShared();
    if (local.length) {
      const nEv = local.filter((r) => r.kind === 'event').length; const nDay = local.length - nEv;
      const parts = [nEv ? `${nEv} observation(s)` : '', nDay ? `${nDay} journée(s) notée(s)` : ''].filter(Boolean).join(' et ');
      const ok = await ask({ title: 'Partager ce qui est déjà dans ce téléphone ?', text: `${parts} de ce téléphone n'ont jamais été partagées. Voulez-vous les ajouter au journal commun, visible par les deux parents ? Les données fictives « [Exemple] » ne sont jamais envoyées.`, ok: 'Partager', cancel: 'Garder ici seulement' });
      if (!ok) { for (const r of local) { r.localOnly = true; r.dirty = false; await saveRecord(r); } }
    }
    startSyncLoop();
    render();
    await runSync({ manual: true });
    render();
  }

  // ---------- Conflits ----------
  function conflictRows(c) {
    const theirs = c.o.conflict.row;
    const mine = c.kind === 'event' ? JS.eventToRow(c.o) : JS.dayToRow(c.o);
    const cols = JS.diffCols(mine, theirs, c.kind === 'event' ? JS.ALL_EVENT_COLS : JS.DAY_COLS).filter((col) => !(col === 'categories' && mine.categories === undefined));
    const show = (col, v) => { if (col === 'categories') return (v || []).length ? v.map((k) => OR.CATEGORY_LABEL[k] || k).join(', ') : '(aucune)'; const t = JS.describe(col, v); return col === 'type' && TYPES[v] ? TYPES[v] : (col === 'intensity' || col === 'rating') && COLOR_LABEL[v] ? COLOR_LABEL[v] : t; };
    return cols.map((col) => `<tr><th scope="row">${esc(JS.FIELD_LABELS[col] || col)}</th><td>${esc(show(col, mine[col]))}</td><td>${esc(show(col, theirs[col]))}</td></tr>`).join('');
  }
  function openConflicts() {
    const list = conflicts();
    const root = $('#sheet-root');
    if (!list.length) { closeSheets(); render(); toast('Aucun conflit à résoudre'); return; }
    const names = (S.syncState && S.syncState.names) || {};
    root.innerHTML = `<div class="panel" role="dialog" aria-modal="true" aria-labelledby="cTitle"><div class="panel-inner">
      <div class="panel-head"><button type="button" class="icon-btn plain" data-cact="close" aria-label="Retour">${ico('left', 20)}</button><span class="title" id="cTitle">Choisir la version à garder</span></div>
      <p class="hint pad-hint">Ces fiches ont été modifiées sur les deux téléphones en même temps. Choisissez la version à garder : l'autre sera ajoutée en commentaire, rien n'est perdu.</p>
      ${list.map((c) => {
        const other = names[c.o.conflict.row.updated_by] || 'l\'autre parent';
        const title = c.kind === 'event' ? `${esc(evTitle(c.o))} · ${fmtLong(c.o.date)}` : `Journée du ${fmtLong(c.o.date)}`;
        return `<section class="card"><strong>${title}</strong>
          <div class="cmp-wrap"><table class="cmp"><thead><tr><th></th><th>Ce téléphone</th><th>${esc(other)}</th></tr></thead><tbody>${conflictRows(c) || '<tr><td colspan="3">Aucune différence visible.</td></tr>'}</tbody></table></div>
          <div class="row"><button type="button" class="btn small quiet" data-cact="mine" data-k="${c.kind}" data-id="${esc(c.id)}">Garder ce téléphone</button><button type="button" class="btn small" data-cact="theirs" data-k="${c.kind}" data-id="${esc(c.id)}">Garder ${esc(other)}</button></div></section>`;
      }).join('')}
    </div></div>`;
    $('.panel', root).addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-cact]');
      if (!b) return;
      if (b.dataset.cact === 'close') { closeSheets(); render(); return; }
      b.disabled = true;
      if (!engine) setupSync();
      if (b.dataset.k === 'event') await engine.resolveEvent(b.dataset.id, b.dataset.cact);
      else await engine.resolveDay(b.dataset.id, b.dataset.cact);
      renderNeeded = false;
      toast('Version choisie');
      scheduleSync(300);
      openConflicts();
    });
  }

  // ---------- Actions ----------
  async function handleAct(el, ev) {
    const act = el.dataset.act;
    switch (act) {
      case 'nav': closeSheets(); S.view = el.dataset.view; render(); view().focus(); window.scrollTo(0, 0); break;
      case 'quick': openQuick(el.dataset.date); break;
      case 'reload': await flushDraft(); location.reload(); break;
      case 'closeSheet': if (ev && el.classList.contains('overlay') && ev.target !== el) return; closeSheets(); break;
      case 'dictate': { const n = $('#qNote'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); break; }
      case 'month': {
        let { y, m } = S.month; m += Number(el.dataset.d);
        if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
        if (y < MIN_YEAR) return;
        S.month = { y, m }; render(); break;
      }
      case 'today': S.selected = today(); S.month = null; render(); break;
      case 'pick': S.selected = el.dataset.date; render(); break;
      case 'rate': {
        const day = getDay(S.selected); const c = el.dataset.c || null;
        day.rating = c; if (c !== 'vert') day.belle = false;
        await saveDay(day); render(); break;
      }
      case 'belle': {
        const day = getDay(S.selected); const prev = { rating: day.rating, belle: day.belle };
        if (day.belle) { day.belle = false; await saveDay(day); render(); toast('« Belle journée » retirée'); break; }
        day.rating = 'vert'; day.belle = true; await saveDay(day); render();
        toast('Belle journée enregistrée', { label: 'Annuler', run: async () => { const d2 = getDay(S.selected); Object.assign(d2, prev); await saveDay(d2); render(); } });
        break;
      }
      case 'open': openDetail(el.dataset.id); break;
      case 'jf': S.jFilter = el.dataset.f; render(); break;
      // Phase 5 : filtres combinables, statistiques, rapports
      case 'fl': {
        const f = filterOf(el.dataset.scope); const k = el.dataset.k; const v = el.dataset.v;
        f[k] = (f[k] || []).includes(v) ? f[k].filter((x) => x !== v) : [...(f[k] || []), v];
        render(); break;
      }
      case 'flApproval': S.jf.approval = el.dataset.v; render(); break;
      case 'flReset': {
        if (el.dataset.scope === 'r') S.rep.filter = ST.emptyFilter();
        else { S.jf = ST.emptyFilter(); S.jQuery = ''; }
        render(); break;
      }
      case 'jfOpen': S.jfOpen = !S.jfOpen; render(); break;
      case 'quickF': {
        const k = el.dataset.f; const on = quickOn(k);
        if (k === 'todo') S.jf.todo = !on;
        if (k === 'hard') S.jf.types = on ? [] : [...HARD_TYPES];
        if (k === 'pos') S.jf.types = on ? [] : ['reussite', 'beau_moment'];
        if (k === 'intense') S.jf.intensities = on ? [] : ['rouge'];
        render(); break;
      }
      case 'jToReport': {
        // Les filtres du Journal servent à choisir les observations du rapport (seulement les approuvées par défaut)
        S.rep.filter = { ...ST.emptyFilter(), ...JSON.parse(JSON.stringify(S.jf)), q: S.jQuery, from: '', to: '', approval: 'all', todo: false };
        if (S.jf.from || S.jf.to) { S.rep.preset = 'custom'; S.rep.from = S.jf.from || `${MIN_YEAR}-01-01`; S.rep.to = S.jf.to || today(); }
        S.rep.includeUnapproved = S.jf.approval === 'not_approved';
        S.view = 'reports'; render(); window.scrollTo(0, 0); toast('Filtres du Journal repris dans le rapport'); break;
      }
      case 'repFromJournal': {
        S.rep.filter = { ...ST.emptyFilter(), ...JSON.parse(JSON.stringify(S.jf)), q: S.jQuery, from: '', to: '', approval: 'all', todo: false };
        S.rep.filtersOpen = true; render(); toast('Filtres du Journal repris'); break;
      }
      case 'evoRange': S.evo.range = el.dataset.v; render(); break;
      case 'evoUnit': S.evo.unit = el.dataset.v; render(); break;
      case 'repKind': S.rep.kind = el.dataset.v; render(); break;
      case 'repPreset': {
        S.rep.preset = el.dataset.v;
        if (S.rep.preset === 'custom' && !S.rep.from) { const r = presetRange('4w'); S.rep.from = r.from; S.rep.to = r.to; }
        render(); break;
      }
      case 'repFilters': S.rep.filtersOpen = !S.rep.filtersOpen; render(); break;
      case 'repPreview': openReportPreview(); break;
      case 'parent': S.settings.parent = el.dataset.p; await saveSettings(); render(); break;
      case 'saveChild': S.settings.childName = $('#childName').value.trim().slice(0, 40); await saveSettings(); render(); toast('Prénom enregistré'); break;
      case 'lockNow': lock(); break;
      case 'changePin': await changePin(); break;
      case 'export': await doExport(el.dataset.mode); break;
      case 'restore': { const e = S.events.get(el.dataset.id); delete e.deletedAt; await saveEvent(e); render(); toast('Événement restauré'); break; }
      case 'purge': {
        if (!(await ask({ title: 'Effacer définitivement ?', text: 'Cette action est irréversible.', ok: 'Effacer', danger: true }))) return;
        S.events.delete(el.dataset.id); await recDelete([el.dataset.id]); render(); break;
      }
      case 'demo': await addDemo(); break;
      case 'resumeDraft': resumeDraft(el.dataset.id); break;
      case 'wipe': {
        const n = pendingCount();
        const nd = S.drafts.size;
        const v = await ask({ title: 'Effacer toutes les données ?', text: `Toutes les observations, le code et la clé de chiffrement de <strong>ce téléphone</strong> seront supprimés.${n ? ` <strong>Attention : ${n} élément(s) n'ont pas encore été envoyés et seraient perdus.</strong> Synchronisez ou faites une sauvegarde d'abord.` : S.loggedIn ? ' Ce qui est déjà synchronisé reste sur le serveur et reviendra à la prochaine connexion.' : ' Faites d\'abord une sauvegarde si nécessaire.'}${nd ? ` <strong>${nd} brouillon(s) non terminé(s) seraient aussi perdus</strong> (les brouillons ne sont jamais envoyés).` : ''}`, ok: 'Effacer', danger: true, input: { label: 'Tapez EFFACER pour confirmer', validate: (x) => (x.trim().toUpperCase() === 'EFFACER' ? null : 'Tapez EFFACER.') } });
        if (!v) return;
        stopSync(); await wipeAll(); location.reload(); break;
      }
      case 'login': await openLogin(); break;
      case 'logout': {
        const n = pendingCount();
        const ok = await ask({ title: 'Se déconnecter ?', text: n ? `${n} élément(s) ne sont pas encore envoyés. Ils restent dans ce téléphone et partiront à la prochaine connexion.` : 'Les observations restent dans ce téléphone. La synchronisation s\'arrête jusqu\'à la prochaine connexion.', ok: 'Se déconnecter' });
        if (!ok) return;
        try { await client.signOut(); } catch (e) { /* rien */ }
        S.loggedIn = false; S.session = null; S.settings.loginLater = true; await saveSettings(); S.sync = { status: 'idle', msg: '' };
        render(); toast('Déconnecté'); break;
      }
      case 'syncNow': await runSync({ manual: true }); render(); break;
      case 'conflicts': openConflicts(); break;
      default: break;
    }
  }
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || el.closest('.sheet') || el.closest('.panel')) return; // gérés par leur propre écouteur
    handleAct(el, ev);
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && $('#sheet-root').innerHTML) closeSheets(); });

  // ---------- Verrouillage ----------
  let lastActivity = Date.now();
  let hiddenAt = null;
  const LOCK_MS = 5 * 60 * 1000;
  ['pointerdown', 'keydown', 'input', 'scroll', 'touchstart'].forEach((t) => document.addEventListener(t, () => { lastActivity = Date.now(); }, { passive: true, capture: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (S.unlocked && hiddenAt && Date.now() - hiddenAt >= LOCK_MS) lock();
  });
  setInterval(() => { if (S.unlocked && Date.now() - lastActivity >= LOCK_MS) lock(); }, 10000);

  function lock() {
    flushDraft(); // le brouillon ouvert est écrit (chiffré) avant que la clé quitte la mémoire
    liveDraft = null;
    stopSync();
    S.unlocked = false; S.loggedIn = false; S.session = null; S.sync = { status: 'idle', msg: '' };
    DEK = null;
    S.events.clear(); S.days.clear(); S.drafts.clear(); S.settings = null; clearReport(); resetPhase5();
    closeSheets(); $('#modal-root').innerHTML = ''; $('#toast').hidden = true;
    view().innerHTML = '';
    $('#shell').hidden = true;
    applyTitles(false);
    showLock();
  }
  async function unlockWith() {
    DEK = await loadDek();
    await loadAll();
    S.unlocked = true; lastActivity = Date.now();
    $('#lock').hidden = true; $('#lock').innerHTML = '';
    $('#shell').hidden = false;
    S.view = 'calendar'; S.selected = today(); S.month = null; resetPhase5();
    setupSync();
    try { S.session = await client.getSession(); } catch (e) { S.session = null; }
    S.loggedIn = !!S.session;
    render();
    if (S.loggedIn) { startSyncLoop(); runSync(); if (S.settings.childName === undefined) askChild(); }
    else if (!S.settings.loginLater) openLogin({ first: true }).then((ok) => { if (ok && S.settings.childName === undefined) askChild(); });
    else if (!S.settings.parent) askParent(); else if (S.settings.childName === undefined) askChild();
  }
  async function askParent() {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-wrap" role="dialog" aria-modal="true"><div class="modal"><h2>Qui utilise ce téléphone ?</h2><p>Votre nom sera indiqué sur les observations que vous notez.</p>
      <div class="actions"><button type="button" class="btn" data-p="Papa">Papa</button><button type="button" class="btn" data-p="Maman">Maman</button></div></div></div>`;
    $$('[data-p]', root).forEach((b) => { b.onclick = async () => { S.settings.parent = b.dataset.p; await saveSettings(); root.innerHTML = ''; render(); if (S.settings.childName === undefined) askChild(); }; });
  }
  async function askChild() {
    const v = await ask({ title: 'Prénom de l\'enfant', text: 'Il sera affiché dans l\'application une fois déverrouillée. Il est enregistré chiffré dans ce téléphone et n\'apparaît jamais dans le code public. Vous pouvez le laisser vide.', ok: 'Enregistrer', cancel: 'Plus tard', input: { label: 'Prénom', validate: (x) => (x.trim().length > 40 ? '40 caractères au maximum.' : null) } });
    S.settings.childName = v === null ? '' : v.trim();
    await saveSettings(); render();
  }

  // Écran du code
  function pinPad({ title, msg, onDone, footer = '' }) {
    let val = '';
    const el = $('#lock');
    el.hidden = false;
    el.innerHTML = `<span class="logo">${ico('book', 36)}</span><h1>${NEUTRAL_TITLE}</h1>
      <p class="msg" id="pinMsg">${esc(msg)}</p>
      <div class="dots" aria-hidden="true">${'<span></span>'.repeat(4)}</div>
      <p class="sr" aria-live="polite" id="pinCount"></p>
      <div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => `<button type="button" class="key" data-k="${k}">${k}</button>`).join('')}<span class="key blank"></span><button type="button" class="key" data-k="0">0</button><button type="button" class="key back" data-k="del" aria-label="Effacer le dernier chiffre">${ico('back', 24)}</button></div>
      ${footer}`;
    el.setAttribute('aria-label', title);
    const paint = () => { const c = $('#pinCount'); if (!c) return; $$('.dots span', el).forEach((s, i) => s.classList.toggle('on', i < val.length)); c.textContent = `${val.length} chiffre(s) sur 4`; };
    const press = async (k) => {
      if (el.dataset.busy) return;
      if (k === 'del') val = val.slice(0, -1);
      else if (val.length < 4) val += k;
      paint();
      if (val.length === 4) { el.dataset.busy = '1'; const v = val; val = ''; try { await onDone(v); } finally { delete el.dataset.busy; paint(); } }
    };
    $$('[data-k]', el).forEach((b) => { b.onclick = () => press(b.dataset.k); });
    el.onkeydown = (e) => { if (/^[0-9]$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('del'); };
    paint();
    setTimeout(() => $('[data-k="1"]', el).focus(), 30);
  }
  const setMsg = (t, err = false) => { const m = $('#pinMsg'); if (m) { m.textContent = t; m.classList.toggle('err', err); } };

  async function showLock() {
    const lockMeta = await metaGet('lock');
    if (!lockMeta) return setupPin();
    pinPad({
      title: 'Déverrouillage', msg: 'Entrez votre code',
      footer: '<button type="button" class="linkish" id="forgot">Code oublié ?</button>',
      onDone: async (pin) => {
        const m = await metaGet('lock');
        const now = Date.now();
        if (m.until && now < m.until) { setMsg(`Trop d'essais. Réessayez dans ${Math.ceil((m.until - now) / 1000)} s.`, true); return; }
        const h = await pinHash(pin, m.salt, m.iter);
        if (sameBytes(h, m.hash)) { m.fails = 0; m.until = 0; await metaSet('lock', m); await unlockWith(); return; }
        m.fails = (m.fails || 0) + 1;
        if (m.fails >= 5) m.until = now + Math.min(15 * 60, 30 * 2 ** (m.fails - 5)) * 1000;
        await metaSet('lock', m);
        setMsg(m.fails >= 5 ? `Code incorrect. Attendez ${Math.round((m.until - now) / 1000)} s.` : 'Code incorrect.', true);
      },
    });
    $('#forgot').onclick = async () => {
      const v = await ask({ title: 'Code oublié', text: 'Le code protège les données de ce téléphone : sans lui, il faut les effacer. Vous pourrez ensuite vous reconnecter avec votre compte et retrouver tout ce qui a déjà été synchronisé. <strong>Ce qui n\'avait pas encore été envoyé (par exemple noté hors ligne) et les brouillons non terminés seraient perdus</strong> ; essayez d\'abord de vous souvenir du code.', ok: 'Effacer ce téléphone', danger: true, input: { label: 'Tapez EFFACER pour confirmer', validate: (x) => (x.trim().toUpperCase() === 'EFFACER' ? null : 'Tapez EFFACER.') } });
      if (v) { await wipeAll(); location.reload(); }
    };
  }
  function setupPin(onSaved) {
    let first = null;
    pinPad({
      title: 'Choix du code', msg: 'Choisissez un code à 4 chiffres',
      onDone: async (pin) => {
        if (!first) {
          if (/^(\d)\1{3}$/.test(pin) || ['1234', '4321', '0123', '9876'].includes(pin)) { setMsg('Code trop facile à deviner. Choisissez-en un autre.', true); return; }
          first = pin; setMsg('Entrez le même code une seconde fois'); return;
        }
        if (pin !== first) { first = null; setMsg('Les codes ne correspondent pas. Recommencez.', true); return; }
        const salt = crypto.getRandomValues(new Uint8Array(16));
        await metaSet('lock', { salt, hash: await pinHash(pin, salt, PIN_ITER), iter: PIN_ITER, fails: 0, until: 0, createdAt: nowIso() });
        if (onSaved) onSaved(); else await unlockWith();
      },
    });
  }
  async function changePin() {
    const ok = await ask({ title: 'Changer le code', text: 'Vous allez choisir un nouveau code à 4 chiffres.', ok: 'Continuer' });
    if (!ok) return;
    $('#shell').hidden = true;
    setupPin(() => { $('#lock').hidden = true; $('#lock').innerHTML = ''; $('#shell').hidden = false; render(); toast('Nouveau code enregistré'); });
  }

  // ---------- Démarrage ----------
  async function start() {
    if (!window.crypto || !crypto.subtle || !window.indexedDB) {
      document.body.innerHTML = '<p>Ce navigateur ne permet pas de protéger les données. Utilisez Chrome à jour.</p>';
      return;
    }
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* facultatif */ }
    if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.__JM_PREVIEW__) {
      try { await navigator.serviceWorker.register('sw.js'); } catch (e) { /* hors ligne indisponible */ }
    }
    // Mise à jour en cours : si le navigateur a mélangé d'anciens et de nouveaux fichiers,
    // l'app ne démarre pas (aucune lecture ni écriture des données) et propose de recharger.
    if (!JS || JS.VERSION !== APP_VERSION || !OR || OR.VERSION !== APP_VERSION || !ST || ST.VERSION !== APP_VERSION || !RP || RP.VERSION !== APP_VERSION) {
      document.body.innerHTML = '<main class="lock"><section class="card"><h1>Mise à jour en cours</h1>'
        + '<p>Une nouvelle version du journal s\'installe. Vos observations restent dans ce téléphone, rien n\'est effacé.</p>'
        + '<button type="button" class="btn block" id="jmReload">Recharger</button></section></main>';
      document.getElementById('jmReload').addEventListener('click', () => location.reload());
      return;
    }
    await showLock();
  }
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') window.__JM_TEST__ = { lock, expireLock: () => { lastActivity = 0; } };
  start();
})();
