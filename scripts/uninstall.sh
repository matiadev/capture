#!/usr/bin/env bash
# Removes everything install.sh created, plus app data and saved captures.
set -euo pipefail

APP_NAME="Capture"
APPIMAGE="${HOME}/Applications/${APP_NAME}.AppImage"
DESKTOP="${HOME}/.local/share/applications/capture.desktop"
ICON="${HOME}/.local/share/icons/hicolor/512x512/apps/capture.png"
DATA="${HOME}/.config/Capture"

for target in "${APPIMAGE}" "${DESKTOP}" "${ICON}"; do
	if [[ -e "${target}" ]]; then
		rm -f "${target}"
		echo "removed ${target}"
	fi
done

if [[ -d "${DATA}" ]]; then
	rm -rf "${DATA}"
	echo "removed ${DATA}"
fi

echo "Captures in ${HOME}/Videos were left alone."

if command -v update-desktop-database > /dev/null 2>&1; then
	update-desktop-database "$(dirname "${DESKTOP}")" > /dev/null 2>&1 || true
fi

echo "Done."
