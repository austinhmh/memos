# Outline 编辑器替换到 Memos：代码级详细计划（v3 — Outline 零改动版）

> **核心原则：Outline 代码零改动，所有适配在外部完成。**
> Outline 的 `shared/editor/` 和 `app/editor/` 作为 vendor 模块原封不动放入项目，
> 通过 Vite alias + npm 依赖 + 垫片文件满足其全部外部依赖。

## 一、依赖面全景（扫描结果）

Outline 编辑器向外部伸出的依赖触手共 **82 条**：

| 类别 | 数量 | 策略 |
|------|------|------|
| npm 包（mobx, styled-components, lodash, polished 等） | 14 | **直接安装**（与 Outline 相同版本） |
| `@shared/` 非 editor 路径（utils, components, types 等） | 22 | **从 Outline 复制原始文件** 或创建垫片 |
| `~/` 非 editor 路径（hooks, components, models, stores 等） | 46 | **创建垫片文件**，通过 Vite alias 映射 |

## 二、总体架构

```
memos/web/src/
├── outline-vendor/                    ← Outline 原始代码，零改动
│   ├── shared/editor/                 ← 从 outline-source/shared/editor/ 原样复制
│   └── app/editor/                    ← 从 outline-source/app/editor/ 原样复制
│
├── outline-shims/                     ← 所有垫片文件（满足 Outline 的外部依赖）
│   ├── shared/                        ← 满足 @shared/* 非 editor 导入
│   │   ├── types.ts
│   │   ├── styles.ts
│   │   ├── validations.ts
│   │   ├── utils/                     ← ProsemirrorHelper, color, urls, keyboard...
│   │   ├── components/                ← Icon, Flex, Text, ColorPicker...
│   │   └── hooks/
│   └── app/                           ← 满足 ~/* 非 editor 导入
│       ├── hooks/                     ← useDictionary, useStores, useMobile...
│       ├── components/                ← Flex, Portal, Tooltip, Button, Input...
│       ├── models/                    ← Document, Integration (type-only)
│       ├── stores.ts
│       ├── env.ts
│       ├── types.ts
│       └── utils/                     ← Logger, Desktop, ApiClient, mention
│
├── components/
│   └── OutlineEditor/                 ← 适配层（桥接 Memos 数据层 ↔ Outline Editor）
│       └── index.tsx
│
├── lib/markdown/                      ← 保留！只读渲染继续用 MarkdownRenderer
└── components/MemoContent/            ← 保留！只读展示不变
```

## 三、Vite alias 配置（核心）

这是零改动方案的关键——用 Vite alias 把 Outline 的所有导入路径映射到正确位置：

```typescript
// vite.config.mts
import { resolve } from "path";

export default defineConfig({
  // ...existing config...
  resolve: {
    alias: {
      // Memos 自身的 alias（保持不变）
      "@/": `${resolve(__dirname, "src")}/`,

      // ========== Outline 编辑器的 alias ==========

      // Outline 的 @shared/editor/ → vendor 目录
      "@shared/editor/": `${resolve(__dirname, "src/outline-vendor/shared/editor")}/`,
      // Outline 的 @shared/* (非 editor) → 垫片目录
      "@shared/": `${resolve(__dirname, "src/outline-shims/shared")}/`,

      // Outline 的 ~/editor → vendor 目录
      "~/editor": `${resolve(__dirname, "src/outline-vendor/app/editor")}/`,
      // Outline 的 ~/* (非 editor) → 垫片目录
      "~/": `${resolve(__dirname, "src/outline-shims/app")}/`,
    },
  },
});
```

**alias 顺序至关重要**：更具体的路径必须排在前面（`@shared/editor/` 在 `@shared/` 之前，`~/editor` 在 `~/` 之前），Vite 按照先匹配原则处理。

## 四、npm 依赖安装（14 个包，与 Outline 版本一致）

```diff
"dependencies": {
  // ===== Outline 编辑器需要的包（与 Outline 版本一致，零改动） =====
+ "mobx": "^4.15.4",                    // Outline 用 v4（非 v6！）
+ "mobx-react": "^6.3.1",               // 对应 v4 的 mobx-react
+ "styled-components": "^5.3.11",       // Outline 用 v5
+ "polished": "^4.3.0",
+ "lodash": "^4.17.21",                 // Outline 用 CJS lodash（不是 lodash-es）
+ "outline-icons": "^1.0.0",            // 需要确认 Outline 项目中的确切版本
+ "sonner": "^1.5.0",                   // Outline 用的 toast 库
+ "prosemirror-changeset": "2.3.1",
+ "prosemirror-codemark": "^0.4.2",
+ "prosemirror-schema-list": "^1.5.1",
+ "prosemirror-tables": "^1.8.1",
+ "prosemirror-transform": "1.10.0",
+ "@benrbray/prosemirror-math": "^0.2.2",
+ "utility-types": "^3.11.0",
+ "react-merge-refs": "^3.0.0",
+ "copy-to-clipboard": "^3.3.3",        // Outline 和 Memos 都用，应该已安装
}
```

**关于 MobX v4**：既然原则是零改动，就必须安装 Outline 实际使用的 MobX v4（支持 legacy decorators）。
MobX v4 + React 18 **可以共存**，但需要在 `tsconfig.json` 中启用 `experimentalDecorators`。

**关于 lodash vs lodash-es**：Outline 用 `lodash`（CJS），Memos 已有 `lodash-es`（ESM）。
两者会共存于 bundle 中，增加约 25KB gzip。这是零改动原则下的必要代价。

## 五、tsconfig.json 变更

```diff
{
  "compilerOptions": {
+   "experimentalDecorators": true,     // Outline 的 NodeViewRenderer 用 @observable 等装饰器
+   "skipLibCheck": true,               // 避免 MobX v4 / styled-components v5 的类型冲突
    "paths": {
      "@/*": ["./src/*"],
+     "@shared/editor/*": ["./src/outline-vendor/shared/editor/*"],
+     "@shared/*": ["./src/outline-shims/shared/*"],
+     "~/editor/*": ["./src/outline-vendor/app/editor/*"],
+     "~/editor": ["./src/outline-vendor/app/editor"],
+     "~/*": ["./src/outline-shims/app/*"]
    }
  }
}
```

## 六、垫片文件清单（68 个路径 → 约 40 个文件）

### 6.1 `@shared/` 垫片 — 从 Outline 复制原始文件（推荐）

这些文件是 Outline `shared/` 下的工具函数/组件，**大部分没有外部依赖**，可以直接从 `outline-source/shared/` 复制：

| # | 路径 | 策略 | 说明 |
|---|------|------|------|
| 1 | `@shared/utils/ProsemirrorHelper` | **复制原文件** | 纯 ProseMirror 工具函数 |
| 2 | `@shared/utils/color` | **复制原文件** | 颜色工具（presetColors, rgbaToHex, hexToRgba） |
| 3 | `@shared/utils/rfc6902` | **复制原文件** | JSON Patch 工具 |
| 4 | `@shared/utils/urls` | **复制原文件** | URL 工具（sanitizeUrl, isInternalUrl, isDocumentUrl 等） |
| 5 | `@shared/utils/browser` | **复制原文件** | 浏览器检测（isNode, isBrowser, getSafeAreaInsets） |
| 6 | `@shared/utils/keyboard` | **复制原文件** | 键盘工具（metaDisplay, altDisplay, isModKey） |
| 7 | `@shared/utils/events` | **复制原文件** | EventEmitter |
| 8 | `@shared/utils/icon` | **复制原文件** | determineIconType |
| 9 | `@shared/utils/parseCollectionSlug` | **复制原文件** | URL slug 解析 |
| 10 | `@shared/utils/parseDocumentSlug` | **复制原文件** | URL slug 解析 |
| 11 | `@shared/utils/time` | **复制原文件** | Second 常量 |
| 12 | `@shared/utils/files` | **复制原文件** | getEventFiles |
| 13 | `@shared/utils/emoji` | **复制原文件** | emoji search |
| 14 | `@shared/types` | **复制原文件** | ProsemirrorData, UserPreferences, MentionType, IconType |
| 15 | `@shared/styles` | **复制原文件** | s(), depths, hideScrollbars, extraArea, hover, breakpoints |
| 16 | `@shared/validations` | **复制原文件** | AttachmentValidation |
| 17 | `@shared/components/EventBoundary` | **复制原文件** | 事件隔离组件 |
| 18 | `@shared/components/Icon` | **复制原文件** | 通用 Icon 组件 |
| 19 | `@shared/components/Flex` | **复制原文件** | Flex 布局组件 |
| 20 | `@shared/components/Text` | **复制原文件** | 文本组件 |
| 21 | `@shared/components/ColorPicker` | **复制原文件** | 颜色选择器 |
| 22 | `@shared/components/CustomEmoji` | **复制原文件** | 自定义 Emoji |
| 23 | `@shared/hooks/useShare` | **创建垫片** | `export default () => ({ shareId: undefined })` |

**注意**：这些复制的文件可能有自己的外部依赖（如 `@shared/styles` 可能依赖 `styled-components`，`@shared/components/Icon` 可能依赖 `outline-icons`）。这些通过 npm 安装解决。

### 6.2 `~/` 垫片 — 需要创建的适配文件（46 路径 → 约 35 个文件）

#### Hooks（10 个）

```typescript
// outline-shims/app/hooks/useDictionary.ts
import { useTranslation } from "react-i18next";
export type Dictionary = Record<string, any>;
export default function useDictionary(): Dictionary {
  const { t } = useTranslation();
  return new Proxy({}, {
    get: (_, key: string) => {
      if (key === "uploadingWithProgress") return (p: number) => `上传中… ${p}%`;
      return t(`editor.${key}`, String(key));
    }
  });
}
```

```typescript
// outline-shims/app/hooks/useMobile.ts
import { useState, useEffect } from "react";
export default function useMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}
```

```typescript
// outline-shims/app/hooks/useBoolean.ts
import { useState, useCallback } from "react";
export default function useBoolean(initial = false) {
  const [value, setValue] = useState(initial);
  return [value, useCallback(() => setValue(true), []),
    useCallback(() => setValue(false), []),
    useCallback(() => setValue(v => !v), [])] as const;
}
```

```typescript
// outline-shims/app/hooks/useEventListener.ts
import { useEffect, useRef } from "react";
export default function useEventListener(
  eventName: string, handler: (e: any) => void, target: any = window
) {
  const savedHandler = useRef(handler);
  savedHandler.current = handler;
  useEffect(() => {
    const listener = (e: any) => savedHandler.current(e);
    target?.addEventListener?.(eventName, listener);
    return () => target?.removeEventListener?.(eventName, listener);
  }, [eventName, target]);
}
```

```typescript
// outline-shims/app/hooks/useStores.ts
// 最小化 store 垫片 — 只需要满足编辑器 UI 组件的接口
const emptyStore = {
  orderedData: [],
  get: () => undefined,
  fetch: () => Promise.resolve(undefined),
  searchTitles: () => [],
  prefetchDocument: () => Promise.resolve(),
  getByUrl: () => undefined,
};
const stores = {
  auth: { user: null, team: null },
  documents: { ...emptyStore },
  users: { ...emptyStore },
  collections: { ...emptyStore },
  groups: { ...emptyStore },
  emojis: { orderedData: [], addCustomEmoji() {}, removeCustomEmoji() {} },
  integrations: { ...emptyStore },
  comments: { orderedData: [] },
  unfurls: { ...emptyStore, fetchUnfurl: () => Promise.resolve(undefined) },
};
export default function useStores() { return stores; }
```

```typescript
// outline-shims/app/hooks/useCurrentUser.ts
export default function useCurrentUser(opts?: any) { return null; }
```

```typescript
// outline-shims/app/hooks/useRequest.ts
import { useCallback, useState } from "react";
export default function useRequest(fn: (...args: any[]) => Promise<any>) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const request = useCallback(async (...args: any[]) => {
    setLoading(true); setError(null);
    try { return await fn(...args); }
    catch (e: any) { setError(e); throw e; }
    finally { setLoading(false); }
  }, [fn]);
  return { request, loading, error };
}
```

```typescript
// outline-shims/app/hooks/useOnClickOutside.ts
import { useEffect, useRef } from "react";
export default function useOnClickOutside(
  ref: React.RefObject<HTMLElement>, handler: (e: MouseEvent) => void
) {
  const savedHandler = useRef(handler);
  savedHandler.current = handler;
  useEffect(() => {
    const listener = (e: MouseEvent) => {
      if (!ref.current || ref.current.contains(e.target as Node)) return;
      savedHandler.current(e);
    };
    document.addEventListener("mousedown", listener);
    return () => document.removeEventListener("mousedown", listener);
  }, [ref]);
}
```

```typescript
// outline-shims/app/hooks/useKeyDown.ts
import { useEffect } from "react";
export default function useKeyDown(key: string, handler: (e: KeyboardEvent) => void) {
  useEffect(() => {
    const listener = (e: KeyboardEvent) => { if (e.key === key) handler(e); };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [key, handler]);
}
```

```typescript
// outline-shims/app/hooks/useWindowSize.ts
import { useState, useEffect } from "react";
export default function useWindowSize() {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const handler = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return size;
}
```

#### Components（约 20 个文件）

```typescript
// outline-shims/app/components/Flex/index.tsx
import * as React from "react";
const Flex = React.forwardRef<HTMLDivElement, any>(
  ({ align, justify, column, gap, auto, shrink, style, ...props }, ref) => (
    <div ref={ref} style={{
      display: "flex", alignItems: align, justifyContent: justify,
      flexDirection: column ? "column" : "row", gap, ...style
    }} {...props} />
  )
);
export default Flex;
```

```typescript
// outline-shims/app/components/Portal/index.tsx
import { createContext, useContext } from "react";
import { createPortal } from "react-dom";
export const PortalContext = createContext<HTMLElement | null>(null);
export const usePortalContext = () => useContext(PortalContext);
export const Portal = ({ children }: { children: React.ReactNode }) =>
  createPortal(children, document.body);
```

```typescript
// outline-shims/app/components/Tooltip.tsx
import * as React from "react";
export type Props = { content?: string; children: React.ReactNode; [k: string]: any };
const Tooltip = React.forwardRef<any, Props>(({ content, children, ...rest }, ref) => (
  <span ref={ref} title={content} {...rest}>{children}</span>
));
export default Tooltip;
```

```typescript
// outline-shims/app/components/TooltipContext.tsx
import * as React from "react";
export const TooltipProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
```

| # | 文件路径 | 导出 |
|---|----------|------|
| 1 | `components/Flex/index.tsx` | `default Flex` |
| 2 | `components/Portal/index.tsx` | `Portal, PortalContext, usePortalContext` |
| 3 | `components/Tooltip.tsx` | `default Tooltip, type Props` |
| 4 | `components/TooltipContext.tsx` | `TooltipProvider` |
| 5 | `components/Lightbox.tsx` | `default` — 空组件返回 null |
| 6 | `components/HoverPreview.tsx` | `default` — 空组件返回 null |
| 7 | `components/Scrollable.tsx` | `default` — 简单 `overflow-auto` div |
| 8 | `components/Button.tsx` | `default` — 简单 button 包装 |
| 9 | `components/NudeButton.tsx` | `default` — 无样式 button |
| 10 | `components/Input/index.tsx` | `default, NativeInput, Outline` — 简单 input |
| 11 | `components/Header.tsx` | `export const HEADER_HEIGHT = 64` |
| 12 | `components/Avatar/index.tsx` | `Avatar, AvatarSize, GroupAvatar` — 简单头像 |
| 13 | `components/DocumentBreadcrumb.tsx` | `default` — 空组件 |
| 14 | `components/Emoji.tsx` | `Emoji` — span 包装 |
| 15 | `components/ResizingHeightContainer.tsx` | `ResizingHeightContainer` — 直通 div |
| 16 | `components/Icons/ArrowIcon.tsx` | `ArrowDownIcon, ArrowUpIcon, ArrowLeftIcon, ArrowRightIcon` — SVG |
| 17 | `components/Icons/CircleIcon.tsx` | `default CircleIcon` — SVG |
| 18 | `components/Icons/DottedCircleIcon.tsx` | `DottedCircleIcon` — SVG |
| 19 | `components/Menu/transformer.ts` | `toMenuItems` — 直通函数 |
| 20 | `components/primitives/Menu.tsx` | `MenuContent, MenuProvider, Menu, MenuTrigger` — 空壳 |
| 21 | `components/primitives/Menu/MenuContext.tsx` | `MenuProvider` — 空壳 |
| 22 | `components/primitives/components/Menu.tsx` | `MenuItem, MenuHeader` — 空壳 |
| 23 | `components/primitives/Drawer.tsx` | 抽屉组件 — 空壳 |
| 24 | `components/primitives/Popover.tsx` | Popover — 空壳 |
| 25 | `components/primitives/HStack.tsx` | `HStack` — flex-row div |

#### Utils / Models / Other（约 10 个文件）

| # | 文件路径 | 说明 |
|---|----------|------|
| 1 | `utils/Desktop.ts` | `export default { isDesktop: false, bridge: {} }` |
| 2 | `utils/Logger.ts` | `export default { debug: console.debug, warn: console.warn, error: console.error }` |
| 3 | `utils/ApiClient.ts` | `export const client = { post: () => Promise.resolve({}) }` |
| 4 | `utils/mention.ts` | `export function determineMentionType() {} export function isURLMentionable() { return false; }` |
| 5 | `models/Document.ts` | `type Document = { id: string; title: string; url: string }; export default Document;` |
| 6 | `models/Integration.ts` | `type Integration = { id: string }; export default Integration;` |
| 7 | `stores.ts` | 与 `hooks/useStores.ts` 共享同一个 stores 对象（`export default stores`） |
| 8 | `env.ts` | `export default { URL: window.location.origin }` |
| 9 | `types.ts` | `export type Properties<T> = Partial<T>; export type MenuItem = any;` |
| 10 | `actions/sections.ts` | 空导出 |

## 七、主题桥接

```typescript
// outline-shims/app/components/WithTheme.tsx 的上游依赖
// 需要确保 styled-components 的 ThemeProvider 包裹在编辑器外层

// 在 OutlineEditorWrapper 中：
import { ThemeProvider } from "styled-components";
import { createEditorTheme } from "@/outline-shims/theme";

<ThemeProvider theme={createEditorTheme(isDark)}>
  <LazyEditor ... />
</ThemeProvider>
```

`createEditorTheme()` 需要提供 **50+ 个主题属性**（完整实现见 v2 计划第 5.4 节，此处省略不重复）。

## 八、适配组件

### 8.1 `OutlineEditorWrapper`

文件: `memos/web/src/components/OutlineEditor/index.tsx`

与 v2 计划基本相同（见 v2 第八节），关键变化是 import 路径：

```typescript
// 从 vendor 目录导入 Outline 编辑器
const LazyEditor = lazy(() => import("@/outline-vendor/app/editor"));

// richExtensions 也从 vendor 目录
import { richExtensions } from "@/outline-vendor/shared/editor/nodes";
import { withUIExtensions } from "@/outline-vendor/app/editor/extensions";
```

### 8.2 只读渲染 — 保留 MemoContent + MarkdownRenderer

不变，与 v2 计划一致。

## 九、页面替换

与 v2 计划一致：
- `MemoDetail.tsx` — BlogEditor → OutlineEditorWrapper，MarkdownRenderer 缓存层保留
- `BlogDetail.tsx` — BlogEditor → OutlineEditorWrapper
- `MemoView.tsx` — MemoEditor → OutlineEditorWrapper
- `MemoBody.tsx` — 不改（MemoContent + MarkdownRenderer 保留）

## 十、需要删除的旧模块

**只删除编辑器模块：**
```
src/components/MemoEditor/          ← textarea 编辑器
src/components/BlogEditor/          ← 简易 ProseMirror 编辑器
```

**保留：**
```
src/components/MemoContent/         ← 只读渲染
src/lib/markdown/                   ← parser + MarkdownRenderer
```

## 十一、风险评估

| # | 风险 | 级别 | 说明 |
|---|------|------|------|
| 1 | **MobX v4 + React 18** — `observable.set` 等 API 在 React 18 并发模式下可能不稳定 | **High** | MobX v4 官方未测试 React 18，但基本的 observable/observer 功能在实践中可以工作 |
| 2 | **React 18 StrictMode double-mount** — ProseMirror init() 可能被调用两次 | **High** | 开发模式下会出现，生产模式不会。可以在开发时关闭 StrictMode |
| 3 | **Bundle 大小** — MobX(15KB) + lodash(25KB) + styled-components(12KB) + polished(8KB) + outline-icons(?KB) | **High** | 净增约 80-100KB gzip。lazy loading 可缓解 |
| 4 | **垫片功能不全** — 68 个路径的垫片可能在运行时出现 undefined/空组件 | **Medium** | 影响 UI 细节（如 Mention 菜单、HoverPreview），不影响核心编辑功能 |
| 5 | **主题属性遗漏** — 50+ 属性中遗漏任何一个导致 CSS 中出现 undefined | **Medium** | 需要从 Outline 的 theme.ts 完整提取 |
| 6 | **#标签功能** — Outline parser 不识别 `#tag` 语法 | **High** | 需要在 richExtensions 外部追加 Tag 扩展（但不修改 Outline 代码） |
| 7 | **lodash + lodash-es 双重打包** | **Low** | 增加约 25KB，可接受 |
| 8 | **Vite alias 顺序** — 错误的 alias 顺序导致路径解析错误 | **Medium** | 需要仔细测试，具体路径 > 通配路径 |

## 十二、执行顺序

```
Step 1:  安装 npm 依赖（mobx v4, styled-components v5, polished, lodash, outline-icons 等）
Step 2:  修改 tsconfig.json（experimentalDecorators, paths）
Step 3:  修改 vite.config.mts（alias）
Step 4:  复制 outline-source/shared/editor/ → src/outline-vendor/shared/editor/（零改动）
Step 5:  复制 outline-source/app/editor/ → src/outline-vendor/app/editor/（零改动）
Step 6:  复制 @shared/ 非 editor 工具文件 → src/outline-shims/shared/（约 22 个路径）
Step 7:  创建 ~/ 垫片文件 → src/outline-shims/app/（约 46 个路径，~35 个文件）
Step 8:  创建主题桥接 createEditorTheme()（50+ 属性映射）
Step 9:  创建 OutlineEditorWrapper 适配组件
Step 10: 修改页面组件（MemoDetail, BlogDetail, MemoView）
Step 11: 删除旧编辑器（MemoEditor/, BlogEditor/）
Step 12: 编译修复 — 逐一解决 TypeScript 错误
Step 13: 运行时调试 — 修复垫片中的缺失方法/属性
Step 14: #标签扩展 — 在 OutlineEditorWrapper 中注入自定义 Tag 节点
Step 15: 端到端测试
```

## 十三、工作量估算

| 阶段 | 工作量 |
|------|--------|
| 依赖 + 配置（Steps 1-3） | 0.5 天 |
| 复制 Outline 代码（Steps 4-5） | 0.5 天 |
| @shared/ 文件复制 + 检查（Step 6） | 1 天 |
| ~/ 垫片创建（Step 7） | 3-4 天 |
| 主题桥接（Step 8） | 1 天 |
| 适配组件 + 页面替换（Steps 9-11） | 1 天 |
| 编译修复 + 运行时调试（Steps 12-13） | 3-5 天 |
| #标签扩展（Step 14） | 1 天 |
| 端到端测试（Step 15） | 2-3 天 |
| **总计** | **13-17 天** |
