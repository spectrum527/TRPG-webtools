import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Bookmark,
  Check,
  Download,
  FileUp,
  Search,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import type { DndEdition } from '../../shared/dnd-edition';
import {
  parseDndReferencePack,
  parseDndReferenceCollection,
  dndReferenceCollectionJSON,
  dndReferenceCollectionMD,
  MAX_DND_REFERENCE_BYTES,
  type DndReferenceEntry,
  type DndReferencePack,
} from '../../shared/dnd-reference';
import { getDndReferences, saveDndReferences, removeDndReference } from '../dnd-reference-storage';
import { downloadFile } from '../storage';
import { Spinner } from './ui';

const categories = {
  core: '核心规则',
  expansion: '出版扩展',
  playtest: '测试资料 UA',
  'third-party': '第三方',
  other: '其他资料',
};
const packCache = new Map<DndEdition, DndReferencePack>();
const entryName = (entry: DndReferenceEntry) => entry.nameZh || entry.nameEn || '未命名资料';

export function DndReferenceLibrary({
  edition,
  kind,
}: {
  edition: DndEdition;
  kind: 'spell' | 'feat';
}) {
  const [pack, setPack] = useState<DndReferencePack | null>(packCache.get(edition) ?? null);
  const [saved, setSaved] = useState<DndReferenceEntry[]>([]);
  const [loading, setLoading] = useState(!pack);
  const [storageReady, setStorageReady] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [scope, setScope] = useState<'catalog' | 'saved'>('catalog');
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search.trim().toLocaleLowerCase());
  const [source, setSource] = useState('core');
  const [level, setLevel] = useState('all');
  const [characterClass, setCharacterClass] = useState('all');
  const [selected, setSelected] = useState('');
  const [reading, setReading] = useState(false);
  const [limit, setLimit] = useState(40);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setPack(packCache.get(edition) ?? null);
    setLoading(!packCache.has(edition));
    if (!packCache.has(edition))
      void (async () => {
        try {
          const response = await fetch(`${import.meta.env.BASE_URL}rules/dnd-${edition}.json`, {
            signal: controller.signal,
          });
          if (!response.ok) throw new Error('规则资料暂时无法读取，请重试。');
          const next = parseDndReferencePack(await response.json());
          if (next.edition !== edition) throw new Error('规则资料版本不匹配，请刷新后重试。');
          packCache.set(edition, next);
          setPack(next);
        } catch (reason) {
          if (!controller.signal.aborted) setError((reason as Error).message);
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      })();
    return () => controller.abort();
  }, [edition, retry]);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const entries = await getDndReferences();
        if (live) {
          setSaved(entries);
          setStorageReady(true);
        }
      } catch (reason) {
        if (live) {
          setStorageReady(false);
          setError((reason as Error).message);
        }
      }
    };
    void load();
    const refresh = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [retry]);
  useEffect(() => {
    setLimit(40);
    setReading(false);
    setSelected('');
  }, [query, source, level, characterClass, scope, kind, edition]);
  const personal = saved.filter((entry) => entry.edition === edition && entry.kind === kind);
  const catalog = useMemo(
    () => (kind === 'spell' ? (pack?.spells ?? []) : (pack?.feats ?? [])),
    [pack, kind],
  );
  const classes = useMemo(
    () =>
      [
        ...new Set(
          catalog.flatMap((entry) => (entry.kind === 'spell' ? (entry.classes ?? []) : [])),
        ),
      ].sort(),
    [catalog],
  );
  const filtered = (scope === 'saved' ? personal : catalog).filter(
    (entry) =>
      (scope === 'saved' || entry.source.category === source) &&
      (kind !== 'spell' ||
        (entry.kind === 'spell' &&
          (level === 'all' || entry.level === Number(level)) &&
          (characterClass === 'all' || entry.classes?.includes(characterClass)))) &&
      (!query ||
        `${entry.nameZh} ${entry.nameEn} ${entry.source.book} ${entry.rawText}`
          .toLocaleLowerCase()
          .includes(query)),
  );
  const current = filtered.find((entry) => entry.id === selected) ?? filtered[0];
  const isSaved = !!current && saved.some((entry) => entry.id === current.id);
  async function toggleSave() {
    if (!current) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setSaved(isSaved ? await removeDndReference(current.id) : await saveDndReferences([current]));
      setMessage(
        isSaved
          ? '已从个人清单移除，规则目录仍可查阅。'
          : `已加入${kind === 'spell' ? '我的法术书' : '我的专长'}。`,
      );
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function importFile(input?: File) {
    if (!input) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (input.size > MAX_DND_REFERENCE_BYTES * 2)
        throw new Error('导入文件不能超过 16 MiB，清单数据不能超过 8 MiB。');
      const entries = parseDndReferenceCollection(await input.text());
      setSaved(await saveDndReferences(entries));
      setScope('saved');
      setMessage(
        `已导入 ${entries.length} 条资料。当前显示 ${edition} 版${kind === 'spell' ? '法术' : '专长'}，其他条目可切换后查看。`,
      );
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  }
  async function exportFile(format: 'json' | 'md') {
    setBusy(true);
    setError('');
    try {
      const latest = await getDndReferences();
      setSaved(latest);
      const entries = latest.filter((entry) => entry.edition === edition && entry.kind === kind);
      downloadFile(
        format === 'md' ? dndReferenceCollectionMD(entries) : dndReferenceCollectionJSON(entries),
        `DND-${edition}-${kind === 'spell' ? '法术书' : '专长清单'}.${format}`,
        format === 'md' ? 'text/markdown' : 'application/json',
      );
      setMessage(`已导出当前版本的 ${entries.length} 条个人资料。`);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="dnd-reference panel" aria-label={kind === 'spell' ? '法术书' : '专长资料'}>
      <div className="reference-heading">
        <div className="reference-title">
          <span className="toolkit-icon">
            {kind === 'spell' ? <BookOpen size={25} /> : <Sparkles size={25} />}
          </span>
          <div>
            <h2>{kind === 'spell' ? '法术书' : '专长'}</h2>
            <p>
              {kind === 'spell' ? '查阅与收藏法术' : '查阅先决条件与能力，整理角色的成长选择。'}
            </p>
          </div>
        </div>
        <div className="reference-file-actions">
          <button
            className="button secondary compact"
            disabled={busy || !storageReady}
            onClick={() => file.current?.click()}
          >
            <FileUp size={15} />
            导入清单
          </button>
          <button
            className="text-button"
            disabled={!personal.length || busy}
            onClick={() => exportFile('json')}
          >
            <Download size={14} />
            JSON
          </button>
          <button
            className="text-button"
            disabled={!personal.length || busy}
            onClick={() => exportFile('md')}
          >
            Markdown
          </button>
          <input
            ref={file}
            type="file"
            className="visually-hidden"
            accept=".json,.md,.markdown"
            aria-label="导入法术或专长清单"
            onChange={(event) => void importFile(event.target.files?.[0])}
          />
        </div>
      </div>
      <div className="reference-toolbar">
        <div className="tabs">
          <button
            className={scope === 'catalog' ? 'active' : ''}
            onClick={() => setScope('catalog')}
          >
            规则目录
          </button>
          <button className={scope === 'saved' ? 'active' : ''} onClick={() => setScope('saved')}>
            {kind === 'spell' ? '我的法术书' : '我的专长'} <span>{personal.length}</span>
          </button>
        </div>
        <label className="reference-search">
          <Search size={17} />
          <input
            type="search"
            aria-label="搜索法术或专长"
            placeholder="搜索名称、效果或出处…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      <div className="reference-filters">
        {scope === 'catalog' && (
          <label>
            资料来源
            <select
              aria-label="资料来源"
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              {Object.entries(categories).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === 'spell' && (
          <>
            <label>
              环级
              <select
                aria-label="法术环级"
                value={level}
                onChange={(event) => setLevel(event.target.value)}
              >
                <option value="all">全部环级</option>
                {Array.from({ length: 10 }, (_, value) => (
                  <option key={value} value={value}>
                    {value ? `${value} 环` : '戏法'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              职业
              <select
                aria-label="法术职业"
                value={characterClass}
                onChange={(event) => setCharacterClass(event.target.value)}
              >
                <option value="all">全部职业</option>
                {classes.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <span className="reference-count">
          {edition} 版 · {filtered.length} 条
        </span>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          {error}
          <button
            className="text-button"
            onClick={() => {
              setError('');
              setRetry((value) => value + 1);
            }}
          >
            <RefreshCw size={14} />
            重新读取
          </button>
        </div>
      )}
      {message && (
        <p className="reference-notice" role="status">
          <Check size={15} />
          {message}
        </p>
      )}
      {loading && scope === 'catalog' ? (
        <div className="toolkit-loading">
          <Spinner />
          正在读取 {edition} 版资料…
        </div>
      ) : (
        <div className="reference-layout" data-reading={reading}>
          <div className="reference-results" aria-label="资料列表">
            {!filtered.length && (
              <div className="reference-empty">
                <BookOpen size={30} strokeWidth={1.3} />
                <p>
                  {scope === 'saved' && !personal.length
                    ? kind === 'spell'
                      ? '暂无法术'
                      : '暂无专长'
                    : kind === 'spell'
                      ? '暂无匹配的法术'
                      : '暂无匹配的专长'}
                </p>
                {scope === 'saved' && (
                  <button className="text-button" onClick={() => setScope('catalog')}>
                    前往规则目录
                  </button>
                )}
              </div>
            )}
            {filtered.slice(0, limit).map((entry) => (
              <button
                key={entry.id}
                className={`reference-result ${current?.id === entry.id ? 'selected' : ''}`}
                aria-pressed={current?.id === entry.id}
                onClick={() => {
                  setSelected(entry.id);
                  setReading(true);
                }}
              >
                <span className="reference-level">
                  {entry.kind === 'spell' ? (
                    entry.level === 0 ? (
                      '戏法'
                    ) : entry.level === null ? (
                      '—'
                    ) : (
                      `${entry.level}环`
                    )
                  ) : (
                    <Sparkles size={17} />
                  )}
                </span>
                <span>
                  <b>{entryName(entry)}</b>
                  <small>
                    {entry.nameEn && entry.nameEn !== entry.nameZh ? `${entry.nameEn} · ` : ''}
                    {entry.kind === 'spell'
                      ? entry.school || '学派待核对'
                      : entry.featType || '专长'}
                  </small>
                </span>
                {saved.some((item) => item.id === entry.id) && (
                  <Bookmark size={14} fill="currentColor" />
                )}
              </button>
            ))}
            {filtered.length > limit && (
              <button
                className="button secondary full compact reference-more"
                onClick={() => setLimit((value) => value + 40)}
              >
                显示更多（还剩 {filtered.length - limit} 条）
              </button>
            )}
          </div>
          {current && (
            <article className="reference-detail" aria-label="资料详情">
              <button className="text-button reference-back" onClick={() => setReading(false)}>
                <ArrowLeft size={16} />
                返回目录
              </button>
              <div className="reference-detail-heading">
                <div>
                  <span className="reference-source-label">
                    {edition} · {categories[current.source.category]}
                  </span>
                  <h3>{entryName(current)}</h3>
                  {current.nameEn && <p>{current.nameEn}</p>}
                </div>
                <button
                  className={`button ${isSaved ? 'secondary' : 'primary'} compact`}
                  disabled={busy || !storageReady}
                  onClick={() => void toggleSave()}
                >
                  {busy ? (
                    <Spinner />
                  ) : (
                    <Bookmark size={15} fill={isSaved ? 'currentColor' : 'none'} />
                  )}
                  {isSaved ? '移出个人清单' : kind === 'spell' ? '加入法术书' : '收藏专长'}
                </button>
              </div>
              <dl className="reference-facts">
                {(current.kind === 'spell'
                  ? [
                      [
                        '环级与学派',
                        `${current.level === null ? '待核对' : current.level === 0 ? '戏法' : `${current.level} 环`} · ${current.school || '待核对'}`,
                      ],
                      ['施法时间', current.castingTime],
                      ['距离', current.range],
                      ['持续时间', current.duration],
                      ['成分', current.components],
                      ['职业', current.classes?.join('、') || '未提取，请核对原文'],
                      [
                        '专注 / 仪式',
                        `${current.concentration === null ? '专注待核对' : current.concentration ? '需要专注' : '无需专注'} / ${current.ritual === null ? '仪式待核对' : current.ritual ? '可用仪式' : '非仪式'}`,
                      ],
                    ]
                  : [
                      ['类型', current.featType || '未提取，请核对原文'],
                      ['先决条件', current.prerequisites || '未单独提取，请核对原文'],
                    ]
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value || '待核对'}</dd>
                  </div>
                ))}
              </dl>
              <div className="reference-rule-text">{current.rawText}</div>
              <details className="reference-provenance">
                <summary>来源与核对说明 · {current.source.book}</summary>
                <p>来源编号：{current.source.id}</p>
                <p>{current.source.locator}</p>
                <p className="reference-source-path">{current.source.path}</p>
                {current.reviewStatus && <p>{current.reviewStatus}</p>}
                <p>
                  效果按所提供资料保留，不自动授予能力或执行法术。职业标注可能包含后续书目补充，请结合本团允许来源核对。
                </p>
              </details>
            </article>
          )}
        </div>
      )}
      <p className="reference-footnote">
        个人清单保存在当前浏览器，可在入房前整理、在跑团中随时查阅；切换版本不会改写已收藏资料。法术位、先决条件和复杂效果仍由同桌确认。
      </p>
    </section>
  );
}
