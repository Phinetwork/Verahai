// SigilMarkets/ui/chrome/SearchBar.tsx
"use client";

import { useMemo } from "react";
import { Icon } from "../atoms/Icon";

export type SearchBarProps = Readonly<{
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
}>;

const cx = (...p: Array<string | false | null | undefined>): string => p.filter(Boolean).join(" ");

export const SearchBar = (props: SearchBarProps) => {
  const cls = useMemo(() => cx("sm-search", props.className), [props.className]);

  return (
    <div className={cls}>
      <span className="sm-search-ico" aria-hidden="true">
        <Icon name="spark" size={14} tone="dim" />
      </span>
      <input
        className="sm-search-in"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder ?? "Search…"}
      />
    </div>
  );
};
