use crate::error::CmdResult;

#[cfg(windows)]
pub fn apply_window_app_id(window: &tauri::WebviewWindow, app_id: &str) -> CmdResult<()> {
    use windows::core::PROPVARIANT;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID;
    use windows::Win32::UI::Shell::PropertiesSystem::{
        IPropertyStore, SHGetPropertyStoreForWindow,
    };

    let hwnd = {
        let raw = window.hwnd().map_err(|e| e.to_string())?.0;
        HWND(raw)
    };
    let propvar = PROPVARIANT::from(app_id);
    let store: IPropertyStore =
        unsafe { SHGetPropertyStoreForWindow(hwnd) }.map_err(|e| e.to_string())?;
    unsafe {
        store
            .SetValue(&PKEY_AppUserModel_ID, &propvar)
            .map_err(|e| e.to_string())?;
        store.Commit().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn apply_window_app_id(_window: &tauri::WebviewWindow, _app_id: &str) -> CmdResult<()> {
    Ok(())
}
