#!/bin/bash

# build-push.sh - 构建前端 + Docker 镜像并推送到 GitHub Container Registry
# 使用方法:
#   ./build-push.sh                    # 推送 latest 标签
#   ./build-push.sh v1.0.0             # 推送 v1.0.0 标签
#   ./build-push.sh --local            # 仅本地构建，不推送
#   ./build-push.sh --local v1.0.0     # 本地构建，使用指定标签
#   ./build-push.sh true               # 推送 latest 标签，启用代理
#   ./build-push.sh false              # 推送 latest 标签，禁用代理
#   ./build-push.sh v1.0.0 false       # 推送 v1.0.0 标签，禁用代理
#
# 使用前请确保：
#   1. 已配置 .env 文件（或设置环境变量）
#   2. GITHUB_USERNAME 为 GitHub 用户名
#   3. GITHUB_TOKEN 具有 write:packages 权限

set -eo pipefail

cd "$(dirname "$0")"

IMAGE_NAME="ghcr.io/austinhmh/memos"
DOCKERFILE="scripts/Dockerfile"
PROXY="http://127.0.0.1:7897"

LOCAL_ONLY=false
NO_PROXY=false
VERSION_TAG="latest"

for arg in "$@"; do
    case "$arg" in
        --local)
            LOCAL_ONLY=true
            ;;
        --no-proxy|false)
            NO_PROXY=true
            ;;
        true)
            NO_PROXY=false
            ;;
        --*)
            ;;
        *)
            VERSION_TAG="$arg"
            ;;
    esac
done

if [ -f .env ]; then
    echo "加载 .env 配置文件..."
    set -a
    source .env
    set +a
else
    echo "未找到 .env 文件，使用环境变量"
fi

if [ "$LOCAL_ONLY" = false ]; then
    if [ -z "$GITHUB_USERNAME" ]; then
        echo "错误: 请在 .env 文件或环境变量中设置 GITHUB_USERNAME"
        exit 1
    fi
    if [ -z "$GITHUB_TOKEN" ]; then
        echo "错误: 请在 .env 文件或环境变量中设置 GITHUB_TOKEN"
        echo "GITHUB_TOKEN 需要 write:packages 权限"
        exit 1
    fi
fi

HOST_ARCH=$(uname -m)
case "$HOST_ARCH" in
    x86_64)        TARGET_ARCH="amd64" ;;
    aarch64|arm64) TARGET_ARCH="arm64" ;;
    *)             TARGET_ARCH="amd64" ;;
esac

PROXY_BUILD_ARGS=""
if [ "$NO_PROXY" = false ]; then
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        CONTAINER_PROXY="http://172.17.0.1:7897"
        DOCKER_EXTRA_ARGS="--add-host=host.docker.internal:host-gateway"
    else
        DOCKER_EXTRA_ARGS="--add-host=host.docker.internal:host-gateway"
        HOST_IP=$(docker run --rm --add-host=host.docker.internal:host-gateway alpine:3.21 sh -c "getent hosts host.docker.internal | awk '{print \$1}'" 2>/dev/null)
        if [ -z "$HOST_IP" ]; then
            HOST_IP="192.168.5.2"
        fi
        CONTAINER_PROXY="http://${HOST_IP}:7897"
    fi
    PROXY_BUILD_ARGS="--build-arg HTTP_PROXY=$CONTAINER_PROXY --build-arg HTTPS_PROXY=$CONTAINER_PROXY"
    echo "容器代理:   $CONTAINER_PROXY"
else
    DOCKER_EXTRA_ARGS=""
fi

echo "=========================================="
echo "Memos 构建$([ "$LOCAL_ONLY" = true ] && echo "" || echo "并推送")"
echo "=========================================="
echo "镜像名称:   $IMAGE_NAME"
echo "版本标签:   $VERSION_TAG"
echo "目标架构:   linux/$TARGET_ARCH"
echo "仅本地构建: $LOCAL_ONLY"
echo "使用代理:   $([ "$NO_PROXY" = true ] && echo "否" || echo "是")"
echo "=========================================="

if [ ! -f "$DOCKERFILE" ]; then
    echo "错误: 找不到 $DOCKERFILE，请在 memos 项目根目录执行"
    exit 1
fi

# ── 步骤 1: 构建前端 ──────────────────────────────────
echo ""
echo "[ 1/5 ] 构建前端 (pnpm release → server/router/frontend/dist/) ..."

if ! command -v pnpm &>/dev/null; then
    echo "  pnpm 未安装，尝试使用 npx pnpm ..."
    PNPM_CMD="npx pnpm"
else
    PNPM_CMD="pnpm"
fi

cd web
$PNPM_CMD install --frozen-lockfile 2>/dev/null || $PNPM_CMD install
$PNPM_CMD release
cd ..

# ── 步骤 2: 验证前端构建产物 ──────────────────────────
echo ""
echo "[ 2/5 ] 验证前端构建产物 ..."

FRONTEND_DIST="server/router/frontend/dist"
if [ ! -f "$FRONTEND_DIST/index.html" ]; then
    echo "错误: 前端构建失败，未找到 $FRONTEND_DIST/index.html"
    exit 1
fi
DIST_SIZE=$(du -sh "$FRONTEND_DIST" | cut -f1)
FILE_COUNT=$(find "$FRONTEND_DIST" -type f | wc -l | tr -d ' ')
echo "  产物目录: $FRONTEND_DIST"
echo "  总大小:   $DIST_SIZE ($FILE_COUNT 个文件)"

# ── 步骤 3: 构建 Docker 镜像（始终 no-cache）─────────
echo ""
echo "[ 3/5 ] 构建 Docker 镜像 (--no-cache, linux/$TARGET_ARCH) ..."

# 清除 shell 代理变量，防止 Docker daemon 自动继承导致 apk 失败
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy

docker build \
    --no-cache \
    -f "$DOCKERFILE" \
    --platform "linux/$TARGET_ARCH" \
    --build-arg VERSION="$VERSION_TAG" \
    $PROXY_BUILD_ARGS \
    $DOCKER_EXTRA_ARGS \
    -t "memos:$VERSION_TAG" \
    --progress=plain \
    .

if [ $? -ne 0 ]; then
    echo "错误: Docker 镜像构建失败"
    exit 1
fi

# ── 步骤 4: 打标签 ───────────────────────────────────
echo ""
echo "[ 4/5 ] 打标签 ..."
if docker image inspect "$IMAGE_NAME:$VERSION_TAG" &>/dev/null; then
    docker rmi -f "$IMAGE_NAME:$VERSION_TAG" >/dev/null
fi
docker tag "memos:$VERSION_TAG" "$IMAGE_NAME:$VERSION_TAG"
if [ "$VERSION_TAG" != "latest" ]; then
    if docker image inspect "$IMAGE_NAME:latest" &>/dev/null; then
        docker rmi -f "$IMAGE_NAME:latest" >/dev/null
    fi
    docker tag "memos:$VERSION_TAG" "$IMAGE_NAME:latest"
fi
echo "  memos:$VERSION_TAG"
echo "  $IMAGE_NAME:$VERSION_TAG"

# ── 步骤 5: 推送（可选）─────────────────────────────
if [ "$LOCAL_ONLY" = true ]; then
    echo ""
    echo "[ 5/5 ] 跳过推送 (--local 模式)"
else
    echo ""
    echo "[ 5/5 ] 登录并推送镜像到 GHCR ..."
    echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_USERNAME" --password-stdin
    docker push "$IMAGE_NAME:$VERSION_TAG"
    if [ "$VERSION_TAG" != "latest" ]; then
        docker push "$IMAGE_NAME:latest"
    fi
fi

echo ""
echo "=========================================="
echo "构建完成！"
echo "=========================================="
echo "本地镜像:  memos:$VERSION_TAG"
echo "远程镜像:  $IMAGE_NAME:$VERSION_TAG"
echo ""
echo "本地部署:  ./pull.sh --local"
echo "远程部署:  ./pull.sh"
echo "=========================================="
