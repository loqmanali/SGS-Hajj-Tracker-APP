# Zebra DataWedge setup for SGS BagScan

The app ships with a small native module (see `plugins/withZebraScan.js`) that
listens for the broadcast intent `com.semicolon.sgsbagscan.SCAN` and forwards
each scan to the JS layer as a `ZebraScan` event. On first launch it also
**auto-creates and configures a DataWedge profile** named `SGSBagScan` bound to
the app's package (`com.semicolon.sgsbagscan`).

For 99% of devices that's all ops needs to do: install the dev-client / prod
APK, open the app once, then pull the trigger. If a device has had DataWedge
factory-reset or is running an unusual DataWedge build, follow the manual
recovery below.

## Manual recovery — recreate the profile by hand

1. Open **DataWedge** on the handheld.
2. Tap the menu (⋮) → **New profile** → name it `SGSBagScan` → OK.
3. Open the new profile and tap **Associated apps** → menu → **New app/activity**.
4. Pick `com.semicolon.sgsbagscan`, then `*` (all activities).
5. Back in the profile, set:
   - **Profile enabled**: ON
   - **Barcode input**: ON, scanner = *Auto*. Required symbologies:
     - **Code 128** + **GS1-128** — SGS-printed Hajj bag tags
     - **Interleaved 2 of 5 (I 2/5)** — IATA airline bag tags
       (Resolution 740 license plate, e.g. Saudia `0065SV456953`)
     - **Code 39** and **PDF417** are safe to leave on as defensive
       defaults; they appear on some airline tags and SGS staff
       badges.
     All four are enabled by default on stock Zebra DataWedge profiles
     — only call this out manually if a previous deployment trimmed
     them down.
   - **Keystroke output**: OFF
   - **Intent output**: ON
     - Intent action: `com.semicolon.sgsbagscan.SCAN`
     - Intent category: `android.intent.category.DEFAULT`
     - Intent delivery: **Broadcast intent**
6. Exit DataWedge. Pull the trigger on the SGS BagScan scan screen — the app
   should flash green/red as normal.

## Verifying the bridge

From a USB-attached device:

```bash
adb logcat ZebraScanModule:V *:S
```

Pulling the trigger should print a line per scan. If nothing prints:

- Confirm the `SGSBagScan` profile is **enabled** and shows the app under
  *Associated apps*.
- Confirm Intent output → Intent delivery is set to **Broadcast intent**, not
  *Start activity* or *Send via startService*.
- Force-stop the app and reopen it — auto-configuration runs again on every
  cold launch, which is enough to recover most cases.
- Open **Settings → Diagnostics → Reconfigure scanner** in the app. This
  re-runs the DataWedge profile setup on demand and shows a green "Scanner
  reconfigured" line on success or a red error line if DataWedge rejected
  the request. The button only appears on Zebra hardware where DataWedge is
  actually installed.
- If the scan screen has been open for more than 30 seconds on a Zebra
  device with no scans received, the app shows an amber **"No scans
  received yet"** ribbon at the top of the scan screen with a shortcut
  to open Settings — the same recovery path.

## On-device validation status

The Task #25 hardening (auto-create + auto-config of the `SGSBagScan` profile,
the **Reconfigure scanner** button, and the "No scans received yet" ribbon)
has been validated by typecheck and code review only. As of this writing, **no
on-device confirmation has been performed against a real TC57HO/TC72** with a
factory-reset DataWedge — the validating environment had no physical Zebra
hardware available.

Before relying on the auto-config path in the field, an operator with a
handheld should:

1. Install the latest dev-client APK on a device whose DataWedge has been
   factory-reset (or is freshly enrolled).
2. Cold-launch the app and confirm DataWedge → Profiles now lists
   `SGSBagScan` bound to `com.semicolon.sgsbagscan`.
3. Capture `adb logcat ZebraScanModule:V *:S` and confirm both
   `DataWedge result: cmd=auto-init-create result=SUCCESS` and
   `…auto-init-config result=SUCCESS` appear.
4. Pull the trigger and confirm the count increments with a green/red flash.
5. Open **Settings → Diagnostics → Reconfigure scanner** and confirm the
   green "Scanner reconfigured" toast.

Record the result back in this section once it has been done.

## Supported devices

The JS detector in `hooks/useScanner.ts` whitelists TC57HO, TC72, TC77 and
MC93. Adding a new model only needs an entry in `ZEBRA_MODELS` — the native
bridge itself is model-agnostic.
