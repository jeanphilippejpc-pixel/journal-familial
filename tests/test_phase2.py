"""Tests de bout en bout de la phase 2 (données fictives uniquement).
Lancer : python3 tests/test_phase2.py  (sert le dossier sur http://localhost:8765)
"""
import http.server, os, socketserver, sys, threading, time, json
from playwright.sync_api import sync_playwright, expect

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tests', 'output')
os.makedirs(OUT, exist_ok=True)
PORT = 8765

class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, *a): pass

socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(('127.0.0.1', PORT), Quiet)
threading.Thread(target=srv.serve_forever, daemon=True).start()

results = []
def check(name, cond):
    results.append((name, bool(cond)))
    print(('OK   ' if cond else 'ÉCHEC'), name)

def pin(page, code):
    for c in code:
        page.click(f'#lock [data-k="{c}"]')
    page.wait_for_timeout(400)

NOTE = 'EXEMPLE-FICTIF refus de quitter le parc'

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, accept_downloads=True, locale='fr-CA')
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(f'http://localhost:{PORT}/index.html')

    # 1. Création du code
    expect(page.locator('#pinMsg')).to_contain_text('Choisissez')
    pin(page, '1111')
    check('code trop simple refusé', 'trop facile' in page.inner_text('#pinMsg'))
    pin(page, '2580'); pin(page, '2581')
    check('codes différents refusés', 'ne correspondent pas' in page.inner_text('#pinMsg'))
    pin(page, '2580'); pin(page, '2580')
    page.wait_for_selector('#shell:not([hidden])')
    page.click('.modal [data-p="Papa"]')
    page.fill('#mInput', 'Prenomfictif'); page.click('#mYes'); page.wait_for_timeout(300)
    check('prénom privé affiché après déverrouillage', page.inner_text('#topSub') == 'Journal de Prenomfictif')
    check('calendrier affiché', page.is_visible('.cal-grid'))
    check('semaine commence le dimanche', page.locator('.dow').first.get_attribute('title') == 'dimanche')
    page.screenshot(path=f'{OUT}/01-calendrier-vide.png')

    # 2. Ajout rapide complet
    page.click('.fab')
    page.click('.sheet [data-q="intensity"][data-v="orange"]')
    page.click('.sheet [data-q="type"][data-v="crise"]')
    page.fill('#qNote', NOTE)
    page.screenshot(path=f'{OUT}/02-ajout-rapide.png')
    t0 = time.time(); page.click('#qSave'); page.wait_for_selector('.ev')
    check('ajout rapide enregistré', NOTE in page.inner_text('.list'))
    # 3. Ajout incomplet (type seul)
    page.click('.fab'); page.click('.sheet [data-q="type"][data-v="difficulte"]'); page.click('#qSave')
    page.wait_for_timeout(300)
    check('événement incomplet marqué « À compléter »', page.locator('.day-card-dummy, .todo-tag').count() >= 1)
    # 4. Enregistrement vide refusé
    page.click('.fab'); page.click('#qSave'); page.wait_for_timeout(200)
    check('enregistrement vide refusé', page.is_visible('.sheet') and 'au moins' in page.inner_text('#toast'))
    page.click('.sheet [data-act="closeSheet"]')

    # 5. Couleur suggérée, puis Belle journée et Non évaluée
    check('suggestion orange affichée', 'Suggestion : orange' in page.inner_text('#view'))
    check('journée non évaluée par défaut', page.get_attribute('.rate.none', 'aria-checked') == 'true')
    page.click('.btn-belle'); page.wait_for_timeout(300)
    check('Belle journée → vert', page.get_attribute('.rate.c-vert', 'aria-checked') == 'true' and 'c-vert' in page.get_attribute('.day.sel', 'class'))
    page.click('.rate.c-rouge'); page.wait_for_timeout(200)
    check('couleur modifiable manuellement', page.get_attribute('.rate.c-rouge', 'aria-checked') == 'true')
    page.click('.rate.none'); page.wait_for_timeout(200)
    check('retour à « Non évaluée »', 'obs' in page.get_attribute('.day.sel', 'class'))

    # 6. Fiche détaillée
    page.click('.ev >> nth=1')
    page.wait_for_selector('.panel')
    page.fill('[data-f="description"]', 'Description fictive de test')
    page.fill('[data-f="calmTime"]', '12')
    page.click('.panel [data-d="intensity"][data-v="jaune"]')
    page.screenshot(path=f'{OUT}/03-fiche.png', full_page=True)
    page.click('#dSave'); page.wait_for_timeout(300)
    check('fiche complétée → plus « À compléter »', page.locator('.todo-tag').count() == 0)
    # Commentaire
    page.click('.ev >> nth=0'); page.fill('#dComment', 'Commentaire fictif'); page.click('#dAddComment'); page.wait_for_timeout(300)
    check('commentaire ajouté', 'Commentaire fictif' in page.inner_text('.panel'))
    page.click('.panel [data-act="closeSheet"]'); page.wait_for_timeout(200)
    if page.is_visible('.modal'): page.click('#mYes')

    # 7. Suppression → corbeille → restauration
    page.click('.ev >> nth=0'); page.click('#dDelete'); page.click('#mYes'); page.wait_for_timeout(300)
    check('événement supprimé (corbeille)', page.locator('.ev').count() == 1)
    page.click('#gearBtn'); page.wait_for_timeout(200)
    check('corbeille contient 1 élément', 'Corbeille (1)' in page.inner_text('#view'))
    page.click('[data-act="restore"]'); page.wait_for_timeout(200)
    page.click('.tab[data-view="calendar"]')
    check('événement restauré', page.locator('.ev').count() == 2)

    # 8. Données chiffrées dans IndexedDB
    raw = page.evaluate('''() => new Promise((res) => { const r = indexedDB.open('journal-familial'); r.onsuccess = () => {
        const g = r.result.transaction('records').objectStore('records').getAll(); g.onsuccess = () => {
          const dec = new TextDecoder(); res(g.result.map(x => ({ keys: Object.keys(x).sort().join(','), txt: dec.decode(new Uint8Array(x.ct)) })));
        }; }; })''')
    check('enregistrements stockés chiffrés (id, iv, ct seulement)', all(x['keys'] == 'ct,id,iv' for x in raw) and len(raw) >= 3)
    check('aucun texte en clair dans le stockage', not any('EXEMPLE' in x['txt'] or 'Papa' in x['txt'] or 'Prenomfictif' in x['txt'] for x in raw))
    check('rien dans localStorage', page.evaluate('localStorage.length') == 0)

    # 9. Verrouillage
    page.evaluate('window.__JM_TEST__.lock()')
    check('verrouillé : contenu retiré de la page', NOTE not in page.content() and page.is_visible('#lock'))
    check('verrouillé : prénom absent (titre neutre)', 'Prenomfictif' not in page.content() and page.title() == 'Journal familial')
    pin(page, '1234')
    check('mauvais code refusé', 'incorrect' in page.inner_text('#pinMsg'))
    pin(page, '2580'); page.wait_for_selector('#shell:not([hidden])')
    check('déverrouillé : données relues', NOTE in page.inner_text('#view'))
    page.evaluate('window.__JM_TEST__.expireLock()'); page.wait_for_timeout(11000)
    check('verrouillage automatique après inactivité', page.is_visible('#lock'))
    pin(page, '2580'); page.wait_for_selector('#shell:not([hidden])')

    # 10. Données fictives + Journal
    page.click('#gearBtn'); page.click('[data-act="demo"]'); page.wait_for_timeout(500)
    page.screenshot(path=f'{OUT}/04-calendrier-demo.png')
    page.click('.tab[data-view="journal"]'); page.click('[data-act="jf"][data-f="todo"]'); page.wait_for_timeout(200)
    check('filtre « À compléter » du Journal', page.locator('.ev').count() >= 1 and all('À compléter' in t for t in page.locator('.ev').all_inner_texts()))
    page.fill('#jq', 'parc'); page.wait_for_timeout(200)
    page.screenshot(path=f'{OUT}/05-journal.png')

    # 11. Sauvegarde chiffrée → effacement → restauration
    page.click('#gearBtn')
    page.click('[data-act="export"][data-mode="enc"]')
    page.fill('#mInput', 'motdepasse-fictif'); page.fill('#mInput2', 'motdepasse-fictif')
    with page.expect_download() as dl:
        page.click('#mYes')
    path = os.path.join(OUT, 'sauvegarde-test.json'); dl.value.save_as(path)
    data = json.load(open(path))
    check('sauvegarde chiffrée sans texte en clair', data['encrypted'] and 'EXEMPLE' not in open(path).read())
    n_before = page.evaluate('''() => new Promise((res) => { const r = indexedDB.open('journal-familial'); r.onsuccess = () => { const g = r.result.transaction('records').objectStore('records').count(); g.onsuccess = () => res(g.result); }; })''')
    page.click('[data-act="wipe"]'); page.fill('#mInput', 'EFFACER'); page.click('#mYes')
    page.wait_for_selector('#lock:not([hidden])'); page.wait_for_timeout(300)
    check('effacement complet → retour au choix du code', 'Choisissez' in page.inner_text('#pinMsg'))
    pin(page, '3691'); pin(page, '3691'); page.wait_for_selector('#shell:not([hidden])'); page.click('.modal [data-p="Maman"]'); page.click('#mNo'); page.wait_for_timeout(200)
    page.click('#gearBtn')
    page.set_input_files('#importFile', path)
    page.fill('#mInput', 'mauvais-mot'); page.click('#mYes'); page.wait_for_timeout(1500)
    check('mauvais mot de passe de sauvegarde refusé', 'incorrect' in page.inner_text('#toast'))
    page.set_input_files('#importFile', path)
    page.fill('#mInput', 'motdepasse-fictif'); page.click('#mYes'); page.wait_for_selector('#mTitle:has-text("Restauration")', timeout=8000)
    page.click('#mYes')
    n_after = page.evaluate('''() => new Promise((res) => { const r = indexedDB.open('journal-familial'); r.onsuccess = () => { const g = r.result.transaction('records').objectStore('records').count(); g.onsuccess = () => res(g.result); }; })''')
    check(f'restauration complète ({n_after} vs {n_before} enregistrements)', n_after == n_before)
    page.click('.tab[data-view="calendar"]')
    check('observations restaurées visibles', NOTE in page.inner_text('#view'))
    # Restaurer une 2e fois ne crée pas de doublons
    page.click('#gearBtn'); page.set_input_files('#importFile', path); page.fill('#mInput', 'motdepasse-fictif'); page.click('#mYes')
    page.wait_for_selector('#mTitle:has-text("Restauration")', timeout=8000)
    check('2e restauration sans doublon', '0 élément(s) ajouté(s)' in page.inner_text('.modal'))
    page.click('#mYes')

    # 12. Rapidité de l'ajout rapide (ouverture → enregistrement)
    page.click('.tab[data-view="calendar"]')
    t = time.time(); page.click('.fab'); page.click('.sheet [data-q="type"][data-v="reussite"]'); page.click('#qSave'); page.wait_for_selector('#toast:not([hidden])')
    check(f'ajout rapide réactif ({(time.time() - t) * 1000:.0f} ms)', time.time() - t < 2)

    page.screenshot(path=f'{OUT}/06-final.png')
    check('aucune erreur JavaScript', not errors)
    if errors: print('\n'.join(errors))
    b.close()
srv.shutdown()
os.remove(os.path.join(OUT, 'sauvegarde-test.json'))
fails = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(fails)}/{len(results)} vérifications réussies')
sys.exit(1 if fails else 0)
