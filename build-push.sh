#!/bin/bash

# build-push.sh - 构建 Docker 镜像并推送到 GitHub Container Registry
# 使用方法:
#   ./build-push.sh              # 推送 latest 标签
#   ./build-push.sh v1.0.0      # 推送 v1.0.0 标签

set -e  # 遇到错误立即退出

# 配置变量
IMAGE_NAME="ghcr.io/austinhmh/memos"
DOCKERFILE="scripts/Dockerfile"
PROXY="http://127.0.0.1:7897"

# 获取版本标签参数
VERSION_TAG=${1:-latest}

echo "=========================================="
echo "开始构建并推送 Docker 镜像"
echo "=========================================="
echo "镜像名称: $IMAGE_NAME"
echo "版本标签: $VERSION_TAG"
echo "Dockerfile: $DOCKERFILE"
echo "代理地址: $PROXY"
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

# 设置代理环境变量
export HTTP_PROXY=$PROXY
export HTTPS_PROXY=$PROXY
export http_proxy=$PROXY
export https_proxy=$PROXY

# 容器内需要使用 host.docker.internal 访问宿主机代理
CONTAINER_PROXY="http://host.docker.internal:7897"

echo ""
echo "步骤 1/6: 构建前端..."
echo "=========================================="
cd web
echo "安装前端依赖..."
pnpm install
echo ""
echo "构建前端生产版本..."
pnpm release
cd ..

echo ""
echo "步骤 2/6: 验证前端构建产物..."
if [ ! -d "web/dist" ]; then
    echo "错误: 前端构建失败，未找到 web/dist 目录"
    exit 1
fi
echo "前端构建成功！"
echo "构建产物大小: $(du -sh web/dist | cut -f1)"

echo ""
echo "步骤 3/6: 使用 Dockerfile 构建 Docker 镜像..."
echo "这可能需要几分钟时间，请耐心等待..."
docker build \
    -f $DOCKERFILE \
    --build-arg VERSION=$VERSION_TAG \
    --build-arg TARGETOS=linux \
    --build-arg TARGETARCH=amd64 \
    --build-arg HTTP_PROXY=$CONTAINER_PROXY \
    --build-arg HTTPS_PROXY=$CONTAINER_PROXY \
    -t memos:$VERSION_TAG \
    --progress=plain \
    . 2>&1 | tee /tmp/memos-docker-build.log

echo ""
echo "步骤 4/6: 为镜像打标签..."
docker tag memos:$VERSION_TAG $IMAGE_NAME:$VERSION_TAG

if [ "$VERSION_TAG" != "latest" ]; then
    echo "同时打上 latest 标签..."
    docker tag memos:$VERSION_TAG $IMAGE_NAME:latest
fi

echo ""
echo "步骤 5/6: 检查是否已登录 GitHub Container Registry..."
# 检查是否已登录到 ghcr.io
if ! docker info 2>/dev/null | grep -q "Username" && ! cat ~/.docker/config.json 2>/dev/null | grep -q "ghcr.io"; then
    echo "警告: 未检测到 Docker 登录状态"
    echo "提示: 如果推送失败，请先执行: docker login ghcr.io"
    echo "需要 GitHub Personal Access Token (PAT) 具有 write:packages 权限"
else
    echo "Docker 登录状态已确认"
fi

echo ""
echo "步骤 6/6: 推送镜像到 GitHub Container Registry..."
docker push $IMAGE_NAME:$VERSION_TAG

if [ "$VERSION_TAG" != "latest" ]; then
    echo "同时推送 latest 标签..."
    docker push $IMAGE_NAME:latest
fi

echo ""
echo "=========================================="
echo "构建和推送完成！"
echo "=========================================="
echo "镜像地址: $IMAGE_NAME:$VERSION_TAG"
if [ "$VERSION_TAG" != "latest" ]; then
    echo "镜像地址: $IMAGE_NAME:latest"
fi
echo "=========================================="
echo ""
echo "使用以下命令拉取并部署:"
echo "  ./pull.sh              # 拉取 latest"
echo "  ./pull.sh $VERSION_TAG   # 拉取 $VERSION_TAG"
echo ""
