import { useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Search, Trash2 } from 'lucide-react';
import {
  COC_ARMOR_CATALOG,
  COC_ARMOR_KINDS,
  COC_WEAPON_CATALOG,
  COC_WEAPON_CATEGORIES,
  cocArmorCoverageLabel,
  type CocArmorProfile,
  type CocWeaponProfile,
} from '../../shared/coc-equipment';
import { COC_SKILL_CATALOG } from '../../shared/coc-career';
import type { CocPreparationLibrary } from '../../shared/coc-library';
import { Modal } from './ui';

type Kind = 'weapon' | 'armor';
type Entry = {
  id: string;
  profile: CocWeaponProfile | CocArmorProfile;
  saved?: boolean;
  notes?: string;
};
const pageSize = 16;
const skillLabel = (key: string) =>
  COC_SKILL_CATALOG.find((skill) => skill.key === key)?.label ?? key;
const sourceLabel = (entry: Entry) =>
  entry.saved
    ? '个人备团库'
    : entry.profile.reference
      ? `参考卡 · 第 ${entry.profile.reference.row} 行`
      : '原有模板';
export function cocEquipmentName(kind: Kind, id: string, library: CocPreparationLibrary) {
  return id.startsWith('library:')
    ? (kind === 'weapon' ? library.weapons : library.armor).find(
        (entry) => `library:${entry.id}` === id,
      )?.profile.name
    : (kind === 'weapon' ? COC_WEAPON_CATALOG : COC_ARMOR_CATALOG).find((entry) => entry.id === id)
        ?.profile.name;
}

export function CocEquipmentBrowser({
  kind,
  library,
  onSelect,
  onRemove,
}: {
  kind: Kind;
  library: CocPreparationLibrary;
  onSelect?: (id: string) => void;
  onRemove?: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [category, setCategory] = useState('all');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState('');
  const catalog = kind === 'weapon' ? COC_WEAPON_CATALOG : COC_ARMOR_CATALOG;
  const saved: Entry[] = (kind === 'weapon' ? library.weapons : library.armor).map((entry) => ({
    ...entry,
    id: `library:${entry.id}`,
    saved: true,
  }));
  const entries: Entry[] = [...catalog, ...saved];
  const typeOf = (entry: Entry) =>
    'category' in entry.profile ? entry.profile.category : (entry.profile.kind ?? 'worn');
  const categories = kind === 'weapon' ? COC_WEAPON_CATEGORIES : COC_ARMOR_KINDS;
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = entries.filter(
    (entry) =>
      (source === 'all'
        ? true
        : source === 'workbook'
          ? entry.profile.reference && !entry.saved
          : source === 'saved'
            ? entry.saved
            : !entry.profile.reference && !entry.saved) &&
      (category === 'all' || typeOf(entry) === category) &&
      tokens.every((token) =>
        `${entry.profile.name} ${'skillKey' in entry.profile ? skillLabel(entry.profile.skillKey) : cocArmorCoverageLabel(entry.profile)} ${sourceLabel(entry)}`
          .toLowerCase()
          .includes(token),
      ),
  );
  const pages = Math.max(1, Math.ceil(results.length / pageSize));
  const visiblePage = Math.min(page, pages - 1);
  const visible = results.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize);
  const preview = results.find((entry) => entry.id === selected) ?? visible[0];
  const profile = preview?.profile;
  const reset = () => {
    setPage(0);
    setSelected('');
  };
  const term = kind === 'weapon' ? '武器' : '防护物';
  return (
    <div className="occupation-browser coc-equipment-browser">
      <div className="equipment-browser-filters">
        <label className="occupation-search">
          <Search size={18} aria-hidden="true" />
          <input
            aria-label={`搜索${term}目录`}
            type="search"
            placeholder={kind === 'weapon' ? '名称、关联技能或来源' : '名称、防护部位或来源'}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              reset();
            }}
          />
        </label>
        <select
          aria-label="装备来源"
          value={source}
          onChange={(event) => {
            setSource(event.target.value);
            reset();
          }}
        >
          <option value="all">全部来源</option>
          <option value="workbook">参考自动卡</option>
          <option value="saved">个人备团库</option>
          <option value="legacy">原有模板</option>
        </select>
        <select
          aria-label="装备类型筛选"
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
            reset();
          }}
        >
          <option value="all">全部类型</option>
          {Object.entries(categories).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="occupation-browser-count" role="status">
        {results.length} 项{term}
      </div>
      {preview && profile ? (
        <div className="occupation-browser-layout">
          <div className="occupation-browser-list">
            <div className="occupation-results" aria-label={`${term}目录结果`}>
              {visible.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  className={`occupation-result${entry.id === preview.id ? ' is-selected' : ''}`}
                  aria-pressed={entry.id === preview.id}
                  onClick={() => setSelected(entry.id)}
                >
                  <span>
                    <strong>{entry.profile.name}</strong>
                    <small>{sourceLabel(entry)}</small>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              ))}
            </div>
            {pages > 1 && (
              <nav className="occupation-pagination" aria-label={`${term}目录分页`}>
                <button
                  type="button"
                  className="icon-button small"
                  aria-label="上一页装备"
                  disabled={!visiblePage}
                  onClick={() => {
                    setPage(visiblePage - 1);
                    setSelected('');
                  }}
                >
                  <ChevronLeft size={17} />
                </button>
                <span>
                  {visiblePage + 1} / {pages}
                </span>
                <button
                  type="button"
                  className="icon-button small"
                  aria-label="下一页装备"
                  disabled={visiblePage + 1 >= pages}
                  onClick={() => {
                    setPage(visiblePage + 1);
                    setSelected('');
                  }}
                >
                  <ChevronRight size={17} />
                </button>
              </nav>
            )}
          </div>
          <article className="occupation-preview" aria-label="装备详情">
            <span className="mini-label">{sourceLabel(preview)}</span>
            <h3>{profile.name}</h3>
            <dl className="occupation-facts">
              {'damage' in profile ? (
                <>
                  <div>
                    <dt>关联技能</dt>
                    <dd>{skillLabel(profile.skillKey)}</dd>
                  </div>
                  <div>
                    <dt>伤害</dt>
                    <dd>
                      {profile.sourceText?.damage ??
                        `${profile.damage}${profile.damageBonusMode === 'full' ? ' + DB' : profile.damageBonusMode === 'half' ? ' + ½DB' : ''}`}
                    </dd>
                  </div>
                  <div>
                    <dt>基础射程</dt>
                    <dd>
                      {profile.manualRange
                        ? `待确认（原文 ${profile.sourceText?.range}）`
                        : profile.rangeRule
                          ? 'STR ÷ 5 码'
                          : profile.range
                            ? `${[profile.range, ...(profile.longerRanges ?? []).map((band) => band.range)].join(' / ')} 码`
                            : '接触／布置'}
                    </dd>
                  </div>
                  <div>
                    <dt>每轮使用</dt>
                    <dd>
                      {profile.sourceText?.usesPerRound ??
                        (profile.roundsPerUse
                          ? `每 ${profile.roundsPerUse} 轮 ${profile.usesPerRound} 次`
                          : `${profile.usesPerRound}${profile.rapidUsesPerRound ? `（${profile.rapidUsesPerRound}）` : ''}`)}
                    </dd>
                  </div>
                  <div>
                    <dt>装弹量</dt>
                    <dd>{profile.sourceText?.capacity ?? profile.capacity}</dd>
                  </div>
                  <div>
                    <dt>故障值</dt>
                    <dd>{profile.malfunction || '无'}</dd>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <dt>防护类型</dt>
                    <dd>{COC_ARMOR_KINDS[profile.kind ?? 'worn']}</dd>
                  </div>
                  <div>
                    <dt>护甲</dt>
                    <dd>
                      {profile.sourceText?.rating ?? profile.rating}
                      {profile.manualRating && ' · 需裁定'}
                    </dd>
                  </div>
                  <div>
                    <dt>MOV 减值</dt>
                    <dd>{profile.sourceText?.movPenalty ?? profile.movPenalty}</dd>
                  </div>
                  <div>
                    <dt>覆盖部位</dt>
                    <dd>{profile.sourceText?.coverage ?? cocArmorCoverageLabel(profile)}</dd>
                  </div>
                  {profile.sourceText?.protection && (
                    <div>
                      <dt>防护条件</dt>
                      <dd>{profile.sourceText.protection}</dd>
                    </div>
                  )}
                </>
              )}
              {profile.sourceText?.era && (
                <div>
                  <dt>时代</dt>
                  <dd>{profile.sourceText.era}</dd>
                </div>
              )}
            </dl>
            {(profile.rulesNotes || preview.notes) && (
              <p className="occupation-source-note">{profile.rulesNotes ?? preview.notes}</p>
            )}
            {profile.reference && (
              <p className="field-help">
                自动卡 · {profile.reference.sheet}第 {profile.reference.row}{' '}
                行。扩展条件由主持人确认。
              </p>
            )}
            {onSelect && (
              <button
                type="button"
                className="button primary occupation-apply"
                onClick={() => onSelect(preview.id)}
              >
                <Check size={17} />
                选择此{kind === 'weapon' ? '武器' : '防护物'}
              </button>
            )}
            {preview.saved && onRemove && (
              <button
                type="button"
                className="text-button danger"
                onClick={() => onRemove(preview.id.slice('library:'.length))}
              >
                <Trash2 size={16} />
                删除资料
              </button>
            )}
          </article>
        </div>
      ) : (
        <div className="coc-empty">暂无匹配{term}</div>
      )}
    </div>
  );
}

export function CocEquipmentPicker({
  kind,
  library,
  value,
  onChange,
  disabled,
  onOpen,
}: {
  kind: Kind;
  library: CocPreparationLibrary;
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const name = kind === 'weapon' ? '武器' : '防具';
  return (
    <div className="field">
      <span>{name}</span>
      <button
        type="button"
        className="occupation-picker-trigger"
        aria-label={`选择${name}`}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => {
          onOpen?.();
          setOpen(true);
        }}
      >
        <span>{cocEquipmentName(kind, value, library) ?? `请选择${name}`}</span>
        <ChevronRight size={17} />
      </button>
      {open && (
        <Modal
          title={`${name}目录`}
          subtitle="EQUIPMENT · COC 7"
          className="occupation-picker-modal"
          onClose={() => setOpen(false)}
        >
          <CocEquipmentBrowser
            kind={kind}
            library={library}
            onSelect={(id) => {
              onChange(id);
              setOpen(false);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
