import { useMemo, useState } from 'react';
import { BookOpen, Check, Moon, Plus, Search, Sparkles, Trash2, WandSparkles } from 'lucide-react';
import type { Character } from '../../shared/types';
import { getDndEdition } from '../../shared/dnd-edition';
import {
  createDndMagicState,
  canChooseDndSpell,
  getDndMagicProfile,
  getDndMagicErrors,
  type DndMagicEdit,
  type DndMagicState,
  type DndSpellGrant,
} from '../../shared/dnd-magic';
import type { DndSpellReference } from '../../shared/dnd-reference';
import { loadMagicCatalog, useRuleCatalog } from '../rule-catalogs';
import { Spinner } from './ui';
import { effectiveCharacter } from '../../shared/adjustments';
import { abilityModifier, proficiencyBonus } from '../../shared/rules';

const spellName = (s: DndSpellReference) => s.nameZh || s.nameEn || s.id;
const recoveryLabel = {
  short: '短休恢复',
  long: '长休恢复',
  'short-one': '短休恢复 1 次',
  none: '手动恢复',
};
type Shelf = 'cantrips' | 'known' | 'spellbook' | 'prepared' | 'secrets' | 'arcanum';
const shelfNames: Record<Shelf, string> = {
  cantrips: '戏法',
  known: '已知法术',
  spellbook: '法术书',
  prepared: '已准备',
  secrets: '魔法奥秘',
  arcanum: '玄奥秘法',
};
export function CharacterMagic({
  card,
  onChange,
  onEdit,
  busy = false,
  active = false,
  isHost = false,
}: {
  card: Character;
  onChange?: (card: Character) => void;
  onEdit?: (edit: DndMagicEdit) => Promise<boolean>;
  busy?: boolean;
  active?: boolean;
  isHost?: boolean;
}) {
  const edition = getDndEdition(card.dndEdition),
    catalog = useRuleCatalog(edition, loadMagicCatalog);
  const [query, setQuery] = useState(''),
    [rank, setRank] = useState('all'),
    [shelf, setShelf] = useState<Shelf>('cantrips');
  const [selected, setSelected] = useState(''),
    [method, setMethod] = useState<'slot' | 'pact' | 'ritual' | 'grant' | 'cantrip' | 'arcanum'>(
      'slot',
    );
  const [slotLevel, setSlotLevel] = useState(1),
    [grantId, setGrantId] = useState('');
  const [rest, setRest] = useState<'short' | 'long'>('short'),
    [hitDice, setHitDice] = useState(0),
    [confirmed, setConfirmed] = useState(false);
  const [arcaneRecovery, setArcaneRecovery] = useState(''),
    [sorcerous, setSorcerous] = useState(false);
  const [restPrepared, setRestPrepared] = useState<string[] | null>(null),
    [resourceAmounts, setResourceAmounts] = useState<Record<string, number>>({});
  const [resourceName, setResourceName] = useState(''),
    [resourceMax, setResourceMax] = useState(1),
    [resourceRecovery, setResourceRecovery] = useState<'short' | 'long' | 'none' | 'short-one'>(
      'long',
    );
  const [grantSpell, setGrantSpell] = useState(''),
    [grantLabel, setGrantLabel] = useState(''),
    [grantSource, setGrantSource] = useState<DndSpellGrant['source']>('feat'),
    [grantMax, setGrantMax] = useState(1),
    [grantAbility, setGrantAbility] = useState<DndSpellGrant['ability']>('int'),
    [grantSlots, setGrantSlots] = useState(true),
    [grantRitual, setGrantRitual] = useState(false);
  const [grantFree, setGrantFree] = useState(true),
    [componentNote, setComponentNote] = useState('');
  const [grantRecovery, setGrantRecovery] = useState<'short' | 'long' | 'short-one' | 'none'>(
    'long',
  );
  const [grantAttack, setGrantAttack] = useState(''),
    [grantDc, setGrantDc] = useState('');
  const [restoreId, setRestoreId] = useState(''),
    [restoreAmount, setRestoreAmount] = useState(1),
    [restoreReason, setRestoreReason] = useState('');
  const [scribing, setScribing] = useState(''),
    [scribeConfirmed, setScribeConfirmed] = useState(false);
  const state = card.dndMagic,
    profile = getDndMagicProfile(card);
  const lookup = useMemo(
    () => new Map((catalog.data?.spells ?? []).map((s) => [s.id, s])),
    [catalog.data],
  );
  if (!profile) return null;
  const patch = (next: DndMagicState) =>
    onChange?.({ ...card, dndMagic: next, updatedAt: new Date().toISOString() });
  if (!state)
    return (
      <section className="prep-empty">
        <span className="prep-orbit">
          <WandSparkles size={30} />
        </span>
        <span className="mini-label">SPELLS & RESOURCES</span>
        <h3>让每一次施法，都有据可查。</h3>
        <p>按 {edition} 版职业与等级建立法术位、生命骰和职业资源。原有笔记会继续保留。</p>
        {onChange ? (
          <button className="button primary" onClick={() => patch(createDndMagicState())}>
            <Plus size={16} />
            启用法术与资源管理
          </button>
        ) : (
          <p className="subtle-note">请在角色制卡的「法术与资源」页启用，并提交主持人审核。</p>
        )}
      </section>
    );
  const errors = catalog.data ? getDndMagicErrors(card, (id) => lookup.get(id)) : [];
  const shelves = (
    [
      ['cantrips', profile.cantripLimit],
      ['known', profile.knownLimit],
      ['spellbook', profile.mode === 'spellbook' ? 500 : 0],
      ['prepared', profile.preparedLimit],
      ['secrets', profile.secretLimit],
      ['arcanum', profile.arcanumLevels.length],
    ] as [Shelf, number][]
  ).filter(([, n]) => n > 0);
  const currentShelf = shelves.some(([s]) => s === shelf) ? shelf : (shelves[0]?.[0] ?? 'cantrips');
  const max = shelves.find(([s]) => s === currentShelf)?.[1] ?? 0;
  const listed = [
    ...new Set([
      ...state.cantrips,
      ...state.known,
      ...state.prepared,
      ...state.secrets,
      ...(profile.requiredCantrip ? [profile.requiredCantrip] : []),
      ...state.spellbook.filter((id) => lookup.get(id)?.ritual === true),
      ...state.arcanum,
      ...state.grants.map((g) => g.spellId),
      ...profile.automaticSpells.map((s) => s.spellId),
    ]),
  ];
  const current = lookup.get(selected);
  const pickedList = onChange
    ? (catalog.data?.spells ?? []).filter((s) => {
        return (
          canChooseDndSpell(profile, s, currentShelf) &&
          (currentShelf !== 'prepared' ||
            profile.mode !== 'spellbook' ||
            state.spellbook.includes(s.id))
        );
      })
    : listed.map((id) => lookup.get(id)).filter((s): s is DndSpellReference => !!s);
  const filtered = pickedList.filter(
    (s) =>
      (rank === 'all' || s.level === Number(rank)) &&
      `${s.nameZh} ${s.nameEn}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const toggle = (id: string) => {
    const list = state[currentShelf];
    patch({
      ...state,
      [currentShelf]: list.includes(id) ? list.filter((v) => v !== id) : [...list, id],
      ...(currentShelf === 'spellbook' && list.includes(id)
        ? { prepared: state.prepared.filter((v) => v !== id) }
        : {}),
    });
  };
  const changeSelected = (s: DndSpellReference) => {
    setSelected(s.id);
    setSlotLevel(Math.max(1, s.level ?? 1));
    const native =
      state.cantrips.includes(s.id) ||
      state.known.includes(s.id) ||
      state.secrets.includes(s.id) ||
      state.prepared.includes(s.id) ||
      state.arcanum.includes(s.id) ||
      profile.requiredCantrip === s.id ||
      profile.automaticSpells.some((entry) => entry.spellId === s.id) ||
      (s.ritual && state.spellbook.includes(s.id));
    const grant = native ? undefined : state.grants.find((g) => g.spellId === s.id);
    setGrantId(grant?.id ?? '');
    setMethod(
      grant
        ? grant.free
          ? 'grant'
          : grant.allowRitual && s.ritual
            ? 'ritual'
            : profile.pact
              ? 'pact'
              : 'slot'
        : s.level === 0
          ? 'cantrip'
          : s.ritual && profile.ritualMode === 'spellbook' && !state.prepared.includes(s.id)
            ? 'ritual'
            : state.arcanum.includes(s.id)
              ? 'arcanum'
              : profile.pact
                ? 'pact'
                : profile.slots.some((n) => n)
                  ? 'slot'
                  : 'grant',
    );
  };
  const cast = async () => {
    if (!current || !onEdit) return;
    await onEdit({
      kind: 'cast',
      spellId: current.id,
      method,
      ...(method === 'slot' ? { slotLevel } : {}),
      ...(grantId && method !== 'cantrip' && method !== 'arcanum' ? { grantId } : {}),
      ...(componentNote.trim() ? { componentNote: componentNote.trim() } : {}),
    });
  };
  const resources = [
    ...profile.resources.map((r) => ({ ...r, used: state.presetSpent[r.id] ?? 0 })),
    ...state.customResources,
  ];
  const selectedGrant = state.grants.find(
    (grant) => grant.id === grantId && grant.spellId === current?.id,
  );
  const sourceBonus = selectedGrant?.ability
    ? abilityModifier(effectiveCharacter(card).attributes[selectedGrant.ability]) +
      proficiencyBonus(card.level)
    : profile.attackBonus;
  const sourceAttack = selectedGrant?.attackBonus ?? sourceBonus;
  const sourceDc = selectedGrant?.saveDc ?? (sourceBonus === null ? null : sourceBonus + 8);
  const restores = [
    ...state.slotsUsed.map((used, i) => ({ id: `slot:${i + 1}`, name: `${i + 1} 环法术位`, used })),
    { id: 'pact', name: '契约法术位', used: state.pactUsed },
    { id: 'hit-dice', name: '生命骰', used: state.hitDiceUsed },
    ...profile.resources
      .filter((r) => r.max !== null)
      .map((r) => ({ id: r.id, name: r.name, used: state.presetSpent[r.id] ?? 0 })),
    ...state.customResources.map((r) => ({ id: `custom:${r.id}`, name: r.name, used: r.used })),
    ...state.grants
      .filter((g) => g.free?.max !== null)
      .map((g) => ({ id: `grant:${g.id}`, name: g.label, used: g.free?.used ?? 0 })),
  ].filter((r) => r.used > 0);
  const restore = restores.find((r) => r.id === restoreId) ?? restores[0];
  return (
    <div className="character-magic prep-stack">
      <div className="prep-section-heading">
        <div>
          <span className="mini-label">SPELLS & RESOURCES · {edition}</span>
          <h3>法术与资源</h3>
          <p>
            {card.occupation || '请先选择职业'} · {card.level} 级 ·{' '}
            {profile.mode === 'known'
              ? '已知施法'
              : profile.mode === 'spellbook'
                ? '法术书与准备'
                : profile.mode === 'prepared'
                  ? '准备施法'
                  : '职业资源'}
          </p>
        </div>
        {onChange && (
          <button
            className="text-button"
            onClick={() => onChange({ ...card, dndMagic: undefined })}
          >
            停用管理
          </button>
        )}
      </div>
      <div className="prep-metrics">
        <div>
          <span>法术攻击</span>
          <strong>
            {profile.attackBonus === null
              ? '—'
              : `${profile.attackBonus >= 0 ? '+' : ''}${profile.attackBonus}`}
          </strong>
        </div>
        <div>
          <span>豁免 DC</span>
          <strong>{profile.saveDc ?? '—'}</strong>
        </div>
        <div>
          <span>可用生命骰</span>
          <strong>
            {card.level - state.hitDiceUsed}
            <small>
              {' '}
              / {card.level}d{profile.hitDie ?? '?'}
            </small>
          </strong>
        </div>
      </div>
      <div className="spell-slot-grid" aria-label="法术位余额">
        {profile.slots.map(
          (n, i) =>
            n > 0 && (
              <div className="spell-slot" key={i}>
                <span>{i + 1} 环</span>
                <strong>
                  {n - state.slotsUsed[i]}
                  <small> / {n}</small>
                </strong>
                <div className="slot-dots">
                  {Array.from({ length: n }, (_, j) => (
                    <i key={j} className={j < n - state.slotsUsed[i] ? 'available' : ''} />
                  ))}
                </div>
              </div>
            ),
        )}
        {profile.pact && (
          <div className="spell-slot pact">
            <span>契约 · {profile.pact.level} 环</span>
            <strong>
              {profile.pact.max - state.pactUsed}
              <small> / {profile.pact.max}</small>
            </strong>
            <small>短休恢复</small>
          </div>
        )}
      </div>
      {state.concentration && (
        <div className="prep-concentration">
          <Sparkles size={17} />
          <div>
            <b>正在专注</b>
            <span>{state.concentration}</span>
          </div>
          {onEdit && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void onEdit({ kind: 'end-concentration' })}
            >
              结束专注
            </button>
          )}
        </div>
      )}
      {catalog.error ? (
        <div className="inline-error">
          {catalog.error}
          <button className="text-button" onClick={catalog.reload}>
            重新读取
          </button>
        </div>
      ) : !catalog.data ? (
        <div className="prep-loading">
          <Spinner />
          正在读取本版规则…
        </div>
      ) : (
        <>
          {onChange && ['战士', '游荡者'].includes(card.occupation) && (
            <label className="field">
              施法子职
              <select
                aria-label="施法子职"
                value={state.subclass ?? ''}
                onChange={(e) =>
                  patch({
                    ...state,
                    subclass: (e.target.value || undefined) as DndMagicState['subclass'],
                  })
                }
              >
                <option value="">不启用子职施法</option>
                <option value={card.occupation === '战士' ? 'eldritch-knight' : 'arcane-trickster'}>
                  {card.occupation === '战士' ? '奥法骑士' : '诡术师'}
                </option>
              </select>
            </label>
          )}
          {(shelves.length > 0 || listed.length > 0) && (
            <section className="prep-spell-library">
              {onChange && (
                <div className="prep-chip-tabs" aria-label="角色法术分类">
                  {shelves.map(([key, limit]) => (
                    <button
                      className={currentShelf === key ? 'selected' : ''}
                      key={key}
                      onClick={() => setShelf(key)}
                    >
                      {shelfNames[key]}
                      <span>
                        {state[key].length}
                        {key === 'spellbook' ? '' : `/${limit}`}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div className="prep-search">
                <label>
                  <Search size={16} />
                  <input
                    aria-label="搜索角色法术"
                    placeholder="搜索法术名称…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <select
                  aria-label="法术环阶筛选"
                  value={rank}
                  onChange={(e) => setRank(e.target.value)}
                >
                  <option value="all">全部环阶</option>
                  {Array.from({ length: 10 }, (_, i) => (
                    <option key={i} value={i}>
                      {i === 0 ? '戏法' : `${i} 环`}
                    </option>
                  ))}
                </select>
              </div>
              {onChange && (
                <p className="subtle-note">
                  {currentShelf === 'spellbook'
                    ? '先抄入法术书，再到「已准备」选择今日法术。抄录时间与材料费用由主持人确认。'
                    : `当前 ${state[currentShelf].length} / ${max}；职业、环阶与学派限制会在保存和施法时校验。`}
                </p>
              )}
              <div className="prep-spell-columns">
                <div className="prep-spell-list" aria-label="角色法术列表">
                  {filtered.slice(0, 80).map((s) => (
                    <button
                      key={s.id}
                      className={`prep-spell-row ${selected === s.id ? 'selected' : ''}`}
                      onClick={() => (onChange ? toggle(s.id) : changeSelected(s))}
                    >
                      <span className="spell-rank">{s.level === 0 ? '◇' : s.level}</span>
                      <span>
                        <b>{spellName(s)}</b>
                        <small>
                          {s.school} {s.ritual ? '· 仪式' : ''} {s.concentration ? '· 专注' : ''}
                        </small>
                      </span>
                      {onChange ? (
                        <span
                          className={`prep-tick ${state[currentShelf].includes(s.id) ? 'checked' : ''}`}
                        >
                          {state[currentShelf].includes(s.id) && <Check size={14} />}
                        </span>
                      ) : (
                        <BookOpen size={15} />
                      )}
                    </button>
                  ))}
                  {!filtered.length && (
                    <p className="prep-list-empty">
                      这里还没有法术。
                      {onChange ? '尝试切换分类或搜索词。' : '请在制卡时选择并准备法术。'}
                    </p>
                  )}
                  {filtered.length > 80 && (
                    <p className="subtle-note">共 {filtered.length} 项，请搜索或按环阶缩小范围。</p>
                  )}
                </div>
                {!onChange && current && (
                  <div className="prep-spell-detail">
                    <span className="mini-label">
                      {current.level === 0 ? 'CANTRIP' : `LEVEL ${current.level}`}
                    </span>
                    <h4>{spellName(current)}</h4>
                    <p>
                      {current.castingTime} · {current.range}
                    </p>
                    <p className="subtle-note">
                      成分：{current.components ?? '未知'}
                      <br />
                      持续：{current.duration ?? '未知'}
                    </p>
                    <details>
                      <summary>阅读法术原文</summary>
                      <div className="prep-rule-text">{current.rawText}</div>
                    </details>
                    {onEdit && (
                      <div className="prep-stack compact-stack">
                        <label className="field">
                          施法方式
                          <select
                            aria-label="施法方式"
                            value={method}
                            onChange={(e) => setMethod(e.target.value as typeof method)}
                          >
                            <option value="cantrip">戏法</option>
                            <option value="slot">普通法术位</option>
                            {profile.pact && <option value="pact">契约法术位</option>}
                            <option value="ritual">仪式（不消耗法术位）</option>
                            <option value="grant">特性免费施法</option>
                            <option value="arcanum">玄奥秘法</option>
                          </select>
                        </label>
                        {method === 'slot' && (
                          <label className="field">
                            消耗法术位
                            <select
                              aria-label="消耗法术位环阶"
                              value={slotLevel}
                              onChange={(e) => setSlotLevel(Number(e.target.value))}
                            >
                              {profile.slots.map(
                                (n, i) =>
                                  n > 0 && (
                                    <option key={i} value={i + 1}>
                                      {i + 1} 环 · 剩余 {n - state.slotsUsed[i]}
                                    </option>
                                  ),
                              )}
                            </select>
                          </label>
                        )}
                        {state.grants.some((g) => g.spellId === current.id) && (
                          <label className="field">
                            施法来源
                            <select
                              aria-label="施法来源"
                              value={grantId}
                              onChange={(e) => setGrantId(e.target.value)}
                            >
                              <option value="">职业施法 / 自动特性</option>
                              {state.grants
                                .filter((g) => g.spellId === current.id)
                                .map((g) => (
                                  <option value={g.id} key={g.id}>
                                    {g.label} ·{' '}
                                    {g.free?.max === null
                                      ? '随意'
                                      : g.free
                                        ? `剩余 ${g.free.max - g.free.used}`
                                        : '法术位'}
                                  </option>
                                ))}
                            </select>
                          </label>
                        )}
                        <p className="subtle-note">
                          本来源法术攻击{' '}
                          {sourceAttack === null
                            ? '—'
                            : `${sourceAttack >= 0 ? '+' : ''}${sourceAttack}`}{' '}
                          · 豁免 DC {sourceDc ?? '—'}
                        </p>
                        <label className="field">
                          本次材料与费用记录（可选）
                          <input
                            maxLength={200}
                            value={componentNote}
                            onChange={(e) => setComponentNote(e.target.value)}
                            placeholder="例如：已消耗 100 gp 的珍珠"
                          />
                        </label>
                        <button
                          className="button primary"
                          disabled={busy || !active}
                          onClick={() => void cast()}
                        >
                          <WandSparkles size={16} />
                          施放并记账
                        </button>
                        <small>记录施法、消耗和专注。法术伤害、治疗及特殊效果由主持人结算。</small>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}
          {errors.length > 0 && (
            <details className="prep-validation" open>
              <summary>需要核对 {errors.length} 项</summary>
              <ul>
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      <section>
        <div className="prep-section-heading">
          <div>
            <h4>职业与自定义资源</h4>
            <p>次数与法术位分别记录；消耗不会直接触发特性的其他效果。</p>
          </div>
        </div>
        <div className="prep-resource-grid">
          {resources.map((r) => (
            <div className="prep-resource" key={r.id}>
              <div>
                <b>{r.name}</b>
                <span>{recoveryLabel[r.recovery]}</span>
              </div>
              <strong>
                {r.max === null ? '∞' : r.max - r.used}
                <small>{r.max === null ? '' : ` / ${r.max}`}</small>
              </strong>
              {onEdit && (
                <div className="prep-spend">
                  <input
                    type="number"
                    aria-label={`${r.name}消耗数量`}
                    min={1}
                    max={r.max ?? 999}
                    value={resourceAmounts[r.id] ?? 1}
                    onChange={(e) =>
                      setResourceAmounts({ ...resourceAmounts, [r.id]: Number(e.target.value) })
                    }
                  />
                  <button
                    className="button secondary compact"
                    disabled={busy || !active}
                    onClick={() =>
                      void onEdit({
                        kind: 'spend',
                        resourceId: r.id,
                        amount: resourceAmounts[r.id] ?? 1,
                      })
                    }
                  >
                    消耗
                  </button>
                </div>
              )}
              {onChange && state.customResources.some((x) => x.id === r.id) && (
                <button
                  className="text-button"
                  onClick={() =>
                    patch({
                      ...state,
                      customResources: state.customResources.filter((x) => x.id !== r.id),
                    })
                  }
                >
                  移除
                </button>
              )}
            </div>
          ))}
          {!resources.length && (
            <p className="subtle-note">这个等级暂无内置次数资源，可添加子职或专长授予的资源。</p>
          )}
        </div>
      </section>
      {onChange && (
        <details className="prep-details">
          <summary>
            <Plus size={16} />
            额外授予与自定义资源
          </summary>
          <div className="prep-stack">
            <p className="subtle-note">
              种族、专长、物品或主持人授予须注明来源。它们与职业法术名额分开审核。
            </p>
            <div className="prep-form-grid">
              <label className="field">
                资源名称
                <input
                  value={resourceName}
                  maxLength={80}
                  onChange={(e) => setResourceName(e.target.value)}
                  placeholder="例如：幸运点"
                />
              </label>
              <label className="field">
                次数上限
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={resourceMax}
                  onChange={(e) => setResourceMax(Number(e.target.value))}
                />
              </label>
              <label className="field">
                恢复方式
                <select
                  value={resourceRecovery}
                  onChange={(e) => setResourceRecovery(e.target.value as typeof resourceRecovery)}
                >
                  {Object.entries(recoveryLabel).map(([v, label]) => (
                    <option value={v} key={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button secondary"
                disabled={
                  !resourceName.trim() || resourceMax < 1 || state.customResources.length >= 30
                }
                onClick={() => {
                  patch({
                    ...state,
                    customResources: [
                      ...state.customResources,
                      {
                        id: crypto.randomUUID(),
                        name: resourceName.trim(),
                        max: resourceMax,
                        used: 0,
                        recovery: resourceRecovery,
                      },
                    ],
                  });
                  setResourceName('');
                }}
              >
                添加资源
              </button>
            </div>
            <div className="section-divider" />
            <div className="prep-form-grid">
              <label className="field">
                额外授予的法术
                <select
                  aria-label="额外法术"
                  value={grantSpell}
                  onChange={(e) => setGrantSpell(e.target.value)}
                >
                  <option value="">选择法术</option>
                  {catalog.data?.spells.map((s) => (
                    <option key={s.id} value={s.id}>
                      {spellName(s)} · {s.level === 0 ? '戏法' : `${s.level}环`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                来源说明
                <input
                  placeholder="例如：魔法学徒（法师）"
                  value={grantLabel}
                  maxLength={100}
                  onChange={(e) => setGrantLabel(e.target.value)}
                />
              </label>
              <label className="field">
                来源类型
                <select
                  value={grantSource}
                  onChange={(e) => setGrantSource(e.target.value as typeof grantSource)}
                >
                  <option value="feat">专长</option>
                  <option value="species">种族</option>
                  <option value="class">职业/子职</option>
                  <option value="item">物品</option>
                  <option value="dm">主持人</option>
                </select>
              </label>
              <label className="field">
                施法属性
                <select
                  value={grantAbility}
                  onChange={(e) => setGrantAbility(e.target.value as typeof grantAbility)}
                >
                  {[
                    ['int', '智力'],
                    ['wis', '感知'],
                    ['cha', '魅力'],
                  ].map(([v, l]) => (
                    <option value={v} key={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                免费施展次数（0 为随意）
                <input
                  type="number"
                  min={0}
                  max={999}
                  value={grantMax}
                  onChange={(e) => setGrantMax(Number(e.target.value))}
                />
              </label>
              <label className="field">
                免费次数恢复方式
                <select
                  value={grantRecovery}
                  onChange={(event) => setGrantRecovery(event.target.value as typeof grantRecovery)}
                >
                  {Object.entries(recoveryLabel).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                固定法术攻击（可选）
                <input
                  type="number"
                  min={-100}
                  max={100}
                  value={grantAttack}
                  placeholder="留空按施法属性"
                  onChange={(event) => setGrantAttack(event.target.value)}
                />
              </label>
              <label className="field">
                固定豁免 DC（可选）
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={grantDc}
                  placeholder="留空按施法属性"
                  onChange={(event) => setGrantDc(event.target.value)}
                />
              </label>
              <div className="prep-checks">
                <label>
                  <input
                    type="checkbox"
                    checked={grantFree}
                    onChange={(e) => setGrantFree(e.target.checked)}
                  />
                  授予不耗位施展
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={grantSlots}
                    onChange={(e) => setGrantSlots(e.target.checked)}
                  />
                  也可消耗法术位
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={grantRitual}
                    onChange={(e) => setGrantRitual(e.target.checked)}
                  />
                  授予仪式施法
                </label>
              </div>
            </div>
            <button
              className="button secondary compact"
              disabled={
                !grantSpell ||
                !grantLabel.trim() ||
                (!grantFree && !grantSlots && !grantRitual) ||
                state.grants.length >= 50
              }
              onClick={() => {
                patch({
                  ...state,
                  grants: [
                    ...state.grants,
                    {
                      id: crypto.randomUUID(),
                      spellId: grantSpell,
                      label: grantLabel.trim(),
                      source: grantSource,
                      ability: grantAbility,
                      ...(grantAttack !== '' ? { attackBonus: Number(grantAttack) } : {}),
                      ...(grantDc !== '' ? { saveDc: Number(grantDc) } : {}),
                      allowSlots: grantSlots,
                      allowRitual: grantRitual,
                      ...(grantFree
                        ? { free: { max: grantMax || null, used: 0, recovery: grantRecovery } }
                        : {}),
                    },
                  ],
                });
                setGrantSpell('');
                setGrantLabel('');
                setGrantAttack('');
                setGrantDc('');
              }}
            >
              加入额外授予
            </button>
            {state.grants.map((g) => (
              <div className="prep-inline-row" key={g.id}>
                <span>
                  {lookup.get(g.spellId) ? spellName(lookup.get(g.spellId)!) : g.spellId}
                  <small>{g.label}</small>
                </span>
                <button
                  className="icon-button"
                  aria-label={`移除${g.label}`}
                  onClick={() =>
                    patch({ ...state, grants: state.grants.filter((x) => x.id !== g.id) })
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
      {onEdit && isHost && (
        <details className="prep-details">
          <summary>主持人手动恢复</summary>
          <div className="prep-stack">
            <p className="subtle-note">
              用于规则特例、物品效果或纠正记录。只恢复已消耗的数量，不改变额度；原因写入主持人记录。
            </p>
            <div className="prep-form-grid">
              <label className="field">
                恢复项目
                <select
                  aria-label="手动恢复项目"
                  value={restore?.id ?? ''}
                  onChange={(event) => setRestoreId(event.target.value)}
                >
                  {!restores.length && <option value="">暂无已消耗资源</option>}
                  {restores.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} · 已用 {r.used}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                恢复数量
                <input
                  aria-label="手动恢复数量"
                  type="number"
                  min={1}
                  max={restore?.used ?? 1}
                  value={restoreAmount}
                  onChange={(event) => setRestoreAmount(Number(event.target.value))}
                />
              </label>
            </div>
            <label className="field">
              恢复依据
              <input
                aria-label="手动恢复依据"
                maxLength={200}
                value={restoreReason}
                onChange={(event) => setRestoreReason(event.target.value)}
                placeholder="特性、物品或本桌裁定"
              />
            </label>
            <button
              className="button secondary compact"
              disabled={!restore || !restoreReason.trim() || busy || !active}
              onClick={async () => {
                if (
                  restore &&
                  (await onEdit({
                    kind: 'restore',
                    resourceId: restore.id,
                    amount: restoreAmount,
                    reason: restoreReason.trim(),
                  }))
                )
                  setRestoreReason('');
              }}
            >
              确认恢复
            </button>
          </div>
        </details>
      )}
      {onEdit && (
        <details className="prep-details">
          <summary>
            <Moon size={17} />
            休息与恢复
          </summary>
          <div className="prep-stack">
            <div className="segmented">
              <button
                className={rest === 'short' ? 'selected' : ''}
                onClick={() => {
                  setRest('short');
                  setConfirmed(false);
                  setRestPrepared(null);
                }}
              >
                短休
              </button>
              <button
                className={rest === 'long' ? 'selected' : ''}
                onClick={() => {
                  setRest('long');
                  setConfirmed(false);
                  setRestPrepared(null);
                }}
              >
                长休
              </button>
            </div>
            <p className="subtle-note">
              {rest === 'short'
                ? '短休按规则消耗生命骰并恢复对应资源。'
                : '长休恢复生命值与法术位。'}
              {edition === '2014'
                ? ' 2014：长休恢复至多一半生命骰，至少 1 枚。'
                : ' 2024：长休恢复所有生命骰。'}
              由本桌确认所需休息时间与条件已满足；睡眠、失能或持续时间到期时，请另行结束专注。
            </p>
            {rest === 'short' && (
              <label className="field">
                消耗生命骰（当前 {card.level - state.hitDiceUsed}）
                <input
                  aria-label="短休生命骰"
                  type="number"
                  min={0}
                  max={card.level - state.hitDiceUsed}
                  value={hitDice}
                  onChange={(e) => setHitDice(Number(e.target.value))}
                />
              </label>
            )}
            {rest === 'short' && profile.resources.some((r) => r.id === 'arcane-recovery') && (
              <label className="field">
                奥术回想恢复的环阶（可选）
                <input
                  placeholder="例如 1,1 或 2"
                  value={arcaneRecovery}
                  onChange={(e) => setArcaneRecovery(e.target.value)}
                />
              </label>
            )}
            {rest === 'short' &&
              profile.resources.some((r) => r.id === 'sorcerous-restoration') && (
                <label className="prep-checkbox">
                  <input
                    type="checkbox"
                    checked={sorcerous}
                    onChange={(e) => setSorcerous(e.target.checked)}
                  />
                  本次使用术法复苏
                </label>
              )}
            {(rest === 'long' ? profile.longPreparation : profile.shortPreparation) !== 'none' &&
              profile.preparedLimit > 0 && (
                <details>
                  <summary>休息后更换准备法术</summary>
                  <div className="prep-rest-prepared">
                    {(catalog.data?.spells ?? [])
                      .filter(
                        (s) =>
                          canChooseDndSpell(profile, s, 'prepared') &&
                          (profile.mode !== 'spellbook' || state.spellbook.includes(s.id)),
                      )
                      .map((s) => (
                        <label className="prep-checkbox" key={s.id}>
                          <input
                            type="checkbox"
                            checked={(restPrepared ?? state.prepared).includes(s.id)}
                            onChange={(e) =>
                              setRestPrepared(
                                e.target.checked
                                  ? [...(restPrepared ?? state.prepared), s.id]
                                  : (restPrepared ?? state.prepared).filter((v) => v !== s.id),
                              )
                            }
                          />
                          {spellName(s)}
                        </label>
                      ))}
                  </div>
                </details>
              )}
            <label className="prep-checkbox">
              <input
                type="checkbox"
                aria-label="确认休息条件"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              本桌已确认休息条件与时长满足
            </label>
            <button
              className="button primary compact"
              disabled={!confirmed || busy || !active}
              onClick={async () => {
                const ok = await onEdit({
                  kind: 'rest',
                  rest,
                  confirmed: true,
                  ...(rest === 'short'
                    ? {
                        hitDice,
                        ...(arcaneRecovery.trim()
                          ? { arcaneRecovery: arcaneRecovery.split(/[,，]/).map(Number) }
                          : {}),
                        ...(sorcerous ? { sorcerousRestoration: true } : {}),
                      }
                    : {}),
                  ...(restPrepared ? { prepared: restPrepared } : {}),
                });
                if (ok) {
                  setConfirmed(false);
                  setHitDice(0);
                  setRestPrepared(null);
                  setArcaneRecovery('');
                  setSorcerous(false);
                }
              }}
            >
              完成{rest === 'short' ? '短休' : '长休'}并恢复
            </button>
          </div>
        </details>
      )}
      {onEdit &&
        profile.resources.some((r) => r.id === 'magical-cunning' || r.id === 'eldritch-master') && (
          <details className="prep-details">
            <summary>契约法术位特性恢复</summary>
            <p>完成该特性规定的 1 分钟仪式后，按版次恢复法术位并记录次数。</p>
            <button
              className="button secondary compact"
              disabled={busy || !active}
              onClick={() => void onEdit({ kind: 'recover-pact', confirmed: true })}
            >
              已完成仪式，恢复契约法术位
            </button>
          </details>
        )}
      {onEdit && isHost && profile.mode === 'spellbook' && (
        <details className="prep-details">
          <summary>向法术书抄录法术</summary>
          <div className="prep-stack">
            <label className="field">
              法术
              <select
                aria-label="抄录法术"
                value={scribing}
                onChange={(e) => setScribing(e.target.value)}
              >
                <option value="">选择法师法术</option>
                {catalog.data?.spells
                  .filter(
                    (s) =>
                      canChooseDndSpell(profile, s, 'spellbook') && !state.spellbook.includes(s.id),
                  )
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {spellName(s)} · {s.level}环
                    </option>
                  ))}
              </select>
            </label>
            <label className="prep-checkbox">
              <input
                type="checkbox"
                checked={scribeConfirmed}
                onChange={(e) => setScribeConfirmed(e.target.checked)}
              />
              主持人已确认获得来源、时间与材料费用
            </label>
            <button
              className="button secondary compact"
              disabled={!scribing || !scribeConfirmed || busy || !active}
              onClick={async () => {
                if (await onEdit({ kind: 'scribe', spellId: scribing, confirmed: true })) {
                  setScribing('');
                  setScribeConfirmed(false);
                }
              }}
            >
              完成抄录
            </button>
          </div>
        </details>
      )}
    </div>
  );
}
