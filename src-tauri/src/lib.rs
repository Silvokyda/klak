use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};
use wait_timeout::ChildExt;

use std::collections::HashMap;
use std::fs;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
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
const COMMAND_OUTPUT_LIMIT: usize = 8_000;
const BACKGROUND_OUTPUT_LIMIT: usize = 12_000;

static BACKGROUND_CHILDREN: OnceLock<Mutex<HashMap<String, Child>>> = OnceLock::new();

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

#[derive(serde::Deserialize)]
struct RunCommandTemplateInput {
    command_template_id: String,
    command: String,
    working_directory: String,
    timeout_seconds: u64,
}

#[derive(serde::Deserialize)]
struct StartBackgroundProcessInput {
    process_id: String,
    command_template_id: String,
    command: String,
    working_directory: String,
    output_log_path: Option<String>,
    max_runtime_seconds: Option<u64>,
}

#[derive(serde::Deserialize)]
struct StopBackgroundProcessInput {
    process_id: String,
    force: Option<bool>,
}

#[derive(serde::Deserialize)]
struct BackgroundProcessIdInput {
    process_id: String,
}

#[derive(serde::Serialize)]
struct BackgroundProcessStartOutput {
    process_id: String,
    pid: u32,
    status: String,
    output_log_path: String,
}

#[derive(serde::Serialize)]
struct BackgroundProcessStatusOutput {
    process_id: String,
    running: bool,
    status: String,
    pid: Option<u32>,
    exit_code: Option<i32>,
    uptime_ms: Option<u128>,
}

#[derive(serde::Serialize)]
struct BackgroundProcessOutput {
    output: String,
    warning: Option<String>,
}

#[derive(serde::Serialize)]
struct CommandRunOutput {
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    duration_ms: u128,
    timed_out: bool,
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
fn run_command_template(input: RunCommandTemplateInput) -> Result<CommandRunOutput, String> {
    if input.command_template_id.trim().is_empty() {
        return Err("Command template id is required.".into());
    }
    let working_directory = PathBuf::from(input.working_directory.trim());
    if !working_directory.is_dir() {
        return Err("Command working directory does not exist or is not a directory.".into());
    }

    let parts = split_command(&input.command)?;
    if parts.is_empty() {
        return Err("Command is empty.".into());
    }
    let program = resolve_program(&parts[0]);
    let args = &parts[1..];
    let started = Instant::now();
    let mut child = Command::new(program)
        .args(args)
        .current_dir(&working_directory)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Unable to start command template: {error}"))?;

    let timeout = Duration::from_secs(input.timeout_seconds.clamp(5, 600));
    let (timed_out, status_code) = match child
        .wait_timeout(timeout)
        .map_err(|error| error.to_string())?
    {
        Some(status) => (false, status.code()),
        None => {
            let _ = child.kill();
            let _ = child.wait();
            (true, None)
        }
    };

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    if let Some(mut pipe) = child.stdout.take() {
        pipe.read_to_end(&mut stdout)
            .map_err(|error| format!("Unable to read command stdout: {error}"))?;
    }
    if let Some(mut pipe) = child.stderr.take() {
        pipe.read_to_end(&mut stderr)
            .map_err(|error| format!("Unable to read command stderr: {error}"))?;
    }
    Ok(CommandRunOutput {
        exit_code: status_code,
        stdout: truncate_for_command_output(&String::from_utf8_lossy(&stdout)),
        stderr: truncate_for_command_output(&String::from_utf8_lossy(&stderr)),
        duration_ms: started.elapsed().as_millis(),
        timed_out,
    })
}

#[tauri::command]
fn start_background_process(
    input: StartBackgroundProcessInput,
) -> Result<BackgroundProcessStartOutput, String> {
    if input.process_id.trim().is_empty() || input.command_template_id.trim().is_empty() {
        return Err("Background process id and command template id are required.".into());
    }
    let working_directory = PathBuf::from(input.working_directory.trim());
    if !working_directory.is_dir() {
        return Err(
            "Background process working directory does not exist or is not a directory.".into(),
        );
    }
    let parts = split_command(&input.command)?;
    if parts.is_empty() {
        return Err("Command is empty.".into());
    }

    let program = resolve_program(&parts[0]);
    let args = &parts[1..];
    let output_log_path = resolve_background_log_path(
        input
            .output_log_path
            .as_deref()
            .unwrap_or(input.process_id.as_str()),
    )?;
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&output_log_path)
        .map_err(|error| format!("Unable to open background output log: {error}"))?;
    let log = Arc::new(Mutex::new(file));

    let mut child = Command::new(program)
        .args(args)
        .current_dir(&working_directory)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Unable to start background process: {error}"))?;
    let pid = child.id();
    if let Some(stdout) = child.stdout.take() {
        pipe_to_log(stdout, Arc::clone(&log));
    }
    if let Some(stderr) = child.stderr.take() {
        pipe_to_log(stderr, Arc::clone(&log));
    }
    if let Some(max_runtime_seconds) = input.max_runtime_seconds {
        let process_id = input.process_id.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_secs(max_runtime_seconds.clamp(5, 86_400)));
            if let Some(children) = BACKGROUND_CHILDREN.get() {
                if let Ok(mut map) = children.lock() {
                    if let Some(child) = map.get_mut(&process_id) {
                        if matches!(child.try_wait(), Ok(None)) {
                            let _ = child.kill();
                        }
                    }
                }
            }
        });
    }

    background_children()
        .lock()
        .map_err(|_| "Background process registry is unavailable.".to_string())?
        .insert(input.process_id.clone(), child);

    Ok(BackgroundProcessStartOutput {
        process_id: input.process_id,
        pid,
        status: "running".into(),
        output_log_path: output_log_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn stop_background_process(
    input: StopBackgroundProcessInput,
) -> Result<BackgroundProcessStatusOutput, String> {
    let mut children = background_children()
        .lock()
        .map_err(|_| "Background process registry is unavailable.".to_string())?;
    let Some(child) = children.get_mut(&input.process_id) else {
        return Ok(BackgroundProcessStatusOutput {
            process_id: input.process_id,
            running: false,
            status: "stopped".into(),
            pid: None,
            exit_code: None,
            uptime_ms: None,
        });
    };
    if matches!(child.try_wait(), Ok(None)) {
        let _ = child.kill();
        let _ = child.wait();
    }
    let exit_code = child
        .try_wait()
        .ok()
        .flatten()
        .and_then(|status| status.code());
    let pid = child.id();
    children.remove(&input.process_id);
    Ok(BackgroundProcessStatusOutput {
        process_id: input.process_id,
        running: false,
        status: if input.force.unwrap_or(false) {
            "killed"
        } else {
            "stopped"
        }
        .into(),
        pid: Some(pid),
        exit_code,
        uptime_ms: None,
    })
}

#[tauri::command]
fn get_background_process_status(
    input: BackgroundProcessIdInput,
) -> Result<BackgroundProcessStatusOutput, String> {
    let mut children = background_children()
        .lock()
        .map_err(|_| "Background process registry is unavailable.".to_string())?;
    let Some(child) = children.get_mut(&input.process_id) else {
        return Ok(BackgroundProcessStatusOutput {
            process_id: input.process_id,
            running: false,
            status: "stopped".into(),
            pid: None,
            exit_code: None,
            uptime_ms: None,
        });
    };
    let pid = child.id();
    match child.try_wait().map_err(|error| error.to_string())? {
        Some(status) => {
            let exit_code = status.code();
            children.remove(&input.process_id);
            Ok(BackgroundProcessStatusOutput {
                process_id: input.process_id,
                running: false,
                status: "exited".into(),
                pid: Some(pid),
                exit_code,
                uptime_ms: None,
            })
        }
        None => Ok(BackgroundProcessStatusOutput {
            process_id: input.process_id,
            running: true,
            status: "running".into(),
            pid: Some(pid),
            exit_code: None,
            uptime_ms: None,
        }),
    }
}

#[tauri::command]
fn read_background_process_output(
    output_log_path: String,
) -> Result<BackgroundProcessOutput, String> {
    let path = PathBuf::from(output_log_path);
    if !path.is_file() {
        return Ok(BackgroundProcessOutput {
            output: "".into(),
            warning: None,
        });
    }
    let mut output = fs::read_to_string(&path)
        .map_err(|error| format!("Unable to read background process output: {error}"))?;
    if output.len() > BACKGROUND_OUTPUT_LIMIT {
        output = output[output.len() - BACKGROUND_OUTPUT_LIMIT..].to_string();
    }
    let warning = if looks_sensitive_output(&output) {
        Some("Output may contain sensitive-looking text. Review before sharing.".into())
    } else {
        None
    };
    Ok(BackgroundProcessOutput { output, warning })
}

fn resolve_program(program: &str) -> String {
    if cfg!(windows) {
        match program.to_lowercase().as_str() {
            "npm" => "npm.cmd".into(),
            "npx" => "npx.cmd".into(),
            "cargo" => "cargo.exe".into(),
            "git" => "git.exe".into(),
            "node" => "node.exe".into(),
            "flutter" => "flutter.bat".into(),
            "php" => "php.exe".into(),
            "python" => "python.exe".into(),
            "py" => "py.exe".into(),
            _ => program.into(),
        }
    } else {
        program.into()
    }
}

fn background_children() -> &'static Mutex<HashMap<String, Child>> {
    BACKGROUND_CHILDREN.get_or_init(|| Mutex::new(HashMap::new()))
}

fn resolve_background_log_path(value: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(value);
    if candidate.is_absolute() {
        if let Some(parent) = candidate.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        return Ok(candidate);
    }
    let mut dir = std::env::temp_dir();
    dir.push("klak");
    dir.push("process-logs");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    dir.push(format!("{}.log", value.replace(['\\', '/', ':'], "-")));
    Ok(dir)
}

fn pipe_to_log<R: Read + Send + 'static>(mut reader: R, log: Arc<Mutex<File>>) {
    thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    if let Ok(mut file) = log.lock() {
                        let _ = file.write_all(&buffer[..size]);
                        let _ = file.flush();
                    }
                }
                Err(_) => break,
            }
        }
    });
}

fn looks_sensitive_output(value: &str) -> bool {
    let lower = value.to_lowercase();
    [
        "api_key",
        "apikey",
        "password",
        "secret",
        "token",
        "private key",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn split_command(command: &str) -> Result<Vec<String>, String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    for ch in command.trim().chars() {
        match ch {
            '"' => in_quotes = !in_quotes,
            ' ' | '\t' if !in_quotes => {
                if !current.is_empty() {
                    parts.push(current.clone());
                    current.clear();
                }
            }
            _ => current.push(ch),
        }
    }
    if in_quotes {
        return Err("Command contains an unmatched quote.".into());
    }
    if !current.is_empty() {
        parts.push(current);
    }
    Ok(parts)
}

fn truncate_for_command_output(value: &str) -> String {
    if value.len() > COMMAND_OUTPUT_LIMIT {
        format!("{}...", &value[..COMMAND_OUTPUT_LIMIT])
    } else {
        value.to_string()
    }
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
            run_command_template,
            start_background_process,
            stop_background_process,
            get_background_process_status,
            read_background_process_output,
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
