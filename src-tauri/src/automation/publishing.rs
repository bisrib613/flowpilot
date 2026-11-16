use std::path::Path;

use super::AutomationError;

pub(crate) struct PinRequest<'a> {
    pub(crate) profile_id: &'a str,
    pub(crate) board: &'a str,
    pub(crate) title: &'a str,
    pub(crate) description: &'a str,
    pub(crate) destination_url: Option<&'a str>,
    pub(crate) media: &'a Path,
}

pub(crate) struct ThreadRequest<'a> {
    pub(crate) profile_id: &'a str,
    pub(crate) topic: Option<&'a str>,
    /// Parts in order, starting with the root post.
    pub(crate) parts: &'a [&'a str],
    pub(crate) root_media: Option<&'a Path>,
}

pub(crate) struct PublishedPost {
    pub(crate) permalink: String,
}

pub(crate) trait PinterestPublisher {
    /// Return a permalink only after verifying publication to the requested board.
    fn publish_pin(&mut self, request: PinRequest<'_>) -> Result<PublishedPost, AutomationError>;
}

pub(crate) trait ThreadsPublisher {
    /// Return the verified permalink of the root post.
    fn publish_thread(
        &mut self,
        request: ThreadRequest<'_>,
    ) -> Result<PublishedPost, AutomationError>;
}

#[cfg(windows)]
mod webview;
#[cfg(windows)]
pub(crate) use webview::SocialPublisher;
