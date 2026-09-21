#!/usr/bin/env bash
#
# semantic-release's verifyRelease step (see .releaserc.json). It runs twice
# per release: once in a dry run, to hand the next tag to the jobs that build
# the image and archives, and again when publishing, where the tag must still
# be the one those artifacts were built as. A commit landing on master in
# between could change it, and a release must never carry artifacts that
# report a different version than its tag.

set -euo pipefail

tag="${1:?usage: release-tag.sh <tag>}"

if [[ -n "${RELEASE_EXPECTED_TAG:-}" && "$tag" != "$RELEASE_EXPECTED_TAG" ]]; then
    echo "semantic-release would publish ${tag}, but the artifacts were built as ${RELEASE_EXPECTED_TAG}" >&2
    exit 1
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "tag=${tag}" >> "$GITHUB_OUTPUT"
fi
