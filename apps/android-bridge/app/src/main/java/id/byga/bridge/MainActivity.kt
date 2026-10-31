package id.byga.bridge

import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.graphics.Color
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(32, 56, 32, 32); setBackgroundColor(Color.rgb(17, 28, 31)) }
        fun text(value: String, size: Float = 16f) { layout.addView(TextView(this).apply { text = value; textSize = size; setTextColor(Color.rgb(200, 224, 218)); setPadding(0, 12, 0, 18) }) }
        fun button(title: String, action: () -> Unit) { layout.addView(Button(this).apply { text = title; setOnClickListener { action() } }) }
        text("BYGA / ANDROID BRIDGE", 25f)
        text("Kontrol tetap di tangan Anda. Bridge hanya menerima koneksi loopback yang memakai token lokal.")
        text("1. Aktifkan layanan Accessibility secara manual. BYGA dapat membaca UI dan membuat gesture pada aplikasi yang diizinkan. Password disembunyikan; screenshot tidak diaktifkan.")
        button("Buka pengaturan Accessibility") { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        text("2. Masukkan package aplikasi yang Anda izinkan, dipisahkan koma. Jangan tambahkan aplikasi perbankan, autentikator, password manager, atau pengaturan izin.")
        val prefs = getSharedPreferences("policy", MODE_PRIVATE)
        val packages = EditText(this).apply { hint = "contoh: com.android.calculator2"; setText(prefs.getString("packages", "")); setTextColor(Color.WHITE) }
        layout.addView(packages)
        button("Simpan aplikasi yang diizinkan") { prefs.edit().putString("packages", packages.text.toString()).apply(); LocalGate.stop(); AlertDialog.Builder(this).setMessage("Allowlist disimpan. Izin operasi sebelumnya dicabut.").setPositiveButton("OK", null).show() }
        text("3. Salin token lokal ke konfigurasi agent saat pairing. Token terenkripsi dengan Android Keystore; jangan membagikannya.")
        button("Salin token bridge") { val clipboard = getSystemService(ClipboardManager::class.java); clipboard.setPrimaryClip(ClipData.newPlainText("BYGA local token", Secrets.token(this))); AlertDialog.Builder(this).setMessage("Token disalin. Jalankan pairing agent dengan --bridge-token. Clipboard dapat dibaca oleh aplikasi tertentu; hapus setelah pairing.").setPositiveButton("OK", null).show() }
        text("4. Setujui job pada dashboard. Lalu beri izin satu operasi di sini dan buka aplikasi target dalam 60 detik. Izin tidak dapat diberikan oleh agent.")
        button("Izinkan SATU operasi selama 60 detik") { AlertDialog.Builder(this).setTitle("Izin lokal satu kali").setMessage("Periksa job dan argumennya di dashboard. Operasi berikutnya dapat membaca UI atau mengubah layar pada aplikasi allowlist.").setNegativeButton("Batal", null).setPositiveButton("Izinkan") { _, _ -> LocalGate.grantOne() }.show() }
        button("EMERGENCY STOP") { LocalGate.stop(); AlertDialog.Builder(this).setMessage("Seluruh izin lokal dicabut.").setPositiveButton("OK", null).show() }
        button("Putar token lokal / unpair bridge") { Secrets.rotate(this); AlertDialog.Builder(this).setMessage("Token lama tidak berlaku. Pair ulang agent dengan token baru.").setPositiveButton("OK", null).show() }
        text("Tanpa root. Tidak melewati lockscreen, FLAG_SECURE, dialog izin, atau sandbox Android. Android dapat menghentikan proses di latar belakang.", 13f)
        setContentView(ScrollView(this).apply { addView(layout) })
    }
    override fun onPause() { super.onPause(); window.decorView.clearFocus() }
}
