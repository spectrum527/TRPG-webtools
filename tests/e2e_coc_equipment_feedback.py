"""CoC occupation-first skill order, complete equipment and custom coverage."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import expect, sync_playwright
from coc_browser_helpers import choose_occupation

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:3125')
url = parser.parse_args().url
out = Path('test-results/coc-equipment-feedback')
out.mkdir(parents=True, exist_ok=True)

def fit(page, name):
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), name
    for modal in page.locator('.modal, .modal-content').all():
        assert modal.evaluate('(node) => node.scrollWidth <= node.clientWidth + 1'), name

def capture(page, name):
    page.evaluate("""async () => {
        await new Promise(requestAnimationFrame);
        await Promise.allSettled(document.getAnimations()
            .filter(animation => animation.effect.getComputedTiming().iterations !== Infinity)
            .map(animation => animation.finished));
    }""")
    page.screenshot(path=out / name)


def choose_equipment(page, kind, name):
    label = '武器' if kind == 'weapon' else '防具'
    page.get_by_role('button', name=f'选择{label}', exact=True).click()
    picker = page.get_by_role('dialog', name=f'{label}目录', exact=True)
    picker.get_by_role('combobox', name='装备来源', exact=True).select_option('workbook')
    picker.get_by_role('searchbox').fill(name)
    picker.locator('.occupation-result').filter(has=page.get_by_text(name, exact=True)).click()
    picker.get_by_role('button', name='选择此武器' if kind == 'weapon' else '选择此防护物', exact=True).click()
    page.get_by_role('button', name=f'添加{label}', exact=True).click()

with sync_playwright() as play:
    browser = play.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1050}, accept_downloads=True)
    page.set_default_timeout(12000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        page.goto(url, wait_until='domcontentloaded')
        page.locator('.sidebar').get_by_role('button', name='角色档案', exact=True).click()
        page.get_by_role('button', name='新建角色', exact=True).click()
        page.locator('.new-character-option.coc').click()
        dialog = page.get_by_role('dialog')
        dialog.get_by_label('角色姓名', exact=False).fill('林恩')
        choose_occupation(page, '记者')
        dialog.get_by_role('button', name='技能与熟练', exact=True).click()
        order = dialog.get_by_role('combobox', name='技能排序', exact=True)
        expect(order).to_have_value('occupation')
        rows = dialog.locator('.allocation-row:not(.ledger-head)')
        def labels(): return rows.locator('.allocation-skill b').all_text_contents()
        flags = rows.evaluate_all("nodes => nodes.map(node => node.querySelector('.allocation-skill small').textContent.includes('职业'))")
        assert flags[:9] == [True] * 9 and not any(flags[9:]), flags
        capture(page, 'skills-desktop.png')
        order.select_option('invested')
        before = labels()
        dialog.get_by_label('追踪兴趣点', exact=True).fill('20')
        assert labels() == before, 'Rows must not move while entering points'
        dialog.get_by_placeholder('搜索技能名称…').click()
        expect(rows.locator('.allocation-skill b').first).to_have_text('追踪')
        order.select_option('occupation')
        assert labels().index('追踪') >= 9
        dialog.get_by_role('button', name='建议分配', exact=True).click()
        print('PASS 职业与信用评级优先、已投入排序与录入时稳定行位置', flush=True)

        dialog.get_by_role('button', name='武器与防具', exact=True).click()
        choose_equipment(page, 'weapon', '电锯')
        expect(dialog.get_by_role('heading', name='电锯', exact=True)).to_be_visible()
        choose_equipment(page, 'weapon', 'Minigun')
        minigun = dialog.locator('article.coc-record').filter(has=page.get_by_role('heading', name='Minigun', exact=True))
        expect(minigun).to_contain_text('0/4000')
        choose_equipment(page, 'armor', '防刺手套')
        dialog.get_by_label('穿戴防刺手套', exact=True).check()
        expect(dialog.get_by_text('躯干护甲 0', exact=False)).to_be_visible()
        dialog.get_by_text('自定义防具', exact=True).click()
        dialog.get_by_label('防具名称', exact=True).fill('护面与手套')
        dialog.get_by_role('combobox', name='自定义防护类型', exact=True).select_option('worn')
        dialog.get_by_label('护甲值', exact=True).fill('3')
        dialog.get_by_role('combobox', name='防护部位', exact=True).select_option('custom')
        coverage = dialog.locator('.coc-coverage-grid')
        coverage.get_by_label('躯干', exact=True).uncheck()
        expect(dialog.get_by_role('button', name='添加自定义防具', exact=True)).to_be_disabled()
        coverage.get_by_label('面部', exact=True).check()
        coverage.get_by_label('双手', exact=True).check()
        dialog.get_by_label('防护条件与备注', exact=True).fill('仅防护正面飞溅物。')
        coverage.scroll_into_view_if_needed()
        capture(page, 'custom-armor-desktop.png')
        dialog.get_by_role('button', name='添加自定义防具', exact=True).click()
        dialog.get_by_label('穿戴护面与手套', exact=True).check()
        custom = dialog.locator('article.coc-record').filter(has=page.get_by_label('穿戴护面与手套', exact=True))
        expect(custom).to_contain_text('面部、双手')
        expect(dialog.get_by_text('躯干护甲 0', exact=False)).to_be_visible()
        custom.get_by_role('button', name='保存到备团库', exact=True).click()
        with page.expect_download() as download:
            dialog.get_by_role('button', name='JSON', exact=True).click()
        exported = out / 'character.json'
        download.value.save_as(exported)
        card = json.loads(exported.read_text())
        equipment = card['cocInvestigator']['equipment']
        assert equipment['weapons'][1]['profile']['capacity'] == 4000
        assert equipment['weapons'][0]['profile']['reference']['row'] == 6
        assert equipment['armor'][1]['profile']['locations'] == ['face', 'hands']
        assert equipment['armor'][1]['profile']['rulesNotes'] == '仅防护正面飞溅物。'
        dialog.get_by_role('button', name='保存角色卡', exact=True).click()
        page.reload(wait_until='domcontentloaded')
        page.locator('.sidebar').get_by_role('button', name='角色档案', exact=True).click()
        page.get_by_role('button', name='打开角色卡', exact=True).click()
        dialog.get_by_role('button', name='武器与防具', exact=True).click()
        expect(dialog.get_by_label('穿戴护面与手套', exact=True)).to_be_checked()
        print('PASS 完整装备载入、大装弹量、组合护具、备团库保存与角色往返', flush=True)

        page.get_by_role('button', name='选择防具', exact=True).click()
        picker = page.get_by_role('dialog', name='防具目录', exact=True)
        picker.get_by_role('searchbox').fill('重型军用防弹衣')
        expect(picker.locator('.occupation-preview')).to_contain_text('重型军用防弹衣')
        picker.get_by_role('searchbox').fill('')
        picker.get_by_role('combobox', name='装备来源', exact=True).select_option('workbook')
        expect(picker.locator('.occupation-browser-count')).to_have_text('73 项防护物')
        picker.get_by_role('combobox', name='装备类型筛选', exact=True).select_option('shield')
        expect(picker.locator('.occupation-browser-count')).to_have_text('8 项防护物')
        picker.get_by_role('combobox', name='装备类型筛选', exact=True).select_option('all')
        picker.get_by_role('searchbox').fill('文艺复兴头盔')
        expect(picker.locator('.occupation-preview')).to_contain_text('1D2+3')
        for width, theme in [(1440, 'light'), (1440, 'dark'), (390, 'light'), (390, 'dark'), (320, 'light')]:
            page.set_viewport_size({'width': width, 'height': 1050 if width > 620 else 900})
            page.evaluate('theme => document.documentElement.dataset.theme = theme', theme)
            fit(page, f'Equipment picker {width} {theme}')
            capture(page, f'equipment-{width}-{theme}.png')
        page.keyboard.press('Escape')
        dialog.get_by_role('button', name='技能与熟练', exact=True).click()
        fit(page, '320px skill order')
        capture(page, 'skills-320.png')
        dialog.get_by_role('button', name='关闭窗口', exact=True).click()
        page.set_viewport_size({'width': 1440, 'height': 1050})
        page.locator('.sidebar').get_by_role('button', name='主持人工具集', exact=True).click()
        page.get_by_role('button', name='武器与防具', exact=True).click()
        page.get_by_role('combobox', name='装备来源', exact=True).select_option('workbook')
        expect(page.locator('.occupation-browser-count')).to_have_text('104 项武器')
        page.get_by_role('button', name='防具与掩体', exact=True).click()
        page.get_by_role('combobox', name='装备来源', exact=True).select_option('saved')
        expect(page.locator('.occupation-preview')).to_contain_text('护面与手套')
        expect(page.locator('.occupation-preview')).to_contain_text('面部、双手')
        assert not errors, errors
        print('PASS 完整来源计数、筛选、特殊护甲原文、桌面手机深浅色和主持人目录', flush=True)
    except Exception:
        page.screenshot(path=out / 'failure.png', animations='disabled')
        (out / 'failure.txt').write_text(page.locator('body').inner_text())
        raise
    finally:
        browser.close()
