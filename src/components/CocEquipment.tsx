import { useId, useState } from 'react';
import { LockKeyhole, LockKeyholeOpen, Plus, Trash2, RotateCcw, Shield } from 'lucide-react';
import {
  COC_WEAPON_CATALOG,
  COC_ARMOR_CATALOG,
  COC_ARMOR_KINDS,
  COC_ARMOR_LOCATIONS,
  COC_WEAPON_CATEGORIES,
  cocArmorCoverageLabel,
  cocUnresolvedArmor,
  cocWeaponValues,
  cocArmorValues,
  cocArmorValue,
  type CocWeaponProfile,
  type CocArmorProfile,
} from '../../shared/coc-equipment';
import { COC_SKILL_CATALOG, cocSkillDefinitions } from '../../shared/coc-career';
import {
  automaticControl,
  controlledValue,
  type ValueControl,
  type ValueControlEdit,
} from '../../shared/value-control';
import { readCocPreparationLibrary, saveCocPreparationLibrary } from '../coc-library-storage';
import { AutoValueField } from './AutoValueField';
import { CocEquipmentPicker } from './CocEquipmentCatalog';
import { sortCocSkills } from '../../shared/coc-skill-order';
import {
  CocSectionHeading,
  useCocInvestigatorEdit,
  type CocInvestigatorProps,
} from './CocInvestigator';

const dbModes = [
  { value: 'full', label: '全部 DB' },
  { value: 'half', label: '一半 DB' },
  { value: 'none', label: '无 DB' },
];
const libraryPrefix = 'library:';

function EquipmentChoice({
  label,
  automatic,
  control,
  options,
  disabled,
  onEdit,
}: {
  label: string;
  automatic: string;
  control?: ValueControl<string>;
  options: { value: string; label: string }[];
  disabled?: boolean;
  onEdit: (change: ValueControlEdit<string>) => Promise<boolean>;
}) {
  const id = useId();
  const state = control ?? automaticControl<string>();
  const value = controlledValue(state, automatic);
  return (
    <div className={`auto-value-field${state.locked ? ' is-locked' : ''}`}>
      <div className="auto-value-label">
        <label htmlFor={id}>{label}</label>
        <button
          type="button"
          className="value-lock"
          aria-label={`${state.locked ? '解锁' : '锁定'}${label}`}
          aria-pressed={state.locked}
          disabled={disabled}
          onClick={() => void onEdit({ kind: 'lock', locked: !state.locked })}
        >
          {state.locked ? <LockKeyhole size={16} /> : <LockKeyholeOpen size={16} />}
        </button>
      </div>
      <div className="auto-value-input">
        <select
          id={id}
          style={{ flex: 1, minWidth: 0, width: 'auto' }}
          value={value}
          disabled={disabled || state.locked || state.mode === 'auto'}
          onChange={(e) => void onEdit({ kind: 'value', value: e.target.value })}
        >
          {!options.some((option) => option.value === value) && (
            <option value={value}>
              {COC_SKILL_CATALOG.find(({ key }) => key === value)?.label ?? '未登记技能'}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          aria-label={`${label}计算方式`}
          value={state.mode}
          disabled={disabled || state.locked}
          onChange={(e) => void onEdit({ kind: 'mode', mode: e.target.value as 'auto' | 'manual' })}
        >
          <option value="auto">自动</option>
          <option value="manual">手动</option>
        </select>
      </div>
    </div>
  );
}

function EquipmentNotes({
  name,
  notes,
  disabled,
  onEdit,
}: {
  name: string;
  notes: string;
  disabled?: boolean;
  onEdit: (notes: string) => Promise<boolean>;
}) {
  return (
    <form
      className="coc-inline-fields"
      key={notes}
      onSubmit={(e) => {
        e.preventDefault();
        const value = String(new FormData(e.currentTarget).get('notes') ?? '').trim();
        if (value !== notes) void onEdit(value);
      }}
    >
      <label className="field">
        备注
        <textarea
          aria-label={`${name}备注`}
          name="notes"
          rows={2}
          maxLength={400}
          defaultValue={notes}
          disabled={disabled}
        />
      </label>
      <button type="submit" className="button secondary" disabled={disabled}>
        保存备注
      </button>
    </form>
  );
}

export function CocEquipment({
  card,
  onEdit,
  disabled,
  active = false,
  isHost = true,
}: CocInvestigatorProps) {
  const [selected, setSelected] = useState(COC_WEAPON_CATALOG[0].id);
  const [armor, setArmor] = useState(COC_ARMOR_CATALOG[0].id);
  const [custom, setCustom] = useState(false);
  const [library, setLibrary] = useState(readCocPreparationLibrary);
  const [libraryError, setLibraryError] = useState('');
  const [notice, setNotice] = useState('');
  const [weaponDraft, setWeaponDraft] = useState<CocWeaponProfile>({
    name: '',
    category: 'melee',
    skillKey: 'fightingBrawl',
    damage: '1d3',
    damageBonusMode: 'full',
    impales: false,
    range: 0,
    usesPerRound: 1,
    capacity: 0,
    malfunction: 0,
    era: 'any',
  });
  const [armorDraft, setArmorDraft] = useState<CocArmorProfile>({
    name: '',
    rating: 0,
    movPenalty: 0,
    coverage: 'body',
    era: 'any',
  });
  const { send, error, blocked } = useCocInvestigatorEdit(onEdit, disabled);
  const canDefine = !active || isHost;
  const definitionsBlocked = blocked || !canDefine;
  const equipment = card.cocInvestigator?.equipment;
  const skills = sortCocSkills(cocSkillDefinitions(card), card, 'invested').map(
    ({ key, label }) => ({ value: key, label }),
  );
  const headArmor = cocArmorValue(card, { location: 'head' });
  const refreshLibrary = () => {
    const refreshed = readCocPreparationLibrary();
    setLibrary(refreshed);
    if (
      selected.startsWith(libraryPrefix) &&
      !refreshed.weapons.some(({ id }) => `${libraryPrefix}${id}` === selected)
    )
      setSelected(COC_WEAPON_CATALOG[0].id);
    if (
      armor.startsWith(libraryPrefix) &&
      !refreshed.armor.some(({ id }) => `${libraryPrefix}${id}` === armor)
    )
      setArmor(COC_ARMOR_CATALOG[0].id);
  };
  const addFromCatalog = (kind: 'weapon-add' | 'armor-add') => {
    const option = kind === 'weapon-add' ? selected : armor;
    if (!option.startsWith(libraryPrefix)) {
      void send({ kind, entry: { catalogId: option } });
      return;
    }
    const id = option.slice(libraryPrefix.length);
    if (kind === 'weapon-add') {
      const record = library.weapons.find((entry) => entry.id === id);
      if (record) void send({ kind, entry: { profile: record.profile } });
    } else {
      const record = library.armor.find((entry) => entry.id === id);
      if (record) void send({ kind, entry: { profile: record.profile } });
    }
  };
  const saveToLibrary = (
    entry:
      { kind: 'weapon'; profile: CocWeaponProfile } | { kind: 'armor'; profile: CocArmorProfile },
  ) => {
    setNotice('');
    setLibraryError('');
    try {
      const current = readCocPreparationLibrary();
      const records = entry.kind === 'weapon' ? current.weapons : current.armor;
      if (
        records.some((record) => JSON.stringify(record.profile) === JSON.stringify(entry.profile))
      ) {
        setLibrary(current);
        setNotice(`「${entry.profile.name}」已在备团库中`);
        return;
      }
      const id = globalThis.crypto.randomUUID();
      const next =
        entry.kind === 'weapon'
          ? { ...current, weapons: [...current.weapons, { id, profile: entry.profile }] }
          : { ...current, armor: [...current.armor, { id, profile: entry.profile }] };
      setLibrary(saveCocPreparationLibrary(next));
      setNotice(`已将「${entry.profile.name}」保存到备团库`);
    } catch (e) {
      setLibraryError((e as Error).message);
    }
  };
  return (
    <div className="coc-section">
      <CocSectionHeading title="武器与防具" eyebrow="EQUIPMENT" />
      {canDefine && (
        <div className="coc-inline-fields">
          <CocEquipmentPicker
            kind="weapon"
            library={library}
            value={selected}
            onChange={setSelected}
            disabled={definitionsBlocked}
            onOpen={refreshLibrary}
          />
          <button
            type="button"
            className="button secondary"
            disabled={definitionsBlocked}
            onClick={() => addFromCatalog('weapon-add')}
          >
            <Plus size={16} />
            添加武器
          </button>
        </div>
      )}
      <p className="field-help">
        武器技能与 DB 自动跟随角色。射程以码计；装弹、故障及弹药数量可在局内管理。
      </p>
      <div className="coc-record-list">
        {equipment?.weapons.map((w) => {
          const values = cocWeaponValues(card, w);
          const specialRate = w.profile.sourceText?.usesPerRound;
          const showSpecialRate =
            specialRate &&
            /全自动|连射|布置|一次/.test(specialRate) &&
            w.overrides?.usesPerRound?.mode !== 'manual';
          return (
            <article className="coc-record" key={w.id}>
              <div className="coc-record-title">
                <div>
                  <h4>{w.profile.name}</h4>
                  <p className="coc-data-line">
                    {skills.find((s) => s.value === values.skillKey)?.label ??
                      COC_SKILL_CATALOG.find(({ key }) => key === values.skillKey)?.label ??
                      '未登记技能'}{' '}
                    {values.skill}% · 伤害{' '}
                    {values.damageRequiresRuling ? '需裁定' : values.damageExpression} ·{' '}
                    {values.rangeRequiresRuling
                      ? '射程待确认'
                      : values.range === 0
                        ? w.profile.sourceText?.range === '布置'
                          ? '布置'
                          : '接触'
                        : `${[values.range, ...values.longerRanges.map((band) => band.range)].join(' / ')} 码`}{' '}
                    ·{' '}
                    {showSpecialRate ? (
                      specialRate.replace(/or/g, ' 或 ')
                    ) : (
                      <>
                        {values.roundsPerUse ? `每 ${values.roundsPerUse} 轮` : '每轮'}{' '}
                        {values.usesPerRound}
                        {values.rapidUsesPerRound > values.usesPerRound
                          ? `（${values.rapidUsesPerRound}）`
                          : ''}{' '}
                        次
                      </>
                    )}
                  </p>
                </div>
                {canDefine && (
                  <button
                    type="button"
                    className="icon-button small danger"
                    aria-label={`移除${w.profile.name}`}
                    disabled={definitionsBlocked}
                    onClick={() => void send({ kind: 'weapon-remove', itemId: w.id })}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
              {w.profile.rulesNotes && <p className="field-help">{w.profile.rulesNotes}</p>}
              {(values.capacity > 0 || w.ammo.jammed) && (
                <div className="coc-actions">
                  <span className="pill">
                    {values.capacity > 0
                      ? `弹药 ${w.ammo.loaded}/${values.capacity} · 备用 ${w.ammo.reserve}`
                      : '无需弹药'}
                    {values.ammoType && ` · ${values.ammoType}`}
                    {w.ammo.jammed ? ' · 故障' : ''}
                  </span>
                  {values.capacity > 0 && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={
                        blocked ||
                        w.ammo.jammed ||
                        !w.ammo.reserve ||
                        w.ammo.loaded >= values.capacity
                      }
                      onClick={() => void send({ kind: 'weapon-reload', itemId: w.id })}
                    >
                      <RotateCcw size={14} />
                      装填
                    </button>
                  )}
                  {w.ammo.jammed && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={blocked}
                      onClick={() => void send({ kind: 'weapon-clear-jam', itemId: w.id })}
                    >
                      排除故障
                    </button>
                  )}
                </div>
              )}
              <details>
                <summary>数值与弹药调整</summary>
                <div className="auto-value-grid">
                  {(
                    [
                      { key: 'skill', label: '武器技能', min: 0, max: 1000 },
                      { key: 'range', label: '基础射程', min: 0, max: 10000 },
                      { key: 'usesPerRound', label: '每轮攻击次数', min: 1, max: 20 },
                      {
                        key: 'rapidUsesPerRound',
                        label: '速射次数',
                        min: values.usesPerRound,
                        max: 20,
                      },
                      { key: 'capacity', label: '装弹量', min: 0, max: 9999 },
                      { key: 'malfunction', label: '故障值', min: 0, max: 100 },
                    ] as const
                  ).map(({ key, label, min, max }) => (
                    <AutoValueField
                      key={key}
                      label={`${w.profile.name} · ${label}`}
                      automatic={values.automatic[key]}
                      control={w.overrides?.[key]}
                      disabled={definitionsBlocked}
                      min={min}
                      max={max}
                      step={key === 'range' ? 0.001 : 1}
                      source={key === 'malfunction' ? '0 表示无故障值' : undefined}
                      onEdit={(change) =>
                        send({ kind: 'weapon-control', itemId: w.id, field: key, change })
                      }
                    />
                  ))}
                  <AutoValueField
                    label={`${w.profile.name} · 基础伤害`}
                    automatic={values.automatic.damage}
                    control={w.overrides?.damage}
                    disabled={definitionsBlocked}
                    source="基础伤害骰式，如 1d6+2"
                    onEdit={(change) =>
                      send({ kind: 'weapon-control', itemId: w.id, field: 'damage', change })
                    }
                  />
                  <EquipmentChoice
                    label={`${w.profile.name} · 关联技能`}
                    automatic={values.automatic.skillKey}
                    control={w.overrides?.skillKey}
                    disabled={definitionsBlocked}
                    options={skills}
                    onEdit={(change) =>
                      send({ kind: 'weapon-control', itemId: w.id, field: 'skillKey', change })
                    }
                  />
                  <EquipmentChoice
                    label={`${w.profile.name} · DB 方式`}
                    automatic={values.automatic.damageBonusMode}
                    control={w.overrides?.damageBonusMode}
                    disabled={definitionsBlocked}
                    options={dbModes}
                    onEdit={(change) =>
                      send({
                        kind: 'weapon-control',
                        itemId: w.id,
                        field: 'damageBonusMode',
                        change,
                      })
                    }
                  />
                </div>
                {values.longerRanges.length > 0 && (
                  <p className="field-help">
                    距离与伤害：
                    {[{ range: values.range, damage: values.damage }, ...values.longerRanges]
                      .map((band) => `${band.range} 码内 ${band.damage}`)
                      .join(' · ')}
                  </p>
                )}
                {values.capacity > 0 && (
                  <form
                    className="coc-inline-fields"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const f = new FormData(form);
                      void send({
                        kind: 'weapon-ammo',
                        itemId: w.id,
                        loaded: Number(f.get('loaded')),
                        reserve: Number(f.get('reserve')),
                        reason: String(f.get('reason')),
                      }).then((saved) => {
                        if (saved) {
                          const reason = form.elements.namedItem('reason');
                          if (reason instanceof HTMLInputElement) reason.value = '';
                        }
                      });
                    }}
                  >
                    <label className="field">
                      已装填
                      <input
                        name="loaded"
                        required
                        type="number"
                        min={0}
                        max={values.capacity}
                        defaultValue={w.ammo.loaded}
                        key={`loaded-${w.ammo.loaded}`}
                        disabled={blocked}
                      />
                    </label>
                    <label className="field">
                      备用弹药
                      <input
                        name="reserve"
                        required
                        type="number"
                        min={0}
                        max={9999}
                        defaultValue={w.ammo.reserve}
                        key={`reserve-${w.ammo.reserve}`}
                        disabled={blocked}
                      />
                    </label>
                    <label className="field">
                      调整原因
                      <input
                        name="reason"
                        required
                        maxLength={200}
                        placeholder="购买、补给或修正"
                        disabled={blocked}
                      />
                    </label>
                    <button type="submit" className="button secondary" disabled={blocked}>
                      更新弹药
                    </button>
                  </form>
                )}
                <EquipmentNotes
                  name={w.profile.name}
                  notes={w.notes}
                  disabled={blocked}
                  onEdit={(notes) => send({ kind: 'weapon-notes', itemId: w.id, notes })}
                />
              </details>
              {w.notes && <p className="field-help">{w.notes}</p>}
              {canDefine && !w.catalogId && (
                <button
                  type="button"
                  className="text-button"
                  disabled={definitionsBlocked}
                  title="保存装备资料，不含弹药与角色手填修正"
                  onClick={() => saveToLibrary({ kind: 'weapon', profile: w.profile })}
                >
                  保存到备团库
                </button>
              )}
            </article>
          );
        })}
      </div>
      {!equipment?.weapons.length && <p className="coc-empty">暂无武器</p>}
      <section className="coc-subsection">
        <div className="coc-record-title">
          <h4>防具</h4>
          <span className="pill">
            <Shield size={14} />
            躯干护甲 {cocUnresolvedArmor(card).length ? '待裁定' : cocArmorValue(card)}
            {(headArmor > 0 || cocUnresolvedArmor(card, 'head').length > 0) &&
              ` · 头部护甲 ${cocUnresolvedArmor(card, 'head').length ? '待裁定' : headArmor}`}
          </span>
        </div>
        {canDefine && (
          <div className="coc-inline-fields">
            <CocEquipmentPicker
              kind="armor"
              library={library}
              value={armor}
              onChange={setArmor}
              disabled={definitionsBlocked}
              onOpen={refreshLibrary}
            />
            <button
              type="button"
              className="button secondary"
              disabled={definitionsBlocked}
              onClick={() => addFromCatalog('armor-add')}
            >
              <Plus size={16} />
              添加防具
            </button>
          </div>
        )}
        <div className="coc-record-list">
          {equipment?.armor.map((a) => {
            const values = cocArmorValues(a);
            return (
              <article className="coc-record" key={a.id}>
                <div className="coc-record-title">
                  <label className="coc-toggle">
                    <input
                      type="checkbox"
                      checked={a.equipped}
                      disabled={blocked}
                      aria-label={`穿戴${a.profile.name}`}
                      onChange={(e) =>
                        void send({ kind: 'armor-equip', itemId: a.id, equipped: e.target.checked })
                      }
                    />
                    <span>
                      {a.profile.name} · {cocArmorCoverageLabel(a.profile)} ·{' '}
                      {COC_ARMOR_KINDS[a.profile.kind ?? 'worn']}
                    </span>
                  </label>
                  {canDefine && (
                    <button
                      type="button"
                      className="icon-button small danger"
                      disabled={definitionsBlocked}
                      aria-label={`移除${a.profile.name}`}
                      onClick={() => void send({ kind: 'armor-remove', itemId: a.id })}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
                {a.profile.rulesNotes && <p className="field-help">{a.profile.rulesNotes}</p>}
                <div className="auto-value-grid">
                  {(['rating', 'movPenalty'] as const).map((key) => (
                    <AutoValueField
                      key={key}
                      label={`${a.profile.name} · ${key === 'rating' ? '护甲值' : '移动力减值'}`}
                      automatic={a.profile[key]}
                      control={a.overrides?.[key]}
                      disabled={definitionsBlocked}
                      min={0}
                      max={key === 'rating' ? 99 : 20}
                      source={
                        key === 'rating' && !values.resolved
                          ? `原文 ${a.profile.sourceText?.rating ?? '未知'} · 请手动确认`
                          : `生效 ${values[key]}`
                      }
                      onEdit={(change) =>
                        send({ kind: 'armor-control', itemId: a.id, field: key, change })
                      }
                    />
                  ))}
                </div>
                <details>
                  <summary>备注</summary>
                  <EquipmentNotes
                    name={a.profile.name}
                    notes={a.notes}
                    disabled={blocked}
                    onEdit={(notes) => send({ kind: 'armor-notes', itemId: a.id, notes })}
                  />
                </details>
                {canDefine && !a.catalogId && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={definitionsBlocked}
                    title="保存装备资料，不含角色手填修正"
                    onClick={() => saveToLibrary({ kind: 'armor', profile: a.profile })}
                  >
                    保存到备团库
                  </button>
                )}
              </article>
            );
          })}
        </div>
        {!equipment?.armor.length && <p className="coc-empty">暂无防具</p>}
        <p className="field-help">
          同部位防具取最高护甲值，不叠加。主持人可按命中部位调整伤害结算。
          盾牌、掩体与环境防护按当次情境裁定，不计入常驻躯干护甲。
        </p>
      </section>
      {canDefine && (
        <>
          <details open={custom} onToggle={(e) => setCustom(e.currentTarget.open)}>
            <summary>自定义武器</summary>
            <div className="coc-inline-fields">
              <label className="field">
                武器类型
                <select
                  aria-label="自定义武器类型"
                  value={weaponDraft.category}
                  disabled={definitionsBlocked}
                  onChange={(event) =>
                    setWeaponDraft({
                      ...weaponDraft,
                      category: event.target.value as CocWeaponProfile['category'],
                    })
                  }
                >
                  {Object.entries(COC_WEAPON_CATEGORIES).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                武器名称
                <input
                  maxLength={100}
                  value={weaponDraft.name}
                  disabled={definitionsBlocked}
                  onChange={(e) => setWeaponDraft({ ...weaponDraft, name: e.target.value })}
                />
              </label>
              <label className="field">
                关联技能
                <select
                  value={weaponDraft.skillKey}
                  disabled={definitionsBlocked}
                  onChange={(e) => setWeaponDraft({ ...weaponDraft, skillKey: e.target.value })}
                >
                  {skills.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                伤害骰式
                <input
                  value={weaponDraft.damage}
                  disabled={definitionsBlocked}
                  maxLength={59}
                  onChange={(e) => setWeaponDraft({ ...weaponDraft, damage: e.target.value })}
                />
              </label>
              <label className="field">
                DB
                <select
                  value={weaponDraft.damageBonusMode}
                  disabled={definitionsBlocked}
                  onChange={(e) =>
                    setWeaponDraft({
                      ...weaponDraft,
                      damageBonusMode: e.target.value as CocWeaponProfile['damageBonusMode'],
                    })
                  }
                >
                  {dbModes.map((mode) => (
                    <option value={mode.value} key={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
              </label>
              {(
                [
                  { key: 'range', label: '射程（码）', min: 0, max: 10000 },
                  { key: 'usesPerRound', label: '每轮次数', min: 1, max: 20 },
                  { key: 'capacity', label: '装弹量', min: 0, max: 9999 },
                  { key: 'malfunction', label: '故障值', min: 0, max: 100 },
                ] as const
              ).map(({ key, label, min, max }) => (
                <label className="field" key={key}>
                  {label}
                  <input
                    type="number"
                    min={min}
                    max={max}
                    step={key === 'range' ? 0.001 : 1}
                    value={weaponDraft[key]}
                    disabled={definitionsBlocked}
                    onChange={(e) =>
                      setWeaponDraft({ ...weaponDraft, [key]: Number(e.target.value) })
                    }
                  />
                </label>
              ))}
            </div>
            <label className="coc-toggle">
              <input
                type="checkbox"
                checked={weaponDraft.impales}
                disabled={definitionsBlocked}
                onChange={(e) => setWeaponDraft({ ...weaponDraft, impales: e.target.checked })}
              />
              可贯穿
            </label>
            <button
              type="button"
              className="button secondary"
              disabled={definitionsBlocked || !weaponDraft.name.trim()}
              onClick={() => void send({ kind: 'weapon-add', entry: { profile: weaponDraft } })}
            >
              添加自定义武器
            </button>
          </details>
          <details className="coc-custom-armor">
            <summary>自定义防具</summary>
            <div className="coc-inline-fields">
              <label className="field">
                防护类型
                <select
                  aria-label="自定义防护类型"
                  value={armorDraft.kind ?? 'worn'}
                  disabled={definitionsBlocked}
                  onChange={(event) => {
                    const kind = event.target.value as NonNullable<CocArmorProfile['kind']>;
                    setArmorDraft({
                      ...armorDraft,
                      kind,
                      coverage: ['shield', 'cover', 'environment'].includes(kind)
                        ? 'none'
                        : armorDraft.coverage === 'none'
                          ? 'body'
                          : armorDraft.coverage,
                    });
                  }}
                >
                  {Object.entries(COC_ARMOR_KINDS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                防具名称
                <input
                  value={armorDraft.name}
                  maxLength={100}
                  disabled={definitionsBlocked}
                  onChange={(e) => setArmorDraft({ ...armorDraft, name: e.target.value })}
                />
              </label>
              <label className="field">
                护甲值
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={armorDraft.rating}
                  disabled={definitionsBlocked}
                  onChange={(e) => setArmorDraft({ ...armorDraft, rating: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                MOV 减值
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={armorDraft.movPenalty}
                  disabled={definitionsBlocked}
                  onChange={(e) =>
                    setArmorDraft({ ...armorDraft, movPenalty: Number(e.target.value) })
                  }
                />
              </label>
              <label className="field">
                防护部位
                <select
                  aria-label="防护部位"
                  value={armorDraft.coverage}
                  disabled={definitionsBlocked}
                  onChange={(e) =>
                    setArmorDraft({
                      ...armorDraft,
                      coverage: e.target.value as CocArmorProfile['coverage'],
                      ...(e.target.value === 'custom'
                        ? {
                            locations: armorDraft.locations?.length
                              ? armorDraft.locations
                              : ['body'],
                          }
                        : {}),
                    })
                  }
                >
                  <option value="body">躯干</option>
                  <option value="head">头部</option>
                  <option value="all">全身</option>
                  <option value="custom">自选多个部位</option>
                  <option value="none">按遮挡范围裁定</option>
                </select>
              </label>
            </div>
            {armorDraft.coverage === 'custom' && (
              <fieldset className="coc-coverage-grid">
                <legend>覆盖部位</legend>
                {Object.entries(COC_ARMOR_LOCATIONS).map(([key, label]) => (
                  <label key={key} className="coc-toggle">
                    <input
                      type="checkbox"
                      checked={
                        armorDraft.locations?.includes(key as keyof typeof COC_ARMOR_LOCATIONS) ??
                        false
                      }
                      disabled={definitionsBlocked}
                      onChange={(event) =>
                        setArmorDraft({
                          ...armorDraft,
                          locations: event.target.checked
                            ? [
                                ...(armorDraft.locations ?? []),
                                key as keyof typeof COC_ARMOR_LOCATIONS,
                              ]
                            : armorDraft.locations?.filter((value) => value !== key),
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
            )}
            <label className="field">
              防护条件与备注
              <textarea
                rows={2}
                maxLength={2000}
                value={armorDraft.rulesNotes ?? ''}
                disabled={definitionsBlocked}
                onChange={(event) =>
                  setArmorDraft({ ...armorDraft, rulesNotes: event.target.value })
                }
                placeholder="例如只防护正面、只对钝击有效"
              />
            </label>
            <button
              type="button"
              className="button secondary"
              disabled={
                definitionsBlocked ||
                !armorDraft.name.trim() ||
                (armorDraft.coverage === 'custom' && !armorDraft.locations?.length)
              }
              onClick={() => void send({ kind: 'armor-add', entry: { profile: armorDraft } })}
            >
              添加自定义防具
            </button>
          </details>
        </>
      )}
      {notice && (
        <p className="field-help" role="status">
          {notice}
        </p>
      )}
      {libraryError && (
        <p className="inline-error" role="alert">
          {libraryError}
        </p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
