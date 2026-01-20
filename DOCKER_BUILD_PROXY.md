# Docker 构建代理配置指南

## 问题说明

在使用代理的环境中构建 Docker 镜像时，容器内部需要能够访问宿主机的代理服务器。不同操作系统的配置方式不同。

## 解决方案

### 方案 1：配置代理监听所有接口（推荐）

修改代理软件配置，让它监听 `0.0.0.0:7897` 而不是 `127.0.0.1:7897`。

**Clash/ClashX 配置示例：**
```yaml
mixed-port: 7897
bind-address: "*"  # 或 0.0.0.0
allow-lan: true
```

**V2Ray/V2RayN 配置：**
- 在设置中启用"允许来自局域网的连接"
- 监听地址设置为 `0.0.0.0`

配置完成后，重启代理软件，然后运行：
```bash
./build-push.sh
```

### 方案 2：使用 host 网络模式

修改 `build-push.sh` 中的 docker build 命令，添加 `--network=host`：

```bash
docker build \
    --network=host \
    -f $DOCKERFILE \
    --build-arg HTTP_PROXY=http://127.0.0.1:7897 \
    --build-arg HTTPS_PROXY=http://127.0.0.1:7897 \
    ...
```

**注意：** `--network=host` 在 macOS 和 Windows 的 Docker Desktop 上不可用，仅适用于 Linux。

### 方案 3：使用 Alpine 镜像源（无需代理）

如果代理配置困难，可以修改 Dockerfile 使用国内镜像源：

在 `scripts/Dockerfile` 的 `FROM alpine:3.21 AS monolithic` 之后添加：

```dockerfile
# 使用阿里云镜像源
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories
```

或使用清华镜像源：
```dockerfile
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.tuna.tsinghua.edu.cn/g' /etc/apk/repositories
```

## 验证代理配置

### 1. 检查代理是否监听正确的地址

```bash
# Linux/macOS
netstat -an | grep 7897

# 或使用 ss
ss -tlnp | grep 7897
```

应该看到类似输出：
```
tcp    0    0 0.0.0.0:7897    0.0.0.0:*    LISTEN
```

如果看到 `127.0.0.1:7897`，说明代理只监听本地回环接口。

### 2. 测试容器能否访问代理

```bash
# Linux 系统
docker run --rm alpine:3.21 sh -c "apk add --no-cache curl && curl -x http://172.17.0.1:7897 https://www.google.com"

# macOS 系统
docker run --rm alpine:3.21 sh -c "apk add --no-cache curl && curl -x http://host.docker.internal:7897 https://www.google.com"
```

如果成功，说明代理配置正确。

## 当前脚本行为

`build-push.sh` 会自动检测操作系统：

- **Linux**: 使用 `http://172.17.0.1:7897`（Docker 默认网关）
- **macOS**: 使用 `http://host.docker.internal:7897`
- **Windows**: 使用 `http://host.docker.internal:7897`

## 常见错误

### DNS lookup error

```
WARNING: fetching https://dl-cdn.alpinelinux.org/alpine/v3.21/main: DNS lookup error
```

**原因：** 容器无法访问代理服务器

**解决：** 
1. 确认代理监听 `0.0.0.0:7897`
2. 检查防火墙是否阻止了容器访问
3. 使用方案 3（镜像源）

### Connection refused

```
WARNING: fetching https://dl-cdn.alpinelinux.org/alpine/v3.21/main: Connection refused
```

**原因：** 代理端口不正确或代理未运行

**解决：**
1. 确认代理正在运行
2. 检查端口号是否为 7897
3. 修改 `build-push.sh` 中的 `PROXY` 变量

## 防火墙配置（Linux）

如果使用 `ufw` 或 `firewalld`，需要允许 Docker 网络访问代理端口：

```bash
# ufw
sudo ufw allow from 172.17.0.0/16 to any port 7897

# firewalld
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="172.17.0.0/16" port port="7897" protocol="tcp" accept'
sudo firewall-cmd --reload
```

## 推荐配置（Linux 服务器）

1. 修改代理配置监听 `0.0.0.0:7897`
2. 配置防火墙允许 Docker 网络访问
3. 运行构建脚本

```bash
# 1. 编辑代理配置（以 Clash 为例）
vim ~/.config/clash/config.yaml
# 设置 bind-address: "*" 和 allow-lan: true

# 2. 重启代理
systemctl restart clash  # 或你的代理服务名

# 3. 验证监听
ss -tlnp | grep 7897

# 4. 运行构建
./build-push.sh
```
