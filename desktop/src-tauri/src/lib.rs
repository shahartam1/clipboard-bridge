use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

// ── App-level state ───────────────────────────────────────────────────────────

struct AppState {
    /// Base64-encoded PNG of the last screen capture (consumed by ocr-overlay)
    screen_capture: Mutex<Option<String>>,
    /// The currently registered "quick-send" shortcut string
    send_shortcut: Mutex<String>,
    /// The currently registered OCR trigger shortcut string (None = no shortcut)
    ocr_shortcut: Mutex<Option<String>>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Capture the primary monitor as a base64-encoded PNG.
fn take_screenshot_b64() -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let tmp_path = std::env::temp_dir().join("cb_screen_capture.png");
    let tmp_str = tmp_path.to_string_lossy().to_string();

    #[cfg(target_os = "macos")]
    {
        // -x = no sound, -t png, -D 1 = primary display (macOS 10.15+)
        let out = std::process::Command::new("screencapture")
            .args(["-x", "-t", "png", &tmp_str])
            .output()
            .map_err(|e| format!("screencapture failed: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "screencapture exited with {}",
                out.status
            ));
        }
    }

    #[cfg(target_os = "windows")]
    {
        // PowerShell + .NET screenshot (works on all modern Windows versions)
        let ps = format!(
            r#"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save('{path}')
$g.Dispose(); $bmp.Dispose()
"#,
            path = tmp_str.replace('\'', "''")
        );
        let out = std::process::Command::new("powershell")
            .args(["-NonInteractive", "-Command", &ps])
            .output()
            .map_err(|e| format!("PowerShell failed: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "PowerShell screenshot exited with {}: {}",
                out.status,
                String::from_utf8_lossy(&out.stderr)
            ));
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        // Linux fallback via scrot
        let _ = std::process::Command::new("scrot")
            .arg(&tmp_str)
            .output()
            .map_err(|e| format!("scrot failed: {e}"))?;
    }

    let bytes =
        std::fs::read(&tmp_path).map_err(|e| format!("read screenshot file: {e}"))?;
    let _ = std::fs::remove_file(&tmp_path);

    Ok(STANDARD.encode(&bytes))
}

/// Register the quick-send shortcut. Safe to call multiple times after
/// unregistering the previous one.
fn register_send_shortcut(app: &tauri::AppHandle, shortcut: &str) -> Result<(), String> {
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _sc, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            let text = app
                .clipboard()
                .read_text()
                .unwrap_or_default()
                .trim()
                .to_string();
            if text.is_empty() {
                return;
            }
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
            let _ = app.emit("quick-send-triggered", text);
        })
        .map_err(|e| e.to_string())
}

/// Register the OCR trigger shortcut (emits "trigger-ocr-capture" to main).
fn register_ocr_shortcut(app: &tauri::AppHandle, shortcut: &str) -> Result<(), String> {
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _sc, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            let _ = app.emit("trigger-ocr-capture", ());
        })
        .map_err(|e| e.to_string())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

#[tauri::command]
fn show_clip_notification(
    app: tauri::AppHandle,
    from: String,
    data_type: String,
    content: String,
) -> Result<(), String> {
    let win = app
        .get_webview_window("clipnotif")
        .ok_or_else(|| "clipnotif window not found".to_string())?;

    let screen_w = app
        .get_webview_window("main")
        .and_then(|w| w.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
        .map(|m| m.size().width as f64 / m.scale_factor())
        .unwrap_or(1920.0);

    let x = screen_w - 360.0 - 16.0;
    let y = 25.0;

    let payload = serde_json::json!({
        "from": from,
        "dataType": data_type,
        "content": content,
    });
    let json_str = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    win.eval(&format!(
        "window.__cb_notif={};if(typeof window.__cb_notif_cb==='function')window.__cb_notif_cb();",
        json_str
    ))
    .map_err(|e| e.to_string())?;

    win.emit("clip-notification", payload)
        .map_err(|e| e.to_string())?;

    win.show().map_err(|e| e.to_string())?;
    win.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)))
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Called from the Send view when the user clicks "Extract text from picture".
/// Captures the primary monitor, stores the base64 PNG in app state, then
/// opens (or re-shows) the full-screen OCR overlay window.
#[tauri::command]
fn start_ocr_capture(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let b64 = take_screenshot_b64()?;

    *state
        .screen_capture
        .lock()
        .map_err(|e| e.to_string())? = Some(b64);

    let win = app
        .get_webview_window("ocr-overlay")
        .ok_or_else(|| "ocr-overlay window not found".to_string())?;

    // Size overlay to cover the primary monitor's logical area
    let (lw, lh) = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let sf = m.scale_factor();
            (
                m.size().width as f64 / sf,
                m.size().height as f64 / sf,
            )
        })
        .unwrap_or((1920.0, 1080.0));

    win.set_size(tauri::Size::Logical(tauri::LogicalSize::new(lw, lh)))
        .map_err(|e| e.to_string())?;
    win.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(
        0.0, 0.0,
    )))
    .map_err(|e| e.to_string())?;
    win.show().map_err(|e| e.to_string())?;
    win.set_focus().map_err(|e| e.to_string())?;

    Ok(())
}

/// Called by the OCR overlay on mount to retrieve the captured screenshot.
/// Returns the base64 PNG string and clears the stored value.
#[tauri::command]
fn get_screen_capture(state: tauri::State<'_, AppState>) -> Option<String> {
    state
        .screen_capture
        .lock()
        .ok()
        .and_then(|mut g| g.take())
}

/// Close (hide) the OCR overlay — called after OCR completes or on cancel.
#[tauri::command]
fn close_ocr_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("ocr-overlay") {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Replace the quick-send global shortcut at runtime.
#[tauri::command]
fn update_send_shortcut(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    new_shortcut: String,
) -> Result<(), String> {
    let mut current = state
        .send_shortcut
        .lock()
        .map_err(|e| e.to_string())?;

    // Unregister old (ignore errors — it might not be registered)
    let _ = app.global_shortcut().unregister(current.as_str());

    // Register new
    register_send_shortcut(&app, &new_shortcut)?;

    *current = new_shortcut;
    Ok(())
}

/// Replace (or clear) the OCR trigger global shortcut at runtime.
/// Pass `new_shortcut = null` from JS to disable the OCR shortcut.
#[tauri::command]
fn update_ocr_shortcut(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    new_shortcut: Option<String>,
) -> Result<(), String> {
    let mut current = state
        .ocr_shortcut
        .lock()
        .map_err(|e| e.to_string())?;

    // Unregister current OCR shortcut if any
    if let Some(ref sc) = *current {
        let _ = app.global_shortcut().unregister(sc.as_str());
    }

    // Register new shortcut if provided
    if let Some(ref sc) = new_shortcut {
        register_ocr_shortcut(&app, sc)?;
    }

    *current = new_shortcut;
    Ok(())
}

// ── Application entry point ───────────────────────────────────────────────────

pub fn run() {
    const DEFAULT_SEND_SHORTCUT: &str = "CommandOrControl+Shift+C";

    tauri::Builder::default()
        .manage(AppState {
            screen_capture: Mutex::new(None),
            send_shortcut: Mutex::new(DEFAULT_SEND_SHORTCUT.to_string()),
            ocr_shortcut: Mutex::new(None),
        })
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        // No with_handler — we use on_shortcut() per shortcut instead
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // Register quick-send shortcut
            register_send_shortcut(app.handle(), DEFAULT_SEND_SHORTCUT)
                .map_err(|e| Box::<dyn std::error::Error>::from(e))?;

            // Build system tray
            let quit =
                MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show = MenuItem::with_id(
                app,
                "show",
                "Open ClipBridge",
                true,
                None::<&str>,
            )?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .menu(&menu)
                .icon(app.default_window_icon().cloned().unwrap())
                .tooltip("Clipboard Bridge")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_platform,
            show_clip_notification,
            start_ocr_capture,
            get_screen_capture,
            close_ocr_overlay,
            update_send_shortcut,
            update_ocr_shortcut,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
