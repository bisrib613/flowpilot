use serde_json::{json, Value};
use tauri::AppHandle;

use super::{PinRequest, PinterestPublisher, PublishedPost, ThreadRequest, ThreadsPublisher};
use crate::automation::{
    browser::{failed, local_file, Browser},
    AutomationError,
};

pub(crate) struct SocialPublisher<'a>(pub(crate) &'a AppHandle);

const PINTEREST: &[&str] = &["www.pinterest.com", "pinterest.com"];
const THREADS: &[&str] = &["www.threads.com", "threads.com"];

fn script(action: &str, data: Value) -> String {
    let script = include_str!("social.js");
    let action = json!(action);
    format!("({script})({action}, {data})")
}

fn step(browser: &Browser, action: &str, data: Value) -> Result<(), AutomationError> {
    browser.wait(&script(action, data), 25).map(|_| ())
}

fn publish(
    browser: &Browser,
    platform: &str,
    action: &str,
    mut data: Value,
) -> Result<PublishedPost, AutomationError> {
    let previous = browser.eval(&script("links", json!({"platform": platform})))?;
    if browser
        .eval(&script(action, data.clone()))
        .map_err(|_| AutomationError::SubmissionUnconfirmed)?
        != Value::Bool(true)
    {
        return Err(failed(
            "Publish button was disabled or the destination was not selected",
        ));
    }
    data["previous"] = previous;
    let receipt = browser
        .wait(&script("receipt", data), 120)
        .map_err(|_| AutomationError::SubmissionUnconfirmed)?;
    let permalink = receipt
        .as_str()
        .ok_or(AutomationError::SubmissionUnconfirmed)?;
    Ok(PublishedPost {
        permalink: permalink.into(),
    })
}

impl PinterestPublisher for SocialPublisher<'_> {
    fn publish_pin(&mut self, request: PinRequest<'_>) -> Result<PublishedPost, AutomationError> {
        if request.title.trim().is_empty() || request.board.trim().is_empty() {
            return Err(AutomationError::InvalidInput(
                "A title and board are required",
            ));
        }
        if let Some(link) = request.destination_url {
            let url = tauri::Url::parse(link).map_err(failed)?;
            if !matches!(url.scheme(), "http" | "https") || url.host().is_none() {
                return Err(AutomationError::InvalidInput(
                    "Destination must be a web URL",
                ));
            }
        }
        let media = local_file(request.media)?;
        let browser = Browser::open(
            self.0,
            "pinterest",
            request.profile_id,
            "https://www.pinterest.com/pin-creation-tool/",
            PINTEREST,
        )?;
        browser.upload("input[type=file]", &media)?;
        step(
            &browser,
            "pinFields",
            json!({
                "title": request.title, "description": request.description, "url": request.destination_url
            }),
        )?;
        step(&browser, "pinBoard", Value::Null)?;
        step(&browser, "selectBoard", json!({"board": request.board}))?;
        browser.wait("Array.from(document.querySelectorAll('button')).some(b => !b.disabled && b.getAttribute('aria-disabled') !== 'true' && /^(publish|terbitkan)$/i.test(b.textContent.trim()))", 90)?;
        publish(
            &browser,
            "pinterest",
            "pinSubmit",
            json!({"platform": "pinterest", "board": request.board}),
        )
    }
}

impl ThreadsPublisher for SocialPublisher<'_> {
    fn publish_thread(
        &mut self,
        request: ThreadRequest<'_>,
    ) -> Result<PublishedPost, AutomationError> {
        if request.parts.is_empty()
            || request
                .parts
                .iter()
                .any(|part| part.trim().is_empty() || part.chars().count() > 500)
        {
            return Err(AutomationError::InvalidInput(
                "Each thread part must contain 1–500 characters",
            ));
        }
        let media = request.root_media.map(local_file).transpose()?;
        let browser = Browser::open(
            self.0,
            "threads",
            request.profile_id,
            "https://www.threads.com/",
            THREADS,
        )?;
        step(&browser, "threadOpen", Value::Null)?;
        step(&browser, "threadReady", Value::Null)?;
        if let Some(topic) = request.topic {
            step(&browser, "threadTopicOpen", Value::Null)?;
            step(&browser, "threadTopicFill", json!({"topic": topic}))?;
            step(&browser, "threadTopicSelect", json!({"topic": topic}))?;
        }
        for (index, part) in request.parts.iter().enumerate() {
            if index > 0 {
                step(&browser, "threadAdd", Value::Null)?;
            }
            step(
                &browser,
                "threadText",
                json!({"index": index, "text": part}),
            )?;
            if let Some(path) = media.as_ref().filter(|_| index == 0) {
                browser.intercept_file_chooser()?;
                step(&browser, "threadAttach", Value::Null)?;
                browser.upload("[role=dialog] input[type=file]", path)?;
                step(&browser, "threadPreview", Value::Null)?;
            }
        }
        publish(
            &browser,
            "threads",
            "threadSubmit",
            json!({"platform": "threads"}),
        )
    }
}
