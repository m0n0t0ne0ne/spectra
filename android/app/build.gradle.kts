import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Version comes from the release tag (CI sets VERSION_NAME from "v1.2.3"); versionCode is derived from it
// so every release installs as an update: 1.2.3 → 10203.
val versionNameValue = (System.getenv("VERSION_NAME") ?: "1.0.0").removePrefix("v")
val versionCodeValue = versionNameValue.split(".").map { it.takeWhile(Char::isDigit).ifEmpty { "0" }.toInt() }
    .let { (it.getOrElse(0) { 0 } * 10000) + (it.getOrElse(1) { 0 } * 100) + it.getOrElse(2) { 0 } }

// Release signing. The keystore is never committed. CI decodes it from repository secrets;
// locally, put the same values in android/keystore.properties (git-ignored) or in environment variables.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun signingValue(name: String): String? = System.getenv(name) ?: keystoreProps.getProperty(name)
val releaseStoreFile = signingValue("SPECTRA_KEYSTORE_FILE")?.let { rootProject.file(it) }
val canSignRelease = releaseStoreFile?.exists() == true && signingValue("SPECTRA_KEYSTORE_PASSWORD") != null

android {
    namespace = "io.github.m0n0t0ne0ne.spectra"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.m0n0t0ne0ne.spectra"
        minSdk = 29
        targetSdk = 35
        versionCode = versionCodeValue
        versionName = versionNameValue
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
    }

    signingConfigs {
        if (canSignRelease) {
            create("release") {
                storeFile = releaseStoreFile
                storePassword = signingValue("SPECTRA_KEYSTORE_PASSWORD")
                keyAlias = signingValue("SPECTRA_KEY_ALIAS") ?: "spectra"
                keyPassword = signingValue("SPECTRA_KEY_PASSWORD") ?: signingValue("SPECTRA_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Without the key, assembleRelease still builds (unsigned) so CI can check pull requests.
            signingConfig = if (canSignRelease) signingConfigs.getByName("release") else null
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    // The app itself is the web app in ../web, copied in at build time so there is one copy of it.
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/web"))

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

val copyWebApp by tasks.registering(Sync::class) {
    from(rootProject.file("../web")) { exclude("**/README.md", "**/.DS_Store") }
    into(layout.buildDirectory.dir("generated/web/www"))
}
tasks.named("preBuild") { dependsOn(copyWebApp) }

dependencies {
    implementation("androidx.core:core-ktx:1.19.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    // Google's barcode scanner UI (runs through Google Play services), used as a fallback.
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
    // The main scanner: CameraX preview + ML Kit barcode model bundled in the app (works offline).
    implementation("androidx.camera:camera-camera2:1.4.1")
    implementation("androidx.camera:camera-lifecycle:1.4.1")
    implementation("androidx.camera:camera-view:1.4.1")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")
}
