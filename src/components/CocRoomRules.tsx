import type { Room, RoomAction } from '../../shared/types';
import { cocRoomRules } from '../../shared/coc-session';
import { CombatCommandStatus, useEncounterCommand } from './CombatActions';

export function CocRoomRuleControls({
  room,
  run,
}: {
  room: Room;
  run: (action: RoomAction) => Promise<boolean>;
}) {
  const rules = cocRoomRules(room.cocRules),
    command = useEncounterCommand(room, run);
  return (
    <section className="coc-subsection">
      <h4>CoC 选用规则与自动化</h4>
      <div className="coc-rule-options">
        {(
          [
            {
              key: 'allowLuckSpending',
              label: '允许幸运消耗',
              help: '检定后消耗当前幸运降低骰点；不用于幸运、理智、伤害或孤注一掷。',
            },
            {
              key: 'allowPushedRolls',
              label: '允许孤注一掷',
              help: '失败后说明再次尝试的方法和后果，经主持人允许后重掷；战斗检定不可重掷。',
            },
            {
              key: 'autoSanity',
              label: '自动判定疯狂',
              help: '确认理智损失后，自动处理智力检定、当日累计损失和疯狂状态。关闭后只扣 SAN，由主持人手动记录状态。',
            },
            {
              key: 'autoDevelopment',
              label: '自动标记技能成长',
              help: '记录符合规则的成功技能使用；幕间仍需主持人点击结算，手动标记保留。',
            },
          ] as const
        ).map(({ key, label, help }) => (
          <label className="coc-rule-option" key={key}>
            <input
              type="checkbox"
              checked={rules[key]}
              disabled={command.busy || !!command.retry}
              onChange={(e) =>
                void command.execute({
                  type: 'coc-rules',
                  rules: { ...rules, [key]: e.target.checked },
                  expectedRevision: room.configRevision,
                  requestId: crypto.randomUUID(),
                })
              }
            />
            <span>
              <b>{label}</b>
              <small>{help}</small>
            </span>
          </label>
        ))}
      </div>
      <CombatCommandStatus command={command} />
    </section>
  );
}
