#!/bin/bash

# pull.sh - 从 GitHub Container Registry 拉取镜像并部署
# 使用方法:
#   ./pull.sh              # 拉取 latest 标签
#   ./pull.sh v1.0.0      # 拉取 v1.0.0 标签

set -e  # 遇到错误立即退出

# 配置变量
IMAGE_NAME="ghcr.io/austinhmh/memos"
CONTAINER_NAME="memos"
DATA_DIR="${MEMOS_DATA_DIR:-$HOME/.memos}"

# 获取版本标签参数
VERSION_TAG=${1:-latest}

echo "=========================================="
echo "开始拉取并部署 Docker 容器"
echo "=========================================="
echo "镜像地址: $IMAGE_NAME:$VERSION_TAG"
echo "容器名称: $CONTAINER_NAME"
echo "数据目录: $DATA_DIR"
echo "端口映射: 5230:5230"
echo "=========================================="

# 检查数据目录
echo ""
echo "步骤 1/6: 检查数据目录..."
if [ ! -d "$DATA_DIR" ]; then
    echo "创建数据目录: $DATA_DIR"
    mkdir -p "$DATA_DIR"
    echo "数据目录已创建"
else
    echo "数据目录已存在: $DATA_DIR"
fi

# 检查是否已登录 GHCR
echo ""
echo "步骤 2/6: 检查 GHCR 登录状态..."
if ! docker info 2>/dev/null | grep -q "Username"; then
    echo "警告: 可能未登录 GHCR，如果拉取失败请执行: docker login ghcr.io"
fi

# 拉取镜像
echo ""
echo "步骤 3/6: 拉取镜像 $IMAGE_NAME:$VERSION_TAG..."
docker pull $IMAGE_NAME:$VERSION_TAG

# 为本地使用打标签
echo ""
echo "步骤 4/6: 为镜像打本地标签..."
docker tag $IMAGE_NAME:$VERSION_TAG memos:latest

# 停止并删除旧容器
echo ""
echo "步骤 5/6: 停止并删除旧容器..."
if [ "$(docker ps -aq -f name=$CONTAINER_NAME)" ]; then
    echo "发现旧容器，正在停止并删除..."
    docker stop $CONTAINER_NAME 2>/dev/null || true
    docker rm $CONTAINER_NAME 2>/dev/null || true
    echo "旧容器已删除"
else
    echo "未发现旧容器，跳过此步骤"
fi

# 启动新容器
echo ""
echo "步骤 6/6: 启动新容器..."
docker run -d \
    --name $CONTAINER_NAME \
    -p 5230:5230 \
    -v "$DATA_DIR:/var/opt/memos" \
    -e MEMOS_MODE=prod \
    -e MEMOS_PORT=5230 \
    --restart always \
    memos:latest

# 等待容器启动
echo ""
echo "等待容器启动..."
sleep 3

# 显示容器状态
echo ""
echo "=========================================="
echo "部署完成！"
echo "=========================================="
docker ps -f name=$CONTAINER_NAME --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""
echo "访问地址:"
echo "  本地: http://localhost:5230"
echo "  外部: http://<your-ip>:5230"
echo ""
echo "数据目录: $DATA_DIR"
echo ""
echo "查看日志:"
echo "  docker logs -f $CONTAINER_NAME"
echo ""
echo "停止容器:"
echo "  docker stop $CONTAINER_NAME"
echo ""
echo "重启容器:"
echo "  docker restart $CONTAINER_NAME"
echo ""
echo "删除容器:"
echo "  docker rm -f $CONTAINER_NAME"
echo "=========================================="
