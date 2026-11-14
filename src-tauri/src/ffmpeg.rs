use std::{
    fs::{self, File},
    io::{self, Read, Seek, SeekFrom},
    os::windows::process::CommandExt,
    path::PathBuf,
    process::Command,
    sync::Mutex,
    time::Duration,
};

use sha2::{Digest, Sha256};
use tauri::{path::BaseDirectory, AppHandle, Manager};

const VERSION: &str = "9.0.2";
const DOWNLOAD: &str = "https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip";
const SIZE: u64 = 114_768_076;
const SHA256: &str = "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba";
static INSTALL: Mutex<()> = Mutex::new(());

fn managed_binary(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve("tools/ffmpeg/bin/ffmpeg.exe", BaseDirectory::AppLocalData)
        .map_err(|err| err.to_string())
}

fn works(path: &std::path::Path) -> bool {
    Command::new(path)
        .arg("-version")
        .creation_flags(0x0800_0000)
        .output()
        .is_ok_and(|result| {
            result.status.success() && result.stdout.starts_with(b"ffmpeg version ")
        })
}

pub(crate) fn resolve(app: &AppHandle) -> Option<(PathBuf, &'static str)> {
    let managed = managed_binary(app).ok()?;
    if works(&managed) {
        return Some((managed, "managed"));
    }
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .filter(|dir| dir.is_absolute())
        .map(|dir| dir.join("ffmpeg.exe"))
        .find(|candidate| candidate.is_file() && works(candidate))
        .map(|path| (path, "path"))
}

pub(crate) fn install(app: &AppHandle) -> Result<&'static str, String> {
    let _guard = INSTALL.lock().map_err(|err| err.to_string())?;
    if let Some((_, source)) = resolve(app) {
        return Ok(source);
    }
    if !cfg!(target_arch = "x86_64") {
        return Err("The managed FFmpeg download requires Windows x64".into());
    }
    let binary = managed_binary(app)?;
    let bin = binary
        .parent()
        .ok_or("Invalid FFmpeg installation folder")?;
    fs::create_dir_all(bin).map_err(|err| err.to_string())?;
    let staging = bin.join(format!(".install-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&staging).map_err(|err| err.to_string())?;
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        let archive_path = staging.join("ffmpeg.zip");
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(600))
            .build()?;
        let response = client.get(DOWNLOAD).send()?.error_for_status()?;
        let mut archive = File::options()
            .create_new(true)
            .read(true)
            .write(true)
            .open(&archive_path)?;
        if io::copy(&mut response.take(SIZE + 1), &mut archive)? != SIZE {
            return Err("FFmpeg download size did not match the pinned release".into());
        }
        archive.seek(SeekFrom::Start(0))?;
        let mut digest = Sha256::new();
        io::copy(&mut archive, &mut digest)?;
        if format!("{:x}", digest.finalize()) != SHA256 {
            return Err("FFmpeg download checksum did not match".into());
        }
        archive.seek(SeekFrom::Start(0))?;
        let mut zip = zip::ZipArchive::new(archive)?;
        let mut entry =
            zip.by_name(&format!("ffmpeg-{VERSION}-essentials_build/bin/ffmpeg.exe"))?;
        let staged = staging.join("ffmpeg.exe");
        let mut output = File::options().create_new(true).write(true).open(&staged)?;
        io::copy(&mut entry, &mut output)?;
        output.sync_all()?;
        drop(output);
        if !works(&staged) {
            return Err("The downloaded FFmpeg could not start".into());
        }
        if binary.exists() {
            if works(&binary) {
                return Ok(());
            }
            fs::remove_file(&binary)?;
        }
        fs::rename(staged, binary)?;
        Ok(())
    })();
    let _ = fs::remove_dir_all(staging);
    result.map_err(|err| err.to_string())?;
    Ok("managed")
}
