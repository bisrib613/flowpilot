//! Replace complete JSON files without deleting the last good destination first.
use std::{fs, io::Write, path::Path};

pub fn write(file: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = file.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    let temporary = file.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut handle = fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|e| e.to_string())?;
        handle.write_all(bytes).map_err(|e| e.to_string())?;
        handle.sync_all().map_err(|e| e.to_string())?;
        drop(handle);
        #[cfg(windows)]
        {
            use windows::{core::HSTRING, Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH}};
            unsafe { MoveFileExW(&HSTRING::from(temporary.as_os_str()), &HSTRING::from(file.as_os_str()), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) }.map_err(|e| e.to_string())?;
        }
        #[cfg(not(windows))]
        fs::rename(&temporary, file).map_err(|e| e.to_string())?;
        Ok(())
    })();
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result
}
