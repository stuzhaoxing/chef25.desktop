#!/usr/bin/env python3
"""Compile layered macOS icons with Xcode 26+; keep legacy ICNS/Windows art intact."""
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def main():
    version = subprocess.check_output(
        ['xcrun', 'actool', '--version', '--output-format', 'human-readable-text'], text=True)
    if not re.search(r'\b(?:2[6-9]|[3-9]\d)\.', version):
        raise RuntimeError('Regenerating layered icons requires Xcode 26 or newer')
    for directory in ('icons', 'icons-dev'):
        folder = ROOT / 'src-tauri' / directory
        document = folder / 'Chef25.icon'
        (document / 'Assets').mkdir(parents=True, exist_ok=True)
        # Composer supplies the full orange tile and applies macOS padding itself.
        # Remove the legacy tile and undo its 52/64 canvas inset for the foreground.
        svg = (folder / 'source.svg').read_text()
        svg = re.sub(r'<!--.*?-->', '', svg, flags=re.S)
        svg, count = re.subn(r'<rect x="6"[^>]*/>', '', svg, count=1)
        if count != 1 or 'viewBox="0 0 64 64">' not in svg:
            raise RuntimeError('Legacy artwork geometry changed; review Composer scaling')
        svg = svg.replace('viewBox="0 0 64 64">',
                          'viewBox="0 0 64 64"><g transform="translate(-7.384615 -7.384615) scale(1.230769)">')
        svg = svg.replace('</svg>', '</g></svg>')
        if directory == 'icons-dev':
            # Keep the badge inside Tahoe's system mask instead of clipping its corner.
            svg = svg.replace('transform="scale(1.333333)"',
                              'transform="translate(4 4) scale(1.1)"')
        (document / 'Assets/foreground.svg').write_text(svg)
        definition = {
            'fill': {'solid': 'srgb:0.921569,0.376471,0.239216,1.000000'},
            'groups': [{
                'layers': [{'image-name': 'foreground.png', 'name': 'Chef hat and development badge' if directory == 'icons-dev' else 'Chef hat'}],
                'shadow': {'kind': 'neutral', 'opacity': 0},
                'translucency': {'enabled': False, 'value': 0},
                'specular': False,
            }],
            'supported-platforms': {'squares': 'shared'},
        }
        (document / 'icon.json').write_text(json.dumps(definition, indent=2) + '\n')
        with tempfile.TemporaryDirectory(prefix='chef25-icons-') as temporary:
            # Rasterize SVG strokes with Tauri's renderer: actool's SVG importer
            # changes some rounded joins and clips the development badge stroke.
            subprocess.run([str(ROOT / 'node_modules/.bin/tauri'), 'icon',
                            str(document / 'Assets/foreground.svg'), '--png', '1024',
                            '--output', temporary], check=True)
            shutil.copyfile(Path(temporary) / '1024x1024.png', document / 'Assets/foreground.png')
            subprocess.run([
                'xcrun', 'actool', str(document), '--compile', temporary,
                '--output-format', 'human-readable-text',
                '--output-partial-info-plist', str(Path(temporary) / 'info.plist'),
                '--app-icon', 'Chef25', '--include-all-app-icons',
                '--enable-on-demand-resources', 'NO', '--target-device', 'mac',
                '--minimum-deployment-target', '26.0', '--platform', 'macosx',
            ], check=True)
            catalog = Path(temporary) / 'Assets.car'
            assets = json.loads(subprocess.check_output(['xcrun', 'assetutil', '--info', str(catalog)]))
            if not any(asset.get('AssetType') == 'Icon Image' and asset.get('Name') == 'Chef25' for asset in assets):
                raise RuntimeError('Compiled catalog is missing the Chef25 app icon')
            shutil.copyfile(catalog, folder / 'Assets.car')


if __name__ == '__main__':
    main()
