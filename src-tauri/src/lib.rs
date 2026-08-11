use std::net::TcpStream;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

// State holder for the Node.js sidecar process so we can kill it on shutdown
struct ServerProcess(Mutex<Option<CommandChild>>);

// [Rule 5] HTTP/TCP probe — wait until server is actually listening
fn wait_for_port(port: u16, max_attempts: u32) -> bool {
    let addr = format!("127.0.0.1:{}", port);
    for attempt in 0..max_attempts {
        if let Ok(sock_addr) = addr.parse() {
            if TcpStream::connect_timeout(&sock_addr, Duration::from_millis(200)).is_ok() {
                println!("[startup] server ready after {} attempts", attempt + 1);
                return true;
            }
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    eprintln!("[startup] server did NOT come up after {} attempts", max_attempts);
    false
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ServerProcess(Mutex::new(None)))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // [Rule 4] Spawn server sidecar
            let sidecar = app
                .shell()
                .sidecar("server")
                .expect("failed to create sidecar command");

            let (mut rx, child) = sidecar.spawn().expect("failed to spawn sidecar server");

            // Save handle so the window-close hook can kill it
            let state: tauri::State<ServerProcess> = app.state();
            *state.0.lock().unwrap() = Some(child);

            // Forward stdout/stderr to terminal (helps debugging)
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            print!("[server] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            eprint!("[server-err] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Terminated(payload) => {
                            eprintln!("[server] terminated, code={:?}", payload.code);
                            break;
                        }
                        _ => {}
                    }
                }
            });

            // [Rule 5] Wait for server to be ready (max ~9 sec)
            if !wait_for_port(3000, 60) {
                eprintln!("[startup] WARNING: server did not respond — UI may show errors");
            }

            Ok(())
        })
        // [Rule 4] Kill sidecar when main window is closed
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let app_handle = window.app_handle();
                let state: tauri::State<ServerProcess> = app_handle.state();
                let child_opt = {
                    let mut guard = state.0.lock().unwrap();
                    guard.take()
                };
                if let Some(child) = child_opt {
                    println!("[shutdown] killing server sidecar...");
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
