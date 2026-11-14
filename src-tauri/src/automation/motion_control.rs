use std::path::{Path, PathBuf};

use super::{
    flow::{FlowReference, FlowVideo, FlowVideoRequest},
    AutomationError,
};

pub(crate) struct MotionControlRequest<'a> {
    pub(crate) profile_id: &'a str,
    pub(crate) prompt: &'a str,
    pub(crate) model: &'a str,
    pub(crate) aspect_ratio: &'a str,
    pub(crate) character_image: &'a Path,
    pub(crate) motion_video: &'a Path,
    pub(crate) output: &'a Path,
    pub(crate) preserve_audio: bool,
}

pub(crate) trait MotionMedia {
    /// Prepare clips in playback order for the selected model. Check media
    /// dependencies here, before any generation that can consume credits.
    fn prepare(
        &mut self,
        motion_video: &Path,
        model: &str,
    ) -> Result<Vec<PathBuf>, AutomationError>;

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

    let mut clips = Vec::with_capacity(segments.len());
    for (index, segment) in segments.into_iter().enumerate() {
        let references = [
            FlowReference::MotionVideo(segment),
            FlowReference::Image(request.character_image.to_path_buf()),
        ];
        let result = flow.generate_video(FlowVideoRequest {
            profile_id: request.profile_id,
            prompt: request.prompt,
            model: request.model,
            aspect_ratio: request.aspect_ratio,
            references: &references,
        });
        match result {
            Ok(clip) => clips.push(clip),
            Err(source) => {
                return Err(MotionControlError::Generate {
                    segment: index + 1,
                    completed_clips: clips,
                    source,
                });
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
