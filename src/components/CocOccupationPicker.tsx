import { useState } from 'react';
import { BookOpen, Check, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import {
  COC_OCCUPATION_RULES,
  COC_SKILL_CATALOG,
  cocOccupationProfile,
  type OccupationProfile,
} from '../../shared/coc-career';
import {
  COC_OCCUPATION_BOOKS,
  COC_WORKBOOK_OCCUPATIONS,
  cocOccupationSource,
} from '../../shared/coc-occupations';
import type { Character } from '../../shared/types';
import { Modal } from './ui';

const profileKey = (profile: OccupationProfile) => profile.id ?? `legacy:${profile.name}`;
const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
const pageSize = 20;
const skillName = (key: string) =>
  COC_SKILL_CATALOG.find((skill) => skill.key === key)?.label ??
  {
    anyFighting: '格斗（任一）',
    anyFirearms: '射击（任一）',
    anyPilot: '驾驶（任一）',
    europeanLanguage: '外语（欧洲）',
  }[key] ??
  key;

export function CocOccupationBrowser({
  current,
  onSelect,
}: {
  current?: OccupationProfile;
  onSelect?: (profile: OccupationProfile) => void;
}) {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [page, setPage] = useState(0);
  const [previewKey, setPreviewKey] = useState(current ? profileKey(current) : '');
  const catalogue = source === 'legacy' ? COC_OCCUPATION_RULES : COC_WORKBOOK_OCCUPATIONS;
  const tokens = query
    .trim()
    .split(/[\s，,]+/u)
    .filter(Boolean)
    .map(normalize);
  const results = catalogue.filter(
    (profile) =>
      (source === 'all' || source === 'legacy' || profile.reference?.book === source) &&
      tokens.every((token) =>
        normalize(
          [
            profile.name,
            cocOccupationSource(profile),
            profile.skillsText ?? '',
            ...profile.groups.flat().map(skillName),
          ].join(' '),
        ).includes(token),
      ),
  );
  const pages = Math.max(1, Math.ceil(results.length / pageSize));
  const visiblePage = Math.min(page, pages - 1);
  const visible = results.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize);
  const preview = results.find((profile) => profileKey(profile) === previewKey) ?? visible[0];
  const changeQuery = (value: string) => {
    setQuery(value);
    setPage(0);
    setPreviewKey('');
  };
  return (
    <div className="occupation-browser">
      <div className="occupation-browser-filters">
        <label className="occupation-search">
          <Search size={18} aria-hidden="true" />
          <input
            aria-label="搜索职业目录"
            placeholder="搜索职业、技能或编号"
            type="search"
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
          />
        </label>
        <label className="field occupation-source-filter">
          <span className="visually-hidden">职业来源</span>
          <select
            aria-label="职业来源"
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setPage(0);
              setPreviewKey('');
            }}
          >
            <option value="all">全部来源 · {COC_WORKBOOK_OCCUPATIONS.length}</option>
            {Object.entries(COC_OCCUPATION_BOOKS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
            <option value="legacy">原有模板 · {COC_OCCUPATION_RULES.length}</option>
          </select>
        </label>
      </div>
      <div className="occupation-browser-count" role="status">
        {results.length} 项职业{query && ` · “${query}”`}
      </div>
      {preview ? (
        <div className="occupation-browser-layout">
          <div className="occupation-browser-list" aria-label="职业目录结果">
            <div className="occupation-results">
              {visible.map((profile) => (
                <button
                  type="button"
                  key={profileKey(profile)}
                  className={`occupation-result${profileKey(preview) === profileKey(profile) ? ' is-selected' : ''}`}
                  aria-pressed={profileKey(preview) === profileKey(profile)}
                  onClick={() => setPreviewKey(profileKey(profile))}
                >
                  <span>
                    <strong>{profile.name}</strong>
                    <small>{cocOccupationSource(profile)}</small>
                  </span>
                  {current && profileKey(profile) === profileKey(current) ? (
                    <Check size={17} aria-label="当前职业" />
                  ) : (
                    <ChevronRight size={16} aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>
            {pages > 1 && (
              <nav className="occupation-pagination" aria-label="职业目录分页">
                <button
                  type="button"
                  className="icon-button small"
                  aria-label="上一页职业"
                  disabled={visiblePage === 0}
                  onClick={() => {
                    setPage(visiblePage - 1);
                    setPreviewKey('');
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
                  aria-label="下一页职业"
                  disabled={visiblePage + 1 >= pages}
                  onClick={() => {
                    setPage(visiblePage + 1);
                    setPreviewKey('');
                  }}
                >
                  <ChevronRight size={17} />
                </button>
              </nav>
            )}
          </div>
          <article className="occupation-preview" aria-label="职业详情">
            <span className="mini-label">{cocOccupationSource(preview)}</span>
            <h3>{preview.name}</h3>
            <dl className="occupation-facts">
              <div>
                <dt>职业点</dt>
                <dd>
                  {preview.bonus.length
                    ? `EDU × 2 + ${preview.bonus.map((key) => key.toUpperCase()).join(' / ')} × 2`
                    : 'EDU × 4'}
                </dd>
              </div>
              <div>
                <dt>信用评级</dt>
                <dd>{preview.credit.join('–')}</dd>
              </div>
            </dl>
            <h4>职业技能</h4>
            <p className="occupation-skills-text">
              {preview.skillsText ??
                [
                  preview.groups.map((group) => group.map(skillName).join(' / ')).join('；'),
                  preview.free ? `自选 ${preview.free} 项` : '',
                ]
                  .filter(Boolean)
                  .join('；')}
            </p>
            {preview.notes && <p className="occupation-source-note">{preview.notes}</p>}
            {preview.reference && (
              <p className="field-help">
                自动卡 · 职业列表第 {preview.reference.row} 行
                {preview.reference.book === 'japanese' &&
                  ' · 2010／帝国／2015 合集，原表未逐项标注子来源'}
                {preview.reference.book !== 'handbook' && ' · 扩展职业须经主持人审核'}
              </p>
            )}
            {onSelect && (
              <button
                type="button"
                className="button primary occupation-apply"
                onClick={() => onSelect(preview)}
              >
                <Check size={17} />
                使用此职业
              </button>
            )}
          </article>
        </div>
      ) : (
        <div className="coc-empty">暂无匹配职业，请换个关键词。</div>
      )}
    </div>
  );
}

export function CocOccupationPicker({
  card,
  onSelect,
}: {
  card: Character;
  onSelect: (name: string, id?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = cocOccupationProfile(card);
  return (
    <div className="field">
      <span>
        调查员职业 <span className="required">*</span>
      </span>
      <button
        type="button"
        className="occupation-picker-trigger"
        aria-label="选择调查员职业"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <BookOpen size={18} aria-hidden="true" />
        <span>{card.occupation || '请选择职业'}</span>
        <ChevronRight size={17} aria-hidden="true" />
      </button>
      <small>{current ? cocOccupationSource(current) : '229 项职业 · 可按来源或技能搜索'}</small>
      {open && (
        <Modal
          title="选择调查员职业"
          subtitle="OCCUPATIONS · COC 7"
          className="occupation-picker-modal"
          onClose={() => setOpen(false)}
        >
          <CocOccupationBrowser
            current={current}
            onSelect={(profile) => {
              onSelect(profile.name, profile.id);
              setOpen(false);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
