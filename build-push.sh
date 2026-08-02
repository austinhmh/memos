#!/usr/bin/env bash

# Push the current commit, wait for GitHub Actions, and print the immutable GHCR image.

set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIRECTORY}"

die() {
    echo "错误: $*" >&2
    exit 1
}

load_env_file() {
    local env_file="$1"
    local line key value

    [ -f "$env_file" ] || return 0
    echo "加载 .env 配置文件（仅导入脚本允许的变量）..." >&2

    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        case "$line" in
            ''|'#'*) continue ;;
            export\ *) line="${line#export }" ;;
        esac
        [[ "$line" == *=* ]] || continue
        key="${line%%=*}"
        value="${line#*=}"
        key="${key//[[:space:]]/}"
        value="${value#${value%%[![:space:]]*}}"
        value="${value%${value##*[![:space:]]}}"
        if [[ "$value" == \"*\" && "$value" == *\" && ${#value} -ge 2 ]]; then
            value="${value:1:${#value}-2}"
        elif [[ "$value" == \'*\' && "$value" == *\' && ${#value} -ge 2 ]]; then
            value="${value:1:${#value}-2}"
        fi

        [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die ".env 中存在非法变量名: $key"
        case "$key" in
            GITHUB_USERNAME|GITHUB_TOKEN|MEMOS_BUILD_REMOTE|MEMOS_BUILD_WORKFLOW|MEMOS_BUILD_REPOSITORY|MEMOS_BUILD_IMAGE|MEMOS_BUILD_RUN_DISCOVERY_TIMEOUT_SECONDS|MEMOS_BUILD_RUN_DISCOVERY_POLL_SECONDS|MEMOS_BUILD_RUN_STATUS_TIMEOUT_SECONDS|MEMOS_BUILD_RUN_STATUS_POLL_SECONDS|MEMOS_BUILD_GITHUB_API_BASE)
                if [ -z "${!key+x}" ]; then
                    export "$key=$value"
                fi
                ;;
            *)
                ;;
        esac
    done < "$env_file"
}

validate_positive_integer() {
    local variable_name="$1"
    local variable_value="$2"

    [[ "${variable_value}" =~ ^[1-9][0-9]*$ ]] || die "${variable_name} 必须是正整数: ${variable_value}"
}

load_env_file ".env"

REMOTE_NAME="${MEMOS_BUILD_REMOTE:-origin}"
WORKFLOW_FILE="${MEMOS_BUILD_WORKFLOW:-austin-ci-ghcr.yml}"
REPOSITORY="${MEMOS_BUILD_REPOSITORY:-austinhmh/memos}"
IMAGE_NAME="${MEMOS_BUILD_IMAGE:-ghcr.io/austinhmh/memos}"
RUN_DISCOVERY_TIMEOUT_SECONDS="${MEMOS_BUILD_RUN_DISCOVERY_TIMEOUT_SECONDS:-300}"
RUN_DISCOVERY_POLL_SECONDS="${MEMOS_BUILD_RUN_DISCOVERY_POLL_SECONDS:-15}"
RUN_STATUS_TIMEOUT_SECONDS="${MEMOS_BUILD_RUN_STATUS_TIMEOUT_SECONDS:-7200}"
RUN_STATUS_POLL_SECONDS="${MEMOS_BUILD_RUN_STATUS_POLL_SECONDS:-60}"
GITHUB_API_BASE="${MEMOS_BUILD_GITHUB_API_BASE:-https://api.github.com}"

validate_positive_integer "MEMOS_BUILD_RUN_DISCOVERY_TIMEOUT_SECONDS" "${RUN_DISCOVERY_TIMEOUT_SECONDS}"
validate_positive_integer "MEMOS_BUILD_RUN_DISCOVERY_POLL_SECONDS" "${RUN_DISCOVERY_POLL_SECONDS}"
validate_positive_integer "MEMOS_BUILD_RUN_STATUS_TIMEOUT_SECONDS" "${RUN_STATUS_TIMEOUT_SECONDS}"
validate_positive_integer "MEMOS_BUILD_RUN_STATUS_POLL_SECONDS" "${RUN_STATUS_POLL_SECONDS}"

command -v git >/dev/null 2>&1 || die "未找到 git"
command -v curl >/dev/null 2>&1 || die "未找到 curl"
command -v jq >/dev/null 2>&1 || die "未找到 jq"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "当前目录不是 Git 仓库"

BRANCH_NAME="$(git branch --show-current)"
[ -n "${BRANCH_NAME}" ] || die "不支持 detached HEAD"
if [[ "${BRANCH_NAME}" != "main" && "${BRANCH_NAME}" != feat/* ]]; then
    die "分支 ${BRANCH_NAME} 不会触发 ${WORKFLOW_FILE}；请使用 main 或 feat/**"
fi

git remote get-url "${REMOTE_NAME}" >/dev/null 2>&1 || die "Git remote ${REMOTE_NAME} 不存在"
[ -z "$(git status --porcelain --untracked-files=all)" ] || die "工作区不干净，请先提交准备构建的改动"

COMMIT_SHA="$(git rev-parse HEAD)"
[[ "${COMMIT_SHA}" =~ ^[0-9a-f]{40}$ ]] || die "无法取得完整提交 SHA"

GITHUB_API_TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
[ -n "${GITHUB_API_TOKEN}" ] || die "请在 .env 中设置 GITHUB_TOKEN"
[[ "${GITHUB_API_TOKEN}" != ghp_replace* ]] || die "GITHUB_TOKEN 仍是示例占位值"

github_api_get() {
    local request_url="$1"
    shift

    curl \
        --connect-timeout 10 \
        --fail \
        --location \
        --max-time 60 \
        --silent \
        --show-error \
        --header "Accept: application/vnd.github+json" \
        --header "X-GitHub-Api-Version: 2022-11-28" \
        --header "Authorization: Bearer ${GITHUB_API_TOKEN}" \
        "$@" \
        "${request_url}"
}

push_current_branch() {
    local askpass_script
    askpass_script="$(mktemp)"
    trap 'rm -f "${askpass_script}"' RETURN
    chmod 700 "${askpass_script}"
    cat > "${askpass_script}" <<'EOF'
#!/usr/bin/env sh
case "$1" in
  *Username*) printf '%s\n' 'x-access-token' ;;
  *Password*) printf '%s\n' "${MEMOS_GIT_PUSH_TOKEN}" ;;
  *) printf '\n' ;;
esac
EOF

    MEMOS_GIT_PUSH_TOKEN="${GITHUB_API_TOKEN}" \
        GIT_ASKPASS="${askpass_script}" \
        GIT_TERMINAL_PROMPT=0 \
        git -c credential.helper= push "${REMOTE_NAME}" "HEAD:refs/heads/${BRANCH_NAME}"
}

find_workflow_run_id() {
    github_api_get \
        "${GITHUB_API_BASE}/repos/${REPOSITORY}/actions/workflows/${WORKFLOW_FILE}/runs" \
        --get \
        --data-urlencode "branch=${BRANCH_NAME}" \
        --data-urlencode "event=push" \
        --data-urlencode "head_sha=${COMMIT_SHA}" \
        --data-urlencode "per_page=30" \
        | jq --raw-output --arg commit_sha "${COMMIT_SHA}" \
            '[.workflow_runs[] | select(.head_sha == $commit_sha)][0].id // empty'
}

wait_for_workflow_run() {
    local run_id="$1"
    local run_json run_status
    local status_deadline=$((SECONDS + RUN_STATUS_TIMEOUT_SECONDS))

    while (( SECONDS < status_deadline )); do
        run_json="$(github_api_get "${GITHUB_API_BASE}/repos/${REPOSITORY}/actions/runs/${run_id}")"
        run_status="$(jq --exit-status --raw-output '.status | select(type == "string" and length > 0)' <<< "${run_json}")"
        printf 'GitHub Actions run %s status: %s\n' "${run_id}" "${run_status}" >&2
        if [ "${run_status}" = "completed" ]; then
            printf '%s\n' "${run_json}"
            return
        fi
        sleep "${RUN_STATUS_POLL_SECONDS}"
    done

    die "等待 GitHub Actions run ${run_id} 超时"
}

printf 'Pushing %s at %s to %s...\n' "${BRANCH_NAME}" "${COMMIT_SHA}" "${REMOTE_NAME}" >&2
push_current_branch >&2

RUN_ID=""
DISCOVERY_DEADLINE=$((SECONDS + RUN_DISCOVERY_TIMEOUT_SECONDS))
while (( SECONDS < DISCOVERY_DEADLINE )); do
    RUN_ID="$(find_workflow_run_id || true)"
    [ -z "${RUN_ID}" ] || break
    sleep "${RUN_DISCOVERY_POLL_SECONDS}"
done
[ -n "${RUN_ID}" ] || die "未找到 ${COMMIT_SHA} 对应的 ${WORKFLOW_FILE} run"

RUN_JSON="$(wait_for_workflow_run "${RUN_ID}")"
RUN_SHA="$(jq --raw-output '.head_sha' <<< "${RUN_JSON}")"
RUN_EVENT="$(jq --raw-output '.event' <<< "${RUN_JSON}")"
RUN_CONCLUSION="$(jq --raw-output '.conclusion' <<< "${RUN_JSON}")"

[ "${RUN_SHA}" = "${COMMIT_SHA}" ] || die "workflow SHA ${RUN_SHA} 与 ${COMMIT_SHA} 不一致"
[ "${RUN_EVENT}" = "push" ] || die "workflow event ${RUN_EVENT} 不是 push"
[ "${RUN_CONCLUSION}" = "success" ] || die "GitHub Actions run ${RUN_ID} 未成功: ${RUN_CONCLUSION}"

printf '%s:sha-%s\n' "${IMAGE_NAME}" "${COMMIT_SHA}"
