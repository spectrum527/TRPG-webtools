"""CoC locks, reusable resources, public/host room flows, and responsive layout."""
import argparse
import json
import re
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser()
parser.add_argument('--url',default='http://127.0.0.1:3118')
url=parser.parse_args().url
root=Path(__file__).resolve().parent.parent
out=root/'test-results/coc-expansion';out.mkdir(parents=True,exist_ok=True)
checks=[];errors=[]
def passed(text):
 checks.append(text);print('PASS',text,flush=True)
def nav(page,name):
 if page.locator('.sidebar').is_visible(): page.locator('.sidebar').get_by_role('button',name=name,exact=True).click()
 else:
  page.get_by_role('button',name='打开导航',exact=True).click()
  page.locator('.mobile-navigation').get_by_role('button',name=name,exact=True).click()
def close(page):page.get_by_role('dialog').last.get_by_role('button',name='关闭窗口',exact=True).click()
def tool(page,name):
 if not page.locator('.host-tool-links').is_visible():page.get_by_role('button',name='局内工具',exact=True).click()
 page.get_by_role('button',name=name,exact=True).click()
def tab(dialog,name):dialog.locator('.editor-tabs,.prep-main-tabs').get_by_role('button',name=name,exact=True).click()
def snapshot(page,name):
 page.wait_for_function("[...document.querySelectorAll('.page-enter')].filter(e=>e.getClientRects().length).every(e=>Number(getComputedStyle(e).opacity)>.99)")
 geometry=page.evaluate('''()=>({v:innerWidth,w:document.documentElement.scrollWidth,boxes:[...document.querySelectorAll('.modal:not([inert]),.modal:not([inert]) .modal-content')].map(e=>({w:e.clientWidth,s:e.scrollWidth}))})''')
 assert geometry['w']<=geometry['v']+1 and all(b['s']<=b['w']+1 for b in geometry['boxes']),(name,geometry)
 page.screenshot(path=str(out/(name+'.png')),animations='disabled')
def fixture():
 script="""import {createCharacter,deriveCharacter} from './shared/rules.ts';
import {suggestAllocation,defaultCreationPolicy} from './shared/creation.ts';
import {applyCocInvestigatorEdit} from './shared/coc-investigator.ts';
import {applyCocSessionEdit} from './shared/coc-session-rules.ts';
let c=createCharacter('coc',()=>3);c.name='陈默';c.occupation='记者';
c.attributes={str:50,con:50,siz:50,dex:60,app:50,int:60,pow:60,edu:60,luck:50};
c=deriveCharacter(c);c.hp=c.maxHp;c.mp=c.maxMp;c.san=60;
c=suggestAllocation(c,defaultCreationPolicy('coc'));
c=applyCocSessionEdit(c,{kind:'spell-save',spell:{id:'ward',name:'符文护盾',source:'主持人设定',description:'在短暂时间内保护施法者。',cost:{mp:0,hp:20,san:'0',minutes:0,rounds:0}}}).character;
c=applyCocSessionEdit(c,{kind:'spell-learn',spellId:'ward',confirmed:true}).character;
console.log(JSON.stringify(c));"""
 card=json.loads(subprocess.check_output(['node','--import','tsx','--input-type=module','-e',script],cwd=root,text=True))
 path=out/'character.json';path.write_text(json.dumps(card,ensure_ascii=False),encoding='utf8');return path,card

def choose(page):
 page.goto(url,wait_until='domcontentloaded');page.locator('.rule-card.coc .rule-choose').click()

with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 contexts=[]
 try:
  context=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True);contexts.append(context)
  page=context.new_page();page.set_default_timeout(15000);page.on('pageerror',lambda e:errors.append(str(e)))
  path,card=fixture()
  page.goto(url);nav(page,'角色档案');page.get_by_role('button',name='新建角色',exact=True).click();page.locator('.new-character-option.coc').click()
  dialog=page.get_by_role('dialog');dialog.get_by_label('导入角色卡文件').set_input_files(path)
  tab(dialog,'属性与状态')
  field=dialog.locator('.auto-value-field').filter(has=page.get_by_label('HP 上限',exact=True))
  expect(field.get_by_label('HP 上限',exact=True)).to_be_disabled()
  field.get_by_role('button',name='解锁HP 上限',exact=True).click()
  field.get_by_label('HP 上限计算方式',exact=True).select_option('manual')
  field.get_by_label('HP 上限',exact=True).fill('18')
  field.get_by_role('button',name='保存',exact=True).click()
  field.get_by_role('button',name='锁定HP 上限',exact=True).click()
  expect(field.get_by_label('HP 上限',exact=True)).to_be_disabled()
  expect(dialog.locator('.editor-mini-stats')).to_contain_text('10 / 18')
  field.scroll_into_view_if_needed();snapshot(page,'derived-desktop')
  passed('自动值锁定、解锁手改、再锁定，HP 上限提高不治疗')
  tab(dialog,'财产与账目')
  ledger=dialog.get_by_role('heading',name='记账',exact=True).locator('..')
  ledger.locator('select[name=operation]').select_option('income');ledger.get_by_label('金额',exact=True).fill('12.5');ledger.get_by_label('用途或原因',exact=True).fill('委托预付款');ledger.get_by_role('button',name='保存账目',exact=True).click()
  expect(ledger.get_by_text('委托预付款',exact=True)).to_be_visible()
  with page.expect_download() as download:dialog.get_by_role('button',name='JSON',exact=True).click()
  export=out/'edited.json';download.value.save_as(export);data=json.loads(export.read_text())
  assert data['cocInvestigator']['derived']['maxHp']=={'mode':'manual','locked':True,'manual':18}
  assert data['cocInvestigator']['wealth']['ledger'][0]['amount']==12.5
  passed('财产流水与锁状态可导出')
  for width,theme in [(1440,'dark'),(390,'light'),(390,'dark')]:
   page.set_viewport_size({'width':width,'height':1000 if width>400 else 844});page.evaluate("theme=>document.documentElement.dataset.theme=theme",theme)
   for label in ['属性与状态','武器与防具','财产与账目','法术与神话']:
    tab(dialog,label);snapshot(page,f'{label}-{width}-{theme}')
  close(page);page.set_viewport_size({'width':1440,'height':1000});page.evaluate("document.documentElement.dataset.theme='light'")
  nav(page,'主持人工具集');page.get_by_role('button',name='法术与神话',exact=True).click()
  page.get_by_role('button',name='添加法术',exact=True).click();page.get_by_label('名称',exact=True).fill('雾中低语');page.get_by_label('SAN 损失骰式',exact=True).fill('1d3');page.get_by_role('button',name='保存法术',exact=True).click()
  expect(page.get_by_role('heading',name='雾中低语',exact=True)).to_be_visible()
  with page.expect_download() as download:page.locator('.coc-library-toolbar').get_by_role('button',name='Markdown',exact=True).click()
  library=out/'library.md';download.value.save_as(library);assert '雾中低语' in library.read_text()
  page.reload();nav(page,'主持人工具集');page.get_by_role('button',name='法术与神话',exact=True).click();expect(page.get_by_role('heading',name='雾中低语',exact=True)).to_be_visible()
  snapshot(page,'host-library');passed('主持人法术库保存、刷新与 Markdown 导出')
  # A fresh host and player keep archive/editor state separate.
  host_context=browser.new_context(viewport={'width':1440,'height':1000});player_context=browser.new_context(viewport={'width':1440,'height':1000});contexts.extend([host_context,player_context])
  host=host_context.new_page();player=player_context.new_page()
  for q in [host,player]:q.set_default_timeout(15000);q.on('pageerror',lambda e:errors.append(str(e)))
  choose(host);host.get_by_label('你的称呼').fill('主持人');host.get_by_label('房间名称').fill('阿卡姆图书馆');host.get_by_role('button',name='创建房间，成为主持人',exact=True).click();code=host.locator('.room-code b').inner_text()
  choose(player);player.get_by_role('button',name='加入房间',exact=True).first.click();player.get_by_label('你的称呼').fill('玩家');player.get_by_label('房间码',exact=True).fill(code);player.locator('form').get_by_role('button',name='加入房间',exact=True).click()
  player.get_by_role('button',name='创建角色',exact=True).click();player.get_by_label('导入角色卡文件').set_input_files(path);player.get_by_role('button',name='保存并提交审核',exact=True).click()
  tool(host,'审核与制卡要求');host.get_by_role('button',name='通过此卡',exact=True).click();close(host)
  player.get_by_role('button',name='我准备好了',exact=True).click();host.get_by_role('button',name='我准备好了',exact=True).click();host.get_by_role('button',name='开启故事',exact=True).click()
  tool(host,'场景与回合');host.get_by_role('button',name='选用规则',exact=True).click()
  for label in ['允许幸运消耗','允许孤注一掷']:
   box=host.get_by_label(re.compile('^'+label));expect(box).not_to_be_checked();box.click();expect(box).to_be_checked()
  close(host);passed('幸运消耗与孤注一掷房间开关默认关闭且独立保存')
  player.get_by_role('button',name='检定',exact=True).click()
  player.locator('.check-tool select').first.select_option('ability');player.get_by_label('选择属性',exact=True).select_option('str')
  for attempt in range(30):
   count=player.locator('.log-event.check').count();player.get_by_role('button',name='进行检定',exact=True).click();expect(player.locator('.log-event.check')).to_have_count(count+1)
   roll=player.locator('.log-event.check').last
   if roll.get_by_role('button',name='申请孤注一掷',exact=True).count():break
  else:raise AssertionError('未产生可孤注一掷的失败检定')
  roll.get_by_role('button',name='申请孤注一掷',exact=True).click();roll.get_by_label('再次尝试的方法',exact=True).fill('利用撬杆再次推门');roll.get_by_label('可能的失败后果',exact=True).fill('弄出声响引来守卫');roll.get_by_role('button',name='提交主持人',exact=True).click()
  host.get_by_role('button',name='允许再次尝试',exact=True).click();roll.get_by_role('button',name='确认后果并重掷',exact=True).click();expect(roll).to_contain_text('孤注一掷 →')
  for attempt in range(30):
   count=player.locator('.log-event.check').count();player.get_by_role('button',name='进行检定',exact=True).click();expect(player.locator('.log-event.check')).to_have_count(count+1)
   roll=player.locator('.log-event.check').last
   options=roll.get_by_role('button',name=re.compile('^消耗 [0-9]+ 幸运'))
   if options.count():break
  else:raise AssertionError('未产生可幸运修正的检定')
  options.first.click();expect(roll).to_contain_text('幸运 −')
  passed('玩家申请、KP 批准孤注一掷及原骰关联；幸运消耗结果更新')
  tool(player,'角色准备');modal=player.get_by_role('dialog');expect(modal.get_by_role('heading',name='理智与成长',exact=True)).to_be_visible()
  modal.get_by_label('成功损失',exact=True).fill('1');modal.get_by_label('失败损失',exact=True).fill('1');modal.get_by_label('原因',exact=True).fill('地下室的异响');modal.get_by_role('button',name='投掷理智检定',exact=True).click()
  expect(modal.get_by_role('heading',name='待结算理智损失',exact=True)).to_be_visible()
  tool(host,'角色准备');host.get_by_role('button',name='结算 SAN 与疯狂',exact=True).click();close(host)
  expect(modal.locator('.allocation-summary').first).to_contain_text('59');expect(modal.locator('.allocation-summary').first).to_contain_text('1')
  passed('玩家公共 SAN 检定、KP 确认损失及当日累计')
  tab(modal,'法术与神话');modal.get_by_role('button',name='施法',exact=True).click();modal.get_by_role('button',name='确认施法',exact=True).click()
  confirmation=player.get_by_role('dialog',name='确认施法 HP 消耗',exact=True);expect(confirmation).to_be_visible();confirmation.get_by_role('button',name='取消施法',exact=True).click();expect(confirmation).to_have_count(0)
  expect(player.locator('.resource-control').first.locator('b')).to_have_text('10/10')
  modal.get_by_role('button',name='确认施法',exact=True).click();expect(confirmation).to_be_visible();confirmation.get_by_role('button',name='确认消耗 HP',exact=True).click();expect(confirmation).to_have_count(0)
  expect(player.locator('.resource-control').first.locator('b')).to_have_text('0/10')
  snapshot(player,'spell-hp-paid');passed('自动扣血关闭时危险施法仍确认；取消不扣 HP，确认仅支付一次')
  close(player);tool(host,'角色准备');modal=host.get_by_role('dialog')
  modal.get_by_text('修正幸运与当日记录',exact=True).click()
  counter=modal.locator('form').filter(has=host.get_by_label('当前幸运手动修正',exact=True))
  expect(counter.get_by_label('当前幸运手动修正',exact=True)).to_be_disabled()
  counter.get_by_role('button',name='解锁当前幸运记录',exact=True).click();expect(counter.get_by_label('当前幸运手动修正',exact=True)).to_be_enabled()
  counter.get_by_label('当前幸运手动修正',exact=True).fill('33');counter.get_by_label('修正原因',exact=True).fill('剧本奖励');counter.get_by_role('button',name='保存修正',exact=True).click();expect(counter.get_by_label('当前幸运手动修正',exact=True)).to_have_value('33')
  counter.get_by_role('button',name='锁定当前幸运记录',exact=True).click();expect(counter.get_by_label('当前幸运手动修正',exact=True)).to_be_disabled()
  expect(modal.locator('.allocation-summary')).to_contain_text('33');passed('当前幸运可独立解锁修正与再锁定')
  tab(modal,'衍生数值');expect(modal.get_by_role('button',name='解锁HP 上限',exact=True)).to_be_enabled()
  snapshot(host,'room-investigator')
  host.set_viewport_size({'width':390,'height':844});host.evaluate("document.documentElement.dataset.theme='dark'");tab(modal,'理智与成长');snapshot(host,'room-sanity-mobile-dark');tab(modal,'财产与账目');snapshot(host,'room-wealth-mobile-dark');close(host)
  assert not errors,errors
  passed('全部新界面零浏览器异常，桌面与移动端无横向溢出')
 except Exception:
  for label,q in [('page',locals().get('page')),('host',locals().get('host')),('player',locals().get('player'))]:
   if q and not q.is_closed():q.screenshot(path=str(out/f'failure-{label}.png'),animations='disabled')
  raise
 finally:
  (out/'checks.json').write_text(json.dumps({'checks':checks,'errors':errors},ensure_ascii=False,indent=2))
  for context in contexts:context.close()
  browser.close()
