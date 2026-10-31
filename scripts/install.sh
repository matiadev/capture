#!/usr/bin/env bash
# Installs the built AppImage into ~/Applications and registers a desktop entry
set -euo pipefail

APP_NAME="Capture"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

APP_DIR="${HOME}/Applications"
APPIMAGE="${APP_DIR}/${APP_NAME}.AppImage"
DESKTOP_DIR="${HOME}/.local/share/applications"
DESKTOP="${DESKTOP_DIR}/capture.desktop"
ICON_DIR="${HOME}/.local/share/icons/hicolor/512x512/apps"
ICON="${ICON_DIR}/capture.png"

usage() {
	cat <<EOF
Usage: $(basename "$0")

Builds the AppImage if dist/ is empty, installs it to ${APPIMAGE},
and registers a desktop entry and icon.

Options:
  -h, --help   Show this message
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
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

if ! compgen -G "${ROOT}/dist/*.AppImage" > /dev/null; then
	echo "No AppImage in dist/. Building one first..."
	(cd "${ROOT}" && pnpm dist)
fi

SRC="$(ls -t "${ROOT}"/dist/*.AppImage | head -1)"

mkdir -p "${APP_DIR}" "${DESKTOP_DIR}" "${ICON_DIR}"

install -m 755 "${SRC}" "${APPIMAGE}"
install -m 644 "${ROOT}/assets/icon.png" "${ICON}"

cat > "${DESKTOP}" <<EOF
[Desktop Entry]
Type=Application
Name=${APP_NAME}
Comment=Capture a full web page as video or image
Exec=${APPIMAGE}
Icon=${ICON}
Terminal=false
Categories=Utility;Graphics;
StartupWMClass=${APP_NAME}
EOF

chmod 644 "${DESKTOP}"

if command -v update-desktop-database > /dev/null 2>&1; then
	update-desktop-database "${DESKTOP_DIR}" > /dev/null 2>&1 || true
fi

echo "Installed ${APPIMAGE}"
echo "Registered ${DESKTOP}"
