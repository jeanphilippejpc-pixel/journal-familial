/* Configuration publique de Supabase.
 * L'adresse et la clé « publishable » sont conçues pour être visibles : elles n'ouvrent rien
 * sans un compte parent autorisé (règles RLS côté serveur). La clé secrète n'est JAMAIS ici.
 * Sur localhost avec ?mock, l'app parle à un faux serveur de test (données fictives).
 */
(() => {
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  window.JF_CONFIG = local && new URLSearchParams(location.search).has('mock')
    ? { url: location.origin + '/mock', key: 'mock-publishable-key', mock: true }
    : { url: 'https://uqvpzuyficmbgovpnkuz.supabase.co', key: 'sb_publishable_dMl4aBKrDgksDLmYZxD03w_2c3NhmRw', mock: false };
})();
