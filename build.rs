use std::path::Path;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=native/macos/ax-query/Package.swift");
    println!("cargo:rerun-if-changed=native/macos/ax-query/Sources/ax-query/main.swift");
    println!("cargo:rerun-if-changed=native/linux/atspi-query.py");
    println!("cargo:rerun-if-changed=native/windows/uia-query.ps1");

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        build_macos_ax_query();
    }
}

fn build_macos_ax_query() {
    let package_dir = Path::new("native/macos/ax-query");
    if !package_dir.exists() {
        println!("cargo:warning=Skipping ax-query build: native/macos/ax-query missing");
        return;
    }

    let swift_available = Command::new("swift")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);
    if !swift_available {
        println!("cargo:warning=Skipping ax-query build: swift not available");
        return;
    }

    let built_binary = package_dir.join(".build/arm64-apple-macosx/release/ax-query");

    match Command::new("swift")
        .args(["build", "-c", "release"])
        .current_dir(package_dir)
        .output()
    {
        Ok(output) if output.status.success() => {
            println!("cargo:warning=Built native macOS accessibility backend (ax-query)");
        }
        Ok(output) => {
            if built_binary.exists() {
                println!(
                    "cargo:warning=Native macOS accessibility backend already available at {}",
                    built_binary.display()
                );
                return;
            }
            let stderr = String::from_utf8_lossy(&output.stderr);
            println!(
                "cargo:warning=Failed to build native macOS accessibility backend: {}",
                stderr.trim()
            );
        }
        Err(error) => {
            println!(
                "cargo:warning=Failed to invoke swift build for native macOS accessibility backend: {}",
                error
            );
        }
    }
}
