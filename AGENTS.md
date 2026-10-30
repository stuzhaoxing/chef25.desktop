# Repository guidance

This public repository contains Chef25 Desktop only. Keep changes focused and preserve the distinction between source checks, packaged builds, signing and real platform acceptance.

- Read README, CONTRIBUTING and docs/architecture before changing runtime behavior.
- Keep frontend presentation in `src/`, process ownership in `src-tauri/src/service.rs`, and the narrow native command surface in `src-tauri/src/lib.rs`.
- Only the main launcher may invoke native commands. Never grant the tavern webview native filesystem or process privileges.
- Vite/HMR uses 25251 and preview uses 25253. SillyTavern uses a manually configured port, defaulting to 25252; address-in-use errors prompt the user to change it. Show the actual running URL. Never kill an unknown port owner or automatically change ports.
- Never commit runtime dependencies, installers, user data, API keys or signing material.
- Update lockfiles, documentation and CHANGELOG with relevant changes. Do not edit vendored runtime sources; pin upstream revisions in runtime.lock.json.
- Required checks: `npm run check`, `python3 -m unittest discover -s tests -p 'test_*.py'`, Rust fmt, Clippy and tests. Changes to startup also require the ignored `bundled_runtime_lifecycle` test using an isolated temporary data directory and an ephemeral test port.
- Distribution is exactly one macOS Universal installer and one Windows x64 installer. Check both Rust and Node architecture slices.
- Production downloads are immutable. New bytes need a new version. Preserve the unsigned-preview label until platform signing and acceptance are complete.
- Release SSH access is restricted to publishing `/srv/chef25/downloads`; never reuse it for system administration or change unrelated services.
