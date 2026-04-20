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
import colors from "@/constants/colors";
import { FONTS } from "@/constants/branding";
import { useAuth } from "@/contexts/AuthContext";
import { useLocale } from "@/contexts/LocaleContext";
import { useScanQueue } from "@/contexts/ScanQueueContext";
import { useSession } from "@/contexts/SessionContext";
import { sgsApi } from "@/lib/api/sgs";

export default function NoTagScreen() {
  const router = useRouter();
  const session = useSession();
  const auth = useAuth();
  const queue = useScanQueue();
  const { t } = useLocale();
  const insets = useSafeAreaInsets();

  const params = useLocalSearchParams<{ groupId?: string | string[] }>();
  const paramGroupId = Array.isArray(params.groupId)
    ? params.groupId[0]
    : params.groupId;

  const [pickedGroupId, setPickedGroupId] = useState<string | null>(null);
  const groupId =
    paramGroupId ?? session.session?.group?.id ?? pickedGroupId ?? null;

  const groupsQ = useQuery({
    queryKey: ["groups", session.session?.flight.id],
    queryFn: () => sgsApi.groups(session.session!.flight.id),
    enabled: !!session.session && !groupId,
  });

  const [pilgrimName, setPilgrimName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  if (!session.session) return null;

  const submit = async () => {
    if (!groupId) {
      Alert.alert("Pick a group", "Choose which group this bag belongs to.");
      return;
    }
    if (!pilgrimName.trim() || !description.trim()) {
      Alert.alert(
        "Missing info",
        "Provide both a pilgrim name and a bag description.",
      );
      return;
    }
    setBusy(true);
    try {
      // The queue mints a local placeholder tag immediately so the agent
      // can affix something to the bag now. When online, it then attempts
      // the API call inline and (on success) returns the backend-issued
      // `finalTag` — the swap from placeholder→real tag has already been
      // applied to the local scanned set and cached manifest by the time
      // we get here, so the displayed tag is the canonical one.
      const result = await queue.enqueueNoTag({
        pilgrimName: pilgrimName.trim(),
        description: description.trim(),
        groupId: groupId!,
        flightId: session.session!.flight.id,
        // Forward the agent's station code (e.g. "JED") so the backend
        // generates a tag like "NOTAG-JED-006" rather than defaulting to
        // an unknown station segment.
        stationCode: auth.user?.stationCode,
      });
      const tagToShow =
        result.status === "submitted" ? result.finalTag : result.placeholderTag;
      Alert.alert(
        result.status === "submitted" ? t("tagGenerated") : t("queuedOffline"),
        `${result.status === "submitted" ? t("noTagGeneratedBody") : t("noTagQueuedBody")}\n\n${tagToShow}`,
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (err) {
      Alert.alert("Failed", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!groupId) {
    return (
      <View style={styles.flex}>
        <ScreenHeader
          title="No-Tag Bag"
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

  return (
    <View style={styles.flex}>
      <ScreenHeader title="No-Tag Bag" onBack={() => router.back()} />
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
            label="Pilgrim name"
            value={pilgrimName}
            onChangeText={setPilgrimName}
            autoCapitalize="words"
            placeholder="Full name"
          />
          <Field
            label="Bag description"
            value={description}
            onChangeText={setDescription}
            placeholder="Color, size, brand, distinguishing marks…"
            multiline
            numberOfLines={4}
            style={{ minHeight: 100, textAlignVertical: "top" }}
          />
          <PrimaryButton
            label="Generate tag & log"
            onPress={submit}
            loading={busy}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.sgs.black },
  scroll: { padding: 16, gap: 12 },
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
