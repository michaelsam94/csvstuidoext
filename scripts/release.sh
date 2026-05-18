#!/usr/bin/env bash
# Create a version tag and push to GitHub (triggers .github/workflows/release.yml).
#
# Usage:
#   ./scripts/release.sh 0.1.1
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <version>   e.g. $0 0.1.1" >&2
  exit 1
fi

TAG="v${VERSION}"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Tag $TAG already exists locally." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required." >&2
  exit 1
fi

echo "Setting package.json version to $VERSION ..."
npm version "$VERSION" --no-git-tag-version

git add package.json package-lock.json
git commit -m "Release $TAG"

git tag -a "$TAG" -m "Release $TAG"

echo "Pushing main and tag $TAG ..."
git push origin main
git push origin "$TAG"

echo "Done. GitHub Actions will build the VSIX for release $TAG."
