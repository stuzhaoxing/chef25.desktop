# Application icon

`source.svg` uses the sidebar's Lucide ChefHat, colors, corner radius and
30/45 symbol-to-tile ratio, without the sidebar's rotation. The tile occupies
52/64 (81.25%) of the canvas, leaving transparent padding for the macOS Dock.
The copied Lucide artwork's license is retained in `LUCIDE-LICENSE`.

To regenerate, run `npm run tauri -- icon src-tauri/icons/source.svg --output <temporary-directory>`
from the project root. Copy only `32x32.png`, `128x128.png`, `128x128@2x.png`,
`icon.png`, `icon.icns` and `icon.ico` back into this directory. Other generated
platform assets are not used by this desktop application.

`build.rs` tracks this directory so icon changes rebuild the embedded development
Dock icon on the next `npm run desktop:dev` (or root `dev.sh`) launch. Installed
applications still need a newly packaged build; changing source assets does not
replace their icon or refresh their Dock cache.

Development icons live in `../icons-dev/`. Their source adds a blue, white-bordered
D badge at the bottom right, following 123 GPT's development icon convention.
Regenerate with `npm run tauri -- icon src-tauri/icons-dev/source.svg --output <temporary-directory>`
and copy the same six desktop assets into `icons-dev/`.
`npm run desktop:dev` (also used by the root `dev.sh`) and
`npm run desktop:build:dev` load `tauri.conf.dev.json`; production builds retain
the original icons. App identity and user data paths are unchanged.

## macOS 26 layered icon

`Chef25.icon/` separates the orange background from the ChefHat foreground.
macOS supplies the icon mask and outer padding; the foreground therefore undoes
our legacy 52/64 inset. This prevents Finder and Spotlight from placing the entire
padded orange tile inside a synthesized gray tile. The development catalog adds
the same blue D badge as its legacy artwork.

Run `python3 scripts/build-macos-icons.py` on a Mac with Xcode 26+ after editing
either `source.svg`. The script regenerates both Composer documents and validates
both `Assets.car` catalogs. The foreground is rasterized at 1024 px with Tauri
to preserve rounded SVG strokes; the development badge is inset to stay inside
the system mask. Commit these small compiled icon resources alongside
the sources so packaging does not silently depend on the build machine's Xcode
version. Tauri CLI 2.12.4+ copies the selected catalog into the app and derives
`CFBundleIconName` from it. Both production and development configurations include
their own catalog. The existing `.icns` remains the older-macOS fallback and the
`.ico` remains the Windows icon; the minimum supported macOS version is unchanged.

Verify the packaged app has `Contents/Resources/Assets.car`,
`CFBundleIconName = Chef25`, and `CFBundleIconFile = icon.icns`. Check its actual
system-rendered icon with `NSWorkspace.icon(forFile:)`, plus Finder and Dock after
installing a newly signed build. Do not patch a signed installed app in place.
