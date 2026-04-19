import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  isBiometricAvailable,
  isBiometricEnabled,
  setBiometricEnabled,
} from "@/components/BiometricLockGate";
import { Field } from "@/components/Field";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SGSLogo } from "@/components/SGSLogo";
import { APP_NAME, FONTS, ORG } from "@/constants/branding";
import colors from "@/constants/colors";
import { useAuth } from "@/contexts/AuthContext";
import { useLocale } from "@/contexts/LocaleContext";
import { ApiError, SGS_BASE_URL, checkReachability } from "@/lib/api/sgs";

export default function LoginScreen() {
  const router = useRouter();
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const { t, locale, setLocale, isRTL } = useLocale();
  // Surface the API host so any future base-URL misconfiguration is
  // visible in the field without needing to attach a debugger.
  const apiHost = React.useMemo(() => {
    try {
      return new URL(SGS_BASE_URL).host;
    } catch {
      return SGS_BASE_URL;
    }
  }, []);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [available, enabled] = await Promise.all([
        isBiometricAvailable(),
        isBiometricEnabled(),
      ]);
      setBioAvailable(available);
      setBioEnabled(enabled);
    })();
  }, []);

  const fmt = (template: string, vars: Record<string, string | number>) =>
    template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));

  const onSubmit = async () => {
    if (!username.trim() || !password) {
      setError(t("enterCredentials"));
      return;
    }
    setBusy(true);
    setError(null);
    setCheckResult(null);
    try {
      await auth.signIn(username.trim(), password);
      // Persist biometric preference selected on this screen so the next
      // cold-start uses quick-unlock.
      await setBiometricEnabled(bioEnabled && bioAvailable);
      router.replace("/session-setup");
    } catch (err) {
      // The login screen used to map every TypeError ("Network request
      // failed") to "offlineLogin", which hid 401/429/5xx behind the
      // wrong copy. Now we distinguish four buckets so operators (and
      // support) can see the actual reason.
      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 403) {
          setError(t("loginInvalidCreds"));
        } else if (err.status === 429) {
          const retry =
            (err as ApiError & { retryAfter?: number }).retryAfter ?? 60;
          setError(fmt(t("loginRateLimited"), { n: retry }));
        } else if (err.status >= 500) {
          setError(fmt(t("loginServerError"), { code: err.status }));
        } else {
          setError(err.message || t("loginFailed"));
        }
      } else if (err instanceof TypeError) {
        // Transport-layer failure: DNS, TLS, connection reset, carrier
        // APN whitelist block. React Native fetch raises a generic
        // "Network request failed" TypeError for all of these — surface
        // the actual host so the operator knows what to whitelist or
        // which Wi-Fi to switch to.
        setError(fmt(t("loginUnreachable"), { host: apiHost }));
      } else {
        // Unknown internal error — don't mislabel it as a reachability
        // problem. Surface the raw message if any, else the generic
        // "Login failed" copy.
        const msg = (err as Error)?.message;
        setError(msg || t("loginFailed"));
      }
    } finally {
      setBusy(false);
    }
  };

  const onTestConnection = async () => {
    setChecking(true);
    setCheckResult(null);
    setError(null);
    try {
      const r = await checkReachability();
      if (r.ok) {
        setCheckResult(fmt(t("loginCheckOk"), { ms: r.ms }));
      } else {
        const reason = r.status
          ? `HTTP ${r.status}`
          : r.error || "network error";
        setCheckResult(fmt(t("loginCheckBad"), { reason }));
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.langRow}>
          <Pressable
            onPress={() => setLocale(locale === "ar" ? "en" : "ar")}
            hitSlop={12}
            style={styles.langBtn}
          >
            <Text style={styles.langTxt}>{t("language")}</Text>
          </Pressable>
        </View>

        <View style={styles.brand}>
          <SGSLogo size={84} />
          <Text style={styles.appName}>{APP_NAME}</Text>
          <Text style={styles.org}>{t("org")}</Text>
        </View>

        <View style={styles.form}>
          <Field
            label={t("agentId")}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="e.g. SGS-1042"
            returnKeyType="next"
          />
          <Field
            label={t("password")}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
            returnKeyType="go"
            onSubmitEditing={onSubmit}
          />
          {bioAvailable ? (
            <View
              style={[
                styles.bioRow,
                isRTL && { flexDirection: "row-reverse" },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.bioTitle}>{t("unlockBiometric")}</Text>
                <Text style={styles.bioSub}>{t("useBiometric")}</Text>
              </View>
              <Switch
                value={bioEnabled}
                onValueChange={setBioEnabled}
                trackColor={{
                  false: colors.sgs.border,
                  true: colors.sgs.green,
                }}
                thumbColor={colors.sgs.textPrimary}
              />
            </View>
          ) : null}
          {error ? <Text style={styles.errorTxt}>{error}</Text> : null}
          {checkResult ? (
            <Text style={styles.infoTxt}>{checkResult}</Text>
          ) : null}
          <PrimaryButton label={t("signIn")} onPress={onSubmit} loading={busy} />
          <PrimaryButton
            label={checking ? t("loginCheckRunning") : t("loginCheckHost")}
            variant="ghost"
            onPress={onTestConnection}
            loading={checking}
          />
        </View>

        <Text style={styles.footer}>
          {t("appTagline")}
          {auth.lastSyncAt
            ? `\n${t("lastSync")} ${new Date(auth.lastSyncAt).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}`
            : ""}
          {`\nAPI: ${apiHost}`}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.sgs.black },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    gap: 32,
  },
  brand: { alignItems: "center", gap: 14 },
  appName: {
    fontFamily: FONTS.bodyBold,
    fontSize: 28,
    color: colors.sgs.textPrimary,
    letterSpacing: -0.5,
    marginTop: 4,
  },
  org: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: colors.sgs.textMuted,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  form: { gap: 18 },
  langRow: { alignItems: "flex-end" },
  langBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.sgs.border,
  },
  langTxt: {
    fontFamily: FONTS.bodyMedium,
    color: colors.sgs.textPrimary,
    fontSize: 13,
  },
  bioRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 4,
  },
  bioTitle: {
    fontFamily: FONTS.bodyMedium,
    color: colors.sgs.textPrimary,
    fontSize: 14,
  },
  bioSub: {
    fontFamily: FONTS.body,
    color: colors.sgs.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  errorTxt: {
    fontFamily: FONTS.bodyMedium,
    color: colors.sgs.flashRed,
    fontSize: 14,
  },
  infoTxt: {
    fontFamily: FONTS.body,
    color: colors.sgs.textMuted,
    fontSize: 13,
  },
  footer: {
    fontFamily: FONTS.body,
    color: colors.sgs.textDim,
    fontSize: 12,
    textAlign: "center",
    marginTop: "auto",
  },
});
