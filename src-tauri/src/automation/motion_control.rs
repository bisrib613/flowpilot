use std::path::{Path, PathBuf};

use super::{
    flow::{FlowReference, FlowVideo, FlowVideoRequest},
    AutomationError,
};

pub(crate) struct MotionControlRequest<'a> {
    pub(crate) profile_ids: &'a [String],
    pub(crate) prompt: &'a str,
    pub(crate) model: &'a str,
    pub(crate) aspect_ratio: &'a str,
    pub(crate) character_image: &'a Path,
    pub(crate) motion_video: &'a Path,
    pub(crate) output: &'a Path,
    pub(crate) preserve_audio: bool,
    pub(crate) completed_clips: &'a [PathBuf],
}

pub(crate) trait MotionMedia {
    /// Prepare clips in playback order for the selected model. Check media
    /// dependencies here, before any generation that can consume credits.
    fn prepare(
        &mut self,
        motion_video: &Path,
        model: &str,
    ) -> Result<Vec<PathBuf>, AutomationError>;

    fn checkpoint(&mut self, _clips: &[PathBuf]) -> Result<(), AutomationError> { Ok(()) }

    /// Assemble the downloaded clips in order and write the requested output.
    fn finish(
        &mut self,
        clips: &[PathBuf],
        original_audio_source: Option<&Path>,
        output: &Path,
    ) -> Result<(), AutomationError>;
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum MotionControlError {
    Prepare(AutomationError),
    Generate {
        segment: usize,
        completed_clips: Vec<PathBuf>,
        source: AutomationError,
    },
    Finish {
        completed_clips: Vec<PathBuf>,
        source: AutomationError,
    },
}

pub(crate) fn generate(
    flow: &mut impl FlowVideo,
    media: &mut impl MotionMedia,
    request: MotionControlRequest<'_>,
) -> Result<PathBuf, MotionControlError> {
    let segments = media
        .prepare(request.motion_video, request.model)
        .map_err(MotionControlError::Prepare)?;
    if segments.is_empty() {
        return Err(MotionControlError::Prepare(AutomationError::InvalidInput(
            "Motion video contains no usable segments",
        )));
    }

    if request.completed_clips.len() > segments.len() || request.completed_clips.iter().any(|path| !path.is_file()) {
        return Err(MotionControlError::Prepare(AutomationError::InvalidInput("Saved clips are missing or invalid")));
    }
    let mut clips = request.completed_clips.to_vec();
    let mut profiles = request.profile_ids.iter().peekable();
    for (index, segment) in segments.into_iter().enumerate().skip(request.completed_clips.len()) {
        let references = [
            FlowReference::MotionVideo(segment),
            FlowReference::Image(request.character_image.to_path_buf()),
        ];
        loop {
            let result = match profiles.peek() {
                Some(profile) => flow.generate_video(FlowVideoRequest {
                    profile_id: profile,
                    prompt: request.prompt,
                    model: request.model,
                    aspect_ratio: request.aspect_ratio,
                    references: &references,
                }),
                None => Err(AutomationError::ProfilesExhausted),
            };
            match result {
                Ok(clip) => {
                    clips.push(clip);
                    media.checkpoint(&clips).map_err(|source| MotionControlError::Generate {
                        segment: index + 1, completed_clips: clips.clone(), source,
                    })?;
                    break;
                }
                Err(AutomationError::InsufficientCredits { .. }) => {
                    profiles.next();
                }
                Err(source) => {
                    return Err(MotionControlError::Generate {
                        segment: index + 1,
                        completed_clips: clips,
                        source,
                    });
                }
            }
        }
    }

    if let Err(source) = media.finish(
        &clips,
        request.preserve_audio.then_some(request.motion_video),
        request.output,
    ) {
        return Err(MotionControlError::Finish {
            completed_clips: clips,
            source,
        });
    }

    Ok(request.output.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Media { segments: Vec<PathBuf>, checkpoints: Vec<Vec<PathBuf>>, finished: Vec<PathBuf> }
    impl MotionMedia for Media {
        fn prepare(&mut self, _: &Path, _: &str) -> Result<Vec<PathBuf>, AutomationError> { Ok(self.segments.clone()) }
        fn checkpoint(&mut self, clips: &[PathBuf]) -> Result<(), AutomationError> { self.checkpoints.push(clips.to_vec()); Ok(()) }
        fn finish(&mut self, clips: &[PathBuf], _: Option<&Path>, _: &Path) -> Result<(), AutomationError> { self.finished = clips.to_vec(); Ok(()) }
    }
    struct Flow { calls: Vec<String>, fail_first: bool }
    impl FlowVideo for Flow {
        fn generate_video(&mut self, r: FlowVideoRequest<'_>) -> Result<PathBuf, AutomationError> {
            self.calls.push(r.profile_id.into());
            if self.fail_first && self.calls.len() == 1 { return Err(AutomationError::InsufficientCredits { remaining: 0, required: 15 }); }
            Ok(PathBuf::from(format!("clip-{}", self.calls.len())))
        }
    }
    fn request<'a>(profiles: &'a [String], completed: &'a [PathBuf]) -> MotionControlRequest<'a> {
        MotionControlRequest { profile_ids: profiles, completed_clips: completed, prompt: "test", model: "test", aspect_ratio: "9:16",
            character_image: Path::new("image"), motion_video: Path::new("motion"), output: Path::new("output"), preserve_audio: false }
    }
    #[test]
    fn resumes_without_regenerating_a_completed_segment() {
        let path = std::env::temp_dir().join(format!("flowpilot-resume-test-{}", uuid::Uuid::new_v4()));
        std::fs::write(&path, b"fixture").unwrap();
        let mut media = Media { segments: vec!["one".into(), "two".into()], checkpoints: vec![], finished: vec![] };
        let mut flow = Flow { calls: vec![], fail_first: false };
        generate(&mut flow, &mut media, request(&["a".into()], &[path.clone()])).unwrap();
        assert_eq!(flow.calls, vec!["a"]);
        assert_eq!(media.finished[0], path);
        assert_eq!(media.checkpoints[0].len(), 2);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn insufficient_credits_switches_profile_without_skipping_segment() {
        let mut media = Media { segments: vec!["one".into(), "two".into()], checkpoints: vec![], finished: vec![] };
        let mut flow = Flow { calls: vec![], fail_first: true };
        generate(&mut flow, &mut media, request(&["a".into(), "b".into()], &[])).unwrap();
        assert_eq!(flow.calls, vec!["a", "b", "b"]);
        assert_eq!(media.checkpoints.len(), 2);
        assert_eq!(media.finished.len(), 2);
    }
    #[test]
    fn missing_saved_clip_fails_before_spending_credits() {
        let mut media = Media { segments: vec!["one".into()], checkpoints: vec![], finished: vec![] };
        let mut flow = Flow { calls: vec![], fail_first: false };
        let missing = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        assert!(generate(&mut flow, &mut media, request(&["a".into()], &[missing])).is_err());
        assert!(flow.calls.is_empty());
    }
}
