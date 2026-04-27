#!/bin/bash

# pull.sh - 拉取（或使用本地）镜像并部署 Memos 容器
# 使用方法:
#   ./pull.sh                    # 从 GHCR 拉取 latest 并部署
#   ./pull.sh v1.0.0             # 从 GHCR 拉取指定版本并部署
#   ./pull.sh --local            # 使用本地 build-push.sh 构建的镜像部署
#   ./pull.sh --local v1.0.0     # 使用本地指定版本部署
#   ./pull.sh true               # 从 GHCR 拉取 latest，启用代理
#   ./pull.sh false              # 从 GHCR 拉取 latest，禁用代理
#   ./pull.sh v1.0.0 false       # 从 GHCR 拉取指定版本，禁用代理
#
# 使用前请确保：
#   1. 已配置 .env 文件（或设置环境变量）
#   2. GITHUB_USERNAME 为 GitHub 用户名
#   3. GITHUB_TOKEN 具有 read:packages 权限

set -e

cd "$(dirname "$0")"

IMAGE_NAME="ghcr.io/austinhmh/memos"
CONTAINER_NAME="memos"

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
        echo "GITHUB_TOKEN 需要 read:packages 权限"
        exit 1
    fi
fi

DATA_DIR="${MEMOS_DATA_DIR:-$HOME/.memos}"

# 决定实际使用的镜像名
if [ "$LOCAL_ONLY" = true ]; then
    RUN_IMAGE="memos:$VERSION_TAG"
else
    RUN_IMAGE="$IMAGE_NAME:$VERSION_TAG"
fi

echo "=========================================="
echo "Memos 部署"
echo "=========================================="
echo "镜像来源: $([ "$LOCAL_ONLY" = true ] && echo "本地" || echo "GHCR")"
echo "运行镜像: $RUN_IMAGE"
echo "容器名称: $CONTAINER_NAME"
echo "数据目录: $DATA_DIR"
echo "端口映射: 8081:5230"
echo "使用代理: $([ "$NO_PROXY" = true ] && echo "否" || echo "是")"
echo "=========================================="

# ── 步骤 1: 数据目录 ─────────────────────────────────
echo ""
echo "[ 1/4 ] 检查数据目录 ..."
if [ ! -d "$DATA_DIR" ]; then
    mkdir -p "$DATA_DIR"
    echo "  已创建: $DATA_DIR"
else
    echo "  已存在: $DATA_DIR"
fi

# ── 步骤 2: 获取镜像 ─────────────────────────────────
echo ""
if [ "$LOCAL_ONLY" = true ]; then
    echo "[ 2/4 ] 使用本地镜像 ..."
    if ! docker image inspect "$RUN_IMAGE" &>/dev/null; then
        echo "错误: 本地镜像 $RUN_IMAGE 不存在"
        echo "请先运行: ./build-push.sh --local $VERSION_TAG"
        exit 1
    fi
    echo "  本地镜像已确认: $RUN_IMAGE"
else
    echo "[ 2/4 ] 登录并从 GHCR 拉取镜像 ..."
    echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_USERNAME" --password-stdin
    docker pull "$RUN_IMAGE"
fi

# ── 步骤 3: 替换容器 ─────────────────────────────────
echo ""
echo "[ 3/4 ] 替换旧容器 ..."
if docker ps -aq -f "name=^${CONTAINER_NAME}$" | grep -q .; then
    echo "  停止并删除旧容器 ..."
    docker stop "$CONTAINER_NAME" 2>/dev/null || true
    docker rm "$CONTAINER_NAME" 2>/dev/null || true
fi

# ── 步骤 4: 启动新容器 ───────────────────────────────
echo ""
echo "[ 4/4 ] 启动新容器 ..."
INSTANCE_URL_ARGS=()
EFFECTIVE_INSTANCE_URL="${MEMOS_INSTANCE_URL:-}"
if [ "$LOCAL_ONLY" = true ] && [ -z "$EFFECTIVE_INSTANCE_URL" ]; then
    EFFECTIVE_INSTANCE_URL="http://localhost:8081"
fi
if [ -n "$EFFECTIVE_INSTANCE_URL" ]; then
    INSTANCE_URL_ARGS=(-e "MEMOS_INSTANCE_URL=$EFFECTIVE_INSTANCE_URL")
fi
docker run -d \
    --name "$CONTAINER_NAME" \
    -p 8081:5230 \
    -v "$DATA_DIR:/var/opt/memos" \
    -e MEMOS_MODE=prod \
    -e MEMOS_PORT=5230 \
    "${INSTANCE_URL_ARGS[@]}" \
    --user root \
    --restart always \
    "$RUN_IMAGE"

echo ""
echo "等待容器启动 ..."
sleep 3

# 检查容器状态
if docker ps -f "name=^${CONTAINER_NAME}$" --format "{{.Status}}" | grep -q "Up"; then
    echo ""
    echo "=========================================="
    echo "部署成功！"
    echo "=========================================="
    docker ps -f "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""

    # 检查是否有数据库错误
    if docker logs "$CONTAINER_NAME" 2>&1 | grep -q "readonly database"; then
        echo "警告: 检测到数据库只读错误，尝试修复权限 ..."
        docker stop "$CONTAINER_NAME"
        chmod -R 777 "$DATA_DIR" 2>/dev/null || true
        docker start "$CONTAINER_NAME"
        sleep 2
        echo "权限已修复并重启"
    fi

    echo "访问地址:  http://localhost:8081"
    echo "数据目录:  $DATA_DIR"
    echo ""
    echo "常用命令:"
    echo "  docker logs -f $CONTAINER_NAME     # 查看日志"
    echo "  docker restart $CONTAINER_NAME      # 重启"
    echo "  docker stop $CONTAINER_NAME         # 停止"
    echo "=========================================="
else
    echo ""
    echo "错误: 容器启动失败"
    echo "查看日志: docker logs $CONTAINER_NAME"
    docker logs "$CONTAINER_NAME" --tail 20 2>&1
    exit 1
fi
