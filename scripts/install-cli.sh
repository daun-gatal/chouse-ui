#!/usr/bin/env sh
# chouse CLI installer: curl -sSL <release>/install-cli.sh | bash
# Env: CHOUSE_VERSION (default: latest), INSTALL_DIR (default: /usr/local/bin or ~/.local/bin)
set -eu

REPO="${REPO:-daun-gatal/chouse-ui}"
VERSION="${CHOUSE_VERSION:-latest}"

detect_os_arch() {
  OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  ARCH="$(uname -m)"
  case "$OS" in
    linux|darwin) ;;
    mingw*|msys*|cygwin*|windowsnt) OS="windows" ;;
    *) echo "unsupported OS: $OS" >&2; exit 2 ;;
  esac
  case "$ARCH" in
    x86_64|amd64) ARCH="amd64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *) echo "unsupported arch: $ARCH" >&2; exit 2 ;;
  esac
  if [ "$OS" = "windows" ]; then
    EXT="zip"
  else
    EXT="tar.gz"
  fi
}

resolve_version() {
  # The CLI versions independently (tags cli-vX, see cli-release.yml) while
  # the app ships vX tags with no CLI assets — so resolve against cli-v*
  # releases, never `releases/latest` (which follows the app).
  if [ "$VERSION" = "latest" ]; then
    TAG="$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=20" 2>/dev/null | grep -o '"tag_name": *"cli-v[^"]*"' | head -n1 | cut -d'"' -f4 || true)"
    if [ -z "${TAG:-}" ]; then
      echo "no cli-v* release found for $REPO" >&2
      exit 1
    fi
  else
    case "$VERSION" in
      cli-v*) TAG="$VERSION" ;;
      v*) TAG="cli-$VERSION" ;;
      *) TAG="cli-v$VERSION" ;;
    esac
  fi
}

main() {
  detect_os_arch
  resolve_version
  echo "Installing chouse $TAG ($OS/$ARCH)…"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT INT TERM
  ASSET="chouse-cli_${OS}_${ARCH}.${EXT}"
  BASE="https://github.com/$REPO/releases/download/$TAG"
  curl -fsSL "$BASE/$ASSET" -o "$TMP/$ASSET"
  curl -fsSL "$BASE/checksums.txt" -o "$TMP/checksums.txt"
  (cd "$TMP" && sha256sum -c "checksums.txt" --ignore-missing --status) || {
    echo "checksum verification failed for $ASSET" >&2
    exit 1
  }
  case "$EXT" in
    tar.gz) tar -xzf "$TMP/$ASSET" -C "$TMP" ;;
    zip) unzip -q "$TMP/$ASSET" -d "$TMP" ;;
  esac
  BIN_SRC="$TMP/chouse"
  [ "$OS" = "windows" ] && BIN_SRC="$TMP/chouse.exe"
  if [ ! -f "$BIN_SRC" ]; then
    # archives nest the binary under the project dir in some layouts
    BIN_SRC="$(find "$TMP" -name 'chouse*' -type f | head -n1)"
  fi
  DEST="${INSTALL_DIR:-}"
  if [ -z "$DEST" ]; then
    if [ -w /usr/local/bin ]; then
      DEST="/usr/local/bin"
    else
      DEST="$HOME/.local/bin"
      mkdir -p "$DEST"
    fi
  fi
  install -m 0755 "$BIN_SRC" "$DEST/chouse"
  echo "Installed $( "$DEST/chouse" version --output json 2>/dev/null || echo chouse ) to $DEST/chouse"
  case ":$PATH:" in
    *":$DEST:"*) ;;
    *) echo "Note: $DEST is not on PATH. Add: export PATH=\"$DEST:\$PATH\"" >&2 ;;
  esac
}

main "$@"
