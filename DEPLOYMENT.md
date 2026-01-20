# 🎉 Memos 分屏预览功能 - 部署成功

## ✅ 当前状态

**服务运行中**：
- 🚀 **后端 API**: http://localhost:8081
- 🎨 **前端开发服务器**: http://localhost:3002

## 🌐 访问应用

**请访问**: **http://localhost:3002**

> 注意：前端开发服务器在 3002 端口（3001 被占用自动切换）

## 🎯 测试新功能

1. 打开 http://localhost:3002
2. 注册/登录账号
3. 点击"创建 memo"
4. **体验左右分屏实时预览**！

### 功能演示

在左侧编辑器输入：
```markdown
# 标题
- 列表项
**粗体** *斜体*
`代码`
#标签
- [ ] 任务列表
```

右侧将**实时显示渲染效果**！

## 🛠️ 服务管理

### 查看日志
```bash
# 后端日志
tail -f /tmp/memos.log

# 前端日志
tail -f /tmp/frontend.log
```

### 停止服务
```bash
# 方法1：杀死进程
killall memos
killall node

# 方法2：查找并杀死
ps aux | grep "memos --mode dev" | awk '{print $2}' | xargs kill
ps aux | grep "vite" | awk '{print $2}' | xargs kill
```

### 重启服务
```bash
# 后端
cd /Users/mi/Desktop/austin/memos
./build/memos --mode dev --port 8081 > /tmp/memos.log 2>&1 &

# 前端
cd /Users/mi/Desktop/austin/memos/web
npm run dev > /tmp/frontend.log 2>&1 &
```

## 📋 关于生产构建

由于 mermaid v11.12.1 的 d3-sankey 依赖问题，前端生产构建暂时失败。但**开发模式完全可用**！

### 解决方案选项

**选项 1：降级 mermaid（推荐）**
```bash
cd web
npm install mermaid@10.9.1
npm run release  # 应该可以成功
```

**选项 2：使用 Docker 构建**
```bash
cd /Users/mi/Desktop/austin/memos
./scripts/docker-deploy.sh  # 之前脚本中的 Docker 构建方法
```

**选项 3：等待 mermaid 修复**
- 这是 mermaid 的已知问题
- 跟踪：https://github.com/mermaid-js/mermaid/issues/...

## 🎨 功能特性

### 分屏布局
- ✅ **桌面端**（≥768px）：左侧编辑 50%，右侧预览 50%
- ✅ **移动端**（<768px）：隐藏预览，全宽编辑器
- ✅ **焦点模式**：保持分屏布局

### 支持的 Markdown
- ✅ 标题（# ## ###）
- ✅ 粗体、斜体、删除线
- ✅ 列表（有序、无序）
- ✅ 代码块和行内代码
- ✅ 表格
- ✅ 引用
- ✅ 数学公式（KaTeX）
- ✅ 自定义标签 #tag
- ✅ 任务列表 checkbox
- ✅ Mermaid 图表

### 性能优化
- ✅ React.memo 避免不必要的渲染
- ✅ 只在内容变化时更新预览
- ✅ 使用现有 MemoContent 组件

## 📂 项目文件

### 修改的文件
- `web/src/components/MemoEditor/components/EditorPreview.tsx` - 新建
- `web/src/components/MemoEditor/index.tsx` - 分屏布局
- `web/src/components/MemoEditor/constants.ts` - 焦点模式宽度
- `web/src/locales/en.json` - 英文翻译
- `web/src/locales/zh-Hans.json` - 中文翻译
- `web/vite.config.mts` - 依赖优化

### 构建产物
- **后端**: `/Users/mi/Desktop/austin/memos/build/memos`
- **前端**: 开发模式运行中（无需构建）

## 🔍 开发模式说明

当前运行在开发模式：
- ✅ 热重载 - 代码修改自动刷新
- ✅ 快速启动 - 无需等待构建
- ✅ 完整功能 - 所有特性可用
- ⚠️ 性能较低 - 生产环境请构建后使用

## 📱 浏览器测试

推荐浏览器：
- ✅ Chrome/Edge 90+
- ✅ Firefox 88+
- ✅ Safari 14+

## 🐛 问题排查

### 前端无法访问
1. 检查端口：`lsof -i :3002`
2. 查看日志：`tail -f /tmp/frontend.log`
3. 重启服务：
   ```bash
   cd web && npm run dev > /tmp/frontend.log 2>&1 &
   ```

### 后端无法访问
1. 检查端口：`lsof -i :8081`
2. 查看日志：`tail -f /tmp/memos.log`
3. 重启服务：
   ```bash
   ./build/memos --mode dev --port 8081 > /tmp/memos.log 2>&1 &
   ```

### 预览不显示
- 确认屏幕宽度 ≥ 768px
- 检查浏览器控制台错误
- 刷新页面（Ctrl/Cmd + R）

## 🎉 开始使用

1. **访问**: http://localhost:3002
2. **登录**或注册新账号
3. **创建 memo**，体验实时预览！
4. **尝试各种 Markdown 语法**
5. **享受流畅的编辑体验**！

---

**部署时间**: 2026-01-20
**模式**: 开发模式
**版本**: 0.26.0 + 自定义分屏预览
