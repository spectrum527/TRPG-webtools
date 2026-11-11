"""Injury switches, manual HP confirmation, modal stacking and live recovery."""
import argparse
import json
import re
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:3115')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
out = root / 'test-results/injuries'
out.mkdir(parents=True, exist_ok=True)
checks, errors = [], []

def passed(name):
    checks.append(name)
    print('PASS', name, flush=True)

def fixture(rule, year):
    script = '''import {createCharacter,deriveCharacter,getCharacterErrors} from './shared/rules.ts';
import {suggestAllocation,defaultCreationPolicy,validateCreation} from './shared/creation.ts';
const rule=process.argv[1],year=process.argv[2];
let c=createCharacter(rule,()=>3,undefined,year);
c.name=rule==='dnd'?'林恩':'陈默';
c.occupation=rule==='dnd'?'战士':'记者';c.ancestry=rule==='dnd'?'人类':'阿卡姆';
c.background=rule==='dnd'&&year==='2024'?'士兵':'旅行者';
if(rule==='coc')c.attributes={str:50,con:50,siz:50,dex:60,app:50,int:60,pow:60,edu:60,luck:50};
c=deriveCharacter(c);if(rule==='dnd'){c.hp=12;c.maxHp=12;}
c=suggestAllocation(c,defaultCreationPolicy(rule));
const errors=[...getCharacterErrors(c),...validateCreation(c,defaultCreationPolicy(rule))];
if(errors.length)throw Error(errors.join(';'));
console.log(JSON.stringify(c));'''
    card = json.loads(subprocess.check_output(['node','--import','tsx','--input-type=module','-e',script,rule,year],cwd=root,text=True))
    path = out/f'{rule}-{year}.json'
    path.write_text(json.dumps(card,ensure_ascii=False),encoding='utf8')
    return path, card

def choose(page,rule,year):
    page.goto(args.url,wait_until='domcontentloaded')
    if rule=='dnd': page.locator('.rule-card.dnd .dnd-edition-switch button').filter(has_text=year).click()
    page.locator(f'.rule-card.{rule} .rule-choose').click()

def close(page):
    page.get_by_role('dialog').get_by_role('button',name='关闭窗口',exact=True).click()

def tool(page,name):
    if not page.locator('.host-tool-links').is_visible(): page.get_by_role('button',name='局内工具',exact=True).click()
    page.get_by_role('button',name=name,exact=True).click()

def encounter(host,name):
    tool(host,'场景与回合')
    host.get_by_role('button',name=re.compile('^行动与状态')).click()
    host.locator('.encounter-roster').get_by_role('button',name=re.compile(re.escape(name))).click()

def hp(host,value):
    host.get_by_label('当前 HP',exact=True).fill(str(value))
    host.get_by_role('button',name='保存本场记录',exact=True).click()

def saved(host):
    expect(host.get_by_text('本场记录已保存',exact=True)).to_be_visible()

def enable(host,label):
    checkbox=host.get_by_label(label,exact=True)
    checkbox.click()
    expect(checkbox).to_be_checked()

def confirm(host,enabled=True):
    modal=host.get_by_role('dialog',name='确认 HP 与伤势',exact=True)
    expect(modal).to_be_visible()
    modal.get_by_role('button',name='确认 HP 与伤势' if enabled else '确认修改 HP',exact=True).click()
    expect(modal).to_have_count(0)

def screenshot(page,name):
    page.wait_for_function("[...document.querySelectorAll('.page-enter')].filter(e=>e.getClientRects().length).every(e=>Number(getComputedStyle(e).opacity)>.99)")
    expect(page.locator('.toast')).to_have_count(0)
    g=page.evaluate('''() => ({v:innerWidth,w:document.documentElement.scrollWidth,
      boxes:[...document.querySelectorAll('.modal:not([inert]),.modal:not([inert]) .modal-content')].map(e=>{
        const r=e.getBoundingClientRect();return {l:r.left,r:r.right,w:e.clientWidth,s:e.scrollWidth};})})''')
    assert g['w']<=g['v']+1 and all(b['l']>=-1 and b['r']<=g['v']+1 and b['s']<=b['w']+1 for b in g['boxes']),(name,g)
    page.screenshot(path=str(out/(name+'.png')),animations='disabled')

def prepare(browser,rule,year):
    contexts=[browser.new_context(viewport={'width':1440,'height':1000}) for _ in range(2)]
    if year=='2024': contexts[0].add_init_script("localStorage.setItem('interlude-theme','dark')")
    host,player=[c.new_page() for c in contexts]
    for page in (host,player):
        page.set_default_timeout(15000);page.on('pageerror',lambda e:errors.append(str(e)))
    choose(host,rule,year)
    host.get_by_label('你的称呼').fill('主持人')
    host.get_by_label('房间名称').fill('河畔旅馆' if rule=='dnd' else '阿卡姆图书馆')
    host.get_by_role('button',name='创建房间，成为主持人',exact=True).click()
    code=host.locator('.room-code b').inner_text()
    choose(player,rule,year)
    player.get_by_role('button',name='加入房间',exact=True).first.click()
    player.get_by_label('你的称呼').fill('玩家');player.get_by_label('房间码',exact=True).fill(code)
    player.locator('form').get_by_role('button',name='加入房间',exact=True).click()
    path,card=fixture(rule,year)
    player.get_by_role('button',name='创建角色',exact=True).click()
    player.get_by_label('导入角色卡文件').set_input_files(str(path))
    player.get_by_role('button',name='保存并提交审核',exact=True).click()
    tool(host,'审核与制卡要求')
    host.get_by_role('button',name='通过此卡',exact=True).click();close(host)
    player.get_by_role('button',name='我准备好了',exact=True).click()
    host.get_by_role('button',name='我准备好了',exact=True).click()
    host.get_by_role('button',name='开启故事',exact=True).click()
    encounter(host,card['name'])
    return host,player,contexts,card

with sync_playwright() as p:
    chrome=Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    browser=p.chromium.launch(headless=True,**({'executable_path':str(chrome)} if chrome.exists() else {}))
    try:
        for year in ('2014','2024'):
            host,player,contexts,card=prepare(browser,'dnd',year)
            expect(host.get_by_label('自动伤势检定',exact=True)).not_to_be_checked()
            hp(host,1);saved(host)
            expect(player.locator('.resource-control').first.locator('b')).to_have_text('1/12')
            player.get_by_role('button',name='减少生命',exact=True).click()
            modal=player.get_by_role('dialog',name='确认 HP 与伤势',exact=True)
            expect(modal).to_contain_text('自动扣血已关闭')
            modal.get_by_role('button',name='取消修改',exact=True).click()
            expect(player.locator('.resource-control').first.locator('b')).to_have_text('1/12')
            player.get_by_role('button',name='减少生命',exact=True).click();confirm(player,False)
            expect(player.locator('.resource-control').first.locator('b')).to_have_text('0/12')
            expect(player.locator('.my-injuries')).not_to_contain_text('濒死')
            hp(host,1);saved(host)
            enable(host,'自动扣减生命值')
            hp(host,0)
            modal=host.get_by_role('dialog',name='确认 HP 与伤势',exact=True)
            expect(modal).to_contain_text('濒死')
            expect(host.locator('.host-modal')).to_have_attribute('inert','')
            for _ in range(8):
                host.keyboard.press('Tab')
                assert host.evaluate("document.querySelector('.health-confirmation').contains(document.activeElement)")
            host.keyboard.press('Escape')
            expect(modal).to_have_count(0)
            expect(host.get_by_role('dialog')).to_have_count(1)
            expect(host.locator('.host-modal')).not_to_have_attribute('inert','')
            expect(player.locator('.resource-control').first.locator('b')).to_have_text('1/12')
            host.get_by_role('button',name='保存本场记录',exact=True).click()
            player.get_by_role('button',name='增加生命',exact=True).click()
            expect(modal.get_by_role('alert')).to_contain_text('状态已变化')
            expect(modal.get_by_role('button',name='确认 HP 与伤势',exact=True)).to_be_disabled()
            modal.get_by_role('button',name='取消修改',exact=True).click()
            host.get_by_role('button',name='重新载入最新记录',exact=True).click()
            expect(host.get_by_label('当前 HP',exact=True)).to_have_value('2')
            hp(host,0)
            for width in (1440,390,320):
                host.set_viewport_size({'width':width,'height':1000 if width==1440 else 844})
                screenshot(host,f'{year}-hp-confirm-{width}')
            confirm(host)
            expect(player.locator('.my-injuries')).to_contain_text('濒死')
            expect(player.locator('.my-injuries')).to_contain_text('昏迷')
            host.set_viewport_size({'width':1440,'height':1000})
            host.get_by_role('button',name='掷死亡豁免',exact=True).click()
            expect(host.get_by_role('button',name='确认记录此结果',exact=True)).to_be_enabled()
            enable(host,'自动伤势检定')
            host.get_by_label('手填行动值',exact=True).fill('10');host.get_by_role('button',name='保存本场记录',exact=True).click();saved(host)
            host.get_by_role('button',name='生成顺序',exact=True).click()
            expect(player.locator('.story-scroll')).to_contain_text('死亡豁免：d20')
            expect(host.get_by_role('button',name='掷死亡豁免',exact=True)).to_be_disabled()
            expect(host.get_by_role('button',name='确认记录此结果',exact=True)).to_be_disabled()
            passed(f'{year}: cancelled and stale HP edits are safe; nested focus/Escape and automatic death save work')
            hp(host,1);saved(host)
            hp(host,0)
            modal.get_by_label('主持人裁定为死亡',exact=True).check();confirm(host)
            expect(player.locator('.my-injuries')).to_contain_text('死亡')
            player.get_by_role('button',name='增加生命',exact=True).click()
            expect(player.get_by_role('alert')).to_contain_text('先确认复活')
            expect(player.locator('.resource-control').first.locator('b')).to_have_text('0/12')
            care=host.locator('.injury-care');care.locator('summary').click()
            care.get_by_label('已确认复活条件或主持人裁定',exact=True).check()
            care.get_by_role('button',name='确认复活',exact=True).click()
            expect(player.locator('.resource-control').first.locator('b')).to_have_text('1/12')
            expect(player.locator('.my-injuries')).not_to_contain_text('死亡')
            close(host)
            assert host.evaluate("!document.getElementById('root').inert")
            host.reload(wait_until='domcontentloaded')
            expect(host.locator('.room-title h1')).to_contain_text('河畔旅馆')
            encounter(host,card['name'])
            expect(host.get_by_label('自动伤势检定',exact=True)).to_be_checked()
            close(host)
            passed(f'{year}: explicit death, blocked ordinary healing, host revival and saved settings')
            for c in contexts:c.close()

        host,player,contexts,card=prepare(browser,'coc','2014')
        enable(host,'自动扣减生命值')
        enable(host,'自动伤势检定')
        hp(host,5);saved(host)
        expect(player.locator('.my-injuries')).to_contain_text('重伤')
        expect(player.locator('.story-scroll')).to_contain_text('重伤体质检定')
        hp(host,0);confirm(host)
        expect(player.locator('.my-injuries')).to_contain_text('濒死')
        care=host.locator('.injury-care');care.locator('summary').click()
        care.get_by_label('已确认检定成功与治疗条件',exact=True).check()
        care.get_by_role('button',name='确认急救成功',exact=True).click()
        expect(player.locator('.my-injuries')).to_contain_text('急救后暂时稳定')
        expect(player.locator('.resource-control').first.locator('b')).to_have_text('0/10')
        care.get_by_label('已确认检定成功与治疗条件',exact=True).check()
        care.get_by_role('button',name='确认医学治疗成功',exact=True).click()
        expect(player.locator('.resource-control').first.locator('b')).to_have_text(re.compile(r'^[1-3]/10$'))
        expect(player.locator('.my-injuries')).not_to_contain_text('濒死')
        expect(care.locator('.combat-command-result')).to_contain_text('确认医学治疗成功')
        expect(host.get_by_label('当前 HP',exact=True)).to_have_value(re.compile(r'^[1-3]$'))
        hp(host,10);saved(host)
        hp(host,0)
        expect(host.get_by_role('dialog',name='确认 HP 与伤势',exact=True)).to_contain_text('死亡')
        screenshot(host,'coc-instant-death-confirm')
        confirm(host)
        expect(player.locator('.my-injuries')).to_contain_text('死亡')
        passed('CoC: major-wound CON check, confirmed dying, First Aid, Medicine and instant-death thresholds')
        for c in contexts:c.close()
        assert not errors,errors
        passed('No uncaught browser errors across injury flows')
    except Exception:
        try: host.screenshot(path=str(out/'failure.png'),full_page=False)
        except Exception: pass
        raise
    finally:
        (out/'report.json').write_text(json.dumps({'checks':checks,'errors':errors},ensure_ascii=False,indent=2))
        browser.close()
