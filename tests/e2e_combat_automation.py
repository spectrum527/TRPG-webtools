"""Edition-aware room, initiative and real HP synchronization through the production UI."""
import argparse
import json
import re
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:3001')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
out = root / 'test-results/combat-automation'
out.mkdir(parents=True, exist_ok=True)
checks, errors = [], []

def passed(label):
    checks.append(label)
    print('PASS', label, flush=True)

def close(page):
    page.get_by_role('button', name='关闭窗口', exact=True).click()
    expect(page.get_by_role('dialog')).to_have_count(0)

def nav(page, label):
    if page.locator('.sidebar').is_visible():
        page.locator('.sidebar').get_by_role('button', name=label, exact=True).click()
    else:
        page.get_by_role('button', name='打开导航').click()
        page.locator('.mobile-navigation').get_by_role('button', name=label, exact=True).click()

def choose(page, rule, edition='2014'):
    page.goto(args.url, wait_until='domcontentloaded')
    if rule == 'dnd':
        page.locator('.rule-card.dnd .dnd-edition-switch button').filter(has_text=edition).click()
    page.locator('.rule-card.'+rule+' .rule-choose').click()

def fit(page, name):
    dimensions = page.evaluate('''() => ({vw:innerWidth, sw:document.documentElement.scrollWidth, panels:[...document.querySelectorAll('.modal,.modal-content,.encounter-detail,.targeted-damage,.initiative-check')].filter(e=>e.getClientRects().length).map(e=>({w:e.clientWidth,s:e.scrollWidth}))})''')
    assert dimensions['sw'] <= dimensions['vw']+1 and all(x['s'] <= x['w']+1 for x in dimensions['panels']), (name, dimensions)
    page.screenshot(path=str(out/(name+'.png')), animations='disabled')

def host_tools(page):
    if not page.locator('.host-tool-links').is_visible():
        page.get_by_role('button', name='局内工具', exact=True).click()
    page.get_by_role('button', name='场景与回合', exact=True).click()
    page.get_by_role('button', name=re.compile('^行动与状态')).click()
    expect(page.locator('.encounter-panel')).to_be_visible()

def player_tools(page):
    if not page.locator('.tools-panel').is_visible():
        page.get_by_role('button', name='局内工具', exact=True).click()
    page.get_by_role('button', name='本场战斗', exact=True).click()

def fixture(rule, edition):
    script = '''import {createCharacter,deriveCharacter} from './shared/rules.ts';
import {suggestAllocation,defaultCreationPolicy} from './shared/creation.ts';
import {createDndStatBlock} from './shared/dnd.ts';
import {createKeeperCard} from './shared/keeper.ts';
const rule=process.argv[1], edition=process.argv[2];
let c=createCharacter(rule,()=>3,undefined,edition);
c.name=rule==='dnd'?'远行者':'调查员';c.occupation=rule==='dnd'?'战士':'记者';c.ancestry=rule==='dnd'?'矮人':'阿卡姆';c.background=rule==='dnd'&&edition==='2024'?'士兵':'旅行者';
c.attributes=rule==='dnd'?{str:16,dex:14,con:14,int:12,wis:14,cha:10}:{str:50,con:80,siz:80,dex:60,app:50,int:60,pow:60,edu:60,luck:50};
c=deriveCharacter(c);if(rule==='dnd'){c.hp=30;c.maxHp=30;c.ac=15;c.passivePerceptionEnabled=true;}c=suggestAllocation(c,defaultCreationPolicy(rule));
let npc=rule==='dnd'?createDndStatBlock('npc-blank',edition):createKeeperCard('npc');npc.name=rule==='dnd'?'试炼守卫':'靶场守卫';npc.hp=30;npc.maxHp=30;npc.attributes.dex=50;if(rule==='dnd'){npc.attributes.dex=12;npc.ac=15;}else{npc.armor=2;}
console.log(JSON.stringify({card:c,npc}));'''
    result = json.loads(subprocess.check_output(['node','--import','tsx','--input-type=module','-e',script,rule,edition],cwd=root,text=True))
    for kind in ['card','npc']:
        (out/(rule+'-'+edition+'-'+kind+'.json')).write_text(json.dumps(result[kind], ensure_ascii=False))
    return result

with sync_playwright() as p:
    chrome = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    browser = p.chromium.launch(headless=True, **({'executable_path':str(chrome)} if chrome.exists() else {}))
    contexts=[]
    def new_page():
        context=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
        contexts.append(context)
        page=context.new_page()
        page.set_default_timeout(12000)
        page.on('pageerror',lambda error:errors.append(str(error)))
        return page
    try:
        home = new_page()
        home.goto(args.url,wait_until='domcontentloaded')
        home.locator('.rule-card.dnd .dnd-edition-switch button').filter(has_text='2024').click()
        fit(home,'homepage-2024-light')
        home.get_by_role('button',name='切换深色模式',exact=True).click()
        home.set_viewport_size({'width':320,'height':844})
        fit(home,'homepage-2024-dark-320')
        passed('Homepage edition control fits desktop light and mobile dark')
        for rule, edition in [('dnd','2014'),('dnd','2024'),('coc','2014')]:
            data=fixture(rule,edition)
            host, player=new_page(),new_page()
            choose(host,rule,edition)
            host.get_by_label('你的称呼').fill('验收主持人')
            host.get_by_label('房间名称').fill(rule+' '+edition+' 自动战斗')
            host.get_by_role('button',name='创建房间，成为主持人').click()
            expect(host.locator('.room-title h1')).to_be_visible()
            code=host.locator('.room-code b').inner_text()
            if rule=='dnd': expect(host.locator('.room-title')).to_contain_text(edition)
            choose(player,rule,edition)
            player.get_by_role('button',name='加入房间',exact=True).first.click()
            player.get_by_label('你的称呼').fill('验收玩家')
            player.get_by_label('房间码',exact=True).fill(code)
            player.locator('form').get_by_role('button',name='加入房间',exact=True).click()
            expect(player.locator('.room-title h1')).to_be_visible()
            player.get_by_role('button',name='创建角色',exact=True).click()
            player.get_by_label('导入角色卡文件').set_input_files(str(out/(rule+'-'+edition+'-card.json')))
            player.get_by_role('button',name='保存并提交审核',exact=True).click()
            expect(player.get_by_role('dialog')).to_have_count(0)
            player.get_by_role('button',name='我准备好了',exact=True).click()
            host.get_by_role('button',name='我准备好了',exact=True).click()
            host.get_by_role('button',name=re.compile('审核与制卡要求')).click()
            host.get_by_role('button',name='通过此卡',exact=True).click()
            close(host)
            host.get_by_role('button',name='开启故事',exact=True).click()
            expect(player.locator('.status-pill')).to_contain_text('故事进行中')
            passed(rule+' '+edition+' room, card import, review and start')
            nav(host,'主持人工具集')
            host.get_by_role('button',name=re.compile('房间 D&D 数据块库' if rule=='dnd' else '房间 NPC 与怪物卡库')).click()
            host.get_by_label('导入 D&D 资料集文件' if rule=='dnd' else '导入KP资料文件',exact=True).set_input_files(str(out/(rule+'-'+edition+'-npc.json')))
            expect(host.locator('.keeper-card-list > button')).to_have_count(1)
            close(host)
            host.locator('.app-header').get_by_role('button',name='返回房间',exact=True).click()
            host_tools(host)
            host.get_by_role('button',name='加入参战',exact=True).click()
            expect(host.locator('.encounter-row')).to_have_count(2)
            host.locator('.encounter-row').filter(has_text=data['npc']['name']).click()
            if rule=='dnd':
                player_tools(player)
                player.get_by_label('额外先攻加值',exact=True).fill('2')
                player.get_by_label('先攻投掷方式',exact=True).select_option('advantage')
                player.get_by_role('button',name='掷先攻',exact=True).click()
                expect(player.get_by_role('button',name='已记录先攻',exact=True)).to_be_disabled()
                expect(host.locator('.encounter-row').filter(has_text=data['card']['name']).locator('.encounter-order')).not_to_have_text('—')
                host.get_by_label('受突袭',exact=False).click()
                expect(host.get_by_label('受突袭',exact=False)).to_be_checked()
                host.get_by_role('button',name='掷先攻',exact=True).click()
                expect(host.get_by_role('button',name='已记录先攻',exact=True)).to_be_disabled()
                if edition=='2024':
                    expect(host.locator('.initiative-breakdown')).to_contain_text('，')
                host.get_by_role('button',name='生成顺序',exact=True).click()
                expect(host.locator('.encounter-heading')).to_contain_text('第 1 轮')
                close(player)
                passed('D&D '+edition+' player and NPC server initiative, surprise and sorting')
            expect(host.get_by_label('自动扣减生命值',exact=True)).not_to_be_checked()
            host.get_by_label('自动扣减生命值',exact=True).click()
            expect(host.get_by_label('自动扣减生命值',exact=True)).to_be_checked()
            actor=data['card']['name']
            host.locator('.encounter-row').filter(has_text=actor).click()
            if rule=='dnd':
                host.get_by_label('临时 HP',exact=True).fill('4')
                host.get_by_role('button',name='保存本场记录',exact=True).click()
                expect(host.get_by_role('button',name='保存本场记录',exact=True)).to_be_disabled()
            host.locator('.encounter-row').filter(has_text=data['npc']['name']).click()
            if rule=='dnd': host.get_by_role('button',name='直接结算伤害',exact=True).click()
            host.get_by_label('伤害目标',exact=True).select_option(label=actor)
            host.get_by_label('自动结算伤害骰式',exact=True).fill('10')
            if rule=='dnd': host.get_by_label('目标伤害修正',exact=True).select_option('resistant')
            host.get_by_role('button',name='掷伤害并扣血',exact=True).click()
            hp=data['card']['hp']-(1 if rule=='dnd' else 10)
            expect(player.locator('.resource-control').first.locator('b')).to_have_text(str(hp)+'/'+str(data['card']['maxHp']))
            expect(host.locator('.targeted-damage .combat-command-result')).to_contain_text('HP')
            host.locator('.encounter-row').filter(has_text=actor).click()
            expect(host.get_by_label('当前 HP',exact=True)).to_have_value(str(hp))
            if rule=='dnd': expect(host.get_by_label('临时 HP',exact=True)).to_have_value('0')
            passed(rule+' '+edition+' automatic damage synchronizes player HP and consumes mitigation/temp HP')
            if rule=='dnd':
                # Fixed damage avoids dependence on critical damage dice; inspect the real hit result.
                host.get_by_label('伤害目标',exact=True).select_option(label=data['npc']['name']+' · 1')
                host.get_by_label('定向攻击总加值',exact=True).fill('100')
                host.get_by_label('定向攻击投掷方式',exact=True).select_option('advantage')
                host.get_by_label('自动结算伤害骰式',exact=True).fill('4')
                for attempt in range(3):
                    host.get_by_role('button',name='攻击并自动结算',exact=True).click()
                    expect(host.locator('.targeted-damage .combat-command-result')).to_be_visible()
                    if 'HP 26' in host.locator('.target-resource').inner_text(): break
                expect(host.locator('.target-resource')).to_contain_text('HP 26')
                passed('D&D '+edition+' targeted hit applies damage to an independent NPC')
            else:
                host.get_by_label('进攻者',exact=True).select_option(label=actor)
                host.get_by_label('防守者',exact=True).select_option(label=data['npc']['name']+' · 1')
                host.get_by_label('进攻技能百分比',exact=True).fill('100')
                host.get_by_label('防守技能百分比',exact=True).fill('0')
                host.get_by_label('进攻方普通伤害',exact=True).fill('6')
                host.get_by_label('极难命中伤害',exact=True).fill('6')
                host.get_by_label('进攻骰',exact=True).select_option('advantage')
                host.get_by_label('防守骰',exact=True).select_option('disadvantage')
                for attempt in range(3):
                    host.get_by_role('button',name='掷骰并结算',exact=True).click()
                    expect(host.locator('.coc-melee-result')).to_be_visible()
                    host.locator('.encounter-row').filter(has_text=data['npc']['name']).click()
                    if host.get_by_label('当前 HP',exact=True).input_value() == '26': break
                expect(host.get_by_label('当前 HP',exact=True)).to_have_value('26')
                passed('CoC opposed melee applies 6 damage less 2 armor to the defender')
            for width in [1440,390,320]:
                host.set_viewport_size({'width':width,'height':1000 if width==1440 else 844})
                host.locator('.targeted-damage').scroll_into_view_if_needed()
                fit(host,rule+'-'+edition+'-combat-'+str(width))
                if width == 320:
                    if rule == 'dnd':
                        host.get_by_role('button',name='直接结算伤害',exact=True).click()
                        host.get_by_label('目标伤害修正',exact=True).select_option('normal')
                    target_option = host.get_by_label('伤害目标',exact=True).locator('option').filter(has_text=data['npc']['name']+' · 1').get_attribute('value')
                    host.get_by_label('伤害目标',exact=True).select_option(target_option)
                    host.get_by_label('自动结算伤害骰式',exact=True).fill('1' if rule=='dnd' else '3')
                    host.get_by_role('button',name='掷伤害并扣血',exact=True).click()
                    expect(host.locator('.target-resource')).to_contain_text('HP 25')
                    passed(rule+' '+edition+' mobile 320px controls apply one target damage without overflow')
            close(host)
            host.set_viewport_size({'width':1440,'height':1000})
            host.reload(wait_until='domcontentloaded')
            expect(host.locator('.room-title')).to_contain_text(rule+' '+edition)
            host_tools(host)
            expect(host.get_by_label('自动扣减生命值',exact=True)).to_be_checked()
            host.locator('.encounter-row').filter(has_text=actor).click()
            expect(host.get_by_label('当前 HP',exact=True)).to_have_value(str(hp))
            close(host)
            passed(rule+' '+edition+' 390/320 layouts and refresh retain combat settings/HP')
            host.get_by_role('button',name='切换深色模式',exact=True).click()
            host_tools(host)
            host.set_viewport_size({'width':320,'height':844})
            host.locator('.targeted-damage').scroll_into_view_if_needed()
            fit(host,rule+'-'+edition+'-combat-dark-320')
            close(host)
        assert not errors, errors
        passed('No uncaught browser errors')
    except Exception:
        for index, context in enumerate(contexts):
            for page in context.pages:
                try: page.screenshot(path=str(out/('failure-'+str(index)+'.png')),full_page=True)
                except Exception: pass
        raise
    finally:
        (out/'report.json').write_text(json.dumps({'checks':checks,'errors':errors},ensure_ascii=False,indent=2))
        browser.close()
