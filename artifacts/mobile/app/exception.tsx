import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Field } from "@/components/Field";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { FONTS } from "@/constants/branding";
import colors from "@/constants/colors";
import { useLocale } from "@/contexts/LocaleContext";
import { useScanQueue } from "@/contexts/ScanQueueContext";
import { useSession } from "@/contexts/SessionContext";
import { sgsApi } from "@/lib/api/sgs";

const REASONS = [
  { value: "MISSING", label: "Missing" },
  { value: "DAMAGED", label: "Damaged" },
  { value: "DELAYED", label: "Delayed" },
  { value: "CUSTOMS_HOLD", label: "Customs hold" },
] as const;

export default function ExceptionScreen() {
  const router = useRouter();
  const session = useSession();
  const queue = useScanQueue();
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  // Accept ?tag=... and ?groupId=... from the scan screen. The tag
  // pre-fills the form on red flash. The groupId routes the exception
  // to the right group when the agent reached this screen from a
  // group card; otherwise we fall back to a session-pinned group.
  const params = useLocalSearchParams<{
    tag?: string | string[];
    groupId?: string | string[];
  }>();
  const initialTag = Array.isArray(params.tag) ? params.tag[0] : params.tag;
  const paramGroupId = Array.isArray(params.groupId)
    ? params.groupId[0]
    : params.groupId;
  const [pickedGroupId, setPickedGroupId] = useState<string | null>(null);
  const groupId =
    paramGroupId ?? session.session?.group?.id ?? pickedGroupId ?? null;

  // Lazy fetch of groups for the picker fallback. Only enabled when no
  // group has been resolved any other way, so the network call is
  // skipped on the common scan→exception path that already passes
  // ?groupId.
  const groupsQ = useQuery({
    queryKey: ["groups", session.session?.flight.id],
    queryFn: () => sgsApi.groups(session.session!.flight.id),
    enabled: !!session.session && !groupId,
  });

  const [tag, setTag] = useState(initialTag ?? "");
  const [reason, setReason] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  if (!session.session) return null;

  if (!groupId) {
    return (
      <View style={styles.flex}>
        <ScreenHeader
          title="Log Exception"
          subtitle={t("pickGroup")}
          onBack={() => router.back()}
        />
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + 24 },
          ]}
        >
          <Text style={styles.pickerHint}>{t("pickGroupHint")}</Text>
          {groupsQ.isLoading ? (
            <ActivityIndicator color={colors.sgs.green} />
          ) : (groupsQ.data ?? []).length === 0 ? (
            <Text style={styles.pickerHint}>{t("noGroupsForFlight")}</Text>
          ) : (
            (groupsQ.data ?? []).map((g) => (
              <Pressable
                key={g.id}
                onPress={() => setPickedGroupId(g.id)}
                style={({ pressed }) => [
                  styles.pickerRow,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Text style={styles.pickerRowTitle}>{g.groupNumber}</Text>
                <Text style={styles.pickerRowSub}>
                  {g.scannedBags}/{g.expectedBags}
                </Text>
              </Pressable>
            ))
          )}
        </ScrollView>
      </View>
    );
  }

  const submit = async () => {
    if (!groupId) {
      Alert.alert(
        "Pick a group",
        "Open this screen from a group card so the exception is routed correctly.",
      );
      return;
    }
    if (!tag.trim() || !reason) {
      Alert.alert("Missing info", "Enter a tag number and select a reason.");
      return;
    }
    setBusy(true);
    try {
      // Always go through the queue. The queue persists first (durability),
      // then attempts the API call inline when online and resolves with a
      // drain-confirmed status — so we only show "Logged" if the server
      // really accepted it. On failure (timeout, 5xx, offline), the entry
      // remains queued with retry/backoff and we tell the agent it's
      // saved locally and will sync.
      const result = await queue.enqueueException({
        tagNumber: tag.trim(),
        groupId: groupId!,
        flightId: session.session!.flight.id,
        reason,
        notes: notes.trim() || undefined,
      });
      Alert.alert(
        result.status === "submitted" ? t("logged") : t("queuedOffline"),
        result.status === "submitted"
          ? t("exceptionLoggedBody")
          : t("exceptionQueuedBody"),
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (err) {
      Alert.alert("Failed", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.flex}>
      <ScreenHeader title="Log Exception" onBack={() => router.back()} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <Field
            label="Tag Number"
            value={tag}
            onChangeText={setTag}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="e.g. SGS-1923-441"
          />

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Reason</Text>
            <View style={styles.chips}>
              {REASONS.map((r) => {
                const active = r.value === reason;
                return (
                  <Pressable
                    key={r.value}
                    onPress={() => setReason(r.value)}
                    style={[
                      styles.chip,
                      active && {
                        backgroundColor: colors.sgs.green,
                        borderColor: colors.sgs.green,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipTxt,
                        active && { color: colors.sgs.black },
                      ]}
                    >
                      {r.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Field
            label="Notes (optional)"
            value={notes}
            onChangeText={setNotes}
            placeholder="Describe the issue…"
            multiline
            numberOfLines={4}
            style={{ minHeight: 100, textAlignVertical: "top" }}
          />

          <PrimaryButton label="Log exception" onPress={submit} loading={busy} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.sgs.black },
  scroll: { padding: 16, gap: 20 },
  section: { gap: 10 },
  sectionLabel: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 13,
    color: colors.sgs.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.sgs.border,
    backgroundColor: colors.sgs.surface,
  },
  chipTxt: {
    color: colors.sgs.textPrimary,
    fontFamily: FONTS.bodyMedium,
    fontSize: 13,
  },
  pickerHint: {
    color: colors.sgs.textMuted,
    fontFamily: FONTS.body,
    fontSize: 13,
    paddingVertical: 4,
  },
  pickerRow: {
    backgroundColor: colors.sgs.surface,
    borderColor: colors.sgs.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pickerRowTitle: {
    color: colors.sgs.textPrimary,
    fontFamily: FONTS.bodyBold,
    fontSize: 15,
  },
  pickerRowSub: {
    color: colors.sgs.textMuted,
    fontFamily: FONTS.body,
    fontSize: 13,
  },
});
