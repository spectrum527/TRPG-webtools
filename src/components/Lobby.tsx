import { effectiveCharacter } from '../../shared/adjustments';
import { MAX_ARCHIVE_BYTES, type ArchiveSummary } from '../../shared/archive';
import { inspectArchive } from '../api';
import { ArchiveSummaryView } from './ArchiveSummary';
import { parseRoomConfig, MAX_ROOM_CONFIG_BYTES, type RoomConfig } from '../../shared/room-config';
import { ConfigurationSummary } from './RoomConfiguration';
import { useRef, useState, type FormEvent } from 'react';
import {
  ArrowUpRight,
  ArrowLeft,
  Plus,
  LogIn,
  Upload,
  BookOpen,
  Users,
  Sparkles,
  Check,
  MessageSquare,
  Headphones,
  FileText,
  MoreHorizontal,
  Trash2,
  Download,
  Eye,
} from 'lucide-react';
import type {
  Character,
  CreateRoomInput,
  JoinRoomInput,
  RuleId,
  RoomMode,
} from '../../shared/types';
import { exportCharacter, parseCharacter } from '../../shared/rules';
import { readStored, writeStored, downloadFile } from '../storage';
import { DieIcon, Spinner, Modal, ruleName, ruleEdition } from './ui';
import { getDndEdition, type DndEdition } from '../../shared/dnd-edition';
import { DndEditionSwitch } from './DndEditionSwitch';
import { version as appVersion } from '../../package.json';

export function RuleSelection({
  dndEdition,
  onDndEditionChange,
  onSelect,
  onRules,
  onLibrary,
}: {
  dndEdition: DndEdition;
  onDndEditionChange: (edition: DndEdition) => void;
  onSelect: (rule: RuleId) => void;
  onRules: (rule: RuleId) => void;
  onLibrary: () => void;
}) {
  return (
    <div className="welcome page-enter">
      <div className="section-eyebrow">
        <span className="tiny-dash" /> YOUR NEXT CHAPTER
      </div>
      <div className="welcome-heading">
        <div>
          <h1>请选择规则框架</h1>
        </div>
        <span className="step-indicator">
          <span className="step-current">01 选择规则</span>
          <span className="step-line" />
          <span>02 入席</span>
        </span>
      </div>
      <div className="rule-grid">
        <RuleCard
          rule="dnd"
          onSelect={onSelect}
          onRules={onRules}
          dndEdition={dndEdition}
          onDndEditionChange={onDndEditionChange}
        />
        <RuleCard rule="coc" onSelect={onSelect} onRules={onRules} />
      </div>
      <div className="welcome-bottom">
        <button className="text-button" onClick={onLibrary}>
          <FileText size={16} /> 整理我的角色档案 <ArrowUpRight size={16} />
        </button>
      </div>
      <footer className="welcome-footer" aria-label="版本与作者">
        <span>版本：v{appVersion}</span>
        <span>作者：Liino/Alex9125</span>
      </footer>
    </div>
  );
}
function RuleCard({
  dndEdition = '2014',
  onDndEditionChange,
  rule,
  onSelect,
  onRules,
}: {
  dndEdition?: DndEdition;
  onDndEditionChange?: (edition: DndEdition) => void;
  rule: RuleId;
  onSelect: (rule: RuleId) => void;
  onRules: (rule: RuleId) => void;
}) {
  const dnd = rule === 'dnd';
  return (
    <article className={`rule-card ${rule}`}>
      <div className="rule-art" aria-hidden="true">
        <div className="art-orbit orbit-one" />
        <div className="art-orbit orbit-two" />
        <div className="art-orbit orbit-three" />
        <div className="rule-symbol">
          {dnd ? <DieIcon size={192} /> : <Eye size={175} strokeWidth={0.55} />}
        </div>
        <span className="art-spark spark-one">+</span>
        <span className="art-spark spark-two">+</span>
        <span className="art-coordinate">
          {dnd ? 'D20 / A WORLD OF POSSIBILITY' : 'D100 / INTO THE UNKNOWN'}
        </span>
      </div>
      <div className="rule-card-top">
        <div className="rule-version-heading">
          <span className="rule-edition">{dnd ? 'D&D 5e' : 'CoC 7th'}</span>
          {dnd && onDndEditionChange && (
            <DndEditionSwitch compact value={dndEdition} onChange={onDndEditionChange} />
          )}
        </div>
        <button
          onClick={() => onRules(rule)}
          className="rule-info"
          aria-label={`查看${ruleName(rule)}规则`}
        >
          <BookOpen size={17} />
        </button>
      </div>
      <div className="rule-card-copy">
        <span className="rule-kicker">{dnd ? '剑与魔法，自由冒险' : '寻觅线索，直面未知'}</span>
        <h2>
          {dnd ? (
            <>
              Dungeons
              <br />
              <em>&</em> Dragons
            </>
          ) : (
            <>
              Call of
              <br />
              Cthulhu
            </>
          )}
        </h2>
        <div className="rule-chinese">{ruleName(rule)}</div>
        <p>
          {dnd ? '使用 D20 检定，管理角色、法术与装备。' : '使用 D100 检定，管理属性、技能与理智。'}
        </p>
      </div>
      <button className="rule-choose" onClick={() => onSelect(rule)}>
        <span>选择此规则</span>
        <span className="round-arrow">
          <ArrowUpRight size={21} />
        </span>
      </button>
    </article>
  );
}

export function Gateway({
  rule,
  dndEdition,
  onDndEditionChange,
  onBack,
  onCreate,
  onRestore,
  onJoin,
}: {
  rule: RuleId;
  dndEdition: DndEdition;
  onDndEditionChange: (edition: DndEdition) => void;
  onBack: () => void;
  onCreate: (input: CreateRoomInput) => Promise<void>;
  onRestore: (file: File, nickname: string) => Promise<void>;
  onJoin: (input: JoinRoomInput) => Promise<void>;
}) {
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [nickname, setNickname] = useState(readStored<string>('interlude-nickname', ''));
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [seatCode, setSeatCode] = useState('');
  const [archive, setArchive] = useState<{ file: File; summary: ArchiveSummary } | null>(null);
  const archiveFile = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<RoomMode>('in-room');
  const [configuration, setConfiguration] = useState<RoomConfig | null>(null);
  const configFile = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (tab === 'create' && rule === 'dnd' && (configuration || archive)) {
        const edition = getDndEdition(archive?.summary.dndEdition ?? configuration?.dndEdition);
        if (edition !== dndEdition)
          throw new Error(`文件使用 D&D ${edition}，请先切换到相同版本。`);
      }
      writeStored('interlude-nickname', nickname.trim());
      if (tab === 'create' && archive) await onRestore(archive.file, nickname.trim());
      else if (tab === 'create')
        await onCreate({
          name: name.trim(),
          nickname: nickname.trim(),
          rule,
          ...(rule === 'dnd' ? { dndEdition } : {}),
          mode,
          ...(configuration
            ? { configuration: { ...configuration, name: name.trim(), mode } }
            : {}),
        });
      else
        await onJoin({
          code: code.trim().toUpperCase(),
          nickname: nickname.trim(),
          rule,
          ...(rule === 'dnd' ? { dndEdition } : {}),
          ...(seatCode ? { seatCode } : {}),
        });
    } catch (e) {
      setError(e instanceof Error ? e.message : '连接失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="gateway page-enter">
      <button className="text-button back-button" onClick={onBack}>
        <ArrowLeft size={17} /> 返回选择规则
      </button>
      <div className="gateway-grid">
        <div className={`gateway-intro ${rule}`}>
          <div className="section-eyebrow">{ruleEdition(rule, dndEdition)}</div>
          {rule === 'dnd' && <DndEditionSwitch value={dndEdition} onChange={onDndEditionChange} />}
          <h1>创建或加入房间</h1>
          <PreviewTable />
        </div>
        <div className="gateway-form">
          <div className="gateway-rule">
            <span className={`rule-dot ${rule}`} /> {ruleName(rule)}
            <span className="muted">{rule === 'dnd' ? `5e · ${dndEdition}` : '第 7 版'}</span>
          </div>
          <div className="segmented">
            <button
              className={tab === 'create' ? 'selected' : ''}
              onClick={() => {
                setTab('create');
                setError('');
              }}
            >
              <Plus size={17} /> 创建房间
            </button>
            <button
              className={tab === 'join' ? 'selected' : ''}
              onClick={() => {
                setTab('join');
                setError('');
              }}
            >
              <LogIn size={17} /> 加入房间
            </button>
          </div>
          <form onSubmit={submit}>
            <label className="field">
              你的称呼
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="让同伴知道怎么称呼你"
                required
                maxLength={20}
                autoComplete="nickname"
              />
            </label>
            {tab === 'create' ? (
              <>
                <div className="gateway-archive">
                  <button
                    className="button secondary full compact"
                    type="button"
                    disabled={busy}
                    onClick={() => archiveFile.current?.click()}
                  >
                    <Upload size={16} /> 从全局存档续团
                  </button>
                  <input
                    ref={archiveFile}
                    className="visually-hidden"
                    type="file"
                    accept=".zip"
                    aria-label="全局存档文件"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setBusy(true);
                      setError('');
                      try {
                        if (file.size > MAX_ARCHIVE_BYTES) throw new Error('存档不能超过 32 MiB。');
                        const summary = await inspectArchive(file);
                        if (summary.rule !== rule)
                          throw new Error('存档规则与所选规则不匹配，请返回选择对应规则。');
                        setArchive({ file, summary });
                        setConfiguration(null);
                        setName(summary.name);
                      } catch (err) {
                        setError((err as Error).message);
                      } finally {
                        setBusy(false);
                        if (archiveFile.current) archiveFile.current.value = '';
                      }
                    }}
                  />
                  {archive && (
                    <div className="gateway-archive-preview">
                      <b>{archive.summary.name}</b>
                      <small>已载入：{archive.file.name}</small>
                      <p>保存于 {new Date(archive.summary.exportedAt).toLocaleString('zh-CN')}</p>
                      <ArchiveSummaryView value={archive.summary} />
                      <p>将创建新房间并恢复原阶段。稍后向每位玩家分发各自的席位恢复码。</p>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => setArchive(null)}
                      >
                        移除存档，创建新故事
                      </button>
                    </div>
                  )}
                </div>
                {!archive && (
                  <div className="gateway-config">
                    <button
                      className="text-button"
                      type="button"
                      disabled={busy}
                      onClick={() => configFile.current?.click()}
                    >
                      <Upload size={15} />
                      从配置文件创建
                    </button>
                    <input
                      ref={configFile}
                      className="visually-hidden"
                      type="file"
                      accept=".json,.md,.markdown"
                      aria-label="新房间配置文件"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          if (file.size > MAX_ROOM_CONFIG_BYTES)
                            throw new Error('房间配置不能超过 128 KiB。');
                          const config = parseRoomConfig(await file.text());
                          if (config.rule !== rule)
                            throw new Error('配置规则与所选规则不匹配，请返回选择对应规则。');
                          setConfiguration(config);
                          setArchive(null);
                          setName(config.name);
                          setMode(config.mode);
                          setError('');
                        } catch (err) {
                          setError((err as Error).message);
                        } finally {
                          if (configFile.current) configFile.current.value = '';
                        }
                      }}
                    />
                    {configuration && (
                      <>
                        <details>
                          <summary>已载入配置：{configuration.name}</summary>
                          <ConfigurationSummary value={{ ...configuration, name, mode }} />
                        </details>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setConfiguration(null)}
                        >
                          移除配置，使用默认制卡要求
                        </button>
                      </>
                    )}
                  </div>
                )}
                <label className="field">
                  房间名称
                  <input
                    value={name}
                    disabled={!!archive}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={rule === 'dnd' ? '例如：雾港的来信' : '例如：钟声响起之前'}
                    required
                    maxLength={60}
                  />
                </label>
                {!archive && (
                  <fieldset className="mode-field">
                    <legend>跑团方式</legend>
                    <button
                      type="button"
                      aria-pressed={mode === 'in-room'}
                      className={`mode-option ${mode === 'in-room' ? 'selected' : ''}`}
                      onClick={() => setMode('in-room')}
                    >
                      <MessageSquare size={20} />
                      <span>
                        <b>房间内文字跑团</b>
                        <small>文字叙事、公共记录和主持人灵感小窗</small>
                      </span>
                      <span className="radio-mark">
                        {mode === 'in-room' && <Check size={12} />}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-pressed={mode === 'external'}
                      className={`mode-option ${mode === 'external' ? 'selected' : ''}`}
                      onClick={() => setMode('external')}
                    >
                      <Headphones size={20} />
                      <span>
                        <b>外部跑团</b>
                        <small>线下或语音跑团，这里专注制卡与掷骰</small>
                      </span>
                      <span className="radio-mark">
                        {mode === 'external' && <Check size={12} />}
                      </span>
                    </button>
                  </fieldset>
                )}
              </>
            ) : (
              <>
                <label className="field">
                  房间码
                  <input
                    className="room-code-input"
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                    }
                    placeholder="6 位房间码"
                    required
                    minLength={6}
                    maxLength={6}
                    autoComplete="off"
                  />
                </label>
                <label className="field">
                  席位恢复码（续团时填写）
                  <input
                    value={seatCode}
                    onChange={(e) =>
                      setSeatCode(e.target.value.toUpperCase().replace(/[^A-F0-9]/g, ''))
                    }
                    placeholder="由主持人提供，普通新玩家留空"
                    maxLength={16}
                    minLength={16}
                    autoComplete="off"
                  />
                  <small>恢复原角色、资源和行动状态；每个恢复码只可用一次。</small>
                </label>
                <div className="form-note">
                  <Users size={20} />
                  <p>
                    向主持人索取房间码。
                    <br />
                    请确保你与房间选择了同一套规则。
                  </p>
                </div>
              </>
            )}
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary full" disabled={busy} type="submit">
              {busy ? <Spinner /> : tab === 'create' ? <Plus size={18} /> : <LogIn size={18} />}
              {busy
                ? '正在连接…'
                : tab === 'create'
                  ? archive
                    ? '恢复存档，继续故事'
                    : '创建房间，成为主持人'
                  : '加入房间'}
            </button>
            <p className="form-footnote">无需注册 · 使用本浏览器可自动重回房间</p>
          </form>
        </div>
      </div>
    </div>
  );
}
function PreviewTable() {
  return (
    <div className="preview-table" aria-label="圆桌席位示意">
      <div className="preview-glass">
        <DieIcon size={60} />
        <span>TAKE A SEAT</span>
      </div>
      {[0, 1, 2, 3].map((n) => (
        <div className={`preview-seat seat-${n}`} key={n}>
          <span>{n === 0 ? <Sparkles size={17} /> : <Users size={16} />}</span>
          <small>{n === 0 ? '主持人' : '玩家席'}</small>
        </div>
      ))}
    </div>
  );
}

export function Library({
  cards,
  dndEdition,
  onDndEditionChange,
  onCreate,
  onEdit,
  onImport,
  onDelete,
}: {
  cards: Character[];
  dndEdition: DndEdition;
  onDndEditionChange: (edition: DndEdition) => void;
  onCreate: (rule: RuleId) => void;
  onEdit: (card: Character) => void;
  onImport: (card: Character) => void;
  onDelete: (id: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | RuleId>('all');
  const [newCard, setNewCard] = useState(false);
  const [removing, setRemoving] = useState<Character | null>(null);
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('角色卡文件不能超过 1 MiB。');
      onImport(parseCharacter(await file.text()));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const filtered = cards.filter((c) => filter === 'all' || c.rule === filter);
  return (
    <div className="library page-enter">
      <div className="section-eyebrow">CHARACTER ARCHIVE</div>
      <div className="page-heading">
        <div>
          <h1>角色档案馆</h1>
        </div>
        <div className="button-row">
          <button className="button secondary" onClick={() => fileRef.current?.click()}>
            <Upload size={17} /> 导入角色卡
          </button>
          <button className="button primary" onClick={() => setNewCard(true)}>
            <Plus size={17} /> 新建角色
          </button>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".json,.md,.markdown,application/json,text/markdown"
        className="visually-hidden"
        aria-label="导入角色文件"
        onChange={(e) => void importFile(e.target.files?.[0])}
      />
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="library-filter">
        <div className="tabs">
          {(['all', 'dnd', 'coc'] as const).map((v) => (
            <button key={v} className={filter === v ? 'active' : ''} onClick={() => setFilter(v)}>
              {v === 'all' ? '全部角色' : v === 'dnd' ? 'D&D' : 'CoC'}
            </button>
          ))}
        </div>
        <span>{filtered.length} 位角色</span>
      </div>
      {filtered.length ? (
        <div className="character-grid">
          {filtered.map((card) => (
            <article key={card.id} className="character-card">
              <div className="character-card-top">
                <span className={`character-avatar ${card.rule}`}>
                  {card.name.slice(0, 1) || '?'}
                </span>
                <span className="pill">{ruleEdition(card.rule, card.dndEdition)}</span>
              </div>
              <h2>{card.name}</h2>
              <p>
                {card.ancestry && `${card.ancestry} · `}
                {card.occupation}
                {card.rule === 'dnd' && ` · Lv.${card.level}`}
              </p>
              <div className="character-card-stats">
                <span>
                  <small>生命</small>
                  {card.hp}
                  <em> / {card.maxHp}</em>
                </span>
                <span>
                  <small>{card.rule === 'dnd' ? '护甲等级' : '理智'}</small>
                  {card.rule === 'dnd' ? effectiveCharacter(card).ac : card.san}
                </span>
                <span>
                  <small>物品</small>
                  {card.items.length}
                </span>
              </div>
              <div className="character-card-bottom">
                <button className="text-button" onClick={() => onEdit(card)}>
                  打开角色卡 <ArrowUpRight size={15} />
                </button>
                <div>
                  <button
                    className="icon-button"
                    aria-label={`导出${card.name}`}
                    onClick={() =>
                      downloadFile(
                        exportCharacter(card, 'json'),
                        `${card.name}.json`,
                        'application/json',
                      )
                    }
                  >
                    <Download size={16} />
                  </button>
                  <button
                    className="icon-button danger-text"
                    aria-label={`删除${card.name}`}
                    onClick={() => setRemoving(card)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-library">
          <span className="empty-icon">
            <FileText size={35} strokeWidth={1} />
          </span>
          <h2>暂无角色</h2>
          <p>从一张新角色卡开始，或导入之前导出的 JSON / Markdown 文件。</p>
          <button className="button primary" onClick={() => setNewCard(true)}>
            <Plus size={16} /> 创造第一个角色
          </button>
        </div>
      )}
      <div className="library-tip">
        <FileText size={18} />
        <p>角色档案存储在当前浏览器。离开这台设备前，记得导出一份 JSON 或 Markdown 备份。</p>
      </div>
      {newCard && (
        <Modal title="选择角色规则" onClose={() => setNewCard(false)}>
          <div className="new-character-edition">
            <span>D&D 规则版本</span>
            <DndEditionSwitch value={dndEdition} onChange={onDndEditionChange} />
          </div>
          <div className="new-character-options">
            {(['dnd', 'coc'] as const).map((rule) => (
              <button
                key={rule}
                className={`new-character-option ${rule}`}
                onClick={() => {
                  setNewCard(false);
                  onCreate(rule);
                }}
              >
                <DieIcon size={40} />
                <span>
                  <b>{ruleName(rule)}</b>
                  <small>{ruleEdition(rule, dndEdition)}</small>
                </span>
                <Plus size={20} />
              </button>
            ))}
          </div>
        </Modal>
      )}
      {removing && (
        <Modal
          title="移除这份角色档案？"
          onClose={() => setRemoving(null)}
          footer={
            <>
              <button className="button secondary" onClick={() => setRemoving(null)}>
                保留
              </button>
              <button
                className="button danger"
                onClick={() => {
                  onDelete(removing.id);
                  setRemoving(null);
                }}
              >
                移除档案
              </button>
            </>
          }
        >
          <p>将从此浏览器中移除「{removing.name}」。已导出的文件和房间内的角色不受影响。</p>
        </Modal>
      )}
    </div>
  );
}

export function RulesModal({
  rule,
  dndEdition = '2014',
  onClose,
}: {
  rule: RuleId;
  dndEdition?: DndEdition;
  onClose: () => void;
}) {
  const dnd = rule === 'dnd';
  return (
    <Modal
      title={`${ruleName(rule)} · 规则速览`}
      subtitle={ruleEdition(rule, dndEdition)}
      onClose={onClose}
      className="rules-modal"
    >
      <div className="rules-intro">
        <DieIcon size={50} />
        <p>
          {dnd
            ? '《龙与地下城》是奇幻冒险类的跑团规则，靠掷二十面骰（D20）判定行动成败。你可以在这里填写角色卡、计算基础数值，跑团时的具体行动由主持人（DM）和玩家共同裁定。'
            : '《克苏鲁的呼唤》主打调查与悬疑，检定使用百分骰（D100）。本站用来记录角色的属性、技能与理智，故事中的谜团由守密人（KP）在跑团中揭晓。'}
        </p>
      </div>
      <div className="rules-sections">
        <section>
          <span className="mini-label">角色创建</span>
          <h3>{dnd ? '掷骰生成六项基础属性' : '八项基础属性与幸运值'}</h3>
          <p>
            {dnd
              ? dndEdition === '2024'
                ? '每项属性掷四颗六面骰（4D6），去掉最低一颗后相加，可不限次数重掷。新版属性加值来自背景，填写最终属性时请一并计入；属性调整值按（属性值 − 10）÷ 2 计算，结果向下取整。职业特性、生命上限与护甲由你核对填写。'
                : '每项属性掷四颗六面骰（4D6），去掉最低一颗后相加，可不限次数重掷。请将种族带来的属性加值算入最终属性；属性调整值按（属性值 − 10）÷ 2 计算，结果向下取整。职业特性、生命上限与护甲由你核对填写。'
              : '力量、体质、敏捷、外貌、意志及幸运，每项掷三颗六面骰（3D6）再乘 5；体型、智力与教育，每项掷 2D6 加 6 后再乘 5。生命值按（体质 + 体型）÷ 10 计算并向下取整，魔法值等于意志 ÷ 5。'}
          </p>
        </section>
        <section>
          <span className="mini-label">检定规则</span>
          <h3>{dnd ? '掷 D20 加调整值，达到难度即成功' : '掷百分骰，点数不超过目标值即成功'}</h3>
          <p>
            {dnd
              ? '检定时掷一颗 D20 加上调整值，总点数达到难度等级（DC）即成功；用到已熟练的技能或豁免时，额外加上熟练加值。有优势时掷两颗 D20 取较高值，有劣势则取较低值。骰面掷出 1 自动失败，掷出 20 自动命中（即自然 1 / 20），这项规则只用于攻击检定。'
              : '掷 D100 的结果不超过技能值算普通成功，不超过一半算困难成功，不超过五分之一算极难成功。掷出 1 为大成功；目标值低于 50 时，掷出 96 到 100 算大失败，达到 50 及以上则只有 100 算大失败。有奖励骰或惩罚骰时，多掷一颗十位骰与原来的个位骰组合，奖励骰取更低点数，惩罚骰取更高点数。'}
          </p>
        </section>
        <section>
          <span className="mini-label">建卡与开场</span>
          <h3>{dnd ? '技能选择与 DM 开场审核' : '技能配点与 KP 开场审核'}</h3>
          <p>
            {dnd
              ? dndEdition === '2024'
                ? '卡面内置的背景带有固定技能，来自职业与种族的自选技能分开记录。技能专精名额受职业与等级限制；其他特性若带来额外名额，由 DM 设置。法术、装备和升级效果请对照规则书记录，角色卡数值合规并通过 DM 审核后才能开场。'
                : '卡面上的技能熟练按职业、背景与种族分开选择。技能专精名额受职业与等级限制；其他特性若带来额外名额，由 DM 设置。法术、装备和升级效果请对照规则书记录，角色卡数值合规并通过 DM 审核后才能开场。'
              : '角色技能在基础值之上分配职业点与兴趣点，系统会自动核对点数总额、信用评级范围与本团技能上限。年龄修正、伤害加值，以及移动力和精神状态均由 KP 裁定。角色卡数值合规并通过 KP 审核后才能开场；KP 另有独立的 NPC 与怪物卡库。'}
          </p>
        </section>
      </div>
      <div className="rules-links">
        <a
          href={
            dnd
              ? 'https://www.dndbeyond.com/srd'
              : 'https://www.chaosium.com/call-of-cthulhu-resources/'
          }
          target="_blank"
          rel="noreferrer"
        >
          <BookOpen size={15} /> {dnd ? 'D&D 官方开放规则（SRD）' : 'Chaosium 官方规则资源'}{' '}
          <ArrowUpRight size={14} />
        </a>
        <a href="https://github.com/AgnesSummer/TRPG" target="_blank" rel="noreferrer">
          TRPG 参考资料库 <ArrowUpRight size={14} />
        </a>
      </div>
    </Modal>
  );
}
