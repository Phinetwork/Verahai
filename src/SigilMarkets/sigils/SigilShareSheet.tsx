// SigilMarkets/sigils/SigilShareSheet.tsx
"use client";

/**
 * SigilShareSheet (MVP)
 * - Offers export buttons and copies a blob URL if present.
 * - Full social integrations will be wired later.
 */

import React, { useMemo } from "react";
import { Sheet } from "../ui/atoms/Sheet";
import { Button } from "../ui/atoms/Button";
import { Divider } from "../ui/atoms/Divider";
import { Icon } from "../ui/atoms/Icon";
import { SigilExportButton } from "./SigilExport";
import { useSigilMarketsUi } from "../state/uiStore";

export type SigilShareSheetProps = Readonly<{
  open: boolean;
  onClose: () => void;

  title: string;
  filenameBase: string;

  svgUrl?: string;
  svgText?: string;
}>;

export const SigilShareSheet = (props: SigilShareSheetProps) => {
  const { actions: ui } = useSigilMarketsUi();

  const canCopy = useMemo(() => typeof props.svgUrl === "string" && props.svgUrl.length > 0, [props.svgUrl]);

  const copy = async (): Promise<void> => {
    if (!canCopy) return;
    try {
      await navigator.clipboard.writeText(props.svgUrl as string);
      ui.toast("success", "Copied", "Sigil URL copied");
    } catch {
      ui.toast("error", "Copy failed", "Clipboard not available");
    }
  };

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title={props.title}
      subtitle="Export your sigil artifact or share its link."
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button variant="ghost" onClick={props.onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 12 }}>
        <SigilExportButton filenameBase={props.filenameBase} svgText={props.svgText} svgUrl={props.svgUrl} />

        <Divider />

        <Button
          variant="ghost"
          onClick={copy}
          disabled={!canCopy}
          leftIcon={<Icon name="share" size={14} tone="dim" />}
        >
          Copy link
        </Button>

        <div className="sm-small">
          Next: native Share API + direct posting hub integration (KaiVoh).
        </div>
      </div>
    </Sheet>
  );
};
