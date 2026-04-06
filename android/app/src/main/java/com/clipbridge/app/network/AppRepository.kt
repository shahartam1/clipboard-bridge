package com.clipbridge.app.network

import android.content.Context
import android.content.SharedPreferences
import com.clipbridge.app.crypto.Crypto
import org.json.JSONArray
import org.json.JSONObject

private const val PREFS = "clipbridge_prefs"

data class PeerInfo(val id: String, val name: String, val publicKey: String, val addedAt: Long)

data class Identity(
    val deviceId: String,
    val deviceName: String,
    val publicKey: String,
    val secretKey: String,
)

class AppRepository(context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun getOrCreateIdentity(): Identity {
        var deviceId  = prefs.getString("device_id", null)
        var publicKey = prefs.getString("public_key", null)
        var secretKey = prefs.getString("secret_key", null)
        var name      = prefs.getString("device_name", null)

        if (deviceId == null || publicKey == null || secretKey == null) {
            val kp = Crypto.generateKeyPair()
            deviceId  = Crypto.generateDeviceId()
            publicKey = kp.publicKey
            secretKey = kp.secretKey
            prefs.edit()
                .putString("device_id",  deviceId)
                .putString("public_key", publicKey)
                .putString("secret_key", secretKey)
                .apply()
        }

        if (name == null) {
            name = "Android-${deviceId.take(6)}"
            prefs.edit().putString("device_name", name).apply()
        }

        return Identity(deviceId, name, publicKey, secretKey)
    }

    fun setDeviceName(name: String) = prefs.edit().putString("device_name", name).apply()

    fun getPeers(): List<PeerInfo> {
        val raw = prefs.getString("peers", "[]") ?: "[]"
        val arr = JSONArray(raw)
        return (0 until arr.length()).map {
            val obj = arr.getJSONObject(it)
            PeerInfo(obj.getString("id"), obj.getString("name"), obj.getString("publicKey"), obj.getLong("addedAt"))
        }
    }

    fun addPeer(peer: PeerInfo) {
        val peers = getPeers().filter { it.id != peer.id }.toMutableList()
        peers.add(peer)
        val arr = JSONArray(peers.map {
            JSONObject().apply {
                put("id", it.id); put("name", it.name)
                put("publicKey", it.publicKey); put("addedAt", it.addedAt)
            }
        })
        prefs.edit().putString("peers", arr.toString()).apply()
    }

    fun removePeer(id: String) {
        val peers = getPeers().filter { it.id != id }
        val arr = JSONArray(peers.map {
            JSONObject().apply {
                put("id", it.id); put("name", it.name)
                put("publicKey", it.publicKey); put("addedAt", it.addedAt)
            }
        })
        prefs.edit().putString("peers", arr.toString()).apply()
    }
}
