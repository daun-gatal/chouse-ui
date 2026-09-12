#!/bin/bash
#
# Build versioned chouse CLI archives for every supported platform.
#
#   ./scripts/build-cli.sh [version]
#
# Single build definition used by CI (auto-release.yml `cli` job) and local
# dev. Version defaults to the release tag in CI; locally pass e.g.
# `./scripts/build-cli.sh v3.13.0` or `dev`.
#
# Output: dist/chouse-cli_<os>_<arch>.{tar.gz,zip} + dist/checksums.txt
# Binaries embed version/commit/date via ldflags (see cli/cmd/chouse/main.go).
#
set -euo pipefail

cd "$(dirname "$0")/../cli"

VERSION="${1:-dev}"
COMMIT="${COMMIT_SHA:-$(git rev-parse --short HEAD 2>/dev/null || echo none)}"
DATE="${BUILD_DATE:-$(date -u +'%Y-%m-%dT%H:%M:%SZ')}"
OUTDIR="${OUTDIR:-dist}"

# Mirrors the Docker multi-arch set (linux/amd64, linux/arm64) plus the
# desktops CLI users actually run (darwin, windows).
PLATFORMS=(
  "linux/amd64"
  "linux/arm64"
  "darwin/amd64"
  "darwin/arm64"
  "windows/amd64"
)

rm -rf "$OUTDIR"
mkdir -p "$OUTDIR"

LDFLAGS="-s -w -X main.version=$VERSION -X main.commit=$COMMIT -X main.date=$DATE"

for PLAT in "${PLATFORMS[@]}"; do
  OS="${PLAT%/*}"
  ARCH="${PLAT#*/}"
  echo "Building chouse $VERSION ($OS/$ARCH)..."

  BIN="chouse"
  [ "$OS" = "windows" ] && BIN="chouse.exe"

  GOOS="$OS" GOARCH="$ARCH" CGO_ENABLED=0 \
    go build -trimpath -ldflags "$LDFLAGS" -o "$OUTDIR/$BIN" ./cmd/chouse

  ARCHIVE="chouse-cli_${OS}_${ARCH}"
  if [ "$OS" = "windows" ]; then
    # python3 is present on GH runners and most dev machines; zip(1) is not
    # guaranteed (and its flags differ between info-zip/BSD).
    python3 - "$OUTDIR" "$BIN" "$ARCHIVE" <<'PY'
import sys, zipfile
outdir, binary, archive = sys.argv[1], sys.argv[2], sys.argv[3]
with zipfile.ZipFile(f"{outdir}/{archive}.zip", "w", zipfile.ZIP_DEFLATED) as z:
    z.write(f"{outdir}/{binary}", binary)
PY
    rm "$OUTDIR/$BIN"
  else
    tar -czf "$OUTDIR/$ARCHIVE.tar.gz" -C "$OUTDIR" "$BIN"
    rm "$OUTDIR/$BIN"
  fi
done

(cd "$OUTDIR" && sha256sum ./* > checksums.txt)
echo "Wrote $(ls "$OUTDIR" | wc -l | tr -d ' ') files to cli/$OUTDIR:"
cat "$OUTDIR/checksums.txt"
