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

Website and desktop remain independent repositories. The website reads a small public release manifest; installers and updater artifacts reside in immutable R2 object keys behind a Pages Functions custom subdomain on Workers Free. The bucket remains private; the gateway performs at most two R2 reads per request and has no origin fallback. Uploads stop before the bucket exceeds 9 GB; this is not an account-wide billing cap. No production host credentials are stored here.

`updates.rs` serializes update checks/installations, accepts commands only from the trusted launcher, and uses the pinned Tauri updater to verify payload signatures and signed versions. Downloads complete before the owned service is stopped. The process controller blocks new starts during installation. Update errors release operation guards, and user data remains outside the installed application.

The release publisher uploads and verifies all R2 objects before publishing `updater.json` with separate macOS CPU aliases pointing to the same Universal archive and one Windows x64 installer. Both release manifests use no-store caching. Manual downloads remain exactly two installers. Private signing credentials live in protected GitHub environments, never in source or logs.

The website proxies only the small latest/updater manifests from R2 with no-store caching and redirects versioned download paths to the custom domain. Existing updater endpoints remain compatible. The original disk-backed Caddy configuration is retained until R2 migration is complete. See [R2 rollout](r2-distribution.md).

The download gateway uses Pages advanced mode, with all paths handled by the Function and no installer static assets. The main domain keeps its external authoritative DNS; only the download CNAME targets the Pages project. Preview environments have no R2 binding and downloads disabled.
