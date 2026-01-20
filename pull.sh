#!/bin/bash

# pull.sh - 从 GitHub Container Registry 拉取镜像并部署
# 使用方法:
#   ./pull.sh              # 拉取 latest 标签
#   ./pull.sh v1.0.0      # 拉取 v1.0.0 标签

set -e  # 遇到错误立即退出

# 配置变量
IMAGE_NAME="ghcr.io/austinhmh/memos"
CONTAINER_NAME="memos"
VOLUME_NAME="memos-data"  # 使用 Docker 命名卷
PORT="${MEMOS_PORT:-5230}"

# 获取版本标签参数
VERSION_TAG=${1:-latest}

echo "=========================================="
echo "开始拉取并部署 Docker 容器"
echo "=========================================="
echo "镜像地址: $IMAGE_NAME:$VERSION_TAG"
echo "容器名称: $CONTAINER_NAME"
echo "数据卷: $VOLUME_NAME (Docker 命名卷)"
echo "端口映射: $PORT:5230"
echo "=========================================="

# 检查 Docker 卷是否存在
echo ""
echo "步骤 1/6: 检查 Docker 数据卷..."
if ! docker volume inspect "$VOLUME_NAME" &>/dev/null; then
    echo "创建 Docker 数据卷: $VOLUME_NAME"
    docker volume create "$VOLUME_NAME"
    echo "数据卷已创建"
else
    echo "数据卷已存在: $VOLUME_NAME"
    echo "数据卷位置: $(docker volume inspect "$VOLUME_NAME" -f '{{.Mountpoint}}')"
fi

# 检查是否已登录 GHCR
echo ""
echo "步骤 2/6: 检查 GHCR 登录状态..."
if ! docker info 2>/dev/null | grep -q "Username" && ! cat ~/.docker/config.json 2>/dev/null | grep -q "ghcr.io"; then
    echo "警告: 可能未登录 GHCR"
    echo "如果拉取失败，请执行: docker login ghcr.io"
    echo "需要 GitHub Personal Access Token (PAT) 具有 read:packages 权限"
fi

# 拉取镜像
echo ""
echo "步骤 3/6: 拉取镜像 $IMAGE_NAME:$VERSION_TAG..."
docker pull "$IMAGE_NAME:$VERSION_TAG"

# 为本地使用打标签
echo ""
echo "步骤 4/6: 为镜像打本地标签..."
docker tag "$IMAGE_NAME:$VERSION_TAG" memos:latest

# 停止并删除旧容器
echo ""
echo "步骤 5/6: 停止并删除旧容器..."
if [ "$(docker ps -aq -f name=^${CONTAINER_NAME}$)" ]; then
    echo "发现旧容器，正在停止并删除..."
    docker stop "$CONTAINER_NAME" 2>/dev/null || true
    docker rm "$CONTAINER_NAME" 2>/dev/null || true
    echo "旧容器已删除"
else
    echo "未发现旧容器，跳过此步骤"
fi

# 启动新容器
echo ""
echo "步骤 6/6: 启动新容器..."
docker run -d \
    --name "$CONTAINER_NAME" \
    -p "$PORT:5230" \
    -v "$VOLUME_NAME:/var/opt/memos" \
    -e MEMOS_MODE=prod \
    -e MEMOS_PORT=5230 \
    --restart unless-stopped \
    memos:latest

# 等待容器启动
echo ""
echo "等待容器启动..."
sleep 3

# 检查容器状态
echo ""
echo "检查容器健康状态..."
CONTAINER_STATUS=$(docker inspect -f '{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "unknown")

if [ "$CONTAINER_STATUS" = "running" ]; then
    echo "✓ 容器运行正常"
    
    # 尝试健康检查
    if command -v curl &> /dev/null; then
        echo "执行健康检查..."
        sleep 2
        if curl -sf "http://localhost:$PORT/healthz" > /dev/null 2>&1; then
            echo "✓ 健康检查通过"
        else
            echo "⚠ 健康检查失败，容器可能还在启动中"
            echo "  请稍后手动检查: curl http://localhost:$PORT/healthz"
        fi
    fi
else
    echo "✗ 容器状态异常: $CONTAINER_STATUS"
    echo "查看日志: docker logs $CONTAINER_NAME"
fi

# 显示容器状态
echo ""
echo "=========================================="
echo "部署完成！"
echo "=========================================="
docker ps -f name=^${CONTAINER_NAME}$ --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""
echo "访问地址:"
echo "  本地: http://localhost:$PORT"
if command -v hostname &> /dev/null; then
    HOSTNAME=$(hostname -I 2>/dev/null | awk '{print $1}' || hostname)
    if [ -n "$HOSTNAME" ]; then
        echo "  外部: http://$HOSTNAME:$PORT"
    fi
fi
echo ""
echo "数据存储: Docker 卷 '$VOLUME_NAME'"
echo "  查看卷信息: docker volume inspect $VOLUME_NAME"
echo "  卷实际位置: $(docker volume inspect "$VOLUME_NAME" -f '{{.Mountpoint}}' 2>/dev/null || echo '需要 root 权限查看')"
echo ""
echo "常用命令:"
echo "  查看日志: docker logs -f $CONTAINER_NAME"
echo "  停止容器: docker stop $CONTAINER_NAME"
echo "  重启容器: docker restart $CONTAINER_NAME"
echo "  删除容器: docker rm -f $CONTAINER_NAME"
echo ""
echo "数据备份:"
echo "  备份: docker run --rm -v $VOLUME_NAME:/data -v \$(pwd):/backup alpine tar czf /backup/memos-backup-\$(date +%Y%m%d).tar.gz -C /data ."
echo "  恢复: docker run --rm -v $VOLUME_NAME:/data -v \$(pwd):/backup alpine tar xzf /backup/memos-backup-YYYYMMDD.tar.gz -C /data"
echo ""
echo "数据迁移（从绑定挂载到命名卷）:"
echo "  docker run --rm -v ~/.memos:/source -v $VOLUME_NAME:/dest alpine cp -a /source/. /dest/"
echo "=========================================="
