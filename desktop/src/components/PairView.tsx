import { useState, useEffect, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useAppStore } from "../store/appStore";
import "./PairView.css";

const TOKEN_TTL = 120; // seconds — must match server (2 min)

function useCountdown(active: boolean, onExpire: () => void) {
  const [secondsLeft, setSecondsLeft] = useState(TOKEN_TTL);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire; // always up-to-date, no stale closure

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);

    if (!active) {
      setSecondsLeft(TOKEN_TTL);
      return;
    }

    setSecondsLeft(TOKEN_TTL);
    timerRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          onExpireRef.current();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [active]);

  const mins    = String(Math.floor(secondsLeft / 60));
  const secs    = String(secondsLeft % 60).padStart(2, "0");
  const display = `${mins}:${secs}`;
  const urgent  = secondsLeft <= 30;
  const pct     = (secondsLeft / TOKEN_TTL) * 100;

  return { secondsLeft, display, urgent, pct };
}

export default function PairView() {
  const requestPairToken = useAppStore(s => s.requestPairToken);
  const joinPairToken    = useAppStore(s => s.joinPairToken);
  const pairingToken     = useAppStore(s => s.pairingToken);
  const pairingStatus    = useAppStore(s => s.pairingStatus);
  const pairingError     = useAppStore(s => s.pairingError);
  const connected        = useAppStore(s => s.connected);

  const [joinCode, setJoinCode] = useState("");
  const [mode, setMode]         = useState<"host" | "join">("host");

  const isWaiting = pairingStatus === "waiting";
  const hasToken  = !!pairingToken;

  function reset() {
    useAppStore.setState({ pairingToken: null, pairingStatus: "idle", pairingError: null });
    setJoinCode("");
  }

  const { display, urgent, pct } = useCountdown(isWaiting && hasToken, reset);

  // ── Success screen ───────────────────────────────────────────────────────
  if (pairingStatus === "success") {
    return (
      <div>
        <h2 className="view-title">Pair Device</h2>
        <div className="card success-card">
          <div className="success-icon">✓</div>
          <h3>Paired successfully!</h3>
          <p className="muted">The device has been added to your trusted list.</p>
          <button className="btn-primary" style={{ marginTop: 16 }} onClick={reset}>Done</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="view-title">Pair Device</h2>

      {!connected && (
        <div className="card warn-card">
          Connecting to server… pairing will be available once connected.
        </div>
      )}

      <div className="mode-tabs">
        <button className={`mode-tab ${mode === "host" ? "active" : ""}`}
          onClick={() => { setMode("host"); reset(); }}>Show code</button>
        <button className={`mode-tab ${mode === "join" ? "active" : ""}`}
          onClick={() => { setMode("join"); reset(); }}>Enter code</button>
      </div>

      {/* ── HOST: generate + show code ─────────────────────────── */}
      {mode === "host" && (
        <div className="card">
          {/* Idle — show generate button */}
          {!isWaiting && (
            <div className="generate-section">
              <p className="muted">Generate a pairing code and show it (or the QR) to the other device.</p>
              <button className="btn-primary" style={{ marginTop: 14 }}
                onClick={requestPairToken} disabled={!connected}>
                Generate code
              </button>
            </div>
          )}

          {/* Waiting: generating… */}
          {isWaiting && !hasToken && (
            <div className="generating-section">
              <div className="spinner" />
              <p className="muted" style={{ marginTop: 10 }}>Generating code…</p>
              <button className="btn-ghost" style={{ marginTop: 12 }} onClick={reset}>Cancel</button>
            </div>
          )}

          {/* Waiting: token received — show it */}
          {isWaiting && hasToken && (
            <div className="token-section">
              {/* Countdown bar */}
              <div className="countdown-row">
                <span className="field-label" style={{ margin: 0 }}>Pairing code</span>
                <span className={`countdown-timer ${urgent ? "urgent" : ""}`}>
                  {urgent ? "⚠ " : ""}Expires in {display}
                </span>
              </div>
              <div className="countdown-bar-track">
                <div className={`countdown-bar-fill ${urgent ? "urgent" : ""}`}
                  style={{ width: `${pct}%` }} />
              </div>

              <div className="token-display">{pairingToken}</div>

              {pairingToken && (
                <div className="qr-wrap">
                  <QRCodeSVG
                    value={`clipboard-bridge://pair/${pairingToken}`}
                    size={180}
                    bgColor="transparent"
                    fgColor="#e8e8f0"
                    level="M"
                  />
                </div>
              )}

              <div className="token-actions">
                <button className="btn-ghost" onClick={reset}>Cancel</button>
                <button className="btn-ghost" onClick={requestPairToken}>↺ New code</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── GUEST: enter code ──────────────────────────────────── */}
      {mode === "join" && (
        <div className="card">
          <p className="muted">Enter the 3-word code shown on the other device.</p>
          <div className="field" style={{ marginTop: 14 }}>
            <input
              placeholder="word-word-word"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toLowerCase())}
              onKeyDown={e => { if (e.key === "Enter") joinPairToken(joinCode); }}
              autoFocus
            />
          </div>
          {pairingError && (
            <p className="error-text">❌ {pairingError.replace(/_/g, " ")}</p>
          )}
          <button className="btn-primary"
            onClick={() => joinPairToken(joinCode)}
            disabled={!joinCode.trim() || !connected || pairingStatus === "joining"}>
            {pairingStatus === "joining" ? "Pairing…" : "Pair"}
          </button>
        </div>
      )}
    </div>
  );
}
