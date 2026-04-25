//! Conversion report generator.

pub fn build(profile: &str, notes: &[String]) -> String {
    let mut s = String::new();
    s.push_str("# Conversion Report\n\n");
    s.push_str(&format!("**Profile:** `{profile}`\n\n"));
    s.push_str("## Notes\n\n");
    if notes.is_empty() {
        s.push_str("_No warnings._\n");
    } else {
        for n in notes {
            s.push_str(&format!("- {n}\n"));
        }
    }
    s
}
