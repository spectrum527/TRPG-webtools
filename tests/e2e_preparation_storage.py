"""Native IndexedDB verification for personal plans in disposable headless Chrome.

Run from the project root after npm install and installing Python Playwright/Chromium:
    python3 tests/e2e_preparation_storage.py
No app server or real browser profile is used.
"""
import json
import subprocess
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
chrome = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
with tempfile.TemporaryDirectory(prefix='interlude-plan-storage-') as temp_name:
    temp = Path(temp_name)
    entry = temp / 'entry.ts'
    entry.write_text(
        'import * as storage from ' + json.dumps(str(root / 'src/preparation-storage.ts')) + ';\n'
        'import { createDndStatBlock } from ' + json.dumps(str(root / 'shared/dnd.ts')) + ';\n'
        'import { createKeeperCard } from ' + json.dumps(str(root / 'shared/keeper.ts')) + ';\n'
        'Object.assign(globalThis, { planStorage: storage, createDndStatBlock, createKeeperCard });\n',
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
        context, outsider = browser.new_context(), browser.new_context()
        try:
            first, second, separate = context.new_page(), context.new_page(), outsider.new_page()
            for page in (first, second, separate):
                page.goto(html.as_uri(), wait_until='load')
                page.evaluate('''() => {
                  window.makePlan = (id, rule='dnd', edition='2014') => ({
                    documentType:'encounter-plan', schemaVersion:1, id, name:'测试预案', rule,
                    ...(rule === 'dnd' ? {dndEdition:edition} : {}),
                    waves:[{id:'wave', name:'第一波', entries:[{id:'entry', count:1,
                      card: rule === 'dnd' ? createDndStatBlock('npc-blank', edition) : createKeeperCard('npc')}]}],
                    loot:'', notes:''
                  });
                }''')
            assert first.evaluate('async () => (await planStorage.listEncounterPlans()).length') == 0
            # Hold a native write transaction until both pages have queued saves.
            first.evaluate('''async () => {
              window.releaseBarrier = false;
              await new Promise((resolve, reject) => {
                const request=indexedDB.open('interlude-encounter-plans', 1);
                request.onerror=()=>reject(request.error);
                request.onsuccess=()=>{
                  const db=request.result, tx=db.transaction('library','readwrite');
                  tx.oncomplete=()=>db.close(); tx.onabort=()=>db.close();
                  const pump=()=>{const read=tx.objectStore('library').get('plans');
                    read.onsuccess=()=>{if(!window.releaseBarrier)pump();};};
                  pump(); resolve();
                };
              });
            }''')
            for page, prefix in ((first, 'a'), (second, 'b')):
                page.evaluate('''(prefix) => {
                  window.finished=false;
                  window.writes=Promise.all(Array.from({length:12}, (_, i) =>
                    planStorage.saveEncounterPlans([makePlan(`${prefix}-${i}`)])))
                    .then(()=>{window.finished=true;});
                }''', prefix)
            assert not first.evaluate('() => window.finished')
            assert not second.evaluate('() => window.finished')
            first.evaluate('() => {window.releaseBarrier=true;}')
            first.evaluate('async () => await window.writes')
            second.evaluate('async () => await window.writes')
            saved = first.evaluate('async () => await planStorage.listEncounterPlans()')
            assert {entry['id'] for entry in saved} == {f'{side}-{i}' for side in ('a', 'b') for i in range(12)}
            assert separate.evaluate('async () => (await planStorage.listEncounterPlans()).length') == 0
            first.reload(wait_until='load')
            assert first.evaluate('async () => (await planStorage.listEncounterPlans()).length') == 24
            print('PASS: 24 overlapping writes survive reload and stay isolated to their browser context', flush=True)

            conflicts = second.evaluate('''async () => {
              const before=await planStorage.listEncounterPlans();
              const errors=[];
              for(const conflicting of [makePlan('a-0','coc'),makePlan('a-0','dnd','2024')]) {
                try { await planStorage.saveEncounterPlans([makePlan('must-not-commit'),conflicting]); errors.push(null); }
                catch (error) { errors.push(error.message); }
              }
              const after=await planStorage.listEncounterPlans();
              return {errors, same:JSON.stringify(before)===JSON.stringify(after)};
            }''')
            assert conflicts['same'] and len(conflicts['errors']) == 2
            assert all(error and '其他规则或版次冲突' in error for error in conflicts['errors']), conflicts
            print('PASS: cross-rule and cross-edition collisions abort entire batches', flush=True)

            rollback = second.evaluate('''async () => {
              const before=await planStorage.listEncounterPlans();
              const proto=IDBObjectStore.prototype, original=proto.put;
              let nativeAbort=false;
              proto.put=function(value,key) {
                if(this.transaction.db.name==='interlude-encounter-plans' && key==='plans') {
                  this.transaction.addEventListener('abort',()=>{nativeAbort=true;});
                  original.call(this,value,key);
                  throw new DOMException('injected','QuotaExceededError');
                }
                return original.call(this,value,key);
              };
              let message=null;
              try { await planStorage.saveEncounterPlans([makePlan('quota-failure')]); }
              catch(error) { message=error.message; }
              finally { proto.put=original; }
              const after=await planStorage.listEncounterPlans();
              return {message,nativeAbort,same:JSON.stringify(before)===JSON.stringify(after)};
            }''')
            assert rollback['message'] and '空间不足' in rollback['message'] and rollback['nativeAbort'] and rollback['same'], rollback
            print('PASS: quota failure after a queued native put rolls back the transaction', flush=True)
        finally:
            context.close()
            outsider.close()
            browser.close()
