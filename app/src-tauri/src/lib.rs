//! Chromalith desktop shell. The app itself lives in the web front end; this side only adds the
//! self-update: look up the latest GitHub release, download its installer, verify it, start it.
use sha2::{Digest, Sha256};
use tauri_plugin_http::reqwest;

const LATEST: &str = "https://api.github.com/repos/LX-S93/chromalith/releases/latest";
/// Installers are only ever taken from this project's own release downloads.
const DOWNLOADS: &str = "https://github.com/LX-S93/chromalith/releases/download/";

fn client(timeout_s: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("Chromalith/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(timeout_s))
        .build()
        .map_err(|e| e.to_string())
}

/// Returns the JSON description of the latest published release.
#[tauri::command]
async fn latest_release() -> Result<String, String> {
    let r = client(15)?
        .get(LATEST)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(format!("HTTP {}", r.status().as_u16()));
    }
    r.text().await.map_err(|e| e.to_string())
}

/// Checks that a download address is one of our own installers and returns its file name.
fn installer_name(url: &str) -> Option<&str> {
    let rest = url.strip_prefix(DOWNLOADS)?;
    let (tag, name) = rest.split_once('/')?;
    let plain = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_');
    (plain(tag) && plain(name) && name.starts_with("Chromalith-") && name.ends_with("-Setup.exe")).then_some(name)
}

/// Downloads the installer, checks size and SHA-256, starts it and quits so it can replace the program.
#[tauri::command]
async fn install_update(app: tauri::AppHandle, url: String, size: u64, sha256: Option<String>) -> Result<(), String> {
    let name = installer_name(&url).ok_or("bad-url")?.to_string();
    let r = client(900)?.get(&url).send().await.map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(format!("HTTP {}", r.status().as_u16()));
    }
    let bytes = r.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() as u64 != size {
        return Err("checksum".into());
    }
    if let Some(want) = sha256 {
        let got: String = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
        if !got.eq_ignore_ascii_case(want.trim()) {
            return Err("checksum".into());
        }
    }
    let dir = std::env::temp_dir().join("chromalith-update");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(name);
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    start_installer(&app, &path)
}

#[cfg(windows)]
fn start_installer(app: &tauri::AppHandle, path: &std::path::Path) -> Result<(), String> {
    // /P: only a progress bar, /R: start Chromalith again afterwards, /UPDATE: keep settings and shortcuts
    std::process::Command::new(path).args(["/P", "/R", "/UPDATE"]).spawn().map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}

#[cfg(not(windows))]
fn start_installer(_app: &tauri::AppHandle, _path: &std::path::Path) -> Result<(), String> {
    Err("windows-only".into())
}

/// Opens one of the project's own pages in the default browser (fixed addresses only).
#[tauri::command]
fn open_page(page: String) -> Result<(), String> {
    let url = match page.as_str() {
        "support" => "https://buymeacoffee.com/lxs93",
        "project" => "https://github.com/LX-S93/chromalith",
        _ => return Err("unknown page".into()),
    };
    #[cfg(windows)]
    let r = std::process::Command::new("cmd").args(["/C", "start", "", url]).spawn();
    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("open").arg(url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let r = std::process::Command::new("xdg-open").arg(url).spawn();
    r.map(|_| ()).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![latest_release, install_update, open_page])
        .run(tauri::generate_context!())
        .expect("Chromalith could not be started");
}

#[cfg(test)]
mod tests {
    use super::installer_name;

    #[test]
    fn only_own_installers() {
        assert_eq!(installer_name("https://github.com/LX-S93/chromalith/releases/download/v0.16.0/Chromalith-0.16.0-Setup.exe"), Some("Chromalith-0.16.0-Setup.exe"));
        assert_eq!(installer_name("https://github.com/someone/else/releases/download/v1/Chromalith-1-Setup.exe"), None);
        assert_eq!(installer_name("https://github.com/LX-S93/chromalith/releases/download/v1/../../x/Chromalith-1-Setup.exe"), None);
        assert_eq!(installer_name("https://github.com/LX-S93/chromalith/releases/download/v1/evil.exe"), None);
    }
}
