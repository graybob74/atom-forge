//! Atom Forge desktop shell: a window around the single-page app, served by Tauri with the cross-origin isolation
//! headers (see tauri.conf.json → app.security.headers), so the page gets SharedArrayBuffer and runs its force kernels
//! on all the processor's threads (src/threads.js).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Atom Forge");
}
