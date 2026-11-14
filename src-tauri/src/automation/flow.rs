use std::path::PathBuf;

use super::AutomationError;

pub(crate) struct FlowVideoRequest<'a> {
    pub(crate) profile_id: &'a str,
    pub(crate) prompt: &'a str,
    pub(crate) model: &'a str,
    pub(crate) aspect_ratio: &'a str,
    pub(crate) references: &'a [FlowReference],
}

pub(crate) enum FlowReference {
    Image(PathBuf),
    MotionVideo(PathBuf),
}

pub(crate) trait FlowVideo {
    /// Generate one clip and return its downloaded local file.
    fn generate_video(&mut self, request: FlowVideoRequest<'_>)
        -> Result<PathBuf, AutomationError>;
}
