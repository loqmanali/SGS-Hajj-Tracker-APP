/**
 * Offline-first scan decision tree.
 *
 * When online, the server is the source of truth. When offline, this module
 * uses the cached manifest + locally-scanned set to flash the agent the right
 * color immediately. The actual scan still goes to the queue for replay.
 */

import type { ManifestBag } from "@/lib/api/sgs";
import type { FlashColor } from "@/constants/branding";

export interface ScanDecision {
  flash: FlashColor;
  title: string;
  subtitle?: string;
  hapticKey: "success" | "error" | "duplicate" | "warning";
  bag?: ManifestBag;
}

export function decideScan(args: {
  tagNumber: string;
  groupId: string;
  manifest: ManifestBag[];
  scannedTags: Set<string>;
}): ScanDecision {
  const { tagNumber, groupId, manifest, scannedTags } = args;

  // Permissive shape check — anything alphanumeric of plausible bag-tag
  // length is forwarded to the server, which is the source of truth.
  // Things like food-packaging EANs or random short strings still get
  // an "OUT OF SCOPE" warning so the agent gets immediate feedback that
  // the camera saw *something* but it wasn't usable.
  if (!isAcceptedScanTag(tagNumber)) {
    return {
      flash: "orange",
      title: "OUT OF SCOPE",
      subtitle: tagNumber,
      hapticKey: "warning",
    };
  }

  // Look up by either the SGS-printed tag or the airline IATA license
  // plate — agents may scan whichever is physically on the bag, and the
  // manifest stores both. Match the SGS tag first since it's the
  // canonical key for the offline scanned-set / queue / dead-letter.
  const bag = manifest.find(
    (b) => b.tagNumber === tagNumber || (b.iataTag && b.iataTag === tagNumber),
  );

  // Duplicate check considers both the raw scanned value and, if we
  // resolved a bag, that bag's *other* identifier — otherwise an agent
  // who scanned the SGS tag and then the airline tag for the same bag
  // would get a misleading green/COLLECTED on the second scan.
  const otherTag = bag
    ? bag.tagNumber === tagNumber
      ? bag.iataTag
      : bag.tagNumber
    : undefined;
  if (
    scannedTags.has(tagNumber) ||
    (otherTag && scannedTags.has(otherTag))
  ) {
    return {
      flash: "amber",
      title: "Already Scanned",
      subtitle: tagNumber,
      hapticKey: "duplicate",
      bag,
    };
  }

  if (!bag) {
    return {
      flash: "red",
      title: "NOT IN MANIFEST",
      subtitle: tagNumber,
      hapticKey: "error",
    };
  }

  if (bag.groupId !== groupId) {
    return {
      flash: "red",
      title: "Wrong Group",
      subtitle: `${bag.pilgrimName} • ${bag.groupId}`,
      hapticKey: "error",
      bag,
    };
  }

  return {
    flash: "green",
    title: "COLLECTED",
    subtitle: bag.pilgrimName,
    hapticKey: "success",
    bag,
  };
}

/**
 * Strips DataWedge / GS1 control characters and surrounding whitespace from
 * a raw scan payload. Use this on every scan source (Zebra trigger or
 * camera) before passing to decideScan.
 *
 * Also collapses internal spaces — IATA license plates are usually
 * encoded as a contiguous numeric string ("0065687867") but some
 * printers or OCR fallbacks include the visual spacing
 * ("0 065 687867"). Normalizing here keeps every downstream consumer
 * dealing with a single canonical form.
 */
export function normalizeTag(raw: string): string {
  // Strip ASCII control chars (GS=0x1D, RS=0x1E, EOT=0x04, NUL, etc.) and
  // any AIM identifier prefix DataWedge prepends ("]C1", "]d2", ...).
  let v = raw.replace(/[\x00-\x1F\x7F]/g, "").trim();
  v = v.replace(/^\]\w{2}/, "");
  // Collapse all whitespace inside the payload so "0065 SV 456953" and
  // "0065SV456953" both arrive at decideScan as one canonical string.
  v = v.replace(/\s+/g, "");
  return v;
}

/**
 * SGS-issued Hajj bag-tag shape used by `bulk-receive` to gate the manual
 * paste flow. Kept narrow on purpose — paste is a typing surface, so we
 * want to reject obviously-wrong input (a phone number, a name, etc.)
 * before it ever reaches the queue.
 *
 * The SGS backend issues several SGS-printed tag formats today:
 *   - "SGS-JED-260512-006"      (regular bag tag, hyphenated)
 *   - "SGSJED260512006"         (legacy unhyphenated)
 *   - "NOTAG-JED-006"           (no-tag-bag generated tag)
 *   - "SGS-CARGO-JED-260512-001" (cargo variant)
 *
 * For the live scanner, prefer `isAcceptedScanTag` — it also accepts
 * IATA airline license plates (Resolution 740) so the camera doesn't
 * silently drop a tag the server might still resolve.
 */
export function isSgsHajjTag(tag: string): boolean {
  if (!tag) return false;
  return /^[A-Z0-9-]{5,30}$/i.test(tag);
}

/**
 * IATA Resolution 740 bag-tag license plate: 10 numeric digits
 * (3-digit airline accounting code + 6-digit serial + 1 leading digit).
 * Some printers add a check digit, so 11 is also common. We accept
 * 10-13 digits to cover variants without false-accepting random
 * numeric strings (phone numbers, EANs).
 */
export function isIataBagTag(tag: string): boolean {
  if (!tag) return false;
  return /^[0-9]{10,13}$/.test(tag);
}

/**
 * Live scanner gate: accepts the union of SGS-printed tags and IATA
 * airline license plates. Anything else (food packaging EANs, QR codes,
 * boarding-pass PDF417 payloads, etc.) is "OUT OF SCOPE".
 *
 * The server stays authoritative — this only filters out things that
 * are clearly not a bag tag so the agent gets useful feedback instead
 * of silent acceptance.
 */
export function isAcceptedScanTag(tag: string): boolean {
  return isSgsHajjTag(tag) || isIataBagTag(tag);
}
