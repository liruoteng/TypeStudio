//! Template profile registry.
//!
//! A profile encapsulates everything venue-specific: how to detect it, which
//! LaTeX commands it adds on top of the core map, and what Typst template to
//! bundle alongside the converted body.

pub mod cvpr;

use super::convert::{CommandMap, EnvMap};

pub trait Profile: Send + Sync {
    /// Short name used in the ImportReport (e.g. "cvpr").
    fn name(&self) -> &'static str;

    /// Return true if this profile matches the bundle's preamble text.
    fn matches(&self, preamble: &str) -> bool;

    /// Profile-specific command overrides layered on top of the core map.
    fn command_overrides(&self) -> CommandMap;

    /// Profile-specific environment overrides.
    fn env_overrides(&self) -> EnvMap {
        EnvMap::default()
    }

    /// Embedded Typst template shipped as `template.typ` in the output.
    fn typst_template(&self) -> &'static str;

    /// Preamble written at the top of the generated `main.typ` (imports,
    /// show rules, metadata scaffold).
    fn main_preamble(&self) -> &'static str;
}

pub fn all_profiles() -> Vec<Box<dyn Profile>> {
    vec![Box::new(cvpr::CvprProfile)]
}
