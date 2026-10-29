# Third-party notices

Chef25 Desktop is an independent project, not an official SillyTavern distribution.

The launcher attribution uses the SillyTavern logo from
[`public/img/logo.svg`](https://github.com/SillyTavern/SillyTavern/blob/7e8663cd9c184a550b37238218bdd32c6efc68e9/public/img/logo.svg)
in the upstream AGPL-3.0 source tree, with the ST lettering changed from white
to dark gray for legibility on the launcher's light background. The logo
retains its transparent background and identifies the bundled project;
it does not imply sponsorship or endorsement.

The attribution's Noto Sans Bold font is bundled from the
[official homepage font asset](https://sillytavern.app/webfonts/NotoSans/NotoSans-Bold.woff2).
Noto Sans is licensed under SIL Open Font License 1.1; the complete notice is
retained in `src/assets/sillytavern/OFL.txt` from the
[Noto font repository](https://github.com/notofonts/noto-fonts/blob/main/LICENSE).

| Component          | Source                                                                                   | License                                          | Distribution                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| SillyTavern 1.19.0 | https://github.com/SillyTavern/SillyTavern/tree/7e8663cd9c184a550b37238218bdd32c6efc68e9 | AGPL-3.0                                         | Unmodified source, lockfile, dependencies and complete source archive in runtime resources |
| Node.js            | https://github.com/nodejs/node                                                           | Node.js license with bundled third-party notices | Runtime binary and NODE-LICENSE                                                            |
| Tauri              | https://github.com/tauri-apps/tauri                                                      | MIT / Apache-2.0                                 | Native application framework                                                               |
| React              | https://github.com/facebook/react                                                        | MIT                                              | Frontend runtime                                                                           |
| Lucide             | https://github.com/lucide-icons/lucide                                                   | ISC                                              | Interface icons                                                                            |

Exact Node version is recorded in `.node-version`; runtime provenance is recorded in the packaged `manifest.json`. Dependencies retain their own licenses. A release must include Chef25's matching source archive, lockfiles and notices alongside installers. Do not remove upstream license files or network source-access notices.

Before releasing, review all transitive dependency notices and any platform signing requirements. Build artifacts alone are not evidence of that review.

## Optional OpenFrp client

Remote access optionally downloads OpenFrp FRPC `OF_0.68.0_37f78258_260326` directly from the official HTTPS resource service. Archive SHA-256 values and platform filenames are pinned in `runtime.lock.json`. The client is not included in the installer; the upstream launcher UI/code is not copied into this project. OpenFrp's modified client/service terms must not be confused with the Apache-2.0 license of upstream fatedier/frp. See https://www.openfrp.net/policy/ and https://docs.openfrp.net/use/frpc.

This project is community developed; OpenFrp is not responsible for technical support other than node issues. The application does not implement the OpenFrp account-management OPENAPI. Future commercial OPENAPI integration requires the provider's written authorization under its published API terms.
