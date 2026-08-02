#!/usr/bin/env bash

# Pull an immutable CI-built image and deploy it with health-checked rollback.

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
    echo "加载 .env 配置文件（仅导入脚本允许的变量）..."

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
            GITHUB_USERNAME|GITHUB_TOKEN|MEMOS_BUILD_IMAGE|MEMOS_DATA_DIR|MEMOS_HOST_ADDR|MEMOS_HOST_PORT|MEMOS_INSTANCE_URL|MEMOS_HEALTH_ATTEMPTS|MEMOS_HEALTH_INTERVAL_SECONDS|MEMOS_DEPLOY_LOCK_DIRECTORY)
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

validate_host_addr() {
    local host_addr="$1"
    [[ "${host_addr}" =~ ^[A-Za-z0-9_.:-]+$ ]] || die "非法监听地址: ${host_addr}"
}

validate_data_directory() {
    local data_directory="$1"
    [ -n "${data_directory}" ] || die "MEMOS_DATA_DIR 不能为空"
    [[ "${data_directory}" = /* ]] || die "MEMOS_DATA_DIR 必须是绝对路径: ${data_directory}"
    case "${data_directory}" in
        /|/bin|/boot|/dev|/etc|/home|/lib|/lib64|/proc|/root|/run|/sbin|/sys|/usr|/var|/var/opt)
            die "拒绝使用高风险系统目录: ${data_directory}"
            ;;
    esac
}

load_env_file ".env"

if [ "$#" -ne 1 ]; then
    echo "Usage: ./pull.sh ghcr.io/austinhmh/memos:sha-<40-hex-commit>"
    echo "   or: ./pull.sh ghcr.io/austinhmh/memos@sha256:<digest>"
    exit 1
fi

IMAGE_NAME="${MEMOS_BUILD_IMAGE:-ghcr.io/austinhmh/memos}"
IMAGE_REFERENCE="$1"
CONTAINER_NAME="memos"
ROLLBACK_IMAGE="memos:rollback-previous"
HOST_ADDR="${MEMOS_HOST_ADDR:-0.0.0.0}"
HOST_PORT="${MEMOS_HOST_PORT:-8081}"
CONTAINER_PORT="5230"
HEALTH_ATTEMPTS="${MEMOS_HEALTH_ATTEMPTS:-60}"
HEALTH_INTERVAL_SECONDS="${MEMOS_HEALTH_INTERVAL_SECONDS:-2}"
LOCK_DIRECTORY="${MEMOS_DEPLOY_LOCK_DIRECTORY:-/tmp/memos-deploy.lock}"

validate_host_addr "${HOST_ADDR}"
validate_positive_integer "MEMOS_HOST_PORT" "${HOST_PORT}"
validate_positive_integer "MEMOS_HEALTH_ATTEMPTS" "${HEALTH_ATTEMPTS}"
validate_positive_integer "MEMOS_HEALTH_INTERVAL_SECONDS" "${HEALTH_INTERVAL_SECONDS}"

EXPECTED_COMMIT=""
if [[ "${IMAGE_REFERENCE}" =~ ^${IMAGE_NAME}:sha-([0-9a-f]{40})$ ]]; then
    EXPECTED_COMMIT="${BASH_REMATCH[1]}"
elif [[ ! "${IMAGE_REFERENCE}" =~ ^${IMAGE_NAME}@sha256:[0-9a-f]{64}$ ]]; then
    die "只接受 ${IMAGE_NAME} 的完整 SHA 标签或 digest"
fi

command -v docker >/dev/null 2>&1 || die "未找到 docker"
command -v curl >/dev/null 2>&1 || die "未找到 curl"

if ! mkdir "${LOCK_DIRECTORY}" 2>/dev/null; then
    die "另一个 Memos 部署正在运行: ${LOCK_DIRECTORY}"
fi
cleanup_lock() {
    rmdir "${LOCK_DIRECTORY}" 2>/dev/null || true
}
trap cleanup_lock EXIT

CURRENT_IMAGE_ID="$(docker inspect --format '{{.Image}}' "${CONTAINER_NAME}" 2>/dev/null || true)"
[ -n "${CURRENT_IMAGE_ID}" ] || die "未找到当前 ${CONTAINER_NAME} 容器，无法提供回滚"

CURRENT_DATA_DIRECTORY="$(
    docker inspect \
        --format '{{range .Mounts}}{{if eq .Destination "/var/opt/memos"}}{{.Source}}{{end}}{{end}}' \
        "${CONTAINER_NAME}"
)"
DATA_DIRECTORY="${MEMOS_DATA_DIR:-${CURRENT_DATA_DIRECTORY}}"
validate_data_directory "${DATA_DIRECTORY}"
[ -d "${DATA_DIRECTORY}" ] || die "数据目录不存在: ${DATA_DIRECTORY}"

if [ -n "${MEMOS_INSTANCE_URL+x}" ]; then
    EFFECTIVE_INSTANCE_URL="${MEMOS_INSTANCE_URL}"
else
    EFFECTIVE_INSTANCE_URL=""
    while IFS= read -r environment_entry; do
        case "${environment_entry}" in
            MEMOS_INSTANCE_URL=*)
                EFFECTIVE_INSTANCE_URL="${environment_entry#MEMOS_INSTANCE_URL=}"
                break
                ;;
        esac
    done < <(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "${CONTAINER_NAME}")
fi

INSTANCE_URL_ARGUMENTS=()
if [ -n "${EFFECTIVE_INSTANCE_URL}" ]; then
    INSTANCE_URL_ARGUMENTS=(-e "MEMOS_INSTANCE_URL=${EFFECTIVE_INSTANCE_URL}")
fi

DOCKER_CONFIG_DIRECTORY="$(mktemp -d)"
cleanup_docker_config() {
    rm -rf "${DOCKER_CONFIG_DIRECTORY}"
}
trap 'cleanup_docker_config; cleanup_lock' EXIT

GITHUB_USERNAME="${GITHUB_USERNAME:-austinhmh}"
GITHUB_TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
if [ -n "${GITHUB_TOKEN}" ]; then
    AUTH_TOKEN="$(printf '%s:%s' "${GITHUB_USERNAME}" "${GITHUB_TOKEN}" | base64 | tr -d '\n')"
    mkdir -p "${DOCKER_CONFIG_DIRECTORY}"
    cat > "${DOCKER_CONFIG_DIRECTORY}/config.json" <<EOF
{
  "auths": {
    "ghcr.io": {
      "auth": "${AUTH_TOKEN}"
    }
  }
}
EOF
fi

docker image tag "${CURRENT_IMAGE_ID}" "${ROLLBACK_IMAGE}"

echo "拉取 CI 镜像: ${IMAGE_REFERENCE}"
DOCKER_CONFIG="${DOCKER_CONFIG_DIRECTORY}" docker pull "${IMAGE_REFERENCE}"
CANDIDATE_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "${IMAGE_REFERENCE}")"

if [ -n "${EXPECTED_COMMIT}" ]; then
    IMAGE_REVISION="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "${IMAGE_REFERENCE}" 2>/dev/null || true)"
    [ "${IMAGE_REVISION}" = "${EXPECTED_COMMIT}" ] || die "镜像 revision ${IMAGE_REVISION:-missing} 与 ${EXPECTED_COMMIT} 不一致"
fi

replace_running_container() {
    local target_image="$1"

    if docker inspect "${CONTAINER_NAME}" >/dev/null 2>&1; then
        docker stop "${CONTAINER_NAME}" >/dev/null
        docker rm "${CONTAINER_NAME}" >/dev/null
    fi

    docker run --detach \
        --name "${CONTAINER_NAME}" \
        --user root \
        --cap-drop ALL \
        --security-opt no-new-privileges:true \
        --read-only \
        --tmpfs /tmp:rw,noexec,nosuid,size=64m \
        --publish "${HOST_ADDR}:${HOST_PORT}:${CONTAINER_PORT}" \
        --volume "${DATA_DIRECTORY}:/var/opt/memos" \
        --env MEMOS_MODE=prod \
        --env "MEMOS_PORT=${CONTAINER_PORT}" \
        "${INSTANCE_URL_ARGUMENTS[@]}" \
        --restart unless-stopped \
        "${target_image}" >/dev/null
}

wait_for_health() {
    local attempt
    for attempt in $(seq 1 "${HEALTH_ATTEMPTS}"); do
        if curl --fail --silent --show-error --max-time 2 "http://127.0.0.1:${HOST_PORT}/healthz" >/dev/null; then
            return 0
        fi
        sleep "${HEALTH_INTERVAL_SECONDS}"
    done
    return 1
}

verify_running_image() {
    local expected_image_id="$1"
    local running_image_id
    running_image_id="$(docker inspect --format '{{.Image}}' "${CONTAINER_NAME}" 2>/dev/null || true)"
    [ "${running_image_id}" = "${expected_image_id}" ]
}

rollback() {
    echo "候选镜像验证失败，恢复 ${ROLLBACK_IMAGE}" >&2
    replace_running_container "${CURRENT_IMAGE_ID}" || return 1
    verify_running_image "${CURRENT_IMAGE_ID}" || return 1
    if ! wait_for_health; then
        docker logs "${CONTAINER_NAME}" --tail 100 >&2 || true
        return 1
    fi
    echo "回滚已完成并验证" >&2
}

DEPLOYMENT_STARTED=false
DEPLOYMENT_SUCCEEDED=false
handle_interruption() {
    trap - INT TERM
    if [ "${DEPLOYMENT_STARTED}" = true ] && [ "${DEPLOYMENT_SUCCEEDED}" != true ]; then
        rollback || true
    fi
    exit 130
}
trap handle_interruption INT TERM

DEPLOYMENT_STARTED=true
if ! replace_running_container "${CANDIDATE_IMAGE_ID}"; then
    rollback
    exit 1
fi
if ! verify_running_image "${CANDIDATE_IMAGE_ID}"; then
    rollback
    exit 1
fi
if ! wait_for_health; then
    docker logs "${CONTAINER_NAME}" --tail 100 >&2 || true
    rollback
    exit 1
fi

DEPLOYMENT_SUCCEEDED=true
echo "部署已验证"
echo "镜像: ${IMAGE_REFERENCE}"
echo "镜像 ID: ${CANDIDATE_IMAGE_ID}"
echo "数据目录: ${DATA_DIRECTORY}"
echo "回滚镜像: ${ROLLBACK_IMAGE}"
