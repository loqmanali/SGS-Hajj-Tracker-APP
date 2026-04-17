import * as Updates from "expo-updates";
import { useCallback, useEffect, useRef, useState } from "react";

export type OtaCheckPhase =
  | "idle"
  | "checking"
  | "upToDate"
  | "downloading"
  | "ready"
  | "applying";

const UP_TO_DATE_RESET_MS = 3000;

/**
 * Drives a "check for updates" button. Maintains its own inline state machine
 * so the settings screen can show progress, while still relying on
 * `expo-updates` global state — `OtaUpdateGate` listens to `useUpdates()` and
 * will surface the apply prompt automatically once an update is downloaded.
 *
 * `apply()` is exposed so the button can also reload immediately when an
 * agent explicitly taps it after a successful download.
 */
export function useOtaUpdater() {
  const [phase, setPhase] = useState<OtaCheckPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearResetTimer = useCallback(() => {
    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  const check = useCallback(async () => {
    clearResetTimer();
    setError(null);

    if (!Updates.isEnabled || __DEV__) {
      setPhase("upToDate");
      resetTimer.current = setTimeout(() => setPhase("idle"), UP_TO_DATE_RESET_MS);
      return;
    }

    setPhase("checking");
    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) {
        setPhase("upToDate");
        resetTimer.current = setTimeout(
          () => setPhase("idle"),
          UP_TO_DATE_RESET_MS,
        );
        return;
      }
      setPhase("downloading");
      const fetched = await Updates.fetchUpdateAsync();
      if (fetched.isNew) {
        setPhase("ready");
      } else {
        setPhase("upToDate");
        resetTimer.current = setTimeout(
          () => setPhase("idle"),
          UP_TO_DATE_RESET_MS,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    }
  }, [clearResetTimer]);

  const apply = useCallback(async () => {
    clearResetTimer();
    setError(null);
    setPhase("applying");
    try {
      await Updates.reloadAsync();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("ready");
    }
  }, [clearResetTimer]);

  return { phase, error, check, apply };
}
