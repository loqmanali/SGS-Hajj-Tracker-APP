/**
 * Expo config plugin: installs the Zebra DataWedge -> React Native bridge.
 *
 * What it does at prebuild time:
 *   1. Copies ZebraScanModule.kt + ZebraScanPackage.kt into the generated
 *      Android project under com.semicolon.sgsbagscan.zebra.
 *   2. Registers ZebraScanPackage in MainApplication's package list so the
 *      module starts with the app and registers its BroadcastReceiver.
 *
 * The receiver listens for "com.semicolon.sgsbagscan.SCAN" — the intent
 * DataWedge fires on every trigger pull — and forwards the payload to JS
 * via the existing "ZebraScan" DeviceEventEmitter listener in
 * hooks/useScanner.ts.
 *
 * In Expo Go (no native module), this plugin is inert and the camera
 * fallback handles scans. It only takes effect in dev-client / production
 * Android builds.
 */

const fs = require("fs");
const path = require("path");
const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} = require("@expo/config-plugins");

const DATAWEDGE_PACKAGE = "com.symbol.datawedge";

const PACKAGE_PATH = "com/semicolon/sgsbagscan/zebra";
const SOURCE_DIR = path.join(__dirname, "zebra-scan");
const FILES = ["ZebraScanModule.kt", "ZebraScanPackage.kt"];

const PACKAGE_IMPORT =
  "import com.semicolon.sgsbagscan.zebra.ZebraScanPackage";
const PACKAGE_ADD = "add(ZebraScanPackage())";

function withZebraScanSources(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const projectRoot = cfg.modRequest.platformProjectRoot;
      const targetDir = path.join(
        projectRoot,
        "app",
        "src",
        "main",
        "java",
        PACKAGE_PATH,
      );
      fs.mkdirSync(targetDir, { recursive: true });
      for (const file of FILES) {
        const src = path.join(SOURCE_DIR, file);
        const dst = path.join(targetDir, file);
        fs.copyFileSync(src, dst);
      }
      return cfg;
    },
  ]);
}

function withZebraScanPackageRegistered(config) {
  return withMainApplication(config, (cfg) => {
    let contents = cfg.modResults.contents;

    if (!contents.includes(PACKAGE_IMPORT)) {
      contents = contents.replace(
        /(package [^\n]+\n)/,
        `$1\n${PACKAGE_IMPORT}\n`,
      );
    }

    if (!contents.includes(PACKAGE_ADD)) {
      // RN 0.81 / Expo SDK 54 generates Kotlin MainApplication where the
      // package list is built like:
      //   override fun getPackages(): List<ReactPackage> =
      //     PackageList(this).packages.apply {
      //       // add(MyReactNativePackage())
      //     }
      const pattern = /(PackageList\(this\)\.packages\.apply\s*\{)/;
      if (!pattern.test(contents)) {
        throw new Error(
          "[withZebraScan] Could not find `PackageList(this).packages.apply {` " +
            "in MainApplication. The Zebra trigger bridge will silently no-op " +
            "without manual registration. Check Expo / RN version and update the plugin.",
        );
      }
      contents = contents.replace(pattern, `$1\n          ${PACKAGE_ADD}`);
    }

    cfg.modResults.contents = contents;
    return cfg;
  });
}

/**
 * Android 11+ (API 30) restricts package visibility — without an explicit
 * <queries> entry the app can't see DataWedge to query it via PackageManager
 * and (on some OEM builds) targeted broadcasts to com.symbol.datawedge can
 * also be filtered. Declaring the queries entry is the supported way to
 * keep both PackageManager and Intent.setPackage(...) working.
 *
 * See: https://developer.android.com/training/package-visibility
 */
function withZebraDataWedgeQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    if (!manifest.queries) manifest.queries = [];
    // Reuse an existing <queries> block if Expo or another plugin already
    // created one — Android only honors the first.
    let queries = manifest.queries[0];
    if (!queries) {
      queries = {};
      manifest.queries.push(queries);
    }
    if (!Array.isArray(queries.package)) queries.package = [];
    const already = queries.package.some(
      (p) => p?.$?.["android:name"] === DATAWEDGE_PACKAGE,
    );
    if (!already) {
      queries.package.push({ $: { "android:name": DATAWEDGE_PACKAGE } });
    }
    return cfg;
  });
}

module.exports = function withZebraScan(config) {
  config = withZebraScanSources(config);
  config = withZebraScanPackageRegistered(config);
  config = withZebraDataWedgeQueries(config);
  return config;
};
