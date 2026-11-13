import { useRef, useState } from 'react';
import { Download, Upload, Copy } from 'lucide-react';
import { CocEquipmentBrowser } from './CocEquipmentCatalog';
import { CocOccupationBrowser } from './CocOccupationPicker';
import { COC_BOUTS, emptyCocSession } from '../../shared/coc-session';
import { createCharacter } from '../../shared/rules';
import { editCocPreparation } from '../../shared/coc-preparation';
import {
  exportCocPreparationLibrary,
  MAX_COC_LIBRARY_BYTES,
  mergeCocPreparationLibrary,
  parseCocPreparationLibrary,
} from '../../shared/coc-library';
import { readCocPreparationLibrary, saveCocPreparationLibrary } from '../coc-library-storage';
import { downloadFile } from '../storage';
import { CocMagic } from './CocMagic';
import { CocSectionHeading } from './CocInvestigator';

export function CocReferenceLibrary({
  section,
}: {
  section: 'magic' | 'equipment' | 'careers' | 'sanity';
}) {
  const [library, setLibrary] = useState(readCocPreparationLibrary);
  const [query, setQuery] = useState('');
  const [equipmentKind, setEquipmentKind] = useState<'weapon' | 'armor'>('weapon');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const [base] = useState(() => createCharacter('coc', () => 3));
  const libraryCard = (source: typeof library) => ({
    ...base,
    cocSession: {
      ...emptyCocSession(base),
      spells: source.spells.map((s) => ({ ...s, learned: false, casting: 'untested' as const })),
      tomes: source.tomes.map((t) => ({
        ...t,
        progressMinutes: 0,
        initialComplete: false,
        fullComplete: false,
      })),
    },
  });
  const card = libraryCard(library);
  const save = (next: typeof library) => {
    const stored = saveCocPreparationLibrary(next);
    setLibrary(stored);
    setError('');
    setNotice('已保存备团资料');
  };
  const remove = (kind: 'weapons' | 'armor', id: string) => {
    setNotice('');
    try {
      const latest = readCocPreparationLibrary();
      if (kind === 'weapons')
        save({ ...latest, weapons: latest.weapons.filter((item) => item.id !== id) });
      else save({ ...latest, armor: latest.armor.filter((item) => item.id !== id) });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const exportLibrary = (format: 'json' | 'md') => {
    setError('');
    setNotice('');
    try {
      const latest = readCocPreparationLibrary();
      downloadFile(
        exportCocPreparationLibrary(latest, format),
        `CoC-备团资料.${format}`,
        format === 'json' ? 'application/json' : 'text/markdown',
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const prompt = `请根据我提供的 CoC 第七版剧本提取法术、神话书、武器和防具，输出一个 JSON 数据块。保留来源中的骰式、单位和规则条件，不补造缺失数据；不确定的项先向我提问。文件必须使用此结构：\n${JSON.stringify({ schemaVersion: 1, type: 'interlude-coc-preparation', spells: [{ id: 'spell-example', name: '法术名', description: '条件与效果', source: '剧本页码', cost: { mp: 0, san: '1d4', hp: 0, minutes: 1, rounds: 0 } }], tomes: [{ id: 'tome-example', name: '书名', description: '阅读条件', initialMinutes: 60, fullMinutes: 1440, initialMythos: 1, fullMythos: 2, sanLoss: '1d4', spellIds: ['spell-example'] }], weapons: [{ id: 'weapon-example', profile: { name: '武器名', category: 'melee', skillKey: 'fightingBrawl', damage: '1d6', damageBonusMode: 'full', impales: false, range: 0, usesPerRound: 1, capacity: 0, malfunction: 0, era: 'any' } }], armor: [{ id: 'armor-example', profile: { name: '防具名', rating: 1, movPenalty: 0, coverage: 'body', era: 'any' } }] }, null, 2)}\n没有对应内容时使用空数组。ID 仅用英文字母、数字、短横线和下划线。同一文件不得重复 ID。神话书 spellIds 必须引用 spells 中的 ID。武器 category 为 melee/thrown/bow/handgun/rifle/shotgun/smg/machineGun/heavy/explosive/other，damageBonusMode 为 none/full/half，era 为 1920s/modern/any，防具 kind 可选 worn/shield/natural/cover/environment；coverage 为 body/head/all/custom/none，custom 必须提供 locations 数组，值为 body/head/face/eyes/neck/arms/hands/legs/feet/chest/back/abdomen。特殊防护条件保留在 rulesNotes 中；未知或情境护甲可设 rating 为 0、manualRating 为 true 并保留 sourceText.rating。距离统一换算为码，时间为分钟，损失写骰式或整数。不要把示例占位项留在输出中。`;
  return (
    <section className="panel coc-library-panel">
      <div className="coc-library-toolbar">
        <button
          type="button"
          className="button secondary compact"
          onClick={() => file.current?.click()}
        >
          <Upload size={15} />
          导入资料
        </button>
        <button type="button" className="text-button" onClick={() => exportLibrary('json')}>
          <Download size={15} />
          JSON
        </button>
        <button type="button" className="text-button" onClick={() => exportLibrary('md')}>
          Markdown
        </button>
      </div>
      <input
        ref={file}
        type="file"
        accept=".json,.md,application/json,text/markdown"
        className="visually-hidden"
        aria-label="导入 CoC 备团资料"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          void (async () => {
            try {
              setError('');
              setNotice('');
              if (f.size > MAX_COC_LIBRARY_BYTES) throw new Error('文件不可超过 1 MiB');
              const incoming = parseCocPreparationLibrary(await f.text());
              save(mergeCocPreparationLibrary(readCocPreparationLibrary(), incoming));
            } catch (err) {
              setError((err as Error).message);
            }
          })();
        }}
      />
      {section === 'magic' && (
        <CocMagic
          card={card}
          onEdit={async (edit) => {
            const latest = readCocPreparationLibrary();
            const next = editCocPreparation(libraryCard(latest), edit).cocSession!;
            save({
              ...latest,
              spells: next.spells.map(({ id, name, description, source, cost }) => ({
                id,
                name,
                description,
                source,
                cost,
              })),
              tomes: next.tomes.map(
                ({
                  id,
                  name,
                  description,
                  initialMinutes,
                  fullMinutes,
                  initialMythos,
                  fullMythos,
                  sanLoss,
                  spellIds,
                }) => ({
                  id,
                  name,
                  description,
                  initialMinutes,
                  fullMinutes,
                  initialMythos,
                  fullMythos,
                  sanLoss,
                  spellIds,
                }),
              ),
            });
            return true;
          }}
          libraryMode
        />
      )}
      {section === 'equipment' && (
        <div className="coc-section">
          <CocSectionHeading title="武器与防具资料库" eyebrow="EQUIPMENT LIBRARY" />
          <div className="coc-equipment-tabs" aria-label="装备目录分类">
            <button
              type="button"
              className={equipmentKind === 'weapon' ? 'selected' : ''}
              aria-pressed={equipmentKind === 'weapon'}
              onClick={() => setEquipmentKind('weapon')}
            >
              武器
            </button>
            <button
              type="button"
              className={equipmentKind === 'armor' ? 'selected' : ''}
              aria-pressed={equipmentKind === 'armor'}
              onClick={() => setEquipmentKind('armor')}
            >
              防具与掩体
            </button>
          </div>
          <CocEquipmentBrowser
            key={equipmentKind}
            kind={equipmentKind}
            library={library}
            onRemove={(id) => remove(equipmentKind === 'weapon' ? 'weapons' : 'armor', id)}
          />
        </div>
      )}
      {section === 'careers' && (
        <div className="coc-section">
          <CocSectionHeading title="职业与技能参考" eyebrow="CAREERS & SKILLS" />
          <CocOccupationBrowser />
        </div>
      )}
      {section === 'sanity' && (
        <div className="coc-section">
          <CocSectionHeading title="理智与疯狂参考" eyebrow="SANITY REFERENCE" />
          <div className="coc-record-list">
            {[
              [
                '临时性疯狂',
                '单次损失至少 5 点 SAN 后进行 INT 检定，成功时意识到恐怖并进入 1d10 小时临时性疯狂。',
              ],
              [
                '不定性疯狂',
                '一个游戏日累计损失至少日初 SAN 的五分之一，进入不定性疯狂。治疗和结束由主持人判断。',
              ],
              [
                '疯狂发作',
                '即时发作与疯狂潜在状态分开记录：即时发作通常 1d10 轮；症状可持续保留。',
              ],
              ['永久性疯狂', 'SAN 降到 0 时进入永久性疯狂，交由主持人处理。'],
            ].map(([title, description]) => (
              <article className="coc-record" key={title}>
                <h4>{title}</h4>
                <p className="coc-description">{description}</p>
              </article>
            ))}
          </div>
          <h4>即时发作类型</h4>
          <div className="coc-toggles">
            {COC_BOUTS.map((b, i) => (
              <span className="pill" key={b.key}>
                {i + 1} · {b.label}
              </span>
            ))}
          </div>
          <p className="field-help">
            具体表现须结合场景裁定。疾病症状、发作轮数与潜在状态持续时间可在房间角色管理中调整。
          </p>
        </div>
      )}
      <details className="coc-import-guide">
        <summary>外部 AI 提取与导入教程</summary>
        <ol>
          <li>复制提示词，连同你有权使用的剧本和提取范围交给 AI。</li>
          <li>检查来源、骰式与单位，将生成的 JSON 或 Markdown 保存为文件。</li>
          <li>点击“导入资料”。相同 ID 的资料会更新；不同 ID 会追加。</li>
          <li>在角色卡或房间“角色准备”中，从备团库选择对应资料载入。神话书引用的法术应先载入。</li>
        </ol>
        <button
          type="button"
          className="button secondary"
          onClick={() =>
            void (async () => {
              try {
                await navigator.clipboard.writeText(prompt);
                setNotice('已复制提取提示词');
              } catch {
                setError('复制失败，请从下方文本框手动复制');
              }
            })()
          }
        >
          <Copy size={15} />
          复制提取提示词
        </button>
        <textarea
          className="coc-prompt"
          readOnly
          rows={5}
          value={prompt}
          aria-label="CoC 资料提取提示词"
        />
      </details>
      {notice && (
        <p className="coc-status-note" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
