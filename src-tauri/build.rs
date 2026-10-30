fn main() {
    // generate_context! embeds the macOS dev Dock icon at compile time.
    // Track the sources, not just its generated cache in OUT_DIR.
    println!("cargo:rerun-if-changed=icons");
    println!("cargo:rerun-if-changed=icons-dev");
    println!("cargo:rerun-if-changed=tauri.conf.dev.json");
    // Tauri embeds this metadata into the unbundled macOS dev executable.
    println!("cargo:rerun-if-changed=Info.plist");
    tauri_build::build()
}
