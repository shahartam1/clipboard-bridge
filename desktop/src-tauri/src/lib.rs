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
    /// Data-URL (e.g. "data:image/jpeg;base64,...") of the last screen capture.
    /// Produced by the JS getDisplayMedia capture and consumed by the OCR overlay.
    screen_capture: Mutex<Option<String>>,
    /// The currently registered "quick-send" shortcut string
    send_shortcut: Mutex<String>,
    /// The currently registered OCR trigger shortcut string (None = no shortcut)
    ocr_shortcut: Mutex<Option<String>>,
}

// ── Shortcut helpers ─────────────────────────────────────────────────────────

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

fn register_ocr_shortcut(app: &tauri::AppHandle, shortcut: &str) -> Result<(), String> {
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _sc, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            // Show & focus the main window first, then tell it to start OCR
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
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

/// Called from JS after getDisplayMedia captures the screen.
/// Stores the full data-URL so the overlay can fetch it when it mounts.
#[tauri::command]
fn set_screen_capture(
    state: tauri::State<'_, AppState>,
    data: String,
) -> Result<(), String> {
    *state
        .screen_capture
        .lock()
        .map_err(|e| e.to_string())? = Some(data);
    Ok(())
}

/// Returns the stored screen-capture data-URL and clears it.
/// Called by the OCR overlay on mount.
#[tauri::command]
fn get_screen_capture(state: tauri::State<'_, AppState>) -> Option<String> {
    state
        .screen_capture
        .lock()
        .ok()
        .and_then(|mut g| g.take())
}

/// Sizes and shows the full-screen OCR overlay window.
/// The screenshot must already be stored via set_screen_capture before calling this.
#[tauri::command]
fn show_ocr_overlay(app: tauri::AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window("ocr-overlay")
        .ok_or_else(|| "ocr-overlay window not found".to_string())?;

    let (lw, lh) = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let sf = m.scale_factor();
            (m.size().width as f64 / sf, m.size().height as f64 / sf)
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

    let _ = app.global_shortcut().unregister(current.as_str());
    register_send_shortcut(&app, &new_shortcut)?;
    *current = new_shortcut;
    Ok(())
}

/// Replace (or clear) the OCR trigger global shortcut at runtime.
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

    if let Some(ref sc) = *current {
        let _ = app.global_shortcut().unregister(sc.as_str());
    }

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
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            register_send_shortcut(app.handle(), DEFAULT_SEND_SHORTCUT)
                .map_err(|e| Box::<dyn std::error::Error>::from(e))?;

            let quit =
                MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show = MenuItem::with_id(
                app, "show", "Open ClipBridge", true, None::<&str>,
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
            set_screen_capture,
            get_screen_capture,
            show_ocr_overlay,
            close_ocr_overlay,
            update_send_shortcut,
            update_ocr_shortcut,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
