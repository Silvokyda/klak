use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};
use wait_timeout::ChildExt;

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const KLAK_DB: &str = "sqlite:klak.db";

const INITIAL_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT,
  confidence REAL DEFAULT 1,
  importance INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS action_logs (
  id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  input_summary TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  status TEXT NOT NULL,
  user_approved INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_settings (
  tool_name TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS allowed_folders (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL
);
"#;

const SECRET_SERVICE: &str = "Klak";
const WHISPER_TIMEOUT_SECONDS: u64 = 120;

#[derive(serde::Deserialize)]
struct SaveTempAudioInput {
    bytes: Vec<u8>,
    extension: Option<String>,
}

#[derive(serde::Serialize)]
struct SaveTempAudioOutput {
    audio_path: String,
}

#[derive(serde::Deserialize)]
struct WhisperInput {
    audio_path: String,
    executable_path: String,
    model_path: String,
    language: String,
    threads: u8,
    keep_temp_audio_for_debugging: bool,
}

#[derive(serde::Deserialize)]
struct LaunchRegisteredAppInput {
    executable_path: String,
}

#[derive(serde::Deserialize)]
struct ValidateRegisteredAppPathInput {
    executable_path: String,
}

#[derive(serde::Serialize)]
struct RegisteredAppPathCheck {
    exists: bool,
    valid_extension: bool,
    blocked_shell: bool,
    message: String,
}

#[derive(serde::Serialize)]
struct WhisperOutput {
    transcript: String,
    duration_ms: u128,
    warning: Option<String>,
}

#[derive(serde::Serialize)]
struct WhisperSetupCheck {
    ok: bool,
    message: String,
    warning: Option<String>,
}

#[tauri::command]
fn save_secret(key: String, value: String) -> Result<(), String> {
    keyring::Entry::new(SECRET_SERVICE, &key)
        .map_err(|error| error.to_string())?
        .set_password(&value)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_secret(key: String) -> Result<Option<String>, String> {
    match keyring::Entry::new(SECRET_SERVICE, &key)
        .map_err(|error| error.to_string())?
        .get_password()
    {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn delete_secret(key: String) -> Result<(), String> {
    match keyring::Entry::new(SECRET_SERVICE, &key)
        .map_err(|error| error.to_string())?
        .delete_credential()
    {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn has_secret(key: String) -> Result<bool, String> {
    get_secret(key).map(|value| value.is_some())
}

#[tauri::command]
fn create_markdown_note(path: String, content: String) -> Result<(), String> {
    let note_path = std::path::PathBuf::from(path);
    if note_path.exists() {
        return Err("A note already exists at that path.".into());
    }
    if let Some(parent) = note_path.parent() {
        if !parent.exists() {
            return Err("The destination folder does not exist.".into());
        }
    }
    std::fs::write(note_path, content).map_err(|error| error.to_string())
}

#[tauri::command]
fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
    clipboard.set_text(text).map_err(|error| error.to_string())
}

#[tauri::command]
fn launch_registered_app(input: LaunchRegisteredAppInput) -> Result<(), String> {
    let executable = PathBuf::from(input.executable_path.trim());
    if !executable.is_file() {
        return Err("Registered app executable does not exist.".into());
    }
    if executable
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| !extension.eq_ignore_ascii_case("exe"))
        .unwrap_or(true)
    {
        return Err("Registered apps must point to a .exe file.".into());
    }
    let file_name = executable
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_lowercase();
    let blocked = [
        "powershell.exe",
        "cmd.exe",
        "wt.exe",
        "windowsterminal.exe",
        "bash.exe",
        "wsl.exe",
    ];
    if blocked.iter().any(|name| *name == file_name) {
        return Err("Shell and terminal apps are blocked in this pass.".into());
    }

    Command::new(&executable)
        .spawn()
        .map_err(|error| format!("Unable to launch registered app: {error}"))?;
    Ok(())
}

#[tauri::command]
fn validate_registered_app_path(
    input: ValidateRegisteredAppPathInput,
) -> Result<RegisteredAppPathCheck, String> {
    let executable = PathBuf::from(input.executable_path.trim());
    let exists = executable.is_file();
    let valid_extension = executable
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("exe"))
        .unwrap_or(false);
    let file_name = executable
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_lowercase();
    let blocked = [
        "powershell.exe",
        "cmd.exe",
        "wt.exe",
        "windowsterminal.exe",
        "bash.exe",
        "wsl.exe",
    ];
    let blocked_shell = blocked.iter().any(|name| *name == file_name);
    let message = if blocked_shell {
        "Shell and terminal apps are blocked in this pass."
    } else if !valid_extension {
        "Registered apps must point to a .exe file."
    } else if !exists {
        "Executable file was not found."
    } else {
        "Registered app path is launchable."
    };

    Ok(RegisteredAppPathCheck {
        exists,
        valid_extension,
        blocked_shell,
        message: message.into(),
    })
}

#[tauri::command]
fn save_temp_voice_audio(input: SaveTempAudioInput) -> Result<SaveTempAudioOutput, String> {
    if input.bytes.is_empty() {
        return Err("No audio data was recorded.".into());
    }
    let extension = sanitize_audio_extension(input.extension.as_deref().unwrap_or("webm"))?;
    let mut dir = std::env::temp_dir();
    dir.push("klak");
    dir.push("voice");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;

    let file_name = format!(
        "klak-voice-{}-{}.{}",
        std::process::id(),
        chrono_like_timestamp(),
        extension
    );
    let path = dir.join(file_name);
    fs::write(&path, input.bytes).map_err(|error| error.to_string())?;
    Ok(SaveTempAudioOutput {
        audio_path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn validate_whisper_setup(
    executable_path: String,
    model_path: String,
) -> Result<WhisperSetupCheck, String> {
    match validate_whisper_paths(&executable_path, &model_path) {
        Ok(warning) => Ok(WhisperSetupCheck {
            ok: true,
            message: "Local Whisper setup looks usable.".into(),
            warning,
        }),
        Err(error) => Ok(WhisperSetupCheck {
            ok: false,
            message: error,
            warning: None,
        }),
    }
}

#[tauri::command]
fn transcribe_audio_with_whisper(input: WhisperInput) -> Result<WhisperOutput, String> {
    let started = Instant::now();
    let warning = validate_whisper_paths(&input.executable_path, &input.model_path)?;
    let audio_path = PathBuf::from(&input.audio_path);
    if !audio_path.is_file() {
        return Err("Recorded audio file was not found.".into());
    }

    let output_base = audio_path.with_extension("klak-transcript");
    let mut args = vec![
        "-m".to_string(),
        input.model_path.clone(),
        "-f".to_string(),
        input.audio_path.clone(),
        "-otxt".to_string(),
        "-of".to_string(),
        output_base.to_string_lossy().to_string(),
        "-t".to_string(),
        input.threads.clamp(1, 16).to_string(),
    ];
    if input.language.trim() != "auto" && !input.language.trim().is_empty() {
        args.push("-l".into());
        args.push(input.language.trim().to_string());
    }

    let mut child = Command::new(&input.executable_path)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Unable to start local Whisper executable: {error}"))?;

    let status = match child
        .wait_timeout(Duration::from_secs(WHISPER_TIMEOUT_SECONDS))
        .map_err(|error| error.to_string())?
    {
        Some(status) => status,
        None => {
            let _ = child.kill();
            let _ = cleanup_whisper_files(
                &audio_path,
                &output_base,
                input.keep_temp_audio_for_debugging,
            );
            return Err("Local Whisper timed out before transcription completed.".into());
        }
    };

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    if let Some(mut pipe) = child.stdout.take() {
        pipe.read_to_end(&mut stdout)
            .map_err(|error| format!("Unable to read local Whisper stdout: {error}"))?;
    }
    if let Some(mut pipe) = child.stderr.take() {
        pipe.read_to_end(&mut stderr)
            .map_err(|error| format!("Unable to read local Whisper stderr: {error}"))?;
    }
    let transcript_file = output_base.with_extension("txt");
    let transcript = if transcript_file.exists() {
        fs::read_to_string(&transcript_file)
            .map_err(|error| format!("Unable to read Whisper transcript file: {error}"))?
    } else {
        String::from_utf8_lossy(&stdout).trim().to_string()
    };

    let stderr = String::from_utf8_lossy(&stderr).trim().to_string();
    let _ = cleanup_whisper_files(
        &audio_path,
        &output_base,
        input.keep_temp_audio_for_debugging,
    );

    if !status.success() {
        return Err(if stderr.is_empty() {
            "Local Whisper failed without a detailed error.".into()
        } else {
            format!("Local Whisper failed: {}", truncate_for_ui(&stderr))
        });
    }
    if transcript.trim().is_empty() {
        return Err("Local Whisper completed but did not produce transcript text.".into());
    }

    Ok(WhisperOutput {
        transcript: transcript.trim().to_string(),
        duration_ms: started.elapsed().as_millis(),
        warning,
    })
}

fn validate_whisper_paths(
    executable_path: &str,
    model_path: &str,
) -> Result<Option<String>, String> {
    let executable = Path::new(executable_path);
    if !executable.is_file() {
        return Err("Local Whisper executable path does not exist or is not a file.".into());
    }
    let model = Path::new(model_path);
    if !model.is_file() {
        return Err("Local Whisper model path does not exist or is not a file.".into());
    }

    let file_name = executable
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_lowercase();
    let expected = [
        "whisper-cli.exe",
        "main.exe",
        "whisper.cpp.exe",
        "faster-whisper.exe",
    ];
    if expected.iter().any(|name| *name == file_name) {
        Ok(None)
    } else {
        Ok(Some(
            "The executable name is unusual for Whisper. Klak will still use it with controlled arguments."
                .into(),
        ))
    }
}

fn sanitize_audio_extension(extension: &str) -> Result<String, String> {
    let cleaned = extension.trim().trim_start_matches('.').to_lowercase();
    match cleaned.as_str() {
        "webm" | "wav" | "mp3" | "m4a" | "ogg" => Ok(cleaned),
        "" => Ok("webm".into()),
        _ => Err("Unsupported recorded audio extension.".into()),
    }
}

fn cleanup_whisper_files(
    audio_path: &Path,
    output_base: &Path,
    keep_debug: bool,
) -> Result<(), String> {
    if keep_debug {
        return Ok(());
    }
    for path in [audio_path.to_path_buf(), output_base.with_extension("txt")] {
        if path.exists() {
            fs::remove_file(path).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn chrono_like_timestamp() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn truncate_for_ui(value: &str) -> String {
    const MAX: usize = 800;
    if value.len() > MAX {
        format!("{}...", &value[..MAX])
    } else {
        value.to_string()
    }
}

pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "create_initial_klak_tables",
        sql: INITIAL_SCHEMA,
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(KLAK_DB, migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            save_secret,
            get_secret,
            delete_secret,
            has_secret,
            create_markdown_note,
            copy_text_to_clipboard,
            launch_registered_app,
            validate_registered_app_path,
            save_temp_voice_audio,
            validate_whisper_setup,
            transcribe_audio_with_whisper
        ])
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Show Klak", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Klak");
}
