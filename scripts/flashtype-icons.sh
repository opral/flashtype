#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
cd "$repo_root"

favicon_source="assets/icons/flashtype/favicon.svg"
app_source="assets/icons/flashtype/app-rounded.svg"
dev_app_source="assets/icons/flashtype/app-rounded-dev.svg"
markdown_source="assets/icons/flashtype/markdown-document.svg"

if ! command -v resvg >/dev/null 2>&1; then
	echo "Missing required command: resvg" >&2
	echo "Install it with: cargo install resvg" >&2
	exit 1
fi

favicon_destinations=(
	"public/icons/flashtype/flashtype-favicon.svg"
	"public/icons/flashtype/flashtype-favicon-rounded.svg"
	"public/icons/flashtype/safari-pinned-tab.svg"
	"website/public/favicon.svg"
)

app_svg_destinations=(
	"public/icons/flashtype/flashtype-icon-circle.svg"
	"public/icons/flashtype/flashtype-icon-maskable.svg"
)

iconset_files=(
	"16|icon_16x16.png"
	"32|icon_16x16@2x.png"
	"32|icon_32x32.png"
	"64|icon_32x32@2x.png"
	"128|icon_128x128.png"
	"256|icon_128x128@2x.png"
	"256|icon_256x256.png"
	"512|icon_256x256@2x.png"
	"512|icon_512x512.png"
	"1024|icon_512x512@2x.png"
)

ensure_parent() {
	mkdir -p "$(dirname "$1")"
}

copy_file() {
	local source="$1"
	local destination="$2"

	ensure_parent "$destination"
	cp "$source" "$destination"
	echo "Copied $repo_root/$destination"
}

render_png() {
	local source="$1"
	local destination="$2"
	local size="$3"

	ensure_parent "$destination"
	resvg --width "$size" --height "$size" "$source" "$destination" >/dev/null
	echo "Rendered $repo_root/$destination"
}

build_icns() {
	local source="$1"
	local destination="$2"
	local stem
	stem="$(basename "$destination" .icns)"

	local iconset="target/flashtype-icons/$stem.iconset"
	rm -rf "$iconset"
	mkdir -p "$iconset"

	local item size file_name
	for item in "${iconset_files[@]}"; do
		size="${item%%|*}"
		file_name="${item#*|}"
		render_png "$source" "$iconset/$file_name" "$size" >/dev/null
	done

	ensure_parent "$destination"
	iconutil -c icns "$iconset" -o "$destination"
	rm -rf "$iconset"
	echo "Packed $repo_root/$destination"
}

for destination in "${favicon_destinations[@]}"; do
	copy_file "$favicon_source" "$destination"
done

for destination in "${app_svg_destinations[@]}"; do
	copy_file "$app_source" "$destination"
done

render_png "$app_source" "build/icon.png" 1024
render_png "$dev_app_source" "build/icon-dev.png" 1024
build_icns "$app_source" "build/icon.icns"
build_icns "$dev_app_source" "build/icon-dev.icns"
build_icns "$markdown_source" "build/markdown.icns"

echo "Generated Flashtype icons."
