//! Minimal hand-rolled iCalendar (RFC 5545) VEVENT builder.
//!
//! Deliberately not using an icalendar crate: we only need a single VEVENT
//! per file, with text escaping, CRLF line endings, 75-octet line folding,
//! and UTC timestamps.

use chrono::{DateTime, Utc};

const FOLD_LIMIT_OCTETS: usize = 75;

pub struct IcsEventInput<'a> {
    pub product_id: &'a str,
    pub uid: &'a str,
    pub summary: &'a str,
    pub description: Option<&'a str>,
    pub start_ts: i64,
    pub end_ts: i64,
    pub sequence: i64,
    pub dtstamp_ts: i64,
}

/// Build a complete single-event VCALENDAR document.
pub fn build_event(event: &IcsEventInput<'_>) -> String {
    let mut lines = vec![
        "BEGIN:VCALENDAR".to_string(),
        "VERSION:2.0".to_string(),
        format!("PRODID:{}", event.product_id),
        "CALSCALE:GREGORIAN".to_string(),
        "BEGIN:VEVENT".to_string(),
        format!("UID:{}", escape_text(event.uid)),
        format!("DTSTAMP:{}", format_utc(event.dtstamp_ts)),
        format!("DTSTART:{}", format_utc(event.start_ts)),
        format!("DTEND:{}", format_utc(event.end_ts)),
        format!("SUMMARY:{}", escape_text(event.summary)),
        format!("SEQUENCE:{}", event.sequence),
    ];
    if let Some(description) = event.description
        && !description.is_empty()
    {
        lines.push(format!("DESCRIPTION:{}", escape_text(description)));
    }
    lines.push("END:VEVENT".to_string());
    lines.push("END:VCALENDAR".to_string());

    let mut out = String::new();
    for line in lines {
        out.push_str(&fold_line(&line));
        out.push_str("\r\n");
    }
    out
}

/// Escape TEXT values per RFC 5545 section 3.3.11.
pub fn escape_text(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\\' => out.push_str("\\\\"),
            ';' => out.push_str("\\;"),
            ',' => out.push_str("\\,"),
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                out.push_str("\\n");
            }
            '\n' => out.push_str("\\n"),
            _ => out.push(ch),
        }
    }
    out
}

/// Fold a content line to at most 75 octets per physical line, continuation
/// lines prefixed with a single space (which counts toward the limit).
/// Splits only at UTF-8 character boundaries.
pub fn fold_line(line: &str) -> String {
    if line.len() <= FOLD_LIMIT_OCTETS {
        return line.to_string();
    }
    let mut out = String::with_capacity(line.len() + 8);
    let mut current_octets = 0usize;
    let mut first_line = true;
    for ch in line.chars() {
        let ch_octets = ch.len_utf8();
        let limit = if first_line {
            FOLD_LIMIT_OCTETS
        } else {
            FOLD_LIMIT_OCTETS - 1
        };
        if current_octets + ch_octets > limit {
            out.push_str("\r\n ");
            first_line = false;
            current_octets = 0;
        }
        out.push(ch);
        current_octets += ch_octets;
    }
    out
}

/// Format a unix timestamp as an RFC 5545 UTC date-time (`YYYYMMDDTHHMMSSZ`).
pub fn format_utc(ts: i64) -> String {
    DateTime::<Utc>::from_timestamp(ts, 0)
        .unwrap_or_else(|| DateTime::<Utc>::from_timestamp(0, 0).expect("epoch is valid"))
        .format("%Y%m%dT%H%M%SZ")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_special_characters() {
        assert_eq!(escape_text("a,b;c\\d"), "a\\,b\\;c\\\\d");
        assert_eq!(escape_text("line1\nline2"), "line1\\nline2");
        assert_eq!(escape_text("line1\r\nline2"), "line1\\nline2");
        assert_eq!(escape_text("plain"), "plain");
    }

    #[test]
    fn formats_utc_timestamps() {
        // 2026-07-25 14:00:00 UTC
        assert_eq!(format_utc(1_784_988_000), "20260725T140000Z");
        assert_eq!(format_utc(0), "19700101T000000Z");
    }

    #[test]
    fn short_lines_are_not_folded() {
        assert_eq!(fold_line("SUMMARY:short"), "SUMMARY:short");
        let exactly_75 = "X".repeat(75);
        assert_eq!(fold_line(&exactly_75), exactly_75);
    }

    #[test]
    fn long_lines_fold_at_75_octets_with_space_continuation() {
        let line = format!("SUMMARY:{}", "a".repeat(200));
        let folded = fold_line(&line);
        for (index, physical) in folded.split("\r\n").enumerate() {
            assert!(physical.len() <= 75, "physical line exceeds 75 octets");
            if index > 0 {
                assert!(
                    physical.starts_with(' '),
                    "continuation must start with space"
                );
            }
        }
        let unfolded: String = folded.replace("\r\n ", "");
        assert_eq!(unfolded, line);
    }

    #[test]
    fn folding_respects_utf8_boundaries() {
        let line = format!("SUMMARY:{}", "ü".repeat(100));
        let folded = fold_line(&line);
        for physical in folded.split("\r\n") {
            assert!(physical.len() <= 75);
        }
        assert_eq!(folded.replace("\r\n ", ""), line);
    }

    #[test]
    fn builds_a_complete_utc_event_with_crlf() {
        let ics = build_event(&IcsEventInput {
            product_id: "-//Example Lab//RSVP//EN",
            uid: "rsvp-abc@example.invalid",
            summary: "tofino-1 — Alice",
            description: Some("first; test, run"),
            start_ts: 1_784_988_000,
            end_ts: 1_784_991_600,
            sequence: 2,
            dtstamp_ts: 1_784_984_400,
        });
        assert!(ics.starts_with("BEGIN:VCALENDAR\r\n"));
        assert!(ics.ends_with("END:VCALENDAR\r\n"));
        assert!(ics.contains("PRODID:-//Example Lab//RSVP//EN\r\n"));
        assert!(ics.contains("UID:rsvp-abc@example.invalid\r\n"));
        assert!(ics.contains("DTSTART:20260725T140000Z\r\n"));
        assert!(ics.contains("DTEND:20260725T150000Z\r\n"));
        assert!(ics.contains("SEQUENCE:2\r\n"));
        assert!(ics.contains("DESCRIPTION:first\\; test\\, run\r\n"));
        // No bare LF anywhere.
        assert!(!ics.replace("\r\n", "").contains('\n'));
    }

    #[test]
    fn empty_description_is_omitted() {
        let ics = build_event(&IcsEventInput {
            product_id: "-//RSVP//Hardware reservations//EN",
            uid: "u",
            summary: "s",
            description: None,
            start_ts: 0,
            end_ts: 3600,
            sequence: 0,
            dtstamp_ts: 0,
        });
        assert!(!ics.contains("DESCRIPTION"));
    }
}
