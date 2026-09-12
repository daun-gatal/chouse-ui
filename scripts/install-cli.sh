#!/usr/bin/env sh
# chouse CLI installer: curl -sSL <release>/install-cli.sh | bash
# Env: CHOUSE_VERSION (default: latest), INSTALL_DIR (default: /usr/local/bin or ~/.local/bin),
#      CHOUSE_NO_MODIFY_PATH=1 (default: unset — installer appends DEST to PATH in your shell rc files)
set -eu

REPO="${REPO:-daun-gatal/chouse-ui}"
VERSION="${CHOUSE_VERSION:-latest}"
MARKER="# chouse CLI (added by install-cli.sh)"

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
    # per_page=100 (API max): app vX releases are frequent and would push
    # cli-v* tags off a smaller first page, breaking `latest` resolution.
    # Token auth (GH_TOKEN/GITHUB_TOKEN, e.g. in CI) gets a 5000/hr quota
    # instead of the shared 60/hr unauthenticated one; --retry rides out
    # transient egress flakes. curl errors stay visible (no 2>/dev/null)
    # so the next failure is diagnosable.
    if [ -n "${GH_TOKEN:-}" ]; then
      API_AUTH="Authorization: Bearer $GH_TOKEN"
    elif [ -n "${GITHUB_TOKEN:-}" ]; then
      API_AUTH="Authorization: Bearer $GITHUB_TOKEN"
    else
      API_AUTH=""
    fi
    if [ -n "$API_AUTH" ]; then
      TAG="$(curl -fsSL --retry 3 --retry-all-errors -H "$API_AUTH" "https://api.github.com/repos/$REPO/releases?per_page=100" | grep -o '"tag_name": *"cli-v[^"]*"' | head -n1 | cut -d'"' -f4 || true)"
    else
      TAG="$(curl -fsSL --retry 3 --retry-all-errors "https://api.github.com/repos/$REPO/releases?per_page=100" | grep -o '"tag_name": *"cli-v[^"]*"' | head -n1 | cut -d'"' -f4 || true)"
    fi
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

verify_checksums() {
  # Stock macOS has no sha256sum (it ships shasum instead). Filter the
  # manifest down to the downloaded asset so neither tool needs an
  # "ignore missing entries" flag (shasum has none).
  if ! grep -F "$ASSET" "$TMP/checksums.txt" > "$TMP/checksums.one" 2>/dev/null; then
    echo "checksum entry for $ASSET not found in checksums.txt" >&2
    exit 1
  fi
  if [ ! -s "$TMP/checksums.one" ]; then
    echo "checksum entry for $ASSET not found in checksums.txt" >&2
    exit 1
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$TMP" && sha256sum -c "checksums.one" --status)
  elif command -v shasum >/dev/null 2>&1; then
    (cd "$TMP" && shasum -a 256 -c "checksums.one" --status)
  else
    echo "need sha256sum or shasum to verify checksums" >&2
    exit 1
  fi
}

add_path_block() {
  # Idempotent: appends "<marker>\n<line>" to $1 unless the marker is there.
  file="$1"
  line="$2"
  if [ -e "$file" ] && grep -qF "$MARKER" "$file" 2>/dev/null; then
    return 0
  fi
  printf '%s\n%s\n' "$MARKER" "$line" >> "$file"
  echo "Added $DEST to PATH in $file"
}

ensure_path() {
  # DEST already visible — nothing to do.
  case ":$PATH:" in
    *":$DEST:"*) return 0 ;;
  esac
  if [ "${CHOUSE_NO_MODIFY_PATH:-}" = "1" ]; then
    echo "Note: $DEST is not on PATH. Add: export PATH=\"$DEST:\$PATH\"" >&2
    echo "      (automatic PATH setup skipped via CHOUSE_NO_MODIFY_PATH=1)" >&2
    return 0
  fi
  SH_LINE="case \":\$PATH:\" in *\":$DEST:\"*) ;; *) export PATH=\"$DEST:\$PATH\" ;; esac"
  SHELL_NAME="$(basename "${SHELL:-sh}" 2>/dev/null || echo sh)"
  case "$SHELL_NAME" in
    fish)
      FISH_CFG="$HOME/.config/fish/config.fish"
      mkdir -p "$HOME/.config/fish"
      FISH_LINE="if not contains $DEST \$PATH; set -gx PATH $DEST \$PATH; end"
      add_path_block "$FISH_CFG" "$FISH_LINE"
      ;;
    zsh)
      add_path_block "$HOME/.zshrc" "$SH_LINE"
      ;;
    bash)
      add_path_block "$HOME/.bashrc" "$SH_LINE"
      if [ -e "$HOME/.bash_profile" ]; then
        add_path_block "$HOME/.bash_profile" "$SH_LINE"
      else
        add_path_block "$HOME/.profile" "$SH_LINE"
      fi
      ;;
    *)
      add_path_block "$HOME/.profile" "$SH_LINE"
      ;;
  esac
  echo "Restart your shell or run: export PATH=\"$DEST:\$PATH\"" >&2
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
  verify_checksums || {
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
  mkdir -p "$DEST"
  install -m 0755 "$BIN_SRC" "$DEST/chouse"
  echo "Installed $( "$DEST/chouse" version --output json 2>/dev/null || echo chouse ) to $DEST/chouse"
  ensure_path
}

main "$@"
