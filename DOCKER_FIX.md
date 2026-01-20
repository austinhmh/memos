# Memos Docker 容器重启问题修复

## 问题描述

Memos Docker 容器一启动就不断重启，错误日志显示：
```
ERROR failed to migrate error="unable to open database file: out of memory (14)"
```

## 根本原因

这个错误**不是真正的内存不足**，而是 **SQLite 数据库文件权限问题**：

1. **容器使用 nonroot 用户运行**（UID 10001）
2. **宿主机挂载目录** `~/.memos` 的所有者是当前用户（如 `mi:mi`）
3. **容器内的 nonroot 用户无法在宿主机目录中创建数据库文件**

## 解决方案

### 方案 1：使用 Docker 命名卷（推荐）✅

Docker 命名卷会自动处理权限问题，这是最简单的方案：

```bash
# 1. 停止并删除旧容器
docker stop memos && docker rm memos

# 2. 创建 Docker 命名卷
docker volume create memos-data

# 3. 使用命名卷启动容器
docker run -d \
  --name memos \
  -p 5230:5230 \
  -v memos-data:/var/opt/memos \
  memos:latest
```

**优点**：
- Docker 自动处理权限
- 数据持久化
- 跨平台兼容性好

**数据位置**：
```bash
# 查看卷的实际位置
docker volume inspect memos-data
# 通常在 /var/lib/docker/volumes/memos-data/_data
```

### 方案 2：修改宿主机目录权限

如果你需要使用绑定挂载（bind mount）访问宿主机的特定目录：

```bash
# 1. 停止并删除旧容器
docker stop memos && docker rm memos

# 2. 修改目录权限为容器用户的 UID/GID
sudo chown -R 10001:10001 ~/.memos

# 3. 使用绑定挂载启动容器
docker run -d \
  --name memos \
  -p 5230:5230 \
  -v ~/.memos:/var/opt/memos \
  memos:latest
```

**优点**：
- 可以直接访问宿主机文件
- 方便备份和迁移

**缺点**：
- 需要 sudo 权限修改所有者
- 宿主机上的文件所有者会显示为 10001

### 方案 3：使用 Docker Compose（推荐用于生产环境）

更新 `scripts/compose.yaml`：

```yaml
services:
  memos:
    image: memos:latest
    container_name: memos
    volumes:
      - memos-data:/var/opt/memos  # 使用命名卷
    ports:
      - 5230:5230
    restart: unless-stopped

volumes:
  memos-data:  # 定义命名卷
```

启动：
```bash
docker compose -f scripts/compose.yaml up -d
```

## 验证修复

```bash
# 1. 检查容器状态
docker ps | grep memos
# 应该显示 "Up" 状态

# 2. 查看日志
docker logs memos
# 应该看到 "Memos 0.26.0 started successfully!"

# 3. 测试健康检查
curl http://localhost:5230/healthz
# 应该返回 "Service ready."

# 4. 访问 Web 界面
# 浏览器打开 http://localhost:5230
```

## Dockerfile 改进

已更新 `scripts/Dockerfile`，添加了以下改进：

1. **明确创建 nonroot 用户**（UID 10001）
2. **设置正确的目录权限**
3. **使用 USER 指令切换到非 root 用户**
4. **优化构建缓存和安全性**

关键改动：
```dockerfile
# 创建非 root 用户
RUN addgroup -g 10001 -S nonroot && \
    adduser -u 10001 -S -G nonroot -h /var/opt/memos nonroot && \
    mkdir -p /var/opt/memos && \
    chown -R nonroot:nonroot /var/opt/memos

# 切换到非 root 用户
USER nonroot:nonroot
```

## 数据备份

### 使用命名卷时的备份

```bash
# 备份
docker run --rm \
  -v memos-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/memos-backup-$(date +%Y%m%d).tar.gz -C /data .

# 恢复
docker run --rm \
  -v memos-data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/memos-backup-YYYYMMDD.tar.gz -C /data
```

### 使用绑定挂载时的备份

```bash
# 直接备份目录
tar czf memos-backup-$(date +%Y%m%d).tar.gz ~/.memos
```

## 常见问题

### Q: 为什么不直接使用 root 用户运行容器？
A: 使用非 root 用户是安全最佳实践，可以限制容器的权限，防止潜在的安全风险。

### Q: 如何迁移现有数据到命名卷？
A: 
```bash
# 1. 停止容器
docker stop memos

# 2. 创建命名卷
docker volume create memos-data

# 3. 复制数据
docker run --rm \
  -v ~/.memos:/source \
  -v memos-data:/dest \
  alpine cp -a /source/. /dest/

# 4. 使用命名卷启动容器
docker run -d --name memos -p 5230:5230 -v memos-data:/var/opt/memos memos:latest
```

### Q: 如何查看命名卷中的文件？
A:
```bash
# 方法 1：使用临时容器
docker run --rm -it -v memos-data:/data alpine ls -la /data

# 方法 2：进入运行中的容器
docker exec -it memos ls -la /var/opt/memos
```

## 总结

问题已成功修复！容器现在使用 Docker 命名卷 `memos-data`，权限问题已解决。

- ✅ 容器正常运行
- ✅ 数据库初始化成功
- ✅ Web 服务可访问（http://localhost:5230）
- ✅ 数据持久化
