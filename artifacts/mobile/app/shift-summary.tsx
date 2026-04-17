import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { FONTS } from "@/constants/branding";
import colors from "@/constants/colors";
import { useAuth } from "@/contexts/AuthContext";
import { useLocale } from "@/contexts/LocaleContext";
import { useScanQueue } from "@/contexts/ScanQueueContext";
import { useSession } from "@/contexts/SessionContext";
import {
  getCachedManifest,
  getScannedTags,
} from "@/lib/db/storage";

export default function ShiftSummaryScreen() {
  const router = useRouter();
  const session = useSession();
  const queue = useScanQueue();
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const { t, isRTL } = useLocale();

  const [scanned, setScanned] = useState(0);
  const [expected, setExpected] = useState(0);
  const [exceptionCount, setExceptionCount] = useState(0);

  useEffect(() => {
    if (!session.session) return;
    (async () => {
      const groupId = session.session!.group.id;
      const tags = await getScannedTags(groupId);
      const manifest = (await getCachedManifest(groupId)) ?? [];
      setScanned(tags.size);
      setExpected(session.session!.group.expectedBags);
      setExceptionCount(
        manifest.filter((b) => b.status === "exception").length,
      );
    })();
  }, [session.session]);

  if (!session.session) {
    return null;
  }

  const remaining = Math.max(0, expected - scanned);
  const matchPct = expected ? Math.round((scanned / expected) * 100) : 0;

  const startedAt = new Date(session.session.startedAt);
  const durationMin = Math.max(
    1,
    Math.round((Date.now() - startedAt.getTime()) / 60000),
  );

  const onEndShift = async () => {
    await session.setSession(null);
    router.replace("/session-setup");
  };

  return (
    <View style={styles.flex}>
      <ScreenHeader
        title={t("shiftSummary")}
        subtitle={`${session.session.flight.flightNumber} · ${t("groupLabel")} ${session.session.group.groupNumber}`}
        onBack={() => router.back()}
      />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 24 },
        ]}
      >
        <View style={styles.heroCard}>
          <Text style={styles.heroPct}>{matchPct}%</Text>
          <Text style={styles.heroSub}>
            {scanned}/{expected} {t("scanned")}
          </Text>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.min(100, matchPct)}%` },
              ]}
            />
          </View>
        </View>

        <Text style={styles.sectionLabel}>{t("totals")}</Text>
        <View style={styles.statGrid}>
          <Stat label={t("expectedBags")} value={expected} />
          <Stat label={t("scannedBags")} value={scanned} accent="green" />
          <Stat
            label={t("remainingBags")}
            value={remaining}
            accent={remaining > 0 ? "amber" : undefined}
          />
          <Stat
            label={t("exceptions")}
            value={exceptionCount}
            accent={exceptionCount > 0 ? "red" : undefined}
          />
          <Stat label={t("duration")} value={`${durationMin}m`} />
          <Stat label={t("pendingScans")} value={queue.queueSize} />
        </View>

        <Text style={styles.sectionLabel}>{t("syncStatus")}</Text>
        <View style={styles.syncCard}>
          <View
            style={[
              styles.syncRow,
              isRTL && { flexDirection: "row-reverse" },
            ]}
          >
            <Feather
              name={queue.online ? "wifi" : "wifi-off"}
              size={18}
              color={queue.online ? colors.sgs.green : colors.sgs.flashAmber}
            />
            <Text style={styles.syncTxt}>
              {queue.online ? t("online") : t("offline")}
            </Text>
            {queue.syncing ? (
              <Text style={styles.syncDim}>· {t("loading")}</Text>
            ) : null}
          </View>
          <Text style={styles.syncDim}>
            {t("pendingScans")}: {queue.queueSize}
            {queue.deadLetterSize > 0
              ? ` · ${t("failedScans")}: ${queue.deadLetterSize}`
              : ""}
          </Text>
          {auth.lastSyncAt ? (
            <Text style={styles.syncDim}>
              {t("lastSync")}: {new Date(auth.lastSyncAt).toLocaleTimeString()}
            </Text>
          ) : null}
        </View>

        <View style={{ height: 16 }} />
        <PrimaryButton
          label={t("endShift")}
          onPress={onEndShift}
          variant="danger"
        />
        <View style={{ height: 8 }} />
        <PrimaryButton
          label={t("resumeSession")}
          onPress={() => router.replace("/scan")}
          variant="ghost"
        />
      </ScrollView>
    </View>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: "green" | "amber" | "red";
}) {
  const color =
    accent === "green"
      ? colors.sgs.green
      : accent === "amber"
        ? colors.sgs.flashAmber
        : accent === "red"
          ? colors.sgs.flashRed
          : colors.sgs.textPrimary;
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.sgs.black },
  scroll: { padding: 16, gap: 14 },
  heroCard: {
    backgroundColor: colors.sgs.surface,
    borderColor: colors.sgs.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    gap: 8,
  },
  heroPct: {
    fontFamily: FONTS.bodyBold,
    fontSize: 56,
    color: colors.sgs.textPrimary,
    letterSpacing: -1,
  },
  heroSub: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: colors.sgs.textMuted,
  },
  progressTrack: {
    width: "100%",
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.sgs.surfaceElevated,
    overflow: "hidden",
    marginTop: 12,
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.sgs.green,
  },
  sectionLabel: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 12,
    color: colors.sgs.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 6,
  },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  statCard: {
    flexGrow: 1,
    flexBasis: "30%",
    minWidth: 100,
    backgroundColor: colors.sgs.surface,
    borderColor: colors.sgs.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  statValue: {
    fontFamily: FONTS.bodyBold,
    fontSize: 22,
  },
  statLabel: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: colors.sgs.textMuted,
  },
  syncCard: {
    backgroundColor: colors.sgs.surface,
    borderColor: colors.sgs.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  syncRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  syncTxt: {
    fontFamily: FONTS.bodyMedium,
    color: colors.sgs.textPrimary,
    fontSize: 14,
  },
  syncDim: {
    fontFamily: FONTS.body,
    color: colors.sgs.textMuted,
    fontSize: 12,
  },
});
