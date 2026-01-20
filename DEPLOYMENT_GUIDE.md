# Memos Docker 部署脚本使用指南

本文档说明如何使用 `build-push.sh` 和 `pull.sh` 脚本在任何系统上构建、推送和部署 Memos Docker 容器。

## 核心改进

### ✅ 跨平台兼容性
- **使用 Docker 命名卷**替代绑定挂载，自动处理权限问题
- 支持 Linux、macOS、Windows（WSL2）
- 无需手动修改文件权限

### ✅ 代理支持（可选）
- 自动检测操作系统并配置代理
- 支持通过环境变量设置代理
- 未设置代理时直接连接网络

### ✅ 安全性
- 容器使用非 root 用户（UID 10001）运行
- 数据持久化到 Docker 卷
- 自动重启策略

---

## 脚本 1: build-push.sh

### 功能
构建 Docker 镜像并推送到 GitHub Container Registry (GHCR)

### 使用方法

```bash
# 推送 latest 标签
./build-push.sh

# 推送特定版本标签
./build-push.sh v1.0.0
```

### 前置要求

1. **安装依赖**
   ```bash
   # Node.js 和 pnpm
   node --version  # 需要 Node.js 18+
   pnpm --version  # 如果没有: npm install -g pnpm
   
   # Docker
   docker --version
   ```

2. **登录 GitHub Container Registry**
   ```bash
   # 创建 GitHub Personal Access Token (PAT)
   # 权限: write:packages, read:packages, delete:packages
   
   # 登录
   docker login ghcr.io
   # Username: 你的 GitHub 用户名
   # Password: 你的 PAT
   ```

3. **配置镜像名称**（可选）
   
   编辑 `build-push.sh` 第 11 行：
   ```bash
   IMAGE_NAME="ghcr.io/你的用户名/memos"
   ```

### 代理配置（可选）

如果需要使用代理：

```bash
# 方法 1: 设置环境变量
export HTTP_PROXY=http://127.0.0.1:7897
export HTTPS_PROXY=http://127.0.0.1:7897
./build-push.sh

# 方法 2: 临时设置
HTTP_PROXY=http://127.0.0.1:7897 HTTPS_PROXY=http://127.0.0.1:7897 ./build-push.sh
```

脚本会自动检测操作系统并配置容器内代理：
- **Linux**: `http://172.17.0.1:7897`
- **macOS**: `http://host.docker.internal:7897`
- **Windows**: `http://host.docker.internal:7897`

### 构建流程

```
步骤 1/6: 构建前端
  - pnpm install
  - pnpm release
  - 输出到 server/router/frontend/dist

步骤 2/6: 验证前端构建产物

步骤 3/6: 构建 Docker 镜像
  - 使用 scripts/Dockerfile
  - 多阶段构建（Go 后端 + Alpine 运行时）
  - 创建 nonroot 用户（UID 10001）

步骤 4/6: 打标签
  - memos:$VERSION_TAG
  - ghcr.io/用户名/memos:$VERSION_TAG
  - ghcr.io/用户名/memos:latest (如果不是 latest)

步骤 5/6: 检查登录状态

步骤 6/6: 推送到 GHCR
```

### 故障排除

**问题 1: 前端构建失败**
```bash
# 清理并重试
cd web
rm -rf node_modules pnpm-lock.yaml
pnpm install
pnpm release
cd ..
```

**问题 2: Docker 构建失败（网络问题）**
```bash
# 设置代理
export HTTP_PROXY=http://127.0.0.1:7897
export HTTPS_PROXY=http://127.0.0.1:7897
./build-push.sh
```

**问题 3: 推送失败（权限问题）**
```bash
# 重新登录
docker logout ghcr.io
docker login ghcr.io

# 检查 PAT 权限
# 需要: write:packages, read:packages
```

---

## 脚本 2: pull.sh

### 功能
从 GHCR 拉取镜像并部署到本地

### 使用方法

```bash
# 拉取并部署 latest 版本
./pull.sh

# 拉取并部署特定版本
./pull.sh v1.0.0

# 自定义端口
MEMOS_PORT=8080 ./pull.sh
```

### 前置要求

1. **安装 Docker**
   ```bash
   docker --version
   ```

2. **登录 GHCR**（如果镜像是私有的）
   ```bash
   docker login ghcr.io
   # 权限: read:packages
   ```

### 部署流程

```
步骤 1/6: 检查 Docker 数据卷
  - 创建命名卷 'memos-data'（如果不存在）
  - 显示卷位置

步骤 2/6: 检查 GHCR 登录状态

步骤 3/6: 拉取镜像
  - docker pull ghcr.io/用户名/memos:$VERSION_TAG

步骤 4/6: 打本地标签
  - docker tag ... memos:latest

步骤 5/6: 停止并删除旧容器
  - docker stop memos
  - docker rm memos

步骤 6/6: 启动新容器
  - 使用 Docker 命名卷
  - 端口映射: 5230:5230
  - 自动重启: unless-stopped
  - 健康检查
```

### 数据管理

#### 查看数据卷信息
```bash
docker volume inspect memos-data
```

#### 备份数据
```bash
# 备份到当前目录
docker run --rm \
  -v memos-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/memos-backup-$(date +%Y%m%d).tar.gz -C /data .
```

#### 恢复数据
```bash
# 从备份恢复
docker run --rm \
  -v memos-data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/memos-backup-YYYYMMDD.tar.gz -C /data
```

#### 从旧的绑定挂载迁移数据
```bash
# 如果之前使用 ~/.memos 目录
docker run --rm \
  -v ~/.memos:/source \
  -v memos-data:/dest \
  alpine cp -a /source/. /dest/
```

### 容器管理

```bash
# 查看日志
docker logs -f memos

# 查看实时日志（最近 100 行）
docker logs --tail 100 -f memos

# 停止容器
docker stop memos

# 启动容器
docker start memos

# 重启容器
docker restart memos

# 删除容器（数据保留在卷中）
docker rm -f memos

# 进入容器
docker exec -it memos sh

# 查看容器资源使用
docker stats memos
```

### 访问 Memos

部署成功后，访问：
- **本地**: http://localhost:5230
- **局域网**: http://你的IP:5230

健康检查：
```bash
curl http://localhost:5230/healthz
# 应返回: Service ready.
```

### 故障排除

**问题 1: 容器不断重启**
```bash
# 查看日志
docker logs memos

# 常见原因：
# 1. 端口被占用
sudo lsof -i :5230
# 解决：停止占用端口的进程或更改端口
MEMOS_PORT=8080 ./pull.sh

# 2. 数据卷权限问题（已通过命名卷解决）
# 3. 内存不足
docker stats memos
```

**问题 2: 无法访问 Web 界面**
```bash
# 检查容器状态
docker ps | grep memos

# 检查端口映射
docker port memos

# 检查防火墙
sudo ufw status
sudo ufw allow 5230/tcp

# 检查健康状态
curl http://localhost:5230/healthz
```

**问题 3: 数据丢失**
```bash
# 检查卷是否存在
docker volume ls | grep memos-data

# 检查卷内容
docker run --rm -v memos-data:/data alpine ls -la /data

# 如果卷被删除，从备份恢复
docker volume create memos-data
docker run --rm \
  -v memos-data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/memos-backup-YYYYMMDD.tar.gz -C /data
```

---

## 完整部署示例

### 场景 1: 首次部署

```bash
# 1. 拉取代码
git clone https://github.com/你的用户名/memos.git
cd memos

# 2. 构建并推送（开发者）
./build-push.sh v1.0.0

# 3. 部署到服务器（用户）
./pull.sh v1.0.0

# 4. 访问
curl http://localhost:5230/healthz
open http://localhost:5230
```

### 场景 2: 更新版本

```bash
# 1. 构建新版本（开发者）
./build-push.sh v1.1.0

# 2. 更新部署（用户）
./pull.sh v1.1.0

# 数据会自动保留
```

### 场景 3: 从旧版本迁移

```bash
# 1. 备份旧数据
docker run --rm \
  -v ~/.memos:/source \
  -v $(pwd):/backup \
  alpine tar czf /backup/memos-backup-old.tar.gz -C /source .

# 2. 停止旧容器
docker stop memos
docker rm memos

# 3. 创建新卷并迁移数据
docker volume create memos-data
docker run --rm \
  -v ~/.memos:/source \
  -v memos-data:/dest \
  alpine cp -a /source/. /dest/

# 4. 部署新版本
./pull.sh

# 5. 验证数据
docker logs memos
curl http://localhost:5230/healthz
```

---

## Docker Compose 部署（推荐）

如果你更喜欢使用 Docker Compose：

```bash
# 使用项目提供的 compose.yaml
docker compose -f scripts/compose.yaml up -d

# 查看日志
docker compose -f scripts/compose.yaml logs -f

# 停止
docker compose -f scripts/compose.yaml down

# 停止并删除卷（危险！会删除数据）
docker compose -f scripts/compose.yaml down -v
```

---

## 环境变量

### build-push.sh

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HTTP_PROXY` | 无 | HTTP 代理地址 |
| `HTTPS_PROXY` | 无 | HTTPS 代理地址 |

### pull.sh

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MEMOS_PORT` | 5230 | 宿主机端口 |

### 容器运行时

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MEMOS_MODE` | prod | 运行模式: dev/prod/demo |
| `MEMOS_PORT` | 5230 | 容器内端口 |
| `MEMOS_DRIVER` | sqlite | 数据库: sqlite/mysql/postgres |
| `MEMOS_DSN` | 无 | 数据库连接字符串 |

---

## 安全建议

1. **使用非 root 用户**
   - ✅ 已配置：容器使用 UID 10001 运行

2. **定期备份数据**
   ```bash
   # 设置定时任务
   crontab -e
   # 每天凌晨 2 点备份
   0 2 * * * docker run --rm -v memos-data:/data -v /backup:/backup alpine tar czf /backup/memos-$(date +\%Y\%m\%d).tar.gz -C /data .
   ```

3. **使用 HTTPS**
   ```bash
   # 使用 Nginx 反向代理
   # 或 Caddy 自动 HTTPS
   ```

4. **限制容器资源**
   ```bash
   docker run -d \
     --name memos \
     --memory="512m" \
     --cpus="1.0" \
     -p 5230:5230 \
     -v memos-data:/var/opt/memos \
     memos:latest
   ```

---

## 常见问题 (FAQ)

### Q1: 为什么使用 Docker 命名卷而不是绑定挂载？
**A**: Docker 命名卷自动处理权限问题，跨平台兼容性更好，且性能更优。

### Q2: 如何访问卷中的文件？
**A**: 
```bash
# 方法 1: 使用临时容器
docker run --rm -it -v memos-data:/data alpine sh
cd /data && ls -la

# 方法 2: 复制文件到宿主机
docker run --rm -v memos-data:/data -v $(pwd):/backup alpine cp /data/memos_prod.db /backup/
```

### Q3: 如何更改数据存储位置？
**A**: 如果必须使用特定目录，修改 `pull.sh`：
```bash
# 使用绑定挂载（需要手动处理权限）
docker run -d \
  --name memos \
  -p 5230:5230 \
  -v /your/custom/path:/var/opt/memos \
  --user 10001:10001 \
  memos:latest

# 或者先修改目录权限
sudo chown -R 10001:10001 /your/custom/path
```

### Q4: 如何使用外部数据库（MySQL/PostgreSQL）？
**A**:
```bash
docker run -d \
  --name memos \
  -p 5230:5230 \
  -e MEMOS_DRIVER=mysql \
  -e MEMOS_DSN="user:password@tcp(mysql-host:3306)/memos" \
  memos:latest
```

### Q5: 如何查看构建日志？
**A**:
```bash
# 构建日志保存在
cat /tmp/memos-docker-build.log
```

---

## 技术细节

### Dockerfile 关键特性

1. **多阶段构建**
   - 阶段 1: Go 1.25 Alpine 构建后端
   - 阶段 2: Alpine 3.21 运行时

2. **安全加固**
   - 非 root 用户（nonroot:10001）
   - 静态链接二进制（CGO_ENABLED=0）
   - 最小化镜像（Alpine）

3. **构建优化**
   - 构建缓存（go mod download）
   - 代理支持（HTTP_PROXY）
   - 跨平台构建（TARGETOS/TARGETARCH）

### 数据卷结构

```
memos-data/
├── memos_prod.db          # SQLite 数据库
├── memos_prod.db-shm      # SQLite 共享内存
├── memos_prod.db-wal      # SQLite 预写日志
└── assets/                # 上传的文件
    ├── images/
    ├── videos/
    └── documents/
```

---

## 支持与反馈

如有问题，请：
1. 查看日志: `docker logs memos`
2. 检查 `DOCKER_FIX.md` 文档
3. 提交 Issue 到 GitHub

---

**最后更新**: 2026-01-20
**版本**: 1.0.0
