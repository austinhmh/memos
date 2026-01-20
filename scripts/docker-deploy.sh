#!/bin/bash

set -e

echo "🚀 开始构建 Memos Docker 镜像（包含 Markdown 实时预览功能）"
echo ""

# 进入项目根目录
cd "$(dirname "$0")/.."

echo "📦 步骤 1/3: 构建前端..."
cd web

# 使用 Docker 容器来构建前端，避免本地环境问题
docker run --rm \
  -v "$(pwd):/app" \
  -w /app \
  node:20-alpine \
  sh -c "corepack enable && corepack prepare pnpm@latest --activate && pnpm install && pnpm release"

cd ..

echo "✅ 前端构建完成！"
echo ""

echo "🐳 步骤 2/3: 构建 Docker 镜像..."
docker build \
  -f scripts/Dockerfile \
  -t memos:custom \
  --build-arg VERSION=custom \
  --build-arg COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown") \
  .

echo "✅ Docker 镜像构建完成！"
echo ""

echo "🎉 步骤 3/3: 启动容器..."
docker run -d \
  --name memos \
  -p 8081:5230 \
  -v ~/.memos:/var/opt/memos \
  -e MEMOS_MODE=prod \
  -e MEMOS_PORT=5230 \
  memos:custom

echo ""
echo "✅ 部署完成！"
echo ""
echo "📝 访问地址: http://localhost:8081"
echo "📊 查看日志: docker logs -f memos"
echo "🛑 停止服务: docker stop memos"
echo "🗑️  删除容器: docker rm memos"
echo ""
