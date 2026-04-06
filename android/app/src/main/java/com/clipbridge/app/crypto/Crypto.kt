package com.clipbridge.app.crypto

import android.util.Base64
import com.iwebpp.crypto.TweetNaclFast
import java.security.SecureRandom

/**
 * Thin wrapper around TweetNaCl (X25519 key exchange + XSalsa20-Poly1305).
 * Mirrors the desktop crypto.ts implementation so both sides are compatible.
 */
object Crypto {

    data class KeyPair(val publicKey: String, val secretKey: String)

    fun generateKeyPair(): KeyPair {
        val kp = TweetNaclFast.Box.keyPair()
        return KeyPair(
            publicKey = Base64.encodeToString(kp.publicKey, Base64.NO_WRAP),
            secretKey = Base64.encodeToString(kp.secretKey, Base64.NO_WRAP),
        )
    }

    fun generateDeviceId(): String {
        val bytes = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val hex = bytes.joinToString("") { "%02x".format(it) }
        return "${hex.slice(0..7)}-${hex.slice(8..11)}-4${hex.slice(13..15)}-" +
               "${((hex[16].digitToInt(16) and 0x3) or 0x8).toString(16)}${hex.slice(17..19)}-${hex.slice(20..31)}"
    }

    data class EncryptedPayload(val nonce: String, val box: String)

    fun encrypt(plaintext: String, mySecretKey: String, peerPublicKey: String): EncryptedPayload {
        val box = TweetNaclFast.Box(
            Base64.decode(peerPublicKey, Base64.NO_WRAP),
            Base64.decode(mySecretKey,   Base64.NO_WRAP),
        )
        val nonce = box.generateNonce()
        val msg   = plaintext.toByteArray(Charsets.UTF_8)
        val encrypted = box.box(msg, nonce) ?: error("Encryption failed")
        return EncryptedPayload(
            nonce = Base64.encodeToString(nonce,     Base64.NO_WRAP),
            box   = Base64.encodeToString(encrypted, Base64.NO_WRAP),
        )
    }

    fun decrypt(payload: EncryptedPayload, mySecretKey: String, peerPublicKey: String): String? {
        return try {
            val box = TweetNaclFast.Box(
                Base64.decode(peerPublicKey, Base64.NO_WRAP),
                Base64.decode(mySecretKey,   Base64.NO_WRAP),
            )
            val decrypted = box.open(
                Base64.decode(payload.box,   Base64.NO_WRAP),
                Base64.decode(payload.nonce, Base64.NO_WRAP),
            ) ?: return null
            String(decrypted, Charsets.UTF_8)
        } catch (e: Exception) {
            null
        }
    }
}
