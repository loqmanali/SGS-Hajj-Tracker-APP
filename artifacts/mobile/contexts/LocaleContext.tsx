import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Tajawal_400Regular,
  Tajawal_500Medium,
  Tajawal_700Bold,
} from "@expo-google-fonts/tajawal";
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_700Bold,
} from "@expo-google-fonts/dm-sans";
import * as Font from "expo-font";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { I18nManager, Platform } from "react-native";

import { FONTS } from "@/constants/branding";
import { translate, type Locale, type StringKey } from "@/lib/i18n";

const LOCALE_KEY = "sgs.locale";

type LocaleContextValue = {
  ready: boolean;
  locale: Locale;
  isRTL: boolean;
  t: (key: StringKey) => string;
  setLocale: (l: Locale) => Promise<void>;
  fontFamily: Record<keyof typeof FONTS, string>;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * On native we toggle RTL via `I18nManager.forceRTL` so the entire layout
 * mirrors. On web we cannot reload the bundle, so we just flip writingDirection
 * implicitly via I18nManager — text alignment still respects RTL.
 */
async function applyRTL(locale: Locale) {
  const wantRTL = locale === "ar";
  if (I18nManager.isRTL !== wantRTL) {
    try {
      I18nManager.allowRTL(wantRTL);
      I18nManager.forceRTL(wantRTL);
    } catch {
      // ignore
    }
  }
}

/**
 * Remaps the DM Sans font family names to Tajawal glyph files (and back)
 * so every pre-existing StyleSheet that references DMSans_* automatically
 * renders with Tajawal while Arabic is active. This avoids retrofitting
 * every component to look up the locale, and guarantees typography stays
 * in sync with the chosen locale everywhere in the app.
 */
async function applyFontFamily(locale: Locale) {
  try {
    if (locale === "ar") {
      await Font.loadAsync({
        DMSans_400Regular: Tajawal_400Regular,
        DMSans_500Medium: Tajawal_500Medium,
        DMSans_700Bold: Tajawal_700Bold,
      });
    } else {
      await Font.loadAsync({
        DMSans_400Regular,
        DMSans_500Medium,
        DMSans_700Bold,
      });
    }
  } catch {
    // font remap is best-effort; falls back to whatever is already loaded
  }
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [locale, setLocaleState] = useState<Locale>("en");
  const [fontEpoch, setFontEpoch] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(LOCALE_KEY);
        const next: Locale = raw === "ar" ? "ar" : "en";
        setLocaleState(next);
        await applyRTL(next);
        await applyFontFamily(next);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const setLocale = useCallback(async (next: Locale) => {
    setLocaleState(next);
    await AsyncStorage.setItem(LOCALE_KEY, next);
    await applyRTL(next);
    await applyFontFamily(next);
    // Bump the epoch so children remount and re-read the newly registered
    // font glyphs (RN won't re-render mounted text otherwise).
    setFontEpoch((n) => n + 1);
  }, []);

  const t = useCallback(
    (key: StringKey) => translate(locale, key),
    [locale],
  );

  const fontFamily = useMemo<Record<keyof typeof FONTS, string>>(() => {
    if (locale !== "ar") return { ...FONTS };
    return {
      heading: FONTS.arabicBold,
      headingMedium: FONTS.arabic,
      body: FONTS.arabic,
      bodyMedium: FONTS.arabic,
      bodyBold: FONTS.arabicBold,
      arabic: FONTS.arabic,
      arabicBold: FONTS.arabicBold,
    };
  }, [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({
      ready,
      locale,
      isRTL: locale === "ar",
      t,
      setLocale,
      fontFamily,
    }),
    [ready, locale, t, setLocale, fontFamily],
  );

  // Force a full subtree remount on locale / font change so I18nManager and
  // the remapped font registry take effect immediately on every mounted
  // Text / View without requiring a full app reload.
  const wrapperKey = Platform.OS === "web" ? locale : `${locale}-${fontEpoch}`;

  return (
    <LocaleContext.Provider value={value}>
      <React.Fragment key={wrapperKey}>{children}</React.Fragment>
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}
