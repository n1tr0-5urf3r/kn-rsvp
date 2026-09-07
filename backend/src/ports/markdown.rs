//! Parser for the hand-maintained Markdown port tables (`tofino.md`).
//!
//! Deliberately tolerant: admins paste either a single table or the whole
//! document, headers may be German or English, and cells may be bold-wrapped
//! (`**1/0**`) or hold a dash for "empty".

/// One row of a port table, still unresolved: `peer` is the raw
/// "Plugged into" text that the importer maps onto a port or NIC.
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedPort {
    pub fp_port: String,
    pub dev_port: i64,
    pub pipe: String,
    pub speed_gbps: f64,
    pub cable_label: String,
    pub peer: String,
    pub comment: String,
}

/// Lowercased alphanumerics — compares headings, column headers and device
/// names without caring about case, spaces or punctuation.
pub fn normalize_key(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

/// `"P2"`, `"2"` and `"2/0"` all mean front-panel port 2, channel 0.
pub fn normalize_fp_port(value: &str) -> String {
    let value = value.trim().trim_start_matches(['p', 'P']).trim();
    if value.is_empty() {
        return String::new();
    }
    if value.contains('/') {
        return value.to_string();
    }
    format!("{value}/0")
}

/// Leading number of a speed cell: `"100G"` -> 100, `"2.5G"` -> 2.5,
/// `"400"` -> 400, everything else (including an empty cell) -> 0.
pub fn parse_speed_gbps(value: &str) -> f64 {
    let digits: String = value
        .trim()
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    digits.parse().unwrap_or(0.0)
}

/// Splits `"Carrie P2"` into `("Carrie", "P2")`; `None` when there is no
/// device/port split to make.
pub fn split_peer(value: &str) -> Option<(&str, &str)> {
    let value = value.trim();
    let (device, rest) = value.split_once(char::is_whitespace)?;
    let rest = rest.trim();
    if device.is_empty() || rest.is_empty() {
        return None;
    }
    Some((device, rest))
}

/// Parses every port table in `markdown`. Rows under a `### <tofino>` heading
/// win; when no heading names the Tofino (a single pasted table), every parsed
/// row is used.
pub fn parse_port_tables(markdown: &str, tofino_name: &str) -> Result<Vec<ParsedPort>, String> {
    let wanted = normalize_key(tofino_name);
    let mut in_section = Vec::new();
    let mut everything = Vec::new();
    let mut heading = String::new();
    let mut columns: Option<Columns> = None;

    for (index, raw_line) in markdown.lines().enumerate() {
        let line = raw_line.trim();
        if let Some(rest) = line.strip_prefix('#') {
            heading = rest.trim_start_matches('#').trim().to_string();
            columns = None;
            continue;
        }
        if !line.starts_with('|') {
            // Any non-table line closes the current table.
            columns = None;
            continue;
        }
        let cells = split_row(line);
        if is_separator(&cells) {
            continue;
        }
        match &columns {
            None => columns = Columns::from_header(&cells),
            Some(cols) => {
                if let Some(port) = cols.parse_row(&cells, index + 1)? {
                    if normalize_key(&heading) == wanted {
                        in_section.push(port.clone());
                    }
                    everything.push(port);
                }
            }
        }
    }

    let ports = if in_section.is_empty() {
        everything
    } else {
        in_section
    };
    if ports.is_empty() {
        return Err("no port table found — expected columns like \
                    'Front Panel Port | Dev Port | Pipe'"
            .into());
    }
    Ok(ports)
}

/// Column indices of one Markdown table.
struct Columns {
    fp_port: usize,
    dev_port: usize,
    pipe: Option<usize>,
    speed: Option<usize>,
    cable_label: Option<usize>,
    peer: Option<usize>,
    comment: Option<usize>,
}

impl Columns {
    /// `None` when the row is not the header of a port table.
    fn from_header(cells: &[String]) -> Option<Self> {
        let mut fp_port = None;
        let mut dev_port = None;
        let mut pipe = None;
        let mut speed = None;
        let mut cable_label = None;
        let mut peer = None;
        let mut comment = None;

        for (index, cell) in cells.iter().enumerate() {
            match normalize_key(cell).as_str() {
                "frontpanelport" | "fpport" | "frontport" | "port" => fp_port = Some(index),
                "devport" | "deviceport" => dev_port = Some(index),
                "pipe" => pipe = Some(index),
                "speed" | "geschwindigkeit" => speed = Some(index),
                "kabellabel" | "cablelabel" | "cable" | "kabel" | "label" => {
                    cable_label = Some(index)
                }
                "pluggedinto" | "connectedto" | "peer" | "verbundenmit" => peer = Some(index),
                "kommentar" | "comment" | "usage" | "notes" | "notiz" => comment = Some(index),
                _ => {}
            }
        }

        Some(Self {
            fp_port: fp_port?,
            dev_port: dev_port?,
            pipe,
            speed,
            cable_label,
            peer,
            comment,
        })
    }

    fn parse_row(&self, cells: &[String], line: usize) -> Result<Option<ParsedPort>, String> {
        let fp_port = normalize_fp_port(cell(cells, Some(self.fp_port)));
        if fp_port.is_empty() {
            return Ok(None);
        }
        let dev_raw = cell(cells, Some(self.dev_port));
        let dev_port = dev_raw.parse::<i64>().map_err(|_| {
            format!("line {line}: port {fp_port} has an invalid dev port '{dev_raw}'")
        })?;

        Ok(Some(ParsedPort {
            fp_port,
            dev_port,
            pipe: cell(cells, self.pipe).to_string(),
            speed_gbps: parse_speed_gbps(cell(cells, self.speed)),
            cable_label: cell(cells, self.cable_label).to_string(),
            peer: cell(cells, self.peer).to_string(),
            comment: cell(cells, self.comment).to_string(),
        }))
    }
}

/// Cell content with Markdown bold and placeholder dashes stripped.
fn cell(cells: &[String], index: Option<usize>) -> &str {
    let value = index
        .and_then(|index| cells.get(index))
        .map(String::as_str)
        .unwrap_or("")
        .trim()
        .trim_matches('*')
        .trim();
    if matches!(value, "-" | "–" | "—" | "/") {
        return "";
    }
    value
}

fn split_row(line: &str) -> Vec<String> {
    line.trim_matches('|')
        .split('|')
        .map(|cell| cell.trim().to_string())
        .collect()
}

fn is_separator(cells: &[String]) -> bool {
    !cells.is_empty()
        && cells.iter().all(|cell| {
            let cell = cell.trim();
            !cell.is_empty() && cell.chars().all(|c| matches!(c, '-' | ':' | ' '))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOC: &str = "\
## Übersicht

| **Name** | **Hardware** | **SDE Version** |
| -------- | ------------ | --------------- |
| carrie   | Tofino 1     | 9.13.4          |

## Port und Mappings

### Carrie

| **Front Panel Port** | **Dev Port** | **Pipe** | **Speed** | **Kabellabel** | **Plugged into** | **Kommentar** |
| -------------------- | ------------ | -------- | --------- | -------------- | ---------------- | ------------- |
| 1/0                  | 132          | 2/4      | 100G      | A22            | Carrie P2        | Local loop    |
| 4/0                  | 156          | 2/28     |           |                |                  |               |
| 10/0                 | 48           | 0/48     | 100G      | A12            | Pennywise 65.1   | Debug host    |

### Pazuzu

| **Front Panel Port** | **Dev Port** | **Pipe** | **Speed** | **Kabellabel** | **Plugged into** | **Kommentar** |
| -------------------- | ------------ | -------- | --------- | -------------- | ---------------- | ------------- |
| 3/0                  | 144          | 3/16     | 400G      | -              | Carrie P3        | Tofino1 loop  |
";

    #[test]
    fn picks_the_table_of_the_requested_tofino() {
        let ports = parse_port_tables(DOC, "Carrie").unwrap();
        assert_eq!(ports.len(), 3);
        assert_eq!(
            ports[0],
            ParsedPort {
                fp_port: "1/0".into(),
                dev_port: 132,
                pipe: "2/4".into(),
                speed_gbps: 100.0,
                cable_label: "A22".into(),
                peer: "Carrie P2".into(),
                comment: "Local loop".into(),
            }
        );
        // Undocumented ports keep their hardware facts and stay empty.
        assert_eq!(ports[1].fp_port, "4/0");
        assert_eq!(ports[1].speed_gbps, 0.0);
        assert_eq!(ports[1].peer, "");

        let pazuzu = parse_port_tables(DOC, "pazuzu").unwrap();
        assert_eq!(pazuzu.len(), 1);
        assert_eq!(pazuzu[0].speed_gbps, 400.0);
        // A dash means "no cable label", not the label "-".
        assert_eq!(pazuzu[0].cable_label, "");
    }

    #[test]
    fn falls_back_to_every_row_when_no_heading_matches() {
        let table = "\
| Front Panel Port | Dev Port | Pipe | Speed | Cable | Plugged into | Comment |
| ---------------- | -------- | ---- | ----- | ----- | ------------ | ------- |
| 1/0              | 136      | 1/8  | 100G  | A20   | Donnie P2    | Local   |
";
        let ports = parse_port_tables(table, "Frank").unwrap();
        assert_eq!(ports.len(), 1);
        assert_eq!(ports[0].fp_port, "1/0");
        assert_eq!(ports[0].peer, "Donnie P2");
    }

    #[test]
    fn ignores_tables_without_port_columns() {
        let doc = "| **Name** | **Hardware** |\n| --- | --- |\n| carrie | Tofino 1 |\n";
        assert!(parse_port_tables(doc, "Carrie").is_err());
    }

    #[test]
    fn rejects_an_unparsable_dev_port() {
        let doc = "\
| Front Panel Port | Dev Port |
| ---------------- | -------- |
| 1/0              | ohne     |
";
        let err = parse_port_tables(doc, "Carrie").unwrap_err();
        assert!(err.contains("dev port"), "{err}");
    }

    #[test]
    fn normalizes_port_references() {
        assert_eq!(normalize_fp_port("P2"), "2/0");
        assert_eq!(normalize_fp_port("2"), "2/0");
        assert_eq!(normalize_fp_port("2/0"), "2/0");
        assert_eq!(normalize_fp_port("65.1"), "65.1/0");
        assert_eq!(normalize_fp_port(""), "");
    }

    #[test]
    fn parses_speed_cells() {
        assert_eq!(parse_speed_gbps("100G"), 100.0);
        assert_eq!(parse_speed_gbps("2.5G"), 2.5);
        assert_eq!(parse_speed_gbps("400 Gbit/s"), 400.0);
        assert_eq!(parse_speed_gbps(""), 0.0);
        assert_eq!(parse_speed_gbps("n/a"), 0.0);
    }

    #[test]
    fn splits_peer_references() {
        assert_eq!(split_peer("Carrie P2"), Some(("Carrie", "P2")));
        assert_eq!(split_peer("Pennywise 65.1"), Some(("Pennywise", "65.1")));
        assert_eq!(split_peer("Carrie"), None);
        assert_eq!(split_peer(""), None);
    }
}
