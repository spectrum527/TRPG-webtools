"""Exercise the actual IndexedDB storage in isolated, headless Chrome contexts.

No app server or real Chrome profile is used. Run from the repository root:
    python3 tests/e2e_dnd_reference_storage.py
"""
import json
import subprocess
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
fixture = json.loads((root / 'public/rules/dnd-2014.json').read_text(encoding='utf8'))
spell = next(item for item in fixture['spells'] if item['nameEn'] == 'Fireball')
chrome = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')

with tempfile.TemporaryDirectory(prefix='interlude-dnd-reference-') as temp_name:
    temp = Path(temp_name)
    # esbuild bundles the same browser module used by the app, including validation.
    entry = temp / 'entry.ts'
    entry.write_text(
        'import * as storage from ' + json.dumps(str(root / 'src/dnd-reference-storage.ts')) + ';\n'
        'import * as format from ' + json.dumps(str(root / 'shared/dnd-reference.ts')) + ';\n'
        'Object.assign(globalThis, { referenceStorage: storage, referenceFormat: format });\n',
        encoding='utf8',
    )
    subprocess.run([
        str(root / 'node_modules/.bin/esbuild'), str(entry), '--bundle', '--platform=browser',
        '--format=iife', '--outfile=' + str(temp / 'bundle.js'),
    ], check=True, stdout=subprocess.DEVNULL)
    html = temp / 'index.html'
    html.write_text('<html><body><script src="./bundle.js"></script></body></html>', encoding='utf8')
    with sync_playwright() as playwright:
        options = {'executable_path': str(chrome)} if chrome.exists() else {}
        browser = playwright.chromium.launch(headless=True, **options)
        context = browser.new_context()
        outsider = browser.new_context()
        try:
            first, second, separate = context.new_page(), context.new_page(), outsider.new_page()
            for page in (first, second, separate):
                page.goto(html.as_uri(), wait_until='load')
            assert first.evaluate('async () => (await referenceStorage.getDndReferences()).length') == 0
            # Hold the real object-store write lock until both pages have queued
            # their work, so concurrency is deterministic on slow and fast CI hosts.
            first.evaluate('''async () => {
                window.releaseBarrier = false;
                await new Promise((resolve, reject) => {
                    const request = indexedDB.open('interlude-dnd-references', 1);
                    request.onerror = () => reject(request.error);
                    request.onsuccess = () => {
                        const database = request.result;
                        const tx = database.transaction('library', 'readwrite');
                        tx.oncomplete = () => database.close();
                        tx.onabort = () => database.close();
                        const pump = () => {
                            const read = tx.objectStore('library').get('entries');
                            read.onsuccess = () => { if (!window.releaseBarrier) pump(); };
                        };
                        pump();
                        resolve();
                    };
                });
            }''')
            first.evaluate('''(base) => {
                window.started = Date.now();
                window.finished = false;
                window.writes = Promise.all(Array.from({length: 30}, (_, i) =>
                    referenceStorage.saveDndReferences([{...base, id: `a-${i}`, rawText: '甲'.repeat(20000)}])
                )).then(() => { window.finished = true; return {started: window.started, finished: Date.now()}; });
            }''', spell)
            second.evaluate('''(base) => {
                window.started = Date.now();
                window.finished = false;
                window.writes = Promise.all(Array.from({length: 30}, (_, i) =>
                    referenceStorage.saveDndReferences([{...base, id: `b-${i}`, rawText: '乙'.repeat(20000)}])
                )).then(() => { window.finished = true; return {started: window.started, finished: Date.now()}; });
            }''', spell)
            assert not first.evaluate('() => window.finished')
            assert not second.evaluate('() => window.finished')
            released = first.evaluate('() => { window.releaseBarrier = true; return Date.now(); }')
            a = first.evaluate('async () => await window.writes')
            b = second.evaluate('async () => await window.writes')
            assert a['started'] <= released and b['started'] <= released <= min(a['finished'], b['finished']), (a, b)
            saved = first.evaluate('async () => await referenceStorage.getDndReferences()')
            ids = {entry['id'] for entry in saved}
            assert len(saved) == 60 and ids == {f'{side}-{i}' for side in ('a', 'b') for i in range(30)}
            assert separate.evaluate('async () => (await referenceStorage.getDndReferences()).length') == 0
            first.reload(wait_until='load')
            assert first.evaluate('async () => (await referenceStorage.getDndReferences()).length') == 60
            print('PASS: 60 overlapping writes from two pages survived; reload and separate context verified')

            rollback = first.evaluate('''async (base) => {
                const prototype = IDBObjectStore.prototype;
                const original = prototype.put;
                let nativeAbort = false;
                prototype.put = function(value, key) {
                    if (this.transaction.db.name === 'interlude-dnd-references' && key === 'entries') {
                        this.transaction.addEventListener('abort', () => { nativeAbort = true; });
                        original.call(this, value, key);
                        throw new DOMException('injected', 'QuotaExceededError');
                    }
                    return original.call(this, value, key);
                };
                let message = null;
                try { await referenceStorage.saveDndReferences([{...base, id: 'must-not-commit'}]); }
                catch (error) { message = error.message; }
                finally { prototype.put = original; }
                const entries = await referenceStorage.getDndReferences();
                return {message, nativeAbort, count: entries.length, added: entries.some(x => x.id === 'must-not-commit')};
            }''', spell)
            assert rollback['message'] and '空间不足' in rollback['message'] and rollback['nativeAbort']
            assert rollback['count'] == 60 and not rollback['added'], rollback
            print('PASS: a native transaction abort rolls back an already-queued write')
        finally:
            context.close()
            outsider.close()
            browser.close()
