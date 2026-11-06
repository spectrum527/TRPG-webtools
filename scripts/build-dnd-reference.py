#!/usr/bin/env python3
"""Build D&D reference packs from the supplied *processed* rules library.

Usage: python3 scripts/build-dnd-reference.py /path/to/DND5e规则库
The source directory is an argument; raw PDF/CHM files are never opened. The
output is deterministic and writes only to this project's public/rules folder.
"""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
OUTPUT = PROJECT / 'public' / 'rules'
CORE_BOOKS = {'2014': '玩家手册', '2024': '玩家手册2024'}


def edition(value: object) -> str | None:
    return {'5e-2014': '2014', '5e-2024': '2024'}.get(value)


def relative_path(value: str) -> str:
    value = value.removeprefix('DND5e规则库/')
    parts = Path(value).parts
    if not value or value.startswith('/') or '..' in parts:
        raise ValueError(f'Invalid relative source path: {value!r}')
    return value


def category(book: str, authority: str, version: str) -> str:
    if authority == 'published' and book == CORE_BOOKS[version]:
        return 'core'
    return {
        'published': 'expansion',
        'playtest': 'playtest',
        'third-party': 'third-party',
    }.get(authority, 'other')


def source(id: str, book: str, path: str, authority: str, version: str, locator: str | None) -> dict:
    return {
        'id': id,
        'book': book,
        'path': relative_path(path),
        'authority': authority,
        'category': category(book, authority, version),
        'locator': locator,
    }


def spell(item: dict, version: str) -> dict:
    origin = item['source']
    line = item.get('position', {}).get('line_in_rendered_source')
    locator = f"#{item['anchor']}" if item.get('anchor') else (f'line {line}' if line else None)
    return {
        'kind': 'spell', 'id': item['id'], 'edition': version,
        'nameZh': item.get('name_zh'), 'nameEn': item.get('name_en'),
        'source': source(origin['id'], origin['book'], origin['md_path'], item['authority'], version, locator),
        'rawText': item['entry_raw'],
        'reviewStatus': '; '.join(item.get('review_flags') or []) or None,
        'level': item.get('level'), 'school': item.get('school'), 'classes': item.get('classes'),
        'castingTime': item.get('casting_time_raw'), 'range': item.get('range_raw'),
        'components': item.get('components_raw'), 'duration': item.get('duration_raw'),
        'concentration': item.get('concentration'), 'ritual': item.get('ritual'),
    }


def prerequisite(item: dict) -> str | None:
    """Only extract a condition where the visible source provides a clear boundary."""
    raw = item['raw_text']
    match = re.search(r'（先决(?:条件)?[：:]\s*([^（）\n]+)）', raw)
    if match:
        return match.group(1).strip() or None
    match = re.search(r'(?:^|\n)\s*先决条件[：:]\s*([^\n]+)', raw)
    if match:
        return match.group(1).strip() or None
    return None


def feat_english_name(item: dict) -> str | None:
    if item.get('name_en'):
        return item['name_en']
    # A few aggregation pages place the English title immediately after the
    # Chinese title, but omit it in the structured field. Require an explicit
    # Chinese-text or paragraph boundary; do not infer a translation.
    name_zh = item.get('name_zh')
    if not name_zh:
        return None
    pattern = re.escape(name_zh) + r"[ \t]*(?:\n[ \t]*)?([A-Za-z][A-Za-z'’ -]*?)(?=[\u3400-\u9fff]|\n\s*\n)"
    match = re.match(pattern, item['raw_text'])
    return match.group(1).strip() if match else None


def feat(item: dict, version: str) -> dict:
    # 2024 categories are source page headings. No category is inferred for 2014.
    title = item.get('source_title') or ''
    feat_type = next((kind for kind in ('传奇恩惠专长', '战斗风格专长', '通用专长', '起源专长')
                      if version == '2024' and title.startswith(kind)), None)
    loc = item.get('source_locator') or {}
    return {
        'kind': 'feat', 'id': item['entity_id'], 'edition': version,
        'nameZh': item.get('name_zh'), 'nameEn': feat_english_name(item),
        'source': source(item['source_id'], item['book'], item['md_path'], item['authority'], version, loc.get('xpath')),
        'rawText': item['raw_text'], 'reviewStatus': item.get('review_status'),
        'featType': feat_type, 'prerequisites': prerequisite(item),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source_dir', type=Path, help='processed rules library root (not the raw CHM/PDF)')
    args = parser.parse_args()
    index = args.source_dir / '05-机器索引'
    spells = json.loads((index / '魔法' / 'spells.json').read_text(encoding='utf-8'))
    with (index / '角色' / 'entities.jsonl').open(encoding='utf-8') as f:
        feats = [item for line in f if (item := json.loads(line))['entity_type'] == 'feat']
    packs = {version: {'schemaVersion': 1, 'edition': version, 'spells': [], 'feats': []}
             for version in CORE_BOOKS}
    skipped = Counter()
    for item in spells:
        # Follow the index documentation's fallback, never assign unknown/mixed to a version.
        declared = item.get('edition')
        corpus = item['source'].get('corpus_edition')
        version = edition(declared) if declared not in (None, '') else edition(corpus)
        if version is None or (edition(corpus) is not None and edition(corpus) != version):
            skipped['spell'] += 1
            continue
        packs[version]['spells'].append(spell(item, version))
    for item in feats:
        version = edition(item.get('edition'))
        if version is None:
            skipped['feat'] += 1
            continue
        packs[version]['feats'].append(feat(item, version))
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for version, pack in packs.items():
        for kind in ('spells', 'feats'):
            pack[kind].sort(key=lambda item: item['id'])
        ids = [item['id'] for kind in ('spells', 'feats') for item in pack[kind]]
        if len(ids) != len(set(ids)):
            raise ValueError(f'Duplicate reference IDs in {version}')
        dest = OUTPUT / f'dnd-{version}.json'
        dest.write_text(json.dumps(pack, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
        print(f'{version}: {len(pack["spells"])} spells, {len(pack["feats"])} feats -> {dest.name}')
    print(f'Skipped records with unconfirmed/mixed edition: {dict(skipped)}')


if __name__ == '__main__':
    main()
