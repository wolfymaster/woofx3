#!/usr/bin/env bash
#
# Creates, redeploys and removes the preview engine for a pull request, through
# the woofx3 maintenance API, and keeps one sticky comment on the pull request
# saying where it is.
#
#   preview-engine.sh up <pr-number> <image-version>
#   preview-engine.sh down <pr-number>
#
# Environment:
#   MAINTENANCE_API_URL   base URL of the maintenance API (no trailing slash)
#   MAINTENANCE_API_KEY   wx3m_… key with the previews:write scope
#   GH_TOKEN              token for the gh CLI, to write the comment
#   GITHUB_REPOSITORY     owner/repo (set by Actions)
#
# One engine per pull request: it is found by its owner reference
# (`<owner>/<repo>#<number>`), so a rerun redeploys rather than creating a
# second one, and `down` is a no-op when there is nothing left.
set -euo pipefail

MAINTENANCE_API_URL="${MAINTENANCE_API_URL:?MAINTENANCE_API_URL is required}"
MAINTENANCE_API_KEY="${MAINTENANCE_API_KEY:?MAINTENANCE_API_KEY is required}"
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

# Previews are throwaway: gone after this long even if the "closed" run never
# happens (the maintenance API's reaper deletes them).
TTL_HOURS="${TTL_HOURS:-72}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-15}"
POLL_TIMEOUT_SECONDS="${POLL_TIMEOUT_SECONDS:-1200}"

# Marks this workflow's comment so it is updated instead of duplicated.
COMMENT_MARKER="<!-- woofx3:preview-engine -->"

command="${1:?usage: preview-engine.sh up|down <pr-number> [image-version]}"
pr_number="${2:?usage: preview-engine.sh up|down <pr-number> [image-version]}"
owner_ref="${GITHUB_REPOSITORY}#${pr_number}"
slug="pr-${pr_number}-woofx3"

api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(--silent --show-error --fail-with-body
    --request "$method"
    --header "Authorization: Bearer ${MAINTENANCE_API_KEY}"
    --header "Content-Type: application/json")
  if [ -n "$body" ]; then
    args+=(--data "$body")
  fi
  curl "${args[@]}" "${MAINTENANCE_API_URL}${path}"
}

# The engine for this pull request, or "" when it has none. The list endpoint
# answers `{ "engines": [...] }`.
find_engine_id() {
  api GET "/v1/engines?ownerType=github&ownerRef=$(jq --raw-output --null-input --arg ref "$owner_ref" '$ref|@uri')" |
    jq --raw-output '(.engines // [])[0].id // ""'
}

comment() {
  local body="$1"
  local existing
  # gh needs the marker to find its own comment; anything else on the pull
  # request is left alone.
  existing="$(gh api "repos/${GITHUB_REPOSITORY}/issues/${pr_number}/comments" --paginate \
    --jq "map(select(.body | contains(\"${COMMENT_MARKER}\"))) | .[0].id // empty")"
  if [ -n "$existing" ]; then
    # --raw-field, not --field: the latter coerces values that look like
    # numbers or booleans, and a comment body is always a string.
    gh api --method PATCH "repos/${GITHUB_REPOSITORY}/issues/comments/${existing}" \
      --raw-field "body=${COMMENT_MARKER}"$'\n'"${body}" >/dev/null
  else
    gh api --method POST "repos/${GITHUB_REPOSITORY}/issues/${pr_number}/comments" \
      --raw-field "body=${COMMENT_MARKER}"$'\n'"${body}" >/dev/null
  fi
}

case "$command" in
up)
  version="${3:?usage: preview-engine.sh up <pr-number> <image-version>}"
  engine_id="$(find_engine_id)"

  if [ -z "$engine_id" ]; then
    echo "Creating preview engine ${slug} on ${version}"
    created="$(api POST "/v1/engines" "$(jq --null-input \
      --arg slug "$slug" \
      --arg ref "$owner_ref" \
      --arg version "$version" \
      --argjson ttl "$TTL_HOURS" \
      '{slug: $slug, kind: "preview", owner: {type: "github", ref: $ref}, version: $version, ttlHours: $ttl}')")"
    engine_id="$(echo "$created" | jq --raw-output '.engine.id')"
  else
    echo "Redeploying preview engine ${engine_id} on ${version}"
    api POST "/v1/engines/${engine_id}/redeploy" \
      "$(jq --null-input --arg version "$version" '{version: $version}')" >/dev/null
  fi

  if [ -z "$engine_id" ] || [ "$engine_id" = "null" ]; then
    comment "Preview engine failed: the maintenance API returned no engine id."
    echo "preview-engine: no engine id returned" >&2
    exit 1
  fi

  comment "Preview engine \`${slug}\` is building \`${version}\`…"

  echo "Waiting for the engine to be ready (up to ${POLL_TIMEOUT_SECONDS}s)"
  deadline=$(( SECONDS + POLL_TIMEOUT_SECONDS ))
  status=""
  engine=""
  while [ "$SECONDS" -lt "$deadline" ]; do
    engine="$(api GET "/v1/engines/${engine_id}")"
    status="$(echo "$engine" | jq --raw-output '.engine.status')"
    case "$status" in
    ready | failed) break ;;
    esac
    sleep "$POLL_INTERVAL_SECONDS"
  done

  if [ "$status" = "ready" ]; then
    url="$(echo "$engine" | jq --raw-output '.engine.publicUrl // ""')"
    echo "Preview engine ready at ${url}"
    comment "Preview engine ready: ${url}

Running \`${version}\`. It is removed when this pull request closes, and expires after ${TTL_HOURS} hours."
    exit 0
  fi

  # A run that failed names the step it failed on; a run still going has
  # simply outlived the wait.
  step="$(echo "$engine" | jq --raw-output '.run.currentStep // "unknown"')"
  error="$(echo "$engine" | jq --raw-output '.run.error // "no error reported"')"
  if [ "$status" = "failed" ]; then
    comment "Preview engine failed at step \`${step}\`: ${error}"
    echo "preview-engine: provisioning failed at ${step}: ${error}" >&2
  else
    comment "Preview engine did not become ready within ${POLL_TIMEOUT_SECONDS}s (last status: \`${status:-unknown}\`, step \`${step}\`)."
    echo "preview-engine: timed out waiting for the engine (last status ${status:-unknown})" >&2
  fi
  exit 1
  ;;

down)
  engine_id="$(find_engine_id)"
  if [ -z "$engine_id" ]; then
    echo "No preview engine for ${owner_ref}; nothing to remove"
    exit 0
  fi
  echo "Removing preview engine ${engine_id}"
  api DELETE "/v1/engines/${engine_id}" >/dev/null
  comment "Preview engine removed."
  ;;

*)
  echo "usage: preview-engine.sh up|down <pr-number> [image-version]" >&2
  exit 2
  ;;
esac
