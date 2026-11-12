"""Full occupation browser, source identities, manual bases and responsive UI."""
import argparse
import json
import re
from pathlib import Path
from playwright.sync_api import expect, sync_playwright
from coc_browser_helpers import choose_occupation

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:3123')
url = parser.parse_args().url
out = Path('test-results/coc-occupations')
out.mkdir(parents=True, exist_ok=True)

with sync_playwright() as play:
    browser = play.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1360, 'height': 1000}, accept_downloads=True)
    page.set_default_timeout(10000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        page.goto(url, wait_until='domcontentloaded')
        page.locator('.sidebar').get_by_role('button', name='角色档案', exact=True).click()
        page.get_by_role('button', name='新建角色', exact=True).click()
        page.locator('.new-character-option.coc').click()
        dialog = page.get_by_role('dialog')
        dialog.get_by_label('角色姓名', exact=False).fill('陈默')
        page.get_by_role('button', name='选择调查员职业', exact=True).click()
        picker = page.get_by_role('dialog', name='选择调查员职业', exact=True)
        expect(picker.locator('.occupation-browser-count')).to_have_text('229 项职业')
        source = picker.get_by_role('combobox', name='职业来源', exact=True)
        for key, count in [('handbook', 114), ('companion', 41), ('japan', 13), ('japanese', 35), ('gaslight', 26)]:
            source.select_option(key)
            expect(picker.locator('.occupation-browser-count')).to_have_text(f'{count} 项职业')
        source.select_option('all')
        picker.get_by_role('button', name='下一页职业', exact=True).click()
        expect(picker.locator('.occupation-pagination')).to_contain_text('2 / 12')
        search = picker.get_by_role('searchbox', name='搜索职业目录', exact=True)
        search.fill('不存在的职业')
        expect(picker.get_by_text('暂无匹配职业，请换个关键词。')).to_be_visible()
        expect(picker.get_by_role('button', name='使用此职业', exact=True)).to_have_count(0)
        search.fill('#218')
        expect(picker.locator('.occupation-preview h3')).to_have_text('探险家')
        for width, theme in [(1360, 'light'), (1360, 'dark'), (390, 'light'), (390, 'dark'), (320, 'light')]:
            page.set_viewport_size({'width': width, 'height': 1000 if width > 620 else 844})
            page.evaluate('theme => document.documentElement.dataset.theme = theme', theme)
            picker.locator('.modal-content').evaluate('(node) => { node.scrollTop = 0; }')
            assert picker.evaluate('(node) => node.scrollWidth <= node.clientWidth + 1')
            assert picker.locator('.modal-content').evaluate('(node) => node.scrollWidth <= node.clientWidth + 1')
            page.screenshot(path=out / f'picker-{width}-{theme}.png', animations='disabled')
        page.keyboard.press('Escape')
        expect(picker).to_have_count(0)
        expect(page.get_by_role('button', name='选择调查员职业', exact=True)).to_be_focused()
        page.set_viewport_size({'width': 1360, 'height': 1000})
        page.evaluate("document.documentElement.dataset.theme = 'light'")
        print('PASS 229 项目录、五种来源、分页、空结果、键盘返回与深浅色窄屏', flush=True)

        choose_occupation(page, '演员-戏剧演员', source='handbook', number=4)
        career = dialog.get_by_role('region', name='职业与技能专长')
        career.get_by_label('启用职业分支', exact=True).check()
        career.get_by_role('combobox', name=re.compile('职业分支')).select_option('workbook5')
        expect(career.get_by_label('启用技能专长', exact=True)).not_to_be_checked()
        dialog.get_by_role('button', name='技能与熟练', exact=True).click()
        expect(dialog.locator('.point-budget').nth(2)).to_contain_text('20–90')
        dialog.get_by_role('button', name='角色资料', exact=True).click()
        career.get_by_label('启用职业分支', exact=True).uncheck()
        dialog.get_by_role('button', name='技能与熟练', exact=True).click()
        expect(dialog.locator('.point-budget').nth(2)).to_contain_text('9–40')
        dialog.get_by_role('button', name='角色资料', exact=True).click()
        print('PASS 目录职业分支独立切换并按对应变体计算', flush=True)

        choose_occupation(page, '艺术家', source='handbook', number=13)
        dialog.get_by_role('button', name='技能与熟练', exact=True).click()
        expect(dialog.locator('.point-budget').nth(2)).to_contain_text('9–50')
        dialog.get_by_role('button', name='角色资料', exact=True).click()
        choose_occupation(page, '艺术家', source='gaslight', number=208)
        dialog.get_by_role('button', name='技能与熟练', exact=True).click()
        expect(dialog.locator('.point-budget').nth(2)).to_contain_text('10–40')
        dialog.get_by_role('button', name='角色资料', exact=True).click()
        choose_occupation(page, '女学生', source='japanese', number=172)
        career = dialog.get_by_role('region', name='职业与技能专长')
        career.get_by_label('启用技能专长', exact=True).check()
        base = career.locator('.auto-value-field').filter(has=page.get_by_label('自行车驾驶', exact=True))
        expect(base.get_by_label('自行车驾驶', exact=True)).to_be_disabled()
        base.get_by_role('button', name='解锁自行车驾驶', exact=True).click()
        base.get_by_label('自行车驾驶计算方式', exact=True).select_option('manual')
        base.get_by_label('自行车驾驶', exact=True).fill('20')
        base.get_by_role('button', name='保存', exact=True).click()
        base.get_by_role('button', name='锁定自行车驾驶', exact=True).click()
        expect(base.get_by_label('自行车驾驶', exact=True)).to_be_disabled()
        dialog.get_by_role('button', name='技能与熟练', exact=True).click()
        dialog.get_by_role('button', name='建议分配', exact=True).click()
        expect(dialog.locator('.validation-summary')).to_contain_text('数值检查通过')
        with page.expect_download() as download:
            dialog.get_by_role('button', name='JSON', exact=True).click()
        exported = out / 'character.json'
        download.value.save_as(exported)
        data = json.loads(exported.read_text())
        assert data['cocCareer']['occupationId'] == 'workbook172'
        assert data['cocCareer']['skillBases']['driveCycle'] == {'mode': 'manual', 'manual': 20, 'locked': True}
        dialog.get_by_role('button', name='保存角色卡', exact=True).click()
        page.reload(wait_until='domcontentloaded')
        page.locator('.sidebar').get_by_role('button', name='角色档案', exact=True).click()
        page.get_by_role('button', name='打开角色卡', exact=True).click()
        expect(page.get_by_role('button', name='选择调查员职业', exact=True)).to_have_text('女学生')
        expect(page.get_by_label('自行车驾驶', exact=True)).to_have_value('20')
        page.get_by_role('dialog').get_by_label('导入角色卡文件').set_input_files(exported)
        expect(page.get_by_role('button', name='选择调查员职业', exact=True)).to_have_text('女学生')
        page.get_by_role('dialog').get_by_role('button', name='关闭窗口', exact=True).click()
        print('PASS 同名来源区分、技能基础值锁定、完整分配、保存重开与整卡导入', flush=True)

        page.locator('.sidebar').get_by_role('button', name='主持人工具集', exact=True).click()
        page.get_by_role('button', name='职业与技能', exact=False).click()
        expect(page.locator('.occupation-browser-count')).to_have_text('229 项职业')
        page.get_by_role('searchbox', name='搜索职业目录', exact=True).fill('游戏')
        expect(page.locator('.occupation-preview h3')).to_have_text('游戏测试员')
        page.screenshot(path=out / 'reference-desktop.png', animations='disabled')
        assert not errors, errors
        print('PASS 主持人参考共用完整目录，无浏览器异常', flush=True)
    except Exception:
        page.screenshot(path=out / 'failure.png', animations='disabled')
        (out / 'failure.txt').write_text(page.locator('body').inner_text())
        raise
    finally:
        browser.close()
