//! Atom Forge desktop shell: a window around the single-page app, served by Tauri with the cross-origin isolation
//! headers (see tauri.conf.json → app.security.headers), so the page gets SharedArrayBuffer and runs its force kernels
//! on all the processor's threads (src/threads.js).
//!
//! The watchdog (1.23.1). The page sends a heartbeat (the `heartbeat` command) once a second from its frame loop. A page
//! stuck in a frame cannot show anything itself, so if no heartbeat comes for 8 s while the window is in front (visible,
//! not minimised, focused), a native dialog asks: wait, reload, or quit. The clock is held while the window is hidden,
//! minimised or behind another (the page's frames stop or slow there), before the first heartbeat (start-up), and across
//! any gap in the watchdog's own ticks (the computer asleep). Nothing is ever ended without the player's answer.
//! Reload ends the page's stuck renderer process (Windows: the WebView2 processes started for this app with
//! `--type=renderer`) and loads the page again; on its next start the page finds the mark it left inside the frame that
//! never ended (ui.js, crashMidFrame) and offers the report and the autosave. If the page still sends nothing 15 s later,
//! the app restarts.
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};
use tauri::Manager;

/// How long without a heartbeat, the window in front, before asking.
const STALL: Duration = Duration::from_secs(8);

struct Watch {
    last: Instant,     // the last heartbeat, or when watching (re)started
    armed: bool,       // a first heartbeat has come (the page is up)
    reloaded: Option<Instant>, // a reload was asked for: when
}
#[derive(Clone)]
struct Beat(Arc<Mutex<Watch>>);

#[tauri::command]
fn heartbeat(beat: tauri::State<'_, Beat>) {
    if let Ok(mut w) = beat.0.lock() {
        w.last = Instant::now();
        w.armed = true;
        w.reloaded = None;
    }
}

/// "Read more" in an element's or particle's info (1.28.1): its Wikipedia article in the player's browser. Only an
/// English Wikipedia article address is opened (letters, digits and a few marks after /wiki/), nothing else.
#[tauri::command]
fn open_wiki(url: String) -> bool {
    const BASE: &str = "https://en.wikipedia.org/wiki/";
    let ok = url.len() < 200 && url.starts_with(BASE) && url[BASE.len()..].chars().all(|c| c.is_ascii_alphanumeric() || "_()-.,%'".contains(c));
    if !ok { return false; }
    open_in_browser(&url)
}
#[cfg(windows)]
fn open_in_browser(url: &str) -> bool {
    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(hwnd: *mut core::ffi::c_void, op: *const u16, file: *const u16, params: *const u16, dir: *const u16, show: i32) -> isize;
    }
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let (op, file) = (wide("open"), wide(url));
    // SW_SHOWNORMAL 1; a result above 32 is success
    unsafe { ShellExecuteW(core::ptr::null_mut(), op.as_ptr(), file.as_ptr(), core::ptr::null(), core::ptr::null(), 1) > 32 }
}
#[cfg(not(windows))]
fn open_in_browser(url: &str) -> bool {
    std::process::Command::new(if cfg!(target_os = "macos") { "open" } else { "xdg-open" }).arg(url).spawn().is_ok()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let beat = Beat(Arc::new(Mutex::new(Watch { last: Instant::now(), armed: false, reloaded: None })));
    let for_thread = beat.clone();
    tauri::Builder::default()
        // the window comes back where it was left: size, position, monitor, maximized or full screen (Settings → Display)
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(beat)
        .invoke_handler(tauri::generate_handler![heartbeat, open_wiki])
        .setup(move |app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || watchdog(handle, for_thread));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Atom Forge");
}

/// Is the window where the player sees it: visible, not minimised, in front? (Any error counts as no.)
fn in_front(win: &tauri::WebviewWindow) -> bool {
    win.is_visible().unwrap_or(false) && !win.is_minimized().unwrap_or(true) && win.is_focused().unwrap_or(false)
}

fn watchdog(app: tauri::AppHandle, beat: Beat) {
    let tick = Duration::from_secs(1);
    let (mut mono, mut wall) = (Instant::now(), SystemTime::now());
    loop {
        std::thread::sleep(tick);
        let (now, now_wall) = (Instant::now(), SystemTime::now());
        // a tick far later than asked (the computer slept, or this process was stopped): start the clock again
        let gap = now.duration_since(mono).max(now_wall.duration_since(wall).unwrap_or(Duration::ZERO));
        mono = now;
        wall = now_wall;
        let Some(win) = app.get_webview_window("main") else { continue };
        let front = in_front(&win);
        let (stalled, after_reload) = {
            let Ok(mut w) = beat.0.lock() else { return };
            if gap > Duration::from_secs(3) || !front {
                w.last = now; // (held: hidden, minimised, behind another window, or just woken)
            }
            let after_reload = front && w.reloaded.map_or(false, |t| now.duration_since(t) > Duration::from_secs(15));
            (w.armed && now.duration_since(w.last) > STALL, after_reload)
        };
        if after_reload {
            // the reload brought no heartbeat: start the app again (the page's mark is still in its storage)
            app.restart();
        }
        if !stalled {
            continue;
        }
        let secs = beat.0.lock().map(|w| now.duration_since(w.last).as_secs()).unwrap_or(0);
        match ask(secs) {
            Answer::Wait => {
                if let Ok(mut w) = beat.0.lock() {
                    w.last = Instant::now() + Duration::from_secs(12); // (asked again only after 20 s more)
                }
            }
            Answer::Reload => {
                if let Ok(mut w) = beat.0.lock() {
                    w.last = Instant::now();
                    w.reloaded = Some(Instant::now());
                }
                end_renderers();
                std::thread::sleep(Duration::from_millis(500));
                if let Ok(url) = win.url() {
                    let _ = win.navigate(url);
                }
            }
            Answer::Quit => {
                app.exit(0);
                std::thread::sleep(Duration::from_secs(3));
                std::process::exit(0); // (if the event loop did not end by itself)
            }
        }
    }
}

enum Answer {
    Wait,
    Reload,
    Quit,
}

const ASK_TEXT: &str = "Atom Forge has stopped responding: the simulation has not finished a frame for {s} seconds.\n\n\
Retry: reload the game. When it starts again it offers the last autosave and a report of what was running.\n\
Ignore: keep waiting (a very heavy step may still finish).\n\
Abort: quit Atom Forge.";

/// The native question (Windows: a message box from user32; its buttons are Abort, Retry and Ignore, which the text
/// explains). Elsewhere the shell is not built; it waits.
#[cfg(windows)]
fn ask(secs: u64) -> Answer {
    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(hwnd: *mut core::ffi::c_void, text: *const u16, caption: *const u16, utype: u32) -> i32;
    }
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let text = wide(&ASK_TEXT.replace("{s}", &secs.to_string()));
    let caption = wide("Atom Forge stopped responding");
    // MB_ABORTRETRYIGNORE 0x2 | MB_ICONWARNING 0x30 | MB_DEFBUTTON3 0x200 (Enter waits) | MB_SETFOREGROUND 0x10000 | MB_TOPMOST 0x40000
    let r = unsafe { MessageBoxW(core::ptr::null_mut(), text.as_ptr(), caption.as_ptr(), 0x2 | 0x30 | 0x200 | 0x10000 | 0x40000) };
    match r {
        3 => Answer::Quit,   // IDABORT
        4 => Answer::Reload, // IDRETRY
        _ => Answer::Wait,   // IDIGNORE, or the box could not be shown
    }
}
#[cfg(not(windows))]
fn ask(secs: u64) -> Answer {
    eprintln!("{}", ASK_TEXT.replace("{s}", &secs.to_string()));
    Answer::Wait
}

/// End this app's WebView2 renderer processes: a page stuck in a script loop holds its renderer, which a reload alone
/// cannot replace (the new page would be sent to the same busy process). The renderers are found among this process's
/// descendants (the WebView2 browser process is its child, the renderers that one's) by their command line,
/// `--type=renderer`; the browser, GPU and network processes are left alone, and WebView2 starts a fresh renderer for
/// the page that loads next. Only Win32 calls whose signatures have not changed since Windows 8.1.
#[cfg(windows)]
fn end_renderers() {
    use core::ffi::c_void;
    #[repr(C)]
    struct ProcessEntry32W {
        dw_size: u32,
        cnt_usage: u32,
        th32_process_id: u32,
        th32_default_heap_id: usize,
        th32_module_id: u32,
        cnt_threads: u32,
        th32_parent_process_id: u32,
        pc_pri_class_base: i32,
        dw_flags: u32,
        sz_exe_file: [u16; 260],
    }
    #[repr(C)]
    struct UnicodeString {
        length: u16,
        maximum_length: u16,
        buffer: *const u16,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> *mut c_void;
        fn Process32FirstW(snap: *mut c_void, entry: *mut ProcessEntry32W) -> i32;
        fn Process32NextW(snap: *mut c_void, entry: *mut ProcessEntry32W) -> i32;
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut c_void;
        fn TerminateProcess(process: *mut c_void, code: u32) -> i32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }
    #[link(name = "ntdll")]
    extern "system" {
        fn NtQueryInformationProcess(process: *mut c_void, class: u32, info: *mut c_void, len: u32, ret: *mut u32) -> i32;
    }
    const TH32CS_SNAPPROCESS: u32 = 0x2;
    const PROCESS_TERMINATE: u32 = 0x1;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const PROCESS_COMMAND_LINE_INFORMATION: u32 = 60; // (Windows 8.1 and later)
    let invalid = usize::MAX as *mut c_void; // INVALID_HANDLE_VALUE
    // every process: (pid, parent)
    let mut all: Vec<(u32, u32)> = Vec::new();
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap.is_null() || snap == invalid {
            return;
        }
        let mut e: ProcessEntry32W = core::mem::zeroed();
        e.dw_size = core::mem::size_of::<ProcessEntry32W>() as u32;
        if Process32FirstW(snap, &mut e) != 0 {
            loop {
                all.push((e.th32_process_id, e.th32_parent_process_id));
                if Process32NextW(snap, &mut e) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snap);
    }
    // this process's descendants (a pid reused by an unrelated process cannot be reached: it would need our pid as parent)
    let me = std::process::id();
    let mut ours: Vec<u32> = vec![me];
    let mut k = 0;
    while k < ours.len() && ours.len() < 256 {
        let p = ours[k];
        for &(c, par) in &all {
            if par == p && c != p && c != 0 && !ours.contains(&c) {
                ours.push(c);
            }
        }
        k += 1;
    }
    for &pid in ours.iter().skip(1) {
        unsafe {
            let h = OpenProcess(PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                continue;
            }
            let mut buf = vec![0u8; 65536];
            let mut ret = 0u32;
            let ok = NtQueryInformationProcess(h, PROCESS_COMMAND_LINE_INFORMATION, buf.as_mut_ptr() as *mut c_void, buf.len() as u32, &mut ret) >= 0;
            if ok {
                let us = &*(buf.as_ptr() as *const UnicodeString);
                if !us.buffer.is_null() && us.length > 0 {
                    let cmd = String::from_utf16_lossy(core::slice::from_raw_parts(us.buffer, (us.length / 2) as usize));
                    if cmd.contains("msedgewebview2") && cmd.contains("--type=renderer") {
                        TerminateProcess(h, 1);
                    }
                }
            }
            CloseHandle(h);
        }
    }
}
#[cfg(not(windows))]
fn end_renderers() {}
