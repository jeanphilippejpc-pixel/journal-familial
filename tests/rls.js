/* Tests réels des règles RLS (données fictives « [TEST RLS] », date 2099-12-31). */
(() => {
  'use strict';
  const { url, key, mock } = window.JF_CONFIG;
  const TEST_DATE = '2099-12-31';
  const $ = (s) => document.querySelector(s);
  $('#target').textContent = mock ? 'Cible : faux serveur local (essai).' : 'Cible : votre projet Supabase « Journal-Familial ».';

  async function call(method, path, { token, body, prefer = true, extra = {} } = {}) {
    const headers = { apikey: key, Authorization: `Bearer ${token || key}`, 'Content-Type': 'application/json', ...extra };
    if (prefer && method !== 'GET') headers.Prefer = 'return=representation';
    let res;
    try { res = await fetch(url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' }); }
    catch (e) { return { ok: false, status: 0, data: null, net: true }; }
    const txt = await res.text(); let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
    return { ok: res.ok, status: res.status, data };
  }
  async function login(email, password) {
    const r = await call('POST', '/auth/v1/token?grant_type=password', { body: { email: email.trim(), password }, prefer: false });
    if (!r.ok) throw new Error(r.status === 400 ? 'Courriel ou mot de passe incorrect.' : `Connexion impossible (${r.status}).`);
    return r.data;
  }
  async function logout(token) { await call('POST', '/auth/v1/logout', { token, body: {}, prefer: false }); }

  function runner(out) {
    out.innerHTML = '';
    let n = 0, ok = 0;
    const add = (name, pass, detail = '') => {
      n++; if (pass) ok++;
      const li = document.createElement('li'); li.className = pass ? 'ok' : 'ko';
      li.innerHTML = '<b></b><span></span>'; li.firstChild.textContent = pass ? 'OK' : 'ÉCHEC';
      li.lastChild.textContent = name + (!pass && detail ? ` — ${detail}` : '');
      out.appendChild(li);
    };
    const end = () => { const li = document.createElement('li'); li.className = ok === n ? 'ok sum' : 'ko sum'; li.textContent = `${ok} / ${n} tests réussis`; out.appendChild(li); };
    return { add, end };
  }
  const denied = (r) => !r.ok && r.status >= 400 && r.status < 500;
  const show = (r) => `HTTP ${r.status}${r.data && r.data.message ? ' ' + r.data.message : ''}`;
  const uuid = () => crypto.randomUUID();
  // Script 05 : chaque modification indique la version sur laquelle elle s'appuie (comme l'app 0.4.1)
  async function versionOf(path, token) {
    const r = await call('GET', path.replace(/&version=eq.d+/, '') + '&select=version', { token });
    return r.ok && r.data && r.data[0] ? r.data[0].version : null;
  }
  async function patchB(path, token, body) { return call('PATCH', path, { token, body: { ...body, base_version: await versionOf(path, token) } }); }

  function button(id, fn) {
    const b = $(id);
    b.onclick = async () => { b.disabled = true; try { await fn(); } catch (e) { alert(e.message); } finally { b.disabled = false; } };
  }

  // ---------- 1. Anonyme ----------
  button('#runAnon', async () => {
    const t = runner($('#outAnon'));
    for (const table of ['parents', 'days', 'events', 'comments']) {
      const r = await call('GET', `/rest/v1/${table}?select=*&limit=1`);
      t.add(`Lecture de « ${table} » refusée`, denied(r), show(r));
    }
    const r1 = await call('POST', '/rest/v1/events', { body: { id: uuid(), date: TEST_DATE, note: '[TEST RLS] anonyme' } });
    t.add('Ajout d\'une observation refusé', denied(r1), show(r1));
    const r2 = await call('POST', '/rest/v1/days', { body: { date: TEST_DATE, rating: 'vert' } });
    t.add('Ajout d\'une journée refusé', denied(r2), show(r2));
    const r3 = await call('POST', '/rest/v1/rpc/is_parent', { body: {} });
    t.add('La fonction de contrôle interne n\'est pas accessible', denied(r3), show(r3));
    const r4 = await call('POST', '/auth/v1/signup', { body: { email: `test-${Date.now()}@example.invalid`, password: uuid() }, prefer: false });
    t.add('Création d\'un nouveau compte refusée (inscriptions fermées)', denied(r4), show(r4));
    t.end();
  });

  // ---------- 2. Parent ----------
  button('#runParent', async () => {
    const t = runner($('#outParent'));
    const s = await login($('#pEmail').value, $('#pPw').value);
    $('#pPw').value = '';
    const token = s.access_token; const me = s.user.id;
    try {
      const p = await call('GET', '/rest/v1/parents?select=user_id,display_name', { token });
      t.add('Lecture des 2 parents', p.ok && p.data.length === 2, show(p));
      const other = p.ok ? (p.data.find((x) => x.user_id !== me) || {}).user_id : null;
      const myName = p.ok ? (p.data.find((x) => x.user_id === me) || {}).display_name : null;
      const r1 = await call('PATCH', `/rest/v1/parents?user_id=eq.${me}`, { token, body: { display_name: 'Pirate' } });
      const p2 = await call('GET', `/rest/v1/parents?user_id=eq.${me}&select=display_name`, { token });
      t.add('Modifier la liste des parents : refusé', (denied(r1) || (r1.ok && !r1.data.length)) && p2.ok && p2.data[0].display_name === myName, show(r1));
      const r2 = await call('POST', '/rest/v1/parents', { token, body: { user_id: uuid(), display_name: 'Intrus' } });
      t.add('Ajouter un parent : refusé', denied(r2), show(r2));
      const r2b = await call('DELETE', `/rest/v1/parents?user_id=eq.${other}`, { token });
      const p3 = await call('GET', '/rest/v1/parents?select=user_id', { token });
      t.add('Retirer l\'autre parent : refusé', (denied(r2b) || (r2b.ok && !r2b.data.length)) && p3.ok && p3.data.length === 2, show(r2b));

      // Observation fictive : on essaie de tricher sur l'auteur, la version et la date de création
      const id = uuid();
      const ins = await call('POST', '/rest/v1/events', { token, body: { id, date: TEST_DATE, type: 'autre', note: '[TEST RLS] observation fictive', author_id: other, version: 99, created_at: '2020-01-01T00:00:00Z' } });
      const row = ins.ok ? ins.data[0] : null;
      t.add('Ajouter une observation : accepté', !!row, show(ins));
      t.add('Auteur imposé par le serveur (impossible de signer au nom de l\'autre parent)', row && row.author_id === me, row ? 'auteur = ' + row.author_id : '');
      t.add('Version et date de création imposées par le serveur', row && row.version === 1 && Date.parse(row.created_at) > Date.parse('2026-01-01'), row ? `version ${row.version}, créée ${row.created_at}` : '');
      const bad = await patchB(`/rest/v1/events?id=eq.${id}&version=eq.99`, token, { note: '[TEST RLS] mauvaise version' });
      t.add('Modification avec une version périmée : ignorée (détection des conflits)', bad.ok && bad.data.length === 0, show(bad));
      const upd = await patchB(`/rest/v1/events?id=eq.${id}&version=eq.1`, token, { note: '[TEST RLS] modifiée', author_id: other });
      const u = upd.ok ? upd.data[0] : null;
      t.add('Modification avec la bonne version : acceptée, version 2', u && u.version === 2 && u.note === '[TEST RLS] modifiée', show(upd));
      t.add('L\'auteur ne peut pas être changé', u && u.author_id === me && u.updated_by === me);
      const del = await call('DELETE', `/rest/v1/events?id=eq.${id}`, { token });
      const still = await call('GET', `/rest/v1/events?id=eq.${id}&select=id`, { token });
      t.add('Effacement définitif immédiat : refusé', (denied(del) || (del.ok && del.data.length === 0)) && still.ok && still.data.length === 1, show(del));
      const trash = await patchB(`/rest/v1/events?id=eq.${id}`, token, { deleted_at: '2020-01-01T00:00:00Z' });
      const tr = trash.ok ? trash.data[0] : null;
      t.add('Mise à la corbeille : la date est fixée par le serveur (impossible d\'antidater)', tr && Date.parse(tr.deleted_at) > Date.now() - 864e5, tr ? 'corbeille = ' + tr.deleted_at : show(trash));
      const del2 = await call('DELETE', `/rest/v1/events?id=eq.${id}`, { token });
      const still2 = await call('GET', `/rest/v1/events?id=eq.${id}&select=id`, { token });
      t.add('Effacement avant 30 jours de corbeille : refusé', (denied(del2) || (del2.ok && del2.data.length === 0)) && still2.ok && still2.data.length === 1, show(del2));
      const invalid = await call('POST', '/rest/v1/events', { token, body: { id: uuid(), date: '2020-01-01', type: 'autre', note: '[TEST RLS] date invalide' } });
      t.add('Fiche invalide (date avant 2026) : refusée par le serveur', denied(invalid), show(invalid));

      // Phase 4 (script 04) : approbation contrôlée par le serveur, texte original verrouillé
      const sid = uuid();
      const sNewApproved = await call('POST', '/rest/v1/events', { token, body: { id: uuid(), date: TEST_DATE, type: 'autre', note: '[TEST RLS] nouvelle déjà approuvée', approval_version: 0 } });
      t.add('Phase 4 : nouvelle fiche envoyée déjà approuvée → refusée (enregistrer d\'abord)', denied(sNewApproved), show(sNewApproved));
      const sIns = await call('POST', '/rest/v1/events', { token, body: { id: sid, date: TEST_DATE, type: 'autre', note: '[TEST RLS] structurée', original_text: '[TEST RLS] texte original', context: '[TEST RLS] contexte', categories: ['emotions'], approved_at: '2020-01-01T00:00:00Z', approved_by: other } });
      const sr = sIns.ok ? sIns.data[0] : null;
      t.add('Phase 4 : nouvelle fiche enregistrée non approuvée (approved_at / approved_by envoyés ignorés)', sr && sr.approved_at === null && sr.approved_by === null, show(sIns));
      const sAppr = await patchB(`/rest/v1/events?id=eq.${sid}`, token, { approval_version: sr ? sr.version : 1 });
      const sa = sAppr.ok ? sAppr.data[0] : null;
      t.add('Phase 4 : approbation séparée → date fixée par le serveur, au nom du parent connecté, version +1', sa && sa.approved_by === me && Date.parse(sa.approved_at) > Date.parse('2026-01-01') && sa.version === sr.version + 1, sa ? `approuvée par ${sa.approved_by}, version ${sa.version}` : show(sAppr));
      const sMix = await patchB(`/rest/v1/events?id=eq.${sid}`, token, { note: '[TEST RLS] modifiée en approuvant', approval_version: sa ? sa.version : 2 });
      t.add('Phase 4 : approbation + modification dans la même requête → refusée', denied(sMix), show(sMix));
      await patchB(`/rest/v1/events?id=eq.${sid}`, token, { note: '[TEST RLS] version B' }); // modification B enregistrée
      const sB = await call('GET', `/rest/v1/events?id=eq.${sid}&select=version`, { token });
      const vB = sB.ok ? sB.data[0].version : null;
      const sApprB = await patchB(`/rest/v1/events?id=eq.${sid}`, token, { approval_version: vB });
      t.add('Phase 4 : version B approuvée séparément', sApprB.ok && sApprB.data[0].approved_by === me, show(sApprB));
      const sLate = await patchB(`/rest/v1/events?id=eq.${sid}`, token, { approval_version: sr ? sr.version : 1 });
      const sNow = await call('GET', `/rest/v1/events?id=eq.${sid}&select=note,version`, { token });
      t.add('Phase 4 : ancienne demande arrivée en retard → refusée, la version récente reste intacte', denied(sLate) && sNow.ok && sNow.data[0].note === '[TEST RLS] version B' && sNow.data[0].version === vB + 1, show(sLate));
      const sOrig = await patchB(`/rest/v1/events?id=eq.${sid}`, token, { original_text: '[TEST RLS] retouché' });
      t.add('Phase 4 : texte original impossible à modifier', denied(sOrig), show(sOrig));
      const sEdit = await patchB(`/rest/v1/events?id=eq.${sid}`, token, { context: '[TEST RLS] contexte modifié', approved_by: other });
      const se = sEdit.ok ? sEdit.data[0] : null;
      t.add('Phase 4 : section modifiée sans nouvelle approbation → approbation retirée', se && se.approved_at === null && se.approved_by === null, se ? `approved_at = ${se.approved_at}` : show(sEdit));
      const sCat = await patchB(`/rest/v1/events?id=eq.${sid}`, token, { categories: ['piratage'] });
      t.add('Phase 4 : catégorie inconnue refusée', denied(sCat), show(sCat));
      await patchB(`/rest/v1/events?id=eq.${sid}`, token, { deleted_at: new Date().toISOString() }); // à la corbeille (nettoyée par le script 03)

      // Script 05 : vérification des versions par le serveur
      const strict = $('#modeStrict').checked;
      const vid = uuid();
      const vIns = await call('POST', '/rest/v1/events', { token, body: { id: vid, date: TEST_DATE, type: 'autre', note: '[TEST RLS] versions' } });
      const v1 = vIns.ok ? vIns.data[0].version : 1;
      const vOk = await call('PATCH', `/rest/v1/events?id=eq.${vid}&version=eq.${v1}`, { token, body: { note: '[TEST RLS] versions B', base_version: v1 } });
      const vo = vOk.ok ? vOk.data[0] : null;
      t.add('Script 05 : modification avec la bonne version de départ → acceptée, version +1, base_version non conservée', vo && vo.version === v1 + 1 && vo.base_version === null, show(vOk));
      const vStale = await call('PATCH', `/rest/v1/events?id=eq.${vid}`, { token, body: { note: '[TEST RLS] écrase ?', base_version: v1 } });
      const vNow = await call('GET', `/rest/v1/events?id=eq.${vid}&select=note`, { token });
      t.add('Script 05 : version de départ périmée → refusée (JFV02), rien n\'est écrasé', denied(vStale) && vStale.data && vStale.data.code === 'JFV02' && vNow.ok && vNow.data[0].note === '[TEST RLS] versions B', show(vStale));
      const vNone = await call('PATCH', `/rest/v1/events?id=eq.${vid}`, { token, body: { note: '[TEST RLS] sans version' } });
      if (strict) t.add('Script 05 (mode OBLIGATOIRE attendu) : modification sans version de départ → refusée (JFV01)', denied(vNone) && vNone.data && vNone.data.code === 'JFV01', show(vNone));
      else t.add('Script 05 (mode souple attendu) : modification sans version de départ (app 0.4.0) → acceptée', vNone.ok && vNone.data.length === 1, show(vNone));
      const vv = await versionOf(`/rest/v1/events?id=eq.${vid}`, token);
      const vAppr = await call('PATCH', `/rest/v1/events?id=eq.${vid}&version=eq.${vv}`, { token, body: { approval_version: vv, base_version: vv } });
      t.add('Script 05 : approbation avec la version de départ → acceptée, au nom du parent connecté', vAppr.ok && vAppr.data.length === 1 && vAppr.data[0].approved_by === me, show(vAppr));
      await patchB(`/rest/v1/events?id=eq.${vid}`, token, { deleted_at: new Date().toISOString() });

      // Script 05 : le schéma privé (mode, registre, fonction) n'est pas accessible par l'API
      for (const [label, method, path, extra] of [
        ['lire le mode', 'GET', '/rest/v1/reglages?select=*', { 'Accept-Profile': 'private' }],
        ['lire le registre', 'GET', '/rest/v1/journal_versions?select=*', { 'Accept-Profile': 'private' }],
        ['changer le mode', 'PATCH', '/rest/v1/reglages?cle=eq.version_obligatoire', { 'Content-Profile': 'private' }],
        ['appeler la fonction de vérification', 'POST', '/rest/v1/rpc/verifier_version', { 'Content-Profile': 'private' }],
      ]) {
        const pr = await call(method, path, { token, extra, body: method === 'GET' ? undefined : (method === 'PATCH' ? { valeur: false } : {}) });
        t.add(`Script 05 : impossible de ${label} par l'API (schéma privé non exposé)`, denied(pr), show(pr));
      }

      // Commentaires : ajoutés, jamais modifiés ni effacés
      const cid = uuid();
      const c = await call('POST', '/rest/v1/comments', { token, body: { id: cid, event_id: id, text: '[TEST RLS] commentaire fictif', author_id: other } });
      t.add('Ajouter un commentaire : accepté, auteur imposé', c.ok && c.data[0].author_id === me, show(c));
      const cu = await call('PATCH', `/rest/v1/comments?id=eq.${cid}`, { token, body: { text: '[TEST RLS] modifié' } });
      const cd = await call('DELETE', `/rest/v1/comments?id=eq.${cid}`, { token });
      const cg = await call('GET', `/rest/v1/comments?id=eq.${cid}&select=text`, { token });
      t.add('Modifier ou effacer un commentaire : refusé', (denied(cu) || (cu.ok && !cu.data.length)) && (denied(cd) || (cd.ok && !cd.data.length)) && cg.ok && cg.data[0].text === '[TEST RLS] commentaire fictif', `${show(cu)} / ${show(cd)}`);

      // Journées
      let d = await call('POST', '/rest/v1/days', { token, body: { date: TEST_DATE, rating: 'vert', belle: true } });
      if (d.status === 409) d = await patchB(`/rest/v1/days?date=eq.${TEST_DATE}`, token, { rating: 'vert', belle: true });
      t.add('Noter une journée : accepté', d.ok && d.data.length === 1 && d.data[0].updated_by === me, show(d));
      const dv = await versionOf(`/rest/v1/days?date=eq.${TEST_DATE}`, token);
      const dStale = await call('PATCH', `/rest/v1/days?date=eq.${TEST_DATE}`, { token, body: { rating: 'rouge', base_version: dv ? dv - 1 || 99 : 99 } });
      const dNow = await call('GET', `/rest/v1/days?date=eq.${TEST_DATE}&select=rating`, { token });
      t.add('Script 05 : journée avec une version de départ périmée → refusée (JFV02)', denied(dStale) && dNow.ok && dNow.data[0].rating === 'vert', show(dStale));
      const dd = await call('DELETE', `/rest/v1/days?date=eq.${TEST_DATE}`, { token });
      const dg = await call('GET', `/rest/v1/days?date=eq.${TEST_DATE}&select=date`, { token });
      t.add('Effacer une journée : refusé', (denied(dd) || (dd.ok && !dd.data.length)) && dg.ok && dg.data.length === 1, show(dd));
    } finally { await logout(token); }
    t.end();
  });

  // ---------- 3. Compte non parent ----------
  button('#runIntrus', async () => {
    const t = runner($('#outIntrus'));
    const s = await login($('#iEmail').value, $('#iPw').value);
    $('#iPw').value = '';
    const token = s.access_token;
    try {
      for (const table of ['parents', 'days', 'events', 'comments']) {
        const r = await call('GET', `/rest/v1/${table}?select=*&limit=5`, { token });
        t.add(`Ne voit rien dans « ${table} »`, denied(r) || (r.ok && r.data.length === 0), r.ok ? `${r.data.length} ligne(s) visible(s)` : show(r));
      }
      const r1 = await call('POST', '/rest/v1/events', { token, body: { id: uuid(), date: TEST_DATE, type: 'autre', note: '[TEST RLS] intrus' } });
      t.add('Ajout d\'une observation refusé', denied(r1), show(r1));
      const r2 = await call('POST', '/rest/v1/days', { token, body: { date: TEST_DATE, rating: 'rouge' } });
      t.add('Ajout d\'une journée refusé', denied(r2), show(r2));
      const r3 = await call('PATCH', `/rest/v1/days?date=eq.${TEST_DATE}`, { token, body: { rating: 'rouge' } });
      t.add('Modification d\'une journée refusée', denied(r3) || (r3.ok && r3.data.length === 0), show(r3));
      const r4 = await call('POST', '/rest/v1/parents', { token, body: { user_id: s.user.id, display_name: 'Intrus' } });
      t.add('S\'ajouter soi-même comme parent : refusé', denied(r4), show(r4));
    } finally { await logout(token); }
    t.end();
  });
})();
