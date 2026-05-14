#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

cd "$(dirname "$0")/.."

CONTAINER_NAME="${CONTAINER_NAME:-memos}"
HOST_ADDR="${MEMOS_HOST_ADDR:-127.0.0.1}"
HOST_PORT="${MEMOS_HOST_PORT:-8081}"
DATA_DIR="${MEMOS_DATA_DIR:-$HOME/.memos}"
IMAGE_TAG="${IMAGE_TAG:-memos:custom}"

validate_port() {
  [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

validate_port "$HOST_PORT" || { echo "错误: 非法端口 $HOST_PORT" >&2; exit 1; }
[[ "$HOST_ADDR" =~ ^[A-Za-z0-9_.:-]+$ ]] || { echo "错误: 非法监听地址 $HOST_ADDR" >&2; exit 1; }
[[ "$CONTAINER_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || { echo "错误: 非法容器名称 $CONTAINER_NAME" >&2; exit 1; }
[[ "$DATA_DIR" = /* ]] || { echo "错误: MEMOS_DATA_DIR 必须是绝对路径" >&2; exit 1; }

install -d -m 700 "$DATA_DIR"

echo "开始构建 Memos Docker 镜像"
echo ""

echo "步骤 1/3: 构建前端..."
docker run --rm \
  --user "$(id -u):$(id -g)" \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  -v "$(pwd)/web:/app" \
  -w /app \
  node:20-alpine \
  sh -c "corepack enable && corepack prepare pnpm@10.24.0 --activate && pnpm install --frozen-lockfile && pnpm release"

echo "前端构建完成"
echo ""

echo "步骤 2/3: 构建 Docker 镜像..."
docker build \
  -f scripts/Dockerfile \
  -t "$IMAGE_TAG" \
  --build-arg VERSION=custom \
  --build-arg "COMMIT=$(git rev-parse --short HEAD 2>/dev/null || printf unknown)" \
  .

echo "Docker 镜像构建完成"
echo ""

echo "步骤 3/3: 启动容器..."
if [ -n "$(docker ps -aq -f "name=^${CONTAINER_NAME}$")" ]; then
  docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
  docker rm "$CONTAINER_NAME" >/dev/null 2>&1 || true
fi

docker run -d \
  --name "$CONTAINER_NAME" \
  --user 10001:10001 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  -p "$HOST_ADDR:$HOST_PORT:5230" \
  -v "$DATA_DIR:/var/opt/memos" \
  -e MEMOS_MODE=prod \
  -e MEMOS_PORT=5230 \
  "$IMAGE_TAG"

echo ""
echo "部署完成"
echo "访问地址: http://localhost:$HOST_PORT"
echo "查看日志: docker logs -f $CONTAINER_NAME"
echo "停止服务: docker stop $CONTAINER_NAME"
