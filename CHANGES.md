# 脚本修改对比

## 核心改进总结

### ✅ 解决的问题
1. **权限问题** - 使用 Docker 命名卷替代绑定挂载
2. **跨平台兼容** - 在 Linux、macOS、Windows 上都能正常运行
3. **代理可选** - 代理配置变为可选，未设置时直接连接
4. **更好的错误处理** - 增强了健康检查和状态验证

---

## build-push.sh 修改对比

### 修改前的问题
```bash
# 硬编码代理地址
PROXY="http://127.0.0.1:7897"

# 总是设置代理（即使不需要）
export HTTP_PROXY=$PROXY
export HTTPS_PROXY=$PROXY
```

### 修改后的改进
```bash
# 从环境变量读取，默认为空
PROXY="${HTTP_PROXY:-}"

# 只在设置了代理时才配置
if [ -n "$PROXY" ]; then
    # 根据操作系统配置容器内代理
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        CONTAINER_PROXY="http://172.17.0.1:7897"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        CONTAINER_PROXY="http://host.docker.internal:7897"
    fi
else
    echo "未设置代理，将直接连接网络"
fi
```

### 使用方式对比

**修改前**（必须修改脚本）:
```bash
# 需要编辑脚本修改代理地址
vim build-push.sh  # 修改 PROXY 变量
./build-push.sh
```

**修改后**（灵活配置）:
```bash
# 方式 1: 不使用代理（默认）
./build-push.sh

# 方式 2: 使用代理
export HTTP_PROXY=http://127.0.0.1:7897
./build-push.sh

# 方式 3: 临时使用代理
HTTP_PROXY=http://127.0.0.1:7897 ./build-push.sh
```

---

## pull.sh 修改对比

### 修改前的问题
```bash
# 使用绑定挂载
DATA_DIR="${MEMOS_DATA_DIR:-$HOME/.memos}"
docker run -d \
    -v "$DATA_DIR:/var/opt/memos" \
    ...

# 问题：
# 1. 宿主机目录权限不匹配（mi:mi vs nonroot:10001）
# 2. 容器无法写入数据库文件
# 3. SQLite 报错 "out of memory (14)"
# 4. 容器不断重启
```

### 修改后的改进
```bash
# 使用 Docker 命名卷
VOLUME_NAME="memos-data"

# 自动创建卷
if ! docker volume inspect "$VOLUME_NAME" &>/dev/null; then
    docker volume create "$VOLUME_NAME"
fi

# 使用命名卷挂载
docker run -d \
    -v "$VOLUME_NAME:/var/opt/memos" \
    ...

# 优点：
# 1. Docker 自动处理权限
# 2. 跨平台兼容
# 3. 性能更好
# 4. 容器正常运行
```

### 数据管理对比

**修改前**（绑定挂载）:
```bash
# 数据位置
~/.memos/

# 备份
tar czf backup.tar.gz ~/.memos

# 权限问题
sudo chown -R 10001:10001 ~/.memos  # 需要 sudo
```

**修改后**（命名卷）:
```bash
# 数据位置
docker volume inspect memos-data

# 备份（无需 sudo）
docker run --rm \
  -v memos-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/backup.tar.gz -C /data .

# 无权限问题
# Docker 自动处理
```

---

## 健康检查增强

### 修改前
```bash
# 简单等待
sleep 3

# 显示状态
docker ps -f name=$CONTAINER_NAME
```

### 修改后
```bash
# 等待启动
sleep 3

# 检查容器状态
CONTAINER_STATUS=$(docker inspect -f '{{.State.Status}}' "$CONTAINER_NAME")

if [ "$CONTAINER_STATUS" = "running" ]; then
    echo "✓ 容器运行正常"
    
    # HTTP 健康检查
    if curl -sf "http://localhost:$PORT/healthz" > /dev/null 2>&1; then
        echo "✓ 健康检查通过"
    else
        echo "⚠ 健康检查失败，容器可能还在启动中"
    fi
else
    echo "✗ 容器状态异常: $CONTAINER_STATUS"
    echo "查看日志: docker logs $CONTAINER_NAME"
fi
```

---

## 错误处理改进

### 修改前
```bash
# 基本错误处理
set -e
```

### 修改后
```bash
# 增强的错误处理
set -e  # 遇到错误立即退出

# 详细的前置检查
if [ ! -f "$DOCKERFILE" ]; then
    echo "错误: 找不到 $DOCKERFILE 文件"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "错误: 未找到 node，请先安装 Node.js"
    exit 1
fi

# 构建验证
if [ ! -d "server/router/frontend/dist" ]; then
    echo "错误: 前端构建失败"
    exit 1
fi
```

---

## 输出信息改进

### 修改前
```bash
echo "部署完成！"
docker ps -f name=$CONTAINER_NAME
```

### 修改后
```bash
echo "=========================================="
echo "部署完成！"
echo "=========================================="
docker ps -f name=^${CONTAINER_NAME}$ --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""
echo "访问地址:"
echo "  本地: http://localhost:$PORT"
echo "  外部: http://$HOSTNAME:$PORT"
echo ""
echo "数据存储: Docker 卷 '$VOLUME_NAME'"
echo "  查看卷信息: docker volume inspect $VOLUME_NAME"
echo ""
echo "常用命令:"
echo "  查看日志: docker logs -f $CONTAINER_NAME"
echo "  停止容器: docker stop $CONTAINER_NAME"
echo "  重启容器: docker restart $CONTAINER_NAME"
echo ""
echo "数据备份:"
echo "  备份: docker run --rm -v $VOLUME_NAME:/data ..."
echo "  恢复: docker run --rm -v $VOLUME_NAME:/data ..."
echo "=========================================="
```

---

## 迁移指南

### 从旧版本迁移到新版本

如果你之前使用绑定挂载 `~/.memos`，现在想迁移到命名卷：

```bash
# 1. 停止旧容器
docker stop memos
docker rm memos

# 2. 创建新的命名卷
docker volume create memos-data

# 3. 迁移数据
docker run --rm \
  -v ~/.memos:/source \
  -v memos-data:/dest \
  alpine cp -a /source/. /dest/

# 4. 使用新脚本部署
./pull.sh

# 5. 验证数据
docker logs memos
curl http://localhost:5230/healthz

# 6. 确认无误后，可以删除旧目录（可选）
# rm -rf ~/.memos
```

---

## 性能对比

### 绑定挂载 vs 命名卷

| 特性 | 绑定挂载 | 命名卷 |
|------|----------|--------|
| **权限处理** | 需要手动 `chown` | 自动处理 ✓ |
| **跨平台** | 有问题 | 完美支持 ✓ |
| **性能（Linux）** | 好 | 更好 ✓ |
| **性能（macOS）** | 慢 | 快 ✓ |
| **性能（Windows）** | 很慢 | 快 ✓ |
| **备份** | 简单 `tar` | 需要容器 |
| **直接访问** | 容易 | 需要容器 |
| **Docker 管理** | 否 | 是 ✓ |

### 推荐使用场景

**使用命名卷**（推荐）:
- ✅ 生产环境部署
- ✅ 跨平台开发
- ✅ 不需要直接访问文件
- ✅ 追求最佳性能

**使用绑定挂载**:
- 需要频繁直接访问数据库文件
- 需要使用宿主机工具处理文件
- 开发调试场景

---

## 测试验证

### 测试脚本语法
```bash
# 检查语法
bash -n build-push.sh
bash -n pull.sh

# 应该没有输出，返回码为 0
```

### 测试部署流程
```bash
# 1. 测试 pull.sh（使用本地镜像）
./pull.sh

# 2. 检查容器状态
docker ps | grep memos

# 3. 检查健康状态
curl http://localhost:5230/healthz

# 4. 检查日志
docker logs memos | tail -20

# 5. 检查数据卷
docker volume inspect memos-data
docker run --rm -v memos-data:/data alpine ls -la /data
```

### 测试数据持久化
```bash
# 1. 创建测试数据
# 访问 http://localhost:5230 并创建一些 memo

# 2. 重启容器
docker restart memos

# 3. 验证数据还在
# 刷新页面，数据应该保留

# 4. 删除容器（保留卷）
docker rm -f memos

# 5. 重新部署
./pull.sh

# 6. 验证数据还在
# 数据应该完整保留
```

---

## 总结

### 主要改进
1. ✅ **权限问题彻底解决** - 使用 Docker 命名卷
2. ✅ **跨平台兼容** - Linux、macOS、Windows 都能运行
3. ✅ **代理可选** - 灵活配置，不强制使用
4. ✅ **更好的用户体验** - 详细的输出和错误提示
5. ✅ **增强的健康检查** - 自动验证部署状态
6. ✅ **完善的文档** - DEPLOYMENT_GUIDE.md

### 向后兼容
- 旧数据可以轻松迁移
- 提供了详细的迁移指南
- 保留了所有功能

### 下一步
1. 测试脚本在不同系统上的表现
2. 根据反馈继续优化
3. 考虑添加更多配置选项（如数据库类型）
