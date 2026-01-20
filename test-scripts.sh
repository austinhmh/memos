#!/bin/bash

# test-scripts.sh - 测试 build-push.sh 和 pull.sh 脚本的各个步骤

set -e

echo "=========================================="
echo "测试脚本功能"
echo "=========================================="

echo ""
echo "测试 1: 检查脚本文件存在性"
echo "----------------------------------------"
if [ -f "build-push.sh" ] && [ -x "build-push.sh" ]; then
    echo "✓ build-push.sh 存在且可执行"
else
    echo "✗ build-push.sh 不存在或不可执行"
    exit 1
fi

if [ -f "pull.sh" ] && [ -x "pull.sh" ]; then
    echo "✓ pull.sh 存在且可执行"
else
    echo "✗ pull.sh 不存在或不可执行"
    exit 1
fi

echo ""
echo "测试 2: 检查必要的工具"
echo "----------------------------------------"
if command -v node &> /dev/null; then
    echo "✓ Node.js 已安装: $(node --version)"
else
    echo "✗ Node.js 未安装"
    exit 1
fi

if command -v pnpm &> /dev/null; then
    echo "✓ pnpm 已安装: $(pnpm --version)"
else
    echo "✗ pnpm 未安装"
    exit 1
fi

if command -v docker &> /dev/null; then
    echo "✓ Docker 已安装: $(docker --version)"
else
    echo "✗ Docker 未安装"
    exit 1
fi

echo ""
echo "测试 3: 检查 Dockerfile"
echo "----------------------------------------"
if [ -f "scripts/Dockerfile" ]; then
    echo "✓ scripts/Dockerfile 存在"
else
    echo "✗ scripts/Dockerfile 不存在"
    exit 1
fi

echo ""
echo "测试 4: 测试前端构建"
echo "----------------------------------------"
cd web
echo "安装依赖..."
pnpm install --silent
echo "✓ 依赖安装成功"

echo "构建前端..."
pnpm release
echo "✓ 前端构建成功"
cd ..

if [ -d "server/router/frontend/dist" ]; then
    SIZE=$(du -sh server/router/frontend/dist | cut -f1)
    echo "✓ 构建产物存在: $SIZE"
else
    echo "✗ 构建产物不存在"
    exit 1
fi

echo ""
echo "测试 5: 验证构建产物内容"
echo "----------------------------------------"
if [ -f "server/router/frontend/dist/index.html" ]; then
    echo "✓ index.html 存在"
else
    echo "✗ index.html 不存在"
    exit 1
fi

if [ -d "server/router/frontend/dist/assets" ]; then
    ASSET_COUNT=$(ls -1 server/router/frontend/dist/assets | wc -l)
    echo "✓ assets 目录存在，包含 $ASSET_COUNT 个文件"
else
    echo "✗ assets 目录不存在"
    exit 1
fi

echo ""
echo "测试 6: 检查 Docker 环境"
echo "----------------------------------------"
if docker info &> /dev/null; then
    echo "✓ Docker daemon 正在运行"
else
    echo "✗ Docker daemon 未运行"
    exit 1
fi

echo ""
echo "测试 7: 检查数据目录配置"
echo "----------------------------------------"
DATA_DIR="${MEMOS_DATA_DIR:-$HOME/.memos}"
echo "默认数据目录: $DATA_DIR"
if [ -d "$DATA_DIR" ]; then
    echo "✓ 数据目录已存在"
else
    echo "! 数据目录不存在（首次运行时会自动创建）"
fi

echo ""
echo "=========================================="
echo "所有测试通过！"
echo "=========================================="
echo ""
echo "下一步："
echo "1. 构建并推送镜像:"
echo "   ./build-push.sh [tag]"
echo ""
echo "2. 拉取并部署:"
echo "   ./pull.sh [tag]"
echo ""
echo "注意："
echo "- 完整的 Docker 构建需要 5-10 分钟"
echo "- 推送镜像需要先登录: docker login ghcr.io"
echo "=========================================="
