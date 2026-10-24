package io.github.m0n0t0ne0ne.spectra

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.os.Bundle
import android.util.Size
import android.util.TypedValue
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Full-screen barcode scanner that only accepts a reading once it is trustworthy:
 *  - retail food formats only (EAN-13, EAN-8, UPC-A, UPC-E)
 *  - the check digit must be valid
 *  - the barcode must fill enough of the frame to be read sharply
 *  - the same number must be read in [REQUIRED_MATCHES] consecutive frames
 * Result: RESULT_OK with "code", or RESULT_CANCELED, or RESULT_FIRST_USER with "fallback" when the camera can't be used.
 */
class ScannerActivity : ComponentActivity() {

    companion object {
        const val REQUIRED_MATCHES = 3
        // A barcode narrower than this share of the frame is too small to trust; zoom in instead of asking the user to move closer.
        const val MIN_WIDTH_SHARE = 0.12f
        const val GOOD_WIDTH_SHARE = 0.35f
        const val START_ZOOM = 2.0f
        const val MAX_ZOOM = 4.0f
    }

    private lateinit var preview: PreviewView
    private lateinit var hint: TextView
    private lateinit var torch: TextView
    private var camera: Camera? = null
    private var scanner: BarcodeScanner? = null
    private lateinit var executor: ExecutorService
    private var lastValue: String? = null
    private var matches = 0
    private var misses = 0
    @Volatile private var finished = false
    private var zoom = 1f
    private var lastZoomAt = 0L
    private var lastFocusAt = 0L
    private var lastDecodeAt = 0L

    private val askCamera = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startCamera() else fallback()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        executor = Executors.newSingleThreadExecutor()

        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        preview = PreviewView(this).apply {
            scaleType = PreviewView.ScaleType.FILL_CENTER
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }
        root.addView(preview, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(Reticle(this), FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        val bar = FrameLayout(this)
        val close = pill("Close").apply { setOnClickListener { setResult(Activity.RESULT_CANCELED); finish() } }
        torch = pill("Light").apply { setOnClickListener { toggleTorch() }; visibility = View.GONE }
        bar.addView(close, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(44), Gravity.START or Gravity.CENTER_VERTICAL))
        bar.addView(torch, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(44), Gravity.END or Gravity.CENTER_VERTICAL))
        root.addView(bar, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(64), Gravity.TOP).apply { setMargins(dp(16), 0, dp(16), 0) })
        val google = pill("Use Google scanner").apply { setOnClickListener { fallback() } }

        hint = TextView(this).apply {
            text = "Hold the phone about a hand’s length away"
            setTextColor(Color.parseColor("#E8ECE9"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            gravity = Gravity.CENTER
            setPadding(dp(20), dp(12), dp(20), dp(12))
            background = rounded(Color.parseColor("#CC121513"), dp(22).toFloat())
        }

        val bottom = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            addView(hint, android.widget.LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            addView(google, android.widget.LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(44)).apply { topMargin = dp(14) })
        }
        root.addView(bottom, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { bottomMargin = dp(40) })
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val b = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            (bar.layoutParams as FrameLayout.LayoutParams).topMargin = b.top + dp(8)
            (bottom.layoutParams as FrameLayout.LayoutParams).bottomMargin = b.bottom + dp(32)
            bar.requestLayout(); bottom.requestLayout()
            insets
        }

        // Tap anywhere to refocus on that spot.
        preview.setOnTouchListener { v, e ->
            if (e.action == MotionEvent.ACTION_UP) { focusAt(e.x, e.y); v.performClick() }
            true
        }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) startCamera()
        else askCamera.launch(Manifest.permission.CAMERA)
    }

    private fun startCamera() {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            try {
                val provider = future.get()
                val previewUse = Preview.Builder().build().also { it.surfaceProvider = preview.surfaceProvider }
                val analysis = ImageAnalysis.Builder()
                    .setResolutionSelector(
                        ResolutionSelector.Builder()
                            .setResolutionStrategy(ResolutionStrategy(Size(1280, 720), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
                            .build()
                    )
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                scanner = BarcodeScanning.getClient(
                    BarcodeScannerOptions.Builder()
                        .setBarcodeFormats(Barcode.FORMAT_EAN_13, Barcode.FORMAT_EAN_8, Barcode.FORMAT_UPC_A, Barcode.FORMAT_UPC_E)
                        .build()
                )
                analysis.setAnalyzer(executor) { image -> analyze(image) }
                provider.unbindAll()
                camera = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, previewUse, analysis)
                if (camera?.cameraInfo?.hasFlashUnit() == true) torch.visibility = View.VISIBLE
                // Start zoomed in so the phone can stay far enough away to focus.
                setZoom(START_ZOOM)
                preview.postDelayed({ focusAt(preview.width / 2f, preview.height / 2f) }, 400)
            } catch (e: Exception) {
                fallback()
            }
        }, ContextCompat.getMainExecutor(this))
    }

    @SuppressLint("UnsafeOptInUsageError")
    @androidx.annotation.OptIn(ExperimentalGetImage::class)
    private fun analyze(image: ImageProxy) {
        val media = image.image
        val s = scanner
        if (media == null || s == null || finished) { image.close(); return }
        val rotation = image.imageInfo.rotationDegrees
        val uprightWidth = if (rotation == 90 || rotation == 270) image.height else image.width
        s.process(InputImage.fromMediaImage(media, rotation))
            .addOnSuccessListener { codes -> handle(codes, uprightWidth) }
            .addOnCompleteListener { image.close() }
    }

    private fun handle(codes: List<Barcode>, frameWidth: Int) {
        if (finished) return
        val now = System.currentTimeMillis()
        // Nothing readable for a while: the lens may be stuck, so refocus on the center.
        if (now - lastDecodeAt > 2000 && now - lastFocusAt > 2500) focusAt(preview.width / 2f, preview.height / 2f)
        val valid = codes.mapNotNull { b -> b.rawValue?.let { v -> if (checkDigitOk(v, b.format)) b to v else null } }
        val best = valid.maxByOrNull { it.first.boundingBox?.width() ?: 0 }
        if (best == null) {
            if (++misses > 3) { lastValue = null; matches = 0 }
            if (codes.isNotEmpty()) setHint("Hold steady…")
            return
        }
        misses = 0
        lastDecodeAt = now
        val width = best.first.boundingBox?.width() ?: 0
        // Small in the frame: zoom in a step at a time, like Google's scanner does.
        if (width < frameWidth * GOOD_WIDTH_SHARE && zoom < MAX_ZOOM && now - lastZoomAt > 400) setZoom(zoom * 1.25f)
        if (width < frameWidth * MIN_WIDTH_SHARE) {
            lastValue = null; matches = 0
            setHint("Hold steady…")
            return
        }
        val value = best.second
        if (value == lastValue) matches++ else { lastValue = value; matches = 1 }
        if (matches >= REQUIRED_MATCHES) {
            finished = true
            preview.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
            setResult(Activity.RESULT_OK, Intent().putExtra("code", value))
            finish()
        } else setHint("Hold steady…")
    }

    private fun setHint(t: String) { if (hint.text != t) hint.text = t }

    private fun setZoom(z: Float) {
        val cam = camera ?: return
        val state = cam.cameraInfo.zoomState.value
        val max = minOf(MAX_ZOOM, state?.maxZoomRatio ?: 1f)
        val minZ = state?.minZoomRatio ?: 1f
        zoom = z.coerceIn(minZ, max)
        lastZoomAt = System.currentTimeMillis()
        cam.cameraControl.setZoomRatio(zoom)
    }

    private fun focusAt(x: Float, y: Float) {
        val cam = camera ?: return
        if (preview.width == 0) return
        lastFocusAt = System.currentTimeMillis()
        val point = preview.meteringPointFactory.createPoint(x, y)
        val action = FocusMeteringAction.Builder(point, FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE)
            .setAutoCancelDuration(2, TimeUnit.SECONDS)
            .build()
        cam.cameraControl.startFocusAndMetering(action)
    }

    private fun toggleTorch() {
        val cam = camera ?: return
        val on = cam.cameraInfo.torchState.value == 1
        cam.cameraControl.enableTorch(!on)
        torch.text = if (on) "Light" else "Light on"
    }

    private fun fallback() {
        setResult(Activity.RESULT_FIRST_USER, Intent().putExtra("fallback", true))
        finish()
    }

    override fun onDestroy() {
        scanner?.close()
        executor.shutdown()
        super.onDestroy()
    }

    // ---- check digits ----

    private fun checkDigitOk(raw: String, format: Int): Boolean {
        if (!raw.all { it.isDigit() }) return false
        val gtin = when (format) {
            Barcode.FORMAT_UPC_E -> expandUpcE(raw) ?: return false
            else -> raw
        }
        if (gtin.length !in listOf(8, 12, 13)) return false
        return gtinValid(gtin)
    }

    private fun gtinValid(code: String): Boolean {
        val digits = code.map { it - '0' }
        val body = digits.dropLast(1).reversed()
        val sum = body.withIndex().sumOf { (i, d) -> if (i % 2 == 0) d * 3 else d }
        return (10 - sum % 10) % 10 == digits.last()
    }

    /** UPC-E (8 digits: number system, 6 digits, check) to UPC-A. */
    private fun expandUpcE(raw: String): String? {
        val e = when (raw.length) { 8 -> raw; 7 -> "0$raw"; 6 -> return null; else -> return null }
        val ns = e[0]; val d = e.substring(1, 7); val check = e[7]
        val body = when (d[5]) {
            '0', '1', '2' -> "${d[0]}${d[1]}${d[5]}0000${d[2]}${d[3]}${d[4]}"
            '3' -> "${d[0]}${d[1]}${d[2]}00000${d[3]}${d[4]}"
            '4' -> "${d[0]}${d[1]}${d[2]}${d[3]}00000${d[4]}"
            else -> "${d[0]}${d[1]}${d[2]}${d[3]}${d[4]}0000${d[5]}"
        }
        return "$ns$body$check"
    }

    // ---- small view helpers ----

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun rounded(color: Int, radius: Float) = android.graphics.drawable.GradientDrawable().apply { setColor(color); cornerRadius = radius }

    private fun pill(label: String) = TextView(this).apply {
        text = label
        setTextColor(Color.parseColor("#E8ECE9"))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        gravity = Gravity.CENTER
        setPadding(dp(18), 0, dp(18), 0)
        background = rounded(Color.parseColor("#CC1A1F1C"), dp(22).toFloat())
        isClickable = true
    }

    /** Dims everything outside a wide box and draws mint corner marks. */
    private class Reticle(context: Context) : View(context) {
        private val dim = Paint().apply { color = Color.parseColor("#99000000") }
        private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#8FD3B6"); style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND
            strokeWidth = 4f * context.resources.displayMetrics.density
        }
        private val radius = 18f * context.resources.displayMetrics.density

        override fun onDraw(canvas: Canvas) {
            val w = width.toFloat(); val h = height.toFloat()
            val bw = w * 0.82f; val bh = bw * 0.5f
            val box = RectF((w - bw) / 2, (h - bh) / 2 - h * 0.04f, (w + bw) / 2, (h + bh) / 2 - h * 0.04f)
            val outside = Path().apply {
                fillType = Path.FillType.EVEN_ODD
                addRect(0f, 0f, w, h, Path.Direction.CW)
                addRoundRect(box, radius, radius, Path.Direction.CW)
            }
            canvas.drawPath(outside, dim)
            val l = bw * 0.12f
            with(box) {
                canvas.drawLine(left, top + radius, left, top + l, stroke); canvas.drawLine(left + radius, top, left + l, top, stroke)
                canvas.drawLine(right, top + radius, right, top + l, stroke); canvas.drawLine(right - radius, top, right - l, top, stroke)
                canvas.drawLine(left, bottom - radius, left, bottom - l, stroke); canvas.drawLine(left + radius, bottom, left + l, bottom, stroke)
                canvas.drawLine(right, bottom - radius, right, bottom - l, stroke); canvas.drawLine(right - radius, bottom, right - l, bottom, stroke)
                canvas.drawArc(RectF(left, top, left + 2 * radius, top + 2 * radius), 180f, 90f, false, stroke)
                canvas.drawArc(RectF(right - 2 * radius, top, right, top + 2 * radius), 270f, 90f, false, stroke)
                canvas.drawArc(RectF(left, bottom - 2 * radius, left + 2 * radius, bottom), 90f, 90f, false, stroke)
                canvas.drawArc(RectF(right - 2 * radius, bottom - 2 * radius, right, bottom), 0f, 90f, false, stroke)
            }
        }
    }
}
