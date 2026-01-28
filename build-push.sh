#!/bin/bash

# build-push.sh - 构建 Docker 镜像并推送到 GitHub Container Registry
# 
# 构建流程说明:
#   1. 构建前端 (web/) -> 输出到 server/router/frontend/dist/
#   2. Docker 构建时，Go 编译器会通过 //go:embed 指令将 dist/ 目录嵌入到二进制文件中
#   3. 最终的 Docker 镜像包含嵌入了前端资源的 Go 二进制文件
#
# 使用方法:
#   ./build-push.sh              # 推送 latest 标签
#   ./build-push.sh v1.0.0      # 推送 v1.0.0 标签

set -e  # 遇到错误立即退出

# 配置变量
IMAGE_NAME="ghcr.io/austinhmh/memos"
DOCKERFILE="scripts/Dockerfile"
PROXY="${HTTP_PROXY:-}"  # 从环境变量读取，如果没有则为空

# 获取版本标签参数
VERSION_TAG=${1:-latest}

# 检测操作系统并设置容器内代理地址（仅在设置了代理时）
CONTAINER_PROXY=""
DOCKER_EXTRA_ARGS=""

if [ -n "$PROXY" ]; then
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux: 使用 Docker 默认网关
        CONTAINER_PROXY="http://172.17.0.1:7897"
        DOCKER_EXTRA_ARGS="--add-host=host.docker.internal:host-gateway"
        echo "检测到 Linux 系统，使用网关地址: $CONTAINER_PROXY"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS: 使用 host.docker.internal
        CONTAINER_PROXY="http://host.docker.internal:7897"
        DOCKER_EXTRA_ARGS=""
        echo "检测到 macOS 系统，使用 host.docker.internal"
    else
        # 其他系统（Windows等）
        CONTAINER_PROXY="http://host.docker.internal:7897"
        DOCKER_EXTRA_ARGS=""
        echo "检测到其他系统，使用 host.docker.internal"
    fi
else
    echo "未设置代理，将直接连接网络"
fi

echo "=========================================="
echo "开始构建并推送 Docker 镜像"
echo "=========================================="
echo "镜像名称: $IMAGE_NAME"
echo "版本标签: $VERSION_TAG"
echo "Dockerfile: $DOCKERFILE"
if [ -n "$PROXY" ]; then
    echo "宿主机代理: $PROXY"
    echo "容器内代理: $CONTAINER_PROXY"
else
    echo "代理: 未设置"
fi
echo "=========================================="

# 检查 dockerfile 是否存在
if [ ! -f "$DOCKERFILE" ]; then
    echo "错误: 找不到 $DOCKERFILE 文件"
    exit 1
fi

# 检查 node 和 pnpm 是否安装
if ! command -v node &> /dev/null; then
    echo "错误: 未找到 node，请先安装 Node.js"
    exit 1
fi

if ! command -v pnpm &> /dev/null; then
    echo "错误: 未找到 pnpm，请先安装 pnpm"
    echo "安装命令: npm install -g pnpm"
    exit 1
fi

# 设置代理环境变量（仅在设置了代理时）
if [ -n "$PROXY" ]; then
    export HTTP_PROXY=$PROXY
    export HTTPS_PROXY=$PROXY
    export http_proxy=$PROXY
    export https_proxy=$PROXY
fi

echo ""
echo "步骤 1/7: 构建前端资源..."
echo "=========================================="
echo "说明: 前端构建产物将输出到 server/router/frontend/dist/"
echo "      Go 编译时会通过 //go:embed 指令将其嵌入到二进制文件中"
echo ""
cd web
echo "安装前端依赖..."
pnpm install
echo ""
echo "构建前端生产版本..."
pnpm release
cd ..

echo ""
echo "步骤 2/7: 验证前端构建产物..."
if [ ! -d "server/router/frontend/dist" ]; then
    echo "错误: 前端构建失败，未找到 server/router/frontend/dist 目录"
    exit 1
fi
echo "✓ 前端构建成功！"
echo "  构建产物位置: server/router/frontend/dist/"
echo "  构建产物大小: $(du -sh server/router/frontend/dist | cut -f1)"
echo "  文件数量: $(find server/router/frontend/dist -type f | wc -l) 个文件"

echo ""
echo "步骤 3/7: 准备 Docker 构建..."
echo "=========================================="
echo "说明: Docker 构建过程中会执行以下操作:"
echo "  1. 复制源代码（包括 server/router/frontend/dist/）到构建容器"
echo "  2. Go 编译器读取 frontend.go 中的 //go:embed dist/* 指令"
echo "  3. 将 dist/ 目录的所有文件嵌入到 Go 二进制文件中"
echo "  4. 生成包含前端资源的单一可执行文件"
echo ""
echo "这可能需要几分钟时间，请耐心等待..."

# 构建 Docker 镜像的参数
BUILD_ARGS=(
    -f "$DOCKERFILE"
    --no-cache
    --build-arg VERSION="$VERSION_TAG"
    --build-arg TARGETOS=linux
    --build-arg TARGETARCH=amd64
)

# 仅在设置了代理时添加代理参数
if [ -n "$CONTAINER_PROXY" ]; then
    BUILD_ARGS+=(
        --build-arg HTTP_PROXY="$CONTAINER_PROXY"
        --build-arg HTTPS_PROXY="$CONTAINER_PROXY"
    )
fi

# 添加额外的 Docker 参数
if [ -n "$DOCKER_EXTRA_ARGS" ]; then
    BUILD_ARGS+=($DOCKER_EXTRA_ARGS)
fi

BUILD_ARGS+=(
    -t "memos:$VERSION_TAG"
    --progress=plain
    .
)

docker build "${BUILD_ARGS[@]}" 2>&1 | tee /tmp/memos-docker-build.log

echo ""
echo "步骤 4/7: 验证 Docker 镜像构建..."
echo "=========================================="
if docker images "memos:$VERSION_TAG" | grep -q "memos"; then
    IMAGE_SIZE=$(docker images "memos:$VERSION_TAG" --format "{{.Size}}")
    echo "✓ Docker 镜像构建成功！"
    echo "  镜像名称: memos:$VERSION_TAG"
    echo "  镜像大小: $IMAGE_SIZE"
    echo "  说明: 该镜像包含了嵌入前端资源的 Go 二进制文件"
else
    echo "错误: Docker 镜像构建失败"
    exit 1
fi

echo ""
echo "步骤 5/7: 为镜像打标签..."
docker tag "memos:$VERSION_TAG" "$IMAGE_NAME:$VERSION_TAG"

if [ "$VERSION_TAG" != "latest" ]; then
    echo "同时打上 latest 标签..."
    docker tag "memos:$VERSION_TAG" "$IMAGE_NAME:latest"
fi

echo ""
echo "步骤 6/7: 检查是否已登录 GitHub Container Registry..."
# 检查是否已登录到 ghcr.io
if ! docker info 2>/dev/null | grep -q "Username" && ! cat ~/.docker/config.json 2>/dev/null | grep -q "ghcr.io"; then
    echo "警告: 未检测到 Docker 登录状态"
    echo "提示: 如果推送失败，请先执行: docker login ghcr.io"
    echo "需要 GitHub Personal Access Token (PAT) 具有 write:packages 权限"
else
    echo "Docker 登录状态已确认"
fi

echo ""
echo "步骤 7/7: 推送镜像到 GitHub Container Registry..."
docker push "$IMAGE_NAME:$VERSION_TAG"

if [ "$VERSION_TAG" != "latest" ]; then
    echo "同时推送 latest 标签..."
    docker push "$IMAGE_NAME:latest"
fi

echo ""
echo "=========================================="
echo "构建和推送完成！"
echo "=========================================="
echo "镜像地址: $IMAGE_NAME:$VERSION_TAG"
if [ "$VERSION_TAG" != "latest" ]; then
    echo "镜像地址: $IMAGE_NAME:latest"
fi
echo ""
echo "构建流程总结:"
echo "  1. ✓ 前端构建完成 (web/ -> server/router/frontend/dist/)"
echo "  2. ✓ Go 编译完成 (通过 //go:embed 嵌入前端资源)"
echo "  3. ✓ Docker 镜像构建完成"
echo "  4. ✓ 推送到 GitHub Container Registry"
echo "=========================================="
echo ""
echo "使用以下命令拉取并部署:"
echo "  ./pull.sh              # 拉取 latest"
echo "  ./pull.sh $VERSION_TAG   # 拉取 $VERSION_TAG"
echo ""
