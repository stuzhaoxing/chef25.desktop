# Architecture

```text
Trusted launcher (React, main)
   │ four fixed Tauri commands
   ▼
Rust service controller ── bundled Node.js ── SillyTavern :25252
   │                                             │
   └─ persistent application data                └─ tavern webview (no native capabilities)
```

`service.rs` owns the child process. Startup reserves the port, prepares a versioned writable runtime, starts a fixed entry point with fixed loopback arguments, then waits for HTTP readiness and a live child. Failure cleans up only that child. User data and config live outside versioned runtimes.

`lib.rs` exposes a small command surface and opens a separate local webview. Its main-frame navigation is restricted to the owned loopback origin. The renderer cannot choose executable paths or arbitrary arguments.

`runtime.lock.json` is the source of truth for upstream provenance; update the matching Rust revision constant and displayed version in the same PR. macOS ships one Universal installer, with both architectures in the Rust launcher and Node.js executable. Windows ships one x64 installer. The source archive is checked before extraction. npm dependencies are installed from upstream's lockfile with lifecycle scripts disabled.

Node.js archives are downloaded from the official distribution and verified against committed SHA-256 values. macOS combines the two official Node executables with lipo and ad-hoc signs the result. The pinned SillyTavern dependencies are JS/WASM-only; preparation rejects native modules until an explicit cross-architecture strategy is added. Formal macOS releases still require Developer ID signing and notarization.

Website and desktop remain independent repositories. The website reads a small public release manifest; installers reside in immutable server directories. No production host credentials are stored here.
