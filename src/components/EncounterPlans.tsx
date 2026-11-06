import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Download, Layers, Plus, Save, Trash2, Upload } from 'lucide-react';
import type { Room, RoomAction, RuleId } from '../../shared/types';
import type { DndStatBlock } from '../../shared/dnd';
import type { KeeperCard } from '../../shared/keeper';
import { getDndEdition, type DndEdition } from '../../shared/dnd-edition';
import {
  EncounterPlanSchema,
  exportEncounterPlans,
  parseEncounterPlans,
  validateEncounterPlanForRoom,
  type EncounterPlan,
} from '../../shared/preparation';
import {
  listEncounterPlans,
  saveEncounterPlans,
  deleteEncounterPlan,
} from '../preparation-storage';
import { getDndLibrary } from '../dnd-storage';
import { getKeeperLibrary } from '../keeper-storage';
import { downloadFile } from '../storage';
import { DndEditionSwitch } from './DndEditionSwitch';
import { CombatCommandStatus, useEncounterCommand } from './CombatActions';
import { Spinner } from './ui';
type Run = (a: RoomAction) => Promise<boolean>;
export function EncounterPlans({
  room,
  isHost,
  edition: initialEdition = '2014',
  run,
}: {
  room: Room | null;
  isHost: boolean;
  edition?: DndEdition;
  run: Run;
}) {
  const [plans, setPlans] = useState<EncounterPlan[]>([]),
    [cards, setCards] = useState<(DndStatBlock | KeeperCard)[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [scope, setScope] = useState<'personal' | 'room'>('personal'),
    [rule, setRule] = useState<RuleId>(room?.rule ?? 'dnd'),
    [edition, setEdition] = useState<DndEdition>(room?.dndEdition ?? initialEdition),
    [draft, setDraft] = useState<EncounterPlan | null>(null),
    [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const load = async () => {
    setLoading(true);
    try {
      const [p, d, k] = await Promise.all([
        listEncounterPlans(),
        getDndLibrary(),
        getKeeperLibrary(),
      ]);
      setPlans(p);
      setCards([...d, ...k]);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const list = (scope === 'room' ? (room?.encounterPlans ?? []) : plans).filter((p) =>
    validateEncounterPlanForRoom(p, rule, edition),
  );
  const source = [
    ...(scope === 'room' && room ? [...room.dndCards, ...room.keeperCards] : cards),
  ].filter((c) => c.rule === rule && (c.rule !== 'dnd' || getDndEdition(c.dndEdition) === edition));
  const add = () => {
    setDraft({
      documentType: 'encounter-plan',
      schemaVersion: 1,
      id: crypto.randomUUID(),
      name: '新的遭遇',
      rule,
      ...(rule === 'dnd' ? { dndEdition: edition } : {}),
      waves: [{ id: crypto.randomUUID(), name: '第一波', entries: [] }],
      notes: '',
      loot: '',
    });
    setNotice('');
  };
  const store = async (next: EncounterPlan[]) => {
    if (scope === 'personal') {
      setPlans(await saveEncounterPlans(next));
      return true;
    }
    if (!room || !isHost) return false;
    return run({
      type: 'encounter-plan-save',
      plans: next,
      expectedRevision: room.encounterPlanRevision ?? 0,
    });
  };
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      const parsed = EncounterPlanSchema.safeParse(draft);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? '请检查预案');
      if (await store([parsed.data])) {
        setDraft(null);
        setNotice('预案已保存。');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const importFile = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    setError('');
    try {
      if (f.size > 16 * 1024 * 1024) throw new Error('文件不能超过 16 MiB');
      const next = parseEncounterPlans(await f.text());
      if (
        scope === 'room' &&
        next.some((p) => !room || !validateEncounterPlanForRoom(p, room.rule, room.dndEdition))
      )
        throw new Error('预案与房间规则或版次不符');
      if (await store(next)) {
        setNotice(`已导入 ${next.length} 份预案。`);
        setRule(next[0].rule);
        if (next[0].rule === 'dnd') setEdition(getDndEdition(next[0].dndEdition));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (p: EncounterPlan) => {
    setBusy(true);
    setError('');
    try {
      if (scope === 'personal') setPlans(await deleteEncounterPlan(p.id));
      else if (room)
        await run({
          type: 'encounter-plan-delete',
          planId: p.id,
          expectedRevision: room.encounterPlanRevision ?? 0,
        });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="encounter-plans prep-stack">
      <div className="prep-section-heading">
        <div>
          <span className="mini-label">ENCOUNTER NOTES</span>
          <h2>遭遇预案</h2>
          <p>把参战者、增援波次与线索提前备好，到场时再展开。</p>
        </div>
        <Layers size={28} strokeWidth={1.3} />
      </div>
      <div className="preparation-plan-toolbar">
        <div className="segmented">
          <button
            className={scope === 'personal' ? 'selected' : ''}
            disabled={!!draft}
            onClick={() => setScope('personal')}
          >
            个人预案
          </button>
          {isHost && room && (
            <button
              className={scope === 'room' ? 'selected' : ''}
              disabled={!!draft}
              onClick={() => {
                setScope('room');
                setRule(room.rule);
                setEdition(getDndEdition(room.dndEdition));
              }}
            >
              本桌预案
            </button>
          )}
        </div>
        <div className="prep-plan-rule">
          <select
            aria-label="预案规则"
            value={rule}
            disabled={!!draft || scope === 'room'}
            onChange={(e) => setRule(e.target.value as RuleId)}
          >
            <option value="dnd">D&D 5e</option>
            <option value="coc">CoC 7</option>
          </select>
          {rule === 'dnd' && (
            <DndEditionSwitch
              value={edition}
              onChange={setEdition}
              disabled={!!draft || scope === 'room'}
            />
          )}
        </div>
      </div>
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
      {draft ? (
        <div className="prep-plan-editor">
          <div className="prep-form-grid">
            <label className="field">
              预案名称
              <input
                aria-label="预案名称"
                value={draft.name}
                maxLength={120}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            {scope === 'room' && room && (
              <label className="field">
                关联场景（可选）
                <select
                  aria-label="预案关联场景"
                  value={draft.scene ? `${draft.scene.atlasId}/${draft.scene.sceneId}` : ''}
                  onChange={(e) => {
                    const [atlasId, sceneId] = e.target.value.split('/');
                    setDraft({
                      ...draft,
                      scene: atlasId && sceneId ? { atlasId, sceneId } : undefined,
                    });
                  }}
                >
                  <option value="">不关联场景</option>
                  {room.atlases.flatMap((a) =>
                    a.scenes.map((s) => (
                      <option key={`${a.id}/${s.id}`} value={`${a.id}/${s.id}`}>
                        {a.name} · {s.title}
                      </option>
                    )),
                  )}
                </select>
              </label>
            )}
          </div>
          {draft.waves.map((wave, wi) => (
            <section className="prep-wave" key={wave.id}>
              <div className="prep-wave-heading">
                <span className="spell-rank">{String(wi + 1).padStart(2, '0')}</span>
                <input
                  aria-label={`第${wi + 1}波名称`}
                  value={wave.name}
                  maxLength={120}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      waves: draft.waves.map((w) =>
                        w === wave ? { ...w, name: e.target.value } : w,
                      ),
                    })
                  }
                />
                <button
                  className="icon-button"
                  aria-label={`删除第${wi + 1}波`}
                  disabled={draft.waves.length === 1}
                  onClick={() =>
                    setDraft({ ...draft, waves: draft.waves.filter((w) => w !== wave) })
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
              {wave.entries.map((entry) => (
                <div className="prep-wave-entry" key={entry.id}>
                  <span>
                    {entry.card.name}
                    <small>
                      {entry.card.rule === 'dnd'
                        ? `CR ${entry.card.challenge ?? '未知'}`
                        : entry.card.kind === 'npc'
                          ? 'NPC'
                          : '怪物'}
                    </small>
                  </span>
                  <label>
                    数量
                    <input
                      type="number"
                      min={1}
                      max={20}
                      aria-label={`${entry.card.name}参战数量`}
                      value={entry.count}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          waves: draft.waves.map((w) =>
                            w === wave
                              ? {
                                  ...w,
                                  entries: w.entries.map((v) =>
                                    v === entry ? { ...v, count: Number(e.target.value) } : v,
                                  ),
                                }
                              : w,
                          ),
                        })
                      }
                    />
                  </label>
                  <button
                    className="icon-button"
                    aria-label={`从波次移除${entry.card.name}`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        waves: draft.waves.map((w) =>
                          w === wave ? { ...w, entries: w.entries.filter((v) => v !== entry) } : w,
                        ),
                      })
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <select
                aria-label={`第${wi + 1}波添加资料`}
                value=""
                onChange={(e) => {
                  const card = source.find((c) => c.id === e.target.value);
                  if (card)
                    setDraft({
                      ...draft,
                      waves: draft.waves.map((w) =>
                        w === wave
                          ? {
                              ...w,
                              entries: [
                                ...w.entries,
                                { id: crypto.randomUUID(), card: structuredClone(card), count: 1 },
                              ],
                            }
                          : w,
                      ),
                    });
                }}
              >
                <option value="">从{scope === 'room' ? '房间' : '个人'}卡库加入参战者…</option>
                {source.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {!source.length && (
                <p className="subtle-note">
                  对应规则卡库还没有资料。先制作或导入 NPC / 怪物，再回到这里编排。
                </p>
              )}
            </section>
          ))}
          <button
            className="text-button"
            disabled={draft.waves.length >= 20}
            onClick={() =>
              setDraft({
                ...draft,
                waves: [
                  ...draft.waves,
                  { id: crypto.randomUUID(), name: `第 ${draft.waves.length + 1} 波`, entries: [] },
                ],
              })
            }
          >
            <Plus size={15} />
            增加波次
          </button>
          <label className="field">
            战利品与奖励
            <textarea
              rows={2}
              value={draft.loot}
              maxLength={8000}
              onChange={(e) => setDraft({ ...draft, loot: e.target.value })}
              placeholder="物品、报酬与分配提示"
            />
          </label>
          <label className="field">
            主持人笔记
            <textarea
              rows={3}
              value={draft.notes}
              maxLength={16000}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              placeholder="触发条件、战术、线索和可调整的部分"
            />
          </label>
          <div className="prep-action-row">
            <button className="button primary" disabled={busy} onClick={() => void save()}>
              <Save size={16} />
              保存预案
            </button>
            <button className="text-button" disabled={busy} onClick={() => setDraft(null)}>
              取消编辑
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="prep-action-row">
            <button className="button primary compact" disabled={busy || loading} onClick={add}>
              <Plus size={16} />
              新建预案
            </button>
            <button
              className="button secondary compact"
              disabled={busy}
              onClick={() => file.current?.click()}
            >
              <Upload size={16} />
              导入
            </button>
            <button
              className="text-button"
              disabled={!list.length || busy}
              onClick={() =>
                downloadFile(
                  exportEncounterPlans(list, 'json'),
                  `遭遇预案-${rule}-${edition}.json`,
                  'application/json',
                )
              }
            >
              <Download size={15} />
              导出当前清单
            </button>
          </div>
          {loading ? (
            <Spinner />
          ) : (
            <div className="prep-plans-list">
              {list.map((plan) => (
                <article className="prep-plan-card" key={plan.id}>
                  <div className="prep-section-heading">
                    <div>
                      <h3>{plan.name}</h3>
                      <p>
                        {plan.waves.length} 个波次 ·{' '}
                        {plan.waves.reduce(
                          (n, w) => n + w.entries.reduce((a, e) => a + e.count, 0),
                          0,
                        )}{' '}
                        位参战者
                      </p>
                    </div>
                    <span className="pill">
                      {plan.rule === 'dnd' ? `D&D ${getDndEdition(plan.dndEdition)}` : 'CoC 7'}
                    </span>
                  </div>
                  <div className="prep-plan-waves">
                    {plan.waves.map((w, i) => (
                      <div key={w.id}>
                        <span>{String(i + 1).padStart(2, '0')}</span>
                        <div>
                          <b>{w.name}</b>
                          <small>
                            {w.entries.map((e) => `${e.card.name} ×${e.count}`).join('、')}
                          </small>
                        </div>
                        {scope === 'room' && room && (
                          <PlanWaveLoader room={room} plan={plan} waveId={w.id} run={run} />
                        )}
                      </div>
                    ))}
                  </div>
                  {plan.loot && (
                    <details>
                      <summary>战利品与奖励</summary>
                      <p className="prep-preserve">{plan.loot}</p>
                    </details>
                  )}
                  {plan.notes && (
                    <details>
                      <summary>主持人笔记</summary>
                      <p className="prep-preserve">{plan.notes}</p>
                    </details>
                  )}
                  <div className="prep-action-row">
                    <button className="text-button" onClick={() => setDraft(structuredClone(plan))}>
                      编辑
                    </button>
                    <button
                      className="text-button"
                      onClick={() =>
                        downloadFile(
                          exportEncounterPlans([plan], 'md'),
                          `${plan.name}.md`,
                          'text/markdown',
                        )
                      }
                    >
                      导出 Markdown
                    </button>
                    {scope === 'personal' &&
                      room &&
                      isHost &&
                      validateEncounterPlanForRoom(plan, room.rule, room.dndEdition) && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            if (
                              await run({
                                type: 'encounter-plan-save',
                                plans: [plan],
                                expectedRevision: room.encounterPlanRevision ?? 0,
                              })
                            )
                              setNotice('已带入房间，请切换「本桌预案」载入波次。');
                            setBusy(false);
                          }}
                        >
                          <ArrowDownToLine size={15} />
                          带入房间
                        </button>
                      )}
                    {scope === 'room' && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={async () => {
                          try {
                            setPlans(await saveEncounterPlans([plan]));
                            setNotice('已存到个人预案。');
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        存到个人
                      </button>
                    )}
                    <button
                      className="icon-button"
                      aria-label={`删除预案${plan.name}`}
                      disabled={busy}
                      onClick={() => void remove(plan)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
              ))}
              {!list.length && (
                <div className="prep-empty">
                  <Layers size={30} />
                  <h3>下一场遭遇，从这里准备。</h3>
                  <p>先从卡库挑选参战者，按波次组织。个人预案可在入房前制作，也能导出备份。</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
      <input
        type="file"
        ref={file}
        hidden
        accept=".json,.md,application/json,text/markdown"
        onChange={(e) => {
          void importFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <p className="subtle-note">
        预案、未载入波次与笔记仅主持人可见。载入采用资料快照，不改变原卡库；不会替你执行战术或分配奖励。
      </p>
    </div>
  );
}
function PlanWaveLoader({
  room,
  plan,
  waveId,
  run,
}: {
  room: Room;
  plan: EncounterPlan;
  waveId: string;
  run: Run;
}) {
  const command = useEncounterCommand(room, run),
    loaded = room.encounter.loadedWaves?.some((v) => v.planId === plan.id && v.waveId === waveId),
    [confirmed, setConfirmed] = useState(false),
    [scene, setScene] = useState(false);
  return (
    <div className="prep-wave-load">
      {plan.scene && (
        <label className="prep-checkbox">
          <input type="checkbox" checked={scene} onChange={(e) => setScene(e.target.checked)} />
          同时公布场景
        </label>
      )}
      {loaded && (
        <label className="prep-checkbox">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          确认再次加入
        </label>
      )}
      <button
        className="button secondary compact"
        disabled={
          command.busy || !!command.retry || room.phase !== 'active' || (loaded && !confirmed)
        }
        onClick={async () => {
          if (
            await command.execute({
              type: 'encounter-plan-load',
              planId: plan.id,
              waveId,
              expectedRevision: room.encounter.revision,
              expectedPlanRevision: room.encounterPlanRevision ?? 0,
              requestId: crypto.randomUUID(),
              ...(loaded ? { repeat: true } : {}),
              ...(scene ? { publishScene: true } : {}),
            })
          )
            setConfirmed(false);
        }}
      >
        {loaded ? '再次载入' : '载入波次'}
      </button>
      <CombatCommandStatus command={command} />
    </div>
  );
}
