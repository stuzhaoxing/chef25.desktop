# Repository guidance

This public repository contains Chef25 Desktop only. Keep changes focused and preserve the distinction between source checks, packaged builds, signing and real platform acceptance.

- Read README, CONTRIBUTING and docs/architecture before changing runtime behavior.
- Keep frontend presentation in `src/`, process ownership in `src-tauri/src/service.rs`, and the narrow native command surface in `src-tauri/src/lib.rs`.
- Only the main launcher may invoke native commands. Never grant the tavern webview native filesystem or process privileges.
- Ports are 25251 (Vite/HMR), 25252 (SillyTavern), 25253 (preview). Never kill an unknown port owner or silently fall back to a different port.
- Never commit runtime dependencies, installers, user data, API keys or signing material.
- Update lockfiles, documentation and CHANGELOG with relevant changes. Do not edit vendored runtime sources; pin upstream revisions in runtime.lock.json.
- Required checks: `npm run check`, `python3 -m unittest discover -s tests -p 'test_*.py'`, Rust fmt, Clippy and tests. Changes to startup also require the ignored `bundled_runtime_lifecycle` test with port 25252 free.
- Distribution is exactly one macOS Universal installer and one Windows x64 installer. Check both Rust and Node architecture slices.
- Production downloads are immutable. New bytes need a new version. Preserve the unsigned-preview label until platform signing and acceptance are complete.
- Release SSH access is restricted to publishing `/srv/chef25/downloads`; never reuse it for system administration or change unrelated services.
