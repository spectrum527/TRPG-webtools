import { useState } from 'react';
import { COC_SKILL_ORDERS, type CocSkillOrder } from '../../shared/coc-skill-order';

export function useCocSkillOrder(scope: string, fallback: CocSkillOrder) {
  const key = `interlude-coc-skill-order:${scope}`;
  const [order, setOrder] = useState<CocSkillOrder>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored && Object.hasOwn(COC_SKILL_ORDERS, stored)
        ? (stored as CocSkillOrder)
        : fallback;
    } catch {
      return fallback;
    }
  });
  const change = (value: CocSkillOrder) => {
    setOrder(value);
    try {
      localStorage.setItem(key, value);
    } catch {
      /* Keep the current view usable. */
    }
  };
  return [order, change] as const;
}

export function CocSkillOrderSelect({
  value,
  onChange,
}: {
  value: CocSkillOrder;
  onChange: (value: CocSkillOrder) => void;
}) {
  return (
    <label className="coc-skill-order">
      <span>技能排序</span>
      <select
        aria-label="技能排序"
        value={value}
        onChange={(event) => onChange(event.target.value as CocSkillOrder)}
      >
        {Object.entries(COC_SKILL_ORDERS).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
