#!/usr/bin/env bash
set -e

echo "=== ClipBridge Setup ==="

# 1. Install Node.js
if ! command -v node &>/dev/null; then
  echo "Installing Node.js via Homebrew…"
  brew install node
fi

# 2. Install Rust (required for Tauri)
if ! command -v rustc &>/dev/null; then
  echo "Installing Rust…"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
fi

# 3. Install Tauri CLI
if ! command -v cargo-tauri &>/dev/null; then
  echo "Installing Tauri CLI…"
  cargo install tauri-cli --version "^2"
fi

# 4. Install server deps
echo "Installing server dependencies…"
cd "$(dirname "$0")/server"
npm install

# 5. Install desktop deps
echo "Installing desktop dependencies…"
cd "$(dirname "$0")/desktop"
npm install

echo ""
echo "=== Setup complete! ==="
echo ""
echo "To run everything:"
echo "  Terminal 1 (server):   cd server && npm run dev"
echo "  Terminal 2 (desktop):  cd desktop && npm run tauri dev"
echo "  Android: Open the 'android' folder in Android Studio and run on device/emulator"
echo ""
echo "  NOTE: On Android emulator, ws://10.0.2.2:8787 reaches your Mac's localhost."
echo "  On a real Android device, update SERVER_URL in MainViewModel.kt to your Mac's LAN IP."
