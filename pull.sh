#!/bin/bash

# pull.sh - 从 GitHub Container Registry 拉取镜像并部署
# 使用方法:
#   ./pull.sh              # 拉取 latest 标签
#   ./pull.sh v1.0.0      # 拉取 v1.0.0 标签

set -e  # 遇到错误立即退出

# 获取脚本所在目录（项目根目录）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 配置变量
IMAGE_NAME="ghcr.io/austinhmh/memos"
CONTAINER_NAME="memos"
DATA_DIR="${MEMOS_DATA_DIR:-$SCRIPT_DIR/data}"  # 默认使用项目目录下的 data 子目录
PORT="${MEMOS_PORT:-5230}"

# 获取版本标签参数
VERSION_TAG=${1:-latest}

echo "=========================================="
echo "开始拉取并部署 Docker 容器"
echo "=========================================="
echo "镜像地址: $IMAGE_NAME:$VERSION_TAG"
echo "容器名称: $CONTAINER_NAME"
echo "数据目录: $DATA_DIR (主机目录)"
echo "端口映射: $PORT:5230"
echo "=========================================="

# 检查并创建数据目录
echo ""
echo "步骤 1/6: 检查数据目录..."
if [ ! -d "$DATA_DIR" ]; then
    echo "创建数据目录: $DATA_DIR"
    mkdir -p "$DATA_DIR"
    chmod 777 "$DATA_DIR"  # 让容器内的 nonroot 用户可以写入
    echo "目录权限已设置为 777"
else
    echo "数据目录已存在: $DATA_DIR"
    # 检查权限，如果不是 777 则修复
    PERMS=$(stat -c "%a" "$DATA_DIR" 2>/dev/null || stat -f "%Lp" "$DATA_DIR" 2>/dev/null)
    if [ "$PERMS" != "777" ]; then
        echo "修复目录权限: $DATA_DIR (当前: $PERMS -> 777)"
        chmod 777 "$DATA_DIR"
    else
        echo "目录权限正确: 777"
    fi
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
    -v "$DATA_DIR:/var/opt/memos" \
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
echo "数据存储: $DATA_DIR"
echo "  查看数据: ls -la $DATA_DIR"
echo ""
echo "常用命令:"
echo "  查看日志: docker logs -f $CONTAINER_NAME"
echo "  停止容器: docker stop $CONTAINER_NAME"
echo "  重启容器: docker restart $CONTAINER_NAME"
echo "  删除容器: docker rm -f $CONTAINER_NAME"
echo ""
echo "数据备份:"
echo "  备份: tar czf memos-backup-\$(date +%Y%m%d).tar.gz -C $DATA_DIR ."
echo "  恢复: tar xzf memos-backup-YYYYMMDD.tar.gz -C $DATA_DIR"
echo "=========================================="
