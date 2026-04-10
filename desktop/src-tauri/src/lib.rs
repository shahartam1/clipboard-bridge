use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

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

    // Use the monitor the main window is on; fall back to primary monitor
    let screen_w = app
        .get_webview_window("main")
        .and_then(|w| w.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
        .map(|m| m.size().width as f64 / m.scale_factor())
        .unwrap_or(1920.0);

    // Top-right corner — window is 360×250 (from config); card auto-sizes
    // inside it and transparent background hides the unused space below.
    let x = screen_w - 360.0 - 16.0;
    let y = 25.0;

    // ── Inject data synchronously via eval so it is available even if the
    //    Tauri event listener in React hasn't registered yet ─────────────────
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

    // Also emit a Tauri event as a belt-and-suspenders fallback
    win.emit("clip-notification", payload).map_err(|e| e.to_string())?;

    // Show, then reposition — never resize; the 360×250 config size is fixed
    // and the card auto-sizes within the transparent window.
    win.show().map_err(|e| e.to_string())?;
    win.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)))
        .map_err(|e| e.to_string())?;

    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        // Read whatever is currently on the system clipboard
                        let text = app.clipboard().read_text().unwrap_or_default();
                        let text = text.trim().to_string();
                        if text.is_empty() {
                            return;
                        }
                        // Bring window to front
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                        // Tell the frontend to open the Quick Send picker
                        let _ = app.emit("quick-send-triggered", text);
                    }
                })
                .build(),
        )
        .setup(|app| {
            // Register Cmd+Shift+C (Mac) / Ctrl+Shift+C (Windows/Linux)
            app.global_shortcut()
                .register("CommandOrControl+Shift+C")?;

            // Build system tray
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Open ClipBridge", true, None::<&str>)?;
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
        .invoke_handler(tauri::generate_handler![get_platform, show_clip_notification])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
