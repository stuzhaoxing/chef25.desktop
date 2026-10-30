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

## Optional Cloudflare Tunnel client

Remote access optionally downloads Cloudflare `cloudflared` **2026.10.6** directly from the official [GitHub Release](https://github.com/cloudflare/cloudflared/releases/tag/2026.10.6). Platform asset names and SHA-256 digests are pinned in `runtime.lock.json`. This client is not included in the installer. cloudflared is licensed under [Apache-2.0](https://github.com/cloudflare/cloudflared/blob/2026.10.6/LICENSE); its upstream source and third-party notices remain available in that repository. No Cloudflare dashboard UI/code is copied into this project.

Chef25 is an independent community project. Cloudflare accounts, domains and service usage remain subject to Cloudflare's terms. A tunnel connector token is not an account API token; this integration does not create accounts, register domains, buy plans or administer account-wide resources.
