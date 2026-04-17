package com.semicolon.sgsbagscan.zebra

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Bridges Zebra DataWedge -> React Native.
 *
 * Listens for the broadcast intent that DataWedge fires on every successful
 * trigger pull and forwards the decoded barcode payload to JS as a
 * "ZebraScan" DeviceEventEmitter event. The JS layer (hooks/useScanner.ts)
 * is already wired to consume that event.
 *
 * Also auto-configures the DataWedge profile on first launch so that ops do
 * not have to set it up manually for every new device. The manual recovery
 * steps are documented in docs/zebra-datawedge-setup.md.
 */
class ZebraScanModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val TAG = "ZebraScanModule"
    private const val SCAN_ACTION = "com.semicolon.sgsbagscan.SCAN"

    // DataWedge API actions / extras (string literals so we don't depend on
    // a Zebra SDK jar — these are stable across DataWedge versions).
    private const val DW_ACTION = "com.symbol.datawedge.api.ACTION"
    private const val DW_EXTRA_CREATE_PROFILE = "com.symbol.datawedge.api.CREATE_PROFILE"
    private const val DW_EXTRA_SET_CONFIG = "com.symbol.datawedge.api.SET_CONFIG"
    private const val PROFILE_NAME = "SGSBagScan"
  }

  private var receiver: BroadcastReceiver? = null

  override fun getName(): String = "ZebraScanModule"

  override fun initialize() {
    super.initialize()
    registerReceiver()
    // Fire-and-forget — DataWedge ignores duplicate creates.
    try {
      configureDataWedgeProfile()
    } catch (t: Throwable) {
      Log.w(TAG, "DataWedge auto-config failed (likely non-Zebra device)", t)
    }
  }

  override fun invalidate() {
    unregisterReceiver()
    super.invalidate()
  }

  private fun registerReceiver() {
    if (receiver != null) return
    val ctx: Context = reactApplicationContext.applicationContext
    val filter = IntentFilter(SCAN_ACTION).apply {
      addCategory(Intent.CATEGORY_DEFAULT)
    }
    receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != SCAN_ACTION) return
        val data = intent.getStringExtra("com.symbol.datawedge.data_string")
          ?: intent.getStringExtra("data_string")
          ?: return
        val symbology = intent.getStringExtra("com.symbol.datawedge.label_type")
          ?: intent.getStringExtra("label_type")
        emitScan(data, symbology)
      }
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      ctx.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
    } else {
      @Suppress("UnspecifiedRegisterReceiverFlag")
      ctx.registerReceiver(receiver, filter)
    }
  }

  private fun unregisterReceiver() {
    val r = receiver ?: return
    try {
      reactApplicationContext.applicationContext.unregisterReceiver(r)
    } catch (_: IllegalArgumentException) {
      // Already unregistered.
    }
    receiver = null
  }

  private fun emitScan(data: String, symbology: String?) {
    if (!reactApplicationContext.hasActiveReactInstance()) {
      Log.w(TAG, "Dropping scan — no active React instance")
      return
    }
    val payload = Arguments.createMap().apply {
      putString("data", data)
      if (symbology != null) putString("symbology", symbology)
    }
    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("ZebraScan", payload)
  }

  /**
   * Programmatically creates the DataWedge profile bound to this app and
   * configures it to broadcast scans to SCAN_ACTION. Idempotent — DataWedge
   * silently ignores duplicate profile creates and merges configs.
   *
   * If the device does not have DataWedge (e.g. dev built running on a
   * Pixel), the broadcast is a no-op and nothing else happens.
   */
  private fun configureDataWedgeProfile() {
    val ctx = reactApplicationContext.applicationContext
    val packageName = ctx.packageName

    // 1) Create profile (idempotent).
    ctx.sendBroadcast(Intent(DW_ACTION).apply {
      setPackage("com.symbol.datawedge")
      putExtra(DW_EXTRA_CREATE_PROFILE, PROFILE_NAME)
    })

    // 2) Bind profile to our app + activity. DataWedge expects APP_LIST as
    //    a parcelable array of bundles, not a single bundle.
    val appConfig = Bundle().apply {
      putString("PACKAGE_NAME", packageName)
      putStringArray("ACTIVITY_LIST", arrayOf("*"))
    }
    val appList: Array<android.os.Parcelable> = arrayOf(appConfig)

    // 3) Configure the Intent output plugin to broadcast to SCAN_ACTION.
    val intentParams = Bundle().apply {
      putString("intent_output_enabled", "true")
      putString("intent_action", SCAN_ACTION)
      putString("intent_category", Intent.CATEGORY_DEFAULT)
      putString("intent_delivery", "2") // 2 = Broadcast Intent
    }
    val intentConfig = Bundle().apply {
      putString("PLUGIN_NAME", "INTENT")
      putString("RESET_CONFIG", "true")
      putBundle("PARAM_LIST", intentParams)
    }

    // 4) Enable the barcode plugin (default symbologies are fine for SGS tags).
    val barcodeParams = Bundle().apply {
      putString("scanner_selection", "auto")
      putString("scanner_input_enabled", "true")
    }
    val barcodeConfig = Bundle().apply {
      putString("PLUGIN_NAME", "BARCODE")
      putString("RESET_CONFIG", "true")
      putBundle("PARAM_LIST", barcodeParams)
    }

    val profileConfig = Bundle().apply {
      putString("PROFILE_NAME", PROFILE_NAME)
      putString("PROFILE_ENABLED", "true")
      putString("CONFIG_MODE", "UPDATE")
      putParcelableArray("APP_LIST", appList)
      putParcelableArray("PLUGIN_CONFIG", arrayOf(intentConfig, barcodeConfig))
    }

    ctx.sendBroadcast(Intent(DW_ACTION).apply {
      setPackage("com.symbol.datawedge")
      putExtra(DW_EXTRA_SET_CONFIG, profileConfig)
    })
  }

  /**
   * JS-callable escape hatch — lets the app re-run profile setup from a
   * settings screen if ops ever wipes DataWedge state on a device.
   */
  @ReactMethod
  fun reconfigureProfile() {
    try {
      configureDataWedgeProfile()
    } catch (t: Throwable) {
      Log.w(TAG, "Manual reconfigure failed", t)
    }
  }
}
