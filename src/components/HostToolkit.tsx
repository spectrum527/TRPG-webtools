import { AtlasToolkit } from './AtlasToolkit';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  ClipboardCheck,
  EyeOff,
  FolderOpen,
  Layers,
  RefreshCw,
  Skull,
  Sparkles,
  Users,
} from 'lucide-react';
import type { Room, RoomAction } from '../../shared/types';
import { duplicateKeeperCard, type KeeperCard } from '../../shared/keeper';
import { getKeeperLibrary, removeKeeperCard, saveKeeperCards } from '../keeper-storage';
import { KeeperWorkshop } from './KeeperWorkshop';
import { KeeperImportGuide } from './KeeperImportGuide';
import { ReviewDesk } from './ReviewDesk';
import { Spinner } from './ui';
import { DndToolkit } from './DndToolkit';
import type { DndEdition } from '../../shared/dnd-edition';
import { DndEditionSwitch } from './DndEditionSwitch';
import { DndReferenceLibrary } from './DndReferenceLibrary';
import { EquipmentLibrary } from './CharacterEquipment';
import { EncounterPlans } from './EncounterPlans';

export function HostToolkit({
  dndEdition,
  onDndEditionChange,
  room,
  memberId,
  onAction,
  onReturnRoom,
  notify,
}: {
  dndEdition: DndEdition;
  onDndEditionChange: (edition: DndEdition) => void;
  room: Room | null;
  memberId?: string;
  onAction: (action: RoomAction) => Promise<void>;
  onReturnRoom: () => void;
  notify: (message: string, type?: 'success' | 'error') => void;
}) {
  const [cards, setCards] = useState<KeeperCard[]>([]);
  const [libraryRule, setLibraryRule] = useState<'coc' | 'dnd' | 'atlas' | 'plans'>(
    room?.rule ?? 'coc',
  );
  const [loading, setLoading] = useState(true);
  const [dndSection, setDndSection] = useState<'blocks' | 'spell' | 'feat' | 'equipment'>('blocks');
  const [error, setError] = useState('');
  const [workshop, setWorkshop] = useState<{
    scope: 'personal' | 'room';
    kind?: 'npc' | 'monster';
  } | null>(null);
  const [review, setReview] = useState(false);
  const [guide, setGuide] = useState(false);
  const guideRef = useRef<HTMLDivElement>(null);
  const isHost = room?.members.some((m) => m.id === memberId && m.role === 'host') ?? false;
  const cocRoom = isHost && room?.rule === 'coc' ? room : null;
  const load = async () => {
    setLoading(true);
    try {
      setCards(await getKeeperLibrary());
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
  useEffect(() => {
    const refresh = () => {
      if (!workshop && document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [workshop]);
  useEffect(() => {
    if (guide) guideRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [guide]);
  const personalSave = async (next: KeeperCard[]) => {
    setCards(await saveKeeperCards(next));
  };
  const copyToRoom = async (next: KeeperCard[]) => {
    if (!cocRoom) throw new Error('请先以主持人身份进入 CoC 房间。');
    if (cocRoom.keeperCards.length + next.length > 200)
      throw new Error('当前房间最多 200 张卡，请减少本批数量。');
    const copies = next.map((card) => duplicateKeeperCard(card, card.name));
    if (new Blob([JSON.stringify(copies)]).size > 8 * 1024 * 1024 - 2048)
      throw new Error('本批资料超过 8 MiB，请选择较少的卡片分批带入。');
    await onAction({ type: 'keeper-save', cards: copies });
  };
  const copyToPersonal = async (next: KeeperCard[]) => {
    setCards(await saveKeeperCards(next.map((card) => duplicateKeeperCard(card, card.name))));
  };
  const run = async (action: RoomAction) => {
    try {
      await onAction(action);
      return true;
    } catch (e) {
      notify((e as Error).message, 'error');
      return false;
    }
  };
  const openPersonal = async (kind?: 'npc' | 'monster') => {
    try {
      setCards(await getKeeperLibrary());
      setError('');
      setWorkshop({ scope: 'personal', kind });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="host-toolkit page-enter">
      <div className="toolkit-heading">
        <div>
          <span className="mini-label">BEHIND THE SCREEN</span>
          <h1>主持人工具集</h1>
        </div>
        <span className="toolkit-private">
          <EyeOff size={16} />
          你的备团空间
        </span>
      </div>
      <div className="segmented toolkit-rule-switch" aria-label="备团资料规则">
        <button
          className={libraryRule === 'plans' ? 'selected' : ''}
          onClick={() => setLibraryRule('plans')}
        >
          遭遇预案
        </button>
        <button
          className={libraryRule === 'coc' ? 'selected' : ''}
          onClick={() => setLibraryRule('coc')}
        >
          CoC 7
        </button>
        <button
          className={libraryRule === 'dnd' ? 'selected' : ''}
          onClick={() => setLibraryRule('dnd')}
        >
          D&D 5e
        </button>
        <button
          className={libraryRule === 'atlas' ? 'selected' : ''}
          onClick={() => setLibraryRule('atlas')}
        >
          地图与场景
        </button>
      </div>
      {libraryRule === 'plans' ? (
        <EncounterPlans room={room} isHost={isHost} edition={dndEdition} run={run} />
      ) : libraryRule === 'atlas' ? (
        <AtlasToolkit room={room} isHost={isHost} onAction={onAction} />
      ) : libraryRule === 'dnd' ? (
        <>
          <div className="dnd-preparation-nav">
            <div className="tabs" aria-label="D&D 备团工具">
              <button
                className={dndSection === 'equipment' ? 'active' : ''}
                onClick={() => setDndSection('equipment')}
              >
                装备
              </button>
              <button
                className={dndSection === 'blocks' ? 'active' : ''}
                onClick={() => setDndSection('blocks')}
              >
                NPC 与怪物
              </button>
              <button
                className={dndSection === 'spell' ? 'active' : ''}
                onClick={() => setDndSection('spell')}
              >
                法术书
              </button>
              <button
                className={dndSection === 'feat' ? 'active' : ''}
                onClick={() => setDndSection('feat')}
              >
                专长
              </button>
            </div>
            <DndEditionSwitch value={dndEdition} onChange={onDndEditionChange} />
          </div>
          {dndSection === 'blocks' ? (
            <DndToolkit
              key={dndEdition}
              edition={dndEdition}
              room={room}
              isHost={isHost}
              onAction={onAction}
              onReturnRoom={onReturnRoom}
              onReview={() => setReview(true)}
            />
          ) : dndSection === 'equipment' ? (
            <EquipmentLibrary key={dndEdition} edition={dndEdition} />
          ) : (
            <DndReferenceLibrary
              key={`${dndEdition}-${dndSection}`}
              edition={dndEdition}
              kind={dndSection}
            />
          )}
        </>
      ) : (
        <>
          {error && (
            <div className="inline-error toolkit-error" role="alert">
              <span>{error}</span>
              <button className="text-button" onClick={() => void load()}>
                <RefreshCw size={14} />
                重新读取
              </button>
            </div>
          )}
          <div className="toolkit-shelves">
            <section className="toolkit-library panel">
              <div className="toolkit-shelf-heading">
                <span className="toolkit-icon">
                  <Layers size={24} strokeWidth={1.4} />
                </span>
                <span className="mini-label">COC 7 · PERSONAL LIBRARY</span>
                <span className="toolkit-count">
                  {loading ? '读取中' : `${cards.length} / 200`}
                </span>
              </div>
              <h2>NPC 与怪物卡库</h2>
              <p>制作、导入和管理 NPC 与怪物卡。</p>
              <div className="toolkit-preview" aria-label="个人备团库摘要">
                {cards.length ? (
                  cards.slice(0, 3).map((card) => (
                    <div key={card.id}>
                      <span className={`keeper-card-icon ${card.kind}`}>
                        {card.kind === 'npc' ? <Users size={17} /> : <Skull size={17} />}
                      </span>
                      <div>
                        <b>{card.name}</b>
                        <small>
                          {card.kind === 'npc' ? 'NPC' : '怪物'} ·{' '}
                          {card.tags.slice(0, 2).join(' / ') || '私人资料'}
                        </small>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="toolkit-preview-empty">
                    <span>暂无 NPC 与怪物卡</span>
                    <small>新建或导入 NPC、怪物卡。</small>
                  </div>
                )}
              </div>
              <div className="toolkit-library-actions">
                <button
                  className="button primary"
                  disabled={loading || !!error}
                  onClick={() => void openPersonal()}
                >
                  {loading ? <Spinner /> : <FolderOpen size={17} />}打开个人卡库
                  <ArrowRight size={16} />
                </button>
                <button
                  className="text-button"
                  disabled={loading || !!error}
                  onClick={() => void openPersonal('npc')}
                >
                  <Users size={15} />
                  新建 NPC
                </button>
                <button
                  className="text-button"
                  disabled={loading || !!error}
                  onClick={() => void openPersonal('monster')}
                >
                  <Skull size={15} />
                  新建怪物
                </button>
              </div>
              <div className="toolkit-storage-note">
                <EyeOff size={13} />
                仅保存在此浏览器；导出文件可备份或换设备使用。
              </div>
            </section>
            <section className="toolkit-guide-card panel">
              <div className="toolkit-shelf-heading">
                <span className="toolkit-icon">
                  <BookOpen size={24} strokeWidth={1.4} />
                </span>
                <span className="mini-label">SCRIPT TO CARDS</span>
              </div>
              <h2>利用AI从剧本中提取NPC和怪物卡</h2>
              <p>把提取提示词交给你使用的 AI Agent，让它依据原文整理 NPC、怪物与属性骰式。</p>
              <ol className="toolkit-import-steps">
                <li>
                  <span>01</span>
                  <div>
                    <b>复制提示词</b>
                    <small>连同剧本与提取范围交给外部 AI</small>
                  </div>
                </li>
                <li>
                  <span>02</span>
                  <div>
                    <b>获得 Markdown</b>
                    <small>数值、骰式和来源一起保留</small>
                  </div>
                </li>
                <li>
                  <span>03</span>
                  <div>
                    <b>导入并核对</b>
                    <small>确认资料后，带入当前房间</small>
                  </div>
                </li>
              </ol>
              <button className="button secondary" onClick={() => setGuide(true)}>
                <Sparkles size={16} />
                提取提示词、模板与教程
                <ArrowRight size={15} />
              </button>
            </section>
          </div>
          {room ? (
            <section className="toolkit-room panel">
              <div>
                <span className="mini-label">AT THIS TABLE</span>
                <h2>{room.name}</h2>
                <p>
                  {isHost
                    ? '个人原稿与房间用卡分别保存，修改互不覆盖。'
                    : '你当前以玩家身份入席，个人备团库仍可使用。'}
                </p>
              </div>
              <div className="toolkit-room-actions">
                {isHost && (
                  <button className="button secondary compact" onClick={() => setReview(true)}>
                    <ClipboardCheck size={16} />
                    审核与制卡要求
                  </button>
                )}
                {cocRoom && (
                  <button
                    className="button primary compact"
                    onClick={() => setWorkshop({ scope: 'room' })}
                  >
                    <FolderOpen size={16} />
                    房间 NPC 与怪物卡库<span>{cocRoom.keeperCards.length}</span>
                  </button>
                )}
                <button className="text-button" onClick={onReturnRoom}>
                  返回房间
                  <ArrowRight size={16} />
                </button>
              </div>
            </section>
          ) : (
            <div className="toolkit-offline-note">
              <EyeOff size={16} />
              <p>现在即可制作并保存。创建 CoC 房间后，可从个人卡库将单张或全部资料带入本桌。</p>
            </div>
          )}
          {guide && (
            <div ref={guideRef} className="toolkit-full-guide panel">
              <KeeperImportGuide />
            </div>
          )}
        </>
      )}
      {workshop?.scope === 'personal' && (
        <KeeperWorkshop
          library={cards}
          scope="personal"
          initialKind={workshop.kind}
          onSave={personalSave}
          onDelete={async (id) => {
            setCards(await removeKeeperCard(id));
          }}
          onTransfer={cocRoom ? copyToRoom : undefined}
          onClose={() => setWorkshop(null)}
        />
      )}
      {workshop?.scope === 'room' && cocRoom && (
        <KeeperWorkshop
          library={cocRoom.keeperCards}
          scope="room"
          onSave={async (next) => {
            await onAction({ type: 'keeper-save', cards: next });
          }}
          onDelete={async (id) => {
            await onAction({ type: 'keeper-delete', cardId: id });
          }}
          onTransfer={copyToPersonal}
          onClose={() => setWorkshop(null)}
        />
      )}
      {review && isHost && room && (
        <ReviewDesk room={room} isHost={true} run={run} onClose={() => setReview(false)} />
      )}
    </div>
  );
}
