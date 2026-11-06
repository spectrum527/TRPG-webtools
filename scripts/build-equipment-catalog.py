#!/usr/bin/env python3
"""Generate two core equipment catalogues from a processed D&D rules library.

Usage: python3 scripts/build-equipment-catalog.py /path/to/processed-rules-library
Only the Markdown and JSON/JSONL indexes are read; the original CHM/PDF are not.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
from decimal import Decimal
from fractions import Fraction
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
OUTPUT = PROJECT / 'public' / 'rules'
WEAPON_TABLES = {'2014': 'tbl-272d02f7d80c-1', '2024': 'tbl-13de6e788379-1'}
ARMOR_TABLES = {'2014': 'tbl-1d81edb72edf-1', '2024': 'tbl-6e4a1cf3dee2-1'}
GEAR_TABLES = {
    '2014': {'tbl-30fad80178ac-1'},
    '2024': {'tbl-412b5d4a9bf3-1', 'tbl-412b5d4a9bf3-3', 'tbl-412b5d4a9bf3-4', 'tbl-412b5d4a9bf3-5'},
}
BOOKS = {'2014': '玩家手册', '2024': '玩家手册2024'}
GEAR_SOURCES = {'2014': 'chm-30fad80178ac', '2024': 'chm-412b5d4a9bf3'}


def read(path: Path) -> str:
    return path.read_text(encoding='utf8')


def relative(value: str) -> str:
    value = value.removeprefix('DND5e规则库/')
    if not value or value.startswith(('/', '\\')) or '..' in Path(value).parts:
        raise ValueError(f'Not a relative rules-library path: {value!r}')
    return value


def text(value: str | None) -> str | None:
    return html.unescape(value).strip() if value and value.strip() else None


def names(value: str) -> tuple[str, str | None]:
    value = html.unescape(value).strip()
    match = re.match(r'([^A-Za-z]+?)([A-Za-z][A-Za-z\u2019\u2018\'-]*(?:[ ,.-]+[A-Za-z\u2019\u2018\'-]+)*)', value)
    return (match.group(1).strip(), match.group(2).strip()) if match else (value, None)


def coins(value: str | None) -> int | None:
    if not value:
        return None
    match = re.fullmatch(r'\s*([\d,]+)\s*(cp|sp|ep|gp|pp)\s*', value, re.I)
    if not match:
        return None
    return int(match.group(1).replace(',', '')) * {'cp': 1, 'sp': 10, 'ep': 50, 'gp': 100, 'pp': 1000}[match.group(2).lower()]


def weight(value: str | None, version: str, raw_name: str) -> tuple[float | None, float | None, list[str]]:
    if not value:
        return None, None, []
    value = value.strip()
    filled = bool(re.search(r'盛满|（满）|\(满\)', value))
    # The processed 2014 table flattened 1½ to "11/2". The processed PDF
    # transcription independently identifies precisely these two rows as 1½.
    if version == '2014' and value == '11/2磅' and re.search(r'Crossbow bolts|Sling bullets', raw_name, re.I):
        return 1.5, None, ['01-规则正文/PHB-PDF/逐页/p0150.md']
    number = re.match(r'^(半|\d+(?:\.\d+)?|\d+/\d+)\s*磅', value)
    if not number:
        return None, None, []
    token = number.group(1)
    numeric = 0.5 if token == '半' else float(Fraction(token))
    return (None, numeric, []) if filled else (numeric, None, [])


def source(record: dict, extra: list[str] | None = None) -> dict:
    return {'id': record['source_id'], 'book': record['book'], 'path': relative(record['source_md_path']),
            'tableId': record['source_table_id'], 'row': record['table_row'],
            'additionalPaths': [relative(path) for path in (extra or [])]}


def base(record: dict, version: str, kind: str) -> dict:
    name, english = names(record['name'])
    pounds, full_pounds, extra = weight(record.get('weight_raw'), version, record['name'])
    return {'id': record['id'], 'edition': version, 'name': name, 'nameEn': english,
            'rawName': record['name'], 'kind': kind, 'gearType': None, 'weightLb': pounds,
            'weightWhenFullLb': full_pounds, 'weightText': text(record.get('weight_raw')),
            'costCp': coins(record.get('price_raw')), 'costText': text(record.get('price_raw')),
            'quantityPerPack': None, 'description': None, 'source': source(record, extra),
            'weapon': None, 'armor': None, 'shield': None, 'container': None}


def weapon(record: dict, version: str, masteries: dict[str, str], specials: dict[str, str]) -> dict:
    item = base(record, version, 'weapon')
    row = record['row_fields']
    group = record['group']
    if not group.startswith(('简易', '军用')) or ('近战' in group) == ('远程' in group):
        raise ValueError(f'Unexpected weapon group: {group}')
    raw = text(row.get('属性' if version == '2014' else '词条'))
    if version == '2014' and item['name'] == '战镐' and raw is None:
        # The processed PDF transcription explicitly contains a dash; the CHM
        # extraction lost this cell's glyph. Verified before generation below.
        raw = '—'
        item['source']['additionalPaths'].append('01-规则正文/PHB-PDF/逐页/p0149.md')
    # A blank cell is left unknown; a dash or a populated property cell is explicit.
    has_properties = raw is not None
    flag = lambda label: (label in raw) if has_properties else None
    damage = text(row.get('伤害'))
    dm = re.fullmatch(r'\s*(\d+(?:d\d+)?)\s*([^\d\s]+)\s*', damage or '', flags=re.I)
    special = specials.get(item['name']) if version == '2014' else None
    thrown_range = re.search(r'射程\s*(\d+)\s*/\s*(\d+)', raw or '')
    versatile = re.search(r'(?:两用|多用)\s*[（(]\s*(\d+d\d+)\s*[）)]', raw or '', re.I)
    ammunition = re.search(r'弹药\s*[（(][^）)]*[;；]\s*([^）)]+)[）)]', raw or '')
    exception = '骑乘时除外' if version == '2024' and item['name'] == '骑枪' and '骑乘时除外' in (raw or '') else None
    if version == '2014' and item['name'] == '骑枪' and special:
        exception = '不在骑乘状态时需要双手；5尺内攻击具有劣势。'
    mastery = text(row.get('精通')) if version == '2024' else None
    if mastery in ('—', '－', '-'):
        mastery = None
    item['weapon'] = {
        'proficiency': 'simple' if record['group'].startswith('简易') else 'martial',
        'ranged': '远程' in record['group'], 'damageDice': dm.group(1).lower() if dm else None,
        'damageType': dm.group(2) if dm else None, 'finesse': flag('灵巧'), 'light': flag('轻型'),
        'heavy': flag('重型'), 'thrown': flag('投掷'), 'ammunition': flag('弹药'),
        # 2014 lance has a special conditional, rather than the normal two-handed property.
        'twoHanded': None if version == '2014' and item['name'] == '骑枪' else flag('双手'),
        'twoHandedException': exception, 'versatileDice': versatile.group(1).lower() if versatile else None,
        'reach': flag('触及'), 'loading': flag('装填'),
        'rangeNormalFt': int(thrown_range.group(1)) if thrown_range else None,
        'rangeLongFt': int(thrown_range.group(2)) if thrown_range else None,
        'ammunitionType': ammunition.group(1).strip() if ammunition else None,
        'mastery': mastery, 'masteryDescription': masteries.get(mastery), 'propertyText': raw,
        'specialText': special,
    }
    if mastery and mastery not in masteries:
        raise ValueError(f'Unmatched weapon mastery: {mastery}')
    if mastery:
        item['source']['additionalPaths'].append('01-规则正文/CHM/玩家手册2024/装备/精通词条.md')
    if special:
        item['source']['additionalPaths'].append('01-规则正文/分节/chm-272d02f7d80c/001.md')
    return item


def armor(record: dict, version: str) -> dict:
    row = record['row_fields']
    is_shield = '盾牌' in record['group']
    item = base(record, version, 'shield' if is_shield else 'armor')
    ac = text(row.get('护甲等级（AC）'))
    strength = text(row.get('力量'))
    stealth = text(row.get('隐匿'))
    if is_shield:
        match = re.fullmatch(r'\s*\+\s*(\d+)\s*', ac or '')
        item['shield'] = {'bonusAC': int(match.group(1)) if match else None}
        return item
    category = next((category for word, category in [('轻', 'light'), ('中', 'medium'), ('重', 'heavy')] if record['group'].startswith(word)), None)
    if not category:
        raise ValueError(f"Unknown armor group: {record['group']}")
    value = re.match(r'\s*(\d+)', ac or '')
    limit = re.search(r'最大\s*(\d+)', ac or '')
    required = re.search(r'力量\s*(\d+)', strength or '')
    item['armor'] = {'category': category, 'baseAC': int(value.group(1)) if value else None,
                     'addsDex': ('敏捷' in ac) if ac else None,
                     'dexCap': int(limit.group(1)) if limit else None,
                     'strengthRequirement': int(required.group(1)) if required else None,
                     'stealthDisadvantage': ('劣势' in stealth) if stealth else None,
                     'armorClassText': ac, 'strengthText': strength, 'stealthText': stealth}
    return item


def numeric(token: str) -> float:
    if token == '半': return 0.5
    if token == '五分之一': return 0.2
    return float(Fraction(token))


def container(capacity: str) -> dict:
    n = r'(五分之一|半|\d+(?:\.\d+)?(?:/\d+)?)'
    pounds = re.search(n + r'\s*磅', capacity)
    cubic = re.search(n + r'\s*立方尺', capacity)
    count = None
    content = None
    # Only one unambiguous ammunition type is encoded as an item count.
    if re.search(r'(?:20|二十)\s*(?:支|根)?\s*弩矢', capacity):
        count, content = 20, '弩矢'
    elif re.search(r'(?:20|二十)\s*(?:支|根)?\s*箭(?:矢)?', capacity):
        count, content = 20, '箭矢'
    return {'capacityLb': numeric(pounds.group(1)) if pounds else None,
            'capacityCubicFeet': numeric(cubic.group(1)) if cubic else None,
            'capacityCount': count, 'capacityItem': content, 'capacityText': capacity.strip()}


def descriptions_2024(root: Path) -> dict[str, tuple[str | None, str, str]]:
    result = {}
    for number in (1, 2, 3):
        path = f'01-规则正文/分节/chm-412b5d4a9bf3/{number:03d}.md'
        content = read(root / path)
        for match in re.finditer(r'<strong>([^<]+)</strong>\s*([^<\n]+)', content):
            heading, body = map(lambda s: html.unescape(s).strip(), match.groups())
            parsed = re.match(r'^([^A-Za-z]+?)\s*([A-Za-z][A-Za-z\u2019\u2018\' ,./-]*?)(?:\s*\([^)]*\))?$', heading)
            if not parsed:
                continue
            zh, english = parsed.group(1).strip(), parsed.group(2).strip()
            if zh and english and body:
                result[zh] = (english, body, path)
    return result


def descriptions_2014(root: Path) -> dict[str, tuple[str, str, str]]:
    result = {}
    for number in (3, 4):
        path = f'01-规则正文/分节/chm-30fad80178ac/{number:03d}.md'
        content = read(root / path)
        for match in re.finditer(r'<strong><em>([^<]+)</em></strong><strong><em>([^<]+)</em></strong>。([^<\n]+)', content):
            zh, english, body = (html.unescape(part).strip() for part in match.groups())
            result[zh] = (english, body, path)
    return result


def table_by_id(root: Path, ids: set[str]) -> dict[str, dict]:
    result = {}
    with (root / '05-机器索引/表格.jsonl').open(encoding='utf8') as file:
        for line in file:
            value = json.loads(line)
            if value['id'] in ids:
                result[value['id']] = value
    if set(result) != ids:
        raise ValueError(f'Missing tables: {ids - set(result)}')
    return result


def indexed_capacities(table: dict) -> dict[str, str]:
    result = {}
    aliases = {'瓶子': '玻璃瓶'}
    for row in table['rows'][1:]:
        raw_name, raw_capacity = [cell['text'] for cell in row[:2]]
        zh = names(raw_name)[0].rstrip('*＊')
        result[aliases.get(zh, zh)] = raw_capacity
    return result


def gear(record: dict, version: str, descriptions: dict, capacities: dict[str, str]) -> dict:
    item = base(record, version, 'adventuring')
    name = item['name']
    # A few headings rearrange an explicitly written bilingual title.
    heading_name = {'地图或卷轴匣': '卷轴匣/地图匣'}.get(name, name) if version == '2024' else name
    detail = descriptions.get(heading_name)
    if detail:
        english, body, path = detail
        if not item['nameEn']:
            item['nameEn'] = english
        item['description'] = body
        item['source']['additionalPaths'].append(path)
    capacity = capacities.get(name)
    if not capacity and detail and re.search(r'容量|最多能装入|至多(?:能)?(?:装入|存放|能够装入)|能装入|能够至多装入', detail[1]):
        capacity = detail[1]
    if name in ('箭袋', '弩矢匣', '地图或卷轴匣') and detail:
        capacity = detail[1]
    if capacity:
        item['container'] = container(capacity)
        item['gearType'] = 'container'
        if version == '2014' and name in capacities:
            item['source']['additionalPaths'].append('01-规则正文/分节/chm-30fad80178ac/004.md')
    elif version == '2014' and re.search(r'(?:Arrows|Blwgun needles|Crossbow bolts|Sling bullets)\s*\(\d+\)', item['rawName'], re.I):
        item['gearType'] = 'ammunition'
        count = re.search(r'\((\d+)\)', item['rawName'])
        item['quantityPerPack'] = int(count.group(1)) if count else None
    else:
        item['gearType'] = 'pack' if name.endswith('套组') else 'general'
    # These source rows explicitly price a bundle of separate objects. Lengths
    # such as a 10-foot chain are not item counts.
    if version == '2014' and name in {'滚珠', '铁蒺藜', '长铁钉'}:
        count = re.search(r'(\d+)\s*(?:粒|枚|根)', item['rawName'])
        if count:
            item['quantityPerPack'] = int(count.group(1))
    if version == '2024' and name == '铁钉' and detail and '一组铁钉具有十支' in detail[1]:
        item['quantityPerPack'] = 10
    return item


def ammo_2024(table: dict) -> list[dict]:
    result = []
    for number, row in enumerate(table['rows'][1:], 1):
        columns = [cell['text'] for cell in row]
        if len(columns) != 5:
            raise ValueError('Unexpected 2024 ammunition table structure')
        name, count, usual_container, pounds, price = columns
        identity = hashlib.sha256(f"{table['id']}:{number}:{name}".encode()).hexdigest()[:16]
        record = {'id': f'equipment-{identity}', 'name': name, 'source_id': table['source_id'],
                  'book': BOOKS['2024'], 'source_md_path': table['md_path'], 'source_table_id': table['id'],
                  'table_row': number, 'price_raw': price, 'weight_raw': pounds}
        item = base(record, '2024', 'adventuring')
        item.update({'gearType': 'ammunition', 'quantityPerPack': int(count),
                     'description': f'源表列出的常用容器：{usual_container}；容器需另行购买。'})
        result.append(item)
    return result


def packs_2014(root: Path) -> list[dict]:
    path = '01-规则正文/分节/chm-30fad80178ac/002.md'
    pattern = (r'<strong><em>([^<]+)</em></strong><strong><em>([^<]+)</em></strong>'
               r'<strong><em>（</em></strong><strong><em>([^<]+)</em></strong>'
               r'<strong><em>）</em></strong>。([^\n]+)')
    result = []
    for match in re.finditer(pattern, read(root / path)):
        name, english, price, body = (html.unescape(part).strip() for part in match.groups())
        identity = hashlib.sha256(f'{GEAR_SOURCES["2014"]}:pack:{name}'.encode()).hexdigest()[:16]
        item = {'id': f'equipment-{identity}', 'edition': '2014', 'name': name, 'nameEn': english,
                'rawName': name + ' ' + english, 'kind': 'adventuring', 'gearType': 'pack',
                'weightLb': None, 'weightWhenFullLb': None, 'weightText': None,
                'costCp': coins(price), 'costText': price, 'quantityPerPack': None, 'description': body,
                'source': {'id': GEAR_SOURCES['2014'], 'book': BOOKS['2014'], 'path': path,
                           'tableId': None, 'row': None, 'additionalPaths': []},
                'weapon': None, 'armor': None, 'shield': None, 'container': None}
        result.append(item)
    if len(result) != 7:
        raise ValueError(f'Expected seven 2014 equipment packs, got {len(result)}')
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source_dir', type=Path, help='processed rules-library directory')
    root = parser.parse_args().source_dir
    weapon_page = read(root / '01-规则正文/PHB-PDF/逐页/p0149.md')
    if not re.search(r'战镐\s+war pick\s+5\s+gp\s+1d8\s+穿刺\s+2\s+磅\s*[—－-]', weapon_page, re.I):
        raise ValueError('Processed 2014 source no longer verifies the war-pick property dash')
    verified_page = read(root / '01-规则正文/PHB-PDF/逐页/p0150.md')
    for pattern in (r'弩矢\s+crossbow bolts\s*\(20\)[^\n]*1\s*½\s*磅',
                    r'投石索弹丸\s+sling bullets\s*\(20\)[^\n]*1\s*½\s*磅'):
        if not re.search(pattern, verified_page, re.I):
            raise ValueError('Processed 2014 source no longer verifies the flattened mixed-fraction weights')
    index = root / '05-机器索引/核心与DM/装备实体.jsonl'
    with index.open(encoding='utf8') as file:
        records = [json.loads(line) for line in file]
    tables = table_by_id(root, {'tbl-30fad80178ac-2', 'tbl-412b5d4a9bf3-2'})
    capacities = indexed_capacities(tables['tbl-30fad80178ac-2'])
    desc = {'2014': descriptions_2014(root), '2024': descriptions_2024(root)}
    mastery_path = root / '01-规则正文/CHM/玩家手册2024/装备/精通词条.md'
    masteries = {m.group(1): html.unescape(m.group(2)).strip() for m in re.finditer(
        r'<strong>([\u4e00-\u9fff]+)\s+[A-Za-z]+</strong>\s*([\s\S]*?)(?=\n\s*<strong>|\Z)', read(mastery_path))}
    if len(masteries) != 8:
        raise ValueError(f'Expected eight 2024 mastery descriptions, got {len(masteries)}')
    special_path = root / '01-规则正文/分节/chm-272d02f7d80c/001.md'
    specials = {m.group(1): html.unescape(m.group(2)).strip() for m in re.finditer(
        r'<strong><em>(骑枪|捕网)</em></strong><strong><em>[^<]+</em></strong>。([\s\S]*?)(?=\n\s*<strong><em>|\n\s*#####|\Z)', read(special_path))}
    if set(specials) != {'骑枪', '捕网'}:
        raise ValueError('Missing special 2014 weapon descriptions')
    packs = {version: {'schemaVersion': 1, 'edition': version, 'items': []} for version in BOOKS}
    for version, pack in packs.items():
        for record in records:
            if record['book'] != BOOKS[version] or record['edition'] != f'5e-{version}':
                continue
            table = record['source_table_id']
            if table == WEAPON_TABLES[version]:
                item = weapon(record, version, masteries, specials)
            elif table == ARMOR_TABLES[version]:
                item = armor(record, version)
            elif table in GEAR_TABLES[version]:
                # These are group headings whose concrete choices are listed in subtables.
                if version == '2024' and record['name'] in {'弹药', '奥术法器', '德鲁伊法器', '圣徽'}:
                    continue
                item = gear(record, version, desc[version], capacities if version == '2014' else {})
            else:
                continue
            pack['items'].append(item)
        pack['items'].extend(packs_2014(root) if version == '2014' else ammo_2024(tables['tbl-412b5d4a9bf3-2']))
        for item in pack['items']:
            item['source']['additionalPaths'] = list(dict.fromkeys(item['source']['additionalPaths']))
        pack['items'].sort(key=lambda item: item['id'])
        ids = [item['id'] for item in pack['items']]
        if len(ids) != len(set(ids)):
            raise ValueError(f'Duplicate IDs in {version}')
        OUTPUT.mkdir(parents=True, exist_ok=True)
        (OUTPUT / f'equipment-{version}.json').write_text(
            json.dumps(pack, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf8')
        print(version, len(pack['items']), 'items', {kind: sum(i['kind'] == kind for i in pack['items']) for kind in ('weapon', 'armor', 'shield', 'adventuring')})


if __name__ == '__main__':
    main()
