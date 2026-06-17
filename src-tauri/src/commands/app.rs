// App-level commands: init and data-root discovery.
//
// `base_dir` resolves to the standalone Todo project directory in development
// and to the executable directory in packaged builds. AEBOX_TODO_BASE overrides
// both, with AEBOX_BASE kept as a compatibility fallback.

use std::env;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::CmdResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInitInfo {
    pub base_dir: String,
    pub has_rust_parse_exe: bool,
    pub has_parse_exe: bool,
    pub chromatix_path: Option<String>,
}

#[tauri::command]
pub fn app_init() -> CmdResult<AppInitInfo> {
    let base_dir = resolve_base_dir();

    Ok(AppInitInfo {
        base_dir: base_dir.to_string_lossy().replace('\\', "/"),
        has_rust_parse_exe: false,
        has_parse_exe: false,
        chromatix_path: None,
    })
}

pub fn resolve_base_dir() -> PathBuf {
    if let Ok(value) = env::var("AEBOX_TODO_BASE").or_else(|_| env::var("AEBOX_BASE")) {
        let path = PathBuf::from(value);
        if path.exists() {
            return path;
        }
    }

    if let Ok(cwd) = env::current_dir() {
        if cwd.join("src-tauri").is_dir() && cwd.join("src").is_dir() {
            return cwd;
        }
        if let Some(name) = cwd.file_name().and_then(|name| name.to_str()) {
            if name == "src-tauri" {
                if let Some(parent) = cwd.parent() {
                    return parent.to_path_buf();
                }
            }
        }
    }

    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() {
            return parent.to_path_buf();
        }
    }

    PathBuf::from(".")
}
