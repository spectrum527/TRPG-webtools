import { useState } from 'react';
import { Backpack, Check, Plus, Search, Shield, Swords, Trash2 } from 'lucide-react';
import type { Character, Item } from '../../shared/types';
import { getDndEdition, type DndEdition } from '../../shared/dnd-edition';
import { effectiveCharacter } from '../../shared/adjustments';
import {
  applyDndEquipmentEdit,
  createDndEquipmentState,
  effectiveDndAC,
  getDndEquipmentWarnings,
  getDndLoad,
  getDndWeaponAttack,
  itemFromEquipmentCatalog,
  type DndEquipmentEdit,
  type DndEquipmentState,
} from '../../shared/dnd-equipment';
import type { EquipmentCatalogItem } from '../../shared/equipment-catalog';
import { getEquipmentProficiencies } from '../../shared/equipment-proficiencies';
import { loadEquipmentCatalog, useRuleCatalog } from '../rule-catalogs';
import { Spinner } from './ui';
const kinds = { weapon: '武器', armor: '护甲', shield: '盾牌', adventuring: '冒险装备' };
export function EquipmentLibrary({
  edition,
  onAdd,
}: {
  edition: DndEdition;
  onAdd?: (item: EquipmentCatalogItem) => void;
}) {
  const { data, error, reload } = useRuleCatalog(edition, loadEquipmentCatalog);
  const [query, setQuery] = useState(''),
    [kind, setKind] = useState('all'),
    [selected, setSelected] = useState('');
  const items = (data?.items ?? []).filter(
    (i) =>
      (kind === 'all' || i.kind === kind) &&
      `${i.name} ${i.nameEn}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const current = items.find((i) => i.id === selected) ?? items[0];
  return (
    <section className="equipment-library prep-stack">
      <div className="prep-section-heading">
        <div>
          <span className="mini-label">EQUIPMENT · {edition}</span>
          <h3>装备目录</h3>
          <p>按本版规则查阅重量、价格、护甲公式与武器属性。</p>
        </div>
        <Backpack size={24} strokeWidth={1.3} />
      </div>
      {error ? (
        <div className="inline-error">
          {error}
          <button className="text-button" onClick={reload}>
            重新读取
          </button>
        </div>
      ) : !data ? (
        <Spinner />
      ) : (
        <>
          <div className="prep-search">
            <label>
              <Search size={16} />
              <input
                aria-label="搜索装备"
                placeholder="搜索装备…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select aria-label="装备类别" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="all">全部类别</option>
              {Object.entries(kinds).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="prep-spell-columns">
            <div className="prep-spell-list" aria-label="装备目录列表">
              {!items.length && <p className="prep-list-empty">暂无匹配的装备</p>}
              {items.map((i) => (
                <button
                  key={i.id}
                  className={`prep-spell-row ${i === current ? 'selected' : ''}`}
                  onClick={() => setSelected(i.id)}
                >
                  <span className="spell-rank">
                    {i.kind === 'weapon' ? (
                      <Swords size={17} />
                    ) : i.kind === 'armor' || i.kind === 'shield' ? (
                      <Shield size={17} />
                    ) : (
                      <Backpack size={17} />
                    )}
                  </span>
                  <span>
                    <b>{i.name}</b>
                    <small>
                      {kinds[i.kind]} · {i.costText ?? '价格待核对'}
                    </small>
                  </span>
                </button>
              ))}
            </div>
            {current && (
              <div className="prep-spell-detail">
                <span className="mini-label">
                  {kinds[current.kind]} · {edition}
                </span>
                <h4>{current.name}</h4>
                <p>{current.nameEn}</p>
                <div className="equipment-facts">
                  <span>
                    价格<b>{current.costText ?? '未知'}</b>
                  </span>
                  <span>
                    重量<b>{current.weightText ?? '未知'}</b>
                  </span>
                  {current.weapon && (
                    <>
                      <span>
                        伤害
                        <b>
                          {current.weapon.damageDice ?? '特殊效果'} {current.weapon.damageType}
                        </b>
                      </span>
                      <span>
                        属性<b>{current.weapon.propertyText ?? '请查阅来源'}</b>
                      </span>
                      {current.weapon.mastery && (
                        <span>
                          精通<b>{current.weapon.mastery}</b>
                        </span>
                      )}
                    </>
                  )}
                  {current.armor && (
                    <>
                      <span>
                        AC<b>{current.armor.armorClassText}</b>
                      </span>
                      <span>
                        力量要求<b>{current.armor.strengthText ?? '—'}</b>
                      </span>
                      <span>
                        隐匿<b>{current.armor.stealthText ?? '—'}</b>
                      </span>
                    </>
                  )}
                  {current.shield && (
                    <span>
                      AC 加值<b>+{current.shield.bonusAC ?? '?'}</b>
                    </span>
                  )}
                  {current.container && (
                    <span>
                      容量<b>{current.container.capacityText}</b>
                    </span>
                  )}
                </div>
                {current.description && (
                  <details>
                    <summary>用途与规则说明</summary>
                    <div className="prep-rule-text">{current.description}</div>
                  </details>
                )}
                {current.weapon?.masteryDescription && (
                  <details>
                    <summary>精通效果（需对应特性）</summary>
                    <p>{current.weapon.masteryDescription}</p>
                  </details>
                )}
                {onAdd && (
                  <button className="button primary compact" onClick={() => onAdd(current)}>
                    <Plus size={16} />
                    加入行囊{current.quantityPerPack ? `（${current.quantityPerPack} 件）` : ''}
                  </button>
                )}
                <small className="prep-source">
                  来源：{current.source.book} · {current.source.path}
                </small>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
export function CharacterEquipment({
  card,
  onChange,
  onEdit,
  busy = false,
  active = false,
  allowAdd = false,
}: {
  card: Character;
  onChange?: (card: Character) => void;
  onEdit?: (edit: DndEquipmentEdit) => Promise<boolean>;
  busy?: boolean;
  active?: boolean;
  allowAdd?: boolean;
}) {
  const [error, setError] = useState(''),
    [catalogOpen, setCatalogOpen] = useState(false),
    [attuning, setAttuning] = useState(''),
    [useAmount, setUseAmount] = useState<Record<string, number>>({});
  const edition = getDndEdition(card.dndEdition),
    effective = effectiveCharacter(card),
    state = card.dndEquipment;
  const act = async (edit: DndEquipmentEdit) => {
    setError('');
    try {
      if (onChange) {
        onChange(applyDndEquipmentEdit(card, edit));
        return true;
      }
      return (await onEdit?.(edit)) ?? false;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const patchState = (values: Partial<DndEquipmentState>) => {
    if (state)
      onChange?.({
        ...card,
        dndEquipment: { ...state, ...values },
        updatedAt: new Date().toISOString(),
      });
  };
  const patchItem = (item: Item) =>
    onChange?.({
      ...card,
      items: card.items.map((i) => (i.id === item.id ? item : i)),
      updatedAt: new Date().toISOString(),
    });
  if (!state)
    return (
      <section className="prep-empty">
        <span className="prep-orbit">
          <Shield size={30} />
        </span>
        <span className="mini-label">EQUIPMENT & LOADOUT</span>
        <h3>带上装备，也带上它的规则。</h3>
        <p>启用后，穿戴决定 AC，武器关联攻击加值与伤害，数量计入负重。旧物品可以继续保留。</p>
        {onChange ? (
          <button
            className="button primary"
            onClick={() => void act({ kind: 'configure', state: createDndEquipmentState() })}
          >
            <Plus size={16} />
            启用装备联动
          </button>
        ) : (
          <p className="subtle-note">请在制卡的「装备与负重」页启用，并提交主持人审核。</p>
        )}
      </section>
    );
  const load = getDndLoad(effective),
    warnings = getDndEquipmentWarnings(effective),
    proficiency = getEquipmentProficiencies(edition, card.occupation);
  return (
    <div className="character-equipment prep-stack">
      <div className="prep-section-heading">
        <div>
          <span className="mini-label">EQUIPMENT & LOADOUT · {edition}</span>
          <h3>装备与负重</h3>
          <p>每一件物品，只在同一个行囊里记账。</p>
        </div>
        {onChange && (
          <button className="text-button" onClick={() => void act({ kind: 'disable' })}>
            停用联动
          </button>
        )}
      </div>
      <div className="prep-metrics">
        <div>
          <span>当前 AC</span>
          <strong>{effectiveDndAC(effective)}</strong>
        </div>
        <div>
          <span>负重 / 容量 · 磅</span>
          <strong>
            {load.weight}
            <small> / {load.capacity}</small>
          </strong>
        </div>
        <div>
          <span>速度 · 尺</span>
          <strong>{load.speed}</strong>
        </div>
      </div>
      <div className="equipment-load">
        <div
          style={{ width: `${Math.min(100, (load.weight / Math.max(1, load.capacity)) * 100)}%` }}
        />
        <span>
          {load.unknown ? '重量未完整，负重待核对' : load.burden} · 同调{' '}
          {card.items.filter((i) => i.equipment?.attuned).length}/{state.attunementLimit}
        </span>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {onChange && (
        <details className="prep-details">
          <summary>防御、训练与负重设置</summary>
          <div className="prep-stack">
            <div className="prep-form-grid">
              <label className="field">
                防御公式
                <select
                  aria-label="防御公式"
                  value={state.armorMode}
                  onChange={(e) =>
                    patchState({ armorMode: e.target.value as DndEquipmentState['armorMode'] })
                  }
                >
                  <option value="standard">护甲 / 10 + 敏捷</option>
                  {card.occupation === '野蛮人' && (
                    <option value="barbarian">野蛮人无甲防御</option>
                  )}
                  {card.occupation === '武僧' && <option value="monk">武僧无甲防御</option>}
                  <option value="manual">使用角色手填 AC</option>
                </select>
              </label>
              <label className="field">
                基础速度（尺）
                <input
                  type="number"
                  min={0}
                  max={200}
                  value={state.baseSpeed}
                  onChange={(e) => patchState({ baseSpeed: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                体型
                <select
                  value={state.size}
                  onChange={(e) =>
                    patchState({ size: e.target.value as DndEquipmentState['size'] })
                  }
                >
                  {[
                    ['tiny', '微型'],
                    ['small', '小型'],
                    ['medium', '中型'],
                    ['large', '大型'],
                    ['huge', '巨型'],
                    ['gargantuan', '超巨型'],
                  ].map(([v, l]) => (
                    <option value={v} key={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                负重规则
                <select
                  value={state.carrying}
                  onChange={(e) =>
                    patchState({ carrying: e.target.value as DndEquipmentState['carrying'] })
                  }
                >
                  <option value="standard">标准负重</option>
                  {edition === '2014' && <option value="variant">2014 变体负重</option>}
                </select>
              </label>
              <label className="field">
                额外 AC 加值
                <input
                  type="number"
                  min={-20}
                  max={20}
                  value={state.acBonus}
                  onChange={(e) => patchState({ acBonus: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                同调上限
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={state.attunementLimit}
                  onChange={(e) => patchState({ attunementLimit: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                额外负重倍率
                <input
                  type="number"
                  min={0.5}
                  max={8}
                  step={0.5}
                  value={state.capacityMultiplier}
                  onChange={(e) => patchState({ capacityMultiplier: Number(e.target.value) })}
                />
              </label>
            </div>
            <div className="prep-training">
              <b>基础职业训练</b>
              <p>
                {proficiency?.armorText ?? '未识别职业，请手动注明训练来源'}
                <br />
                {proficiency?.weaponText}
              </p>
              {proficiency?.restrictions.map((r) => (
                <small key={r}>{r}</small>
              ))}
            </div>
            <div className="prep-checks">
              {[
                ['armor:light', '轻甲'],
                ['armor:medium', '中甲'],
                ['armor:heavy', '重甲'],
                ['armor:shield', '盾牌'],
                ['weapon:simple', '简易武器'],
                ['weapon:martial', '军用武器'],
              ].map(([v, l]) => (
                <label key={v}>
                  <input
                    type="checkbox"
                    checked={state.extraProficiencies.includes(v)}
                    onChange={(e) =>
                      patchState({
                        extraProficiencies: e.target.checked
                          ? [...state.extraProficiencies, v]
                          : state.extraProficiencies.filter((x) => x !== v),
                      })
                    }
                  />
                  额外 {l}
                </label>
              ))}
            </div>
            <label className="field">
              额外训练、加值与特殊规则来源
              <textarea
                rows={2}
                maxLength={1000}
                value={state.sourceNotes}
                onChange={(e) => patchState({ sourceNotes: e.target.value })}
                placeholder="例如：卫士（德鲁伊初始选择），或主持人批准的魔法物品"
              />
            </label>
            <p className="subtle-note">
              穿甲优先采用护甲公式；无甲防御不叠加。移动、精通和情境规则仍由主持人确认。
            </p>
            <div className="prep-coins">
              {Object.entries(state.coins).map(([key, value]) => (
                <label className="field" key={key}>
                  {key.toUpperCase()}
                  <input
                    aria-label={`${key.toUpperCase()}钱币`}
                    type="number"
                    min={0}
                    max={1000000}
                    value={value}
                    onChange={(e) =>
                      patchState({ coins: { ...state.coins, [key]: Number(e.target.value) } })
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        </details>
      )}
      {warnings.length > 0 && (
        <details className="prep-details equipment-warnings">
          <summary>装备提醒 · {warnings.length}</summary>
          <ul>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="prep-section-heading">
        <h4>
          随身装备 <small>{card.items.length} 件</small>
        </h4>
        {(onChange || allowAdd) && (
          <button
            className="button secondary compact"
            disabled={busy || (!onChange && !active)}
            onClick={() => setCatalogOpen(!catalogOpen)}
          >
            <Plus size={15} />
            {catalogOpen ? '收起目录' : '从目录添加'}
          </button>
        )}
      </div>
      {catalogOpen && (onChange || allowAdd) && (
        <EquipmentLibrary
          edition={edition}
          onAdd={(entry) => {
            try {
              const item = itemFromEquipmentCatalog(entry);
              void act({ kind: 'add', item });
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      )}
      <div className="equipment-inventory">
        {card.items.map((item) => {
          const e = item.equipment;
          let attack = '';
          if (e?.weapon && e.equipped) {
            try {
              const a = getDndWeaponAttack(effective, item.id);
              attack = `攻击 ${a.modifier >= 0 ? '+' : ''}${a.modifier} · ${a.damage} ${a.damageType}${a.disadvantage ? ' · 劣势' : ''}`;
            } catch {
              /* Special items have no attack expression. */
            }
          }
          return (
            <article className={`equipment-card ${e?.equipped ? 'equipped' : ''}`} key={item.id}>
              <div className="equipment-card-heading">
                <span className="equipment-icon">
                  {e?.weapon ? (
                    <Swords size={20} />
                  ) : e?.armor || e?.shield ? (
                    <Shield size={20} />
                  ) : (
                    <Backpack size={20} />
                  )}
                </span>
                <div>
                  <h4>{item.name}</h4>
                  <small>
                    {e
                      ? `${kinds[e.kind]} · ${e.unitWeightLb === null ? '重量待核对' : `${e.unitWeightLb} 磅 / 件`}`
                      : '普通物品 · 未绑定规则'}
                    {e?.containerId
                      ? ` · 收纳于 ${card.items.find((i) => i.id === e.containerId)?.name ?? '未知容器'}`
                      : ''}
                  </small>
                </div>
                {onChange ? (
                  <input
                    className="equipment-quantity"
                    type="number"
                    aria-label={`${item.name}数量`}
                    min={0}
                    max={9999}
                    value={item.quantity}
                    onChange={(event) =>
                      patchItem({ ...item, quantity: Number(event.target.value) })
                    }
                  />
                ) : (
                  <strong>× {item.quantity}</strong>
                )}
              </div>
              {attack && <p className="equipment-attack">{attack}</p>}
              {item.notes && <p className="subtle-note">{item.notes}</p>}
              {e && (
                <>
                  <div className="equipment-controls">
                    {(e.kind !== 'adventuring' || e.requiresAttunement || e.acBonus !== 0) && (
                      <button
                        className={`button compact ${e.equipped ? 'primary' : 'secondary'}`}
                        disabled={busy || (!onChange && !active)}
                        onClick={() =>
                          void act({ kind: 'equip', itemId: item.id, equipped: !e.equipped })
                        }
                      >
                        {e.equipped ? <Check size={15} /> : <Shield size={15} />}{' '}
                        {e.equipped ? '已穿戴 · 收起' : '穿戴 / 持用'}
                      </button>
                    )}
                    {e.weapon && (e.weapon.versatileDice || e.weapon.mountedException) && (
                      <select
                        aria-label={`${item.name}持握`}
                        value={e.grip}
                        disabled={busy || (!onChange && !active)}
                        onChange={(event) =>
                          void act({
                            kind: 'equip',
                            itemId: item.id,
                            equipped: e.equipped,
                            grip: event.target.value as 'one' | 'two',
                          })
                        }
                      >
                        <option value="one">单手持握</option>
                        <option value="two">双手持握</option>
                      </select>
                    )}
                    {e.weapon?.mountedException && (
                      <label className="prep-checkbox">
                        <input
                          type="checkbox"
                          checked={e.mounted}
                          disabled={busy || (!onChange && !active)}
                          onChange={(event) =>
                            void act({
                              kind: 'equip',
                              itemId: item.id,
                              equipped: e.equipped,
                              mounted: event.target.checked,
                              grip: event.target.checked ? 'one' : 'two',
                            })
                          }
                        />
                        骑乘中
                      </label>
                    )}
                    {e.requiresAttunement && (
                      <button
                        className="button secondary compact"
                        disabled={busy || (!onChange && !active)}
                        onClick={() => setAttuning(item.id)}
                      >
                        {e.attuned ? '已同调 · 结束' : '进行同调'}
                      </button>
                    )}
                    {onChange && (
                      <button
                        className="icon-button"
                        aria-label={`删除${item.name}`}
                        onClick={() => void act({ kind: 'drop', itemId: item.id })}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                  {attuning === item.id && (
                    <div className="prep-inline-confirm">
                      <p>
                        {e.attuned
                          ? '确认已满足结束同调条件。'
                          : '完成所需短休并专注于此物品后，确认同调。此按钮只记录同调，不执行额外休息恢复。'}
                      </p>
                      <button
                        className="button secondary compact"
                        disabled={busy}
                        onClick={async () => {
                          if (
                            await act({
                              kind: 'attune',
                              itemId: item.id,
                              attuned: !e.attuned,
                              confirmed: true,
                            })
                          )
                            setAttuning('');
                        }}
                      >
                        确认{e.attuned ? '结束同调' : '完成同调'}
                      </button>
                      <button className="text-button" onClick={() => setAttuning('')}>
                        取消
                      </button>
                    </div>
                  )}
                  <details className="equipment-item-details">
                    <summary>收纳{onChange ? '、备注与特殊加值' : '与消耗'}</summary>
                    <div className="prep-stack">
                      <label className="field">
                        所在容器
                        <select
                          aria-label={`${item.name}容器`}
                          value={e.containerId ?? ''}
                          disabled={busy || (!onChange && !active)}
                          onChange={(event) =>
                            void act({
                              kind: 'move',
                              itemId: item.id,
                              containerId: event.target.value || null,
                            })
                          }
                        >
                          <option value="">随身携带</option>
                          {card.items
                            .filter(
                              (i) => i.id !== item.id && i.equipment?.container && i.quantity === 1,
                            )
                            .map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      {onEdit && (
                        <div className="prep-spend">
                          <input
                            aria-label={`${item.name}消耗数量`}
                            type="number"
                            min={1}
                            max={item.quantity}
                            value={useAmount[item.id] ?? 1}
                            onChange={(event) =>
                              setUseAmount({ ...useAmount, [item.id]: Number(event.target.value) })
                            }
                          />
                          <button
                            className="button secondary compact"
                            disabled={busy || !active}
                            onClick={() =>
                              void act({
                                kind: 'consume',
                                itemId: item.id,
                                amount: useAmount[item.id] ?? 1,
                              })
                            }
                          >
                            消耗物品
                          </button>
                        </div>
                      )}
                      {onChange && (
                        <>
                          <label className="field">
                            备注
                            <input
                              value={item.notes}
                              maxLength={1000}
                              onChange={(event) =>
                                patchItem({ ...item, notes: event.target.value })
                              }
                            />
                          </label>
                          <div className="prep-form-grid">
                            {(['attackBonus', 'damageBonus', 'acBonus'] as const).map(
                              (key, index) => (
                                <label className="field" key={key}>
                                  {['魔法攻击加值', '魔法伤害加值', '魔法 AC 加值'][index]}
                                  <input
                                    type="number"
                                    min={-10}
                                    max={10}
                                    value={e[key]}
                                    onChange={(event) =>
                                      patchItem({
                                        ...item,
                                        equipment: { ...e, [key]: Number(event.target.value) },
                                      })
                                    }
                                  />
                                </label>
                              ),
                            )}
                            <label className="field">
                              单件重量（磅）
                              <input
                                type="number"
                                min={0}
                                step={0.01}
                                value={e.unitWeightLb ?? ''}
                                onChange={(event) =>
                                  patchItem({
                                    ...item,
                                    equipment: {
                                      ...e,
                                      unitWeightLb:
                                        event.target.value === ''
                                          ? null
                                          : Number(event.target.value),
                                    },
                                  })
                                }
                              />
                            </label>
                            {e.weapon && (
                              <label className="field">
                                攻击属性
                                <select
                                  value={e.ability}
                                  onChange={(event) =>
                                    patchItem({
                                      ...item,
                                      equipment: {
                                        ...e,
                                        ability: event.target.value as typeof e.ability,
                                      },
                                    })
                                  }
                                >
                                  <option value="auto">依武器规则自动选择</option>
                                  {[
                                    ['str', '力量'],
                                    ['dex', '敏捷'],
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
                            )}
                          </div>
                          <label className="prep-checkbox">
                            <input
                              type="checkbox"
                              checked={e.requiresAttunement}
                              onChange={(event) =>
                                patchItem({
                                  ...item,
                                  equipment: {
                                    ...e,
                                    requiresAttunement: event.target.checked,
                                    attuned: event.target.checked ? e.attuned : false,
                                  },
                                })
                              }
                            />
                            这件物品需要同调
                          </label>
                          <label className="field">
                            特殊规则来源
                            <input
                              maxLength={400}
                              value={e.bonusSource}
                              placeholder="特性 / 魔法物品名称与出处"
                              onChange={(event) =>
                                patchItem({
                                  ...item,
                                  equipment: { ...e, bonusSource: event.target.value },
                                })
                              }
                            />
                          </label>
                        </>
                      )}
                    </div>
                  </details>
                </>
              )}
            </article>
          );
        })}
        {!card.items.length && (
          <div className="prep-list-empty">
            <Backpack size={25} />
            <p>行囊还是空的。从本版装备目录加入第一件物品。</p>
          </div>
        )}
      </div>
    </div>
  );
}
