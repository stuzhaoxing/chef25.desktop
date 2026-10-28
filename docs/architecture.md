# Architecture

```text
Trusted launcher (React, main)
   │ fixed Tauri commands
   ▼
Rust service controller ── bundled Node.js ── SillyTavern :25252
   │                                             │
   └─ persistent application data                └─ tavern webview (no native capabilities)
```

`service.rs` owns the child process. Startup reserves the port, prepares a versioned writable runtime, starts a fixed entry point with fixed loopback arguments, then waits for HTTP readiness and a live child. Failure cleans up only that child. User data and config live outside versioned runtimes.

`lib.rs` exposes a small command surface and opens a separate local webview. Its main-frame navigation is restricted to the owned loopback origin. The renderer cannot choose executable paths or arbitrary arguments.

`runtime.lock.json` is the source of truth for upstream provenance; update the matching Rust revision constant and displayed version in the same PR. macOS ships one Universal installer, with both architectures in the Rust launcher and Node.js executable. Windows ships one x64 installer. The source archive is checked before extraction. npm dependencies are installed from upstream's lockfile with lifecycle scripts disabled.

Node.js archives are downloaded from the official distribution and verified against committed SHA-256 values. macOS combines the two official Node executables with lipo and ad-hoc signs the result. The pinned SillyTavern dependencies are JS/WASM-only; preparation rejects native modules until an explicit cross-architecture strategy is added. The release job replaces the development signature with Developer ID signing (including Node JIT entitlements), refreshes the Node hash, notarizes and staples both app and DMG, and checks the extracted updater archive.

Website and desktop remain independent repositories. The website reads a small public release manifest; installers reside in immutable server directories. No production host credentials are stored here.

`updates.rs` serializes update checks/installations, accepts commands only from the trusted launcher, and uses the pinned Tauri updater to verify payload signatures and signed versions. Downloads complete before the owned service is stopped. The process controller blocks new starts during installation. Update errors release operation guards, and user data remains outside the installed application.

The server publishes `updater.json` with separate macOS CPU aliases pointing to the same Universal archive and one Windows x64 installer. Both release manifests use no-store caching. Manual downloads remain exactly two installers. Private signing credentials live in protected GitHub environments, never in source or logs.
