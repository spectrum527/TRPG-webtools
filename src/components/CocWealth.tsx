import { useState } from 'react';
import {
  cocWealthValues,
  CocWealthSettingSchema,
  type CocWealthSetting,
} from '../../shared/coc-wealth';
import { AutoValueField } from './AutoValueField';
import {
  CocSectionHeading,
  useCocInvestigatorEdit,
  type CocInvestigatorProps,
} from './CocInvestigator';

type Operation = 'income' | 'expense' | 'override';

export function CocWealth({
  card,
  onEdit,
  disabled,
  active = false,
  isHost = true,
}: CocInvestigatorProps) {
  const values = cocWealthValues(card);
  const wealth = card.cocInvestigator?.wealth;
  const settingKey = `${card.id}|${JSON.stringify(values.setting)}`;
  const [settingDraft, setSettingDraft] = useState<{ key: string; value: CocWealthSetting }>();
  const setting = settingDraft?.key === settingKey ? settingDraft.value : values.setting;
  const setSetting = (value: CocWealthSetting) => setSettingDraft({ key: settingKey, value });
  const [reason, setReason] = useState('');
  const [operation, setOperation] = useState<Operation>('expense');
  const { send, error, blocked } = useCocInvestigatorEdit(onEdit, disabled);
  const canManage = !active || isHost;
  const settingsBlocked = blocked || !canManage;
  const currencyPinned = !!values.opening;
  const hasManualReferences = Object.values(wealth?.controls ?? {}).some(
    (control) => control?.manual != null,
  );
  const allowedOperation = !canManage && operation === 'override' ? 'expense' : operation;
  const currencyChanges = (setting.era === 'custom' ? setting.currency : 'USD') !== values.currency;
  return (
    <div className="coc-section coc-wealth">
      <CocSectionHeading title="财产与账目" eyebrow="WEALTH & LEDGER" />
      {canManage && (
        <div className="coc-inline-fields">
          <label className="field">
            年代与货币
            <select
              value={setting.era}
              disabled={settingsBlocked}
              onChange={(e) =>
                setSetting(
                  e.target.value === 'custom'
                    ? {
                        era: 'custom',
                        label: '',
                        currency: currencyPinned ? values.currency : 'CNY',
                        basis: '1920s',
                        rate: 1,
                      }
                    : { era: e.target.value as '1920s' | 'modern' },
                )
              }
            >
              <option value="1920s" disabled={currencyPinned && values.currency !== 'USD'}>
                1920 年代 · USD
              </option>
              <option value="modern" disabled={currencyPinned && values.currency !== 'USD'}>
                现代 · USD
              </option>
              <option value="custom">剧本自定义</option>
            </select>
          </label>
          {setting.era === 'custom' && (
            <>
              <label className="field">
                年代说明
                <input
                  value={setting.label}
                  maxLength={60}
                  disabled={settingsBlocked}
                  onChange={(e) => setSetting({ ...setting, label: e.target.value })}
                />
              </label>
              <label className="field">
                货币简称
                <input
                  value={setting.currency}
                  maxLength={8}
                  disabled={settingsBlocked || currencyPinned}
                  onChange={(e) =>
                    setSetting({ ...setting, currency: e.target.value.toUpperCase() })
                  }
                />
              </label>
              <label className="field">
                参考年代
                <select
                  value={setting.basis}
                  disabled={settingsBlocked}
                  onChange={(e) =>
                    setSetting({ ...setting, basis: e.target.value as '1920s' | 'modern' })
                  }
                >
                  <option value="1920s">1920 年代</option>
                  <option value="modern">现代</option>
                </select>
              </label>
              <label className="field">
                剧本换算倍率（每 1 参考美元）
                <input
                  type="number"
                  min={0.000001}
                  max={10000}
                  step="any"
                  value={setting.rate}
                  disabled={settingsBlocked}
                  onChange={(e) => setSetting({ ...setting, rate: Number(e.target.value) })}
                />
              </label>
            </>
          )}
          <button
            type="button"
            className="button secondary"
            disabled={
              settingsBlocked ||
              (currencyPinned && currencyChanges) ||
              !CocWealthSettingSchema.safeParse(setting).success ||
              JSON.stringify(setting) === JSON.stringify(values.setting)
            }
            onClick={() => void send({ kind: 'wealth-setting', setting })}
          >
            保存年代
          </button>
        </div>
      )}
      {currencyPinned && (
        <p className="field-help">
          账本使用 {values.currency}。其他货币金额可按剧本汇率折算后填写。
        </p>
      )}
      {!currencyPinned && currencyChanges && hasManualReferences && (
        <p className="field-help">更换货币后，手填参考金额保留原数字，以新货币计。</p>
      )}
      <div className="allocation-summary">
        <div>
          <span>信用评级</span>
          <strong>{values.creditRating}</strong>
          <small>{values.tier.label}</small>
        </div>
        <div>
          <span>当前现金 · {values.currency}</span>
          <strong>{values.current.cash.toLocaleString()}</strong>
        </div>
        <div>
          <span>当前资产 · {values.currency}</span>
          <strong>{values.current.assets.toLocaleString()}</strong>
        </div>
      </div>
      <section className="coc-subsection">
        <h4>初始财产参考</h4>
        {canManage && (
          <label className="field">
            手改参考金额的原因
            <input
              value={reason}
              maxLength={200}
              disabled={settingsBlocked}
              onChange={(e) => setReason(e.target.value)}
              placeholder="按剧本或主持人规定调整"
            />
          </label>
        )}
        <div className="auto-value-grid">
          {(
            [
              { key: 'cash', label: '初始现金' },
              { key: 'assets', label: '初始资产' },
              { key: 'spending', label: '日常消费水平' },
            ] as const
          ).map(({ key, label }) => (
            <AutoValueField
              key={key}
              label={label}
              automatic={values.automatic[key]}
              control={wealth?.controls?.[key]}
              disabled={settingsBlocked}
              min={0}
              max={1e12}
              step={0.01}
              source={[
                values.currency,
                key === 'assets' && values.assetsIsMinimum ? '最低参考值' : '',
                wealth?.controlReasons?.[key] ? `手填原因：${wealth.controlReasons[key]}` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
              onEdit={(change) =>
                send({
                  kind: 'wealth-control',
                  field: key,
                  change,
                  reason: change.kind === 'value' ? reason.trim() : undefined,
                })
              }
            />
          ))}
        </div>
        <p className="field-help">
          参考金额随信用评级计算。首次记账后，余额独立保存；修改信用或参考金额不会重置已经发生的收支。自定义倍率由剧本决定。
        </p>
      </section>
      <section className="coc-subsection">
        <h4>记账</h4>
        {values.opening && (
          <p className="field-help">
            期初（CR {values.opening.creditRating}）：现金 {values.opening.cash.toLocaleString()} ·
            资产 {values.opening.assets.toLocaleString()} {values.opening.currency}
          </p>
        )}
        <form
          className="coc-inline-fields"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            void (async () => {
              const ok = await send({
                kind: 'wealth-transaction',
                account: f.get('account') as 'cash' | 'assets',
                operation: allowedOperation,
                amount: Number(f.get('amount')),
                reason: String(f.get('reason')),
              });
              if (ok) {
                form.reset();
                setOperation('expense');
              }
            })();
          }}
        >
          <label className="field">
            账户
            <select name="account" disabled={blocked}>
              <option value="cash">现金</option>
              <option value="assets">资产</option>
            </select>
          </label>
          <label className="field">
            类型
            <select
              name="operation"
              value={allowedOperation}
              disabled={blocked}
              onChange={(e) => setOperation(e.target.value as Operation)}
            >
              <option value="expense">支出</option>
              <option value="income">收入</option>
              {canManage && <option value="override">修正余额</option>}
            </select>
          </label>
          <label className="field">
            金额
            <input
              name="amount"
              required
              type="number"
              min={allowedOperation === 'override' ? 0 : 0.01}
              max={1e12}
              step="0.01"
              disabled={blocked}
            />
          </label>
          <label className="field">
            用途或原因
            <input name="reason" required maxLength={200} disabled={blocked} />
          </label>
          <button type="submit" className="button primary" disabled={blocked}>
            保存账目
          </button>
        </form>
        <div className="coc-record-list">
          {[...values.ledger].reverse().map((entry) => (
            <article className="coc-record" key={entry.id}>
              <div className="coc-record-title">
                <strong>{entry.reason}</strong>
                <b>
                  {entry.operation === 'expense' ? '−' : entry.operation === 'income' ? '+' : '='}
                  {entry.amount.toLocaleString()} {entry.currency}
                </b>
              </div>
              <p className="coc-data-line">
                {entry.account === 'cash' ? '现金' : '资产'} {entry.before.toLocaleString()} →{' '}
                {entry.after.toLocaleString()} · {new Date(entry.at).toLocaleString()}
              </p>
            </article>
          ))}
        </div>
        {!values.ledger.length && <p className="coc-empty">暂无账目</p>}
      </section>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
