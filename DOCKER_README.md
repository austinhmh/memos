# Memos Docker 快速开始

## 🚀 快速部署（用户）

```bash
# 1. 拉取并部署 Memos
./pull.sh

# 2. 访问
open http://localhost:5230
```

就这么简单！数据会自动保存到 Docker 卷 `memos-data` 中。

---

## 📦 构建和推送（开发者）

```bash
# 1. 构建并推送到 GHCR
./build-push.sh

# 2. 推送特定版本
./build-push.sh v1.0.0
```

---

## 📚 详细文档

- **[部署指南](DEPLOYMENT_GUIDE.md)** - 完整的使用说明
- **[Docker 修复说明](DOCKER_FIX.md)** - 权限问题解决方案
- **[修改对比](CHANGES.md)** - 脚本改进详情

---

## 🔧 常用命令

```bash
# 查看日志
docker logs -f memos

# 重启容器
docker restart memos

# 备份数据
docker run --rm -v memos-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/memos-backup-$(date +%Y%m%d).tar.gz -C /data .

# 恢复数据
docker run --rm -v memos-data:/data -v $(pwd):/backup \
  alpine tar xzf /backup/memos-backup-YYYYMMDD.tar.gz -C /data
```

---

## ✨ 核心特性

- ✅ **跨平台** - Linux、macOS、Windows 都能运行
- ✅ **自动权限** - 使用 Docker 命名卷，无需手动配置
- ✅ **数据持久化** - 数据安全保存在 Docker 卷中
- ✅ **健康检查** - 自动验证部署状态
- ✅ **简单易用** - 一条命令完成部署

---

## 🐛 故障排除

### 容器不断重启？
```bash
# 查看日志
docker logs memos

# 检查端口占用
sudo lsof -i :5230
```

### 无法访问？
```bash
# 检查容器状态
docker ps | grep memos

# 检查健康状态
curl http://localhost:5230/healthz
```

### 需要帮助？
查看 [DOCKER_FIX.md](DOCKER_FIX.md) 获取详细的故障排除指南。

---

## 📝 环境变量

```bash
# 自定义端口
MEMOS_PORT=8080 ./pull.sh

# 使用代理构建
HTTP_PROXY=http://127.0.0.1:7897 ./build-push.sh
```

---

**更多信息**: 查看 [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)
