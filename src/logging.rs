//! Logging initialization for Dum-E

use tracing_subscriber::{fmt, prelude::*, EnvFilter};

pub fn init(verbose: bool, terminal_output: bool) {
    let filter = if verbose {
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("debug"))
    } else {
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"))
    };

    let registry = tracing_subscriber::registry().with(filter);
    if terminal_output {
        registry.with(fmt::layer().with_target(true)).init();
    } else {
        registry.init();
    }
}
