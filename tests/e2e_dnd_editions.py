"""D&D edition, reference-library and character-editor acceptance in isolated Chrome.

Run against a built, running app: python tests/e2e_dnd_editions.py --url http://127.0.0.1:3001
Downloads and screenshots contain test data only and are saved in test-results/dnd-editions/.
"""
import argparse
import json
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:5173')
args = parser.parse_args()
out = Path('test-results/dnd-editions')
out.mkdir(parents=True, exist_ok=True)
for stale in ('failure.png', 'failure.txt'):
    (out / stale).unlink(missing_ok=True)
checks, errors = [], []


def passed(name):
    checks.append(name)
    print('PASS', name, flush=True)


def nav(page, name):
    if page.locator('.sidebar').is_visible():
        page.locator('.sidebar').get_by_role('button', name=name, exact=True).click()
    else:
        page.get_by_role('button', name='打开导航', exact=True).click()
        page.locator('.mobile-navigation').get_by_role('button', name=name, exact=True).click()


def edition(group, year):
    button = group.locator('button').filter(has_text=year)
    button.click()
    expect(button).to_have_attribute('aria-pressed', 'true')


def toolkit(page, section):
    nav(page, '主持人工具集')
    expect(page.locator('.host-toolkit')).to_be_visible()
    page.locator('.toolkit-rule-switch').get_by_role('button', name='D&D 5e', exact=True).click()
    page.locator('.dnd-preparation-nav').get_by_role('button', name=section, exact=True).click()
    expect(page.locator('.dnd-reference')).to_be_visible()


def search(page, term):
    page.get_by_label('搜索法术或专长').fill(term)


def detail(page, term):
    # Match the bilingual subtitle, not names such as Delayed Blast Fireball.
    title = page.locator('small').filter(has_text=re.compile(r'^' + re.escape(term) + r'(?:\s*·|$)'))
    result = page.locator('.reference-result').filter(has=title)
    expect(result).to_have_count(1)
    result.click()
    expect(page.locator('.reference-detail')).to_be_visible()
    return page.locator('.reference-detail')


def download(page, button, filename, selector='.reference-file-actions'):
    with page.expect_download() as event:
        page.locator(selector).get_by_role('button', name=button, exact=True).click()
    dest = out / filename
    event.value.save_as(str(dest))
    assert dest.is_file() and dest.stat().st_size > 0, filename
    return dest.resolve()


def backup_roundtrip(page, label, prefix):
    """Download both real formats and restore each after deleting the saved entry."""
    personal_tab = page.locator('.reference-toolbar .tabs').get_by_role('button', name=re.compile(label))
    personal_tab.click()
    expect(page.locator('.reference-result')).to_have_count(1)
    exported_json = download(page, 'JSON', f'{prefix}.json')
    exported_md = download(page, 'Markdown', f'{prefix}.md')
    document = json.loads(exported_json.read_text(encoding='utf8'))
    assert document['documentType'] == 'dnd-reference-collection' and len(document['entries']) == 1
    assert '```json' in exported_md.read_text(encoding='utf8')
    for file in (exported_json, exported_md):
        page.get_by_role('button', name='移出个人清单', exact=True).click()
        expect(page.locator('.reference-result')).to_have_count(0)
        page.get_by_label('导入法术或专长清单').set_input_files(str(file))
        expect(page.get_by_role('status')).to_contain_text('已导入 1 条资料')
        expect(page.locator('.reference-result')).to_have_count(1)
    return document['entries'][0]


def snapshot(page, name):
    page.wait_for_function("[...document.querySelectorAll('.page-enter')].filter(e=>e.getClientRects().length).every(e=>Number(getComputedStyle(e).opacity)>=0.99)")
    page.screenshot(path=str(out / name), full_page=False, animations='disabled')


def fit(page, label):
    geometry = page.evaluate('''() => ({viewport:innerWidth, height:innerHeight,
      document:document.documentElement.scrollWidth,
      dialogs:[...document.querySelectorAll('.modal')].filter(e=>e.getClientRects().length).map(e=>
        ({left:e.getBoundingClientRect().left, right:e.getBoundingClientRect().right,
          top:e.getBoundingClientRect().top, bottom:e.getBoundingClientRect().bottom,
          width:e.clientWidth, content:e.scrollWidth}))})''')
    assert geometry['document'] <= geometry['viewport'] + 1, (label, geometry)
    assert all(d['left'] >= -1 and d['right'] <= geometry['viewport'] + 1 and
               d['top'] >= -1 and d['bottom'] <= geometry['height'] + 1 and
               d['content'] <= d['width'] + 1 for d in geometry['dialogs']), (label, geometry)
    passed(f'{label}: no horizontal or modal overflow')


def close_editor(page):
    page.get_by_role('dialog').get_by_role('button', name='关闭窗口', exact=True).click()
    expect(page.get_by_role('dialog')).to_have_count(0)


def new_character(page, year):
    page.get_by_role('button', name='新建角色', exact=True).click()
    chooser = page.get_by_role('dialog')
    edition(chooser.locator('.dnd-edition-switch'), year)
    chooser.locator('.new-character-option.dnd').click()
    editor = page.get_by_role('dialog')
    expect(editor).to_be_visible()
    expect(editor).to_contain_text(year)
    return editor


with sync_playwright() as playwright:
    chrome = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    options = {'executable_path': str(chrome)} if chrome.exists() else {}
    browser = playwright.chromium.launch(headless=True, **options)
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
    page = context.new_page()
    page.set_default_timeout(15000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        page.goto(args.url, wait_until='domcontentloaded')
        home_switch = page.locator('.rule-card.dnd .dnd-edition-switch')
        expect(home_switch).to_be_visible()
        edition(home_switch, '2024')
        page.reload(wait_until='domcontentloaded')
        home_switch = page.locator('.rule-card.dnd .dnd-edition-switch')
        expect(home_switch.locator('button').filter(has_text='2024')).to_have_attribute('aria-pressed', 'true')
        edition(home_switch, '2014')
        passed('Homepage edition selection survives reload')

        toolkit(page, '法术书')
        expect(page.locator('.dnd-preparation-nav .dnd-edition-switch button').filter(has_text='2014')).to_have_attribute('aria-pressed', 'true')
        expect(page.get_by_label('资料来源')).to_have_value('core')
        search(page, 'Fireball')
        old = detail(page, 'Fireball')
        expect(old.locator('summary')).to_contain_text('玩家手册')
        old_text = old.locator('.reference-rule-text').inner_text()
        assert '绕过拐角' in old_text
        page.get_by_role('button', name='加入法术书', exact=True).click()
        expect(page.get_by_role('status')).to_contain_text('已加入')

        search(page, 'Absorb Elements')
        expect(page.locator('.reference-result')).to_have_count(0)
        page.get_by_label('资料来源').select_option('expansion')
        expansion = detail(page, 'Absorb Elements')
        expect(expansion.locator('summary')).to_contain_text('珊娜萨')
        page.get_by_label('资料来源').select_option('core')
        passed('2014 core and expansion sources stay separate and English spell search finds the source')

        edition(page.locator('.dnd-preparation-nav .dnd-edition-switch'), '2024')
        expect(page.get_by_label('资料来源')).to_have_value('core')
        search(page, 'Fireball')
        modern = detail(page, 'Fireball')
        expect(modern.locator('summary')).to_contain_text('玩家手册2024')
        modern_text = modern.locator('.reference-rule-text').inner_text()
        assert modern_text != old_text and '绕过拐角' not in modern_text
        page.get_by_role('button', name='加入法术书', exact=True).click()
        expect(page.get_by_role('status')).to_contain_text('已加入')
        passed('Fireball keeps independent 2014 and 2024 rule text and personal entries')

        page.reload(wait_until='domcontentloaded')
        expect(page.locator('.rule-card.dnd .dnd-edition-switch button').filter(has_text='2024')).to_have_attribute('aria-pressed', 'true')
        toolkit(page, '法术书')
        search(page, 'Fireball')
        page.get_by_role('button', name=re.compile('我的法术书')).click()
        expect(page.locator('.reference-result')).to_have_count(1)
        expect(page.locator('.reference-detail summary')).to_contain_text('玩家手册2024')
        passed('2024 personal spellbook survives a real reload')

        edition(page.locator('.dnd-preparation-nav .dnd-edition-switch'), '2014')
        search(page, 'Fireball')
        entry = backup_roundtrip(page, '我的法术书', 'spellbook-2014')
        assert entry['edition'] == '2014' and entry['nameEn'] == 'Fireball'
        passed('The 2014 spellbook downloads and reimports actual JSON and Markdown files')

        page.locator('.dnd-preparation-nav').get_by_role('button', name='专长', exact=True).click()
        search(page, 'Defensive Duelist')
        feat2014 = detail(page, 'Defensive Duelist')
        expect(feat2014).to_contain_text('敏捷13或更高')
        expect(feat2014.locator('summary')).to_contain_text('玩家手册')
        search(page, 'Fey Touched')
        expect(page.locator('.reference-result')).to_have_count(0)
        page.get_by_label('资料来源').select_option('expansion')
        expect(detail(page, 'Fey Touched').locator('summary')).to_contain_text('塔莎')
        page.get_by_label('资料来源').select_option('core')
        edition(page.locator('.dnd-preparation-nav .dnd-edition-switch'), '2024')
        search(page, 'Defensive Duelist')
        feat2024 = detail(page, 'Defensive Duelist')
        expect(feat2024).to_contain_text('等级4+')
        expect(feat2024).to_contain_text('通用专长')
        expect(feat2024.locator('summary')).to_contain_text('玩家手册2024')
        page.get_by_role('button', name='收藏专长', exact=True).click()
        expect(page.get_by_role('status')).to_contain_text('已加入')
        entry = backup_roundtrip(page, '我的专长', 'feat-2024')
        assert entry['edition'] == '2024' and entry['nameEn'] == 'Defensive Duelist'
        page.reload(wait_until='domcontentloaded')
        toolkit(page, '专长')
        search(page, 'Defensive Duelist')
        page.get_by_role('button', name=re.compile('我的专长')).click()
        expect(page.locator('.reference-result')).to_have_count(1)
        expect(page.locator('.reference-detail summary')).to_contain_text('玩家手册2024')
        passed('Feat search preserves edition-specific prerequisites, and both backup formats restore')

        page.set_viewport_size({'width': 1440, 'height': 1000})
        fit(page, 'Reference desktop light')
        snapshot(page, 'reference-desktop-light.png')
        page.get_by_role('button', name='切换深色模式', exact=True).click()
        fit(page, 'Reference desktop dark')
        snapshot(page, 'reference-desktop-dark.png')
        for width in (390, 320):
            page.set_viewport_size({'width': width, 'height': 844})
            fit(page, f'Reference mobile {width}')
            snapshot(page, f'reference-mobile-{width}.png')
            page.locator('.reference-result').first.click()
            fit(page, f'Reference detail mobile {width}')
            snapshot(page, f'reference-detail-mobile-{width}.png')
            page.get_by_role('button', name='返回目录', exact=True).click()
        page.set_viewport_size({'width': 1440, 'height': 1000})
        page.get_by_role('button', name='切换浅色模式', exact=True).click()

        nav(page, '角色档案')
        editor = new_character(page, '2024')
        editor.get_by_label('角色姓名').fill('版本验收的精灵战士')
        editor.locator('select').first.select_option(label='战士')
        editor.get_by_label('种族', exact=True).fill('精灵')
        editor.locator('input[list="dnd-backgrounds-2024"]').fill('侍僧')
        editor.get_by_role('button', name='技能与熟练', exact=True).click()
        expect(editor.get_by_text('侍僧：固定背景技能', exact=False)).to_be_visible()
        editor.get_by_role('button', name='建议分配', exact=True).click()
        background = editor.locator('fieldset').filter(has_text='背景技能')
        expect(background.locator('input:checked')).to_have_count(2)
        ancestry = editor.locator('fieldset').filter(has_text='种族自选技能')
        expect(ancestry.locator('input:checked')).to_have_count(1)
        profession = editor.locator('fieldset').filter(has_text='职业技能')
        expect(profession.locator('input:checked')).to_have_count(2)
        editor.get_by_role('button', name='属性与状态', exact=True).click()
        editor.get_by_label('感知属性', exact=True).fill('16')
        passive = editor.get_by_label('启用被动察觉')
        passive.check()
        expect(editor.get_by_label('被动察觉值')).to_have_text('15')
        char_json = download(page, 'JSON', 'character-2024-on.json', selector='.character-editor .export-buttons')
        char_md = download(page, 'Markdown', 'character-2024-on.md', selector='.character-editor .export-buttons')
        character = json.loads(char_json.read_text(encoding='utf8'))
        assert character['dndEdition'] == '2024' and character['passivePerceptionEnabled'] is True
        assert character['attributes']['wis'] == 16 and character['creation']['backgroundSkills'] == ['insight', 'religion']
        assert len(character['creation']['classSkills']) == 2 and character['creation']['ancestrySkills'] == ['perception']
        assert '被动察觉 15' in char_md.read_text(encoding='utf8')
        passive.uncheck()
        expect(editor.get_by_label('被动察觉值')).to_have_count(0)
        off_json = download(page, 'JSON', 'character-2024-off.json', selector='.character-editor .export-buttons')
        assert json.loads(off_json.read_text(encoding='utf8'))['passivePerceptionEnabled'] is False
        passive.check()
        expect(editor.get_by_label('被动察觉值')).to_have_text('15')
        passed('2024 background, ancestry and class recommendation persist; passive perception toggles and exports')

        fit(page, 'Character desktop light')
        snapshot(page, 'character-desktop-light.png')
        for width in (390, 320):
            page.set_viewport_size({'width': width, 'height': 844})
            fit(page, f'Character mobile {width}')
            snapshot(page, f'character-mobile-{width}.png')
        page.set_viewport_size({'width': 1440, 'height': 1000})
        editor.get_by_role('button', name='保存角色卡', exact=True).click()
        expect(page.get_by_role('dialog')).to_have_count(0)
        page.reload(wait_until='domcontentloaded')
        nav(page, '角色档案')
        card = page.locator('.character-card').filter(has_text='版本验收的精灵战士')
        expect(card).to_be_visible()
        expect(card).to_contain_text('2024')
        page.get_by_role('button', name='切换深色模式', exact=True).click()
        card.get_by_role('button', name='打开角色卡').click()
        editor = page.get_by_role('dialog')
        editor.get_by_role('button', name='属性与状态', exact=True).click()
        expect(editor.get_by_label('启用被动察觉')).to_be_checked()
        expect(editor.get_by_label('被动察觉值')).to_have_text('15')
        fit(page, 'Character desktop dark')
        snapshot(page, 'character-desktop-dark.png')
        for width in (390, 320):
            page.set_viewport_size({'width': width, 'height': 844})
            fit(page, f'Character mobile dark {width}')
            snapshot(page, f'character-mobile-dark-{width}.png')
        page.set_viewport_size({'width': 1440, 'height': 1000})
        close_editor(page)
        page.get_by_role('button', name='切换浅色模式', exact=True).click()
        passed('Saved 2024 character and passive perception survive browser reload')

        editor = new_character(page, '2014')
        editor.get_by_label('角色姓名').fill('保留的旧版底稿')
        editor.locator('select').first.select_option(label='战士')
        editor.get_by_label('导入角色卡文件').set_input_files(str(char_json))
        expect(editor.get_by_role('alert')).to_contain_text('版次不匹配')
        expect(editor.get_by_label('角色姓名')).to_have_value('保留的旧版底稿')
        editor.get_by_label('导入角色卡文件').set_input_files(str(char_md))
        expect(editor.get_by_role('alert')).to_contain_text('版次不匹配')
        expect(editor.get_by_label('角色姓名')).to_have_value('保留的旧版底稿')
        old_json = download(page, 'JSON', 'character-2014.json', selector='.character-editor .export-buttons')
        assert json.loads(old_json.read_text(encoding='utf8')).get('dndEdition', '2014') == '2014'
        close_editor(page)
        editor = new_character(page, '2024')
        editor.get_by_label('角色姓名').fill('保留的新版底稿')
        editor.get_by_label('导入角色卡文件').set_input_files(str(old_json))
        expect(editor.get_by_role('alert')).to_contain_text('版次不匹配')
        expect(editor.get_by_label('角色姓名')).to_have_value('保留的新版底稿')
        for file in (char_json, char_md):
            editor.get_by_role('button', name='角色资料', exact=True).click()
            editor.get_by_label('角色姓名').fill('等待同版导入')
            editor.get_by_label('导入角色卡文件').set_input_files(str(file))
            expect(editor.get_by_label('角色姓名')).to_have_value('版本验收的精灵战士')
            expect(editor.get_by_role('alert')).to_have_count(0)
            editor.get_by_role('button', name='属性与状态', exact=True).click()
            expect(editor.get_by_label('启用被动察觉')).to_be_checked()
            expect(editor.get_by_label('被动察觉值')).to_have_text('15')
        passed('Cross-edition character imports are blocked without overwriting drafts; same-edition JSON and Markdown restore')
        assert not errors, errors
        passed('No browser page errors during the exercised flows')
    except Exception:
        try:
            page.screenshot(path=str(out / 'failure.png'), full_page=False)
            (out / 'failure.txt').write_text(page.locator('body').inner_text(), encoding='utf8')
        except Exception:
            pass
        raise
    finally:
        (out / 'acceptance.json').write_text(json.dumps({'checks': checks, 'browserErrors': errors}, ensure_ascii=False, indent=2), encoding='utf8')
        context.close()
        browser.close()
    print(f'Completed {len(checks)} D&D edition checks.', flush=True)
