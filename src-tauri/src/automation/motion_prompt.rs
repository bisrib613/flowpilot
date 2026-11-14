const DEFAULT: &str = include_str!("motion-default.txt");

pub(super) fn compose(input: &str) -> String {
    let input = input.trim();
    if input.is_empty() {
        DEFAULT.trim_end().to_owned()
    } else {
        format!("{}\n\nPENTING: {input}", DEFAULT.trim_end())
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Part<'a> {
    Text(&'a str),
    Video,
    Image,
}

pub(super) fn parts(prompt: &str) -> Vec<Part<'_>> {
    let mut parts = Vec::new();
    let mut start = 0;
    for (index, _) in prompt.match_indices('@') {
        let mention = [("@video", Part::Video), ("@image", Part::Image)]
            .into_iter()
            .find(|(token, _)| {
                prompt[index..].strip_prefix(token).is_some_and(|rest| {
                    !rest.starts_with(|c: char| c.is_alphanumeric() || c == '_')
                })
            });
        if let Some((token, part)) = mention {
            if start < index {
                parts.push(Part::Text(&prompt[start..index]));
            }
            parts.push(part);
            start = index + token.len();
        }
    }
    if start < prompt.len() {
        parts.push(Part::Text(&prompt[start..]));
    }
    parts
}
