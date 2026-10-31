#!/usr/bin/env bash
# Removes the app and its data, saved captures are never touched
set -euo pipefail

APP_NAME="Capture"
APPIMAGE="${HOME}/Applications/${APP_NAME}.AppImage"
DESKTOP="${HOME}/.local/share/applications/capture.desktop"
ICON="${HOME}/.local/share/icons/hicolor/512x512/apps/capture.png"
DATA="${HOME}/.config/Capture"

usage() {
	cat <<EOF
Usage: $(basename "$0") [--dry-run]

Removes the ${APP_NAME} AppImage, its desktop entry and icon, and ${DATA}.
Saved captures are never touched.

Options:
  -n, --dry-run   Print what would be removed without deleting anything
  -h, --help      Show this message
EOF
}

dry_run=0

while [[ $# -gt 0 ]]; do
	case "$1" in
		-n | --dry-run) dry_run=1 ;;
		-h | --help)
			usage
			exit 0
			;;
		*)
			echo "Unknown option: $1" >&2
			usage >&2
			exit 2
			;;
	esac
	shift
done

remove() {
	local target="$1"

	if [[ ! -e "${target}" ]]; then
		return
	fi

	if [[ ${dry_run} -eq 1 ]]; then
		echo "would remove ${target}"
	else
		rm -rf "${target}"
		echo "removed ${target}"
	fi
}

remove "${APPIMAGE}"
remove "${DESKTOP}"
remove "${ICON}"
remove "${DATA}"

echo "Saved captures were left alone."

if [[ ${dry_run} -eq 0 ]] && command -v update-desktop-database > /dev/null 2>&1; then
	update-desktop-database "$(dirname "${DESKTOP}")" > /dev/null 2>&1 || true
fi

if [[ ${dry_run} -eq 1 ]]; then
	echo "Dry run: nothing was deleted."
fi
