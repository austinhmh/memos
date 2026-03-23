# Telegram 紧凑风格书签卡片

## 概述

将 BookmarkPlugin 的卡片渲染从当前简陋样式升级为 Telegram 紧凑风格：左侧蓝色竖线 + 浅蓝背景，站名大写在顶部，标题+描述紧凑排列，右侧小缩略图。同时统一 fallback、骨架屏和输入框的样式。

## 视觉规格

```
┌─────────────────────────────────────────────┐
│▎ GITHUB.COM              ┌──────────┐      │
│▎ GitHub: Let's build...  │  60x60   │      │
│▎ GitHub is where over... │  thumb   │      │
│▎                         └──────────┘      │
└─────────────────────────────────────────────┘
  ↑ 3px 蓝色竖线    ↑ 左侧文字区    ↑ 右侧缩略图
```

| 元素 | 规格 |
|------|------|
| 左边框 | 3px `var(--primary)` 竖线 |
| 背景 | `color-mix(in srgb, var(--primary) 5%, transparent)`，hover 时 10% |
| 圆角 | 左 0，右 8px |
| 站名 | 11px 大写加粗，`var(--primary)` 色 |
| 标题 | 14px 500 weight，1 行 `text-overflow: ellipsis` 截断 |
| 描述 | 12px muted 色，2 行 `-webkit-line-clamp` 截断 |
| 缩略图 | 60x60 圆角 6px，`object-cover`（无图时隐藏） |

## 涉及文件（共 2 个）

### 1. `web/src/components/BlogEditor/plugins/BookmarkPlugin.ts`

修改 `BookmarkNodeView` 类的三个渲染方法：

**`renderCardWithData(url, data)`** — 重写为 Telegram 风格：
- 外层容器 class 改为 `bookmark-card bookmark-card-telegram`
- `<a>` 链接层 class 改为 `bookmark-tg-link`
- 左侧文字区 `bookmark-tg-body` 内含：
  - 站名行 `bookmark-tg-site`：`extractDomain(url).toUpperCase()`
  - 标题行 `bookmark-tg-title`：`data.title`（1 行截断）
  - 描述行 `bookmark-tg-desc`：`data.description`（2 行截断）
- 右侧缩略图 `bookmark-tg-thumb`（仅 `data.image` 存在时渲染）

**`renderFallbackCard(url)`** — 同样 Telegram 容器但内容简化：
- 站名行：域名大写
- 标题行：显示完整 URL（monospace 字体，蓝色，class `bookmark-tg-url`）
- 无描述、无缩略图

**`renderSkeletonCard()`** — Telegram 风格骨架屏：
- 同样左蓝线 + 浅蓝背景容器
- 3 行 shimmer 动画条（站名宽 30% + 标题宽 70% + 描述宽 50%）
- 右侧 60x60 shimmer 方块

### 2. `web/src/index.css`

**新增样式：**

```css
/* Telegram 风格容器 */
.bookmark-card-telegram { ... }
.bookmark-card-telegram:hover { ... }
.bookmark-tg-link { ... }
.bookmark-tg-link::after { content: none !important; }
.bookmark-tg-body { ... }
.bookmark-tg-site { ... }
.bookmark-tg-title { ... }
.bookmark-tg-desc { ... }
.bookmark-tg-thumb { ... }
.bookmark-tg-thumb img { ... }
.bookmark-tg-url { ... }
.bookmark-tg-skel { ... }
:root.has-bg-image .bookmark-card-telegram { ... }
```

**删除旧样式（不再使用）：**
- `.bookmark-card-link` 及其 hover/::after 规则
- `.bookmark-card-body`
- `.bookmark-card-title` 及其 hover 规则
- `.bookmark-card-description`
- `.bookmark-card-meta`
- `.bookmark-card-favicon`
- `.bookmark-card-domain`
- `.bookmark-card-image` 及其 `@media` 查询
- `.bookmark-card-loading` 的旧骨架屏子样式
- `.bookmark-card-fallback`
- `.bookmark-fallback-link` 及其 hover/::after 规则
- `.bookmark-fallback-icon`
- `.bookmark-fallback-text`
- `:root.has-bg-image` 中对旧 class 的引用

## 不涉及的文件（无需改动）

- `BookmarkCard.tsx` — 只读渲染器单独维护
- `markdownParser.ts / markdownSerializer.ts / schema.ts` — 数据层不变
- `slashMenuItems.ts / index.tsx` — 交互层不变

## TODO

- [ ] 重写 BookmarkPlugin.ts 的 renderCardWithData / renderFallbackCard / renderSkeletonCard
- [ ] 替换 index.css 中旧 .bookmark-card-* 样式为 Telegram 新样式
- [ ] 删除 index.css 中不再使用的旧 bookmark 样式
