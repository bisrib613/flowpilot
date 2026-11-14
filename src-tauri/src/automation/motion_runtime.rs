#![cfg(windows)]
use std::{
    fs, io,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
};

use serde_json::{json, Value};
use tauri::AppHandle;
use uuid::Uuid;

use super::{
    browser::{failed, local_file, Browser},
    flow::{FlowReference, FlowVideo, FlowVideoRequest},
    motion_control::{self, MotionControlRequest, MotionMedia},
    AutomationError,
};

// Omni 1.1 Flash cost in the Armagic reference. Recheck if Flow changes pricing.
const CLIP_CREDITS: u64 = 15;
const FLOW: &[&str] = &["flow.google.com"];

fn script(action: &str, value: Value) -> String {
    format!(
        "({})({}, {})",
        include_str!("flow.js"),
        json!(action),
        value
    )
}

fn wait_stage(browser: &Browser, action: &str, value: Value, timeout: u64) -> Result<Value, AutomationError> {
    browser.wait(&script(action, value), timeout).map_err(|error| match error {
        AutomationError::Failed(message) => failed(format!("Flow step {action}: {message}")),
        other => other,
    })
}

fn step(browser: &Browser, action: &str, value: Value) -> Result<(), AutomationError> {
    wait_stage(browser, action, value, 30).map(|_| ())
}

struct FlowSession<'a> {
    app: &'a AppHandle,
    folder: &'a Path,
}

impl FlowVideo for FlowSession<'_> {
    fn generate_video(
        &mut self,
        request: FlowVideoRequest<'_>,
    ) -> Result<PathBuf, AutomationError> {
        let browser = Browser::open(
            self.app,
            "flow",
            request.profile_id,
            "https://flow.google.com/",
            FLOW,
        )?;
        browser.wait_for_navigation()?;
        let session = wait_stage(&browser, "session", Value::Null, 45)?;
        if session.as_str() == Some("login-required") {
            return Err(AutomationError::LoginRequired);
        }
        step(&browser, "openCredits", Value::Null)?;
        let remaining = browser
            .wait(&script("credits", Value::Null), 15)
            .and_then(|balance| {
                balance
                    .as_u64()
                    .ok_or_else(|| failed("Flow credit balance could not be read"))
            })
            .map_err(|error| {
                failed(format!(
                    "Could not verify credits for the current Flow profile: {error:?}"
                ))
            })?;
        if remaining < CLIP_CREDITS {
            return Err(AutomationError::InsufficientCredits {
                remaining,
                required: CLIP_CREDITS,
            });
        }
        step(&browser, "closeCredits", Value::Null)?;
        step(&browser, "creditsClosed", Value::Null)?;
        step(&browser, "project", Value::Null)?;
        step(&browser, "normalMode", Value::Null)?;
        step(&browser, "normalReady", Value::Null)?;
        step(&browser, "focus", Value::Null)?;
        step(&browser, "settings", Value::Null)?;
        step(&browser, "mode", json!("videocam"))?;
        step(&browser, "mode", json!("chrome_extension"))?;
        step(
            &browser,
            "mode",
            json!(if request.aspect_ratio == "9:16" {
                "crop_9_16"
            } else {
                "crop_16_9"
            }),
        )?;
        step(&browser, "modelMenu", json!(request.model))?;
        step(&browser, "model", json!(request.model))?;
        for (action, target) in [("duration", 10), ("outputCount", 1)] {
            if let Err(error) = step(&browser, action, json!(target)) {
                return Err(match error {
                    AutomationError::Failed(message) => {
                        let options = browser.eval(&script("toggleOptions", Value::Null))
                            .unwrap_or(Value::Null);
                        failed(format!("{message}; available options: {options}"))
                    }
                    other => other,
                });
            }
        }
        step(&browser, "closeSettings", Value::Null)?;
        let mut assets = [None, None];
        for reference in request.references {
            let (index, kind, path) = match reference {
                FlowReference::MotionVideo(path) => (0, "video", path),
                FlowReference::Image(path) => (1, "image", path),
            };
            let name = path.file_stem().and_then(|name| name.to_str()).ok_or(
                AutomationError::InvalidInput("Reference filename is invalid"),
            )?;
            let filename = path.file_name().and_then(|value| value.to_str())
                .ok_or(AutomationError::InvalidInput("Reference filename is invalid"))?;
            let aliases = [filename, name];
            browser.upload_from_chooser(path, || {
                step(&browser, "add", Value::Null)?;
                let point = wait_stage(&browser, "uploadTarget", Value::Null, 20)?;
                browser.click_at(&point)
            })?;
            let asset = wait_stage(&browser, "asset", json!({"names": aliases, "kind": kind}), 60).map_err(|error| match error {
                AutomationError::Failed(message) => failed(format!("{message} ({name})")),
                other => other,
            })?;
            if asset.as_str() == Some("consent-required") {
                return Err(failed("Open the selected Flow profile and approve Google's upload consent before retrying Motion Control"));
            }
            let display_name = asset.as_str().ok_or_else(|| failed("Flow did not identify the uploaded reference"))?;
            assets[index] = Some((display_name.to_owned(), aliases));
        }
        browser.eval(&script("beforeSubmit", Value::Null))?;
        let mut mention_counts = [0, 0];
        step(&browser, "focus", Value::Null)?;
        for part in super::motion_prompt::parts(request.prompt) {
            let index = match part {
                super::motion_prompt::Part::Text(text) => {
                    browser.insert_text(text)?;
                    continue;
                }
                super::motion_prompt::Part::Video => 0,
                super::motion_prompt::Part::Image => 1,
            };
            let (_display_name, aliases) = assets[index].as_ref().ok_or_else(|| failed("Motion reference missing"))?;
            browser.insert_text("@")?;
            step(&browser, "mentionSearch", Value::Null)?;
            browser.insert_text(aliases[1])?;
            step(&browser, "mentionSelect", json!(aliases))?;
            mention_counts[index] += 1;
            step(&browser, "mentionAttached", json!({"names": aliases, "count": mention_counts[index]}))?;
            step(&browser, "focus", Value::Null)?;
        }
        let expected = assets.iter().zip(mention_counts).filter_map(|(asset, count)| {
            asset.as_ref().filter(|_| count > 0).map(|(_, aliases)| json!({"names": aliases, "count": count}))
        }).collect::<Vec<_>>();
        step(&browser, "verifyMentions", json!(expected))?;
        step(&browser, "submitReady", Value::Null)?;
        browser
            .enter()
            .map_err(|_| AutomationError::SubmissionUnconfirmed)?;
        let result = browser
            .wait(&script("result", Value::Null), 600)
            .map_err(|_| AutomationError::SubmissionUnconfirmed)?;
        let url = result
            .as_str()
            .ok_or_else(|| failed("Google Flow reported a generation error"))?;
        let target = self.folder.join(format!("clip-{}.mp4", Uuid::new_v4()));
        let client = reqwest::blocking::Client::builder()
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                let url = attempt.url();
                if attempt.previous().len() >= 5 {
                    attempt.error("Too many redirects while downloading the Flow result")
                } else if url.scheme() == "https" && url.host_str().is_some_and(|host|
                    host == "flow-content.google" || host == "storage.googleapis.com" || host.ends_with(".googlevideo.com")
                ) {
                    attempt.follow()
                } else {
                    attempt.error("Unexpected Flow download destination")
                }
            }))
            .timeout(std::time::Duration::from_secs(180))
            .build()
            .map_err(failed)?;
        let mut response = client
            .get(url)
            .header(reqwest::header::REFERER, "https://flow.google.com/")
            .send()
            .and_then(reqwest::blocking::Response::error_for_status)
            .map_err(failed)?;
        let mime = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("");
        if !mime.starts_with("video/") && mime != "application/octet-stream" {
            return Err(failed("Flow response was not a video"));
        }
        let mut output = fs::File::create(&target).map_err(failed)?;
        if io::copy(&mut response, &mut output).map_err(failed)? == 0 {
            return Err(failed("Flow returned an empty video"));
        }
        Ok(target)
    }
}

struct Ffmpeg<'a>(&'a Path, PathBuf, Uuid);

impl Ffmpeg<'_> {
    fn run(&self, args: &[&str]) -> Result<(), AutomationError> {
        let result = Command::new(&self.1)
            .args(["-nostdin", "-hide_banner", "-loglevel", "error"])
            .args(args)
            .current_dir(self.0)
            .creation_flags(0x0800_0000)
            .output()
            .map_err(|err| {
                if err.kind() == io::ErrorKind::NotFound {
                    AutomationError::DependencyMissing("FFmpeg")
                } else {
                    failed(err)
                }
            })?;
        if !result.status.success() {
            return Err(failed(String::from_utf8_lossy(&result.stderr)));
        }
        Ok(())
    }
}

fn filename(path: &Path) -> Result<&str, AutomationError> {
    path.to_str()
        .ok_or(AutomationError::InvalidInput("Invalid file path"))
}

impl MotionMedia for Ffmpeg<'_> {
    fn prepare(&mut self, video: &Path, _: &str) -> Result<Vec<PathBuf>, AutomationError> {
        self.run(&["-version"])?;
        let pattern = format!("motion-{}-%05d.mp4", self.2.simple());
        self.run(&[
            "-i",
            filename(video)?,
            "-map",
            "0:v:0",
            "-an",
            "-vf",
            "fps=30",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-flags",
            "+cgop",
            "-forced-idr",
            "1",
            "-bf",
            "0",
            "-force_key_frames",
            "expr:gte(t,n_forced*10)",
            "-f",
            "segment",
            "-segment_time",
            "10",
            "-segment_list",
            "reference-segments.csv",
            "-reset_timestamps",
            "1",
            &pattern,
        ])?;
        let mut clips = Vec::new();
        for entry in fs::read_dir(self.0).map_err(failed)? {
            let path = entry.map_err(failed)?.path();
            if path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("motion-") && name.ends_with(".mp4"))
            {
                clips.push(path);
            }
        }
        clips.sort();
        Ok(clips)
    }

    fn finish(
        &mut self,
        clips: &[PathBuf],
        audio: Option<&Path>,
        output: &Path,
    ) -> Result<(), AutomationError> {
        let segment_list = fs::read_to_string(self.0.join("reference-segments.csv")).map_err(failed)?;
        let durations = segment_list.lines().enumerate().map(|(index, line)| {
            let (name, timestamps) = line.split_once(',').ok_or_else(|| failed("Invalid reference segment list"))?;
            let (start, end) = timestamps.split_once(',').ok_or_else(|| failed("Reference timestamps missing"))?;
            let duration = end.parse::<f64>().map_err(failed)? - start.parse::<f64>().map_err(failed)?;
            if name != format!("motion-{}-{index:05}.mp4", self.2.simple()) || !duration.is_finite() || duration <= 0.0 || duration > 10.001 {
                return Err(failed("Invalid reference segment duration or order"));
            }
            Ok(format!("{duration:.6}"))
        }).collect::<Result<Vec<_>, _>>()?;
        if durations.len() != clips.len() {
            return Err(failed("Generated clip count does not match the reference segments"));
        }

        let mut manifest = String::new();
        for (index, (clip, duration)) in clips.iter().zip(durations).enumerate() {
            let name = format!("trimmed-{index:05}.mp4");
            self.run(&[
                "-i", filename(clip)?, "-map", "0:v:0", "-an",
                "-vf", "fps=30", "-t", &duration, "-c:v", "libx264",
                "-pix_fmt", "yuv420p", &name,
            ])?;
            manifest.push_str(&format!("file '{name}'\n"));
        }
        fs::write(self.0.join("clips.txt"), manifest).map_err(failed)?;
        let mut args = vec!["-f", "concat", "-i", "clips.txt"];
        if let Some(audio) = audio {
            args.extend([
                "-i",
                filename(audio)?,
                "-map",
                "0:v:0",
                "-map",
                "1:a:0?",
                "-c:a",
                "aac",
                "-af",
                "apad",
                "-shortest",
            ]);
        } else {
            args.extend(["-map", "0:v:0"]);
        }
        args.extend(["-c:v", "copy", "-movflags", "+faststart", "assembled.mp4"]);
        self.run(&args)?;
        let mut source = fs::File::open(self.0.join("assembled.mp4")).map_err(failed)?;
        let mut destination = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(output)
            .map_err(failed)?;
        if let Err(error) =
            io::copy(&mut source, &mut destination).and_then(|_| destination.sync_all())
        {
            drop(destination);
            let _ = fs::remove_file(output);
            return Err(failed(error));
        }
        Ok(())
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MotionInput {
    profile_id: String,
    profile_order: Vec<String>,
    character_image: PathBuf,
    motion_video: PathBuf,
    prompt: String,
    aspect_ratio: String,
    preserve_audio: bool,
}

pub(crate) fn run(app: AppHandle, input: MotionInput) -> Result<String, String> {
    let prompt = super::motion_prompt::compose(&input.prompt);
    if !matches!(input.aspect_ratio.as_str(), "9:16" | "16:9") {
        return Err("Select a supported aspect ratio".into());
    }
    let mut profiles = input.profile_order;
    profiles.retain(|profile| profile != &input.profile_id);
    profiles.insert(0, input.profile_id);
    let mut seen = std::collections::HashSet::new();
    profiles.retain(|profile| seen.insert(profile.clone()));
    for profile in &profiles {
        crate::webview_manager::validate_automation_profile(&app, "flow", profile)?;
    }
    let character = local_file(&input.character_image).map_err(|err| format!("{err:?}"))?;
    let motion = local_file(&input.motion_video).map_err(|err| format!("{err:?}"))?;
    let output_dir = crate::download_settings::folder(&app)?.join("Motion Control");
    fs::create_dir_all(&output_dir).map_err(|err| format!("Cannot create Motion Control output folder: {err}"))?;
    let job_id = Uuid::new_v4();
    let output = output_dir.join(format!("Motion-Control-{job_id}.mp4"));
    // Check write access before spending Flow credits.
    let probe = output_dir.join(format!(".{job_id}.write-check"));
    fs::OpenOptions::new().write(true).create_new(true).open(&probe)
        .map_err(|err| format!("Cannot write to Motion Control output folder: {err}"))?;
    fs::remove_file(&probe).map_err(|err| err.to_string())?;
    let (binary, _) = crate::ffmpeg::resolve(&app).ok_or(
        "FFmpeg is required. Select Install FFmpeg in Motion Control or Settings → Dependencies.",
    )?;
    let folder = std::env::temp_dir().join(format!("flowpilot-motion-{}", Uuid::new_v4()));
    fs::create_dir(&folder).map_err(|err| err.to_string())?;
    let image_extension = character
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "webp"
            )
        })
        .ok_or("Choose a PNG, JPG, or WebP character image")?;
    let image = folder.join(format!(
        "character-{}.{}",
        Uuid::new_v4().simple(),
        image_extension
    ));
    fs::copy(&character, &image).map_err(|error| error.to_string())?;
    let result = motion_control::generate(
        &mut FlowSession {
            app: &app,
            folder: &folder,
        },
        &mut Ffmpeg(&folder, binary, job_id),
        MotionControlRequest {
            profile_ids: &profiles,
            prompt: &prompt,
            model: "Omni 1.1 Flash",
            aspect_ratio: &input.aspect_ratio,
            character_image: &image,
            motion_video: &motion,
            output: &output,
            preserve_audio: input.preserve_audio,
        },
    );
    match result {
        Ok(path) => {
            let _ = fs::remove_dir_all(&folder);
            Ok(path.to_string_lossy().into_owned())
        }
        Err(motion_control::MotionControlError::Generate {
            segment, completed_clips, source: AutomationError::ProfilesExhausted
        }) => Err(format!("Flow profiles ran out of credits before segment {segment}. {} completed clip(s) kept in {}", completed_clips.len(), folder.display())),
        Err(motion_control::MotionControlError::Generate { segment, completed_clips, source: AutomationError::LoginRequired }) => Err(format!(
            "Google Flow requests sign-in for segment {segment}. Open the selected Flow profile and confirm it reaches the Projects page, then retry. {} completed clip(s) kept in {}.",
            completed_clips.len(), folder.display()
        )),
        Err(error) => Err(format!("{error:?}. Working folder: {}", folder.display())),
    }
}
