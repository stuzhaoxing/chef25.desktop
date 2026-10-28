# Third-party notices

Chef25 Desktop is an independent project, not an official SillyTavern distribution.

| Component          | Source                                                                                   | License                                          | Distribution                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| SillyTavern 1.19.0 | https://github.com/SillyTavern/SillyTavern/tree/7e8663cd9c184a550b37238218bdd32c6efc68e9 | AGPL-3.0                                         | Unmodified source, lockfile, dependencies and complete source archive in runtime resources |
| Node.js            | https://github.com/nodejs/node                                                           | Node.js license with bundled third-party notices | Runtime binary and NODE-LICENSE                                                            |
| Tauri              | https://github.com/tauri-apps/tauri                                                      | MIT / Apache-2.0                                 | Native application framework                                                               |
| React              | https://github.com/facebook/react                                                        | MIT                                              | Frontend runtime                                                                           |
| Lucide             | https://github.com/lucide-icons/lucide                                                   | ISC                                              | Interface icons                                                                            |

Exact Node version is recorded in `.node-version`; runtime provenance is recorded in the packaged `manifest.json`. Dependencies retain their own licenses. A release must include Chef25's matching source archive, lockfiles and notices alongside installers. Do not remove upstream license files or network source-access notices.

Before releasing, review all transitive dependency notices and any platform signing requirements. Build artifacts alone are not evidence of that review.
