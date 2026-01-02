// src/pages/sigilstream/payload/types.ts
import type { PostBody } from "../../../utils/feedPayload";

export type UnsealedContent = {
  body?: PostBody;
  attachments?: unknown;
  caption?: string;
};

export type UnsealState =
  | { status: "none" }
  | { status: "sealed" }
  | { status: "opening" }
  | { status: "open"; content: UnsealedContent }
  | { status: "error"; message: string };
