/* Journal familial — synchronisation avec Supabase (phases 3 et 4)
 * Aucune bibliothèque externe : appels HTTPS directs à l'API Supabase (Auth + PostgREST).
 * Principe : tout est d'abord enregistré (chiffré) dans le téléphone, marqué « en attente »,
 * puis envoyé. Rien n'est effacé ni écrasé en silence : un désaccord devient un « conflit »
 * que les parents tranchent, et la version non retenue est gardée en commentaire.
 * Ce fichier fonctionne aussi dans Node (tests automatiques).
 */
(function (root) {
  'use strict';

  // ---------- Correspondance téléphone <-> serveur ----------
  const TEXT_FIELDS = [['note', 'note'], ['place', 'place'], ['people', 'people'], ['stateBefore', 'state_before'], ['context', 'context'], ['description', 'description'], ['adultReaction', 'adult_reaction'], ['intervention', 'intervention'], ['childReaction', 'child_reaction'], ['helped', 'helped'], ['extra', 'extra']];
  // Phase 4 (script SQL 04) : envoyés seulement pour les fiches qui les utilisent, pour rester compatible
  const STRUCT_TEXT = [['outcome', 'outcome'], ['impressions', 'impressions'], ['originalText', 'original_text']];
  const NUM_FIELDS = [['duration', 'duration_min'], ['calmTime', 'calm_time_min']];
  const CATEGORY_ORDER = ['emotions', 'comportements', 'social', 'autonomie', 'communication', 'sommeil', 'apprentissages', 'reussites'];
  const FIELD_LABELS = { date: 'Date', time: 'Heure', type: 'Type', intensity: 'Intensité', note: 'Note', place: 'Endroit', people: 'Personnes présentes', state_before: 'État avant', context: 'Contexte', description: 'Ce qui s\'est passé', adult_reaction: 'Réaction des adultes', intervention: 'Intervention du parent', child_reaction: "Réaction de l'enfant", helped: 'Ce qui a aidé', extra: 'Notes supplémentaires', duration_min: 'Durée (min)', calm_time_min: 'Retour au calme (min)', marked_complete: 'Fiche complète', deleted_at: 'Dans la corbeille', rating: 'Couleur', belle: 'Belle journée', outcome: 'Résultat observé', impressions: 'Impressions du parent', original_text: 'Texte original', categories: 'Catégories', approved_at: 'Approuvée' };
  const EVENT_COLS = ['date', 'time', 'type', 'intensity', 'marked_complete', 'deleted_at', ...TEXT_FIELDS.map((f) => f[1]), ...NUM_FIELDS.map((f) => f[1])];
  const STRUCT_COLS = [...STRUCT_TEXT.map((f) => f[1]), 'categories']; // l'approbation est gérée à part (serveur)
  const ALL_EVENT_COLS = [...EVENT_COLS, ...STRUCT_COLS];
  const DAY_COLS = ['rating', 'belle'];
  const str = (v) => (v == null ? '' : String(v)).trim();
  const cleanCats = (a) => CATEGORY_ORDER.filter((c) => Array.isArray(a) && a.includes(c)); // ordre fixe, sans doublon

  // Une fiche « structurée » utilise les colonnes de la phase 4
  const usesStructure = (e) => !!(e.hasStructure || e.approveRequest || (e.approval && e.approval.at) || str(e.outcome) || str(e.impressions) || str(e.originalText) || (e.categories && e.categories.length));

  function eventToRow(e) {
    const r = { id: e.id, date: e.date, time: e.time ? String(e.time).slice(0, 5) : null, type: e.type || null, intensity: e.intensity || null, marked_complete: !!e.markedComplete, deleted_at: e.deletedAt || null };
    for (const [k, c] of TEXT_FIELDS) { const v = str(e[k]); r[c] = v === '' ? null : v; }
    for (const [k, c] of NUM_FIELDS) { const v = str(e[k]); r[c] = v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)); }
    if (usesStructure(e)) {
      for (const [k, c] of STRUCT_TEXT) { const v = k === 'originalText' ? String(e[k] || '') : str(e[k]); r[c] = v.trim() === '' ? null : v; } // l'original est envoyé tel quel
      r.categories = cleanCats(e.categories);
    }
    // L'approbation n'est jamais envoyée avec le contenu : voir pushEvent (deuxième requête, séparée)
    return r;
  }
  function rowToEvent(row, names, prev) {
    const e = {
      id: row.id, kind: 'event', date: row.date, time: row.time ? String(row.time).slice(0, 5) : '',
      type: row.type || null, intensity: row.intensity || null, markedComplete: !!row.marked_complete,
      authorId: row.author_id || null, author: (names && names[row.author_id]) || (prev && prev.author) || '',
      createdAt: row.created_at, updatedAt: row.updated_at, updatedBy: (names && names[row.updated_by]) || '', updatedById: row.updated_by || null,
      version: row.version, syncVersion: row.version, dirty: false, rev: (prev && prev.rev) || 0,
      comments: (prev && prev.comments) || [],
    };
    for (const [k, c] of TEXT_FIELDS) e[k] = row[c] == null ? '' : row[c];
    for (const [k, c] of NUM_FIELDS) e[k] = row[c] == null ? '' : String(row[c]);
    for (const [k, c] of STRUCT_TEXT) e[k] = row[c] == null ? '' : row[c];
    e.categories = cleanCats(row.categories);
    e.approval = rowApproval(row, names);
    e.hasStructure = usesStructure(e);
    if (row.deleted_at) e.deletedAt = row.deleted_at;
    return e;
  }
  const rowApproval = (row, names) => (row.approved_at ? { at: row.approved_at, byId: row.approved_by || null, by: (names && names[row.approved_by]) || '' } : null);
  function dayToRow(d) { return { date: d.date, rating: d.rating || null, belle: !!d.belle }; }
  function rowToDay(row, names, prev) {
    return { id: (prev && prev.id) || 'day-' + row.date, kind: 'day', date: row.date, rating: row.rating || null, belle: !!row.belle, createdAt: row.created_at, updatedAt: row.updated_at, updatedBy: (names && names[row.updated_by]) || '', version: row.version, syncVersion: row.version, dirty: false, rev: (prev && prev.rev) || 0 };
  }
  // Valeur comparable d'une colonne (le serveur renvoie « 16:05:00 », un horodatage précis, etc.)
  function norm(col, v) {
    if (col === 'deleted_at' || col === 'approved_at') return !!v; // la date exacte est fixée par le serveur
    if (col === 'categories') { const c = cleanCats(v); return c.length ? c.join(',') : null; }
    if (col === 'time') return v ? String(v).slice(0, 5) : null;
    if (col === 'marked_complete' || col === 'belle') return !!v;
    if (v === '' || v === undefined) return null;
    return v;
  }
  function diffCols(a, b, cols) { return cols.filter((c) => norm(c, a[c]) !== norm(c, b[c])); }
  // Colonnes à comparer : celles de la phase 4 seulement si la fiche locale ou celle du serveur les utilise
  const eventCols = (a, b) => (STRUCT_COLS.some((c) => norm(c, a[c]) !== null && norm(c, a[c]) !== false) || STRUCT_COLS.some((c) => norm(c, b[c]) !== null && norm(c, b[c]) !== false) ? ALL_EVENT_COLS : EVENT_COLS);
  const sameEvent = (local, row) => { const mine = eventToRow(local); return diffCols(mine, row, eventCols(mine, row)).length === 0; };
  const sameDay = (local, row) => diffCols(dayToRow(local), row, DAY_COLS).length === 0;

  function describe(col, v) {
    v = norm(col, v);
    if (v === null || v === false) return col === 'deleted_at' || col === 'approved_at' ? 'non' : '(vide)';
    if (v === true) return 'oui';
    return String(v);
  }
  // Résumé lisible de la version non retenue, gardée en commentaire pour ne rien perdre
  function summarize(fromRow, otherRow, cols) {
    return diffCols(fromRow, otherRow, cols).map((c) => `${FIELD_LABELS[c] || c} : ${describe(c, fromRow[c])}`).join(' · ');
  }

  const isPending = (r) => !!r && !r.localOnly && (!!r.dirty || r.syncVersion == null);

  // ---------- Erreurs ----------
  class SyncError extends Error {
    constructor(kind, message, status) { super(message); this.kind = kind; this.status = status; }
  }
  function httpMessage(res) {
    const d = res.data || {};
    if (res.status === 401 || res.status === 403) return 'Accès refusé par le serveur.';
    if (d.code === '23514') return 'Le serveur refuse cette fiche (valeur invalide ou fiche vide).';
    return d.message || d.msg || d.error_description || `Erreur du serveur (${res.status}).`;
  }

  // ---------- Client HTTPS (Auth + REST) ----------
  function createClient({ url, key, fetchFn, loadSession, saveSession, now = () => Date.now() }) {
    const f = fetchFn || ((...a) => root.fetch(...a));
    let session = null;
    let refreshing = null;

    async function raw(method, path, body, headers = {}, token) {
      let res;
      try {
        res = await f(url + path, { method, headers: { apikey: key, Authorization: `Bearer ${token || key}`, 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
      } catch (e) { throw new SyncError('offline', 'Pas de connexion Internet.'); }
      const txt = await res.text();
      let data = null;
      try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
      return { ok: res.ok, status: res.status, data };
    }
    function store(data) {
      session = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: now() + (data.expires_in || 3600) * 1000, user: { id: data.user && data.user.id, email: data.user && data.user.email } };
      return saveSession(session).then(() => session);
    }
    async function getSession() { if (!session) session = (await loadSession()) || null; return session; }
    async function refresh() {
      if (refreshing) return refreshing;
      refreshing = (async () => {
        const s = await getSession();
        if (!s || !s.refresh_token) throw new SyncError('auth', 'Connexion requise.');
        const res = await raw('POST', '/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refresh_token });
        if (res.ok) return store(res.data);
        if (res.status >= 400 && res.status < 500) { session = null; await saveSession(null); throw new SyncError('auth', 'La connexion a expiré. Reconnectez-vous.'); }
        throw new SyncError('http', httpMessage(res), res.status);
      })();
      try { return await refreshing; } finally { refreshing = null; }
    }
    async function request(method, path, body, headers) {
      let s = await getSession();
      if (!s) throw new SyncError('auth', 'Connexion requise.');
      if (!s.expires_at || s.expires_at - 60000 < now()) s = await refresh();
      let res = await raw(method, path, body, headers, s.access_token);
      if (res.status === 401) { s = await refresh(); res = await raw(method, path, body, headers, s.access_token); }
      return res;
    }
    async function signIn(email, password) {
      const res = await raw('POST', '/auth/v1/token?grant_type=password', { email: String(email).trim(), password });
      if (!res.ok) {
        const code = res.data && (res.data.error_code || res.data.error);
        if (res.status === 400 && /invalid/.test(String(code || res.data && res.data.msg))) throw new SyncError('credentials', 'Courriel ou mot de passe incorrect.');
        if (res.status === 429) throw new SyncError('http', 'Trop d\'essais. Patientez quelques minutes.', 429);
        throw new SyncError('http', httpMessage(res), res.status);
      }
      return store(res.data);
    }
    async function signOut() {
      const s = await getSession();
      if (s) { try { await raw('POST', '/auth/v1/logout', {}, {}, s.access_token); } catch (e) { /* hors ligne : on oublie quand même la session */ } }
      session = null; await saveSession(null);
    }
    function forget() { session = null; }
    return { request, signIn, signOut, getSession, forget };
  }

  // ---------- Moteur de synchronisation ----------
  /* store : { events(), getEvent(id), putEvent(e), removeEvent(id), days(), getDay(date), putDay(d),
   *           getState(), setState(s), names, myName(), uid(), now() } */
  function createEngine({ client, store }) {
    const enc = encodeURIComponent;
    const REP = { Prefer: 'return=representation' };
    let running = null;
    let again = false;

    // -- Version de départ (script SQL 05) --
    // Chaque modification envoie base_version = la version sur laquelle elle s'appuie, en plus du
    // filtre « version=eq.N » de l'adresse. Le serveur refuse une base périmée (code JFV02).
    // SEUL cas où l'on renvoie sans base_version : le serveur répond que la colonne n'existe pas
    // encore (script 05 pas installé, erreur PGRST204 qui nomme « base_version »). Dans ce cas le
    // serveur n'a pas non plus la vérification : rien n'est contourné. Un refus de version (JFV01,
    // JFV02), un conflit ou toute autre erreur n'est JAMAIS renvoyé sans base_version.
    const baseMissing = {}; // table -> true quand la colonne est absente (revérifié à chaque synchronisation)
    const noBaseColumn = (res) => res.status === 400 && res.data && res.data.code === 'PGRST204'
      && /'base_version'/.test(String(res.data.message || ''));
    async function patchWithBase(table, path, body, baseVersion) {
      if (!baseMissing[table]) {
        const res = await client.request('PATCH', path, { ...body, base_version: baseVersion }, REP);
        if (!noBaseColumn(res)) return res;
        baseMissing[table] = true;
      }
      return client.request('PATCH', path, body, REP);
    }
    const isStale = (res) => res.status === 400 && res.data && res.data.code === 'JFV02';
    const needsUpdate = (res) => res.status === 400 && res.data && res.data.code === 'JFV01';
    // Réponse « rien n'a été écrit parce que la fiche a changé » : 0 ligne (filtre d'adresse) ou refus JFV02
    const unchangedBecauseNewer = (res) => (res.ok && Array.isArray(res.data) && res.data.length === 0) || isStale(res);
    let updateRequired = false;

    function isOld(iso, days) { return iso && Date.parse(iso) < store.now() - days * 864e5; }
    async function fetchOne(table, col, val) {
      const res = await client.request('GET', `/rest/v1/${table}?${col}=eq.${enc(val)}&select=*`);
      if (!res.ok) throw new SyncError('http', httpMessage(res), res.status);
      return res.data[0] || null;
    }

    // -- Événements --
    async function adoptEvent(local, row, rev, sent) {
      if ((local.rev || 0) !== rev) { // modifié pendant l'envoi : on garde la saisie, renvoi au prochain tour
        local.syncVersion = row.version; local.syncError = null;
        local.approval = rowApproval(row, store.names); // l'approbation connue du serveur
        await store.putEvent(local); again = true; return;
      }
      const e = rowToEvent(row, store.names, local);
      await store.putEvent(e);
    }
    async function markEventConflict(local, row) {
      local.conflict = { row, at: new Date(store.now()).toISOString() }; local.syncError = null;
      await store.putEvent(local);
    }
    // Étape 1 : le contenu. Renvoie la ligne du serveur quand elle correspond à la fiche locale,
    // sinon null (conflit ou erreur, déjà enregistrés dans la fiche).
    async function pushContent(e) {
      const row = eventToRow(e);
      let res;
      if (e.syncVersion == null) {
        res = await client.request('POST', '/rest/v1/events', row, REP);
        if (res.status === 409) { // déjà reçu (réponse perdue en route) ou identifiant déjà utilisé
          const srv = await fetchOne('events', 'id', e.id);
          if (srv && sameEvent(e, srv)) return srv;
          if (srv) { await markEventConflict(e, srv); return null; }
        }
      } else {
        res = await patchWithBase('events', `/rest/v1/events?id=eq.${enc(e.id)}&version=eq.${e.syncVersion}`, row, e.syncVersion);
        if (unchangedBecauseNewer(res)) {
          const srv = await fetchOne('events', 'id', e.id);
          if (!srv) { e.syncVersion = null; await store.putEvent(e); return pushContent(e); } // effacé ailleurs : on le renvoie plutôt que de le perdre
          if (sameEvent(e, srv)) return srv;
          await markEventConflict(e, srv); return null;
        }
      }
      if (!res.ok) { if (needsUpdate(res)) updateRequired = true; e.syncError = httpMessage(res); await store.putEvent(e); return null; }
      return res.data[0];
    }
    async function pushEvent(e) {
      const rev = e.rev || 0;
      const srv = await pushContent(e);
      if (!srv) return;
      if (!e.approveRequest) return adoptEvent(e, srv, rev);
      // Fiche modifiée pendant l'envoi : l'approbation portait sur l'ancien contenu, elle est à refaire
      if ((e.rev || 0) !== rev) { e.approveRequest = null; e.approvalVoid = true; return adoptEvent(e, srv, rev); }
      // Déjà approuvée par ce parent pour ce même contenu (réponse perdue lors d'un essai précédent) : rien à refaire
      const s = await client.getSession();
      if (srv.approved_at && s && s.user && srv.approved_by === s.user.id) return adoptEvent(e, srv, rev);
      // Étape 2 : l'approbation, SEULE, sur la version exacte qui vient d'être enregistrée (script SQL 04 v5)
      const res = await patchWithBase('events', `/rest/v1/events?id=eq.${enc(e.id)}&version=eq.${srv.version}`, { approval_version: srv.version }, srv.version);
      if (res.ok && Array.isArray(res.data) && res.data.length) return adoptEvent(e, res.data[0], rev);
      e.syncVersion = srv.version;
      if (unchangedBecauseNewer(res)) { // la fiche a changé sur l'autre téléphone entre les deux étapes
        const cur = await fetchOne('events', 'id', e.id);
        if (cur && sameEvent(e, cur)) { e.syncVersion = cur.version; await store.putEvent(e); again = true; return; } // même contenu : nouvel essai
        if (cur) return markEventConflict(e, cur);
        return store.putEvent(e);
      }
      if (needsUpdate(res)) updateRequired = true;
      e.syncError = httpMessage(res); await store.putEvent(e); // la demande reste, rien n'est perdu
    }

    // -- Journées --
    async function adoptDay(local, row, rev) {
      if ((local.rev || 0) !== rev) { local.syncVersion = row.version; local.syncError = null; await store.putDay(local); again = true; return; }
      await store.putDay(rowToDay(row, store.names, local));
    }
    async function markDayConflict(local, row) { local.conflict = { row, at: new Date(store.now()).toISOString() }; local.syncError = null; await store.putDay(local); }
    async function pushDay(d) {
      const rev = d.rev || 0;
      const row = dayToRow(d);
      let res;
      if (d.syncVersion == null) {
        res = await client.request('POST', '/rest/v1/days', row, REP);
        if (res.status === 409) {
          const srv = await fetchOne('days', 'date', d.date);
          if (srv && sameDay(d, srv)) return adoptDay(d, srv, rev);
          if (srv) return markDayConflict(d, srv);
        }
      } else {
        res = await patchWithBase('days', `/rest/v1/days?date=eq.${enc(d.date)}&version=eq.${d.syncVersion}`, row, d.syncVersion);
        if (unchangedBecauseNewer(res)) {
          const srv = await fetchOne('days', 'date', d.date);
          if (!srv) { d.syncVersion = null; await store.putDay(d); return pushDay(d); }
          if (sameDay(d, srv)) return adoptDay(d, srv, rev);
          return markDayConflict(d, srv);
        }
      }
      if (!res.ok) { if (needsUpdate(res)) updateRequired = true; d.syncError = httpMessage(res); await store.putDay(d); return; }
      return adoptDay(d, res.data[0], rev);
    }

    // -- Commentaires (ajoutés, jamais modifiés) --
    async function pushComments(e) {
      if (e.localOnly || e.syncVersion == null) return; // l'événement doit exister sur le serveur d'abord
      let changed = false;
      for (const c of e.comments || []) {
        if (!c.pending) continue;
        if (!c.id) c.id = store.uid();
        const res = await client.request('POST', '/rest/v1/comments', { id: c.id, event_id: e.id, text: c.text }, REP);
        if (res.ok) { const r = res.data[0]; c.pending = false; c.error = null; c.at = r.created_at; c.authorId = r.author_id; c.author = store.names[r.author_id] || c.author; }
        else if (res.status === 409) { c.pending = false; c.error = null; }
        else c.error = httpMessage(res);
        changed = true;
      }
      if (changed) await store.putEvent(e);
    }

    async function pushAll() {
      for (const e of [...store.events()]) if (isPending(e) && !e.conflict) await pushEvent(e);
      for (const d of [...store.days()]) if (isPending(d) && !d.conflict) await pushDay(d);
      for (const e of [...store.events()]) if ((e.comments || []).some((c) => c.pending)) await pushComments(store.getEvent(e.id));
    }

    // -- Réception --
    async function pageAll(path) {
      const out = [];
      for (let offset = 0; ; offset += 500) {
        const res = await client.request('GET', `${path}&limit=500&offset=${offset}`);
        if (!res.ok) throw new SyncError('http', httpMessage(res), res.status);
        out.push(...res.data);
        if (res.data.length < 500) return out;
      }
    }
    const since = (cursor) => enc(cursor ? new Date(Date.parse(cursor) - 120000).toISOString() : '1970-01-01T00:00:00Z');
    const maxIso = (a, b) => (!a || (b && Date.parse(b) > Date.parse(a)) ? b : a);

    async function mergeEventRow(row) {
      const local = store.getEvent(row.id);
      if (!local) return store.putEvent(rowToEvent(row, store.names, null));
      if (local.conflict) { if (row.version > local.conflict.row.version) { local.conflict.row = row; await store.putEvent(local); } return; }
      if (local.syncVersion != null && row.version <= local.syncVersion) return;
      if (isPending(local)) return sameEvent(local, row) ? adoptEvent(local, row, local.rev || 0) : markEventConflict(local, row);
      return store.putEvent(rowToEvent(row, store.names, local));
    }
    async function mergeDayRow(row) {
      const local = store.getDay(row.date);
      if (!local) return store.putDay(rowToDay(row, store.names, null));
      if (local.conflict) { if (row.version > local.conflict.row.version) { local.conflict.row = row; await store.putDay(local); } return; }
      if (local.syncVersion != null && row.version <= local.syncVersion) return;
      if (isPending(local)) return sameDay(local, row) ? adoptDay(local, row, local.rev || 0) : markDayConflict(local, row);
      return store.putDay(rowToDay(row, store.names, local));
    }

    async function pullAll() {
      const st = { ...store.getState() };
      const res = await client.request('GET', '/rest/v1/parents?select=user_id,display_name');
      if (!res.ok) throw new SyncError('http', httpMessage(res), res.status);
      if (!res.data.length) throw new SyncError('denied', 'Ce compte n\'est pas autorisé dans le journal.');
      const names = {};
      res.data.forEach((p) => { names[p.user_id] = p.display_name; });
      store.names = names;

      const evRows = await pageAll(`/rest/v1/events?select=*&updated_at=gte.${since(st.evCursor)}&order=updated_at.asc,id.asc`);
      for (const r of evRows) { await mergeEventRow(r); st.evCursor = maxIso(st.evCursor, r.updated_at); }
      const dayRows = await pageAll(`/rest/v1/days?select=*&updated_at=gte.${since(st.dayCursor)}&order=updated_at.asc,date.asc`);
      for (const r of dayRows) { await mergeDayRow(r); st.dayCursor = maxIso(st.dayCursor, r.updated_at); }
      const cmRows = await pageAll(`/rest/v1/comments?select=*&created_at=gte.${since(st.cmCursor)}&order=created_at.asc,id.asc`);
      let orphanAt = null;
      const touched = new Map();
      for (const r of cmRows) {
        const e = touched.get(r.event_id) || store.getEvent(r.event_id);
        if (!e) { orphanAt = orphanAt || r.created_at; continue; }
        const list = e.comments || (e.comments = []);
        const ex = list.find((c) => c.id === r.id);
        if (ex) { if (ex.pending) { ex.pending = false; ex.error = null; ex.at = r.created_at; touched.set(e.id, e); } }
        else { list.push({ id: r.id, authorId: r.author_id, author: names[r.author_id] || '', text: r.text, at: r.created_at }); list.sort((a, b) => String(a.at).localeCompare(String(b.at))); touched.set(e.id, e); }
        if (!orphanAt) st.cmCursor = maxIso(st.cmCursor, r.created_at);
      }
      for (const e of touched.values()) await store.putEvent(e);
      st.lastSync = new Date(store.now()).toISOString();
      await store.setState(st);
    }

    // -- Corbeille : effacement définitif après 30 jours (le serveur vérifie aussi) --
    async function purgeOld(days) {
      for (const e of [...store.events()]) {
        if (!e.deletedAt || !isOld(e.deletedAt, days) || isPending(e) || e.conflict) continue;
        const res = await client.request('DELETE', `/rest/v1/events?id=eq.${enc(e.id)}`, undefined, REP);
        if (!res.ok) continue;
        if (res.data.length || !(await fetchOne('events', 'id', e.id))) await store.removeEvent(e.id);
      }
    }

    async function sync({ trashDays = 30 } = {}) {
      if (running) { again = true; return running; }
      running = (async () => {
        try {
          let rounds = 0;
          for (const k of Object.keys(baseMissing)) delete baseMissing[k]; // le script 05 a pu être installé depuis
          updateRequired = false;
          do { again = false; await pushAll(); await pullAll(); rounds++; } while (again && rounds < 3);
          await purgeOld(trashDays);
        } finally { running = null; }
      })();
      return running;
    }

    // -- Résolution d'un conflit par un parent --
    async function resolveEvent(id, choice) {
      const e = store.getEvent(id);
      if (!e || !e.conflict) return;
      const theirs = e.conflict.row;
      const mineRow = eventToRow(e);
      const who = store.myName() || 'ce téléphone';
      const otherWho = store.names[theirs.updated_by] || 'l\'autre parent';
      const comment = (text) => ({ id: store.uid(), author: store.myName(), text, at: new Date(store.now()).toISOString(), pending: true });
      if (choice === 'mine') {
        const lost = summarize(theirs, mineRow, ALL_EVENT_COLS);
        e.syncVersion = theirs.version; e.conflict = null; e.dirty = true; e.rev = (e.rev || 0) + 1;
        if (lost) e.comments = [...(e.comments || []), comment(`[Version non retenue, de ${otherWho}] ${lost}`)];
        // Le texte original du serveur est verrouillé : on le garde, et le nôtre (s'il diffère) va en commentaire
        if (theirs.original_text != null && String(e.originalText || '') !== theirs.original_text) {
          if (str(e.originalText)) e.comments = [...e.comments, comment(`[Texte original de ${who}, non retenu] ${e.originalText}`)];
          e.originalText = theirs.original_text;
        }
        e.approval = rowApproval(theirs, store.names);
        // Une approbation donnée avant de voir la version de l'autre parent n'est pas réutilisée : à refaire après relecture
        e.approveRequest = null; e.approvalVoid = true;
        await store.putEvent(e);
      } else {
        const lost = summarize(mineRow, theirs, ALL_EVENT_COLS);
        const n = rowToEvent(theirs, store.names, e);
        n.rev = (e.rev || 0) + 1;
        if (lost) n.comments = [...(e.comments || []), comment(`[Version non retenue, de ${who}] ${lost}`)];
        await store.putEvent(n);
      }
    }
    async function resolveDay(date, choice) {
      const d = store.getDay(date);
      if (!d || !d.conflict) return;
      const theirs = d.conflict.row;
      if (choice === 'mine') { d.syncVersion = theirs.version; d.conflict = null; d.dirty = true; d.rev = (d.rev || 0) + 1; await store.putDay(d); }
      else { const n = rowToDay(theirs, store.names, d); n.rev = (d.rev || 0) + 1; await store.putDay(n); }
    }

    return { sync, resolveEvent, resolveDay, isRunning: () => !!running, needsUpdate: () => updateRequired };
  }

  const api = { VERSION: '0.5.0', createClient, createEngine, eventToRow, rowToEvent, dayToRow, rowToDay, sameEvent, sameDay, summarize, diffCols, isPending, usesStructure, SyncError, EVENT_COLS, ALL_EVENT_COLS, STRUCT_COLS, CATEGORY_ORDER, DAY_COLS, FIELD_LABELS, describe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JFSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
