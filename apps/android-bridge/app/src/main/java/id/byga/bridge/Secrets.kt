package id.byga.bridge

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object Secrets {
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("byga-local", null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder("byga-local", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return generator.generateKey()
    }
    @Synchronized fun token(context: Context): String {
        val prefs = context.getSharedPreferences("secrets", Context.MODE_PRIVATE)
        val saved = prefs.getString("token", null)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        if (saved != null) {
            val bytes = Base64.decode(saved, Base64.NO_WRAP)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            return String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
        }
        val token = ByteArray(32).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val value = cipher.iv + cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        prefs.edit().putString("token", Base64.encodeToString(value, Base64.NO_WRAP)).apply()
        return token
    }
    fun rotate(context: Context) { LocalGate.stop(); context.getSharedPreferences("secrets", Context.MODE_PRIVATE).edit().remove("token").apply() }
}
