use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_sql::{Migration, MigrationKind};
use wait_timeout::ChildExt;

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs;
use std::fs::OpenOptions;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

const KLAK_DB: &str = "sqlite:klak.db";
const GLOW_WINDOW_LABEL: &str = "glow";
const CAPTION_WINDOW_LABEL: &str = "caption";

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
const BACKGROUND_LOG_FILE_LIMIT: u64 = 96_000;

static BACKGROUND_CHILDREN: OnceLock<Mutex<HashMap<String, Child>>> = OnceLock::new();
static WAKE_LISTENER_REGISTRY: OnceLock<Mutex<WakeListenerRegistry>> = OnceLock::new();
static BROWSER_SESSIONS: OnceLock<Mutex<HashMap<String, BrowserSessionState>>> = OnceLock::new();

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

#[derive(Clone, serde::Deserialize, serde::Serialize)]
struct DiscoveredAppCandidate {
    id: String,
    name: String,
    normalized_name: String,
    executable_path: Option<String>,
    source: String,
    publisher: Option<String>,
    icon_path: Option<String>,
    confidence: String,
    category: String,
    is_registered: bool,
    is_blocked: bool,
    block_reason: Option<String>,
    detected_at: String,
}

#[derive(serde::Deserialize)]
struct ScanInstalledAppsInput {
    registered_executable_paths: Option<Vec<String>>,
}

#[derive(serde::Deserialize)]
struct RegisterDiscoveredAppsInput {
    candidates: Vec<DiscoveredAppCandidate>,
    registered_executable_paths: Option<Vec<String>>,
}

#[derive(serde::Serialize)]
struct RegisterDiscoveredAppsOutput {
    accepted: Vec<DiscoveredAppCandidate>,
    rejected: Vec<DiscoveredAppCandidate>,
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

#[derive(Clone)]
struct BrowserSessionState {
    url: String,
}

#[derive(serde::Deserialize)]
struct BrowserSessionOpenInput {
    #[serde(rename = "sessionId")]
    session_id: String,
    url: String,
    visible: Option<bool>,
}

#[derive(serde::Deserialize)]
struct BrowserSessionNavigateInput {
    #[serde(rename = "sessionId")]
    session_id: String,
    url: String,
}

#[derive(serde::Deserialize)]
struct BrowserSessionSelectorInput {
    #[serde(rename = "sessionId")]
    session_id: String,
    selector: String,
}

#[derive(serde::Deserialize)]
struct BrowserSessionTypeInput {
    #[serde(rename = "sessionId")]
    session_id: String,
    selector: String,
    text: String,
}

#[derive(serde::Deserialize)]
struct BrowserSessionSelectInput {
    #[serde(rename = "sessionId")]
    session_id: String,
    selector: String,
    value: String,
}

#[derive(serde::Deserialize)]
struct BrowserSessionWaitInput {
    #[serde(rename = "sessionId")]
    session_id: String,
    selector: Option<String>,
    text: Option<String>,
    #[serde(rename = "timeoutMs")]
    timeout_ms: Option<u64>,
}

#[derive(serde::Deserialize)]
struct BrowserSessionReadInput {
    #[serde(rename = "sessionId")]
    session_id: String,
    selector: Option<String>,
}

#[derive(serde::Deserialize)]
struct BrowserSessionIdInput {
    #[serde(rename = "sessionId")]
    session_id: String,
}

#[derive(serde::Serialize)]
struct BrowserStateOutput {
    session_id: Option<String>,
    url: Option<String>,
    title: Option<String>,
    visible_text: Option<String>,
    selector_found: Option<bool>,
    content_excerpt: Option<String>,
}

#[derive(serde::Serialize)]
struct WindowObservationOutput {
    title: String,
    process_name: Option<String>,
    pid: Option<u32>,
    is_foreground: bool,
}

#[derive(serde::Serialize)]
struct ProcessObservationOutput {
    pid: u32,
    process_name: String,
    window_title: Option<String>,
}

#[derive(serde::Deserialize)]
struct FocusWindowInput {
    title: String,
}

#[derive(serde::Deserialize)]
struct PortProbeInput {
    port: u16,
}

#[derive(serde::Deserialize)]
struct FileProbeInput {
    path: String,
    #[serde(rename = "maxBytes")]
    max_bytes: Option<usize>,
}

#[derive(serde::Serialize)]
struct FileProbeOutput {
    exists: bool,
    content_excerpt: Option<String>,
}

#[derive(serde::Deserialize)]
struct StatPathsInput {
    paths: Vec<String>,
}

#[derive(serde::Serialize)]
struct StatPathOutput {
    path: String,
    exists: bool,
    size: Option<u64>,
    modified_at: Option<String>,
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

#[derive(serde::Deserialize)]
struct StartWakeListenerInput {
    python_executable_path: String,
    model_name: String,
    custom_model_path: Option<String>,
    threshold: f32,
    diagnostics_enabled: Option<bool>,
    device_name: Option<String>,
    device_index: Option<i32>,
}

#[derive(serde::Serialize)]
struct WakeListenerStatus {
    running: bool,
    state: String,
    pid: Option<u32>,
    message: String,
    selected_microphone: Option<String>,
    latest_error: Option<String>,
}

#[derive(serde::Deserialize)]
struct ListWakeAudioDevicesInput {
    python_executable_path: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct WakeAudioDevice {
    device_index: i32,
    device_name: String,
    max_input_channels: i32,
    default_sample_rate: f64,
    is_default: bool,
    can_attempt: bool,
}

#[derive(serde::Deserialize)]
struct WakeAudioDevicesEvent {
    devices: Vec<WakeAudioDevice>,
}

#[derive(serde::Deserialize)]
struct RealtimeSessionInput {
    api_base_url: String,
    model: String,
    voice: Option<String>,
    instructions: Option<String>,
}

#[derive(serde::Serialize)]
struct RealtimeSessionOutput {
    client_secret: String,
    model: String,
    expires_at: Option<i64>,
    endpoint: String,
}

#[derive(Clone, PartialEq)]
enum WakeListenerState {
    Stopped,
    Starting,
    Running,
    Stopping,
    Failed,
}

struct WakeListenerRegistry {
    state: WakeListenerState,
    child: Option<Child>,
    config_signature: Option<String>,
    selected_microphone: Option<String>,
    latest_error: Option<String>,
}

impl Default for WakeListenerRegistry {
    fn default() -> Self {
        Self {
            state: WakeListenerState::Stopped,
            child: None,
            config_signature: None,
            selected_microphone: None,
            latest_error: None,
        }
    }
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
fn create_realtime_session(input: RealtimeSessionInput) -> Result<RealtimeSessionOutput, String> {
    let api_key = get_secret("ai_api_key".into())?
        .ok_or_else(|| "Add your OpenAI API key in Settings before using realtime voice.".to_string())?;
    let base_url = input.api_base_url.trim().trim_end_matches('/');
    let endpoint = format!("{base_url}/realtime/client_secrets");
    let model = if input.model.trim().is_empty() {
        "gpt-4o-realtime-preview".to_string()
    } else {
        input.model.trim().to_string()
    };

    let body = serde_json::json!({
        "session": {
            "type": "realtime",
            "model": model,
            "modalities": ["audio", "text"],
            "instructions": input.instructions.unwrap_or_else(|| "You are Klak, a concise local-first desktop assistant. Do not execute tools directly; describe proposed actions for the app to preview and approve.".into()),
            "audio": {
                "input": {
                    "format": { "type": "audio/pcm", "rate": 24000 },
                    "transcription": {
                        "model": "gpt-realtime-whisper",
                        "language": "en"
                    },
                    "turn_detection": {
                        "type": "server_vad",
                        "threshold": 0.5,
                        "prefix_padding_ms": 300,
                        "silence_duration_ms": 650,
                        "create_response": true,
                        "interrupt_response": true
                    }
                },
                "output": {
                    "format": { "type": "audio/pcm", "rate": 24000 },
                    "voice": input.voice.unwrap_or_else(|| "alloy".into())
                }
            }
        }
    });

    let response = ureq::post(&endpoint)
        .set("Authorization", &format!("Bearer {api_key}"))
        .set("Content-Type", "application/json")
        .send_json(body);

    let value: serde_json::Value = match response {
        Ok(response) => response
            .into_json()
            .map_err(|error| format!("Realtime credential response was not valid JSON: {error}"))?,
        Err(ureq::Error::Status(status, response)) => {
            let body = response.into_string().unwrap_or_default();
            return Err(format!(
                "Realtime credential request returned {status}. {}",
                redact_provider_error(&body)
            ));
        }
        Err(error) => return Err(format!("Realtime credential request failed: {error}")),
    };

    let client_secret = value
        .pointer("/client_secret/value")
        .or_else(|| value.pointer("/value"))
        .and_then(|item| item.as_str())
        .ok_or_else(|| "Realtime credential response did not include a client secret.".to_string())?
        .to_string();
    let expires_at = value
        .pointer("/client_secret/expires_at")
        .or_else(|| value.pointer("/expires_at"))
        .and_then(|item| item.as_i64());
    let returned_model = value
        .pointer("/session/model")
        .or_else(|| value.pointer("/model"))
        .and_then(|item| item.as_str())
        .unwrap_or(&model)
        .to_string();

    Ok(RealtimeSessionOutput {
        client_secret,
        model: returned_model,
        expires_at,
        endpoint: endpoint.replace("/client_secrets", "/calls"),
    })
}

#[tauri::command]
fn summon_klak(app: tauri::AppHandle) -> Result<(), String> {
    summon_klak_window(&app);
    Ok(())
}

#[tauri::command]
fn update_voice_caption(app: tauri::AppHandle, text: String) -> Result<(), String> {
    show_voice_caption(&app, &text);
    Ok(())
}

#[tauri::command]
fn start_wake_listener(
    app: tauri::AppHandle,
    input: StartWakeListenerInput,
) -> Result<WakeListenerStatus, String> {
    let mut registry = wake_listener_registry()
        .lock()
        .map_err(|_| "Wake listener registry is unavailable.".to_string())?;

    let signature = wake_listener_config_signature(&input);
    let mut needs_cleanup = false;
    let current_state = registry.state.clone();
    let current_signature = registry.config_signature.clone();
    if let Some(child) = registry.child.as_mut() {
        if matches!(child.try_wait(), Ok(None)) {
            if current_state == WakeListenerState::Starting || current_state == WakeListenerState::Running {
                let pid = child.id();
                if current_signature.as_deref() == Some(signature.as_str()) {
                    wake_lifecycle_log(&current_state, Some(pid), "start ignored; listener already active");
                    return Ok(wake_listener_status_from_registry(&registry, "Wake listener is already running."));
                }
                wake_lifecycle_log(&WakeListenerState::Stopping, Some(pid), "settings changed; restarting listener");
                stop_wake_listener_child(&mut registry);
            }
        } else {
            needs_cleanup = true;
        }
    }
    if needs_cleanup {
        registry.child = None;
        registry.state = WakeListenerState::Stopped;
        registry.config_signature = None;
    }

    registry.state = WakeListenerState::Starting;
    registry.latest_error = None;
    wake_lifecycle_log(&registry.state, None, "starting listener");

    let python = resolve_wake_listener_python(input.python_executable_path.trim());
    if python.is_empty() {
        registry.state = WakeListenerState::Failed;
        registry.latest_error = Some("Python executable path is required for openWakeWord.".into());
        return Err("Python executable path is required for openWakeWord.".into());
    }

    let script_path = resolve_wake_listener_script(&app)?;
    let selected_device_name = input.device_name.as_deref().unwrap_or("").trim();
    let mut command = Command::new(&python);
    command
        .arg(script_path)
        .arg("--model-name")
        .arg(if input.model_name.trim().is_empty() {
            "hey_jarvis"
        } else {
            input.model_name.trim()
        })
        .arg("--threshold")
        .arg(input.threshold.clamp(0.2, 0.95).to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if input.diagnostics_enabled.unwrap_or(false) {
        command.arg("--diagnostics");
    }
    if !selected_device_name.is_empty() {
        command.arg("--device-name").arg(selected_device_name);
    }
    if let Some(device_index) = input.device_index {
        if device_index >= 0 {
            command.arg("--device-index").arg(device_index.to_string());
        }
    }

    if let Some(custom_model_path) = input.custom_model_path.as_deref() {
        if !custom_model_path.trim().is_empty() {
            command.arg("--custom-model-path").arg(custom_model_path.trim());
        }
    }

    let mut child = command
        .spawn()
        .map_err(|error| {
            registry.state = WakeListenerState::Failed;
            registry.latest_error = Some(format!("Unable to start openWakeWord sidecar: {error}"));
            format!("Unable to start openWakeWord sidecar: {error}")
        })?;
    let pid = child.id();

    if let Some(stdout) = child.stdout.take() {
        pipe_wake_listener_stdout(app.clone(), stdout);
    }
    if let Some(stderr) = child.stderr.take() {
        pipe_wake_listener_stderr(stderr);
    }

    registry.state = WakeListenerState::Running;
    registry.config_signature = Some(signature);
    registry.selected_microphone = if selected_device_name.is_empty() {
        None
    } else {
        Some(selected_device_name.to_string())
    };
    registry.child = Some(child);
    wake_lifecycle_log(&registry.state, Some(pid), "listener started");
    Ok(wake_listener_status_from_registry(&registry, "Wake listener started."))
}

#[tauri::command]
fn stop_wake_listener() -> Result<(), String> {
    let mut registry = wake_listener_registry()
        .lock()
        .map_err(|_| "Wake listener registry is unavailable.".to_string())?;
    stop_wake_listener_child(&mut registry);
    Ok(())
}

#[tauri::command]
fn get_wake_listener_status() -> Result<WakeListenerStatus, String> {
    let mut registry = wake_listener_registry()
        .lock()
        .map_err(|_| "Wake listener registry is unavailable.".to_string())?;
    if let Some(child) = registry.child.as_mut() {
        if matches!(child.try_wait(), Ok(Some(_)) | Err(_)) {
            registry.child = None;
            registry.state = WakeListenerState::Stopped;
            registry.config_signature = None;
        }
    }
    Ok(wake_listener_status_from_registry(&registry, "Wake listener status."))
}

#[tauri::command]
fn list_wake_audio_devices(
    app: tauri::AppHandle,
    input: ListWakeAudioDevicesInput,
) -> Result<Vec<WakeAudioDevice>, String> {
    let python = resolve_wake_listener_python(input.python_executable_path.trim());
    if python.is_empty() {
        return Err("Python executable path is required to list microphones.".into());
    }
    let script_path = resolve_wake_listener_script(&app)?;
    let output = Command::new(&python)
        .arg(script_path)
        .arg("--list-devices-json")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("Unable to list wake-word microphones: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Wake-word microphone listing failed without a detailed error.".into()
        } else {
            format!("Wake-word microphone listing failed: {}", truncate_for_ui(&stderr))
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let value: serde_json::Value = serde_json::from_str(line)
            .map_err(|error| format!("Unable to parse microphone list: {error}"))?;
        if value.get("event").and_then(|event| event.as_str()) == Some("audio_devices") {
            let event: WakeAudioDevicesEvent =
                serde_json::from_value(value).map_err(|error| error.to_string())?;
            return Ok(event.devices);
        }
    }

    Err("Wake-word microphone listing did not return any devices.".into())
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
    let executable = validate_launchable_app_path(&input.executable_path)?;

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
    let blocked_shell = is_blocked_app_executable_name(&file_name);
    let message = if blocked_shell {
        "System command and scripting tools cannot be registered as normal apps."
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
fn scan_installed_apps(
    input: ScanInstalledAppsInput,
) -> Result<Vec<DiscoveredAppCandidate>, String> {
    let registered_paths = normalized_registered_paths(input.registered_executable_paths);
    scan_installed_apps_impl(&registered_paths)
}

#[tauri::command]
fn register_discovered_apps(
    input: RegisterDiscoveredAppsInput,
) -> Result<RegisterDiscoveredAppsOutput, String> {
    if input.candidates.is_empty() {
        return Ok(RegisterDiscoveredAppsOutput {
            accepted: Vec::new(),
            rejected: Vec::new(),
        });
    }
    let registered_paths = normalized_registered_paths(input.registered_executable_paths);
    let discovered = scan_installed_apps_impl(&registered_paths)?;
    let by_id: HashMap<String, DiscoveredAppCandidate> = discovered
        .into_iter()
        .map(|candidate| (candidate.id.clone(), candidate))
        .collect();
    let mut accepted = Vec::new();
    let mut rejected = Vec::new();

    for candidate in input.candidates {
        let Some(current) = by_id.get(&candidate.id).cloned() else {
            let mut rejected_candidate = candidate;
            rejected_candidate.is_blocked = true;
            rejected_candidate.block_reason =
                Some("This suggestion was not found in the latest safe app scan.".into());
            rejected.push(rejected_candidate);
            continue;
        };
        if current.is_blocked {
            rejected.push(current);
            continue;
        }
        let Some(path) = current.executable_path.as_deref() else {
            let mut rejected_candidate = current;
            rejected_candidate.is_blocked = true;
            rejected_candidate.block_reason = Some("No executable path was available.".into());
            rejected.push(rejected_candidate);
            continue;
        };
        if let Err(error) = validate_launchable_app_path(path) {
            let mut rejected_candidate = current;
            rejected_candidate.is_blocked = true;
            rejected_candidate.block_reason = Some(error);
            rejected.push(rejected_candidate);
            continue;
        }
        if !matches!(current.category.as_str(), "recommended" | "advanced") {
            let mut rejected_candidate = current;
            rejected_candidate.is_blocked = true;
            rejected_candidate.block_reason =
                Some("This suggestion is not a user-facing app Klak should register.".into());
            rejected.push(rejected_candidate);
            continue;
        }
        if current.is_registered {
            let mut rejected_candidate = current;
            rejected_candidate.is_blocked = true;
            rejected_candidate.block_reason = Some("This app is already registered.".into());
            rejected.push(rejected_candidate);
            continue;
        }
        accepted.push(current);
    }

    Ok(RegisterDiscoveredAppsOutput { accepted, rejected })
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
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(&output_log_path)
        .map_err(|error| format!("Unable to open background output log: {error}"))?;

    let mut child = Command::new(program)
        .args(args)
        .current_dir(&working_directory)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Unable to start background process: {error}"))?;
    let pid = child.id();
    if let Some(stdout) = child.stdout.take() {
        pipe_to_log(stdout, output_log_path.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        pipe_to_log(stderr, output_log_path.clone());
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
            status: "stale".into(),
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
            status: "stale".into(),
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

fn wake_listener_registry() -> &'static Mutex<WakeListenerRegistry> {
    WAKE_LISTENER_REGISTRY.get_or_init(|| Mutex::new(WakeListenerRegistry::default()))
}

fn wake_listener_state_label(state: &WakeListenerState) -> &'static str {
    match state {
        WakeListenerState::Stopped => "stopped",
        WakeListenerState::Starting => "starting",
        WakeListenerState::Running => "running",
        WakeListenerState::Stopping => "stopping",
        WakeListenerState::Failed => "failed",
    }
}

fn wake_lifecycle_log(state: &WakeListenerState, pid: Option<u32>, message: &str) {
    eprintln!(
        "wake-listener lifecycle: state={} pid={} {message}",
        wake_listener_state_label(state),
        pid.map(|value| value.to_string()).unwrap_or_else(|| "none".into())
    );
}

fn wake_listener_status_from_registry(
    registry: &WakeListenerRegistry,
    message: &str,
) -> WakeListenerStatus {
    let pid = registry.child.as_ref().map(|child| child.id());
    WakeListenerStatus {
        running: registry.state == WakeListenerState::Running && pid.is_some(),
        state: wake_listener_state_label(&registry.state).into(),
        pid,
        message: message.into(),
        selected_microphone: registry.selected_microphone.clone(),
        latest_error: registry.latest_error.clone(),
    }
}

fn stop_wake_listener_child(registry: &mut WakeListenerRegistry) {
    registry.state = WakeListenerState::Stopping;
    if let Some(child) = registry.child.as_mut() {
        let pid = child.id();
        wake_lifecycle_log(&registry.state, Some(pid), "stopping owned listener");
        if matches!(child.try_wait(), Ok(None)) {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    registry.child = None;
    registry.state = WakeListenerState::Stopped;
    registry.config_signature = None;
    registry.selected_microphone = None;
    wake_lifecycle_log(&registry.state, None, "listener stopped");
}

fn wake_listener_config_signature(input: &StartWakeListenerInput) -> String {
    serde_json::json!({
        "python": input.python_executable_path.trim(),
        "model": if input.model_name.trim().is_empty() { "hey_jarvis" } else { input.model_name.trim() },
        "custom_model": input.custom_model_path.as_deref().unwrap_or("").trim(),
        "threshold": input.threshold.clamp(0.2, 0.95),
        "diagnostics": input.diagnostics_enabled.unwrap_or(false),
        "device_name": input.device_name.as_deref().unwrap_or("").trim(),
        "device_index": input.device_index,
    })
    .to_string()
}

fn validate_launchable_app_path(path: &str) -> Result<PathBuf, String> {
    let executable = PathBuf::from(path.trim());
    if !executable.is_file() {
        return Err("Registered app executable does not exist.".into());
    }
    let file_name = executable
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_lowercase();
    if is_blocked_app_executable_name(&file_name) {
        return Err(
            "System command and scripting tools cannot be registered as normal apps.".into(),
        );
    }
    if executable
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| !extension.eq_ignore_ascii_case("exe"))
        .unwrap_or(true)
    {
        return Err("Registered apps must point to a .exe file.".into());
    }
    executable
        .canonicalize()
        .map_err(|error| format!("Unable to resolve registered app path: {error}"))
}

fn is_blocked_app_executable_name(file_name: &str) -> bool {
    matches!(
        file_name.to_ascii_lowercase().as_str(),
        "cmd.exe"
            | "powershell.exe"
            | "pwsh.exe"
            | "winget.exe"
            | "python.exe"
            | "python3.exe"
            | "pythonw.exe"
            | "py.exe"
            | "pyw.exe"
            | "pymanager.exe"
            | "pywmanager.exe"
            | "ngrok.exe"
            | "wscript.exe"
            | "cscript.exe"
            | "mshta.exe"
            | "rundll32.exe"
            | "regsvr32.exe"
            | "regedit.exe"
            | "taskkill.exe"
            | "shutdown.exe"
            | "format.com"
            | "diskpart.exe"
            | "bcdedit.exe"
            | "wt.exe"
            | "windowsterminal.exe"
            | "bash.exe"
            | "wsl.exe"
    )
}

fn normalized_registered_paths(paths: Option<Vec<String>>) -> Vec<String> {
    paths
        .unwrap_or_default()
        .into_iter()
        .filter_map(|path| normalize_path_for_compare(&path))
        .collect()
}

fn normalize_path_for_compare(path: &str) -> Option<String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return None;
    }
    let candidate = PathBuf::from(trimmed);
    let resolved = candidate.canonicalize().unwrap_or(candidate);
    Some(resolved.to_string_lossy().to_ascii_lowercase())
}

#[cfg(not(windows))]
fn scan_installed_apps_impl(
    _registered_paths: &[String],
) -> Result<Vec<DiscoveredAppCandidate>, String> {
    Ok(Vec::new())
}

#[cfg(windows)]
fn scan_installed_apps_impl(
    registered_paths: &[String],
) -> Result<Vec<DiscoveredAppCandidate>, String> {
    use winreg::enums::{
        HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY,
    };
    use winreg::RegKey;

    let detected_at = chrono_like_timestamp().to_string();
    let mut candidates: HashMap<String, DiscoveredAppCandidate> = HashMap::new();
    let publishers = collect_uninstall_metadata();

    let app_path_roots = [
        (
            RegKey::predef(HKEY_CURRENT_USER),
            "HKCU App Paths",
            "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths",
            KEY_READ,
        ),
        (
            RegKey::predef(HKEY_LOCAL_MACHINE),
            "HKLM App Paths",
            "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths",
            KEY_READ | KEY_WOW64_64KEY,
        ),
        (
            RegKey::predef(HKEY_LOCAL_MACHINE),
            "HKLM App Paths",
            "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths",
            KEY_READ | KEY_WOW64_32KEY,
        ),
    ];

    for (root, source, subkey, flags) in app_path_roots {
        let Ok(key) = root.open_subkey_with_flags(subkey, flags) else {
            continue;
        };
        for app_key_name in key.enum_keys().flatten().take(800) {
            let Ok(app_key) = key.open_subkey_with_flags(&app_key_name, flags) else {
                continue;
            };
            let path = app_key
                .get_value::<String, _>("")
                .ok()
                .or_else(|| app_key.get_value::<String, _>("Path").ok());
            if let Some(path) = path {
                add_candidate(
                    &mut candidates,
                    &path,
                    display_name_from_exe(&app_key_name),
                    source,
                    "high",
                    &publishers,
                    registered_paths,
                    &detected_at,
                );
            }
        }
    }

    let uninstall_roots = [
        (
            RegKey::predef(HKEY_CURRENT_USER),
            "HKCU Installed Apps",
            "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
            KEY_READ,
        ),
        (
            RegKey::predef(HKEY_LOCAL_MACHINE),
            "HKLM Installed Apps",
            "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
            KEY_READ | KEY_WOW64_64KEY,
        ),
        (
            RegKey::predef(HKEY_LOCAL_MACHINE),
            "HKLM Installed Apps",
            "Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
            KEY_READ | KEY_WOW64_32KEY,
        ),
    ];

    for (root, source, subkey, flags) in uninstall_roots {
        let Ok(key) = root.open_subkey_with_flags(subkey, flags) else {
            continue;
        };
        for app_key_name in key.enum_keys().flatten().take(1200) {
            let Ok(app_key) = key.open_subkey_with_flags(&app_key_name, flags) else {
                continue;
            };
            let name = app_key
                .get_value::<String, _>("DisplayName")
                .unwrap_or_else(|_| display_name_from_exe(&app_key_name));
            let publisher = app_key.get_value::<String, _>("Publisher").ok();
            let icon = app_key.get_value::<String, _>("DisplayIcon").ok();
            let install_location = app_key.get_value::<String, _>("InstallLocation").ok();
            let icon_path = icon
                .as_deref()
                .and_then(extract_icon_image_from_registry_value);
            if let Some(path) =
                icon.and_then(|value| extract_executable_from_registry_value(&value))
            {
                add_candidate_with_publisher(
                    &mut candidates,
                    &path,
                    name.clone(),
                    source,
                    "medium",
                    publisher.clone(),
                    icon_path.clone(),
                    registered_paths,
                    &detected_at,
                );
            } else if let Some(location) = install_location {
                let guessed = PathBuf::from(location).join(format!("{}.exe", name));
                if guessed.is_file() {
                    add_candidate_with_publisher(
                        &mut candidates,
                        &guessed.to_string_lossy(),
                        name,
                        source,
                        "low",
                        publisher,
                        None,
                        registered_paths,
                        &detected_at,
                    );
                }
            }
        }
    }

    let mut values: Vec<_> = candidates.into_values().collect();
    values.sort_by(|left, right| {
        category_rank(&left.category)
            .cmp(&category_rank(&right.category))
            .then(left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    values.truncate(300);
    Ok(values)
}

#[cfg(windows)]
#[derive(Clone)]
struct AppMetadata {
    publisher: Option<String>,
    icon_path: Option<String>,
}

#[cfg(windows)]
fn collect_uninstall_metadata() -> HashMap<String, AppMetadata> {
    use winreg::enums::{
        HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY,
    };
    use winreg::RegKey;

    let roots = [
        (
            RegKey::predef(HKEY_CURRENT_USER),
            "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
            KEY_READ,
        ),
        (
            RegKey::predef(HKEY_LOCAL_MACHINE),
            "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
            KEY_READ | KEY_WOW64_64KEY,
        ),
        (
            RegKey::predef(HKEY_LOCAL_MACHINE),
            "Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
            KEY_READ | KEY_WOW64_32KEY,
        ),
    ];
    let mut publishers = HashMap::new();
    for (root, subkey, flags) in roots {
        let Ok(key) = root.open_subkey_with_flags(subkey, flags) else {
            continue;
        };
        for app_key_name in key.enum_keys().flatten().take(1200) {
            let Ok(app_key) = key.open_subkey_with_flags(&app_key_name, flags) else {
                continue;
            };
            let name = app_key.get_value::<String, _>("DisplayName").ok();
            let publisher = app_key.get_value::<String, _>("Publisher").ok();
            let icon_path = app_key
                .get_value::<String, _>("DisplayIcon")
                .ok()
                .and_then(|value| extract_icon_image_from_registry_value(&value));
            if let Some(name) = name {
                publishers.insert(
                    normalize_app_name(&name),
                    AppMetadata {
                        publisher,
                        icon_path,
                    },
                );
            }
        }
    }
    publishers
}

#[cfg(windows)]
fn add_candidate(
    candidates: &mut HashMap<String, DiscoveredAppCandidate>,
    path: &str,
    name: String,
    source: &str,
    confidence: &str,
    publishers: &HashMap<String, AppMetadata>,
    registered_paths: &[String],
    detected_at: &str,
) {
    let metadata = publishers.get(&normalize_app_name(&name)).cloned();
    let publisher = metadata.as_ref().and_then(|item| item.publisher.clone());
    let icon_path = metadata.and_then(|item| item.icon_path);
    add_candidate_with_publisher(
        candidates,
        path,
        name,
        source,
        confidence,
        publisher,
        icon_path,
        registered_paths,
        detected_at,
    );
}

#[cfg(windows)]
fn add_candidate_with_publisher(
    candidates: &mut HashMap<String, DiscoveredAppCandidate>,
    path: &str,
    name: String,
    source: &str,
    confidence: &str,
    publisher: Option<String>,
    icon_path: Option<String>,
    registered_paths: &[String],
    detected_at: &str,
) {
    let Some(path) =
        extract_executable_from_registry_value(path).or_else(|| Some(path.to_string()))
    else {
        return;
    };
    let executable = PathBuf::from(path.trim());
    if !executable.is_file() {
        return;
    }
    let resolved = match executable.canonicalize() {
        Ok(path) => path,
        Err(_) => return,
    };
    let executable_path = resolved.to_string_lossy().to_string();
    let compare_path = executable_path.to_ascii_lowercase();
    let file_name = resolved
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let valid_extension = resolved
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("exe"))
        .unwrap_or(false);
    let name = normalize_display_name(
        &clean_display_name(&name, &file_name),
        &file_name,
        publisher.as_deref(),
    );
    let normalized_name = normalize_app_name(&name);
    let registered = registered_paths.iter().any(|path| path == &compare_path);
    let quality = classify_app_candidate(
        &name,
        &executable_path,
        &file_name,
        publisher.as_deref(),
        confidence,
        registered,
        valid_extension,
    );
    let id = discovered_app_id(source, &compare_path);
    let icon_path = icon_path.or_else(|| {
        matches!(
            quality.category.as_str(),
            "recommended" | "already_registered" | "advanced"
        )
        .then(|| cached_app_icon_path(&resolved, &id))
        .flatten()
    });
    let candidate = DiscoveredAppCandidate {
        id: id.clone(),
        name,
        normalized_name,
        executable_path: Some(executable_path),
        source: source.into(),
        publisher,
        icon_path,
        confidence: quality.confidence,
        category: quality.category,
        is_registered: registered,
        is_blocked: quality.is_blocked,
        block_reason: quality.block_reason,
        detected_at: detected_at.into(),
    };

    candidates
        .entry(compare_path)
        .and_modify(|existing| {
            if confidence_rank(&candidate.confidence) > confidence_rank(&existing.confidence) {
                *existing = candidate.clone();
            } else if existing.publisher.is_none() && candidate.publisher.is_some() {
                existing.publisher = candidate.publisher.clone();
            }
        })
        .or_insert(candidate);
}

#[cfg(windows)]
fn extract_executable_from_registry_value(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(rest) = trimmed.strip_prefix('"') {
        return rest.find('"').map(|end| rest[..end].to_string());
    }
    let lower = trimmed.to_ascii_lowercase();
    lower
        .find(".exe")
        .map(|index| trimmed[..index + 4].trim_end_matches(',').to_string())
}

#[cfg(windows)]
fn extract_icon_image_from_registry_value(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let candidate = if let Some(rest) = trimmed.strip_prefix('"') {
        rest.find('"').map(|end| rest[..end].to_string())
    } else {
        trimmed
            .split(',')
            .next()
            .map(|part| part.trim().to_string())
    }?;
    let path = PathBuf::from(candidate);
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "ico" | "png" | "jpg" | "jpeg" | "webp") {
        return None;
    }
    path.is_file().then(|| {
        path.canonicalize()
            .unwrap_or(path)
            .to_string_lossy()
            .to_string()
    })
}

struct CandidateQuality {
    category: String,
    confidence: String,
    is_blocked: bool,
    block_reason: Option<String>,
}

fn classify_app_candidate(
    name: &str,
    executable_path: &str,
    file_name: &str,
    publisher: Option<&str>,
    source_confidence: &str,
    is_registered: bool,
    valid_extension: bool,
) -> CandidateQuality {
    if is_registered {
        return CandidateQuality {
            category: "already_registered".into(),
            confidence: "already added".into(),
            is_blocked: false,
            block_reason: None,
        };
    }
    if !valid_extension {
        return unsupported_quality("Only Windows .exe apps can be registered.");
    }
    if is_blocked_app_executable_name(file_name) {
        return CandidateQuality {
            category: "blocked".into(),
            confidence: "blocked".into(),
            is_blocked: true,
            block_reason: Some(
                "System command, scripting, and CLI tools cannot be registered as normal apps."
                    .into(),
            ),
        };
    }

    let haystack = format!(
        "{} {} {} {}",
        name,
        executable_path,
        file_name,
        publisher.unwrap_or("")
    )
    .to_ascii_lowercase();

    if contains_any(
        &haystack,
        &[
            "uninstall",
            "unins",
            "setup",
            "installer",
            " install ",
            "bootstrapper",
            "update helper",
            "updater",
            "repair",
            "modify",
            "remove",
            "redist",
            "redistributable",
            "runtime installer",
            "package cache",
            "vc_redist",
            "vcredist",
            "winsdksetup",
        ],
    ) {
        return unsupported_quality("Installers, uninstallers, update helpers, and redistributables are hidden from normal app suggestions.");
    }

    if contains_any(
        &haystack,
        &[
            "adminserver",
            "admin server",
            "update service",
            "package manager server",
            "telemetry",
            "diagnostic",
            "iediag",
            "system repair",
            "service helper",
            "teamsupdate",
            "windows packagemanager",
            "windowspackagemanagerserver",
        ],
    ) {
        return unsupported_quality("System, service, diagnostic, and admin helper executables are not normal app suggestions.");
    }

    if contains_any(
        &haystack,
        &[
            "sdk",
            "runtime",
            "command line",
            " cli",
            "developer tool command",
            "\\package cache\\",
            "\\windows kits\\",
            "\\windows\\system32\\",
            "\\windows\\syswow64\\",
        ],
    ) && !is_known_user_app(&haystack)
    {
        return CandidateQuality {
            category: "advanced".into(),
            confidence: "advanced".into(),
            is_blocked: false,
            block_reason: Some("Technical helper or developer/runtime component.".into()),
        };
    }

    if is_known_user_app(&haystack) || source_confidence == "high" {
        return CandidateQuality {
            category: "recommended".into(),
            confidence: if is_known_user_app(&haystack) {
                "recommended".into()
            } else {
                source_confidence.into()
            },
            is_blocked: false,
            block_reason: None,
        };
    }

    CandidateQuality {
        category: "advanced".into(),
        confidence: "advanced".into(),
        is_blocked: false,
        block_reason: Some("Less common app suggestion. Review the path before adding.".into()),
    }
}

fn unsupported_quality(reason: &str) -> CandidateQuality {
    CandidateQuality {
        category: "unsupported".into(),
        confidence: "unsupported".into(),
        is_blocked: true,
        block_reason: Some(reason.into()),
    }
}

fn contains_any(value: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| value.contains(needle))
}

fn is_known_user_app(value: &str) -> bool {
    contains_any(
        value,
        &[
            "google chrome",
            "chrome.exe",
            "microsoft edge",
            "msedge.exe",
            "visual studio code",
            "code.exe",
            "slack",
            "figma",
            "obs studio",
            "obs64.exe",
            "anydesk",
            "notepad",
            "paint",
            "mspaint",
            "microsoft teams",
            "teams.exe",
            "outlook",
            "olk.exe",
            "winrar",
            "bibleshow",
            "open design",
            "gameloop",
            "snipping tool",
            "snippingtool",
            "zoom",
            "firefox",
            "brave",
            "word",
            "excel",
            "powerpoint",
            "onenote",
            "notion",
            "obsidian",
            "adobe acrobat",
            "spotify",
            "vlc",
        ],
    )
}

fn category_rank(value: &str) -> u8 {
    match value {
        "recommended" => 0,
        "already_registered" => 1,
        "advanced" => 2,
        "unsupported" => 3,
        "blocked" => 4,
        _ => 5,
    }
}

#[cfg(windows)]
fn cached_app_icon_path(executable_path: &Path, candidate_id: &str) -> Option<String> {
    let mut icon_dir = std::env::temp_dir();
    icon_dir.push("klak");
    icon_dir.push("app-icons");
    fs::create_dir_all(&icon_dir).ok()?;
    let icon_path = icon_dir.join(format!("{candidate_id}.png"));
    if icon_path.is_file() {
        return Some(icon_path.to_string_lossy().to_string());
    }
    let bytes = systemicons::get_icon(&executable_path.to_string_lossy(), 64).ok()?;
    if bytes.is_empty() || bytes.len() > 512_000 {
        return None;
    }
    fs::write(&icon_path, bytes).ok()?;
    Some(icon_path.to_string_lossy().to_string())
}

#[cfg(not(windows))]
fn cached_app_icon_path(_executable_path: &Path, _candidate_id: &str) -> Option<String> {
    None
}

fn clean_display_name(value: &str, fallback_file_name: &str) -> String {
    let cleaned = value
        .trim()
        .trim_end_matches(".exe")
        .replace(['_', '-'], " ");
    if cleaned.is_empty() {
        display_name_from_exe(fallback_file_name)
    } else {
        cleaned
    }
}

fn normalize_display_name(
    value: &str,
    fallback_file_name: &str,
    publisher: Option<&str>,
) -> String {
    let normalized = normalize_app_name(value);
    let file_stem = Path::new(fallback_file_name)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or(fallback_file_name)
        .to_ascii_lowercase();
    match normalized.as_str() {
        "msedge" | "microsoft edge" => "Microsoft Edge".into(),
        "mspaint" | "paint" => "Paint".into(),
        "olk" | "outlook" | "microsoft outlook" => "Outlook".into(),
        "snippingtool" | "snipping tool" => "Snipping Tool".into(),
        "ms teams" | "teams" | "microsoft teams" => "Microsoft Teams".into(),
        "code" | "visual studio code"
            if publisher
                .unwrap_or("")
                .to_ascii_lowercase()
                .contains("microsoft") =>
        {
            "Visual Studio Code".into()
        }
        "store" | "microsoft store" => "Microsoft Store".into(),
        "iexplore" | "internet explorer" => "Internet Explorer".into(),
        "chrome" | "google chrome" => "Google Chrome".into(),
        _ => match file_stem.as_str() {
            "msedge" => "Microsoft Edge".into(),
            "mspaint" => "Paint".into(),
            "olk" => "Outlook".into(),
            "snippingtool" => "Snipping Tool".into(),
            "teams" | "ms-teams" => "Microsoft Teams".into(),
            "code" => "Visual Studio Code".into(),
            "chrome" => "Google Chrome".into(),
            "iexplore" => "Internet Explorer".into(),
            _ => value.trim().to_string(),
        },
    }
}

fn display_name_from_exe(value: &str) -> String {
    let stem = Path::new(value)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or(value)
        .replace(['_', '-'], " ");
    stem.split_whitespace()
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalize_app_name(value: &str) -> String {
    value
        .trim()
        .to_ascii_lowercase()
        .replace(".exe", "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn discovered_app_id(source: &str, executable_path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    source.hash(&mut hasher);
    executable_path.hash(&mut hasher);
    format!("disc_{:x}", hasher.finish())
}

fn confidence_rank(value: &str) -> u8 {
    match value {
        "high" => 3,
        "medium" => 2,
        "low" => 1,
        _ => 0,
    }
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

fn pipe_to_log<R: Read + Send + 'static>(mut reader: R, path: PathBuf) {
    thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
                        let _ = file.write_all(&buffer[..size]);
                        let _ = file.flush();
                    }
                    let _ = trim_background_log(&path);
                }
                Err(_) => break,
            }
        }
    });
}

fn trim_background_log(path: &Path) -> Result<(), String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() <= BACKGROUND_LOG_FILE_LIMIT {
        return Ok(());
    }
    let content = fs::read(path).map_err(|error| error.to_string())?;
    let keep = BACKGROUND_LOG_FILE_LIMIT as usize;
    let start = content.len().saturating_sub(keep);
    fs::write(path, &content[start..]).map_err(|error| error.to_string())
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
fn browser_open_session(
    app: tauri::AppHandle,
    input: BrowserSessionOpenInput,
) -> Result<(), String> {
    let session_id = sanitize_browser_session_id(&input.session_id)?;
    let url = validate_browser_url(&input.url)?;
    let label = browser_window_label(&session_id);
    let visible = input.visible.unwrap_or(true);

    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.close();
    }

    let builder = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::External(url.parse::<tauri::Url>().map_err(|error| error.to_string())?),
    )
    .title(format!("Klak Browser {}", session_id))
    .visible(visible)
    .inner_size(1280.0, 820.0);
    let window = builder.build().map_err(|error| error.to_string())?;
    if visible {
        let _ = window.set_focus();
    }

    browser_sessions()
        .lock()
        .map_err(|_| "Browser session registry is unavailable.".to_string())?
        .insert(
            session_id,
            BrowserSessionState {
                url,
            },
        );
    Ok(())
}

#[tauri::command]
fn browser_navigate_session(
    app: tauri::AppHandle,
    input: BrowserSessionNavigateInput,
) -> Result<(), String> {
    let session_id = sanitize_browser_session_id(&input.session_id)?;
    let url = validate_browser_url(&input.url)?;
    let label = browser_window_label(&session_id);

    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.close();
    }
    browser_open_session(
        app,
        BrowserSessionOpenInput {
            session_id,
            url,
            visible: Some(true),
        },
    )
}

#[tauri::command]
fn browser_click_selector(input: BrowserSessionSelectorInput) -> Result<(), String> {
    validate_browser_selector(&input.selector)?;
    let session = get_browser_session(&input.session_id)?;
    let content = fetch_url_html(&session.url)?;
    if content.contains(&input.selector) {
        Ok(())
    } else {
        Err("This page is open, but direct DOM click automation is not available for that selector yet. Use takeover to continue.".into())
    }
}

#[tauri::command]
fn browser_type_selector(input: BrowserSessionTypeInput) -> Result<(), String> {
    validate_browser_selector(&input.selector)?;
    if input.text.len() > 5_000 {
        return Err("Browser text input is too large.".into());
    }
    let session = get_browser_session(&input.session_id)?;
    let content = fetch_url_html(&session.url)?;
    if content.contains(&input.selector) {
        Ok(())
    } else {
        Err("This page is open, but direct DOM typing is not available for that selector yet. Use takeover to continue.".into())
    }
}

#[tauri::command]
fn browser_select_option(input: BrowserSessionSelectInput) -> Result<(), String> {
    validate_browser_selector(&input.selector)?;
    if input.value.trim().is_empty() {
        return Err("Browser select value is required.".into());
    }
    let session = get_browser_session(&input.session_id)?;
    let content = fetch_url_html(&session.url)?;
    if content.contains(&input.selector) {
        Ok(())
    } else {
        Err("This page is open, but direct DOM select automation is not available for that selector yet. Use takeover to continue.".into())
    }
}

#[tauri::command]
fn browser_wait_for(input: BrowserSessionWaitInput) -> Result<bool, String> {
    let session = get_browser_session(&input.session_id)?;
    let timeout = Duration::from_millis(input.timeout_ms.unwrap_or(12_000).clamp(250, 30_000));
    let started = Instant::now();
    while started.elapsed() < timeout {
        let state = build_browser_state(&input.session_id, &session.url, input.selector.as_deref())?;
        let selector_match = input
            .selector
            .as_deref()
            .map(|selector| selector.trim().is_empty() || state.content_excerpt.as_deref().unwrap_or("").contains(selector))
            .unwrap_or(true);
        let text_match = input
            .text
            .as_deref()
            .map(|text| state.visible_text.as_deref().unwrap_or("").contains(text))
            .unwrap_or(true);
        if selector_match && text_match {
            return Ok(true);
        }
        thread::sleep(Duration::from_millis(500));
    }
    Ok(false)
}

#[tauri::command]
fn browser_read_state(input: BrowserSessionReadInput) -> Result<BrowserStateOutput, String> {
    let session = get_browser_session(&input.session_id)?;
    build_browser_state(&input.session_id, &session.url, input.selector.as_deref())
}

#[tauri::command]
fn browser_close_session(
    app: tauri::AppHandle,
    input: BrowserSessionIdInput,
) -> Result<(), String> {
    let session_id = sanitize_browser_session_id(&input.session_id)?;
    let label = browser_window_label(&session_id);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.close();
    }
    browser_sessions()
        .lock()
        .map_err(|_| "Browser session registry is unavailable.".to_string())?
        .remove(&session_id);
    Ok(())
}

#[tauri::command]
fn list_open_windows() -> Result<Vec<WindowObservationOutput>, String> {
    let script = r#"
Get-Process |
  Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.Trim().Length -gt 0 } |
  Select-Object MainWindowTitle,ProcessName,Id |
  ConvertTo-Json -Compress
"#;
    let output = run_powershell_script(script)?;
    let parsed = parse_json_array(&output)?;
    Ok(parsed
        .into_iter()
        .map(|item| WindowObservationOutput {
            title: item.get("MainWindowTitle").and_then(|value| value.as_str()).unwrap_or("").to_string(),
            process_name: item.get("ProcessName").and_then(|value| value.as_str()).map(|value| value.to_string()),
            pid: item.get("Id").and_then(|value| value.as_u64()).map(|value| value as u32),
            is_foreground: false,
        })
        .filter(|item| !item.title.trim().is_empty())
        .collect())
}

#[tauri::command]
fn list_visible_processes() -> Result<Vec<ProcessObservationOutput>, String> {
    let script = r#"
Get-Process |
  Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.Trim().Length -gt 0 } |
  Select-Object Id,ProcessName,MainWindowTitle |
  ConvertTo-Json -Compress
"#;
    let output = run_powershell_script(script)?;
    let parsed = parse_json_array(&output)?;
    Ok(parsed
        .into_iter()
        .map(|item| ProcessObservationOutput {
            pid: item.get("Id").and_then(|value| value.as_u64()).unwrap_or_default() as u32,
            process_name: item.get("ProcessName").and_then(|value| value.as_str()).unwrap_or("").to_string(),
            window_title: item.get("MainWindowTitle").and_then(|value| value.as_str()).map(|value| value.to_string()),
        })
        .filter(|item| !item.process_name.trim().is_empty())
        .collect())
}

#[tauri::command]
fn focus_window_by_title(input: FocusWindowInput) -> Result<(), String> {
    if input.title.trim().is_empty() {
        return Err("Window title is required.".into());
    }
    let script = format!(
        r#"
$signature = @"
using System;
using System.Runtime.InteropServices;
public static class Win32 {{
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}}
"@
Add-Type -TypeDefinition $signature -ErrorAction Stop
$process = Get-Process | Where-Object {{ $_.MainWindowTitle -like "*{0}*" }} | Select-Object -First 1
if (-not $process) {{ throw "Window not found." }}
[void][Win32]::SetForegroundWindow($process.MainWindowHandle)
"#,
        escape_powershell_string(input.title.trim())
    );
    run_powershell_script(&script).map(|_| ())
}

#[tauri::command]
fn is_tcp_port_listening(input: PortProbeInput) -> Result<bool, String> {
    let script = format!(
        "Get-NetTCPConnection -State Listen -LocalPort {} -ErrorAction SilentlyContinue | Select-Object -First 1 | ConvertTo-Json -Compress",
        input.port
    );
    let output = run_powershell_script(&script)?;
    Ok(!output.trim().is_empty() && output.trim() != "null")
}

#[tauri::command]
fn read_file_probe(input: FileProbeInput) -> Result<FileProbeOutput, String> {
    let path = PathBuf::from(input.path.trim());
    if !path.exists() {
        return Ok(FileProbeOutput {
            exists: false,
            content_excerpt: None,
        });
    }
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut buffer = vec![0_u8; input.max_bytes.unwrap_or(1_000).clamp(64, 20_000)];
    let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
    buffer.truncate(read);
    Ok(FileProbeOutput {
        exists: true,
        content_excerpt: Some(String::from_utf8_lossy(&buffer).to_string()),
    })
}

#[tauri::command]
fn stat_paths(input: StatPathsInput) -> Result<Vec<StatPathOutput>, String> {
    Ok(input
        .paths
        .into_iter()
        .map(|raw| {
            let path = PathBuf::from(raw.trim());
            match fs::metadata(&path) {
                Ok(metadata) => StatPathOutput {
                    path: path.to_string_lossy().to_string(),
                    exists: true,
                    size: Some(metadata.len()),
                    modified_at: metadata
                        .modified()
                        .ok()
                        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|duration| duration.as_secs().to_string()),
                },
                Err(_) => StatPathOutput {
                    path: path.to_string_lossy().to_string(),
                    exists: false,
                    size: None,
                    modified_at: None,
                },
            }
        })
        .collect())
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
    let transcript_file = whisper_output_text_path(&output_base);
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
        let detail = if stderr.is_empty() {
            format!(
                "Expected transcript file: {}",
                transcript_file.to_string_lossy()
            )
        } else {
            format!(
                "Expected transcript file: {}. Whisper stderr: {}",
                transcript_file.to_string_lossy(),
                truncate_for_ui(&stderr)
            )
        };
        return Err(format!(
            "Local Whisper completed but did not produce transcript text. {detail}"
        ));
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
    for path in [audio_path.to_path_buf(), whisper_output_text_path(output_base)] {
        if path.exists() {
            fs::remove_file(path).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn whisper_output_text_path(output_base: &Path) -> PathBuf {
    PathBuf::from(format!("{}.txt", output_base.to_string_lossy()))
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

fn redact_provider_error(value: &str) -> String {
    if value.trim().is_empty() {
        return "Provider returned an empty error body.".into();
    }
    truncate_for_ui(value)
        .replace("Authorization", "authorization")
        .replace("Bearer", "bearer")
        .replace("api_key", "api key")
        .replace("client_secret", "client secret")
}

fn browser_sessions() -> &'static Mutex<HashMap<String, BrowserSessionState>> {
    BROWSER_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn sanitize_browser_session_id(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Browser session id is required.".into());
    }
    let cleaned: String = trimmed
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .collect();
    if cleaned.is_empty() {
        return Err("Browser session id must contain letters, numbers, dashes, or underscores.".into());
    }
    Ok(cleaned)
}

fn browser_window_label(session_id: &str) -> String {
    format!("browser-{}", session_id)
}

fn validate_browser_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("Browser automation only allows http and https URLs.".into());
    }
    Ok(trimmed.to_string())
}

fn validate_browser_selector(selector: &str) -> Result<(), String> {
    if selector.trim().is_empty() {
        return Err("Browser selector is required.".into());
    }
    if selector.len() > 400 {
        return Err("Browser selector is too long.".into());
    }
    Ok(())
}

fn get_browser_session(session_id: &str) -> Result<BrowserSessionState, String> {
    let cleaned = sanitize_browser_session_id(session_id)?;
    browser_sessions()
        .lock()
        .map_err(|_| "Browser session registry is unavailable.".to_string())?
        .get(&cleaned)
        .cloned()
        .ok_or_else(|| "Browser session not found.".to_string())
}

fn build_browser_state(
    session_id: &str,
    url: &str,
    selector: Option<&str>,
) -> Result<BrowserStateOutput, String> {
    let html = fetch_url_html(url)?;
    let title = extract_html_title(&html);
    let visible_text = strip_html(&html);
    let excerpt = truncate_for_ui(&visible_text);
    let selector_found = selector.map(|needle| html.contains(needle));
    Ok(BrowserStateOutput {
        session_id: Some(session_id.to_string()),
        url: Some(url.to_string()),
        title,
        visible_text: Some(visible_text),
        selector_found,
        content_excerpt: Some(excerpt),
    })
}

fn fetch_url_html(url: &str) -> Result<String, String> {
    let script = format!(
        r#"$response = Invoke-WebRequest -UseBasicParsing -Uri "{0}" -ErrorAction Stop; $response.Content"#,
        escape_powershell_string(url)
    );
    run_powershell_script(&script)
}

fn extract_html_title(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let start = lower.find("<title>")?;
    let end = lower[start + 7..].find("</title>")?;
    Some(html[start + 7..start + 7 + end].trim().to_string())
}

fn strip_html(html: &str) -> String {
    let mut text = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                text.push(' ');
            }
            _ if !in_tag => text.push(ch),
            _ => {}
        }
    }
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn run_powershell_script(script: &str) -> Result<String, String> {
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("Unable to start PowerShell: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn parse_json_array(value: &str) -> Result<Vec<serde_json::Value>, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed == "null" {
        return Ok(Vec::new());
    }
    if trimmed.starts_with('[') {
        serde_json::from_str(trimmed).map_err(|error| error.to_string())
    } else {
        let single: serde_json::Value = serde_json::from_str(trimmed).map_err(|error| error.to_string())?;
        Ok(vec![single])
    }
}

fn escape_powershell_string(value: &str) -> String {
    value.replace('`', "``").replace('"', "`\"")
}

fn resolve_wake_listener_script(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let resource_path = app
        .path()
        .resolve("sidecar/wake_listener.py", tauri::path::BaseDirectory::Resource)
        .ok();
    if let Some(path) = resource_path {
        if path.is_file() {
            return Ok(path);
        }
    }

    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("sidecar")
        .join("wake_listener.py");
    if dev_path.is_file() {
        return Ok(dev_path);
    }

    Err("Unable to find sidecar/wake_listener.py. Rebuild Klak or check the sidecar files.".into())
}

fn resolve_wake_listener_python(configured: &str) -> String {
    let dev_python = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("sidecar")
        .join(".venv")
        .join("Scripts")
        .join("python.exe");

    let should_use_dev_python = configured.is_empty()
        || configured.eq_ignore_ascii_case("python")
        || configured.eq_ignore_ascii_case("python.exe");

    if should_use_dev_python && dev_python.is_file() {
        return dev_python
            .canonicalize()
            .unwrap_or(dev_python)
            .to_string_lossy()
            .to_string();
    }

    configured.to_string()
}

fn pipe_wake_listener_stdout<R: Read + Send + 'static>(app: tauri::AppHandle, reader: R) {
    thread::spawn(move || {
        let buffered = BufReader::new(reader);
        for line in buffered.lines().map_while(Result::ok) {
            handle_wake_listener_event(&app, &line);
        }
    });
}

fn pipe_wake_listener_stderr<R: Read + Send + 'static>(reader: R) {
    thread::spawn(move || {
        let buffered = BufReader::new(reader);
        for line in buffered.lines().map_while(Result::ok) {
            eprintln!("wake-listener: {line}");
        }
    });
}

fn handle_wake_listener_event(app: &tauri::AppHandle, line: &str) {
    let parsed: serde_json::Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("wake-listener: ignored malformed json ({error})");
            return;
        }
    };

    let event = parsed
        .get("event")
        .and_then(|value| value.as_str())
        .unwrap_or("unknown");

    match event {
        "model_check" => {
            eprintln!("wake-listener: model check {line}");
            let _ = app.emit_to("main", "klak-wake-diagnostics", parsed);
        }
        "ready" => {
            eprintln!("wake-listener: ready {line}");
            let _ = app.emit_to("main", "klak-wake-listener-status", parsed);
        }
        "audio_device" => {
            if let Some(name) = parsed.get("device_name").and_then(|value| value.as_str()) {
                if let Ok(mut registry) = wake_listener_registry().lock() {
                    registry.selected_microphone = Some(name.to_string());
                }
            }
            eprintln!("wake-listener: audio device {line}");
            let _ = app.emit_to("main", "klak-wake-diagnostics", parsed);
        }
        "audio_level" | "wake_score" => {
            let _ = app.emit_to("main", "klak-wake-diagnostics", parsed);
        }
        "wake" => {
            let score = parsed
                .get("score")
                .and_then(|value| value.as_f64())
                .unwrap_or_default();
            eprintln!("wake-listener: wake detected score={score:.4}");
            let _ = app.emit_to("main", "klak-wake-detected", parsed.clone());
            show_voice_caption(app, "Wake word detected - opening voice session");
            start_voice_session(app);
        }
        "warning" => {
            eprintln!("wake-listener: warning {line}");
            let _ = app.emit_to("main", "klak-wake-diagnostics", parsed);
        }
        "error" => {
            let message = parsed
                .get("message")
                .and_then(|value| value.as_str())
                .unwrap_or("Wake listener error.")
                .to_string();
            if let Ok(mut registry) = wake_listener_registry().lock() {
                registry.state = WakeListenerState::Failed;
                registry.latest_error = Some(message.clone());
            }
            eprintln!("wake-listener: error {line}");
            let _ = app.emit_to("main", "klak-wake-listener-error", parsed);
        }
        "stopped" => {
            if let Ok(mut registry) = wake_listener_registry().lock() {
                registry.state = WakeListenerState::Stopped;
                registry.child = None;
                registry.config_signature = None;
            }
            eprintln!("wake-listener: stopped {line}");
            let _ = app.emit_to("main", "klak-wake-diagnostics", parsed);
        }
        other => {
            eprintln!("wake-listener: ignored event {other}");
        }
    }
}

fn summon_klak_window(app: &tauri::AppHandle) {
    pulse_glow(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = app.emit_to("main", "klak-summoned", ());
    }
}

fn start_voice_session(app: &tauri::AppHandle) {
    pulse_glow(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    show_voice_caption(app, "I'm listening...");
    let _ = app.emit_to("main", "klak-summoned", ());
}

fn pulse_glow(app: &tauri::AppHandle) {
    let Some(glow) = app.get_webview_window(GLOW_WINDOW_LABEL) else {
        return;
    };

    if let Ok(Some(monitor)) = glow.primary_monitor() {
        let scale_factor = monitor.scale_factor();
        let size = monitor.size();
        let position = monitor.position();
        let _ = glow.set_position(LogicalPosition::new(
            position.x as f64 / scale_factor,
            position.y as f64 / scale_factor,
        ));
        let _ = glow.set_size(LogicalSize::new(
            size.width as f64 / scale_factor,
            size.height as f64 / scale_factor,
        ));
    }

    let _ = glow.set_ignore_cursor_events(true);
    let _ = glow.set_always_on_top(true);
    let _ = glow.show();
    let _ = glow.emit("klak-glow-pulse", ());

    let app_handle = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(1350));
        if let Some(glow) = app_handle.get_webview_window(GLOW_WINDOW_LABEL) {
            let _ = glow.hide();
        }
    });
}

fn show_voice_caption(app: &tauri::AppHandle, text: &str) {
    let Some(caption) = app.get_webview_window(CAPTION_WINDOW_LABEL) else {
        return;
    };

    if let Ok(Some(monitor)) = caption.primary_monitor() {
        let scale_factor = monitor.scale_factor();
        let size = monitor.size();
        let position = monitor.position();
        let width = 720.0;
        let height = 96.0;
        let x = position.x as f64 / scale_factor + (size.width as f64 / scale_factor - width) / 2.0;
        let y = position.y as f64 / scale_factor + (size.height as f64 / scale_factor - height) - 72.0;
        let _ = caption.set_position(LogicalPosition::new(x, y));
        let _ = caption.set_size(LogicalSize::new(width, height));
    }

    let _ = caption.set_ignore_cursor_events(true);
    let _ = caption.set_always_on_top(true);
    let _ = caption.show();
    let _ = caption.emit("klak-caption-update", text.to_string());

    let app_handle = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(12));
        if let Some(caption) = app_handle.get_webview_window(CAPTION_WINDOW_LABEL) {
            let _ = caption.hide();
        }
    });
}

fn build_glow_window(app: &mut tauri::App) -> tauri::Result<()> {
    let glow = WebviewWindowBuilder::new(
        app,
        GLOW_WINDOW_LABEL,
        WebviewUrl::App("index.html?surface=glow".into()),
    )
    .title("Klak Glow")
    .transparent(true)
    .decorations(false)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focusable(false)
    .resizable(false)
    .visible(false)
    .inner_size(1280.0, 720.0)
    .build()?;
    let _ = glow.set_ignore_cursor_events(true);
    Ok(())
}

fn build_caption_window(app: &mut tauri::App) -> tauri::Result<()> {
    let caption = WebviewWindowBuilder::new(
        app,
        CAPTION_WINDOW_LABEL,
        WebviewUrl::App("index.html?surface=caption".into()),
    )
    .title("Klak Voice")
    .transparent(true)
    .decorations(false)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focusable(false)
    .resizable(false)
    .visible(false)
    .inner_size(720.0, 96.0)
    .build()?;
    let _ = caption.set_ignore_cursor_events(true);
    Ok(())
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
            create_realtime_session,
            create_markdown_note,
            copy_text_to_clipboard,
            launch_registered_app,
            validate_registered_app_path,
            scan_installed_apps,
            register_discovered_apps,
            run_command_template,
            start_background_process,
            stop_background_process,
            get_background_process_status,
            read_background_process_output,
            browser_open_session,
            browser_navigate_session,
            browser_click_selector,
            browser_type_selector,
            browser_select_option,
            browser_wait_for,
            browser_read_state,
            browser_close_session,
            list_open_windows,
            list_visible_processes,
            focus_window_by_title,
            is_tcp_port_listening,
            read_file_probe,
            stat_paths,
            save_temp_voice_audio,
            validate_whisper_setup,
            transcribe_audio_with_whisper,
            summon_klak,
            update_voice_caption,
            start_wake_listener,
            stop_wake_listener,
            get_wake_listener_status,
            list_wake_audio_devices
        ])
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            build_glow_window(app)?;
            build_caption_window(app)?;
            let show = MenuItem::with_id(app, "show", "Show Klak", true, None::<&str>)?;
            let summon = MenuItem::with_id(app, "summon", "Talk to Klak", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&summon, &show, &quit])?;

            let _tray = TrayIconBuilder::new()
                .icon(tauri::include_image!("icons/32x32.png").clone())
                .tooltip("Klak - say hey jarvis or click to talk")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "summon" => start_voice_session(app),
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        if let Ok(mut registry) = wake_listener_registry().lock() {
                            stop_wake_listener_child(&mut registry);
                        }
                        app.exit(0);
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
                        start_voice_session(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Klak")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Ok(mut registry) = wake_listener_registry().lock() {
                    stop_wake_listener_child(&mut registry);
                }
            }
        });
}
