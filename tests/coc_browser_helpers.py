"""Use the real searchable occupation dialog in character editor flows."""
from playwright.sync_api import expect


def choose_occupation(page, name, source='legacy', number=None):
    page.get_by_role('button', name='选择调查员职业', exact=True).click()
    picker = page.get_by_role('dialog', name='选择调查员职业', exact=True)
    picker.get_by_role('combobox', name='职业来源', exact=True).select_option(source)
    picker.get_by_role('searchbox', name='搜索职业目录', exact=True).fill(f'#{number}' if number else name)
    result = picker.locator('.occupation-result').filter(has=page.get_by_text(name, exact=True))
    expect(result).to_have_count(1)
    result.click()
    picker.get_by_role('button', name='使用此职业', exact=True).click()
    expect(picker).to_have_count(0)
    expect(page.get_by_role('button', name='选择调查员职业', exact=True)).to_have_text(name)
