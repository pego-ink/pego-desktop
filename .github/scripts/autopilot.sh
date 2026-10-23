#!/usr/bin/env bash
# Shared helpers for the trusted autopilot workflows (autopilot.yml, claude-review.yml,
# changelog-check.yml, notify.yml). Source it from a checkout of `dev`, never from a PR:
#   source .github/scripts/autopilot.sh
#
# Environment:
#   GITHUB_REPOSITORY  owner/repo (set by Actions)
#   GH_TOKEN           GITHUB_TOKEN: reads, labels and comments (its events start no workflows)
#   APP_TOKEN, APP_ID  pego-bot installation token and App id: check runs (ap_check)
#   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID  optional (ap_telegram)
#
# Everything a PR controls (titles, branch names, file names, Claude output) reaches these
# functions as arguments or files, never as code.

AP_OWNER=yolkmonday
# shellcheck disable=SC2034 # used by the workflows that source this file
AP_ENTRIES=apps/changelog/src/content/entries/

# Prints the open PRs into dev from this repository whose head is $1, one number per line.
ap_prs_for_sha() {
  gh api "repos/$GITHUB_REPOSITORY/commits/$1/pulls" --jq \
    ".[] | select(.state == \"open\" and .base.ref == \"dev\" and .head.sha == \"$1\"
      and .head.repo.full_name == \"$GITHUB_REPOSITORY\") | .number"
}

# Prints the id of the workflow defined in .github/workflows/$1.
ap_workflow_id() {
  gh api "repos/$GITHUB_REPOSITORY/actions/workflows/$1" --jq .id
}

# Upserts the pego-bot check run $1 on commit $2: conclusion $3, title $4, summary $5 (markdown),
# optional details URL $6. Prints the conclusion it had before ("" when new), so callers notify
# only on a change.
ap_check() {
  local name="$1" sha="$2" conclusion="$3" title="$4" summary="$5" url="${6:-}" previous body
  previous="$(GH_TOKEN="$APP_TOKEN" gh api -X GET "repos/$GITHUB_REPOSITORY/commits/$sha/check-runs" \
    -f check_name="$name" -F app_id="$APP_ID" -f filter=latest \
    --jq '.check_runs | sort_by(.id) | last | if . == null then "" else "\(.id) \(.conclusion // "")" end')"
  body="$(jq -n --arg name "$name" --arg sha "$sha" --arg c "$conclusion" --arg t "$title" \
    --arg s "${summary:0:60000}" --arg u "$url" '
      {name: $name, head_sha: $sha, status: "completed", conclusion: $c,
       output: {title: $t, summary: $s}} + (if $u == "" then {} else {details_url: $u} end)')"
  if [ -n "$previous" ]; then
    printf '%s' "$body" | GH_TOKEN="$APP_TOKEN" gh api -X PATCH \
      "repos/$GITHUB_REPOSITORY/check-runs/${previous%% *}" --input - >/dev/null
  else
    printf '%s' "$body" | GH_TOKEN="$APP_TOKEN" gh api "repos/$GITHUB_REPOSITORY/check-runs" \
      --input - >/dev/null
  fi
  echo "$name on ${sha:0:7}: $conclusion ($title)" >&2
  printf '%s\n' "${previous#* }"
}

ap_ensure_label() {
  local color description
  case "$1" in
    autopilot) color=0e8a16 description="Merges on its own once every check passes" ;;
    needs-owner-review) color=d93f0b description="Touches a sensitive path; @$AP_OWNER reviews it" ;;
    needs-fixes) color=b60205 description="Claude review found something to fix" ;;
    no-changelog) color=ededed description="Changes nothing users see; needs no changelog entry" ;;
    *) color=ededed description="" ;;
  esac
  gh label create "$1" --repo "$GITHUB_REPOSITORY" --color "$color" --description "$description" \
    >/dev/null 2>&1 || true
}

# ap_label PR add|remove LABEL
ap_label() {
  local has
  has="$(gh api "repos/$GITHUB_REPOSITORY/issues/$1/labels" --jq "[.[].name] | index(\"$3\") != null")"
  if [ "$2" = add ] && [ "$has" != true ]; then
    ap_ensure_label "$3"
    gh api "repos/$GITHUB_REPOSITORY/issues/$1/labels" -f "labels[]=$3" >/dev/null ||
      echo "::warning::could not add label $3"
  elif [ "$2" = remove ] && [ "$has" = true ]; then
    gh api -X DELETE "repos/$GITHUB_REPOSITORY/issues/$1/labels/$3" >/dev/null || true
  fi
}

# ap_has_label PR LABEL: exit status 0 when the PR has it (fresh from the API).
ap_has_label() {
  [ "$(gh api "repos/$GITHUB_REPOSITORY/issues/$1/labels" \
    --jq "[.[].name] | index(\"$2\") != null")" = true ]
}

# ap_sticky PR MARKER BODY [create]: updates the github-actions comment holding MARKER, or creates
# it when the 4th argument is "create".
ap_sticky() {
  local pr="$1" marker="$2" text="$3" found id body
  found="$(gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$pr/comments?per_page=100" \
    --jq ".[] | select(.user.login == \"github-actions[bot]\" and (.body | contains(\"$marker\"))) | {id, body}" |
    jq -s 'last // {}')"
  id="$(jq -r '.id // empty' <<<"$found")"
  body="$(jq -n --arg b "$text"$'\n\n'"$marker" '{body: $b}')"
  if [ -n "$id" ] && [ "$(jq -r .body <<<"$found")" = "$(jq -r .body <<<"$body")" ]; then
    return 0
  elif [ -n "$id" ]; then
    printf '%s' "$body" | gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$id" --input - >/dev/null
  elif [ "${4:-}" = create ]; then
    printf '%s' "$body" | gh api "repos/$GITHUB_REPOSITORY/issues/$pr/comments" --input - >/dev/null
  fi
}

# Sends $1 to the owner on Telegram; a notice (not a failure) without the secrets.
ap_telegram() {
  if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
    echo "::notice::TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are not set; no Telegram message."
    return 0
  fi
  printf '%s' "$1" | head -c 4000 >"$RUNNER_TEMP/telegram.txt"
  # The URL (with the token) goes through a curl config on stdin, never the command line.
  if ! curl -sS --fail-with-body --retry 3 -o "$RUNNER_TEMP/telegram.json" -K - \
    --data-urlencode "chat_id=$TELEGRAM_CHAT_ID" \
    --data-urlencode "text@$RUNNER_TEMP/telegram.txt" \
    --data-urlencode "disable_web_page_preview=true" <<EOF; then
url = "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage"
EOF
    echo "::warning::Telegram refused the message: $(jq -r '.description // "unknown error"' "$RUNNER_TEMP/telegram.json" 2>/dev/null)"
  fi
}

# URL-encodes a repo path segment by segment (keeps the slashes).
ap_urlpath() {
  jq -rn --arg p "$1" '$p | split("/") | map(@uri) | join("/")'
}

# ap_pr_files PR: prints "<filename>\t<previous filename>" per changed file (the API stops at
# 3000 files; sensitive-paths.ts --expect detects that).
ap_pr_files() {
  gh api --paginate "repos/$GITHUB_REPOSITORY/pulls/$1/files?per_page=100" \
    --jq '.[] | "\(.filename)\t\(.previous_filename // "")"'
}
