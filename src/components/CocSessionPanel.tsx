import { CocSessionCounters } from './CocSessionCounters';
import { useState } from 'react';
import { LockKeyhole, LockKeyholeOpen, Trash2 } from 'lucide-react';
import { cocSkillDefinitions } from '../../shared/coc-career';
import { effectiveCharacter } from '../../shared/adjustments';
import {
  COC_BOUTS,
  emptyCocSession,
  cocInsanityHours,
  cocBoutRounds,
  cocDevelopmentMarked,
  cocCurrentLuck,
  cocRoomRules,
  type CocRoomRules,
} from '../../shared/coc-session';
import { CocSectionHeading } from './CocInvestigator';
import { AutoValueField } from './AutoValueField';
import type { CocSessionPanelProps } from './CocMagic';

export function CocSessionPanel({
  card,
  onEdit,
  disabled,
  isHost = false,
  active = false,
  rules,
}: CocSessionPanelProps & { rules?: CocRoomRules }) {
  const session = card.cocSession ?? emptyCocSession(card),
    sanity = session.sanity;
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const send: typeof onEdit = async (edit) => {
    setError('');
    try {
      return await onEdit(edit);
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const locked = disabled || !active;
  const keeperLocked = locked || !isHost;
  const effective = effectiveCharacter(card);
  const insanity = sanity.insanity;
  return (
    <div className="coc-section">
      <CocSectionHeading title="理智与成长" eyebrow="SANITY & DEVELOPMENT" />
      <div className="allocation-summary">
        <div>
          <span>当前 SAN</span>
          <strong>
            {card.san}
            <small> / {card.maxSan}</small>
          </strong>
        </div>
        <div>
          <span>游戏日 {sanity.day} · 累计损失</span>
          <strong>
            {sanity.lostToday}
            <small> / {Math.ceil(sanity.dayStartSan / 5)}</small>
          </strong>
          <small>日初 SAN {sanity.dayStartSan} 的五分之一</small>
        </div>
        <div>
          <span>当前幸运</span>
          <strong>{cocCurrentLuck(effective)}</strong>
          <small>初始幸运 {card.attributes.luck}</small>
        </div>
      </div>
      {isHost && <CocSessionCounters card={card} onEdit={send} disabled={keeperLocked} />}
      <section className="coc-subsection">
        <h4>理智检定</h4>
        <form
          className="coc-inline-fields"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void send({
              kind: 'sanity-roll',
              successLoss: String(f.get('success')),
              failureLoss: String(f.get('failure')),
              reason: String(f.get('reason')),
              visibility: f.get('visibility') as 'public' | 'host',
              ...(f.get('source')
                ? { source: { name: String(f.get('source')), limit: Number(f.get('limit')) } }
                : {}),
            });
          }}
        >
          <label className="field">
            成功损失
            <input
              name="success"
              defaultValue="0"
              maxLength={120}
              required
              disabled={locked || !!sanity.pending}
            />
          </label>
          <label className="field">
            失败损失
            <input
              name="failure"
              defaultValue="1d6"
              maxLength={120}
              required
              disabled={locked || !!sanity.pending}
            />
          </label>
          <label className="field">
            原因
            <input
              name="reason"
              required
              maxLength={300}
              placeholder="遭遇的事件或生物"
              disabled={locked || !!sanity.pending}
            />
          </label>
          <label className="field">
            可见范围
            <select name="visibility" disabled={locked || !!sanity.pending}>
              <option value="public">所有人</option>
              {isHost && <option value="host">仅主持人</option>}
            </select>
          </label>
          <details className="coc-form-details">
            <summary>同类恐怖来源的损失上限</summary>
            <label className="field">
              来源名称
              <input
                name="source"
                maxLength={120}
                disabled={locked || !!sanity.pending}
                placeholder="同一类生物或事件"
              />
            </label>
            <label className="field">
              累计损失上限
              <input
                name="limit"
                type="number"
                min={0}
                max={100}
                defaultValue={6}
                disabled={locked || !!sanity.pending}
              />
            </label>
          </details>
          <button type="submit" className="button primary" disabled={locked || !!sanity.pending}>
            投掷理智检定
          </button>
        </form>
        {sanity.pending && (
          <div className="coc-record coc-status-note">
            <h4>待结算理智损失</h4>
            <p>
              {sanity.pending.reason} · {sanity.pending.roll} / {sanity.pending.san} ·{' '}
              {sanity.pending.success ? '成功' : '失败'} · SAN −{sanity.pending.loss}
            </p>
            <div className="coc-actions">
              <button
                type="button"
                className="button primary"
                disabled={keeperLocked}
                onClick={() =>
                  void send({
                    kind: 'sanity-confirm',
                    pendingId: sanity.pending!.id,
                    confirmed: true,
                  })
                }
              >
                {cocRoomRules(rules).autoSanity ? '结算 SAN 与疯狂' : '结算 SAN 损失'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={keeperLocked}
                onClick={() =>
                  void send({
                    kind: 'sanity-confirm',
                    pendingId: sanity.pending!.id,
                    confirmed: true,
                    automatic: false,
                  })
                }
              >
                只扣 SAN，手动判定疯狂
              </button>
              <button
                type="button"
                className="text-button"
                disabled={keeperLocked}
                onClick={() => void send({ kind: 'sanity-cancel', pendingId: sanity.pending!.id })}
              >
                取消
              </button>
            </div>
          </div>
        )}
        <p className="field-help">
          单次损失至少 5 点时进行智力检定，成功可能进入临时性疯狂；同一游戏日累计损失达到日初 SAN
          的五分之一时进入不定性疯狂。游戏日由推进时间决定。
        </p>
      </section>
      <section className="coc-subsection">
        <h4>精神状态</h4>
        {insanity ? (
          <article className="coc-record">
            <div className="coc-record-title">
              <strong>
                {
                  (
                    {
                      temporary: '临时性疯狂',
                      indefinite: '不定性疯狂',
                      permanent: '永久性疯狂',
                    } as const
                  )[insanity.kind]
                }
              </strong>
              {isHost && (
                <button
                  type="button"
                  className="text-button"
                  disabled={keeperLocked}
                  onClick={() =>
                    void send({
                      kind: 'insanity-stop',
                      scope: 'insanity',
                      reason: '主持人确认状态结束',
                      confirmed: true,
                    })
                  }
                >
                  结束状态
                </button>
              )}
            </div>
            <p className="coc-description">{insanity.reason}</p>
            <div className="auto-value-grid">
              {insanity.hours !== undefined && (
                <AutoValueField
                  label="疯狂持续时间（小时）"
                  automatic={insanity.hours}
                  control={insanity.hoursControl}
                  disabled={keeperLocked}
                  min={1}
                  max={1000}
                  source={`剩余 ${Math.max(0, Math.ceil(cocInsanityHours(insanity) * 60 - (session.gameMinutes - insanity.startedMinute)))} 分钟`}
                  onEdit={(control) =>
                    send({ kind: 'insanity-duration-control', field: 'hours', control })
                  }
                />
              )}
              {insanity.bout && (
                <AutoValueField
                  label="疯狂发作时间（轮）"
                  automatic={insanity.bout.rounds}
                  control={insanity.bout.roundsControl}
                  disabled={keeperLocked}
                  min={1}
                  max={1000}
                  source={`剩余 ${Math.max(0, cocBoutRounds(insanity.bout) - (session.gameRound - insanity.bout.startedRound))} 轮`}
                  onEdit={(control) =>
                    send({ kind: 'insanity-duration-control', field: 'rounds', control })
                  }
                />
              )}
            </div>
            {insanity.bout && (
              <>
                <p>
                  {COC_BOUTS.find((b) => b.key === insanity.bout!.kind)?.label} ·{' '}
                  {insanity.bout.description}
                </p>
                <button
                  type="button"
                  className="text-button"
                  disabled={keeperLocked}
                  onClick={() =>
                    void send({
                      kind: 'insanity-stop',
                      scope: 'bout',
                      reason: '主持人确认发作结束',
                      confirmed: true,
                    })
                  }
                >
                  结束本次发作
                </button>
              </>
            )}
          </article>
        ) : (
          <p className="coc-empty">暂无疯狂状态</p>
        )}
        {isHost && (
          <details>
            <summary>主持人裁定</summary>
            <form
              className="coc-inline-fields"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void send({
                  kind: 'insanity-set',
                  state: f.get('state') as 'temporary' | 'indefinite' | 'permanent',
                  reason: String(f.get('reason')),
                  bout: {
                    kind: f.get('bout') as (typeof COC_BOUTS)[number]['key'],
                    description: String(f.get('description')),
                  },
                });
              }}
            >
              <label className="field">
                状态
                <select name="state" disabled={keeperLocked}>
                  <option value="temporary">临时性疯狂</option>
                  <option value="indefinite">不定性疯狂</option>
                  <option value="permanent">永久性疯狂</option>
                </select>
              </label>
              <label className="field">
                发作类型
                <select name="bout" disabled={keeperLocked}>
                  {COC_BOUTS.map((b) => (
                    <option value={b.key} key={b.key}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                判定原因
                <input name="reason" required maxLength={300} disabled={keeperLocked} />
              </label>
              <label className="field">
                发作表现
                <input name="description" maxLength={500} disabled={keeperLocked} />
              </label>
              <button type="submit" className="button secondary" disabled={keeperLocked}>
                保存精神状态
              </button>
            </form>
          </details>
        )}
        <div className="coc-record-list">
          {sanity.conditions.map((c) => (
            <div className="coc-record-title coc-record" key={c.id}>
              <span>
                {c.kind === 'phobia' ? '恐惧症' : '躁狂症'} · {c.description}
              </span>
              <button
                type="button"
                className="icon-button small"
                aria-label={`移除${c.description}`}
                disabled={keeperLocked}
                onClick={() => void send({ kind: 'insanity-condition-remove', conditionId: c.id })}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        {isHost && (
          <form
            className="coc-inline-fields"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void send({
                kind: 'insanity-condition-add',
                condition: f.get('condition') as 'phobia' | 'mania',
                description: String(f.get('description')),
              });
            }}
          >
            <label className="field">
              症状
              <select name="condition" disabled={keeperLocked}>
                <option value="phobia">恐惧症</option>
                <option value="mania">躁狂症</option>
              </select>
            </label>
            <label className="field">
              描述
              <input name="description" required maxLength={300} disabled={keeperLocked} />
            </label>
            <button type="submit" className="button secondary" disabled={keeperLocked}>
              添加症状
            </button>
          </form>
        )}
      </section>
      <section className="coc-subsection">
        <h4>技能成长</h4>
        <p className="field-help">
          成功使用技能可自动留下成长标记；幸运修改后的检定、孤注一掷，以及信用评级和克苏鲁神话不产生普通成长标记。幕间由主持人统一结算，成长不消耗制卡点数。
        </p>
        <label className="field">
          查找技能
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="技能名称" />
        </label>
        <div className="coc-development-grid">
          {cocSkillDefinitions(card)
            .filter(
              (s) => !['creditRating', 'cthulhuMythos'].includes(s.key) && s.label.includes(query),
            )
            .map((s) => {
              const mark = session.development.marks.find((m) => m.key === s.key);
              const marked = mark ? cocDevelopmentMarked(mark) : false;
              const isLocked = mark?.locked ?? true;
              return (
                <div className="coc-development-row" key={s.key}>
                  <label>
                    <input
                      type="checkbox"
                      checked={marked}
                      disabled={keeperLocked || isLocked || mark?.mode !== 'manual'}
                      onChange={(e) =>
                        void send({
                          kind: 'development-mark',
                          key: s.key,
                          marked: e.target.checked,
                        })
                      }
                    />
                    <span>
                      {s.label}
                      <small>{effective.skills[s.key] ?? s.base}%</small>
                    </span>
                  </label>
                  <select
                    aria-label={`${s.label}成长标记方式`}
                    value={mark?.mode ?? 'auto'}
                    disabled={keeperLocked || isLocked}
                    onChange={(e) =>
                      void send({
                        kind: 'development-mark',
                        key: s.key,
                        marked: e.target.value === 'auto' ? null : (mark?.manual ?? marked),
                      })
                    }
                  >
                    <option value="auto">自动</option>
                    <option value="manual">手动</option>
                  </select>
                  <button
                    type="button"
                    className="value-lock"
                    aria-label={`${isLocked ? '解锁' : '锁定'}${s.label}成长标记`}
                    aria-pressed={isLocked}
                    disabled={keeperLocked}
                    onClick={() =>
                      void send({ kind: 'development-lock', key: s.key, locked: !isLocked })
                    }
                  >
                    {isLocked ? <LockKeyhole size={14} /> : <LockKeyholeOpen size={14} />}
                  </button>
                </div>
              );
            })}
        </div>
        {isHost && (
          <form
            className="coc-inline-fields"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void send({
                kind: 'development-roll',
                label: String(f.get('label')),
                confirmed: true,
              });
            }}
          >
            <label className="field">
              本次成长备注
              <input
                name="label"
                required
                maxLength={300}
                placeholder="本章结束"
                disabled={keeperLocked}
              />
            </label>
            <button
              type="submit"
              className="button primary"
              disabled={keeperLocked || !session.development.marks.some(cocDevelopmentMarked)}
            >
              结算已标记技能
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={keeperLocked}
              onClick={() => void send({ kind: 'luck-recover', confirmed: true })}
            >
              幕间幸运恢复
            </button>
          </form>
        )}
        {session.development.batches.length > 0 && (
          <details>
            <summary>成长记录</summary>
            {[...session.development.batches].reverse().map((batch) => (
              <article className="coc-record" key={batch.id}>
                <h4>{batch.label}</h4>
                <p>
                  {batch.results
                    .map(
                      (r) =>
                        `${cocSkillDefinitions(card).find((s) => s.key === r.key)?.label ?? r.key} ${r.roll} / ${r.value} → +${r.gain}${r.sanityGain ? `（SAN +${r.sanityGain}）` : ''}`,
                    )
                    .join('；')}
                </p>
              </article>
            ))}
          </details>
        )}
      </section>
      {isHost && (
        <section className="coc-subsection">
          <h4>时间与恢复</h4>
          <p className="field-help">
            当前累计 {session.gameMinutes} 分钟、{session.gameRound}{' '}
            轮。推进的是游戏时间；自然恢复与伤势按所选方式结算。
          </p>
          <form
            className="coc-inline-fields"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void send({
                kind: 'advance-time',
                minutes: Number(f.get('minutes')),
                rounds: Number(f.get('rounds')),
                recovery: f.get('recovery') as 'natural' | 'none',
                reason: String(f.get('reason')),
                confirmed: true,
              });
            }}
          >
            <label className="field">
              推进分钟
              <input
                name="minutes"
                type="number"
                min={0}
                max={5256000}
                defaultValue={60}
                required
                disabled={keeperLocked}
              />
            </label>
            <label className="field">
              推进轮数
              <input
                name="rounds"
                type="number"
                min={0}
                max={100000}
                defaultValue={0}
                required
                disabled={keeperLocked}
              />
            </label>
            <label className="field">
              自然恢复
              <select name="recovery" disabled={keeperLocked}>
                <option value="natural">结算 HP / MP 恢复</option>
                <option value="none">不结算资源恢复</option>
              </select>
            </label>
            <label className="field">
              原因
              <input
                name="reason"
                required
                maxLength={300}
                disabled={keeperLocked}
                placeholder="休息或旅途"
              />
            </label>
            <button type="submit" className="button secondary" disabled={keeperLocked}>
              推进时间
            </button>
          </form>
          <form
            className="coc-inline-fields"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void send({
                kind: 'sanity-treatment',
                method: f.get('method') as
                  'keeper' | 'therapy-success' | 'therapy-failure' | 'therapy-fumble',
                points: Number(f.get('points')),
                reason: String(f.get('reason')),
                confirmed: true,
              });
            }}
          >
            <label className="field">
              SAN 恢复方式
              <select name="method" disabled={keeperLocked}>
                <option value="keeper">主持人指定恢复值</option>
                <option value="therapy-success">治疗成功 · 1d3</option>
                <option value="therapy-failure">治疗失败 · 无恢复</option>
                <option value="therapy-fumble">治疗大失败 · −1d6</option>
              </select>
            </label>
            <label className="field">
              指定恢复值
              <input
                name="points"
                type="number"
                min={0}
                max={100}
                defaultValue={0}
                disabled={keeperLocked}
              />
            </label>
            <label className="field">
              治疗或恢复原因
              <input name="reason" required maxLength={300} disabled={keeperLocked} />
            </label>
            <button type="submit" className="button secondary" disabled={keeperLocked}>
              结算 SAN 恢复
            </button>
          </form>
          <form
            className="coc-inline-fields"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void send({
                kind: 'mythos-gain',
                points: Number(f.get('points')),
                source: String(f.get('source')),
                confirmed: true,
              });
            }}
          >
            <label className="field">
              神话成长
              <input
                name="points"
                type="number"
                min={1}
                max={99}
                defaultValue={1}
                required
                disabled={keeperLocked}
              />
            </label>
            <label className="field">
              来源
              <input name="source" required maxLength={300} disabled={keeperLocked} />
            </label>
            <button type="submit" className="button secondary" disabled={keeperLocked}>
              记录神话成长
            </button>
          </form>
        </section>
      )}
      {!!session.history.length && (
        <details>
          <summary>调查记录</summary>
          {[...session.history].reverse().map((entry) => (
            <article className="coc-record" key={entry.id}>
              <p>{entry.summary}</p>
              <small className="field-help">{new Date(entry.at).toLocaleString()}</small>
            </article>
          ))}
        </details>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
