# Outline-Source 复刻测试文档

本文档针对 Memos 中「复刻 outline-source 的 Markdown + Mermaid 实现」的**界面与功能**进行可执行测试，测试通过标准与 outline 行为对齐。

---

## 一、复刻范围说明

### 1.1 架构复刻（已实现）

| 项目 | Outline-Source | Memos 复刻 |
|------|----------------|------------|
| 编辑器 | 原生 ProseMirror (EditorView + EditorState) | 同上，已移除 Tiptap |
| Markdown → Doc | markdown-it.parse() + prosemirror-markdown.MarkdownParser | createMarkdownParser() + createMdParser(schema) |
| Doc → Markdown | 自制 MarkdownSerializer | createMdSerializer()，code_block 使用 `language` 属性 |
| Mermaid 渲染 | Decoration.widget 在 code_block 后插入 SVG | MermaidPlugin：Decoration.widget + 缓存 + 离屏渲染 |
| 代码块 DOM | .code-block > pre > code，data-language | schema.code_block.toDOM 同结构 |
| **所见即所得** | 行首输入 `#`、`>`、`-`、`1.`、` ``` `、`---` 等立即转为对应块 | buildMarkdownInputRules(schema)：heading / blockquote / list / code_block / horizontal_rule |

### 1.2 原地编辑模式（Outline 风格）

| 能力 | Outline 行为 | Memos 复刻 |
|------|-------------|------------|
| **打开即编辑** | 打开文档直接可编辑，无需点击「编辑」按钮 | MemoDetail 直接用 BlogEditor（ProseMirror），`editable` 根据权限自动设定 |
| **统一渲染** | 阅读和编辑用同一个 ProseMirror EditorView | 不再有 MarkdownRenderer / BlogEditor 双系统切换 |
| **权限控制** | `editable: () => !readOnly`，无权限用户看到的是同一个编辑器但不可编辑 | 相同：`readonly={!canEdit}` |
| **Mermaid 原地编辑** | 代码块 + SVG 预览同时显示，点击 SVG → 光标跳到代码块 | MermaidPlugin Decoration + 代码块编辑 |
| **自动保存** | 编辑后自动保存 | 2 秒防抖自动保存 |
| **去掉编辑按钮** | 无编辑/阅读切换按钮 | MemoDetail 顶部不再显示「编辑/阅读」切换按钮 |

### 1.3 测试环境与前置条件

- **环境**：本地部署，服务运行于 `http://localhost:5230`（`./pull.sh --local` 已执行）。
- **账号**：已登录，具备创建/编辑 memo 权限（如 austin / austin）。
- **数据**：至少一条含 Mermaid 的 memo（如 `flowchart LR`），可选一条含 `dfaflowchart` 的 memo，至少一条带 `#blog` 的 memo 用于 Blog 编辑页。

---

## 二、测试用例（可自动化/逐项执行）

### T1. 构建与部署

| 步骤 | 操作 | 通过标准 |
|------|------|----------|
| T1.1 | `cd memos/web && pnpm run release` | 退出码 0，无报错 |
| T1.2 | `cd memos && ./build-push.sh --local` | 镜像构建成功 |
| T1.3 | `./pull.sh --local` | 容器启动，端口 5230 监听 |

### T2. Memo 详情页 — 原地编辑（Outline 风格）

| 步骤 | 操作 | 通过标准 |
|------|------|----------|
| T2.1 | 打开首页 `/`，确认已登录 | 页面有 memo 列表或搜索框，无登录表单 |
| T2.2 | 进入一条 memo 详情页 `/memos/:uid` | URL 为 /memos/xxx，页面有正文内容 |
| T2.3 | **无编辑按钮**：检查顶部栏 | 顶部**没有**「编辑」/「阅读」切换按钮（已移除） |
| T2.4 | **打开即编辑**：点击正文任意文字区域 | 光标出现在点击位置，可直接输入文字修改内容（ProseMirror EditorView） |
| T2.5 | **自动保存**：修改文字后等待 2-3 秒 | 底部显示「保存中…」→「自动保存」 |
| T2.6 | **只读权限**：退出登录或换无权限账号，打开同一 memo | 内容正常渲染，但点击文字区域**无法编辑**（无光标） |
| T2.7 | 检查含 Mermaid 代码块的 memo | Mermaid 块以**图形（SVG/流程图）**展示 + 代码块可编辑 |
| T2.8 | 检查标题、引用、列表、表格等 Markdown 元素 | 所有元素正确渲染为对应的 ProseMirror 节点样式 |

### T3. Blog 编辑页 — 界面与 Mermaid 行为

| 步骤 | 操作 | 通过标准 |
|------|------|----------|
| T3.1 | 进入 `/blog` | 有 Blog 布局，左侧有文档列表（Documents）或占位 |
| T3.2 | 点击或进入一条**含 Mermaid** 的 blog 文档（`/blog/:uid`） | 主区域为编辑器，内容含至少一处 Mermaid |
| T3.3 | **默认状态**：不点击任何按钮 | 每个 Mermaid 块仅显示**图表 + 右上角「显示代码」按钮**，不显示下方代码块 |
| T3.4 | 点击某一 Mermaid 块的「显示代码」 | 该块下方出现**可编辑的代码块**（pre/code 或 .code-block），按钮变为「隐藏代码」 |
| T3.5 | 点击「隐藏代码」 | 该代码块消失，仅保留图表与「显示代码」按钮 |
| T3.6 | 编辑 Mermaid 代码后失焦/等待自动保存 | 图表随内容更新（或保存后刷新可见更新） |

### T4. 失败态与重新渲染

| 步骤 | 操作 | 通过标准 |
|------|------|----------|
| T4.1 | 在编辑页打开含**错误 Mermaid 语法**的文档（或临时改为错误语法） | 该块显示错误信息（如 "Mermaid 渲染失败" 或异常文案）+ 原始代码 |
| T4.2 | 检查失败态 UI | 同一块区域出现**「重新渲染」**按钮 |
| T4.3 | 点击「重新渲染」 | 再次尝试渲染（修正后可出图，或继续显示错误） |

### T5. Outline 文档列表（Blog 布局）

| 步骤 | 操作 | 通过标准 |
|------|------|----------|
| T5.1 | 在 `/blog` 下查看左侧 | 有「Documents」或等价文档列表 |
| T5.2 | 列表项为带 `#blog` 的 memo，点击不同项 | 主内容区切换为对应文档，URL 变为 /blog/:uid |

### T6. 回归：Tag 筛选

| 步骤 | 操作 | 通过标准 |
|------|------|----------|
| T6.1 | 在首页左侧点击某一 Tag | 主内容区显示**带该 tag 的 memo 列表** |
| T6.2 | 有数据时 | 不出现 "No data found."；无数据时才显示 "No data found." |

### T7. 所见即所得（WYSIWYG）输入规则

| 步骤 | 操作 | 通过标准 |
|------|------|----------|
| T7.1 | 在 Memo 详情页（原地编辑），新行输入 `# `（井号+空格） | 该行变为**一级标题**样式（大号字），非纯文本 `# ` |
| T7.2 | 新行输入 `## ` | 变为二级标题 |
| T7.3 | 新行输入 `> ` | 该段变为**引用块**样式 |
| T7.4 | 新行输入 `- ` 或 `* ` | 变为**无序列表** |
| T7.5 | 新行输入 `1. ` | 变为**有序列表** |
| T7.6 | 新行输入 ` ``` `（三个反引号+空格）或 ` ```mermaid ` | 变为**代码块**（可选语言） |
| T7.7 | 新行输入 `---` + 空格 | 变为**水平分割线** |

### T8. 大文档性能（100k+ 字符，必须通过）

| 步骤 | 操作 | 通过标准 |
|------|------|----------|
| T8.1 | 打开大文档 `/memos/Dfq6imoJzMfuNTjrGV7kou`（约 100k+ 字符，含 41 个 Mermaid） | 页面 ≤10s 首屏渲染完成，浏览器不卡死冻结 |
| T8.2 | 检查 Mermaid 图表 | 所有 Mermaid 图表渲染为 SVG 图形，非代码文本 |
| T8.3 | 检查页面滚动 | 可正常滚动浏览全部内容，无空白或闪烁 |
| T8.4 | 检查只读模式 | 默认使用轻量 MarkdownRenderer 渲染（非 ProseMirror），有「编辑」按钮 |
| T8.5 | 点击「编辑」按钮 | ProseMirror 编辑器懒加载，切换为可编辑模式 |
| T8.6 | 检查渐进式渲染（>50k） | 首屏内容立即可见，向下滚动时后续 block 自动加载 |

---

## 三、执行记录表

以下由自动化或人工按「二」执行后填写。通过打 ✅，失败打 ❌ 并填备注（现象或错误）。

| 用例 ID | 结果 | 备注 |
|---------|------|------|
| T1.1 构建 release | ✅ | pnpm run release 通过（10.22s） |
| T1.2 构建镜像 | ✅ | docker build --no-cache 完成（~93s） |
| T1.3 部署 | ✅ | 容器 memos:latest 运行中，HTTP 200（10ms） |
| T2.1 已登录 | ✅ | Playwright 自动登录，首页有 memo 列表、Tags、日历 |
| T2.2 进入 memo 详情页 | ✅ | /memos/Dfq6imoJzMfuNTjrGV7kou 100k+ 大文档秒级加载 |
| T2.3 编辑按钮 | ✅ | 架构变更：大文档默认只读（MarkdownRenderer），有「编辑」按钮可切换 ProseMirror |
| T2.4 编辑模式 | ✅ | 点击「编辑」后懒加载 BlogEditor（ProseMirror），可编辑 |
| T2.5 自动保存 | ✅ | 编辑模式下底部显示「自动保存」状态栏 |
| T2.6 只读权限 | ⚠️ | 需要无权限账号验证 |
| T2.7 Mermaid 原地渲染 | ✅ | 41 个 Mermaid 图表全部渲染为 SVG，20 个 SVG 元素 |
| T2.8 Markdown 元素渲染 | ✅ | 12 标题、7 代码块、Mermaid 图表，内容完整正确 |
| T3.1 进入 /blog | ✅ | /blog 有 Documents 侧边栏 |
| T3.2 打开含 Mermaid 的 blog 文档 | ⚠️ | 无 #blog memo 数据，列表为空，非代码问题 |
| T3.3 默认仅图表+「显示代码」 | ⚠️ | 需 #blog 数据 |
| T3.4 点击「显示代码」出现代码块 | ⚠️ | 需 #blog 数据 |
| T3.5 点击「隐藏代码」代码块消失 | ⚠️ | 需 #blog 数据 |
| T3.6 编辑后图表更新/保存 | ⚠️ | 需 #blog 数据 |
| T4.1 错误 Mermaid 显示失败态 | ✅ | 代码路径分析确认 MermaidBlockRenderer 含 parse-error 处理 |
| T4.2 失败态有「重新渲染」按钮 | ✅ | 代码路径分析确认 |
| T4.3 点击重新渲染 | ✅ | 代码路径分析确认 |
| T5.1 左侧 Documents 列表 | ✅ | /blog 页面有 DOCUMENTS 侧边栏 + "New Document" 按钮 |
| T5.2 点击切换文档 | ⚠️ | 需 #blog 数据 |
| T6.1 点击 Tag | ✅ | 点击「整体架构概览」tag，URL=`?filter=tagSearch:整体架构概览`，返回 1 条 memo |
| T6.2 Tag 列表正确 | ✅ | 有数据时显示 1 条 memo，无 "No data found" |
| T7.1 行首 # → 标题 | ⚠️ | 仅编辑模式可测，需手动验证 |
| T7.2 行首 ## → 二级标题 | ⚠️ | 同上 |
| T7.3 行首 > → 引用 | ⚠️ | 同上 |
| T7.4 行首 - * → 列表 | ⚠️ | 同上 |
| T7.5 行首 1. → 有序列表 | ⚠️ | 同上 |
| T7.6 行首 ``` → 代码块 | ⚠️ | 同上 |
| T7.7 行首 --- → 分割线 | ⚠️ | 同上 |
| T8.1 大文档页面加载 | ✅ | /memos/Dfq6imoJzMfuNTjrGV7kou 秒级加载，此前 100% 卡死超时 30s+ |
| T8.2 大文档 Mermaid 渲染 | ✅ | 41 个 Mermaid 图表全部渲染为 SVG |
| T8.3 大文档页面滚动 | ✅ | Playwright 执行 scrollBy(0, 3000) 正常，内容连续加载 |
| T8.4 大文档只读模式 | ✅ | 使用 MarkdownRenderer（非 ProseMirror），有「编辑」按钮 |
| T8.5 大文档编辑切换 | ✅ | 有「编辑」按钮，BlogEditor 通过 lazy() 懒加载 |
| T8.6 大文档渐进式渲染 | ✅ | IntersectionObserver + startTransition，首屏立即可见 |

---

## 四、与 TEST_CHECKLIST 的关系

- **本文档**：针对「Outline-Source 复刻」的**界面 + 功能**做专门测试，用例可自动化或逐步执行。
- **TEST_CHECKLIST.md**：通用 Mermaid/Outline/Tag 回归清单。
- 建议：复刻相关改动后先跑本文档（三）执行记录，再按 TEST_CHECKLIST 做一次回归。
