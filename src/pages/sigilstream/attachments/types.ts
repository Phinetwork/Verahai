/**
 * Attachment type declarations + guards.
 * Harmonized with v3 feedPayload (Brotli) specification.
 * This file must remain the single source of truth for the UI side.
 */

import { isRecord } from "../core/utils";

/* --------------------------------------------------------------------------
   URL ATTACHMENTS
-------------------------------------------------------------------------- */

export type AttachmentUrl = {
  kind: "url";
  url: string;
  title?: string;
};

/* --------------------------------------------------------------------------
   INLINE FILE ATTACHMENTS (Base64URL + thumbnail)
   v3 feed spec allows optional fields → keep exactly matched
-------------------------------------------------------------------------- */

export type AttachmentFileInline = {
  kind: "file-inline";
  name?: string;
  type?: string;       // MIME
  size?: number;       // bytes
  sha256?: string;     // NOTE: inline items in feedPayload do NOT guarantee sha256
  data_b64url: string; // RFC4648-§5 base64url (no padding)
  thumbnail_b64?: string;
  relPath?: string;
};

/* --------------------------------------------------------------------------
   FILE REF ATTACHMENTS (sha256 pointer)
   Optional name/type/size/url in v3 spec
-------------------------------------------------------------------------- */

export type AttachmentFileRef = {
  kind: "file-ref";
  sha256: string;       // required in v3
  name?: string;
  type?: string;        // MIME
  size?: number;        // bytes
  url?: string;         // optional fetch location
  relPath?: string;
};

/* --------------------------------------------------------------------------
   UNION
-------------------------------------------------------------------------- */

export type AttachmentItem =
  | AttachmentUrl
  | AttachmentFileInline
  | AttachmentFileRef;

/* --------------------------------------------------------------------------
   MANIFEST
-------------------------------------------------------------------------- */

export type AttachmentManifest = {
  version: 1;
  totalBytes: number;
  inlinedBytes: number;
  items: AttachmentItem[];
};

/* --------------------------------------------------------------------------
   TYPE GUARDS
-------------------------------------------------------------------------- */

export function isAttachmentUrl(v: unknown): v is AttachmentUrl {
  return (
    isRecord(v) &&
    v["kind"] === "url" &&
    typeof v["url"] === "string" &&
    (v["title"] === undefined || typeof v["title"] === "string")
  );
}

export function isAttachmentFileInline(v: unknown): v is AttachmentFileInline {
  return (
    isRecord(v) &&
    v["kind"] === "file-inline" &&
    typeof v["data_b64url"] === "string" &&
    (v["name"] === undefined || typeof v["name"] === "string") &&
    (v["type"] === undefined || typeof v["type"] === "string") &&
    (v["size"] === undefined || typeof v["size"] === "number") &&
    (v["sha256"] === undefined || typeof v["sha256"] === "string") &&
    (v["thumbnail_b64"] === undefined || typeof v["thumbnail_b64"] === "string") &&
    (v["relPath"] === undefined || typeof v["relPath"] === "string")
  );
}

export function isAttachmentFileRef(v: unknown): v is AttachmentFileRef {
  return (
    isRecord(v) &&
    v["kind"] === "file-ref" &&
    typeof v["sha256"] === "string" &&
    (v["name"] === undefined || typeof v["name"] === "string") &&
    (v["type"] === undefined || typeof v["type"] === "string") &&
    (v["size"] === undefined || typeof v["size"] === "number") &&
    (v["url"] === undefined || typeof v["url"] === "string") &&
    (v["relPath"] === undefined || typeof v["relPath"] === "string")
  );
}

export function isAttachmentItem(v: unknown): v is AttachmentItem {
  return (
    isAttachmentUrl(v) ||
    isAttachmentFileInline(v) ||
    isAttachmentFileRef(v)
  );
}

export function isAttachmentManifest(v: unknown): v is AttachmentManifest {
  return (
    isRecord(v) &&
    v["version"] === 1 &&
    typeof v["totalBytes"] === "number" &&
    typeof v["inlinedBytes"] === "number" &&
    Array.isArray(v["items"]) &&
    v["items"].every(isAttachmentItem)
  );
}
