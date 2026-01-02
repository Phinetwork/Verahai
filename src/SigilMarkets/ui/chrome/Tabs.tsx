// SigilMarkets/ui/chrome/Tabs.tsx
"use client";

import React, { useMemo } from "react";

export type TabOption<T extends string> = Readonly<{
  value: T;
  label: string;
}>;

export type TabsProps<T extends string> = Readonly<{
  value: T;
  options: readonly TabOption<T>[];
  onChange: (next: T) => void;
  className?: string;
}>;

const cx = (...p: Array<string | false | null | undefined>): string => p.filter(Boolean).join(" ");

export const Tabs = <T extends string>(props: TabsProps<T>) => {
  const cls = useMemo(() => cx("sm-tabs", props.className), [props.className]);

  return (
    <div className={cls} role="tablist">
      {props.options.map((o) => {
        const active = o.value === props.value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={cx("sm-tab", active && "is-active")}
            onClick={() => props.onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
};
