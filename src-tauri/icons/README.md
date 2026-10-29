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
