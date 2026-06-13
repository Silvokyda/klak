use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

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
            copy_text_to_clipboard
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
