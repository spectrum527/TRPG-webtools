"""Exercise CoC branch selection, custom skills, and occupation template reuse."""
from coc_browser_helpers import choose_occupation
import argparse
import json
import re
from contextlib import suppress
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import Error, expect, sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:3118')
url = parser.parse_args().url


def new_card(page):
    page.get_by_role('button', name='新建角色', exact=True).click()
    page.locator('.new-character-option.coc').click()
    dialog = page.get_by_role('dialog')
    expect(dialog).to_be_visible()
    return dialog, dialog.get_by_role('region', name='职业与技能专长')


with sync_playwright() as play, TemporaryDirectory() as directory:
    browser = play.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1360, 'height': 960}, accept_downloads=True)
    page.set_default_timeout(10000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        page.goto(url, wait_until='domcontentloaded')
        page.locator('.sidebar').get_by_role('button', name='角色档案', exact=True).click()
        dialog, career = new_card(page)
        occupation = dialog.get_by_role('button', name='选择调查员职业', exact=True)
        choose_occupation(page, '医生')
        career.get_by_label('启用职业分支', exact=True).check()
        expect(career.get_by_label('启用技能专长', exact=True)).not_to_be_checked()
        branch = career.get_by_role('combobox', name=re.compile('职业分支'))
        branch.select_option('doctorPsychiatry')
        career.get_by_label('启用技能专长', exact=True).check()
        expect(branch).to_have_value('doctorPsychiatry')
        dialog.get_by_role('button', name='技能与熟练', exact=True).click()
        dialog.get_by_placeholder('搜索技能名称…').fill('化学')
        dialog.get_by_label('科学／化学职业点', exact=True).fill('12')
        expect(dialog.get_by_label('科学／化学最终值', exact=True)).to_have_text('13')
        dialog.get_by_role('button', name='角色资料', exact=True).click()
        career.get_by_label('启用技能专长', exact=True).uncheck()
        expect(career.get_by_role('status')).to_contain_text('已退回职业点 12 点')
        expect(branch).to_have_value('doctorPsychiatry')
        print('PASS 独立开关、分支专长职业点、关闭时退回', flush=True)

        career.get_by_text('自定义技能', exact=True).click()
        career.get_by_role('button', name='添加技能', exact=True).click()
        career.get_by_label('技能名称', exact=True).fill('无线电通联')
        career.get_by_label('基础值', exact=True).fill('10')
        career.get_by_role('button', name='保存技能', exact=True).click()
        expect(career.get_by_role('status')).to_have_text('自定义技能已保存。')

        career.get_by_text('自定义职业', exact=True).click()
        career.get_by_role('button', name='创建方案', exact=True).click()
        career.get_by_label('职业名称', exact=True).fill('电台技师')
        career.get_by_role('combobox', name='职业点公式', exact=True).select_option('mixed')
        career.get_by_label('智力', exact=True).check()
        career.get_by_label('信用评级下限', exact=True).fill('12')
        career.get_by_label('信用评级上限', exact=True).fill('35')
        career.get_by_role('combobox', name='自选技能位置数', exact=True).select_option('7')
        career.get_by_role('combobox', name='职业技能位置 1', exact=True).select_option(label='无线电通联')
        career.get_by_role('button', name='保存并应用职业', exact=True).click()
        expect(occupation).to_have_text('电台技师')
        with page.expect_download() as result:
            career.get_by_role('button', name='导出模板', exact=True).click()
        template_file = Path(directory, 'career.json')
        result.value.save_as(template_file)
        template = json.loads(template_file.read_text())
        assert template['occupation']['bonus'] == ['int'], template
        assert template['occupation']['credit'] == [12, 35], template
        skill = template['skills'][0]
        assert skill['label'] == '无线电通联' and skill['base'] == 10, template
        assert template['occupation']['groups'] == [[skill['key']]], template
        print('PASS 自定义职业、公式、技能、信用范围及模板导出', flush=True)

        dialog.get_by_role('button', name='关闭窗口', exact=True).click()
        dialog, career = new_card(page)
        occupation = dialog.get_by_role('button', name='选择调查员职业', exact=True)
        career.get_by_text('自定义职业', exact=True).click()
        career.get_by_label('导入自定义职业模板', exact=True).set_input_files(template_file)
        expect(career.get_by_role('status')).to_contain_text('已读取职业模板')
        expect(occupation).not_to_have_text('电台技师')
        career.get_by_role('button', name='保存并应用职业', exact=True).click()
        expect(occupation).to_have_text('电台技师')
        dialog.get_by_label(re.compile('角色姓名')).fill('陈默')
        dialog.get_by_role('button', name='技能与熟练', exact=True).click()
        dialog.get_by_placeholder('搜索技能名称…').fill('无线电通联')
        expect(dialog.get_by_label('无线电通联最终值', exact=True)).to_have_text('10')
        dialog.get_by_label('无线电通联职业点', exact=True).fill('20')
        expect(dialog.get_by_label('无线电通联最终值', exact=True)).to_have_text('30')
        with page.expect_download() as result:
            dialog.get_by_role('button', name='JSON', exact=True).click()
        character = json.loads(result.value.path().read_text())
        assert character['creation']['occupational'][skill['key']] == 20, character
        assert character['skills'][skill['key']] == 30, character
        assert character['cocCareer']['customOccupation']['name'] == '电台技师', character
        assert not errors, errors
        print('PASS 新卡导入先预览、保存、技能分配及整卡 JSON 持久化', flush=True)
    except Exception:
        with suppress(Error, OSError):
            evidence = Path('test-results/coc-careers')
            evidence.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=evidence / 'failure.png', animations='disabled')
        raise
    finally:
        browser.close()
