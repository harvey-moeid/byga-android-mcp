package id.byga.bridge

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.app.KeyguardManager
import android.content.Intent
import android.graphics.Path
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class BridgeService : AccessibilityService() {
    @Volatile private var server: ServerSocket? = null
    override fun onAccessibilityEvent(event: AccessibilityEvent?) { }
    override fun onInterrupt() { LocalGate.stop() }
    override fun onServiceConnected() {
        super.onServiceConnected()
        Thread({
            try {
                val socket = ServerSocket(17381, 1, InetAddress.getByName("127.0.0.1")); server = socket
                while (!socket.isClosed) { val client = socket.accept(); client.use { handle(it) } }
            } catch (_: Exception) { LocalGate.stop() }
        }, "byga-loopback").apply { isDaemon = true; start() }
    }
    override fun onDestroy() { LocalGate.stop(); server?.close(); server = null; super.onDestroy() }
    private fun handle(socket: Socket) {
        socket.soTimeout = 3000
        var code = 400; var result = JSONObject().put("error", "INVALID_REQUEST")
        try {
            val input = socket.getInputStream(); val header = StringBuilder(); var previous = ""
            while (header.length < 8192) { val n = input.read(); if (n == -1) break; header.append(n.toChar()); previous = (previous + n.toChar()).takeLast(4); if (previous == "\r\n\r\n") break }
            val lines = header.toString().split("\r\n")
            val headers = lines.drop(1).filter { it.contains(':') }.associate { it.substringBefore(':').lowercase() to it.substringAfter(':').trim() }
            val length = headers["content-length"]?.toIntOrNull() ?: 0
            val token = headers["authorization"]?.removePrefix("Bearer ") ?: ""
            if (lines[0] != "POST /action HTTP/1.1" || length !in 1..8192 || headers.containsKey("origin") || headers.containsKey("transfer-encoding")) throw SecurityException()
            if (!MessageDigest.isEqual(token.toByteArray(), Secrets.token(this).toByteArray())) { code = 401; throw SecurityException() }
            val bytes = ByteArray(length); var offset = 0
            while (offset < length) { val n = input.read(bytes, offset, length - offset); if (n <= 0) throw SecurityException(); offset += n }
            val payload = JSONObject(String(bytes, Charsets.UTF_8)); val latch = CountDownLatch(1)
            Handler(Looper.getMainLooper()).post { try { result = action(payload); code = 200 } catch (_: Exception) { code = 403; result = JSONObject().put("error", "ANDROID_LOCAL_APPROVAL_REQUIRED_OR_RESTRICTED") } finally { latch.countDown() } }
            if (!latch.await(8, TimeUnit.SECONDS)) { code = 504; result = JSONObject().put("error", "TIMEOUT") }
        } catch (_: Exception) { }
        val body = result.toString().toByteArray(Charsets.UTF_8)
        try { socket.getOutputStream().apply { write("HTTP/1.1 $code Result\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: ${body.size}\r\n\r\n".toByteArray()); write(body); flush() } } catch (_: Exception) { }
    }
    private fun allowed(pkg: String): Boolean {
        val configured = getSharedPreferences("policy", MODE_PRIVATE).getString("packages", "")!!.split(',').map { it.trim() }.filter { it.isNotEmpty() }
        val forbidden = listOf("settings", "permissioncontroller", "systemui", "authenticator", "bank", "password", "keyguard", "id.byga.bridge")
        return pkg in configured && forbidden.none { pkg.contains(it, true) }
    }
    private fun action(payload: JSONObject): JSONObject {
        if (getSystemService(KeyguardManager::class.java).isKeyguardLocked) throw SecurityException()
        val tool = payload.getString("tool"); val args = payload.getJSONObject("arguments")
        if (tool == "android_open_app") {
            val pkg = args.getString("package"); if (!allowed(pkg) || !LocalGate.consume()) throw SecurityException()
            val launch = packageManager.getLaunchIntentForPackage(pkg) ?: throw SecurityException()
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); startActivity(launch); return JSONObject().put("ok", true)
        }
        val root = rootInActiveWindow ?: throw SecurityException()
        if (!allowed(root.packageName?.toString() ?: "") || !LocalGate.consume()) throw SecurityException()
        when (tool) {
            "android_ui_tree" -> {
                val nodes = JSONArray(); var count = 0
                fun visit(node: AccessibilityNodeInfo, depth: Int) { if (count++ > 150 || depth > 15 || nodes.toString().length > 24000) return
                    nodes.put(JSONObject().put("id", node.viewIdResourceName ?: "").put("text", if (node.isPassword) "[REDACTED]" else node.text?.take(200)?.toString() ?: "").put("description", if (node.isPassword) "[REDACTED]" else node.contentDescription?.take(200)?.toString() ?: "").put("clickable", node.isClickable))
                    for (i in 0 until node.childCount) node.getChild(i)?.let { visit(it, depth + 1) }
                }
                visit(root, 0); return JSONObject().put("ui_tree", nodes.toString())
            }
            "android_press_key" -> { val key = when(args.getString("key")) { "back" -> GLOBAL_ACTION_BACK; "home" -> GLOBAL_ACTION_HOME; "recents" -> GLOBAL_ACTION_RECENTS; else -> throw SecurityException() }; if (!performGlobalAction(key)) throw SecurityException() }
            "android_input_text" -> { val node = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: throw SecurityException(); if (node.isPassword) throw SecurityException(); val text = args.getString("text"); if (text.length > 2000) throw SecurityException(); if (!node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) })) throw SecurityException() }
            "android_tap", "android_swipe" -> {
                fun coordinate(name: String, limit: Int): Float { val v = args.getDouble(name).toFloat(); if (!v.isFinite() || v < 0 || v >= limit) throw SecurityException(); return v }
                val metrics = resources.displayMetrics; val path = Path(); path.moveTo(coordinate("x", metrics.widthPixels), coordinate("y", metrics.heightPixels))
                if (tool == "android_swipe") path.lineTo(coordinate("to_x", metrics.widthPixels), coordinate("to_y", metrics.heightPixels))
                val duration = if (tool == "android_tap") 80L else args.optLong("duration_ms", 300).coerceIn(100, 2000)
                if (!dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, duration)).build(), null, null)) throw SecurityException()
            }
            else -> throw SecurityException()
        }
        return JSONObject().put("ok", true)
    }
}
