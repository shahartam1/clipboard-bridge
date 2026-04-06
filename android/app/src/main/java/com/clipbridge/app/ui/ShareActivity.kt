package com.clipbridge.app.ui

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.clipbridge.app.databinding.ActivityShareBinding
import com.clipbridge.app.network.AppRepository
import com.clipbridge.app.crypto.Crypto
import com.clipbridge.app.network.SignalingClient
import java.util.UUID

/**
 * Translucent activity invoked from the Android Share sheet.
 * Lets the user pick a paired device and sends the shared text.
 */
class ShareActivity : AppCompatActivity() {

    private lateinit var binding: ActivityShareBinding
    private lateinit var repo: AppRepository
    private lateinit var signalingClient: SignalingClient

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityShareBinding.inflate(LayoutInflater.from(this))
        setContentView(binding.root)

        repo = AppRepository(this)
        val identity = repo.getOrCreateIdentity()

        val sharedText = intent?.getStringExtra(Intent.EXTRA_TEXT) ?: run {
            Toast.makeText(this, "No text to share", Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        val peers = repo.getPeers()
        if (peers.isEmpty()) {
            Toast.makeText(this, "No paired devices. Open ClipBridge and pair a device first.", Toast.LENGTH_LONG).show()
            finish()
            return
        }

        val peerNames = peers.map { it.name }.toTypedArray()
        binding.peerSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, peerNames)
            .also { it.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item) }

        binding.sharedPreview.text = sharedText.take(200) + if (sharedText.length > 200) "…" else ""

        signalingClient = SignalingClient(
            serverUrl  = "ws://10.0.2.2:8787",
            deviceId   = identity.deviceId,
            deviceName = identity.deviceName,
            publicKey  = identity.publicKey,
        )
        signalingClient.onMessage { msg ->
            when (msg.optString("type")) {
                "REGISTERED" -> runOnUiThread { binding.btnSend.isEnabled = true }
                "ACK"        -> runOnUiThread {
                    Toast.makeText(this, "Sent!", Toast.LENGTH_SHORT).show()
                    finish()
                }
            }
        }
        signalingClient.connect()

        binding.btnSend.isEnabled = false
        binding.btnSend.setOnClickListener {
            val pos  = binding.peerSpinner.selectedItemPosition
            val peer = peers[pos]
            val msgId = UUID.randomUUID().toString()
            val dataType = if (sharedText.startsWith("http")) "url" else "text"
            val inner = """{"dataType":"$dataType","content":${org.json.JSONObject.quote(sharedText)}}"""
            val encrypted = Crypto.encrypt(inner, identity.secretKey, peer.publicKey)
            signalingClient.relay(peer.id, msgId, encrypted)
        }

        binding.btnCancel.setOnClickListener { finish() }
    }
}
