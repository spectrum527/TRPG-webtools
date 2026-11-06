"""Exercise room resources and encounter preparation in isolated host/player browsers.

Run against a built, running app:
    python3 tests/e2e_session_resources.py --url http://127.0.0.1:3105
Use --fixtures-only to validate the two-version test fixtures without starting a browser.
Screenshots, fixtures, and a report are saved in test-results/session-resources/.
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:3105')
parser.add_argument('--fixtures-only', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
out = root / 'test-results/session-resources'
out.mkdir(parents=True, exist_ok=True)
checks, errors = [], []
PRIVATE_NOTE = '隐秘验收线索：守卫暗藏的宝箱与主持人计划'
PRIVATE_RESTORE_REASON = '验收专用私密裁定：圣徽补充了一次资源'


def passed(label):
    checks.append(label)
    print('PASS', label, flush=True)


def fixtures(edition):
    script = r'''import {readFileSync} from 'node:fs';
import {createCharacter,deriveCharacter,getCharacterErrors} from './shared/rules.ts';
import {suggestAllocation,defaultCreationPolicy,validateCreation} from './shared/creation.ts';
import {createDndMagicState,getDndMagicErrors} from './shared/dnd-magic.ts';
import {createDndEquipmentState,itemFromEquipmentCatalog} from './shared/dnd-equipment.ts';
import {createDndStatBlock} from './shared/dnd.ts';
import {EncounterPlanSchema} from './shared/preparation.ts';
const edition=process.argv[1], secret=process.argv[2];
const spells=JSON.parse(readFileSync(`public/rules/dnd-${edition}.json`,'utf8')).spells;
const items=JSON.parse(readFileSync(`public/rules/equipment-${edition}.json`,'utf8')).items;
const findSpell=(name)=>{
  const s=spells.find(x=>x.nameZh===name && x.source.category==='core' && x.classes?.includes('牧师'));
  if(!s) throw Error('missing spell '+name);
  return s;
};
const item=(name)=>{
  const entry=items.find(x=>x.name===name);
  if(!entry) throw Error('missing equipment '+name);
  return itemFromEquipmentCatalog(entry);
};
let card=createCharacter('dnd',()=>3,undefined,edition);
card.name=`${edition} 验收牧师`;card.occupation='牧师';card.ancestry='人类';card.background='侍僧';card.level=3;
card.attributes={str:10,dex:14,con:14,int:12,wis:16,cha:10};
card=deriveCharacter(card);card.hp=30;card.maxHp=30;card.passivePerceptionEnabled=true;
card=suggestAllocation(card,defaultCreationPolicy('dnd'));
card.dndMagic=createDndMagicState();
card.dndMagic.cantrips=[findSpell('神导术').id];card.dndMagic.prepared=[findSpell('祝福术').id];
card.dndMagic.customResources=[
  {id:'test-short-resource',name:'短休验收',max:3,used:0,recovery:'short'},
  {id:'test-long-resource',name:'长休验收',max:2,used:0,recovery:'long'},
];
card.dndEquipment=createDndEquipmentState();
const armor=item('皮甲'),shield=item('盾牌'),bow=item('短弓'),arrows=item(edition==='2014'?'箭':'箭矢');
armor.equipment.equipped=true;shield.equipment.equipped=true;
card.items=[armor,shield,bow,arrows];
const allErrors=[...getCharacterErrors(card),...validateCreation(card,defaultCreationPolicy('dnd')),
  ...getDndMagicErrors(card,id=>spells.find(s=>s.id===id))];
if(allErrors.length) throw Error('invalid character fixture: '+allErrors.join('; '));
function npc(name){const n=createDndStatBlock('npc-blank',edition);n.name=name;n.hp=20;n.maxHp=20;
  n.ac=11;n.attributes.dex=10;n.notes=secret;return n;}
const plan=EncounterPlanSchema.parse({documentType:'encounter-plan',schemaVersion:1,
  id:`test-plan-${edition}`,name:`${edition} 双波遭遇`,rule:'dnd',dndEdition:edition,
  waves:[{id:'wave-one',name:'第一波',entries:[{id:'entry-one',card:npc('前锋守卫'),count:1}]},
    {id:'wave-two',name:'第二波',entries:[{id:'entry-two',card:npc('后援守卫'),count:1}]}],
  loot:'一枚铜制徽记',notes:secret});
console.log(JSON.stringify({card,plan}));'''
    result = json.loads(subprocess.check_output(
        ['node', '--import', 'tsx', '--input-type=module', '-e', script, edition, PRIVATE_NOTE],
        cwd=root, text=True,
    ))
    for kind in ('card', 'plan'):
        (out / f'{edition}-{kind}.json').write_text(
            json.dumps(result[kind], ensure_ascii=False, indent=2), encoding='utf8'
        )
    return result


def choose(page, edition):
    page.goto(args.url, wait_until='domcontentloaded')
    page.locator('.rule-card.dnd .dnd-edition-switch button').filter(has_text=edition).click()
    page.locator('.rule-card.dnd .rule-choose').click()


def close(page):
    page.get_by_role('dialog').get_by_role('button', name='关闭窗口', exact=True).click()
    expect(page.get_by_role('dialog')).to_have_count(0)


def open_tool(page, name):
    if not page.locator('.host-tool-links').is_visible():
        page.get_by_role('button', name='局内工具', exact=True).click()
    page.get_by_role('button', name=name, exact=True).click()
    expect(page.get_by_role('dialog')).to_be_visible()
    return page.get_by_role('dialog')


def host_combat(page):
    if not page.locator('.host-tool-links').is_visible():
        page.get_by_role('button', name='局内工具', exact=True).click()
    page.get_by_role('button', name='场景与回合', exact=True).click()
    page.get_by_role('button', name=re.compile('^行动与状态')).click()
    expect(page.locator('.encounter-panel')).to_be_visible()


def player_combat(page):
    if not page.locator('.tools-panel').is_visible():
        page.get_by_role('button', name='局内工具', exact=True).click()
    page.get_by_role('button', name='本场战斗', exact=True).click()
    expect(page.locator('.encounter-panel')).to_be_visible()


def fit_and_snapshot(page, name):
    dimensions = page.evaluate('''() => ({viewport:innerWidth,height:innerHeight,
      document:document.documentElement.scrollWidth,
      panels:[...document.querySelectorAll('.modal,.modal-content,.encounter-detail,.targeted-damage')]
        .filter(e=>e.getClientRects().length).map(e=>({width:e.clientWidth,content:e.scrollWidth}))})''')
    assert dimensions['document'] <= dimensions['viewport'] + 1, (name, dimensions)
    assert all(panel['content'] <= panel['width'] + 1 for panel in dimensions['panels']), (name, dimensions)
    page.screenshot(path=str(out / f'{name}.png'), full_page=False, animations='disabled')


def metric(container, label):
    return container.locator('.prep-metrics > div').filter(has_text=label).locator('strong')


def inventory_card(page, name):
    return page.locator('.equipment-inventory .equipment-card').filter(
        has=page.get_by_role('heading', name=name, exact=True)
    )


def resource(page, name):
    return page.locator('.character-magic .prep-resource').filter(has_text=name)


def first_slot(page):
    return page.locator('.spell-slot').filter(has_text='1 环').locator('strong')


def spell_cast(page):
    magic = page.locator('.character-magic')
    magic.get_by_label('搜索角色法术').fill('Bless')
    row = magic.locator('.prep-spell-row').filter(has=page.get_by_text('祝福术', exact=True))
    expect(row).to_have_count(1)
    row.click()
    expect(magic.locator('.prep-spell-detail h4')).to_have_text('祝福术')
    expect(magic.get_by_label('施法方式')).to_have_value('slot')
    expect(first_slot(page)).to_have_text('4 / 4')
    magic.get_by_role('button', name='施放并记账', exact=True).click()
    expect(first_slot(page)).to_have_text('3 / 4')
    expect(magic.locator('.prep-concentration')).to_contain_text('祝福术')


def rest(page, kind):
    details = page.locator('.character-magic details.prep-details').filter(has_text='休息与恢复')
    if details.get_attribute('open') is None:
        details.locator('summary').click()
    details.get_by_role('button', name=kind, exact=True).click()
    details.get_by_label('确认休息条件').check()
    details.get_by_role('button', name=f'完成{kind}并恢复', exact=True).click()
    expect(details.get_by_label('确认休息条件')).not_to_be_checked()


def assert_private(page):
    expect(page.locator('body')).not_to_contain_text(PRIVATE_NOTE)


if args.fixtures_only:
    for edition in ('2014', '2024'):
        fixtures(edition)
        print(f'PASS {edition} character and two-wave plan fixtures', flush=True)
    sys.exit(0)

for stale in out.glob('failure-*'):
    stale.unlink()

with sync_playwright() as playwright:
    chrome = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    options = {'executable_path': str(chrome)} if chrome.exists() else {}
    browser = playwright.chromium.launch(headless=True, **options)
    contexts = []

    def new_page():
        context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
        contexts.append(context)
        page = context.new_page()
        page.set_default_timeout(15000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        return page

    try:
        for edition in ('2014', '2024'):
            data = fixtures(edition)
            name = data['card']['name']
            plan_name = data['plan']['name']
            arrow = '箭' if edition == '2014' else '箭矢'
            host, player = new_page(), new_page()

            choose(host, edition)
            host.get_by_label('你的称呼').fill('验收主持人')
            host.get_by_label('房间名称').fill(f'{edition} 法术装备验收')
            host.get_by_role('button', name='创建房间，成为主持人').click()
            expect(host.locator('.room-title h1')).to_be_visible()
            code = host.locator('.room-code b').inner_text()
            choose(player, edition)
            player.get_by_role('button', name='加入房间', exact=True).first.click()
            player.get_by_label('你的称呼').fill('验收玩家')
            player.get_by_label('房间码', exact=True).fill(code)
            player.locator('form').get_by_role('button', name='加入房间', exact=True).click()
            expect(player.locator('.room-title h1')).to_be_visible()
            player.get_by_role('button', name='创建角色', exact=True).click()
            player.get_by_label('导入角色卡文件').set_input_files(str(out / f'{edition}-card.json'))
            player.get_by_role('button', name='保存并提交审核', exact=True).click()
            expect(player.get_by_role('dialog')).to_have_count(0)
            player.get_by_role('button', name='我准备好了', exact=True).click()
            host.get_by_role('button', name='我准备好了', exact=True).click()
            review = open_tool(host, '审核与制卡要求')
            expect(review.get_by_label('法术与资源审核')).to_contain_text('自定义资源 2 项')
            expect(review.get_by_label('装备联动审核')).to_contain_text('生效 AC 15')
            review.get_by_role('button', name='通过此卡', exact=True).click()
            expect(review.get_by_role('button', name='已通过审核', exact=True)).to_be_visible()
            close(host)
            host.get_by_role('button', name='开启故事', exact=True).click()
            expect(player.locator('.status-pill')).to_contain_text('故事进行中')
            passed(f'{edition}: independent host/player join, import, review and start')

            prepare = open_tool(player, '角色准备')
            spell_cast(player)
            if edition == '2024':
                player.locator('.character-magic .prep-section-heading').first.scroll_into_view_if_needed()
                for width in (1440, 390, 320):
                    player.set_viewport_size({'width': width, 'height': 1000 if width == 1440 else 844})
                    fit_and_snapshot(player, f'{edition}-player-magic-{width}')
                player.set_viewport_size({'width': 1440, 'height': 1000})
            overview = open_tool(host, '队伍总览')
            member = overview.locator('.party-overview-card').filter(has_text=name)
            expect(member).to_contain_text('专注 · 祝福术')
            expect(member).to_contain_text('5/6')
            close(host)
            resource(player, '短休验收').get_by_role('button', name='消耗', exact=True).click()
            expect(resource(player, '短休验收')).to_contain_text('2 / 3')
            resource(player, '长休验收').get_by_role('button', name='消耗', exact=True).click()
            expect(resource(player, '长休验收')).to_contain_text('1 / 2')
            expect(player.get_by_label('手动恢复项目')).to_have_count(0)
            expect(player.locator('body')).not_to_contain_text('主持人手动恢复')
            host_prepare = open_tool(host, '角色准备')
            host_restore = host_prepare.locator('details.prep-details').filter(has_text='主持人手动恢复')
            host_restore.locator('summary').click()
            host_restore.get_by_label('手动恢复项目').select_option(label='短休验收 · 已用 1')
            host_restore.get_by_label('手动恢复数量').fill('1')
            host_restore.get_by_label('手动恢复依据').fill(PRIVATE_RESTORE_REASON)
            host_restore.get_by_role('button', name='确认恢复', exact=True).click()
            expect(resource(player, '短休验收')).to_contain_text('3 / 3')
            expect(host_restore.get_by_label('手动恢复依据')).to_have_value('')
            close(host)
            expect(host.locator('body')).to_contain_text(PRIVATE_RESTORE_REASON)
            expect(player.get_by_label('手动恢复项目')).to_have_count(0)
            expect(player.locator('body')).not_to_contain_text(PRIVATE_RESTORE_REASON)
            resource(player, '短休验收').get_by_role('button', name='消耗', exact=True).click()
            expect(resource(player, '短休验收')).to_contain_text('2 / 3')
            passed(f'{edition}: host manual restoration synchronizes the resource and keeps its reason private')
            player.get_by_role('button', name='结束专注', exact=True).click()
            expect(player.locator('.prep-concentration')).to_have_count(0)
            rest(player, '短休')
            expect(resource(player, '短休验收')).to_contain_text('3 / 3')
            expect(resource(player, '长休验收')).to_contain_text('1 / 2')
            expect(first_slot(player)).to_have_text('3 / 4')
            rest(player, '长休')
            expect(resource(player, '长休验收')).to_contain_text('2 / 2')
            expect(first_slot(player)).to_have_text('4 / 4')
            passed(f'{edition}: Bless uses a slot and concentration; short and long rests restore the correct resources')

            prepare.locator('.prep-main-tabs').get_by_role('button', name='装备与负重', exact=True).click()
            equipment = player.locator('.character-equipment')
            expect(metric(equipment, '当前 AC')).to_have_text('15')
            inventory_card(player, '盾牌').get_by_role('button', name='已穿戴 · 收起', exact=True).click()
            expect(metric(equipment, '当前 AC')).to_have_text('13')
            inventory_card(player, '短弓').get_by_role('button', name='穿戴 / 持用', exact=True).click()
            expect(inventory_card(player, '短弓')).to_have_class(re.compile(r'\bequipped\b'))
            overview = open_tool(host, '队伍总览')
            member = overview.locator('.party-overview-card').filter(has_text=name)
            expect(member.locator('.party-overview-stats')).to_contain_text('AC 13')
            expect(member.locator('.party-state-note')).to_have_count(0)
            close(host)
            close(player)
            passed(f'{edition}: changing equipment immediately updates AC in the host party overview')

            plans = open_tool(host, '遭遇预案')
            plans.locator('.encounter-plans input[type=file]').set_input_files(str(out / f'{edition}-plan.json'))
            expect(plans.get_by_role('status')).to_contain_text('已导入 1 份预案')
            plan = plans.locator('.prep-plan-card').filter(has_text=plan_name)
            expect(plan).to_contain_text('第一波')
            expect(plan).to_contain_text('第二波')
            plan.get_by_role('button', name='带入房间', exact=True).click()
            expect(plans.get_by_role('status')).to_contain_text('已带入房间')
            plans.get_by_role('button', name='本桌预案', exact=True).click()
            plan = plans.locator('.prep-plan-card').filter(has_text=plan_name)
            plan.locator('summary').filter(has_text='主持人笔记').click()
            expect(plan).to_contain_text(PRIVATE_NOTE)
            assert_private(player)
            waves = plan.locator('.prep-plan-waves > div')
            first, second = waves.nth(0), waves.nth(1)
            first.get_by_role('button', name='载入波次', exact=True).click()
            again = first.get_by_role('button', name='再次载入', exact=True)
            expect(again).to_be_disabled()
            expect(second.get_by_role('button', name='载入波次', exact=True)).to_be_enabled()
            first.get_by_label('确认再次加入').check()
            expect(again).to_be_enabled()
            again.click()
            expect(first.get_by_label('确认再次加入')).not_to_be_checked()
            expect(again).to_be_disabled()
            assert_private(player)
            close(host)
            passed(f'{edition}: personal two-wave plan transfers privately, and repeat loading requires confirmation')

            host_combat(host)
            expect(host.locator('.encounter-row')).to_have_count(3)
            npc = host.locator('.encounter-row').filter(has_text='前锋守卫 · 1')
            npc.click()
            host.get_by_label('伙伴归属', exact=True).select_option(label=name)
            expect(host.get_by_label('伙伴归属', exact=True)).not_to_have_value('')
            host.get_by_label('公开显示名称', exact=True).fill('同行守卫')
            host.get_by_label('向玩家公开名称、行动顺序与状态').check()
            host.get_by_role('button', name='保存本场记录', exact=True).click()
            expect(host.get_by_role('button', name='保存本场记录', exact=True)).to_be_disabled()
            player_combat(player)
            companion = player.locator('.encounter-row').filter(has_text='同行守卫')
            expect(companion).to_have_count(1)
            companion.click()
            expect(player.get_by_label('伙伴管理')).to_contain_text('HP 20 / 20')
            player.get_by_label('伙伴管理').get_by_role('button', name='-5 HP', exact=True).click()
            expect(player.get_by_label('伙伴管理')).to_contain_text('HP 15 / 20')
            expect(host.get_by_label('当前 HP', exact=True)).to_have_value('15')
            assert_private(player)
            close(player)
            passed(f'{edition}: revealed assigned companion HP edits synchronize to the host without private notes')

            host.locator('.encounter-row').filter(has_text=name).click()
            damage = host.locator('.targeted-damage')
            damage.get_by_label('角色武器').select_option(label='短弓')
            damage.get_by_label('伤害目标').select_option(label='前锋守卫 · 2')
            damage.get_by_label('攻击弹药').select_option(label=f'{arrow} · 剩余 20')
            confirmation = damage.get_by_label('目录未完整编码类型，主持人已确认这份弹药适用')
            if confirmation.count() and confirmation.is_visible():
                confirmation.check()
            damage.get_by_role('button', name='攻击检定（不扣血）', exact=True).click()
            expect(damage.locator('.combat-command-result')).to_be_visible()
            prepare = open_tool(player, '角色准备')
            prepare.locator('.prep-main-tabs').get_by_role('button', name='装备与负重', exact=True).click()
            expect(inventory_card(player, arrow)).to_contain_text('× 19')
            expect(inventory_card(player, '短弓')).to_have_class(re.compile(r'\bequipped\b'))
            assert_private(player)
            close(player)
            passed(f'{edition}: host attacks with the equipped shortbow and the selected arrow is consumed')

            for width in (1440, 390, 320):
                host.set_viewport_size({'width': width, 'height': 1000 if width == 1440 else 844})
                host.locator('.targeted-damage').scroll_into_view_if_needed()
                fit_and_snapshot(host, f'{edition}-host-combat-{width}')
            close(host)
            host.set_viewport_size({'width': 1440, 'height': 1000})
            host.reload(wait_until='domcontentloaded')
            expect(host.locator('.room-title')).to_contain_text(edition)
            host_combat(host)
            expect(host.locator('.encounter-row')).to_have_count(3)
            host.locator('.encounter-row').filter(has_text='前锋守卫 · 1').click()
            expect(host.get_by_label('当前 HP', exact=True)).to_have_value('15')
            close(host)
            passed(f'{edition}: running encounter and companion HP survive host refresh')
        assert not errors, errors
        passed('No uncaught browser errors')
    except Exception:
        for index, context in enumerate(contexts):
            for page_index, page in enumerate(context.pages):
                try:
                    page.screenshot(path=str(out / f'failure-{index}-{page_index}.png'), full_page=True)
                    (out / f'failure-{index}-{page_index}.txt').write_text(
                        page.locator('body').inner_text(), encoding='utf8'
                    )
                except Exception:
                    pass
        raise
    finally:
        (out / 'report.json').write_text(
            json.dumps({'checks': checks, 'errors': errors}, ensure_ascii=False, indent=2), encoding='utf8'
        )
        for context in contexts:
            context.close()
        browser.close()
    print(f'Completed {len(checks)} session resource checks.', flush=True)
