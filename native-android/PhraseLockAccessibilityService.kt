package app.lang.mobile

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.accessibility.AccessibilityEvent

class PhraseLockAccessibilityService : AccessibilityService() {

    private val guardedPackages = mapOf(
        "com.instagram.android" to Pair("Instagram", "instagram://app"),
        "com.zhiliaoapp.musically" to Pair("TikTok", "snssdk1233://feed"),
        "com.google.android.youtube" to Pair("YouTube", "youtube://"),
        "com.twitter.android" to Pair("X", "twitter://timeline"),
        "com.reddit.frontpage" to Pair("Reddit", "reddit://")
    )

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val packageName = event.packageName?.toString() ?: return
        if (packageName == applicationContext.packageName) return

        val targetApp = guardedPackages[packageName] ?: return
        if (hasActiveUnlockWindow()) return

        val lockUri = Uri.Builder()
            .scheme("https")
            .authority("localhost")
            .appendQueryParameter("lock", "1")
            .appendQueryParameter("app", targetApp.first)
            .appendQueryParameter("scheme", targetApp.second)
            .build()

        val interceptIntent = Intent(Intent.ACTION_VIEW, lockUri).apply {
            setPackage(applicationContext.packageName)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        startActivity(interceptIntent)
    }

    override fun onInterrupt() = Unit

    private fun hasActiveUnlockWindow(): Boolean {
        val prefs = applicationContext.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
        val rawExpiry = prefs.getString("lang_prefs_unlock_expiry_ms", null) ?: return false
        val expiryMs = rawExpiry.toLongOrNull() ?: return false
        return System.currentTimeMillis() < expiryMs
    }
}
