# Memos Docker 部署脚本

本目录包含用于构建、推送和部署 Memos Docker 镜像的自动化脚本。

## 📁 文件说明

- `build-push.sh` - 构建 Docker 镜像并推送到 GitHub Container Registry
- `pull.sh` - 从 GitHub Container Registry 拉取镜像并部署到本地

## 🚀 快速开始

### 前置要求

1. **安装 Docker**
   ```bash
   # macOS
   brew install --cask docker
   
   # 验证安装
   docker --version
   ```

2. **安装 Node.js 和 pnpm**
   ```bash
   # 安装 Node.js (如果尚未安装)
   brew install node
   
   # 安装 pnpm
   npm install -g pnpm
   
   # 验证安装
   node --version
   pnpm --version
   ```

3. **登录 GitHub Container Registry**
   ```bash
   docker login ghcr.io
   
   # 用户名: GitHub 用户名
   # 密码: GitHub Personal Access Token (PAT)
   # PAT 需要 write:packages 权限
   # 获取地址: https://github.com/settings/tokens
   ```

### 使用方法

#### 1. 构建并推送镜像

```bash
# 推送到 latest 标签
./build-push.sh

# 推送到指定版本标签
./build-push.sh v1.0.0
```

**脚本执行流程：**
1. 构建前端（`pnpm install` + `pnpm release`）
2. 验证前端构建产物
3. 使用 Dockerfile 构建 Docker 镜像
4. 为镜像打标签
5. 检查 Docker 登录状态
6. 推送镜像到 GitHub Container Registry

#### 2. 拉取并部署

```bash
# 拉取 latest 标签
./pull.sh

# 拉取指定版本标签
./pull.sh v1.0.0
```

**脚本执行流程：**
1. 检查数据目录（默认 `~/.memos`）
2. 检查 GHCR 登录状态
3. 拉取指定版本的镜像
4. 停止并删除旧容器（如果存在）
5. 启动新容器
6. 显示容器状态和访问信息

## ⚙️ 配置说明

### build-push.sh 配置

脚本中的主要配置变量：

```bash
IMAGE_NAME="ghcr.io/austinhmh/memos"    # 镜像名称
DOCKERFILE="scripts/Dockerfile"         # Dockerfile 路径
PROXY="http://127.0.0.1:7897"           # 代理地址（可选）
```

### pull.sh 配置

脚本中的主要配置变量：

```bash
IMAGE_NAME="ghcr.io/austinhmh/memos"    # 镜像名称
CONTAINER_NAME="memos"                   # 容器名称
DATA_DIR="$HOME/.memos"                  # 数据目录
```

**自定义数据目录：**
```bash
# 使用环境变量覆盖默认数据目录
export MEMOS_DATA_DIR=/path/to/your/data
./pull.sh
```

## 🐳 容器配置

### 默认配置

- **端口**: `5230:5230`（宿主机:容器）
- **数据卷**: `$HOME/.memos:/var/opt/memos`
- **环境变量**:
  - `MEMOS_MODE=prod`
  - `MEMOS_PORT=5230`
- **重启策略**: `always`

### 自定义配置

如果需要自定义配置，可以修改 `pull.sh` 中的 `docker run` 命令：

```bash
docker run -d \
    --name $CONTAINER_NAME \
    -p 5230:5230 \
    -v "$DATA_DIR:/var/opt/memos" \
    -e MEMOS_MODE=prod \
    -e MEMOS_PORT=5230 \
    # 添加更多环境变量
    -e MEMOS_DRIVER=postgres \
    -e MEMOS_DSN="user:password@host:5432/dbname" \
    --restart always \
    memos:latest
```

## 📝 常用命令

### 容器管理

```bash
# 查看容器状态
docker ps -f name=memos

# 查看容器日志
docker logs -f memos

# 停止容器
docker stop memos

# 重启容器
docker restart memos

# 删除容器
docker rm -f memos

# 查看容器资源使用情况
docker stats memos
```

### 数据管理

```bash
# 进入容器 shell
docker exec -it memos sh

# 备份数据目录
cp -r ~/.memos ~/.memos.backup.$(date +%Y%m%d)

# 查看数据目录大小
du -sh ~/.memos
```

## 🔧 故障排除

### 构建失败

1. **前端构建失败**
   ```bash
   # 手动进入 web 目录测试
   cd web
   pnpm install
   pnpm release
   ```

2. **Docker 构建失败**
   ```bash
   # 查看详细构建日志
   cat /tmp/memos-docker-build.log
   
   # 清理 Docker 缓存后重试
   docker system prune -a
   ```

### 推送失败

1. **认证错误**
   ```bash
   # 重新登录 GHCR
   docker logout ghcr.io
   docker login ghcr.io
   ```

2. **网络问题**
   ```bash
   # 使用代理（如果配置了）
   export HTTP_PROXY=http://127.0.0.1:7897
   export HTTPS_PROXY=http://127.0.0.1:7897
   ```

### 部署失败

1. **端口冲突**
   ```bash
   # 检查端口占用
   lsof -i :5230
   
   # 修改端口映射（编辑 pull.sh）
   -p 8081:5230  # 使用 8081 端口
   ```

2. **容器启动失败**
   ```bash
   # 查看容器日志
   docker logs memos
   
   # 检查数据目录权限
   ls -la ~/.memos
   ```

## 📚 相关链接

- [Memos GitHub](https://github.com/usememos/memos)
- [Fork 仓库](https://github.com/austinhmh/memos)
- [Docker Hub](https://hub.docker.com/r/neosmemo/memos)
- [GitHub Container Registry](https://ghcr.io/austinhmh/memos)

## 🆘 获取帮助

如果遇到问题：

1. 查看脚本日志（`/tmp/memos-docker-build.log`）
2. 检查容器日志（`docker logs memos`）
3. 参考故障排除章节
4. 提交 Issue 到 GitHub 仓库

## 📄 许可证

本脚本遵循 MIT 许可证。
