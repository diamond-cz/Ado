use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::commands::todo_settings::{self, TodoSettings};
use crate::commands::todos::{self, TodoBackupEntry};
use crate::error::CmdResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct TodoBackupManifest {
    version: u32,
    backups: Vec<TodoBackupEntry>,
    assets: Vec<TodoAssetBackupEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct TodoAssetBackupEntry {
    file_name: String,
    size: u64,
    modified_at: i64,
}

impl Default for TodoAssetBackupEntry {
    fn default() -> Self {
        Self {
            file_name: String::new(),
            size: 0,
            modified_at: 0,
        }
    }
}

impl Default for TodoBackupManifest {
    fn default() -> Self {
        Self {
            version: 1,
            backups: Vec::new(),
            assets: Vec::new(),
        }
    }
}

fn encode_webdav_segment(segment: &str) -> String {
    let mut encoded = String::new();
    for byte in segment.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(*byte as char)
            }
            _ => encoded.push_str(&format!("%{:02X}", byte)),
        }
    }
    encoded
}

fn webdav_dir_segments(path: &str) -> CmdResult<Vec<String>> {
    let mut segments = Vec::new();
    for segment in path.trim().trim_matches('/').split('/') {
        let trimmed = segment.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed == "." || trimmed == ".." {
            return Err("invalid WebDAV backup directory".to_string());
        }
        segments.push(trimmed.to_string());
    }
    if segments.is_empty() {
        segments.push("todo-backups".to_string());
    }
    Ok(segments)
}

fn webdav_url(settings: &TodoSettings, segments: &[String]) -> CmdResult<String> {
    let base = settings.web_dav_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("请先填写 WebDAV 目录地址".to_string());
    }
    let suffix = segments
        .iter()
        .map(|segment| encode_webdav_segment(segment))
        .collect::<Vec<_>>()
        .join("/");
    if suffix.is_empty() {
        Ok(base.to_string())
    } else {
        Ok(format!("{}/{}", base, suffix))
    }
}

fn todo_webdav_settings() -> CmdResult<TodoSettings> {
    let settings = todo_settings::load_todo_settings();
    if settings.web_dav_url.trim().is_empty() {
        return Err("请先填写 WebDAV 目录地址".to_string());
    }
    Ok(settings)
}

fn webdav_request(
    client: &reqwest::Client,
    settings: &TodoSettings,
    method: reqwest::Method,
    url: String,
) -> reqwest::RequestBuilder {
    let mut request = client.request(method, url);
    let username = settings.web_dav_username.trim();
    if !username.is_empty() || !settings.web_dav_password.is_empty() {
        let credential = format!("{}:{}", username, settings.web_dav_password);
        request = request.header(
            reqwest::header::AUTHORIZATION,
            format!(
                "Basic {}",
                base64::engine::general_purpose::STANDARD.encode(credential.as_bytes())
            ),
        );
    }
    request
}

fn webdav_client() -> CmdResult<reqwest::Client> {
    reqwest::Client::builder()
        .build()
        .map_err(|e| format!("create WebDAV client: {}", e))
}

async fn ensure_webdav_dir(
    client: &reqwest::Client,
    settings: &TodoSettings,
    segments: &[String],
) -> CmdResult<()> {
    let mkcol =
        reqwest::Method::from_bytes(b"MKCOL").map_err(|e| format!("MKCOL method: {}", e))?;
    let mut current = Vec::new();
    for segment in segments {
        current.push(segment.clone());
        let url = webdav_url(settings, &current)?;
        let response = webdav_request(client, settings, mkcol.clone(), url)
            .send()
            .await
            .map_err(|e| format!("create WebDAV backup dir: {}", e))?;
        let status = response.status();
        if status.is_success() || status == reqwest::StatusCode::METHOD_NOT_ALLOWED {
            continue;
        }
        return Err(format!("create WebDAV backup dir: HTTP {}", status));
    }
    Ok(())
}

async fn ensure_webdav_backup_dir(
    client: &reqwest::Client,
    settings: &TodoSettings,
) -> CmdResult<()> {
    ensure_webdav_dir(
        client,
        settings,
        &webdav_dir_segments(&settings.web_dav_path)?,
    )
    .await
}

async fn ensure_webdav_assets_dir(
    client: &reqwest::Client,
    settings: &TodoSettings,
) -> CmdResult<()> {
    ensure_webdav_dir(client, settings, &webdav_assets_dir_segments(settings)?).await
}

async fn ensure_webdav_success(response: reqwest::Response, action: &str) -> CmdResult<()> {
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    let body = response.text().await.unwrap_or_default();
    let body = body.chars().take(240).collect::<String>();
    if body.trim().is_empty() {
        Err(format!("{}: HTTP {}", action, status))
    } else {
        Err(format!("{}: HTTP {} {}", action, status, body))
    }
}

fn webdav_backup_file_segments(settings: &TodoSettings, file_name: &str) -> CmdResult<Vec<String>> {
    let mut segments = webdav_dir_segments(&settings.web_dav_path)?;
    segments.push(todos::sanitize_todo_backup_file_name(file_name)?);
    Ok(segments)
}

fn webdav_manifest_segments(settings: &TodoSettings) -> CmdResult<Vec<String>> {
    let mut segments = webdav_dir_segments(&settings.web_dav_path)?;
    segments.push("manifest.json".to_string());
    Ok(segments)
}

fn webdav_assets_dir_segments(settings: &TodoSettings) -> CmdResult<Vec<String>> {
    let mut segments = webdav_dir_segments(&settings.web_dav_path)?;
    segments.push("assets".to_string());
    Ok(segments)
}

fn is_webdav_todo_asset_extension(file_name: &str) -> bool {
    matches!(
        std::path::Path::new(file_name)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "gif" | "jpeg" | "jpg" | "png" | "webp"
    )
}

fn sanitize_webdav_todo_asset_file_name(file_name: &str) -> CmdResult<String> {
    let file_name = todos::sanitize_asset_file_name(file_name)?;
    if !is_webdav_todo_asset_extension(&file_name) {
        return Err("unsupported todo asset backup file type".to_string());
    }
    Ok(file_name)
}

fn webdav_asset_file_segments(settings: &TodoSettings, file_name: &str) -> CmdResult<Vec<String>> {
    let mut segments = webdav_assets_dir_segments(settings)?;
    segments.push(sanitize_webdav_todo_asset_file_name(file_name)?);
    Ok(segments)
}

fn system_time_to_ms(time: std::time::SystemTime) -> Option<i64> {
    time.duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
}

fn normalize_todo_backup_manifest(mut manifest: TodoBackupManifest) -> TodoBackupManifest {
    manifest.version = 1;
    manifest.backups = manifest
        .backups
        .into_iter()
        .filter_map(|mut entry| {
            let file_name = todos::sanitize_todo_backup_file_name(&entry.file_name).ok()?;
            entry.id = file_name.clone();
            entry.file_name = file_name;
            entry.source = "webdav".to_string();
            Some(entry)
        })
        .collect();
    manifest.backups.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| b.file_name.cmp(&a.file_name))
    });
    let mut assets = BTreeMap::new();
    for mut entry in manifest.assets {
        if let Ok(file_name) = sanitize_webdav_todo_asset_file_name(&entry.file_name) {
            entry.file_name = file_name.clone();
            assets.insert(file_name, entry);
        }
    }
    manifest.assets = assets.into_values().collect();
    manifest
}

async fn read_webdav_manifest(
    client: &reqwest::Client,
    settings: &TodoSettings,
) -> CmdResult<TodoBackupManifest> {
    let url = webdav_url(settings, &webdav_manifest_segments(settings)?)?;
    let response = webdav_request(client, settings, reqwest::Method::GET, url)
        .send()
        .await
        .map_err(|e| format!("read WebDAV backup manifest: {}", e))?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(TodoBackupManifest::default());
    }
    let status = response.status();
    if !status.is_success() {
        return Err(format!("read WebDAV backup manifest: HTTP {}", status));
    }
    let text = response
        .text()
        .await
        .map_err(|e| format!("read WebDAV backup manifest body: {}", e))?;
    let manifest = serde_json::from_str::<TodoBackupManifest>(&text)
        .map_err(|e| format!("parse WebDAV backup manifest: {}", e))?;
    Ok(normalize_todo_backup_manifest(manifest))
}

async fn write_webdav_manifest(
    client: &reqwest::Client,
    settings: &TodoSettings,
    manifest: &TodoBackupManifest,
) -> CmdResult<()> {
    let url = webdav_url(settings, &webdav_manifest_segments(settings)?)?;
    let json = serde_json::to_string_pretty(manifest)
        .map_err(|e| format!("serialize WebDAV backup manifest: {}", e))?;
    let response = webdav_request(client, settings, reqwest::Method::PUT, url)
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/json;charset=utf-8",
        )
        .body(json)
        .send()
        .await
        .map_err(|e| format!("write WebDAV backup manifest: {}", e))?;
    ensure_webdav_success(response, "write WebDAV backup manifest").await
}

fn list_local_webdav_todo_assets() -> CmdResult<Vec<(TodoAssetBackupEntry, PathBuf)>> {
    let dir = todos::todo_assets_dir();
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut assets = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| format!("read todo assets dir: {}", e))? {
        let path = entry
            .map_err(|e| format!("read todo asset entry: {}", e))?
            .path();
        if !path.is_file() {
            continue;
        }
        let Some(raw_file_name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let Ok(file_name) = sanitize_webdav_todo_asset_file_name(raw_file_name) else {
            continue;
        };
        let metadata =
            fs::metadata(&path).map_err(|e| format!("read todo asset metadata: {}", e))?;
        assets.push((
            TodoAssetBackupEntry {
                file_name,
                size: metadata.len(),
                modified_at: metadata
                    .modified()
                    .ok()
                    .and_then(system_time_to_ms)
                    .unwrap_or(0),
            },
            path,
        ));
    }
    assets.sort_by(|a, b| a.0.file_name.cmp(&b.0.file_name));
    Ok(assets)
}

async fn upload_todo_assets_to_webdav(
    client: &reqwest::Client,
    settings: &TodoSettings,
    existing_assets: &[TodoAssetBackupEntry],
) -> CmdResult<Vec<TodoAssetBackupEntry>> {
    let assets = list_local_webdav_todo_assets()?;
    if assets.is_empty() {
        return Ok(Vec::new());
    }

    let existing_assets = existing_assets
        .iter()
        .map(|asset| (asset.file_name.as_str(), asset.size))
        .collect::<BTreeMap<_, _>>();
    ensure_webdav_assets_dir(client, settings).await?;
    let mut uploaded = Vec::with_capacity(assets.len());
    for (asset, path) in assets {
        if existing_assets
            .get(asset.file_name.as_str())
            .is_some_and(|size| *size == asset.size)
        {
            continue;
        }
        let bytes = fs::read(&path).map_err(|e| format!("read todo asset: {}", e))?;
        let url = webdav_url(
            settings,
            &webdav_asset_file_segments(settings, &asset.file_name)?,
        )?;
        let response = webdav_request(client, settings, reqwest::Method::PUT, url)
            .header(
                reqwest::header::CONTENT_TYPE,
                todos::todo_asset_mime_type(&asset.file_name),
            )
            .body(bytes)
            .send()
            .await
            .map_err(|e| format!("upload todo asset {}: {}", asset.file_name, e))?;
        ensure_webdav_success(response, &format!("upload todo asset {}", asset.file_name)).await?;
        uploaded.push(asset);
    }
    Ok(uploaded)
}

async fn download_todo_asset_from_webdav(
    client: &reqwest::Client,
    settings: &TodoSettings,
    file_name: &str,
) -> CmdResult<Vec<u8>> {
    let file_name = sanitize_webdav_todo_asset_file_name(file_name)?;
    let url = webdav_url(settings, &webdav_asset_file_segments(settings, &file_name)?)?;
    let response = webdav_request(client, settings, reqwest::Method::GET, url)
        .send()
        .await
        .map_err(|e| format!("download todo asset {}: {}", file_name, e))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "download todo asset {}: HTTP {}",
            file_name, status
        ));
    }
    response
        .bytes()
        .await
        .map(|bytes| bytes.to_vec())
        .map_err(|e| format!("read todo asset {} body: {}", file_name, e))
}

async fn sync_todo_assets_from_webdav(
    client: &reqwest::Client,
    settings: &TodoSettings,
    assets: &[TodoAssetBackupEntry],
) -> CmdResult<()> {
    if assets.is_empty() {
        return Ok(());
    }

    let dir = todos::todo_assets_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir todo assets dir: {}", e))?;
    for asset in assets {
        let file_name = sanitize_webdav_todo_asset_file_name(&asset.file_name)?;
        let path = dir.join(&file_name);
        if path
            .metadata()
            .map(|metadata| metadata.is_file() && metadata.len() == asset.size)
            .unwrap_or(false)
        {
            continue;
        }
        let bytes = download_todo_asset_from_webdav(client, settings, &file_name).await?;
        fs::write(&path, bytes).map_err(|e| format!("write todo asset {}: {}", file_name, e))?;
    }
    Ok(())
}

async fn upload_todo_backup_to_webdav(entry: &TodoBackupEntry) -> CmdResult<TodoBackupEntry> {
    let settings = todo_webdav_settings()?;
    let client = webdav_client()?;
    ensure_webdav_backup_dir(&client, &settings).await?;

    let file_name = todos::sanitize_todo_backup_file_name(&entry.file_name)?;
    let local_path = todos::todo_backup_path(&file_name)?;
    let bytes = fs::read(&local_path).map_err(|e| format!("read todo sqlite backup: {}", e))?;
    let url = webdav_url(
        &settings,
        &webdav_backup_file_segments(&settings, &file_name)?,
    )?;
    let response = webdav_request(&client, &settings, reqwest::Method::PUT, url)
        .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
        .body(bytes)
        .send()
        .await
        .map_err(|e| format!("upload todo sqlite backup: {}", e))?;
    ensure_webdav_success(response, "upload todo sqlite backup").await?;

    let mut remote_entry = entry.clone();
    remote_entry.source = "webdav".to_string();
    let mut manifest = read_webdav_manifest(&client, &settings).await?;
    let uploaded_assets =
        upload_todo_assets_to_webdav(&client, &settings, &manifest.assets).await?;
    manifest
        .backups
        .retain(|backup| backup.file_name != remote_entry.file_name);
    manifest.backups.push(remote_entry.clone());
    let mut asset_map = manifest
        .assets
        .into_iter()
        .map(|asset| (asset.file_name.clone(), asset))
        .collect::<BTreeMap<_, _>>();
    for asset in uploaded_assets {
        asset_map.insert(asset.file_name.clone(), asset);
    }
    manifest.assets = asset_map.into_values().collect();
    let manifest = normalize_todo_backup_manifest(manifest);
    write_webdav_manifest(&client, &settings, &manifest).await?;
    Ok(remote_entry)
}

async fn download_todo_backup_from_webdav(
    client: &reqwest::Client,
    settings: &TodoSettings,
    file_name: &str,
) -> CmdResult<Vec<u8>> {
    let file_name = todos::sanitize_todo_backup_file_name(file_name)?;
    let url = webdav_url(
        settings,
        &webdav_backup_file_segments(settings, &file_name)?,
    )?;
    let response = webdav_request(client, settings, reqwest::Method::GET, url)
        .send()
        .await
        .map_err(|e| format!("download todo sqlite backup: {}", e))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("download todo sqlite backup: HTTP {}", status));
    }
    response
        .bytes()
        .await
        .map(|bytes| bytes.to_vec())
        .map_err(|e| format!("read todo sqlite backup body: {}", e))
}

async fn save_webdav_backup_locally(
    client: &reqwest::Client,
    settings: &TodoSettings,
    file_name: &str,
) -> CmdResult<PathBuf> {
    let file_name = todos::sanitize_todo_backup_file_name(file_name)?;
    let bytes = download_todo_backup_from_webdav(client, settings, &file_name).await?;
    let path = todos::todo_backup_path(&file_name)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir todo backup dir: {}", e))?;
    }
    fs::write(&path, bytes).map_err(|e| format!("write downloaded todo sqlite backup: {}", e))?;
    Ok(path)
}

async fn delete_webdav_backup_file(
    client: &reqwest::Client,
    settings: &TodoSettings,
    file_name: &str,
) -> CmdResult<()> {
    let file_name = todos::sanitize_todo_backup_file_name(file_name)?;
    let url = webdav_url(
        settings,
        &webdav_backup_file_segments(settings, &file_name)?,
    )?;
    let response = webdav_request(client, settings, reqwest::Method::DELETE, url)
        .send()
        .await
        .map_err(|e| format!("delete WebDAV backup file: {}", e))?;
    if response.status().is_success() || response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(());
    }
    ensure_webdav_success(response, "delete WebDAV backup file").await
}

#[tauri::command]
pub async fn backup_todo_db_to_webdav() -> CmdResult<TodoBackupEntry> {
    let entry = todos::create_local_todo_db_backup().await?;
    upload_todo_backup_to_webdav(&entry).await
}

#[tauri::command]
pub async fn list_todo_webdav_backups() -> CmdResult<Vec<TodoBackupEntry>> {
    let settings = todo_webdav_settings()?;
    let client = webdav_client()?;
    Ok(read_webdav_manifest(&client, &settings).await?.backups)
}

#[tauri::command]
pub async fn sync_todo_db_backups_from_webdav() -> CmdResult<Vec<TodoBackupEntry>> {
    let settings = todo_webdav_settings()?;
    let client = webdav_client()?;
    let manifest = read_webdav_manifest(&client, &settings).await?;
    for entry in &manifest.backups {
        let path = todos::todo_backup_path(&entry.file_name)?;
        if !path.is_file() {
            save_webdav_backup_locally(&client, &settings, &entry.file_name).await?;
        }
    }
    sync_todo_assets_from_webdav(&client, &settings, &manifest.assets).await?;
    todos::list_todo_db_backups_inner()
}

#[tauri::command]
pub async fn restore_todo_db_backup_from_webdav(file_name: String) -> CmdResult<()> {
    let settings = todo_webdav_settings()?;
    let client = webdav_client()?;
    let manifest = read_webdav_manifest(&client, &settings).await?;
    let path = save_webdav_backup_locally(&client, &settings, &file_name).await?;
    sync_todo_assets_from_webdav(&client, &settings, &manifest.assets).await?;
    todos::restore_todo_db_snapshot(&path).await
}

#[tauri::command]
pub async fn delete_todo_webdav_backup(file_name: String) -> CmdResult<Vec<TodoBackupEntry>> {
    let settings = todo_webdav_settings()?;
    let client = webdav_client()?;
    let file_name = todos::sanitize_todo_backup_file_name(&file_name)?;
    let mut manifest = read_webdav_manifest(&client, &settings).await?;

    delete_webdav_backup_file(&client, &settings, &file_name).await?;
    manifest
        .backups
        .retain(|entry| entry.file_name != file_name);
    let manifest = normalize_todo_backup_manifest(manifest);
    write_webdav_manifest(&client, &settings, &manifest).await?;
    Ok(manifest.backups)
}
