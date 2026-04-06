package com.clipbridge.app.network

import android.util.Log
import com.clipbridge.app.crypto.Crypto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.*
import org.json.JSONObject
import java.util.concurrent.TimeUnit

private const val TAG = "SignalingClient"

typealias MsgHandler = (JSONObject) -> Unit

class SignalingClient(
    private val serverUrl: String,
    private val deviceId: String,
    private val deviceName: String,
    private val publicKey: String,
) {
    private val client = OkHttpClient.Builder()
        .pingInterval(30, TimeUnit.SECONDS)
        .build()

    private var ws: WebSocket? = null
    private val handlers = mutableListOf<MsgHandler>()
    private var reconnectDelay = 1000L
    private val scope = CoroutineScope(Dispatchers.IO)
    var isConnected = false
        private set

    fun onMessage(handler: MsgHandler): () -> Unit {
        handlers.add(handler)
        return { handlers.remove(handler) }
    }

    fun connect() { _connect() }

    private fun _connect() {
        val request = Request.Builder().url(serverUrl).build()
        ws = client.newWebSocket(request, object : WebSocketListener() {

            override fun onOpen(ws: WebSocket, response: Response) {
                reconnectDelay = 1000L
                isConnected = true
                send(JSONObject().apply {
                    put("type", "REGISTER")
                    put("deviceId", deviceId)
                    put("deviceName", deviceName)
                    put("publicKey", publicKey)
                })
            }

            override fun onMessage(ws: WebSocket, text: String) {
                try {
                    val msg = JSONObject(text)
                    handlers.forEach { it(msg) }
                } catch (e: Exception) {
                    Log.w(TAG, "bad message: $text")
                }
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                isConnected = false
                dispatch(JSONObject().put("type", "DISCONNECTED"))
                scheduleReconnect()
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                isConnected = false
                Log.w(TAG, "ws failure: ${t.message}")
                scheduleReconnect()
            }
        })
    }

    private fun dispatch(msg: JSONObject) = handlers.forEach { it(msg) }

    private fun scheduleReconnect() {
        scope.launch {
            delay(reconnectDelay)
            reconnectDelay = minOf(reconnectDelay * 2, 30_000L)
            _connect()
        }
    }

    fun send(payload: JSONObject) {
        ws?.send(payload.toString())
    }

    fun createPairToken() = send(JSONObject().put("type", "PAIR_CREATE"))

    fun joinPairToken(token: String) = send(JSONObject().apply {
        put("type", "PAIR_JOIN")
        put("token", token)
    })

    fun relay(to: String, msgId: String, payload: Crypto.EncryptedPayload) {
        send(JSONObject().apply {
            put("type", "RELAY")
            put("to", to)
            put("msgId", msgId)
            put("payload", JSONObject().apply {
                put("nonce", payload.nonce)
                put("box", payload.box)
            })
        })
    }
}
