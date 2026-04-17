import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { SGS_BASE_URL, sgsApi, type ScanRequest } from "@/lib/api/sgs";
import {
  buildPlaceholderTag,
  clearOpDeadLetter,
  enqueueOp,
  enqueueScan,
  getDeadLetter,
  getOpDeadLetter,
  getOpQueue,
  getOrCreateDeviceId,
  getQueue,
  markTagScanned,
  moveOpToDeadLetter,
  moveToDeadLetter,
  replaceScannedTag,
  setOpQueue,
  setQueue,
  type ExceptionOpPayload,
  type NoTagOpPayload,
  type QueuedOp,
  type QueuedScan,
} from "@/lib/db/storage";
import AsyncStorage from "@react-native-async-storage/async-storage";

const MAX_ATTEMPTS = 5;
// Per-attempt backoff in milliseconds: 2s, 4s, 8s, 16s, 32s.
const BACKOFF_MS = [2_000, 4_000, 8_000, 16_000, 32_000];

type ScanQueueContextValue = {
  // Scan queue (kept name for backwards compat — header pill / scan-screen
  // counters consume these).
  queueSize: number;
  deadLetterSize: number;
  // Generic ops queue (exceptions + no-tag).
  opsQueueSize: number;
  opsDeadLetterSize: number;
  // Convenience totals for UI that wants a single "any unsynced work" number.
  pendingTotal: number;
  deadLetterTotal: number;
  online: boolean;
  syncing: boolean;
  enqueue: (scan: ScanRequest) => Promise<void>;
  enqueueException: (
    payload: Omit<ExceptionOpPayload, never>,
  ) => Promise<void>;
  /**
   * Enqueues a no-tag registration. Returns the locally-generated placeholder
   * tag the agent should affix to the bag immediately. The placeholder is
   * also added to the per-group scanned set so totals stay correct, then
   * swapped for the backend-issued tag once the op drains.
   */
  enqueueNoTag: (
    payload: Omit<NoTagOpPayload, "placeholderTag">,
  ) => Promise<{ placeholderTag: string }>;
  syncNow: () => Promise<void>;
  retryDeadLetter: () => Promise<void>;
  discardDeadLetter: () => Promise<void>;
};

const Ctx = createContext<ScanQueueContextValue | null>(null);

export function ScanQueueProvider({ children }: { children: React.ReactNode }) {
  const [queueSize, setQueueSize] = useState(0);
  const [deadLetterSize, setDeadLetterSize] = useState(0);
  const [opsQueueSize, setOpsQueueSize] = useState(0);
  const [opsDeadLetterSize, setOpsDeadLetterSize] = useState(0);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    const [q, dl, oq, odl] = await Promise.all([
      getQueue(),
      getDeadLetter(),
      getOpQueue(),
      getOpDeadLetter(),
    ]);
    setQueueSize(q.length);
    setDeadLetterSize(dl.length);
    setOpsQueueSize(oq.length);
    setOpsDeadLetterSize(odl.length);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Heuristic online check: ping our base URL periodically. NetInfo would be
  // ideal but isn't required for Expo Go and avoids an extra native dep.
  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      try {
        // The SGS backend exposes /api/health (not /api/healthz). The old
        // /api/healthz path was masked by `res.status < 500` accepting the
        // 404 — which meant we were reporting "online" anytime the API was
        // reachable, even if the rest of it was actually broken. Hit the
        // real health endpoint and require a 2xx.
        const res = await fetch(`${SGS_BASE_URL}/api/health`, {
          method: "GET",
        });
        if (!cancelled) setOnline(res.ok);
      } catch {
        if (!cancelled) setOnline(false);
      }
    };
    ping();
    const id = setInterval(ping, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Drain the scan queue once. Mirrors the original logic; isolated into a
  // helper so syncNow can drive both queues in one pass.
  const drainScans = useCallback(async () => {
    const queue = await getQueue();
    if (queue.length === 0) return;
    const remaining: QueuedScan[] = [];
    const now = Date.now();
    for (const item of queue) {
      if (item.attempts > 0 && item.nextAttemptAt && item.nextAttemptAt > now) {
        remaining.push(item);
        continue;
      }
      try {
        await sgsApi.submitScan(item);
      } catch (err) {
        item.attempts += 1;
        item.lastError = (err as Error).message;
        if (item.attempts < MAX_ATTEMPTS) {
          const wait =
            BACKOFF_MS[Math.min(item.attempts - 1, BACKOFF_MS.length - 1)];
          item.nextAttemptAt = now + wait;
          remaining.push(item);
        } else {
          await moveToDeadLetter(item);
        }
      }
    }
    // Merge anything enqueued during the drain so we don't lose mid-flight scans.
    const currentQueue = await getQueue();
    const seen = new Set(queue.map((q) => q.localId));
    const arrived = currentQueue.filter((q) => !seen.has(q.localId));
    await setQueue([...remaining, ...arrived]);
  }, []);

  // Drain the ops queue (exceptions + no-tag). Each kind routes to its own
  // API call; on no-tag success we swap the placeholder for the real tag in
  // the local scanned-set so per-group counts stay consistent.
  const drainOps = useCallback(async () => {
    const queue = await getOpQueue();
    if (queue.length === 0) return;
    const remaining: QueuedOp[] = [];
    const now = Date.now();
    for (const item of queue) {
      if (item.attempts > 0 && item.nextAttemptAt && item.nextAttemptAt > now) {
        remaining.push(item);
        continue;
      }
      try {
        if (item.kind === "exception") {
          await sgsApi.submitException({
            tagNumber: item.payload.tagNumber,
            groupId: item.payload.groupId,
            flightId: item.payload.flightId,
            reason: item.payload.reason,
            notes: item.payload.notes,
            stage: item.payload.stage,
          });
        } else {
          const res = await sgsApi.registerNoTag({
            pilgrimName: item.payload.pilgrimName,
            description: item.payload.description,
            groupId: item.payload.groupId,
            flightId: item.payload.flightId,
            stationCode: item.payload.stationCode,
          });
          // Swap the placeholder we marked scanned at enqueue time with the
          // real backend-issued tag so future displays / totals reference
          // the canonical id rather than the local-only placeholder.
          if (res.tagNumber && res.tagNumber !== item.payload.placeholderTag) {
            await replaceScannedTag(
              item.payload.groupId,
              item.payload.placeholderTag,
              res.tagNumber,
            );
          }
        }
      } catch (err) {
        item.attempts += 1;
        item.lastError = (err as Error).message;
        if (item.attempts < MAX_ATTEMPTS) {
          const wait =
            BACKOFF_MS[Math.min(item.attempts - 1, BACKOFF_MS.length - 1)];
          item.nextAttemptAt = now + wait;
          remaining.push(item);
        } else {
          await moveOpToDeadLetter(item);
        }
      }
    }
    const currentQueue = await getOpQueue();
    const seen = new Set(queue.map((o) => o.localId));
    const arrived = currentQueue.filter((o) => !seen.has(o.localId));
    await setOpQueue([...remaining, ...arrived]);
  }, []);

  const syncNow = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    setSyncing(true);
    try {
      // Run sequentially to keep request pressure bounded on flaky belt
      // wifi and to avoid two concurrent merges into the same per-queue
      // storage slot.
      await drainScans();
      await drainOps();
      await refresh();
    } finally {
      setSyncing(false);
      refreshing.current = false;
    }
  }, [drainOps, drainScans, refresh]);

  const retryDeadLetter = useCallback(async () => {
    // Reset attempt counters on every dead-letter entry across BOTH queues
    // and merge them back into their live queues.
    const [scanDl, opDl] = await Promise.all([
      getDeadLetter(),
      getOpDeadLetter(),
    ]);
    if (scanDl.length === 0 && opDl.length === 0) return;
    if (scanDl.length > 0) {
      const reset = scanDl.map((item) => ({
        ...item,
        attempts: 0,
        nextAttemptAt: undefined,
        lastError: undefined,
      }));
      const queue = await getQueue();
      await setQueue([...queue, ...reset]);
      await AsyncStorage.removeItem("sgs:scanDeadLetter");
    }
    if (opDl.length > 0) {
      const reset = opDl.map(
        (item) =>
          ({
            ...item,
            attempts: 0,
            nextAttemptAt: undefined,
            lastError: undefined,
          }) as QueuedOp,
      );
      const queue = await getOpQueue();
      await setOpQueue([...queue, ...reset]);
      await clearOpDeadLetter();
    }
    await refresh();
    syncNow().catch(() => undefined);
  }, [refresh, syncNow]);

  const discardDeadLetter = useCallback(async () => {
    await Promise.all([
      AsyncStorage.removeItem("sgs:scanDeadLetter"),
      clearOpDeadLetter(),
    ]);
    await refresh();
  }, [refresh]);

  const enqueue = useCallback(
    async (scan: ScanRequest) => {
      // Backstop: every persisted scan MUST carry the stable per-install
      // deviceId so the backend can dedupe across devices. Callers may
      // pre-fill it (scan.tsx caches it on mount); if they don't (or if
      // the cache hadn't resolved before the first scan), hydrate it
      // here. AsyncStorage round-trip is ~1ms in practice and only
      // happens on the very first scan after launch.
      const withDeviceId: ScanRequest = scan.deviceId
        ? scan
        : { ...scan, deviceId: await getOrCreateDeviceId() };
      await enqueueScan(withDeviceId);
      await refresh();
      if (online) syncNow().catch(() => undefined);
    },
    [online, refresh, syncNow],
  );

  const enqueueException = useCallback(
    async (payload: ExceptionOpPayload) => {
      await enqueueOp({ kind: "exception", payload });
      await refresh();
      if (online) syncNow().catch(() => undefined);
    },
    [online, refresh, syncNow],
  );

  const enqueueNoTag = useCallback(
    async (payload: Omit<NoTagOpPayload, "placeholderTag">) => {
      const placeholderTag = buildPlaceholderTag(payload.stationCode);
      const full: NoTagOpPayload = { ...payload, placeholderTag };
      // Mark the placeholder scanned so the per-group count reflects the
      // bag immediately. It will be swapped for the real tag once the op
      // drains — see drainOps above.
      await markTagScanned(payload.groupId, placeholderTag);
      await enqueueOp({ kind: "noTag", payload: full });
      await refresh();
      if (online) syncNow().catch(() => undefined);
      return { placeholderTag };
    },
    [online, refresh, syncNow],
  );

  // Auto-sync when coming online — drain whichever queue has work.
  useEffect(() => {
    if (online && (queueSize > 0 || opsQueueSize > 0))
      syncNow().catch(() => undefined);
  }, [online, queueSize, opsQueueSize, syncNow]);

  // Periodic sync every 30s
  useEffect(() => {
    const id = setInterval(() => {
      if (online) syncNow().catch(() => undefined);
    }, 30000);
    return () => clearInterval(id);
  }, [online, syncNow]);

  const pendingTotal = queueSize + opsQueueSize;
  const deadLetterTotal = deadLetterSize + opsDeadLetterSize;

  const value = useMemo(
    () => ({
      queueSize,
      deadLetterSize,
      opsQueueSize,
      opsDeadLetterSize,
      pendingTotal,
      deadLetterTotal,
      online,
      syncing,
      enqueue,
      enqueueException,
      enqueueNoTag,
      syncNow,
      retryDeadLetter,
      discardDeadLetter,
    }),
    [
      queueSize,
      deadLetterSize,
      opsQueueSize,
      opsDeadLetterSize,
      pendingTotal,
      deadLetterTotal,
      online,
      syncing,
      enqueue,
      enqueueException,
      enqueueNoTag,
      syncNow,
      retryDeadLetter,
      discardDeadLetter,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useScanQueue() {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error("useScanQueue must be used within ScanQueueProvider");
  return ctx;
}
