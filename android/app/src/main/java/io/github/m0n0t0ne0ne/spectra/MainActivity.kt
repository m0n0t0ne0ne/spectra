package io.github.m0n0t0ne0ne.spectra

import android.annotation.SuppressLint
import android.content.ContentValues
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import android.app.Activity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import org.json.JSONObject
import android.util.AtomicFile
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Hosts the Spectra web app (copied from ../web into assets/www at build time) in a WebView.
 * The page is served from https://appassets.androidplatform.net so it runs as a secure origin:
 * ES modules, file-backed storage (see storeRead/storeWrite) and network calls to Open Food Facts, USDA and Claude all work.
 * Barcode scanning uses Google's code scanner through the AndroidBridge JavaScript interface.
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView

    private val appHost = "appassets.androidplatform.net"
    private val startUrl = "https://$appHost/assets/www/index.html"

    // Our own scanner waits for a steady, check-digit-valid read. Falls back to Google's scanner if the camera can't be used.
    private val scanLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        when (r.resultCode) {
            Activity.RESULT_OK -> {
                val value = r.data?.getStringExtra("code") ?: ""
                js("window.__onNativeScan && window.__onNativeScan(${JSONObject.quote(value)})")
            }
            Activity.RESULT_FIRST_USER -> gmsScan()
            else -> js("window.__onNativeScanCancel && window.__onNativeScanCancel()")
        }
    }

    // Import: the user picks a backup file; its text goes to the page.
    private val importLauncher = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) { js("window.__onImportFile && window.__onImportFile(null)"); return@registerForActivityResult }
        Thread {
            val text = try { contentResolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) } } catch (e: Exception) { null }
            val name = uri.lastPathSegment?.substringAfterLast('/') ?: "backup"
            js("window.__onImportFile && window.__onImportFile(${if (text == null) "null" else JSONObject.quote(text)}, ${JSONObject.quote(name)})")
        }.start()
    }

    // Your diary, foods and settings, one file each in the app's private storage.
    private val storeDir by lazy { File(filesDir, "store").apply { mkdirs() } }
    private val storeLock = Any()

    // Fetches product pages and search results for nutrient lookups. The web view can't read other sites
    // directly (browsers block that), so the app does it: GET over HTTPS only, text only, size and time capped.
    private val fetchPool = Executors.newFixedThreadPool(3)
    private val fetchUserAgent = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36"
    private val maxFetchBytes = 1_500_000

    private fun fetchText(urlString: String, headers: JSONObject): Triple<Int, String, String> {
        var url = URL(urlString)
        repeat(5) {
            if (url.protocol != "https") throw IllegalArgumentException("Only https links are fetched")
            val c = (url.openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 8000
                readTimeout = 10000
                setRequestProperty("User-Agent", fetchUserAgent)
                setRequestProperty("Accept", "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5")
                setRequestProperty("Accept-Language", "en-US,en;q=0.8")
                headers.keys().forEach { k -> setRequestProperty(k, headers.optString(k)) }
            }
            try {
                val code = c.responseCode
                if (code in 300..399) {
                    val next = c.getHeaderField("Location") ?: return Triple(code, url.toString(), "")
                    url = URL(url, next)
                    return@repeat
                }
                val type = c.contentType ?: ""
                if (type.isNotEmpty() && !Regex("text|json|xml", RegexOption.IGNORE_CASE).containsMatchIn(type)) return Triple(415, url.toString(), "")
                val stream = if (code >= 400) c.errorStream else c.inputStream
                val bytes = stream?.use { input ->
                    val out = java.io.ByteArrayOutputStream()
                    val buf = ByteArray(16384)
                    while (out.size() < maxFetchBytes) { val n = input.read(buf); if (n < 0) break; out.write(buf, 0, n) }
                    out.toByteArray()
                } ?: ByteArray(0)
                val charset = Regex("charset=([\\w-]+)", RegexOption.IGNORE_CASE).find(type)?.groupValues?.get(1)
                val text = try { String(bytes, charset(charset ?: "UTF-8")) } catch (e: Exception) { String(bytes, Charsets.UTF_8) }
                return Triple(code, url.toString(), text)
            } finally { c.disconnect() }
        }
        return Triple(310, url.toString(), "")
    }
    private fun storeFile(key: String) = AtomicFile(File(storeDir, key.replace(Regex("[^A-Za-z0-9._-]"), "_") + ".json"))

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Draw edge to edge on every Android version and pad for the system bars ourselves.
        WindowCompat.setDecorFitsSystemWindows(window, false)

        val root = FrameLayout(this).apply { setBackgroundColor(Color.parseColor("#121513")) }
        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#121513"))
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        root.addView(web)
        setContentView(root)

        // Keep content clear of the status bar, navigation bar and keyboard (Android 15 draws edge to edge).
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain(appHost)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
            mediaPlaybackRequiresUserGesture = true
        }

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            override fun onPageFinished(view: WebView, url: String) {
                pageReady = true
                view.postDelayed({ deliverShare() }, 400)
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.host == appHost) return false
                // Source links (spec sheets, USDA pages) open in the phone's browser. Only web links leave the app.
                if (url.scheme != "https" && url.scheme != "http") return true
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, url))
                    true
                } catch (e: Exception) {
                    true
                }
            }
        }

        web.addJavascriptInterface(Bridge(), "AndroidBridge")

        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(startUrl)
        pendingShare = sharedText(intent)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })
    }

    // Text shared to the app waits until the page has loaded, then opens the paste sheet.
    private var pendingShare: String? = null
    private var pageReady = false

    private fun sharedText(i: Intent?): String? =
        if (i?.action == Intent.ACTION_SEND && i.type?.startsWith("text/") == true) i.getStringExtra(Intent.EXTRA_TEXT) else null

    private fun deliverShare() {
        val t = pendingShare ?: return
        if (!pageReady) return
        pendingShare = null
        web.evaluateJavascript("window.__onSharedText && window.__onSharedText(${JSONObject.quote(t)})", null)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        sharedText(intent)?.let { pendingShare = it; deliverShare() }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onDestroy() {
        fetchPool.shutdownNow()
        web.destroy()
        super.onDestroy()
    }

    private fun gmsScan() {
        val options = GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_EAN_13, Barcode.FORMAT_EAN_8, Barcode.FORMAT_UPC_A, Barcode.FORMAT_UPC_E)
            .enableAutoZoom()
            .build()
        GmsBarcodeScanning.getClient(this, options)
            .startScan()
            .addOnSuccessListener { barcode -> js("window.__onNativeScan && window.__onNativeScan(${JSONObject.quote(barcode.rawValue ?: "")})") }
            .addOnCanceledListener { js("window.__onNativeScanCancel && window.__onNativeScanCancel()") }
            .addOnFailureListener { e -> js("window.__onNativeScanError && window.__onNativeScanError(${JSONObject.quote(e.message ?: "unknown error")})") }
    }

    private fun js(code: String) = runOnUiThread { web.evaluateJavascript(code, null) }

    inner class Bridge {

        @JavascriptInterface
        fun scanBarcode() {
            runOnUiThread { scanLauncher.launch(Intent(this@MainActivity, ScannerActivity::class.java)) }
        }

        /** Saves a text file (the diary export) to the phone's Downloads folder. */
        @JavascriptInterface
        fun saveFile(name: String, content: String): Boolean {
            return try {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, name)
                    put(MediaStore.Downloads.MIME_TYPE, "application/json")
                    put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                }
                val uri: Uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return false
                contentResolver.openOutputStream(uri)?.use { it.write(content.toByteArray()) } ?: return false
                true
            } catch (e: Exception) {
                false
            }
        }

        /** Returns the clipboard text so "Paste from clipboard" works inside the app. */
        @JavascriptInterface
        fun readClipboard(): String {
            return try {
                val cm = getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                val clip = cm.primaryClip
                if (clip != null && clip.itemCount > 0) clip.getItemAt(0).coerceToText(this@MainActivity).toString() else ""
            } catch (e: Exception) {
                ""
            }
        }

        /** Opens the Gemini app with a prepared question. Falls back to the share sheet if Gemini isn't installed. */
        @JavascriptInterface
        fun shareToGemini(text: String): Boolean {
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, text)
                setPackage("com.google.android.apps.bard")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            return try {
                startActivity(send)
                true
            } catch (e: Exception) {
                val chooser = Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, text)
                }, "Ask about this food").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                try { startActivity(chooser) } catch (_: Exception) { }
                false
            }
        }

        @JavascriptInterface
        fun storeRead(key: String): String? = synchronized(storeLock) {
            try { val f = storeFile(key); if (f.baseFile.exists()) String(f.readFully(), Charsets.UTF_8) else null } catch (e: Exception) { null }
        }

        @JavascriptInterface
        fun storeWrite(key: String, value: String): Boolean = synchronized(storeLock) {
            val f = storeFile(key)
            val out = try { f.startWrite() } catch (e: Exception) { return false }
            try {
                out.write(value.toByteArray(Charsets.UTF_8))
                f.finishWrite(out)
                true
            } catch (e: Exception) {
                f.failWrite(out)
                false
            }
        }

        @JavascriptInterface
        fun storeInfo(): String {
            val used = storeDir.listFiles()?.sumOf { it.length() } ?: 0L
            return JSONObject().put("free", filesDir.usableSpace).put("total", filesDir.totalSpace).put("used", used).toString()
        }

        @JavascriptInterface
        fun pickFile() {
            runOnUiThread { importLauncher.launch(arrayOf("application/json", "text/plain", "application/octet-stream", "*/*")) }
        }

        /** Starts a background GET; the result arrives as window.__onFetchText(id, status, finalUrl, text). */
        @JavascriptInterface
        fun fetchText(id: String, url: String, headersJson: String) {
            fetchPool.execute {
                val (status, finalUrl, text) = try {
                    this@MainActivity.fetchText(url, try { JSONObject(headersJson) } catch (e: Exception) { JSONObject() })
                } catch (e: Exception) { Triple(0, url, "") }
                js("window.__onFetchText && window.__onFetchText(${JSONObject.quote(id)}, $status, ${JSONObject.quote(finalUrl)}, ${JSONObject.quote(text)})")
            }
        }

        @JavascriptInterface
        fun appVersion(): String = packageManager.getPackageInfo(packageName, 0).versionName ?: ""

    }
}
