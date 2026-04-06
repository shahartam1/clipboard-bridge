package com.clipbridge.app.ui

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.clipbridge.app.crypto.Crypto
import com.clipbridge.app.network.AppRepository
import com.clipbridge.app.network.PeerInfo
import com.clipbridge.app.network.SignalingClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.UUID

private const val TAG = "MainViewModel"
private const val SERVER_URL = "ws://10.0.2.2:8787" // localhost alias in Android emulator

data class IncomingClip(
    val id: String,
    val fromName: String,
    val content: String,
    val dataType: String,
    val receivedAt: Long = System.currentTimeMillis(),
)

data class UiState(
    val connected: Boolean = false,
    val deviceName: String = "",
    val peers: List<PeerInfo> = emptyList(),
    val pairingToken: String? = null,
    val pairingStatus: String = "idle", // idle | waiting | joining | success | error
    val pairingError: String? = null,
    val incoming: List<IncomingClip> = emptyList(),
    val sendResult: String? = null,
)

class MainViewModel(app: Application) : AndroidViewModel(app) {

    val repo = AppRepository(app)
    private val identity = repo.getOrCreateIdentity()

    private val _state = MutableStateFlow(UiState(
        deviceName = identity.deviceName,
        peers = repo.getPeers(),
    ))
    val state = _state.asStateFlow()

    private val signalingClient = SignalingClient(
        serverUrl  = SERVER_URL,
        deviceId   = identity.deviceId,
        deviceName = identity.deviceName,
        publicKey  = identity.publicKey,
    )

    init {
        signalingClient.onMessage { msg -> handleServerMessage(msg) }
        signalingClient.connect()
    }

    private fun handleServerMessage(msg: JSONObject) {
        when (msg.getString("type")) {
            "REGISTERED"   -> _state.update { it.copy(connected = true) }
            "DISCONNECTED" -> _state.update { it.copy(connected = false) }

            "PAIR_TOKEN"   -> _state.update {
                it.copy(pairingToken = msg.getString("token"), pairingStatus = "waiting")
            }

            "PAIR_SUCCESS" -> {
                val peerId = msg.getString("peerId")
                val peerKey = msg.getString("peerPublicKey")
                val peer = PeerInfo(
                    id = peerId,
                    name = "Device-${peerId.take(6)}",
                    publicKey = peerKey,
                    addedAt = System.currentTimeMillis(),
                )
                repo.addPeer(peer)
                _state.update { it.copy(
                    peers = repo.getPeers(),
                    pairingStatus = "success",
                    pairingToken = null,
                ) }
            }

            "PAIR_ERROR"   -> _state.update {
                it.copy(pairingStatus = "error", pairingError = msg.optString("error"))
            }

            "RELAY" -> {
                val fromId = msg.getString("from")
                val peer   = repo.getPeers().find { it.id == fromId } ?: return
                val payloadObj = msg.getJSONObject("payload")
                val decrypted = Crypto.decrypt(
                    Crypto.EncryptedPayload(payloadObj.getString("nonce"), payloadObj.getString("box")),
                    identity.secretKey,
                    peer.publicKey,
                ) ?: return

                val inner   = JSONObject(decrypted)
                val clip = IncomingClip(
                    id       = msg.getString("msgId"),
                    fromName = peer.name,
                    content  = inner.getString("content"),
                    dataType = inner.getString("dataType"),
                )
                _state.update { it.copy(incoming = listOf(clip) + it.incoming) }
            }

            "ACK" -> {
                val status = msg.optString("status")
                _state.update { it.copy(sendResult = status) }
                Log.d(TAG, "ACK: $status for ${msg.optString("msgId")}")
            }
        }
    }

    fun requestPairToken() {
        _state.update { it.copy(pairingStatus = "waiting", pairingToken = null, pairingError = null) }
        signalingClient.createPairToken()
    }

    fun joinPairToken(token: String) {
        _state.update { it.copy(pairingStatus = "joining", pairingError = null) }
        signalingClient.joinPairToken(token)
    }

    fun sendText(peerId: String, text: String) {
        val peer = repo.getPeers().find { it.id == peerId } ?: return
        val msgId = UUID.randomUUID().toString()
        val dataType = if (text.startsWith("http")) "url" else "text"
        val inner = """{"dataType":"$dataType","content":${JSONObject.quote(text)}}"""
        val encrypted = Crypto.encrypt(inner, identity.secretKey, peer.publicKey)
        signalingClient.relay(peerId, msgId, encrypted)
    }

    fun dismissClip(id: String) {
        _state.update { it.copy(incoming = it.incoming.filter { c -> c.id != id }) }
    }

    fun removePeer(id: String) {
        repo.removePeer(id)
        _state.update { it.copy(peers = repo.getPeers()) }
    }

    fun setDeviceName(name: String) {
        repo.setDeviceName(name)
        _state.update { it.copy(deviceName = name) }
    }

    fun resetPairing() {
        _state.update { it.copy(pairingStatus = "idle", pairingToken = null, pairingError = null) }
    }

    fun getIdentity() = identity
}
