import { useRef, useState } from 'react';
import { ChevronDown, Download, Plus, Upload, X } from 'lucide-react';
import { COC_ATTRIBUTES } from '../../shared/catalog';
import {
  COC_CAREER_SOURCE_LABELS,
  COC_CUSTOM_SKILL_LIMIT,
  COC_OCCUPATION_ATTRIBUTES,
  COC_OCCUPATION_TEMPLATE_MAX_BYTES,
  COC_SKILL_FAMILIES,
  DEFAULT_COC_CAREER,
  cocCustomSkillKey,
  cocOccupationBranches,
  cocOccupationProfile,
  cocOccupationSkillPool,
  cocSkillDefinitions,
  exportCocOccupationTemplate,
  parseCocOccupationTemplate,
  type CocCareer,
  type CocCustomSkill,
  type CocOccupationAttribute,
  type CocSkillFamily,
} from '../../shared/coc-career';
import { updateCocCareer } from '../../shared/creation';
import type { Character } from '../../shared/types';
import { downloadFile } from '../storage';
import { AutoValueField } from './AutoValueField';
import { editValueControl } from '../../shared/value-control';
import { cocOccupationSource } from '../../shared/coc-occupations';

type CustomOccupation = NonNullable<CocCareer['customOccupation']>;
type OccupationDraft = {
  name: string;
  minimum: string;
  maximum: string;
  formula: 'edu' | 'mixed';
  bonus: CocOccupationAttribute[];
  groups: string[][];
  free: number;
  importedSkills: CocCustomSkill[];
};
type SkillDraft = {
  key?: string;
  label: string;
  base: string;
  family: CocSkillFamily | '';
};

const formulaAttributes = COC_ATTRIBUTES.filter((attribute) =>
  COC_OCCUPATION_ATTRIBUTES.some((key) => key === attribute.key),
);
const familyOptions = Object.entries(COC_SKILL_FAMILIES) as [CocSkillFamily, string][];
const numberField = (value: string) => (value.trim() === '' ? NaN : Number(value));

function occupationDraft(
  occupation?: CustomOccupation,
  importedSkills: CocCustomSkill[] = [],
): OccupationDraft {
  return {
    name: occupation?.name ?? '',
    minimum: occupation ? String(occupation.credit[0]) : '',
    maximum: occupation ? String(occupation.credit[1]) : '',
    formula: occupation?.bonus.length ? 'mixed' : 'edu',
    bonus: occupation ? [...occupation.bonus] : [],
    groups: Array.from({ length: 8 }, (_, index) => [...(occupation?.groups[index] ?? [])]),
    free: occupation?.free ?? 0,
    importedSkills,
  };
}

function mergeSkills(existing: CocCustomSkill[], imported: CocCustomSkill[]): CocCustomSkill[] {
  const skills = new Map(existing.map((skill) => [skill.key, skill]));
  for (const skill of imported) {
    const prior = skills.get(skill.key);
    if (
      prior &&
      (prior.label !== skill.label || prior.base !== skill.base || prior.family !== skill.family)
    )
      throw new Error(
        `技能「${prior.label}」与导入模板中的同一技能定义不同，请先调整或移除现有定义。`,
      );
    skills.set(skill.key, skill);
  }
  return [...skills.values()];
}

export function CocCareerEditor({
  card,
  onChange,
  disabled = false,
}: {
  card: Character;
  onChange: (card: Character) => void;
  disabled?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [occupation, setOccupation] = useState<OccupationDraft | null>(null);
  const [skill, setSkill] = useState<SkillDraft | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  if (card.rule !== 'coc') return null;

  const career = card.cocCareer ?? DEFAULT_COC_CAREER;
  const custom = career.customOccupation;
  const branches = cocOccupationBranches(card.occupation, career.occupationId);
  const profile = cocOccupationProfile(card);
  const skillPool = cocOccupationSkillPool(card);
  const pendingBases = cocSkillDefinitions(card).filter(
    (skill) =>
      skill.unlistedBase &&
      (skillPool.includes(skill.key) ||
        (card.creation?.rule === 'coc' && (card.creation.personal[skill.key] ?? 0) > 0)),
  );
  const previewSkills = new Map(
    [...career.customSkills, ...(occupation?.importedSkills ?? [])].map((entry) => [
      entry.key,
      entry,
    ]),
  );
  const definitions = cocSkillDefinitions({
    ...card,
    cocCareer: {
      ...career,
      specializationsEnabled: true,
      customSkills: [...previewSkills.values()],
    },
  }).filter(({ key }) => key !== 'creditRating' && key !== 'cthulhuMythos');
  const skillLabels = new Map(definitions.map(({ key, label }) => [key, label]));
  const currentSkills = new Set(cocSkillDefinitions(card).map(({ key }) => key));
  const chooseSkills = definitions.filter(
    ({ key, source }) =>
      currentSkills.has(key) ||
      (source === 'custom' && occupation?.importedSkills.some((entry) => entry.key === key)),
  );
  const skillGroups = [
    ['常用技能', chooseSkills.filter((entry) => !entry.family && entry.source !== 'custom')],
    ...familyOptions.map(
      ([family, label]) =>
        [label, chooseSkills.filter((entry) => entry.family === family)] as const,
    ),
    ['其他自定义技能', chooseSkills.filter((entry) => !entry.family && entry.source === 'custom')],
  ] as const;

  const apply = (next: CocCareer, occupationName?: string, message = ''): boolean => {
    if (disabled) return false;
    try {
      const result = updateCocCareer(card, next, occupationName);
      onChange({ ...result.card, updatedAt: new Date().toISOString() });
      setError('');
      const returned = [
        result.returnedOccupation > 0 ? `职业点 ${result.returnedOccupation} 点` : '',
        result.returnedPersonal > 0 ? `兴趣点 ${result.returnedPersonal} 点` : '',
      ].filter(Boolean);
      setNotice(
        [
          message,
          returned.length ? `已退回${returned.join('、')}。` : '',
          result.removedAdjustments
            ? `已移除失效技能的 ${result.removedAdjustments} 条局内修正。`
            : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
      return true;
    } catch (cause) {
      setNotice('');
      setError((cause as Error).message);
      return false;
    }
  };

  const useCustomOccupation = () => {
    if (custom) apply({ ...career, occupationId: undefined, branchId: undefined }, custom.name);
  };
  const saveOccupation = () => {
    if (!occupation || disabled) return;
    if (occupation.formula === 'mixed' && !occupation.bonus.length) {
      setError('请为职业点公式选择至少一项备选属性。');
      return;
    }
    const minimum = numberField(occupation.minimum);
    const maximum = numberField(occupation.maximum);
    if (
      ![minimum, maximum].every((value) => Number.isInteger(value) && value >= 0 && value <= 99)
    ) {
      setError('请填写 0 至 99 的整数信用评级范围。');
      return;
    }
    try {
      const nextOccupation: CustomOccupation = {
        name: occupation.name.trim(),
        credit: [minimum, maximum],
        bonus: occupation.formula === 'mixed' ? occupation.bonus : [],
        groups: occupation.groups.slice(0, 8 - occupation.free),
        free: occupation.free,
      };
      const customSkills = mergeSkills(career.customSkills, occupation.importedSkills);
      if (
        apply(
          {
            ...career,
            branchId: undefined,
            occupationId: undefined,
            customOccupation: nextOccupation,
            customSkills,
          },
          nextOccupation.name,
          '自定义职业已保存并应用。',
        )
      )
        setOccupation(null);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  const updateSlot = (index: number, value: string[]) => {
    if (!occupation) return;
    setOccupation({
      ...occupation,
      groups: occupation.groups.map((group, slot) => (slot === index ? value : group)),
    });
  };

  const importTemplate = async (file?: File) => {
    if (!file || disabled) return;
    try {
      if (file.size > COC_OCCUPATION_TEMPLATE_MAX_BYTES)
        throw new Error('职业模板不能超过 64 KiB。');
      const { occupation: nextOccupation, skills } = parseCocOccupationTemplate(await file.text());
      setOccupation(occupationDraft(nextOccupation, skills));
      setError('');
      setNotice('已读取职业模板，保存后应用到当前调查员。');
    } catch (cause) {
      setNotice('');
      setError((cause as Error).message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const exportTemplate = () => {
    if (!custom) return;
    downloadFile(
      exportCocOccupationTemplate(career),
      `${custom.name}-CoC职业.json`,
      'application/json',
    );
  };

  const saveSkill = () => {
    if (!skill || disabled) return;
    const base = numberField(skill.base);
    if (!Number.isInteger(base) || base < 0 || base > 99) {
      setError('请填写 0 至 99 的整数技能基础值。');
      return;
    }
    const nextSkill: CocCustomSkill = {
      key: skill.key ?? cocCustomSkillKey(),
      label: skill.label,
      base,
      ...(skill.family ? { family: skill.family } : {}),
    };
    const customSkills = skill.key
      ? career.customSkills.map((entry) => (entry.key === skill.key ? nextSkill : entry))
      : [...career.customSkills, nextSkill];
    if (apply({ ...career, customSkills }, undefined, '自定义技能已保存。')) setSkill(null);
  };

  return (
    <section className="coc-section" aria-label="职业与技能专长">
      <div className="coc-toggles">
        <label className="coc-toggle">
          <input
            type="checkbox"
            checked={career.branchesEnabled}
            disabled={disabled}
            onChange={(event) => apply({ ...career, branchesEnabled: event.target.checked })}
          />
          启用职业分支
        </label>
        <label className="coc-toggle">
          <input
            type="checkbox"
            checked={career.specializationsEnabled}
            disabled={disabled}
            onChange={(event) => apply({ ...career, specializationsEnabled: event.target.checked })}
          />
          启用技能专长
        </label>
      </div>
      {career.branchesEnabled &&
        (branches.length ? (
          <label className="field">
            职业分支
            <select
              value={career.branchId ?? ''}
              disabled={disabled}
              onChange={(event) => apply({ ...career, branchId: event.target.value || undefined })}
            >
              <option value="">通用职业 · {card.occupation}</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name} ·{' '}
                  {branch.reference
                    ? cocOccupationSource(branch)
                    : COC_CAREER_SOURCE_LABELS[branch.source]}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="subtle-note">
            {career.occupationId
              ? '目录已分别列出职业变体，可在职业选择中搜索。'
              : card.occupation
                ? '当前职业没有预设分支。'
                : '选择调查员职业后可查看分支。'}
          </p>
        ))}

      {profile?.notes && <p className="subtle-note">{profile.notes}</p>}
      {pendingBases.length > 0 && (
        <div className="coc-subsection">
          <h4>扩展技能基础值</h4>
          <p className="field-help">
            原表未提供以下基础值，暂显示 0。请解锁并切换为手动填写，由主持人审核。
          </p>
          <div className="coc-inline-fields">
            {pendingBases.map((skill) => (
              <AutoValueField
                key={skill.key}
                label={skill.label}
                automatic={0}
                control={career.skillBases?.[skill.key]}
                min={0}
                max={99}
                disabled={disabled}
                onEdit={(edit) => {
                  apply({
                    ...career,
                    skillBases: {
                      ...career.skillBases,
                      [skill.key]: editValueControl(career.skillBases?.[skill.key], edit, 0),
                    },
                  });
                }}
              />
            ))}
          </div>
        </div>
      )}
      <details className="coc-record">
        <summary>
          <span>自定义职业{custom ? ` · ${custom.name}` : ''}</span>
          <ChevronDown size={15} aria-hidden="true" />
        </summary>
        <div className="coc-actions">
          <button
            type="button"
            className="button secondary compact"
            disabled={disabled}
            onClick={() => {
              setOccupation(occupationDraft(custom));
              setError('');
              setNotice('');
            }}
          >
            {custom ? '编辑方案' : '创建方案'}
          </button>
          {custom && card.occupation !== custom.name && (
            <button
              type="button"
              className="button secondary compact"
              disabled={disabled}
              onClick={useCustomOccupation}
            >
              使用此职业
            </button>
          )}
          <button
            type="button"
            className="button secondary compact"
            disabled={disabled}
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={14} /> 导入模板
          </button>
          {custom && (
            <button
              type="button"
              className="button secondary compact"
              disabled={disabled}
              onClick={exportTemplate}
            >
              <Download size={14} /> 导出模板
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            aria-label="导入自定义职业模板"
            className="visually-hidden"
            disabled={disabled}
            onChange={(event) => void importTemplate(event.target.files?.[0])}
          />
        </div>
        {occupation && (
          <div className="coc-section">
            <div className="form-grid">
              <label className="field">
                职业名称
                <input
                  maxLength={80}
                  value={occupation.name}
                  disabled={disabled}
                  onChange={(event) => setOccupation({ ...occupation, name: event.target.value })}
                />
              </label>
              <label className="field">
                职业点公式
                <select
                  value={occupation.formula}
                  disabled={disabled}
                  onChange={(event) =>
                    setOccupation({
                      ...occupation,
                      formula: event.target.value === 'mixed' ? 'mixed' : 'edu',
                    })
                  }
                >
                  <option value="edu">教育 × 4</option>
                  <option value="mixed">教育 × 2 + 另一项属性 × 2</option>
                </select>
              </label>
              <label className="field">
                信用评级下限
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={occupation.minimum}
                  disabled={disabled}
                  onChange={(event) =>
                    setOccupation({ ...occupation, minimum: event.target.value })
                  }
                />
              </label>
              <label className="field">
                信用评级上限
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={occupation.maximum}
                  disabled={disabled}
                  onChange={(event) =>
                    setOccupation({ ...occupation, maximum: event.target.value })
                  }
                />
              </label>
            </div>
            {occupation.formula === 'mixed' && (
              <div role="group" aria-label="职业点公式可选属性" className="coc-toggles">
                {formulaAttributes.map(({ key, label }) => {
                  const attribute = key as CocOccupationAttribute;
                  return (
                    <label className="coc-toggle" key={key}>
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={occupation.bonus.includes(attribute)}
                        onChange={(event) =>
                          setOccupation({
                            ...occupation,
                            bonus: event.target.checked
                              ? [...occupation.bonus, attribute]
                              : occupation.bonus.filter((entry) => entry !== attribute),
                          })
                        }
                      />
                      {label}
                    </label>
                  );
                })}
              </div>
            )}
            <label className="field">
              自选技能位置数
              <select
                value={occupation.free}
                disabled={disabled}
                onChange={(event) =>
                  setOccupation({ ...occupation, free: Number(event.target.value) })
                }
              >
                {Array.from({ length: 9 }, (_, count) => (
                  <option key={count} value={count}>
                    {count} / 8
                  </option>
                ))}
              </select>
            </label>
            {occupation.free < 8 && (
              <div className="form-grid" aria-label="限定职业技能范围">
                {occupation.groups.slice(0, 8 - occupation.free).map((group, index) => (
                  <div key={index}>
                    <label className="field">
                      职业技能位置 {index + 1}
                      <select
                        value=""
                        disabled={disabled}
                        onChange={(event) => {
                          if (event.target.value) updateSlot(index, [...group, event.target.value]);
                        }}
                      >
                        <option value="">{group.length ? '添加备选技能' : '选择技能'}</option>
                        {skillGroups.map(
                          ([label, choices]) =>
                            choices.length > 0 && (
                              <optgroup label={label} key={label}>
                                {choices
                                  .filter((entry) => !group.includes(entry.key))
                                  .map((entry) => (
                                    <option key={entry.key} value={entry.key}>
                                      {entry.label}
                                    </option>
                                  ))}
                              </optgroup>
                            ),
                        )}
                      </select>
                    </label>
                    {group.length > 0 && (
                      <div className="coc-actions">
                        {group.map((key) => (
                          <button
                            key={key}
                            type="button"
                            className="button secondary compact"
                            disabled={disabled}
                            aria-label={`从位置 ${index + 1} 移除${skillLabels.get(key) ?? key}`}
                            onClick={() =>
                              updateSlot(
                                index,
                                group.filter((entry) => entry !== key),
                              )
                            }
                          >
                            {skillLabels.get(key) ?? key} <X size={13} aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="coc-actions">
              <button
                type="button"
                className="button primary compact"
                disabled={disabled}
                onClick={saveOccupation}
              >
                保存并应用职业
              </button>
              <button
                type="button"
                className="button secondary compact"
                onClick={() => {
                  setOccupation(null);
                  setError('');
                  setNotice('');
                }}
              >
                取消
              </button>
            </div>
          </div>
        )}
      </details>

      <details className="coc-record">
        <summary>
          <span>自定义技能</span>
          <ChevronDown size={15} aria-hidden="true" />
        </summary>
        {career.customSkills.length > 0 && (
          <div className="coc-record-list">
            {career.customSkills.map((entry) => (
              <div key={entry.key} className="coc-data-line">
                <b>{entry.label}</b>
                <span>
                  基础值 {entry.base}
                  {entry.family ? ` · ${COC_SKILL_FAMILIES[entry.family]}` : ''}
                </span>
                <button
                  type="button"
                  className="button secondary compact"
                  disabled={disabled}
                  aria-label={`编辑${entry.label}`}
                  onClick={() =>
                    setSkill({ ...entry, base: String(entry.base), family: entry.family ?? '' })
                  }
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="button secondary compact"
                  disabled={disabled}
                  aria-label={`移除${entry.label}`}
                  onClick={() => {
                    if (custom?.groups.some((group) => group.includes(entry.key))) {
                      setError(`请先从自定义职业的技能范围移除「${entry.label}」。`);
                      return;
                    }
                    if (
                      apply(
                        {
                          ...career,
                          customSkills: career.customSkills.filter(({ key }) => key !== entry.key),
                        },
                        undefined,
                        `已移除「${entry.label}」。`,
                      ) &&
                      skill?.key === entry.key
                    )
                      setSkill(null);
                  }}
                >
                  移除
                </button>
              </div>
            ))}
          </div>
        )}
        {skill ? (
          <div className="coc-section">
            <div className="form-grid">
              <label className="field">
                技能名称
                <input
                  maxLength={80}
                  value={skill.label}
                  disabled={disabled}
                  onChange={(event) => setSkill({ ...skill, label: event.target.value })}
                />
              </label>
              <label className="field">
                基础值
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={skill.base}
                  disabled={disabled}
                  onChange={(event) => setSkill({ ...skill, base: event.target.value })}
                />
              </label>
              <label className="field">
                技能类别
                <select
                  value={skill.family}
                  disabled={disabled}
                  onChange={(event) =>
                    setSkill({ ...skill, family: event.target.value as SkillDraft['family'] })
                  }
                >
                  <option value="">普通技能</option>
                  {familyOptions.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}专长
                    </option>
                  ))}
                </select>
                <small>设为专长的技能随技能专长开关启停。</small>
              </label>
            </div>
            <div className="coc-actions">
              <button
                type="button"
                className="button primary compact"
                disabled={disabled}
                onClick={saveSkill}
              >
                保存技能
              </button>
              <button
                type="button"
                className="button secondary compact"
                onClick={() => {
                  setSkill(null);
                  setError('');
                }}
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="button secondary compact"
            disabled={disabled || career.customSkills.length >= COC_CUSTOM_SKILL_LIMIT}
            onClick={() => setSkill({ label: '', base: '1', family: '' })}
          >
            <Plus size={14} /> 添加技能
          </button>
        )}
      </details>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <p className="prep-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
