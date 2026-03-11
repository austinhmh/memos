# Blog 文档权限与侧边栏修复 - 实现与测试计划

## 一、问题分析

### 问题 1：文档缺少权限控制
- `BlogDetail` 页面没有 visibility 选择器，无法切换 PUBLIC / PROTECTED / PRIVATE
- 新建文档默认 `PRIVATE`，但用户无法修改
- 缺少安全保护：非所有者不应能修改 visibility

### 问题 2：侧边栏文档名称不正确
- `BlogExplorer` 侧边栏从 `memo.content` 第一行提取标题，但：
  - 编辑后侧边栏标题不会实时更新
  - 没有显示权限图标（Private/Public/Protected）
  - 列表没有筛选当前用户的私有文档 vs 他人的公开文档

### 问题 3：BlogHome 列表缺少权限状态
- 文档卡片没有显示 visibility 状态
- 无法直观区分哪些是私有/公开

## 二、实现方案

### 2.1 BlogDetail 页面改造

**文件**: `web/src/pages/BlogDetail.tsx`

改动内容：
1. 添加顶部工具栏：显示文档标题 + 权限选择器
2. 权限选择器复用已有的 `VisibilityIcon` + 下拉菜单
3. 只有文档所有者或超级用户才能看到/使用权限选择器
4. 通过 `useUpdateMemo` 调用 `MemoService/UpdateMemo` API（update_mask 包含 "visibility"）
5. 非所有者只显示权限图标（只读）
6. 编辑器内容变更后通过 `onSave` 回调保存并 `invalidateQueries` 刷新侧边栏

**安全要点**：
- 前端：非所有者隐藏权限修改 UI
- 后端：`UpdateMemo` 已有 `memo.CreatorID != user.ID && !isSuperUser(user)` 检查
- 后端：`GetMemo` 已有 PRIVATE 文档仅 creator 可见的检查
- 后端：`ListMemos` 对非登录用户只返回 PUBLIC 文档

### 2.2 BlogExplorer 侧边栏改造

**文件**: `web/src/components/BlogExplorer.tsx`

改动内容：
1. 每个文档条目旁添加 `VisibilityIcon`
2. 标题提取逻辑优化：使用 `snippet` 字段或从 content 第一行提取
3. 当 BlogDetail 编辑保存后，侧边栏数据自动刷新（已有 `invalidateQueries` 机制）
4. 显示标题截断时使用 tooltip

### 2.3 BlogHome 页面改造

**文件**: `web/src/pages/BlogHome.tsx`

改动内容：
1. 每个文档卡片添加 `VisibilityIcon` 徽标
2. 显示权限标签文字（私有/受保护/公开）

### 2.4 编辑器内容保存与侧边栏同步

**文件**: `web/src/pages/BlogDetail.tsx`

改动内容：
1. `OutlineEditorWrapper` 的 `onChange` 回调设置 debounce 自动保存
2. 保存成功后调用 `queryClient.invalidateQueries` 刷新 memo 列表
3. 侧边栏自动获取最新数据，标题随之更新

## 三、测试计划

### 测试前置条件
- 应用已启动，可通过浏览器访问 (通常 http://localhost:5230)
- 已有一个登录用户（所有者/管理员）
- 至少有一个带 `#blog` 标签的文档

### 测试用例

#### TC-01: 新建文档默认权限为 PRIVATE
1. 进入 `/blog` 页面
2. 点击 `+ New Document` 按钮
3. **预期**: 跳转到新文档编辑页，权限图标显示锁（🔒 PRIVATE）
4. 侧边栏出现新文档 "Untitled"，旁边有锁图标

#### TC-02: 修改文档权限为 PUBLIC
1. 在文档编辑页，点击权限下拉菜单
2. 选择 "公开 (PUBLIC)"
3. **预期**: 权限图标变为地球（🌐），API 调用成功
4. 刷新页面，权限仍然是 PUBLIC
5. 侧边栏的权限图标也随之更新

#### TC-03: 修改文档权限为 PROTECTED
1. 在文档编辑页，点击权限下拉菜单
2. 选择 "受保护 (PROTECTED)"
3. **预期**: 权限图标变为用户组（👥），API 调用成功
4. 刷新页面，权限仍然是 PROTECTED

#### TC-04: 非所有者不能修改权限
1. 使用另一个用户账号登录
2. 访问其他用户的 PUBLIC 或 PROTECTED 文档
3. **预期**: 编辑器为只读模式，不显示权限选择器
4. 只显示当前权限图标（只读）

#### TC-05: 未登录用户访问 PRIVATE 文档
1. 注销登录
2. 直接访问一个 PRIVATE 文档的 URL
3. **预期**: 返回 403 或重定向到登录页

#### TC-06: 未登录用户访问 PUBLIC 文档
1. 注销登录
2. 直接访问一个 PUBLIC 文档的 URL
3. **预期**: 可以查看文档内容（只读模式），无权限选择器

#### TC-07: 侧边栏显示正确的文档标题
1. 进入 `/blog` 页面
2. 检查侧边栏文档列表
3. **预期**: 每个文档显示其标题（第一行 `# 标题` 内容），而不是 "Untitled"
4. 已编辑过的文档显示最新标题

#### TC-08: 编辑文档标题后侧边栏实时更新
1. 打开一个文档
2. 修改第一行标题
3. 保存（触发自动保存或 Ctrl+S）
4. **预期**: 侧边栏对应的文档名称更新为新标题

#### TC-09: 侧边栏显示权限图标
1. 进入 `/blog` 页面
2. 检查侧边栏文档列表
3. **预期**: 每个文档旁边有对应的权限图标（锁/用户组/地球）

#### TC-10: BlogHome 列表显示权限状态
1. 进入 `/blog` 页面（主内容区）
2. 检查文档卡片
3. **预期**: 每个卡片显示权限标签/图标

#### TC-11: 权限修改 API 安全性
1. 打开浏览器开发者工具 Network 标签
2. 修改权限
3. **预期**: API 请求使用正确的 `UpdateMemo` 调用，update_mask 包含 "visibility"
4. 响应状态正常

#### TC-12: 刷新后权限持久化
1. 修改文档权限为 PUBLIC
2. 刷新页面 (F5)
3. **预期**: 权限仍然是 PUBLIC，不会重置

## 四、文件修改清单

| 文件 | 修改类型 | 说明 |
|------|---------|------|
| `web/src/pages/BlogDetail.tsx` | 修改 | 添加权限选择器、自动保存、标题显示 |
| `web/src/components/BlogExplorer.tsx` | 修改 | 添加权限图标、优化标题提取 |
| `web/src/pages/BlogHome.tsx` | 修改 | 添加权限图标/标签 |
| `docs/BLOG_PERMISSION_PLAN.md` | 新建 | 本计划文档 |

## 五、依赖的已有组件（无需修改）

- `VisibilityIcon.tsx` — 权限图标组件
- `VisibilitySelector.tsx` — 权限选择器下拉菜单
- `useMemoQueries.ts` — memo CRUD hooks
- `connect.ts` — API 客户端（已有 auth interceptor）
- 后端 `memo_service.go` — 已有完整的权限检查逻辑
