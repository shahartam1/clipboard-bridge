import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store/appStore";
import type { AppSettings } from "../lib/storage";
import "./SettingsView.css";

// ── Shortcut recorder ─────────────────────────────────────────────────────────

interface ShortcutRecorderProps {
  value: string;
  onChange: (shortcut: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

function ShortcutRecorder({
  value,
  onChange,
  placeholder = "Click to record…",
  disabled = false,
}: ShortcutRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLButtonElement>(null);

  // Keep local draft in sync when parent value changes
  useEffect(() => { setDraft(value); }, [value]);

  function startRecording() {
    if (disabled) return;
    setRecording(true);
    setDraft("");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();

    // Ignore modifier-only presses
    if (["Control", "Shift", "Alt", "Meta", "CapsLock"].includes(e.key)) return;

    const mods: string[] = [];
    if (e.ctrlKey || e.metaKey) mods.push("CommandOrControl");
    if (e.shiftKey) mods.push("Shift");
    if (e.altKey) mods.push("Alt");

    const key = e.key.length === 1 ? e.key.toUpperCase() : mapKey(e.key);
    if (!key) return; // unknown key

    const shortcut = [...mods, key].join("+");
    setDraft(shortcut);
    setRecording(false);
    onChange(shortcut);
  }

  function onBlur() {
    if (recording) {
      setRecording(false);
      setDraft(value); // revert if nothing recorded
    }
  }

  const displayLabel = recording
    ? "Press a key combination…"
    : draft
    ? formatShortcut(draft)
    : placeholder;

  return (
    <button
      ref={inputRef}
      className={`shortcut-recorder${recording ? " shortcut-recorder--recording" : ""}${disabled ? " shortcut-recorder--disabled" : ""}`}
      onClick={startRecording}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      tabIndex={disabled ? -1 : 0}
      title={recording ? "Press a key combination" : "Click to record a new shortcut"}
    >
      {recording
        ? <span className="shortcut-recording-hint">⌨ {displayLabel}</span>
        : <span className="shortcut-keys">{displayLabel}</span>}
    </button>
  );
}

/** Map non-printable JS key names to Tauri shortcut key names. */
function mapKey(key: string): string | null {
  const MAP: Record<string, string> = {
    Backspace: "Backspace", Delete: "Delete", Tab: "Tab", Escape: "Escape",
    Enter: "Return", Return: "Return", Space: "Space",
    ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down",
    Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
    Insert: "Insert", PrintScreen: "Print",
    F1: "F1", F2: "F2", F3: "F3", F4: "F4", F5: "F5", F6: "F6",
    F7: "F7", F8: "F8", F9: "F9", F10: "F10", F11: "F11", F12: "F12",
  };
  return MAP[key] ?? null;
}

/** Pretty-print a Tauri shortcut string (e.g. "CommandOrControl+Shift+C" → "⌘⇧C"). */
function formatShortcut(sc: string): string {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  return sc
    .replace("CommandOrControl", isMac ? "⌘" : "Ctrl")
    .replace("Shift", "⇧")
    .replace("Alt", isMac ? "⌥" : "Alt")
    .replace(/\+/g, "");
}

// ── Main Settings component ───────────────────────────────────────────────────

export default function SettingsView() {
  const identity      = useAppStore(s => s.identity);
  const setDeviceName = useAppStore(s => s.setDeviceName);
  const settings      = useAppStore(s => s.settings);
  const saveSettings  = useAppStore(s => s.saveSettings);

  const [name, setName]       = useState(identity.deviceName);
  const [nameSaved, setNameSaved] = useState(false);

  // Local editable copies of shortcuts
  const [sendShortcut, setSendShortcut] = useState(settings.sendShortcut);
  const [ocrShortcut, setOcrShortcut]   = useState<string>(settings.ocrShortcut ?? "");
  const [ocrEnabled, setOcrEnabled]     = useState<boolean>(!!settings.ocrShortcut);

  const [shortcutMsg, setShortcutMsg]   = useState("");
  const [shortcutError, setShortcutError] = useState(false);

  // Keep local state in sync if settings change from outside
  useEffect(() => {
    setSendShortcut(settings.sendShortcut);
    setOcrShortcut(settings.ocrShortcut ?? "");
    setOcrEnabled(!!settings.ocrShortcut);
  }, [settings]);

  // ── Device name save ────────────────────────────────────────────────────
  function saveDeviceName() {
    setDeviceName(name);
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 2000);
  }

  // ── Shortcut save ────────────────────────────────────────────────────────
  async function applyShortcuts() {
    setShortcutMsg("");
    setShortcutError(false);

    const newOcr: string | null = ocrEnabled && ocrShortcut ? ocrShortcut : null;

    // Validate: send shortcut must have at least one modifier + one key
    if (!sendShortcut || sendShortcut.split("+").length < 2) {
      setShortcutMsg("Quick-send shortcut must include a modifier key (⌘/Ctrl, ⇧, ⌥).");
      setShortcutError(true);
      return;
    }
    if (newOcr && newOcr.split("+").length < 2) {
      setShortcutMsg("OCR shortcut must include a modifier key.");
      setShortcutError(true);
      return;
    }
    if (newOcr && newOcr === sendShortcut) {
      setShortcutMsg("OCR shortcut must be different from the quick-send shortcut.");
      setShortcutError(true);
      return;
    }

    try {
      await invoke("update_send_shortcut", { newShortcut: sendShortcut });
      await invoke("update_ocr_shortcut", { newShortcut: newOcr });

      const newSettings: AppSettings = {
        ...settings,
        sendShortcut,
        ocrShortcut: newOcr,
      };
      saveSettings(newSettings);
      setShortcutMsg("Shortcuts saved ✓");
      setTimeout(() => setShortcutMsg(""), 2500);
    } catch (err) {
      setShortcutMsg(`Failed to register shortcut: ${err}`);
      setShortcutError(true);
    }
  }

  return (
    <div>
      <h2 className="view-title">Settings</h2>

      {/* ── Device ── */}
      <div className="card">
        <h3 className="section-title" style={{ marginTop: 0 }}>This Device</h3>

        <div className="field">
          <label className="field-label">Device Name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") saveDeviceName(); }}
            placeholder="My MacBook"
          />
        </div>

        <div className="field">
          <label className="field-label">Device ID</label>
          <div className="mono-box">{identity.deviceId}</div>
        </div>

        <div className="field">
          <label className="field-label">Public Key</label>
          <div className="mono-box truncate">{identity.keyPair.publicKey}</div>
        </div>

        <button className="btn-primary" onClick={saveDeviceName} disabled={!name.trim()}>
          {nameSaved ? "✓ Saved" : "Save"}
        </button>
      </div>

      {/* ── Shortcuts ── */}
      <div className="card">
        <h3 className="section-title" style={{ marginTop: 0 }}>Keyboard Shortcuts</h3>
        <p className="muted" style={{ marginBottom: 14 }}>
          Click a shortcut box, then press your desired key combination.
        </p>

        <div className="field">
          <label className="field-label">Quick-Send (copies clipboard → choose device)</label>
          <ShortcutRecorder
            value={sendShortcut}
            onChange={setSendShortcut}
          />
          <p className="field-hint">
            Currently: <code>{sendShortcut}</code>
            {" · "}displays as <strong>{formatShortcut(sendShortcut)}</strong>
          </p>
        </div>

        <div className="field">
          <label className="field-label">OCR Capture Shortcut</label>
          <div className="toggle-row">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={ocrEnabled}
                onChange={e => setOcrEnabled(e.target.checked)}
              />
              Enable a global shortcut for "Extract text from picture"
            </label>
          </div>
          {ocrEnabled && (
            <>
              <ShortcutRecorder
                value={ocrShortcut}
                onChange={setOcrShortcut}
                placeholder="Click to record…"
                disabled={!ocrEnabled}
              />
              {ocrShortcut && (
                <p className="field-hint">
                  Currently: <code>{ocrShortcut}</code>
                  {" · "}displays as <strong>{formatShortcut(ocrShortcut)}</strong>
                </p>
              )}
            </>
          )}
          {!ocrEnabled && (
            <p className="field-hint muted">
              OCR is available as an in-app button in the Send tab.
            </p>
          )}
        </div>

        {shortcutMsg && (
          <p className={`shortcut-msg${shortcutError ? " shortcut-msg--error" : " shortcut-msg--ok"}`}>
            {shortcutMsg}
          </p>
        )}

        <button className="btn-primary" onClick={applyShortcuts}>
          Apply Shortcuts
        </button>
      </div>

      {/* ── Server ── */}
      <div className="card">
        <h3 className="section-title" style={{ marginTop: 0 }}>Server</h3>
        <p className="muted">
          Connect to your own signaling server by setting <code>VITE_SERVER_URL</code> in a <code>.env</code> file.
        </p>
        <p className="muted" style={{ marginTop: 8 }}>
          Default: <code>ws://localhost:8787</code>
        </p>
      </div>
    </div>
  );
}
