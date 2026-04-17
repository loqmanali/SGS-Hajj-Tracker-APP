/**
 * Local persistence for offline manifest cache and scan queue.
 *
 * Uses AsyncStorage (Expo Go compatible). For production at scale, swap the
 * storage adapter to expo-sqlite without changing the public API surface.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import type { ManifestBag, ScanRequest } from "@/lib/api/sgs";

const KEYS = {
  manifest: (groupId: string) => `sgs:manifest:${groupId}`,
  scanned: (groupId: string) => `sgs:scanned:${groupId}`,
  queue: "sgs:scanQueue",
  deadLetter: "sgs:scanDeadLetter",
  opsQueue: "sgs:opsQueue",
  opsDeadLetter: "sgs:opsDeadLetter",
  lastSync: (groupId: string) => `sgs:lastSync:${groupId}`,
  flightsCache: "sgs:flightsCache",
  flightsCacheAt: "sgs:flightsCacheAt",
  assignmentsCache: "sgs:assignmentsCache",
  groupsCache: (flightId: string) => `sgs:groupsCache:${flightId}`,
  groupsCacheAt: (flightId: string) => `sgs:groupsCacheAt:${flightId}`,
  deviceId: "sgs:deviceId",
};

export const STORAGE_KEYS = KEYS;

// ---------- Stable per-install device id ----------

let _deviceIdCache: string | null = null;

/**
 * Returns a stable UUID for this install, generating one on first call and
 * persisting it to AsyncStorage. Sent on every scan request so the backend
 * can dedupe identical scans coming from the same device (e.g. after an
 * app restart) without conflating them with scans from other devices.
 *
 * Falls back to a freshly generated id if storage is unavailable so callers
 * never see a missing value mid-flow.
 */
export async function getOrCreateDeviceId(): Promise<string> {
  if (_deviceIdCache) return _deviceIdCache;
  try {
    const existing = await AsyncStorage.getItem(KEYS.deviceId);
    if (existing) {
      _deviceIdCache = existing;
      return existing;
    }
  } catch {
    // fall through to generation
  }
  const fresh = generateUuidV4();
  try {
    await AsyncStorage.setItem(KEYS.deviceId, fresh);
  } catch {
    // best-effort persistence; in-memory cache still applies for this session
  }
  _deviceIdCache = fresh;
  return fresh;
}

function generateUuidV4(): string {
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
    else if (i === 14) out += "4";
    else if (i === 19) out += hex[(Math.random() * 4) | 0 | 8];
    else out += hex[(Math.random() * 16) | 0];
  }
  return out;
}

// ---------- Flights / groups offline cache ----------

export async function cacheFlights<T>(flights: T) {
  await AsyncStorage.multiSet([
    [KEYS.flightsCache, JSON.stringify(flights)],
    [KEYS.flightsCacheAt, new Date().toISOString()],
  ]);
}

export async function getCachedFlights<T>(): Promise<{
  data: T | null;
  cachedAt: string | null;
}> {
  const [[, raw], [, at]] = await AsyncStorage.multiGet([
    KEYS.flightsCache,
    KEYS.flightsCacheAt,
  ]);
  return {
    data: raw ? (JSON.parse(raw) as T) : null,
    cachedAt: at ?? null,
  };
}

export async function cacheAssignments<T>(assignments: T) {
  await AsyncStorage.setItem(KEYS.assignmentsCache, JSON.stringify(assignments));
}

export async function getCachedAssignments<T>(): Promise<T | null> {
  const raw = await AsyncStorage.getItem(KEYS.assignmentsCache);
  return raw ? (JSON.parse(raw) as T) : null;
}

export async function cacheGroups<T>(flightId: string, groups: T) {
  await AsyncStorage.multiSet([
    [KEYS.groupsCache(flightId), JSON.stringify(groups)],
    [KEYS.groupsCacheAt(flightId), new Date().toISOString()],
  ]);
}

export async function getCachedGroups<T>(
  flightId: string,
): Promise<{ data: T | null; cachedAt: string | null }> {
  const [[, raw], [, at]] = await AsyncStorage.multiGet([
    KEYS.groupsCache(flightId),
    KEYS.groupsCacheAt(flightId),
  ]);
  return {
    data: raw ? (JSON.parse(raw) as T) : null,
    cachedAt: at ?? null,
  };
}

export async function cacheManifest(groupId: string, bags: ManifestBag[]) {
  await AsyncStorage.multiSet([
    [KEYS.manifest(groupId), JSON.stringify(bags)],
    [KEYS.lastSync(groupId), new Date().toISOString()],
  ]);
}

export async function getCachedManifest(
  groupId: string,
): Promise<ManifestBag[] | null> {
  const raw = await AsyncStorage.getItem(KEYS.manifest(groupId));
  return raw ? (JSON.parse(raw) as ManifestBag[]) : null;
}

export async function getLastSync(groupId: string): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.lastSync(groupId));
}

export async function getScannedTags(groupId: string): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(KEYS.scanned(groupId));
  return new Set(raw ? (JSON.parse(raw) as string[]) : []);
}

export async function markTagScanned(groupId: string, tagNumber: string) {
  const set = await getScannedTags(groupId);
  set.add(tagNumber);
  await AsyncStorage.setItem(
    KEYS.scanned(groupId),
    JSON.stringify(Array.from(set)),
  );
}

// ---------- Offline scan queue ----------

export interface QueuedScan extends ScanRequest {
  localId: string;
  attempts: number;
  lastError?: string;
  nextAttemptAt?: number; // epoch ms; honored by the sync loop's backoff
}

export async function enqueueScan(scan: ScanRequest): Promise<QueuedScan> {
  const queue = await getQueue();
  const item: QueuedScan = {
    ...scan,
    localId: Date.now().toString() + Math.random().toString(36).slice(2, 8),
    attempts: 0,
  };
  queue.push(item);
  await AsyncStorage.setItem(KEYS.queue, JSON.stringify(queue));
  return item;
}

export async function getQueue(): Promise<QueuedScan[]> {
  const raw = await AsyncStorage.getItem(KEYS.queue);
  return raw ? (JSON.parse(raw) as QueuedScan[]) : [];
}

export async function setQueue(queue: QueuedScan[]) {
  await AsyncStorage.setItem(KEYS.queue, JSON.stringify(queue));
}

export async function removeFromQueue(localId: string) {
  const queue = await getQueue();
  await setQueue(queue.filter((q) => q.localId !== localId));
}

export async function moveToDeadLetter(item: QueuedScan) {
  const raw = await AsyncStorage.getItem(KEYS.deadLetter);
  const dl = raw ? (JSON.parse(raw) as QueuedScan[]) : [];
  dl.push(item);
  await AsyncStorage.setItem(KEYS.deadLetter, JSON.stringify(dl));
}

export async function getDeadLetter(): Promise<QueuedScan[]> {
  const raw = await AsyncStorage.getItem(KEYS.deadLetter);
  return raw ? (JSON.parse(raw) as QueuedScan[]) : [];
}

// ---------- Generic ops queue (exceptions + no-tag) ----------
//
// Parallel to the scan queue. Same retry / backoff / dead-letter shape, but
// the payload is one of two discriminated kinds so we can route to the right
// API call when draining. Keeping it separate from the scan queue avoids
// destabilising a critical, well-tested code path.

export type OpKind = "exception" | "noTag";

export interface ExceptionOpPayload {
  tagNumber: string;
  groupId: string;
  flightId: string;
  reason: string;
  notes?: string;
  stage?: "BELT" | "LOADING" | "TRANSIT" | "DELIVERY";
}

export interface NoTagOpPayload {
  pilgrimName: string;
  description: string;
  groupId: string;
  flightId: string;
  stationCode?: string;
  /**
   * Local placeholder tag (e.g. NOTAG-JED-LOCAL-a3f2b1) generated when the
   * agent submits offline. Affixed to the bag immediately so the bag is
   * trackable; replaced by the backend-issued tag once sync succeeds.
   */
  placeholderTag: string;
}

export type QueuedOp =
  | {
      localId: string;
      kind: "exception";
      attempts: number;
      lastError?: string;
      nextAttemptAt?: number;
      createdAt: string;
      payload: ExceptionOpPayload;
    }
  | {
      localId: string;
      kind: "noTag";
      attempts: number;
      lastError?: string;
      nextAttemptAt?: number;
      createdAt: string;
      payload: NoTagOpPayload;
    };

function makeLocalId(): string {
  return Date.now().toString() + Math.random().toString(36).slice(2, 8);
}

export async function enqueueOp(
  op:
    | { kind: "exception"; payload: ExceptionOpPayload }
    | { kind: "noTag"; payload: NoTagOpPayload },
): Promise<QueuedOp> {
  const queue = await getOpQueue();
  const item = {
    localId: makeLocalId(),
    kind: op.kind,
    attempts: 0,
    createdAt: new Date().toISOString(),
    payload: op.payload,
  } as QueuedOp;
  queue.push(item);
  await AsyncStorage.setItem(KEYS.opsQueue, JSON.stringify(queue));
  return item;
}

export async function getOpQueue(): Promise<QueuedOp[]> {
  const raw = await AsyncStorage.getItem(KEYS.opsQueue);
  return raw ? (JSON.parse(raw) as QueuedOp[]) : [];
}

export async function setOpQueue(queue: QueuedOp[]) {
  await AsyncStorage.setItem(KEYS.opsQueue, JSON.stringify(queue));
}

export async function moveOpToDeadLetter(item: QueuedOp) {
  const raw = await AsyncStorage.getItem(KEYS.opsDeadLetter);
  const dl = raw ? (JSON.parse(raw) as QueuedOp[]) : [];
  dl.push(item);
  await AsyncStorage.setItem(KEYS.opsDeadLetter, JSON.stringify(dl));
}

export async function getOpDeadLetter(): Promise<QueuedOp[]> {
  const raw = await AsyncStorage.getItem(KEYS.opsDeadLetter);
  return raw ? (JSON.parse(raw) as QueuedOp[]) : [];
}

export async function clearOpDeadLetter() {
  await AsyncStorage.removeItem(KEYS.opsDeadLetter);
}

/**
 * Builds a human-readable, locally-unique placeholder tag for a no-tag bag
 * raised offline. Format: `NOTAG-<STATION>-LOCAL-<6char>`. The 6-char
 * suffix is randomised so two agents working the same station can't collide
 * even before the backend issues a real tag.
 */
export function buildPlaceholderTag(stationCode: string | undefined): string {
  const station = (stationCode || "XXX").toUpperCase().slice(0, 3);
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `NOTAG-${station}-LOCAL-${suffix}`;
}

/**
 * Swap a tag in the per-group scanned set. Used after a queued no-tag op
 * drains successfully so local counts stay correct: the placeholder we
 * marked scanned at enqueue time is replaced with the backend-issued tag.
 */
export async function replaceScannedTag(
  groupId: string,
  oldTag: string,
  newTag: string,
) {
  const set = await getScannedTags(groupId);
  if (!set.has(oldTag) && set.has(newTag)) return;
  set.delete(oldTag);
  set.add(newTag);
  await AsyncStorage.setItem(
    KEYS.scanned(groupId),
    JSON.stringify(Array.from(set)),
  );
}

export async function clearAll() {
  const keys = await AsyncStorage.getAllKeys();
  const ours = keys.filter((k) => k.startsWith("sgs:"));
  if (ours.length) await AsyncStorage.multiRemove(ours);
}
