// Faux serveur Supabase (en mémoire) pour les tests : imite Auth, PostgREST, les règles RLS
// et les déclencheurs de version de la vraie base. Données fictives uniquement.
import { randomUUID } from 'node:crypto';

export function createMock({ now = () => Date.now() } = {}) {
  const users = {
    'papa@test.local': { id: '11111111-1111-4111-8111-111111111111', password: 'motdepasse-test', name: 'Papa', parent: true },
    'maman@test.local': { id: '22222222-2222-4222-8222-222222222222', password: 'motdepasse-test', name: 'Maman', parent: true },
    'intrus@test.local': { id: '33333333-3333-4333-8333-333333333333', password: 'motdepasse-test', name: 'Intrus', parent: false },
  };
  const tokens = new Map(); // access -> {uid, exp}
  const refresh = new Map(); // refresh -> uid
  const T = { events: new Map(), days: new Map(), comments: new Map() };
  const parents = Object.values(users).filter((u) => u.parent).map((u) => ({ user_id: u.id, display_name: u.name }));
  let clock = 0;
  const ts = () => new Date(now() + (clock++)).toISOString(); // horodatages strictement croissants
  const stats = { requests: 0 };

  function issue(uid) {
    const access = 'acc-' + randomUUID(); const ref = 'ref-' + randomUUID();
    tokens.set(access, { uid, exp: now() + 3600e3 }); refresh.set(ref, uid);
    const email = Object.keys(users).find((k) => users[k].id === uid);
    return { access_token: access, refresh_token: ref, expires_in: 3600, token_type: 'bearer', user: { id: uid, email } };
  }
  const isParent = (uid) => parents.some((p) => p.user_id === uid);

  function parseFilters(q) {
    const f = [];
    for (const [k, v] of q) {
      if (['select', 'order', 'limit', 'offset', 'grant_type'].includes(k)) continue;
      const i = v.indexOf('.'); f.push({ col: k, op: v.slice(0, i), val: v.slice(i + 1) });
    }
    return f;
  }
  function match(row, filters) {
    return filters.every(({ col, op, val }) => {
      const x = row[col];
      if (op === 'eq') return String(x) === val;
      const cmp = (a, b) => (/_at$/.test(col) ? Date.parse(a) - Date.parse(b) : String(a).localeCompare(String(b)));
      if (x == null) return false;
      if (op === 'gte') return cmp(x, val) >= 0;
      if (op === 'gt') return cmp(x, val) > 0;
      if (op === 'lt') return cmp(x, val) < 0;
      return false;
    });
  }
  const KEY = { events: 'id', days: 'date', comments: 'id' };
  const ALLOWED = { events: ['id', 'date', 'time', 'type', 'intensity', 'note', 'duration_min', 'place', 'people', 'state_before', 'context', 'description', 'adult_reaction', 'intervention', 'child_reaction', 'calm_time_min', 'helped', 'extra', 'marked_complete', 'deleted_at', 'author_id', 'version', 'created_at', 'updated_at', 'updated_by'], days: ['date', 'rating', 'belle', 'version', 'created_at', 'updated_at', 'updated_by'], comments: ['id', 'event_id', 'text', 'author_id', 'created_at'] };
  function check(table, r) {
    if (table === 'events') {
      if (!r.type && !r.intensity && !(r.note && r.note !== '')) return 'check';
      if (r.date < '2026-01-01') return 'check';
      if (r.type && !['difficulte', 'crise', 'reussite', 'beau_moment', 'autre'].includes(r.type)) return 'check';
    }
    if (table === 'days' && r.rating && !['vert', 'jaune', 'orange', 'rouge'].includes(r.rating)) return 'check';
    if (table === 'comments' && !(r.text && r.text.length)) return 'check';
    return null;
  }
  const json = (status, body) => ({ status, body });
  const err = (status, code, message) => json(status, { code, message });

  function handle(method, fullPath, headers, body) {
    stats.requests++;
    const u = new URL(fullPath, 'http://x');
    const path = u.pathname.replace(/^\/mock/, '');
    if (headers.apikey !== 'mock-publishable-key') return err(401, '401', 'Invalid API key');
    // ----- Auth -----
    if (path === '/auth/v1/token') {
      const gt = u.searchParams.get('grant_type');
      if (gt === 'password') {
        const usr = users[String(body.email || '').toLowerCase()];
        if (!usr || usr.password !== body.password) return json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        return json(200, issue(usr.id));
      }
      if (gt === 'refresh_token') {
        const uid = refresh.get(body.refresh_token);
        if (!uid) return json(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
        refresh.delete(body.refresh_token); // rotation
        return json(200, issue(uid));
      }
      return json(400, { msg: 'bad grant' });
    }
    const auth = (headers.authorization || '').replace(/^Bearer /, '');
    const tok = tokens.get(auth);
    const uid = tok && tok.exp > now() ? tok.uid : null;
    if (path === '/auth/v1/logout') { tokens.delete(auth); return json(204, null); }
    // ----- REST -----
    const m = path.match(/^\/rest\/v1\/(\w+)$/);
    if (!m) return err(404, 'PGRST', 'not found');
    const table = m[1];
    if (!uid) return err(401, '42501', `permission denied for table ${table}`); // anon : aucun droit
    const parent = isParent(uid);
    if (table === 'parents') {
      if (method !== 'GET') return err(403, '42501', 'permission denied for table parents');
      return json(200, parent ? parents.map((p) => ({ ...p })) : []);
    }
    if (!T[table]) return err(404, 'PGRST205', 'table not found');
    const filters = parseFilters(u.searchParams);
    const rows = () => [...T[table].values()].filter((r) => parent && match(r, filters));
    if (method === 'GET') {
      let out = rows();
      const order = u.searchParams.get('order');
      if (order) {
        const keys = order.split(',').map((s) => s.split('.'));
        out.sort((a, b) => { for (const [c, d] of keys) { const x = String(a[c]); const y = String(b[c]); if (x !== y) return (x < y ? -1 : 1) * (d === 'desc' ? -1 : 1); } return 0; });
      }
      const off = Number(u.searchParams.get('offset') || 0); const lim = Number(u.searchParams.get('limit') || 1e9);
      return json(200, out.slice(off, off + lim).map((r) => ({ ...r })));
    }
    if (method === 'POST') {
      if (!parent) return err(403, '42501', `new row violates row-level security policy for table "${table}"`);
      const r = {};
      for (const k of ALLOWED[table]) r[k] = body[k] === undefined ? null : body[k];
      const key = r[KEY[table]];
      if (T[table].has(key)) return err(409, '23505', 'duplicate key value violates unique constraint');
      if (table === 'comments' && !T.events.has(r.event_id)) return err(409, '23503', 'foreign key violation');
      const t = ts();
      r.created_at = t;
      if (table !== 'comments') { r.version = 1; r.updated_at = t; r.updated_by = uid; }
      if (table !== 'days') r.author_id = uid;
      if (table === 'events') { r.marked_complete = !!r.marked_complete; if (r.deleted_at) r.deleted_at = t; }
      if (table === 'days') r.belle = !!r.belle;
      if (check(table, r)) return err(400, '23514', 'new row violates check constraint');
      T[table].set(key, r);
      return json(201, [{ ...r }]);
    }
    if (method === 'PATCH') {
      if (table === 'comments') return err(403, '42501', 'permission denied for table comments');
      const out = [];
      for (const old of rows()) {
        const n = { ...old };
        for (const k of ALLOWED[table]) if (body[k] !== undefined) n[k] = body[k];
        n.created_at = old.created_at; n.version = old.version + 1; n.updated_at = ts(); n.updated_by = uid;
        if (table === 'events') {
          n.author_id = old.author_id; n.id = old.id;
          if (n.deleted_at == null) n.deleted_at = null; else if (old.deleted_at == null) n.deleted_at = n.updated_at; else n.deleted_at = old.deleted_at;
        }
        if (table === 'days') n.date = old.date;
        if (check(table, n)) return err(400, '23514', 'violates check constraint');
        out.push(n);
      }
      out.forEach((n) => T[table].set(n[KEY[table]], n));
      return json(200, out.map((r) => ({ ...r })));
    }
    if (method === 'DELETE') {
      if (table !== 'events') return err(403, '42501', `permission denied for table ${table}`);
      const limit = now() - 30 * 864e5;
      const out = rows().filter((r) => r.deleted_at && Date.parse(r.deleted_at) < limit);
      out.forEach((r) => { T.events.delete(r.id); for (const [cid, c] of T.comments) if (c.event_id === r.id) T.comments.delete(cid); });
      return json(200, out);
    }
    return err(405, 'PGRST', 'method not allowed');
  }

  // fetch() simulé (pour Node) ; offline = true fait échouer le réseau comme en vrai
  const net = { offline: false, dropResponses: 0 };
  async function fetchFn(url, opts = {}) {
    if (net.offline) throw new TypeError('Failed to fetch');
    const h = {}; for (const [k, v] of Object.entries(opts.headers || {})) h[k.toLowerCase()] = v;
    const r = handle(opts.method || 'GET', url.replace(/^https?:\/\/[^/]+/, ''), h, opts.body ? JSON.parse(opts.body) : null);
    if (net.dropResponses > 0) { net.dropResponses--; throw new TypeError('Failed to fetch'); } // la requête est arrivée mais la réponse s'est perdue
    const text = r.body == null ? '' : JSON.stringify(r.body);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => text };
  }
  return { handle, fetchFn, net, tables: T, users, stats, expireTokens: () => { for (const t of tokens.values()) t.exp = 0; } };
}
