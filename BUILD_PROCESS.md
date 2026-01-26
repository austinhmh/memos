# Memos 构建流程说明

## 概述

Memos 使用 Go 的 `embed` 功能将前端资源嵌入到后端二进制文件中，实现单一可执行文件部署。

## 构建流程

### 1. 前端构建 (web/ → server/router/frontend/dist/)

```bash
cd web
pnpm install
pnpm release  # 构建到 ../server/router/frontend/dist/
```

**输出位置**: `server/router/frontend/dist/`
- `index.html` - 主 HTML 文件
- `assets/` - JS、CSS、字体等静态资源

### 2. Go 编译时嵌入前端资源

在 `server/router/frontend/frontend.go` 中：

```go
//go:embed dist/*
var embeddedFiles embed.FS
```

**工作原理**:
- Go 编译器在编译时读取 `//go:embed` 指令
- 将 `dist/` 目录下的所有文件内容读取并嵌入到二进制文件中
- 生成的二进制文件包含完整的前端资源，无需外部文件

### 3. Docker 构建流程

```dockerfile
# 1. 复制源代码（包括 server/router/frontend/dist/）
COPY . .

# 2. Go 编译（此时会嵌入 dist/ 目录）
RUN go build -o memos ./cmd/memos

# 3. 最终镜像只需要二进制文件
COPY --from=backend /backend-build/memos /usr/local/memos/memos
```

**关键点**:
- Docker 构建时，`dist/` 目录必须已经存在
- Go 编译器会读取 `dist/` 并嵌入到二进制文件中
- 最终的 Docker 镜像只包含二进制文件，不需要单独的 `dist/` 目录

## 使用 build-push.sh 脚本

### 完整构建流程

```bash
./build-push.sh          # 构建并推送 latest 标签
./build-push.sh v1.0.0   # 构建并推送 v1.0.0 标签
```

### 脚本执行步骤

1. **步骤 1/7**: 构建前端资源
   - 安装依赖: `pnpm install`
   - 构建生产版本: `pnpm release`
   - 输出到: `server/router/frontend/dist/`

2. **步骤 2/7**: 验证前端构建产物
   - 检查 `dist/` 目录是否存在
   - 显示构建产物大小和文件数量

3. **步骤 3/7**: 准备 Docker 构建
   - 说明 Go embed 工作原理
   - 准备构建参数

4. **步骤 4/7**: 验证 Docker 镜像构建
   - 检查镜像是否成功创建
   - 显示镜像大小

5. **步骤 5/7**: 为镜像打标签
   - 打上版本标签
   - 如果不是 latest，同时打上 latest 标签

6. **步骤 6/7**: 检查 GitHub Container Registry 登录状态

7. **步骤 7/7**: 推送镜像到 GitHub Container Registry

## 常见问题

### Q: 为什么 Docker 镜像中的前端代码是旧的？

**A**: 因为 Go 的 `embed` 是在**编译时**嵌入的。如果你修改了前端代码但没有重新构建，Docker 镜像中仍然是旧的前端代码。

**解决方案**: 
1. 重新运行 `pnpm release` 构建前端
2. 重新运行 `./build-push.sh` 构建 Docker 镜像

### Q: 如何验证 Docker 镜像包含最新的前端代码？

**A**: 检查构建时间戳：

```bash
# 检查前端构建时间
ls -lh server/router/frontend/dist/index.html

# 检查 Docker 镜像创建时间
docker images memos:latest
```

确保 Docker 镜像的创建时间晚于前端构建时间。

### Q: .dockerignore 中的 web/dist 会影响构建吗？

**A**: 不会。`.dockerignore` 中的 `web/dist` 只是忽略 `web/` 目录下的 `dist/`（开发构建产物），不影响 `server/router/frontend/dist/`（生产构建产物）。

## 文件结构

```
memos/
├── web/                              # 前端源代码
│   ├── src/
│   ├── package.json
│   └── vite.config.mts
├── server/
│   └── router/
│       └── frontend/
│           ├── frontend.go           # 包含 //go:embed 指令
│           └── dist/                 # 前端构建产物（会被嵌入）
│               ├── index.html
│               └── assets/
├── scripts/
│   └── Dockerfile                    # Docker 构建文件
├── build-push.sh                     # 构建和推送脚本
└── .dockerignore                     # Docker 忽略文件
```

## 最佳实践

1. **每次修改前端代码后**，都要重新运行完整的构建流程
2. **使用 build-push.sh 脚本**，确保流程一致性
3. **检查构建日志**，确认前端资源已正确嵌入
4. **验证部署**，确保新镜像包含最新代码

## 相关文件

- `server/router/frontend/frontend.go` - Go embed 实现
- `web/package.json` - 前端构建配置（release 脚本）
- `scripts/Dockerfile` - Docker 构建配置
- `build-push.sh` - 自动化构建脚本
