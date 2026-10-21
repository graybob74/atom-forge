//! Atom Forge desktop shell: a window around the single-page app, served by Tauri with the cross-origin isolation
//! headers (see tauri.conf.json → app.security.headers), so the page gets SharedArrayBuffer and runs its force kernels
//! on all the processor's threads (src/threads.js).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // the window comes back where it was left: size, position, monitor, maximized or full screen (Settings → Display)
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running Atom Forge");
}
