import { readCocPreparationLibrary } from '../coc-library-storage';
import { useState } from 'react';
import { Plus, Trash2, BookOpen, WandSparkles, Pencil } from 'lucide-react';
import type { Character } from '../../shared/types';
import {
  emptyCocSession,
  COC_SPELL_PRESETS,
  type CocSpellDefinition,
  type CocTomeDefinition,
} from '../../shared/coc-session';
import type { CocSessionEdit } from '../../shared/coc-runtime';
import { CocSectionHeading } from './CocInvestigator';

const blankSpell = (): CocSpellDefinition => ({
  id: crypto.randomUUID(),
  name: '',
  description: '',
  source: '',
  cost: { mp: 0, san: '0', hp: 0, minutes: 0, rounds: 0 },
});
const blankTome = (): CocTomeDefinition => ({
  id: crypto.randomUUID(),
  name: '',
  description: '',
  initialMinutes: 60,
  fullMinutes: 1440,
  initialMythos: 0,
  fullMythos: 0,
  sanLoss: '0',
  spellIds: [],
});
export type CocSessionPanelProps = {
  card: Character;
  onEdit: (edit: CocSessionEdit) => void | Promise<boolean | void>;
  disabled?: boolean;
  isHost?: boolean;
  active?: boolean;
  libraryMode?: boolean;
};

export function CocMagic({
  card,
  onEdit,
  disabled,
  active = false,
  isHost = true,
  libraryMode = false,
}: CocSessionPanelProps) {
  const session = card.cocSession ?? emptyCocSession(card);
  const library = readCocPreparationLibrary();
  const [loadSpell, setLoadSpell] = useState('');
  const [loadTome, setLoadTome] = useState('');
  const [spell, setSpell] = useState<CocSpellDefinition | null>(null);
  const [tome, setTome] = useState<CocTomeDefinition | null>(null);
  const [error, setError] = useState('');
  const [hpPayment, setHpPayment] = useState(false);
  const [cast, setCast] = useState('');
  const [push, setPush] = useState('');
  const [learning, setLearning] = useState('');
  const [studyMinutes, setStudyMinutes] = useState(1440);
  const [learningCheck, setLearningCheck] = useState(true);
  const [preset, setPreset] = useState('');
  const canManage = !active || isHost;
  const send: typeof onEdit = async (edit) => {
    setError('');
    try {
      return await onEdit(edit);
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  return (
    <div className="coc-section">
      <CocSectionHeading title="法术与神话" eyebrow="SPELLS & MYTHOS" />
      {!libraryMode && canManage && library.spells.length > 0 && (
        <div className="coc-inline-fields">
          <label className="field">
            备团法术库
            <select
              value={loadSpell}
              disabled={disabled}
              onChange={(e) => setLoadSpell(e.target.value)}
            >
              <option value="">选择法术资料</option>
              {library.spells.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button secondary"
            disabled={disabled || !loadSpell}
            onClick={() => {
              const entry = library.spells.find((s) => s.id === loadSpell);
              if (entry) void send({ kind: 'spell-save', spell: entry });
            }}
          >
            载入法术
          </button>
        </div>
      )}
      {canManage && (
        <details>
          <summary>快速入门法术模板</summary>
          <div className="coc-inline-fields">
            <label className="field">
              模板
              <select
                value={preset}
                disabled={disabled}
                onChange={(e) => setPreset(e.target.value)}
              >
                <option value="">选择模板</option>
                {COC_SPELL_PRESETS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="button secondary"
              disabled={disabled || !preset}
              onClick={() => {
                const template = COC_SPELL_PRESETS.find((s) => s.id === preset);
                if (template) setSpell({ ...template, id: crypto.randomUUID() });
              }}
            >
              打开模板并核对代价
            </button>
          </div>
          <p className="field-help">
            模板含《鬼屋》NPC 变体。保存前请核对角色是否适用、投入点数与效果。
          </p>
        </details>
      )}
      <div className="coc-record-title">
        <h4>法术</h4>
        {canManage && (
          <button
            type="button"
            className="button secondary"
            disabled={disabled}
            onClick={() => setSpell(blankSpell())}
          >
            <Plus size={16} />
            添加法术
          </button>
        )}
      </div>
      {!session.spells.length && <p className="coc-empty">暂无法术</p>}
      <div className="coc-record-list">
        {session.spells.map((s) => (
          <article className="coc-record" key={s.id}>
            <div className="coc-record-title">
              <div>
                <h4>{s.name}</h4>
                <p className="coc-data-line">
                  MP {s.cost.mp} · SAN {s.cost.san} · HP {s.cost.hp} · {s.cost.minutes} 分钟 /{' '}
                  {s.cost.rounds} 轮
                </p>
              </div>
              {canManage && (
                <div className="coc-actions">
                  <button
                    type="button"
                    className="icon-button small"
                    disabled={disabled}
                    aria-label={`编辑${s.name}`}
                    onClick={() => {
                      const { id, name, description, source, cost } = s;
                      setSpell({ id, name, description, source, cost });
                    }}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-button small danger"
                    disabled={disabled}
                    aria-label={`移除${s.name}`}
                    onClick={() => void send({ kind: 'spell-remove', spellId: s.id })}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )}
            </div>
            {s.description && <p className="coc-description">{s.description}</p>}
            {s.source && <p className="field-help">来源：{s.source}</p>}
            {active && (
              <div className="coc-actions">
                <span className="pill">
                  {s.learned
                    ? s.casting === 'mastered'
                      ? '已掌握'
                      : s.casting === 'failed'
                        ? '首次施法失败'
                        : '已学习 · 尚未施法'
                    : '尚未学习'}
                </span>
                {!s.learned ? (
                  <button
                    type="button"
                    className="text-button"
                    disabled={disabled || !isHost}
                    onClick={() => setLearning(learning === s.id ? '' : s.id)}
                  >
                    <BookOpen size={15} />
                    学习法术
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={disabled}
                    onClick={() => {
                      setCast(cast === s.id ? '' : s.id);
                      setHpPayment(false);
                      setPush('');
                    }}
                  >
                    <WandSparkles size={15} />
                    施法
                  </button>
                )}
              </div>
            )}
            {learning === s.id && !s.learned && isHost && (
              <form
                className="coc-subsection"
                onSubmit={(e) => {
                  e.preventDefault();
                  void (async () => {
                    if (
                      (await send({
                        kind: 'spell-learn',
                        spellId: s.id,
                        minutes: studyMinutes,
                        ...(learningCheck ? { hardIntCheck: true as const } : {}),
                        confirmed: true,
                      })) !== false
                    )
                      setLearning('');
                  })();
                }}
              >
                <label className="field">
                  本次学习时间（分钟）
                  <input
                    type="number"
                    min={learningCheck ? 1 : 0}
                    max={5256000}
                    required
                    value={studyMinutes}
                    disabled={disabled}
                    onChange={(e) => setStudyMinutes(Number(e.target.value))}
                  />
                </label>
                <label className="coc-toggle">
                  <input
                    type="checkbox"
                    checked={learningCheck}
                    disabled={disabled}
                    onChange={(e) => setLearningCheck(e.target.checked)}
                  />
                  进行困难 INT 学习检定
                </label>
                <p className="field-help">
                  学习方式与所需时间由主持人按来源确定。失败仍记录学习时间；取消检定时由主持人直接确认已学会。
                </p>
                <button type="submit" className="button secondary" disabled={disabled}>
                  {learningCheck ? '结算学习检定' : '确认学会'}
                </button>
              </form>
            )}
            {cast === s.id && (
              <div className="coc-subsection">
                <p className="field-help">
                  当前 MP {card.mp}，HP {card.hp}
                  。首次施法会检定，失败仍消耗相应成本；成功后无需重复首次检定。法术效果由主持人裁定。
                </p>
                <label className="coc-toggle">
                  <input
                    type="checkbox"
                    checked={hpPayment}
                    disabled={disabled}
                    onChange={(e) => setHpPayment(e.target.checked)}
                  />
                  MP 不足时允许以 HP 补足
                </label>
                {s.casting === 'failed' && isHost && (
                  <label className="field">
                    孤注一掷失败后果
                    <input
                      value={push}
                      maxLength={300}
                      disabled={disabled}
                      onChange={(e) => setPush(e.target.value)}
                      placeholder="主持人明确后果后可再次尝试"
                    />
                  </label>
                )}
                <button
                  type="button"
                  className="button primary"
                  disabled={disabled || (s.casting === 'failed' && (!isHost || !push.trim()))}
                  onClick={() =>
                    void (async () => {
                      if (
                        (await send({
                          kind: 'spell-cast',
                          spellId: s.id,
                          allowHpPayment: hpPayment,
                          confirmed: true,
                          ...(s.casting === 'failed' ? { push: { consequence: push } } : {}),
                        })) !== false
                      )
                        setCast('');
                    })()
                  }
                >
                  确认施法
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      {spell && (
        <form
          className="coc-record"
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              if ((await send({ kind: 'spell-save', spell })) !== false) setSpell(null);
            })();
          }}
        >
          <h4>{session.spells.some((s) => s.id === spell.id) ? '编辑法术' : '新增法术'}</h4>
          <div className="coc-inline-fields">
            <label className="field">
              名称
              <input
                required
                maxLength={120}
                value={spell.name}
                disabled={disabled}
                onChange={(e) => setSpell({ ...spell, name: e.target.value })}
              />
            </label>
            <label className="field">
              来源
              <input
                maxLength={150}
                value={spell.source}
                disabled={disabled}
                onChange={(e) => setSpell({ ...spell, source: e.target.value })}
              />
            </label>
          </div>
          <div className="coc-inline-fields">
            {(
              [
                { key: 'mp', label: 'MP 消耗' },
                { key: 'hp', label: 'HP 消耗' },
                { key: 'minutes', label: '耗时（分钟）' },
                { key: 'rounds', label: '耗时（轮）' },
              ] as const
            ).map(({ key, label }) => (
              <label className="field" key={key}>
                {label}
                <input
                  type="number"
                  required
                  min={0}
                  value={spell.cost[key]}
                  disabled={disabled}
                  onChange={(e) =>
                    setSpell({ ...spell, cost: { ...spell.cost, [key]: Number(e.target.value) } })
                  }
                />
              </label>
            ))}
            <label className="field">
              SAN 损失骰式
              <input
                required
                maxLength={120}
                value={spell.cost.san}
                disabled={disabled}
                onChange={(e) =>
                  setSpell({ ...spell, cost: { ...spell.cost, san: e.target.value } })
                }
              />
            </label>
          </div>
          <label className="field">
            效果与条件
            <textarea
              rows={3}
              maxLength={500}
              value={spell.description}
              disabled={disabled}
              onChange={(e) => setSpell({ ...spell, description: e.target.value })}
            />
          </label>
          <div className="coc-actions">
            <button type="submit" className="button primary" disabled={disabled}>
              保存法术
            </button>
            <button
              type="button"
              className="text-button"
              disabled={disabled}
              onClick={() => setSpell(null)}
            >
              取消
            </button>
          </div>
        </form>
      )}
      <section className="coc-subsection">
        <div className="coc-record-title">
          <h4>神话书</h4>
          {canManage && (
            <button
              type="button"
              className="button secondary"
              disabled={disabled}
              onClick={() => setTome(blankTome())}
            >
              <Plus size={16} />
              添加神话书
            </button>
          )}
        </div>
        {!libraryMode && canManage && library.tomes.length > 0 && (
          <div className="coc-inline-fields">
            <label className="field">
              备团神话书库
              <select
                value={loadTome}
                disabled={disabled}
                onChange={(e) => setLoadTome(e.target.value)}
              >
                <option value="">选择神话书资料</option>
                {library.tomes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="button secondary"
              disabled={disabled || !loadTome}
              onClick={() => {
                const entry = library.tomes.find((t) => t.id === loadTome);
                if (!entry) return;
                const missing = entry.spellIds.filter(
                  (id) => !session.spells.some((s) => s.id === id),
                );
                if (missing.length) {
                  setError(
                    `请先载入引用法术：${missing.map((id) => library.spells.find((s) => s.id === id)?.name ?? id).join('、')}`,
                  );
                  return;
                }
                void send({ kind: 'tome-save', tome: entry });
              }}
            >
              载入神话书
            </button>
          </div>
        )}
        <div className="coc-record-list">
          {session.tomes.map((t) => (
            <article className="coc-record" key={t.id}>
              <div className="coc-record-title">
                <h4>{t.name}</h4>
                {canManage && (
                  <div className="coc-actions">
                    <button
                      type="button"
                      className="icon-button small"
                      disabled={disabled}
                      aria-label={`编辑${t.name}`}
                      onClick={() => {
                        const {
                          progressMinutes: _progress,
                          initialComplete: _initial,
                          fullComplete: _full,
                          ...definition
                        } = t;
                        setTome(definition);
                      }}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-button small danger"
                      disabled={disabled}
                      aria-label={`移除${t.name}`}
                      onClick={() => void send({ kind: 'tome-remove', tomeId: t.id })}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </div>
              <p className="coc-data-line">
                初读 {t.initialMinutes} 分钟 · 神话 +{t.initialMythos}；研读 {t.fullMinutes} 分钟 ·
                神话 +{t.fullMythos}；SAN 损失 {t.sanLoss}
              </p>
              {t.description && <p className="coc-description">{t.description}</p>}
              <p className="field-help">
                法术：
                {t.spellIds.map((id) => session.spells.find((s) => s.id === id)?.name).join('、') ||
                  '无'}
              </p>
              {active && (
                <>
                  <progress max={t.initialMinutes + t.fullMinutes} value={t.progressMinutes} />
                  <p className="field-help">
                    已阅读 {t.progressMinutes} / {t.initialMinutes + t.fullMinutes} 分钟 ·{' '}
                    {t.fullComplete
                      ? '已完成研读'
                      : t.initialComplete
                        ? '已完成初读'
                        : '尚未完成初读'}
                  </p>
                  {isHost && !t.fullComplete && (
                    <form
                      className="coc-inline-fields"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void send({
                          kind: 'tome-study',
                          tomeId: t.id,
                          minutes: Number(f.get('minutes')),
                          confirmed: true,
                        });
                      }}
                    >
                      <label className="field">
                        本次阅读（分钟）
                        <input
                          name="minutes"
                          type="number"
                          min={1}
                          max={5256000}
                          defaultValue={60}
                          required
                          disabled={disabled}
                        />
                      </label>
                      <button type="submit" className="button secondary" disabled={disabled}>
                        结算阅读
                      </button>
                    </form>
                  )}
                </>
              )}
            </article>
          ))}
        </div>
        {!session.tomes.length && <p className="coc-empty">暂无神话书</p>}
      </section>
      {tome && (
        <form
          className="coc-record"
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              if ((await send({ kind: 'tome-save', tome })) !== false) setTome(null);
            })();
          }}
        >
          <h4>神话书资料</h4>
          <label className="field">
            书名
            <input
              required
              maxLength={120}
              value={tome.name}
              disabled={disabled}
              onChange={(e) => setTome({ ...tome, name: e.target.value })}
            />
          </label>
          <div className="coc-inline-fields">
            {(
              [
                { key: 'initialMinutes', label: '初读时间（分钟）', min: 1 },
                { key: 'fullMinutes', label: '研读时间（分钟）', min: 1 },
                { key: 'initialMythos', label: '初读神话成长', min: 0 },
                { key: 'fullMythos', label: '研读神话成长', min: 0 },
              ] as const
            ).map(({ key, label, min }) => (
              <label className="field" key={key}>
                {label}
                <input
                  type="number"
                  min={min}
                  required
                  value={tome[key]}
                  disabled={disabled}
                  onChange={(e) => setTome({ ...tome, [key]: Number(e.target.value) })}
                />
              </label>
            ))}
            <label className="field">
              SAN 损失骰式
              <input
                required
                value={tome.sanLoss}
                disabled={disabled}
                onChange={(e) => setTome({ ...tome, sanLoss: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            内容与阅读条件
            <textarea
              rows={3}
              maxLength={500}
              value={tome.description}
              disabled={disabled}
              onChange={(e) => setTome({ ...tome, description: e.target.value })}
            />
          </label>
          <fieldset className="coc-toggles">
            <legend>包含法术</legend>
            {session.spells.map((s) => (
              <label className="coc-toggle" key={s.id}>
                <input
                  type="checkbox"
                  checked={tome.spellIds.includes(s.id)}
                  disabled={disabled}
                  onChange={(e) =>
                    setTome({
                      ...tome,
                      spellIds: e.target.checked
                        ? [...tome.spellIds, s.id]
                        : tome.spellIds.filter((id) => id !== s.id),
                    })
                  }
                />
                {s.name}
              </label>
            ))}
          </fieldset>
          <div className="coc-actions">
            <button type="submit" className="button primary" disabled={disabled}>
              保存神话书
            </button>
            <button
              type="button"
              className="text-button"
              disabled={disabled}
              onClick={() => setTome(null)}
            >
              取消
            </button>
          </div>
        </form>
      )}
      <p className="field-help">
        制卡时保存资料，开团后由主持人处理学习与阅读。MP、HP、SAN 和耗时分别记录；神话技能成长会降低
        SAN 上限。
      </p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
