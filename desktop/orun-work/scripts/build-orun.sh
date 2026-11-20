#!/usr/bin/env bash
# Builds orun and places it where Tauri bundles it as a sidecar,
# so the Orun Work installer carries its own orun and needs nothing else.
#
# orun publishes macOS and Linux binaries only. It is pure Go (CGO off), so
# it cross-compiles; orun-windows.patch fixes the two places that assume a
# Unix host (a background run's process group, and opening the browser for
# `orun auth login` without cutting the URL at its first '&').
#
# Usage: scripts/build-orun.sh [rust-target-triple]
#   default: x86_64-pc-windows-msvc (what the Windows release runner builds).
#   x86_64-pc-windows-gnu when cross-building the installer from Linux;
#   the host's own triple (rustc -vV) for `npm run tauri dev`.
set -euo pipefail

ORUN_TAG="${ORUN_TAG:-v2.96.0}"
TRIPLE="${1:-x86_64-pc-windows-msvc}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git clone -q --depth 1 --branch "$ORUN_TAG" https://github.com/sourceplane/orun "$WORK/orun"
git -C "$WORK/orun" apply "$HERE/scripts/orun-windows.patch"
case "$TRIPLE" in
  x86_64-*) GOARCH=amd64 ;;
  aarch64-*) GOARCH=arm64 ;;
  *) echo "unsupported triple $TRIPLE" >&2; exit 1 ;;
esac
case "$TRIPLE" in
  *windows*) GOOS=windows EXT=.exe ;;
  *apple*) GOOS=darwin EXT= ;;
  *linux*) GOOS=linux EXT= ;;
  *) echo "unsupported triple $TRIPLE" >&2; exit 1 ;;
esac
OUT="$HERE/src-tauri/binaries/orun-${TRIPLE}${EXT}"
mkdir -p "$HERE/src-tauri/binaries"
(
  cd "$WORK/orun"
  GOTOOLCHAIN=auto GOOS=$GOOS GOARCH=$GOARCH CGO_ENABLED=0 \
    go build -trimpath -ldflags "-s -w -X main.version=${ORUN_TAG#v}" -o "$OUT" ./cmd/orun
)
echo "built ${OUT#$HERE/} (orun ${ORUN_TAG})"
