// src/pages/sigilExplorer/tree/types.ts
"use client";

import type { SigilSharePayloadLoose } from "../types";

export type SigilNode = {
  id: string;
  url: string;
  urls: string[];
  payload: SigilSharePayloadLoose;
  children: SigilNode[];
};

export type BranchSummary = {
  root: SigilNode;
  nodeCount: number;
  latest: SigilSharePayloadLoose;
};
