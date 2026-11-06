"""Exercise D&D character spells and equipment through the real browser UI.

Run against a built, running app:
    python3 tests/e2e_character_preparation.py --url http://127.0.0.1:3103

The test uses a fresh browser context. Downloads, screenshots, and a small check
report are written to test-results/character-preparation/.
"""

import argparse
import json
import re
from pathlib import Path
from urllib.parse import urljoin

from playwright.sync_api import expect, sync_playwright


parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:5173')
args = parser.parse_args()
out = Path('test-results/character-preparation')
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


def choose_edition(group, year):
    button = group.locator('button').filter(has_text=year)
    button.click()
    expect(button).to_have_attribute('aria-pressed', 'true')


def new_character(page, year):
    page.get_by_role('button', name='新建角色', exact=True).click()
    chooser = page.get_by_role('dialog')
    choose_edition(chooser.locator('.dnd-edition-switch'), year)
    chooser.locator('.new-character-option.dnd').click()
    editor = page.get_by_role('dialog')
    expect(editor).to_be_visible()
    expect(editor).to_contain_text(year)
    return editor


def close_editor(page):
    page.get_by_role('dialog').get_by_role('button', name='关闭窗口', exact=True).click()
    expect(page.get_by_role('dialog')).to_have_count(0)


def section(editor, name):
    editor.locator('.editor-tabs').get_by_role('button', name=name, exact=True).click()


def metric(container, label):
    return container.locator('.prep-metrics > div').filter(has_text=label).locator('strong')


def snapshot(page, name):
    page.wait_for_function("[...document.querySelectorAll('.page-enter')].filter(e=>e.getClientRects().length).every(e=>Number(getComputedStyle(e).opacity)>=0.99)")
    page.screenshot(path=str(out / name), full_page=False, animations='disabled')


def show_preparation_heading(editor, tab):
    section(editor, tab)
    root = '.character-magic' if tab == '法术与资源' else '.character-equipment'
    editor.locator(f'{root} .prep-section-heading').first.scroll_into_view_if_needed()


def fit(page, label):
    geometry = page.evaluate('''() => ({viewport: innerWidth, height: innerHeight,
      document: document.documentElement.scrollWidth,
      dialogs: [...document.querySelectorAll('.modal')].filter(e => e.getClientRects().length).map(e =>
        ({left: e.getBoundingClientRect().left, right: e.getBoundingClientRect().right,
          top: e.getBoundingClientRect().top, bottom: e.getBoundingClientRect().bottom,
          width: e.clientWidth, content: e.scrollWidth}))})''')
    assert geometry['document'] <= geometry['viewport'] + 1, (label, geometry)
    assert all(d['left'] >= -1 and d['right'] <= geometry['viewport'] + 1 and
               d['top'] >= -1 and d['bottom'] <= geometry['height'] + 1 and
               d['content'] <= d['width'] + 1 for d in geometry['dialogs']), (label, geometry)


def spell_row(page, editor, shelf, query, name):
    magic = editor.locator('.character-magic')
    magic.locator('.prep-chip-tabs').get_by_role('button', name=re.compile('^' + re.escape(shelf))).click()
    magic.get_by_label('搜索角色法术').fill(query)
    row = magic.locator('.prep-spell-row').filter(has=page.get_by_text(name, exact=True))
    expect(row).to_have_count(1)
    return row


def add_equipment(page, editor, name, expected_quantity=1):
    library = editor.locator('.equipment-library')
    library.get_by_label('搜索装备').fill(name)
    row = library.locator('.prep-spell-row').filter(has=page.get_by_text(name, exact=True))
    expect(row).to_have_count(1)
    row.click()
    expect(library.locator('.prep-spell-detail h4')).to_have_text(name)
    library.get_by_role('button', name=re.compile(r'^加入行囊')).click()
    item = inventory_card(page, editor, name)
    expect(item).to_have_count(1)
    expect(item.get_by_label(f'{name}数量')).to_have_value(str(expected_quantity))
    return item


def inventory_card(page, editor, name):
    return editor.locator('.equipment-inventory .equipment-card').filter(
        has=page.get_by_role('heading', name=name, exact=True)
    )


def download(page, label, filename):
    with page.expect_download() as event:
        page.locator('.character-editor .export-buttons').get_by_role('button', name=label, exact=True).click()
    destination = out / filename
    event.value.save_as(str(destination))
    assert destination.is_file() and destination.stat().st_size > 0, filename
    return destination.resolve()


def check_restored(page, editor, year, name, quantity=10, weight='16.5'):
    section(editor, '角色资料')
    expect(editor.get_by_label('角色姓名')).to_have_value(name)
    section(editor, '法术与资源')
    expect(metric(editor.locator('.character-magic'), '法术攻击')).to_have_text('+5')
    expect(metric(editor.locator('.character-magic'), '豁免 DC')).to_have_text('13')
    expect(spell_row(page, editor, '戏法', 'Guidance', '神导术').locator('.prep-tick')).to_have_class(re.compile(r'\bchecked\b'))
    expect(spell_row(page, editor, '已准备', 'Bless', '祝福术').locator('.prep-tick')).to_have_class(re.compile(r'\bchecked\b'))
    expect(editor.locator('.prep-resource').filter(has_text='验收资源')).to_contain_text('3 / 3')
    section(editor, '装备与负重')
    equipment = editor.locator('.character-equipment')
    expect(metric(equipment, '当前 AC')).to_have_text('15')
    expect(metric(equipment, '负重 / 容量')).to_contain_text(weight)
    arrow = '箭' if year == '2014' else '箭矢'
    expect(inventory_card(page, editor, arrow).get_by_label(f'{arrow}数量')).to_have_value(str(quantity))
    for item_name in ('皮甲', '盾牌'):
        expect(inventory_card(page, editor, item_name)).to_have_class(re.compile(r'\bequipped\b'))


def check_export(document, year, name, spell_ids):
    assert document['rule'] == 'dnd' and document.get('dndEdition', '2014') == year
    assert document['name'] == name and document['occupation'] == '牧师'
    assert document['attributes']['wis'] == 16 and document['attributes']['dex'] == 14
    magic = document['dndMagic']
    assert spell_ids['神导术'] in magic['cantrips'] and spell_ids['祝福术'] in magic['prepared']
    assert any(resource['name'] == '验收资源' and resource['max'] == 3 and resource['used'] == 0
               for resource in magic['customResources'])
    assert document['dndEquipment']['armorMode'] == 'standard'
    items = {item['name']: item for item in document['items']}
    arrow = '箭' if year == '2014' else '箭矢'
    assert items[arrow]['quantity'] == 10
    for item_name in ('皮甲', '盾牌', arrow):
        assert items[item_name]['equipment']['edition'] == year
    assert items['皮甲']['equipment']['equipped'] and items['盾牌']['equipment']['equipped']


with sync_playwright() as playwright:
    chrome = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    options = {'executable_path': str(chrome)} if chrome.exists() else {}
    browser = playwright.chromium.launch(headless=True, **options)
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
    page = context.new_page()
    page.set_default_timeout(15000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    exports = {}
    try:
        page.goto(args.url, wait_until='domcontentloaded')
        nav(page, '角色档案')
        for year in ('2014', '2024'):
            response = page.request.get(urljoin(args.url.rstrip('/') + '/', f'rules/dnd-{year}.json'))
            assert response.ok, f'Cannot fetch the {year} spell catalog: {response.status}'
            catalog = response.json()
            spell_ids = {spell['nameZh']: spell['id'] for spell in catalog['spells']
                         if spell.get('nameZh') in ('神导术', '祝福术') and '牧师' in (spell.get('classes') or [])}
            assert set(spell_ids) == {'神导术', '祝福术'}
            name = f'{year} 牧师装备法术验收'
            editor = new_character(page, year)
            editor.get_by_label('角色姓名').fill(name)
            editor.locator('select').first.select_option(label='牧师')
            editor.get_by_label('种族', exact=True).fill('人类')
            if year == '2024':
                editor.locator('input[list="dnd-backgrounds-2024"]').fill('侍僧')
            else:
                editor.get_by_label('背景', exact=True).fill('侍僧')
            section(editor, '属性与状态')
            editor.get_by_label('力量属性', exact=True).fill('10')
            editor.get_by_label('敏捷属性', exact=True).fill('14')
            editor.get_by_label('感知属性', exact=True).fill('16')
            section(editor, '技能与熟练')
            editor.get_by_role('button', name='建议分配', exact=True).click()

            section(editor, '法术与资源')
            editor.get_by_role('button', name='启用法术与资源管理', exact=True).click()
            magic = editor.locator('.character-magic')
            expect(metric(magic, '法术攻击')).to_have_text('+5')
            expect(metric(magic, '豁免 DC')).to_have_text('13')
            expect(magic.get_by_label('法术位余额')).to_contain_text('2 / 2')
            for shelf, query, spell_name in (('戏法', 'Guidance', '神导术'), ('已准备', 'Bless', '祝福术')):
                row = spell_row(page, editor, shelf, query, spell_name)
                row.click()
                expect(row.locator('.prep-tick')).to_have_class(re.compile(r'\bchecked\b'))
            extra = magic.locator('details.prep-details').filter(has_text='额外授予与自定义资源')
            extra.locator('summary').click()
            extra.get_by_label('资源名称').fill('验收资源')
            extra.get_by_label('次数上限').fill('3')
            extra.get_by_role('button', name='添加资源', exact=True).click()
            expect(magic.locator('.prep-resource').filter(has_text='验收资源')).to_contain_text('3 / 3')
            magic.locator('.prep-section-heading').first.scroll_into_view_if_needed()
            snapshot(page, f'magic-{year}-desktop-light.png')

            section(editor, '装备与负重')
            editor.get_by_role('button', name='启用装备联动', exact=True).click()
            equipment = editor.locator('.character-equipment')
            expect(metric(equipment, '当前 AC')).to_have_text('12')
            editor.get_by_role('button', name='从目录添加', exact=True).click()
            armor = add_equipment(page, editor, '皮甲')
            armor.get_by_role('button', name='穿戴 / 持用', exact=True).click()
            expect(metric(equipment, '当前 AC')).to_have_text('13')
            shield = add_equipment(page, editor, '盾牌')
            shield.get_by_role('button', name='穿戴 / 持用', exact=True).click()
            expect(metric(equipment, '当前 AC')).to_have_text('15')
            arrow = '箭' if year == '2014' else '箭矢'
            arrows = add_equipment(page, editor, arrow, 20)
            expect(metric(equipment, '负重 / 容量')).to_contain_text('17 /')
            arrows.get_by_label(f'{arrow}数量').fill('10')
            expect(metric(equipment, '负重 / 容量')).to_contain_text('16.5 /')
            editor.get_by_role('button', name='收起目录', exact=True).click()
            equipment.locator('.prep-section-heading').first.scroll_into_view_if_needed()
            fit(page, f'{year} equipment desktop light')
            snapshot(page, f'equipment-{year}-desktop-light.png')
            passed(f'{year}: spell selection and custom resources, equipped AC, ammunition quantity and weight')

            json_file = download(page, 'JSON', f'character-{year}.json')
            md_file = download(page, 'Markdown', f'character-{year}.md')
            check_export(json.loads(json_file.read_text(encoding='utf8')), year, name, spell_ids)
            assert '```json' in md_file.read_text(encoding='utf8')
            exports[year] = (json_file, md_file)
            editor.get_by_role('button', name='保存角色卡', exact=True).click()
            expect(page.get_by_role('dialog')).to_have_count(0)
            page.reload(wait_until='domcontentloaded')
            nav(page, '角色档案')
            card = page.locator('.character-card').filter(has_text=name)
            expect(card).to_be_visible()
            card.get_by_role('button', name='打开角色卡').click()
            editor = page.get_by_role('dialog')
            check_restored(page, editor, year, name)
            inventory_card(page, editor, arrow).get_by_label(f'{arrow}数量').fill('12')
            expect(metric(editor.locator('.character-equipment'), '负重 / 容量')).to_contain_text('16.6 /')
            editor.get_by_role('button', name='保存角色卡', exact=True).click()
            expect(page.get_by_role('dialog')).to_have_count(0)
            page.reload(wait_until='domcontentloaded')
            nav(page, '角色档案')
            page.locator('.character-card').filter(has_text=name).get_by_role('button', name='打开角色卡').click()
            editor = page.get_by_role('dialog')
            check_restored(page, editor, year, name, quantity=12, weight='16.6')
            passed(f'{year}: created and edited character, magic and equipment survive browser reloads')

            if year == '2024':
                for width in (390, 320):
                    page.set_viewport_size({'width': width, 'height': 844})
                    for tab, prefix in (('法术与资源', 'magic'), ('装备与负重', 'equipment')):
                        show_preparation_heading(editor, tab)
                        fit(page, f'{prefix} mobile light {width}')
                        snapshot(page, f'{prefix}-{year}-mobile-light-{width}.png')
                page.set_viewport_size({'width': 1440, 'height': 1000})
            close_editor(page)

            for file in (json_file, md_file):
                editor = new_character(page, year)
                editor.get_by_label('角色姓名').fill('等待同版导入')
                editor.get_by_label('导入角色卡文件').set_input_files(str(file))
                expect(editor.get_by_label('角色姓名')).to_have_value(name)
                expect(editor.get_by_role('alert')).to_have_count(0)
                check_restored(page, editor, year, name)
                close_editor(page)
            passed(f'{year}: actual JSON and Markdown exports reimport spell, resource, equipment and quantity data')

            legacy = json.loads(json_file.read_text(encoding='utf8'))
            legacy['name'] = f'{year} 旧角色验收'
            legacy.pop('dndMagic', None)
            legacy.pop('dndEquipment', None)
            if year == '2014':
                legacy.pop('dndEdition', None)
            for item in legacy['items']:
                item.pop('equipment', None)
            legacy_file = out / f'legacy-character-{year}.json'
            legacy_file.write_text(json.dumps(legacy, ensure_ascii=False, indent=2), encoding='utf8')
            editor = new_character(page, year)
            editor.get_by_label('导入角色卡文件').set_input_files(str(legacy_file.resolve()))
            expect(editor.get_by_label('角色姓名')).to_have_value(legacy['name'])
            section(editor, '法术与资源')
            expect(editor.get_by_role('button', name='启用法术与资源管理', exact=True)).to_be_visible()
            section(editor, '装备与负重')
            expect(editor.get_by_role('button', name='启用装备联动', exact=True)).to_be_visible()
            editor.get_by_role('button', name='启用装备联动', exact=True).click()
            old_arrows = inventory_card(page, editor, arrow)
            expect(old_arrows).to_contain_text('普通物品 · 未绑定规则')
            expect(old_arrows.get_by_label(f'{arrow}数量')).to_have_value('10')
            legacy_export = download(page, 'JSON', f'legacy-roundtrip-{year}.json')
            saved_legacy = json.loads(legacy_export.read_text(encoding='utf8'))
            assert 'dndMagic' not in saved_legacy
            assert any(item['name'] == arrow and item['quantity'] == 10 and 'equipment' not in item
                       for item in saved_legacy['items'])
            close_editor(page)
            passed(f'{year}: legacy items stay intact and unbound when equipment management is enabled')

        editor = new_character(page, '2024')
        editor.get_by_label('角色姓名').fill('保留的新版底稿')
        for file in exports['2014']:
            editor.get_by_label('导入角色卡文件').set_input_files(str(file))
            expect(editor.get_by_role('alert')).to_contain_text('版次不匹配')
            expect(editor.get_by_label('角色姓名')).to_have_value('保留的新版底稿')
        close_editor(page)
        passed('Cross-edition character backups are rejected without changing the draft')

        page.get_by_role('button', name='切换深色模式', exact=True).click()
        page.locator('.character-card').filter(has_text='2024 牧师装备法术验收').get_by_role('button', name='打开角色卡').click()
        editor = page.get_by_role('dialog')
        for width, height, suffix in ((1440, 1000, 'desktop-dark'), (390, 844, 'mobile-dark-390'), (320, 844, 'mobile-dark-320')):
            page.set_viewport_size({'width': width, 'height': height})
            for tab, prefix in (('法术与资源', 'magic'), ('装备与负重', 'equipment')):
                show_preparation_heading(editor, tab)
                fit(page, f'{prefix} {suffix}')
                snapshot(page, f'{prefix}-2024-{suffix}.png')
        passed('Light, dark, desktop and mobile screenshots were captured without modal overflow')
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
    print(f'Completed {len(checks)} character preparation checks.', flush=True)
