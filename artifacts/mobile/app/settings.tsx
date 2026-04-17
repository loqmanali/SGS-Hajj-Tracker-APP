import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ScreenHeader } from "@/components/ScreenHeader";
import { FONTS } from "@/constants/branding";
import colors from "@/constants/colors";
import { useLocale } from "@/contexts/LocaleContext";
import { useOtaUpdater, type OtaCheckPhase } from "@/hooks/useOtaUpdater";
import type { StringKey } from "@/lib/i18n";

type T = (k: StringKey) => string;

export default function SettingsScreen() {
  const router = useRouter();
  const { t } = useLocale();
  const { phase, error, check, apply } = useOtaUpdater();

  const buildLabel = useMemo(() => {
    const v = Constants.expoConfig?.version ?? "—";
    const runtime = Constants.expoConfig?.runtimeVersion;
    return runtime ? `v${v} · runtime ${runtime}` : `v${v}`;
  }, []);

  return (
    <View style={styles.flex}>
      <ScreenHeader title={t("settings")} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("appUpdates")}</Text>
          <Text style={styles.sectionBody}>{t("appUpdatesBody")}</Text>

          <UpdateButton
            phase={phase}
            onCheck={check}
            onApply={apply}
            t={t}
          />

          <Text style={styles.statusLine}>
            <StatusText phase={phase} t={t} />
          </Text>
          {error ? <Text style={styles.errorLine}>{error}</Text> : null}
          <Text style={styles.metaLine}>{buildLabel}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function UpdateButton({
  phase,
  onCheck,
  onApply,
  t,
}: {
  phase: OtaCheckPhase;
  onCheck: () => void;
  onApply: () => void;
  t: T;
}) {
  const busy =
    phase === "checking" || phase === "downloading" || phase === "applying";
  const isReady = phase === "ready";
  const onPress = isReady ? onApply : onCheck;
  const label = isReady
    ? t("applyUpdateNow")
    : phase === "checking"
      ? t("checking")
      : phase === "downloading"
        ? t("downloading")
        : phase === "applying"
          ? t("applying")
          : t("checkForUpdates");

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy, busy }}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: isReady ? colors.sgs.green : colors.sgs.surfaceElevated,
          borderColor: isReady ? colors.sgs.green : colors.sgs.borderStrong,
          opacity: busy ? 0.7 : pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.btnRow}>
        {busy ? (
          <ActivityIndicator
            color={isReady ? colors.sgs.black : colors.sgs.textPrimary}
          />
        ) : (
          <Feather
            name={isReady ? "download" : "refresh-cw"}
            size={18}
            color={isReady ? colors.sgs.black : colors.sgs.textPrimary}
          />
        )}
        <Text
          style={[
            styles.btnLabel,
            { color: isReady ? colors.sgs.black : colors.sgs.textPrimary },
          ]}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

function StatusText({
  phase,
  t,
}: {
  phase: OtaCheckPhase;
  t: T;
}) {
  switch (phase) {
    case "checking":
      return <>{t("checking")}</>;
    case "downloading":
      return <>{t("downloading")}</>;
    case "ready":
      return <>{t("updateReady")}</>;
    case "applying":
      return <>{t("applying")}</>;
    case "upToDate":
      return <>{t("upToDate")}</>;
    case "idle":
    default:
      return <>{t("checkForUpdatesHint")}</>;
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.sgs.black },
  content: { padding: 16, gap: 16 },
  section: {
    backgroundColor: colors.sgs.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.sgs.border,
    padding: 16,
    gap: 10,
  },
  sectionTitle: {
    fontFamily: FONTS.bodyBold,
    fontSize: 16,
    color: colors.sgs.textPrimary,
  },
  sectionBody: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: colors.sgs.textMuted,
    lineHeight: 18,
  },
  btn: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    marginTop: 4,
  },
  btnRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  btnLabel: {
    fontFamily: FONTS.bodyBold,
    fontSize: 15,
    letterSpacing: 0.2,
  },
  statusLine: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: colors.sgs.textMuted,
    marginTop: 4,
  },
  errorLine: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: colors.sgs.flashRed,
  },
  metaLine: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: colors.sgs.textDim,
    marginTop: 4,
  },
});
