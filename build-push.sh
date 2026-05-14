#!/usr/bin/env bash

# build-push.sh - Build frontend + Docker image and optionally push to GHCR.

set -Eeuo pipefail
IFS=$'\n\t'

cd "$(dirname "$0")"

usage() {
    cat <<'EOF'
Usage:
  ./build-push.sh [--local] [--proxy|--no-proxy] [--image IMAGE] [tag]
  ./build-push.sh true|false [tag]   # backwards-compatible proxy toggle

Environment (.env is supported for the allowlisted variables below):
  GITHUB_USERNAME       GHCR username for push
  GITHUB_TOKEN          GHCR token with write:packages for push
  IMAGE_NAME            Image name, default ghcr.io/austinhmh/memos
  MEMOS_BUILD_PROXY     Explicit build proxy URL, e.g. http://host.docker.internal:7897
  MEMOS_PROXY_PORT      Proxy port used when --proxy is set, default 7897
EOF
}

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
            GITHUB_USERNAME|GITHUB_TOKEN|IMAGE_NAME|MEMOS_BUILD_PROXY|MEMOS_PROXY_PORT)
                if [ -z "${!key+x}" ]; then
                    export "$key=$value"
                fi
                ;;
            *)
                echo "  忽略 .env 中未允许的变量: $key"
                ;;
        esac
    done < "$env_file"
}

validate_tag() {
    local tag="$1"
    [[ "$tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || die "非法镜像标签: $tag"
}

validate_image_name() {
    local image="$1"
    [ -n "$image" ] || die "IMAGE_NAME 不能为空"
    [[ "$image" != -* ]] || die "IMAGE_NAME 不能以 '-' 开头"
    [[ ! "$image" =~ [[:space:][:cntrl:]\;\`\'\"\|\&\<\>\$] ]] || die "IMAGE_NAME 包含非法字符"
}

validate_port() {
    local port="$1"
    [[ "$port" =~ ^[0-9]+$ ]] || die "非法代理端口: $port"
    [ "$port" -ge 1 ] && [ "$port" -le 65535 ] || die "代理端口超出范围: $port"
}

validate_proxy_url() {
    local proxy_url="$1"
    [[ "$proxy_url" =~ ^https?://[^[:space:]@/]+(:[0-9]+)?/?$ || "$proxy_url" =~ ^https?://\[[0-9A-Fa-f:]+\](:[0-9]+)?/?$ ]] || die "非法代理 URL: $proxy_url"
    [[ ! "$proxy_url" =~ ^https?://[^/]*@ ]] || die "代理 URL 不能包含用户名或密码"
}

require_dockerignore_rule() {
    local rule="$1"
    if ! grep -Fxq -- "$rule" .dockerignore; then
        die ".dockerignore 缺少必要规则: $rule"
    fi
}

verify_build_context_guards() {
    local required_rules=(
        ".env"
        ".env.*"
        ".npmrc"
        ".yarnrc*"
        ".netrc"
        ".aws/"
        ".ssh/"
        ".kube/"
        "credentials.json"
        "secrets.json"
        "service-account*.json"
        "*.secret"
        "*.token"
        "*.pem"
        "*.key"
        "*.db"
        ".pnpm-store"
        "data/"
    )
    local rule

    [ -f .dockerignore ] || die "缺少 .dockerignore，拒绝构建以避免打包敏感文件"
    for rule in "${required_rules[@]}"; do
        require_dockerignore_rule "$rule"
    done
}

load_env_file ".env"

IMAGE_NAME="${IMAGE_NAME:-ghcr.io/austinhmh/memos}"
DOCKERFILE="scripts/Dockerfile"
LOCAL_ONLY=false
USE_PROXY=false
VERSION_TAG="latest"
TAG_SET=false

while [ "$#" -gt 0 ]; do
    case "$1" in
        --help|-h)
            usage
            exit 0
            ;;
        --local)
            LOCAL_ONLY=true
            ;;
        --proxy|true)
            USE_PROXY=true
            ;;
        --no-proxy|false)
            USE_PROXY=false
            ;;
        --image)
            shift
            [ "$#" -gt 0 ] || die "--image 需要参数"
            IMAGE_NAME="$1"
            ;;
        --image=*)
            IMAGE_NAME="${1#--image=}"
            ;;
        --*)
            die "未知参数: $1"
            ;;
        *)
            if [ "$TAG_SET" = true ]; then
                die "只能指定一个镜像标签"
            fi
            VERSION_TAG="$1"
            TAG_SET=true
            ;;
    esac
    shift
done

validate_tag "$VERSION_TAG"
validate_image_name "$IMAGE_NAME"
verify_build_context_guards

if [ "$LOCAL_ONLY" = false ]; then
    [ -n "${GITHUB_USERNAME:-}" ] || die "请通过环境变量或 .env 设置 GITHUB_USERNAME"
    [ -n "${GITHUB_TOKEN:-}" ] || die "请通过环境变量或 .env 设置 GITHUB_TOKEN（需要 write:packages 权限）"
    [[ "${GITHUB_TOKEN}" != ghp_replace* ]] || die "GITHUB_TOKEN 仍是示例占位值"
fi

HOST_ARCH=$(uname -m)
case "$HOST_ARCH" in
    x86_64) TARGET_ARCH="amd64" ;;
    aarch64|arm64) TARGET_ARCH="arm64" ;;
    *) TARGET_ARCH="amd64" ;;
esac

DOCKER_BUILD_ARGS=()
DOCKER_EXTRA_ARGS=()
CONTAINER_PROXY=""
if [ "$USE_PROXY" = true ] || [ -n "${MEMOS_BUILD_PROXY:-}" ]; then
    PROXY_PORT="${MEMOS_PROXY_PORT:-7897}"
    validate_port "$PROXY_PORT"
    if [ -n "${MEMOS_BUILD_PROXY:-}" ]; then
        CONTAINER_PROXY="$MEMOS_BUILD_PROXY"
    elif [[ "${OSTYPE:-}" == linux-gnu* ]]; then
        CONTAINER_PROXY="http://172.17.0.1:${PROXY_PORT}"
        DOCKER_EXTRA_ARGS+=(--add-host=host.docker.internal:host-gateway)
    else
        CONTAINER_PROXY="http://host.docker.internal:${PROXY_PORT}"
        DOCKER_EXTRA_ARGS+=(--add-host=host.docker.internal:host-gateway)
    fi
    validate_proxy_url "$CONTAINER_PROXY"
    DOCKER_BUILD_ARGS+=(--build-arg "HTTP_PROXY=$CONTAINER_PROXY" --build-arg "HTTPS_PROXY=$CONTAINER_PROXY")
fi

cat <<EOF
==========================================
Memos 构建$([ "$LOCAL_ONLY" = true ] && echo "" || echo "并推送")
==========================================
镜像名称:   $IMAGE_NAME
版本标签:   $VERSION_TAG
目标架构:   linux/$TARGET_ARCH
仅本地构建: $LOCAL_ONLY
使用代理:   $([ -n "$CONTAINER_PROXY" ] && echo "是" || echo "否")
==========================================
EOF

if [ ! -f "$DOCKERFILE" ]; then
    die "找不到 $DOCKERFILE，请在 memos 项目根目录执行"
fi

echo ""
echo "[ 1/5 ] 构建前端 (pnpm release → server/router/frontend/dist/) ..."
if command -v pnpm >/dev/null 2>&1; then
    PNPM_CMD=(pnpm)
elif command -v npx >/dev/null 2>&1; then
    echo "  pnpm 未安装，尝试使用 npx pnpm ..."
    PNPM_CMD=(npx pnpm)
else
    die "未找到 pnpm 或 npx"
fi

(
    cd web
    "${PNPM_CMD[@]}" install --frozen-lockfile
    "${PNPM_CMD[@]}" release
)

echo ""
echo "[ 2/5 ] 验证前端构建产物 ..."
FRONTEND_DIST="server/router/frontend/dist"
[ -f "$FRONTEND_DIST/index.html" ] || die "前端构建失败，未找到 $FRONTEND_DIST/index.html"
DIST_SIZE=$(du -sh "$FRONTEND_DIST" | cut -f1)
FILE_COUNT=$(find "$FRONTEND_DIST" -type f | wc -l | tr -d ' ')
echo "  产物目录: $FRONTEND_DIST"
echo "  总大小:   $DIST_SIZE ($FILE_COUNT 个文件)"

echo ""
echo "[ 3/5 ] 构建 Docker 镜像 (--no-cache, linux/$TARGET_ARCH) ..."
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
    docker build \
    --no-cache \
    -f "$DOCKERFILE" \
    --platform "linux/$TARGET_ARCH" \
    --build-arg "VERSION=$VERSION_TAG" \
    "${DOCKER_BUILD_ARGS[@]}" \
    "${DOCKER_EXTRA_ARGS[@]}" \
    -t "memos:$VERSION_TAG" \
    --progress=plain \
    .

echo ""
echo "[ 4/5 ] 打标签 ..."
if docker image inspect "$IMAGE_NAME:$VERSION_TAG" >/dev/null 2>&1; then
    docker rmi -f "$IMAGE_NAME:$VERSION_TAG" >/dev/null
fi
docker tag "memos:$VERSION_TAG" "$IMAGE_NAME:$VERSION_TAG"
if [ "$VERSION_TAG" != "latest" ]; then
    if docker image inspect "$IMAGE_NAME:latest" >/dev/null 2>&1; then
        docker rmi -f "$IMAGE_NAME:latest" >/dev/null
    fi
    docker tag "memos:$VERSION_TAG" "$IMAGE_NAME:latest"
fi
echo "  memos:$VERSION_TAG"
echo "  $IMAGE_NAME:$VERSION_TAG"

if [ "$LOCAL_ONLY" = true ]; then
    echo ""
    echo "[ 5/5 ] 跳过推送 (--local 模式)"
else
    echo ""
    echo "[ 5/5 ] 使用临时 Docker 凭据推送镜像到 GHCR ..."
    DOCKER_CONFIG_DIR="$(mktemp -d)"
    cleanup_docker_config() {
        rm -rf "$DOCKER_CONFIG_DIR"
    }
    trap cleanup_docker_config EXIT
    AUTH_TOKEN="$(printf '%s:%s' "$GITHUB_USERNAME" "$GITHUB_TOKEN" | base64 | tr -d '\n')"
    mkdir -p "$DOCKER_CONFIG_DIR"
    cat >"$DOCKER_CONFIG_DIR/config.json" <<EOF
{
  "auths": {
    "ghcr.io": {
      "auth": "$AUTH_TOKEN"
    }
  }
}
EOF
    DOCKER_CONFIG="$DOCKER_CONFIG_DIR" docker push "$IMAGE_NAME:$VERSION_TAG"
    if [ "$VERSION_TAG" != "latest" ]; then
        DOCKER_CONFIG="$DOCKER_CONFIG_DIR" docker push "$IMAGE_NAME:latest"
    fi
fi

cat <<EOF

==========================================
构建完成！
==========================================
本地镜像:  memos:$VERSION_TAG
远程镜像:  $IMAGE_NAME:$VERSION_TAG

本地部署:  ./pull.sh --local
远程部署:  ./pull.sh
==========================================
EOF
