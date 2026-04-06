package com.clipbridge.app.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.clipbridge.app.databinding.*
import com.google.android.material.tabs.TabLayout
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(com.clipbridge.app.R.layout.activity_main)

        if (savedInstanceState == null) {
            supportFragmentManager.beginTransaction()
                .replace(com.clipbridge.app.R.id.fragment_container, SendFragment())
                .commit()
        }

        // Handle deep link: clipboard-bridge://pair/TOKEN
        intent?.data?.let { uri ->
            if (uri.scheme == "clipboard-bridge" && uri.host == "pair") {
                val token = uri.pathSegments.firstOrNull()
                if (!token.isNullOrBlank()) {
                    supportFragmentManager.beginTransaction()
                        .replace(com.clipbridge.app.R.id.fragment_container, PairFragment().apply {
                            arguments = Bundle().apply { putString("token", token) }
                        })
                        .commit()
                }
            }
        }

        val tabs = findViewById<TabLayout>(com.clipbridge.app.R.id.tabs)
        tabs.addOnTabSelectedListener(object : TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: TabLayout.Tab) {
                val fragment: Fragment = when (tab.position) {
                    0 -> SendFragment()
                    1 -> DevicesFragment()
                    2 -> PairFragment()
                    3 -> SettingsFragment()
                    else -> SendFragment()
                }
                supportFragmentManager.beginTransaction()
                    .replace(com.clipbridge.app.R.id.fragment_container, fragment)
                    .commit()
            }
            override fun onTabUnselected(tab: TabLayout.Tab) {}
            override fun onTabReselected(tab: TabLayout.Tab) {}
        })
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Fragments
// ──────────────────────────────────────────────────────────────────────────────

class SendFragment : Fragment() {
    private val vm: MainViewModel by activityViewModels()
    private var _b: FragmentSendBinding? = null
    private val b get() = _b!!

    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?) =
        FragmentSendBinding.inflate(i, c, false).also { _b = it }.root

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        viewLifecycleOwner.lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                vm.state.collect { state ->
                    b.statusText.text = if (state.connected) "● Connected" else "○ Connecting…"

                    // Populate peer spinner
                    val peers = state.peers
                    val peerNames = peers.map { it.name }.toTypedArray()
                    val adapter = android.widget.ArrayAdapter(requireContext(),
                        android.R.layout.simple_spinner_item, peerNames)
                    adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
                    b.peerSpinner.adapter = adapter

                    // Latest incoming clip
                    val latest = state.incoming.firstOrNull()
                    if (latest != null) {
                        b.incomingCard.visibility = View.VISIBLE
                        b.incomingFrom.text = "From: ${latest.fromName}"
                        b.incomingContent.text = latest.content
                        b.btnCopy.setOnClickListener {
                            copyToClipboard(latest.content)
                            vm.dismissClip(latest.id)
                            Toast.makeText(requireContext(), "Copied!", Toast.LENGTH_SHORT).show()
                        }
                        b.btnDismiss.setOnClickListener { vm.dismissClip(latest.id) }
                    } else {
                        b.incomingCard.visibility = View.GONE
                    }
                }
            }
        }

        b.btnSend.setOnClickListener {
            val text = b.editText.text.toString().trim()
            if (text.isEmpty()) return@setOnClickListener
            val pos = b.peerSpinner.selectedItemPosition
            val peers = vm.state.value.peers
            if (pos < 0 || pos >= peers.size) {
                Toast.makeText(requireContext(), "Select a device first", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            vm.sendText(peers[pos].id, text)
            b.editText.setText("")
            Toast.makeText(requireContext(), "Sent!", Toast.LENGTH_SHORT).show()
        }
    }

    private fun copyToClipboard(text: String) {
        val cm = requireContext().getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("ClipBridge", text))
    }

    override fun onDestroyView() { super.onDestroyView(); _b = null }
}

class DevicesFragment : Fragment() {
    private val vm: MainViewModel by activityViewModels()

    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?) =
        FragmentDevicesBinding.inflate(i, c, false).also { bind ->
            viewLifecycleOwner.lifecycleScope.launch {
                repeatOnLifecycle(Lifecycle.State.STARTED) {
                    vm.state.collect { state ->
                        bind.peerList.removeAllViews()
                        if (state.peers.isEmpty()) {
                            bind.emptyText.visibility = View.VISIBLE
                        } else {
                            bind.emptyText.visibility = View.GONE
                            state.peers.forEach { peer ->
                                val row = LayoutInflater.from(requireContext())
                                    .inflate(com.clipbridge.app.R.layout.item_peer, bind.peerList, false)
                                row.findViewById<android.widget.TextView>(com.clipbridge.app.R.id.peerName).text = peer.name
                                row.findViewById<android.widget.TextView>(com.clipbridge.app.R.id.peerId).text = peer.id.take(16) + "…"
                                row.findViewById<android.widget.Button>(com.clipbridge.app.R.id.btnRemove).setOnClickListener {
                                    vm.removePeer(peer.id)
                                }
                                bind.peerList.addView(row)
                            }
                        }
                    }
                }
            }
        }.root
}

class PairFragment : Fragment() {
    private val vm: MainViewModel by activityViewModels()
    private var _b: FragmentPairBinding? = null
    private val b get() = _b!!

    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?) =
        FragmentPairBinding.inflate(i, c, false).also { _b = it }.root

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        // Handle pre-filled token from deep link
        arguments?.getString("token")?.let { b.joinInput.setText(it) }

        b.btnGenerateToken.setOnClickListener { vm.requestPairToken() }
        b.btnJoin.setOnClickListener {
            val token = b.joinInput.text.toString().trim()
            if (token.isNotEmpty()) vm.joinPairToken(token)
        }

        viewLifecycleOwner.lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                vm.state.collect { state ->
                    b.tokenDisplay.text = state.pairingToken ?: "—"
                    b.pairingStatus.text = when (state.pairingStatus) {
                        "waiting"  -> "Waiting for other device…"
                        "joining"  -> "Pairing…"
                        "success"  -> "✓ Paired!"
                        "error"    -> "Error: ${state.pairingError}"
                        else       -> ""
                    }
                    if (state.pairingStatus == "success") {
                        Toast.makeText(requireContext(), "Paired successfully!", Toast.LENGTH_LONG).show()
                        vm.resetPairing()
                    }
                }
            }
        }
    }

    override fun onDestroyView() { super.onDestroyView(); _b = null }
}

class SettingsFragment : Fragment() {
    private val vm: MainViewModel by activityViewModels()
    private var _b: FragmentSettingsBinding? = null
    private val b get() = _b!!

    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?) =
        FragmentSettingsBinding.inflate(i, c, false).also { _b = it }.root

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val identity = vm.getIdentity()
        b.deviceIdText.text = identity.deviceId
        b.nameInput.setText(vm.state.value.deviceName)

        b.btnSaveName.setOnClickListener {
            vm.setDeviceName(b.nameInput.text.toString().trim())
            Toast.makeText(requireContext(), "Saved", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onDestroyView() { super.onDestroyView(); _b = null }
}
