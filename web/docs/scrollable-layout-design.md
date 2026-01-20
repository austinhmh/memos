# 可滚动编辑框和卡片布局设计方案

## 概述

本文档描述了 Memos 应用中实现"无限画布"式布局的设计方案，其中编辑框和卡片都具有固定高度并支持独立滚动。

## 设计目标

实现以下布局特性：

1. **编辑框**：独占一行，固定高度 50vh，内容可滚动
2. **卡片布局**：保持3列瀑布流布局，每个卡片固定高度 33.33vh（约1/3屏幕），内容可滚动
3. **页面滚动**：整个页面可以向下滚动，编辑框可以滚出视口
4. **无限滚动**：支持无限滚动加载更多卡片

## 视觉效果

### 初始状态（页面顶部）

```
┌─────────────────────────────────────────────────────┐ ← 视口顶部
│                                                     │
│              📝 编辑框 (50vh)                        │
│              内容可滚动 overflow-y: auto             │
│                                                     │
├─────────────────────────────────────────────────────┤
│  📄 卡片1      │  📄 卡片2      │  📄 卡片3         │
│  (33.33vh)     │  (33.33vh)     │  (33.33vh)        │
│  可滚动        │  可滚动        │  可滚动           │
├─────────────────────────────────────────────────────┤ ← 视口底部
│  📄 卡片4      │  📄 卡片5      │  📄 卡片6         │
│  (部分可见)    │  (部分可见)    │  (部分可见)       │
```

### 向下滚动后

```
(编辑框已滚出视口)
┌─────────────────────────────────────────────────────┐ ← 视口顶部
│  📄 卡片4      │  📄 卡片5      │  📄 卡片6         │
│  (33.33vh)     │  (33.33vh)     │  (33.33vh)        │
├─────────────────────────────────────────────────────┤
│  📄 卡片7      │  📄 卡片8      │  📄 卡片9         │
│  (33.33vh)     │  (33.33vh)     │  (33.33vh)        │
├─────────────────────────────────────────────────────┤
│  📄 卡片10     │  📄 卡片11     │  📄 卡片12        │
│  (33.33vh)     │  (33.33vh)     │  (33.33vh)        │
└─────────────────────────────────────────────────────┘ ← 视口底部
```

## 布局结构

```
页面容器（正常文档流，可整体滚动）
│
├── 编辑框区域（独占一行）
│   ├── 宽度: 100%
│   ├── 高度: 50vh（固定）
│   └── 滚动: overflow-y: auto
│
└── 卡片列表区域
    ├── 布局: CSS Grid (3列)
    ├── 间距: gap-2
    │
    ├── 卡片行1
    │   ├── 卡片1: 33.33vh, overflow-y: auto
    │   ├── 卡片2: 33.33vh, overflow-y: auto
    │   └── 卡片3: 33.33vh, overflow-y: auto
    │
    ├── 卡片行2
    │   ├── 卡片4: 33.33vh, overflow-y: auto
    │   ├── 卡片5: 33.33vh, overflow-y: auto
    │   └── 卡片6: 33.33vh, overflow-y: auto
    │
    └── ... 更多卡片（无限滚动）
```

## 技术实现

### 1. 编辑框组件

**文件**: `web/src/components/MemoEditor/index.tsx`

**关键修改**：

```typescript
// 编辑框容器
<div className="h-[50vh] overflow-y-auto">
  {/* 编辑内容 */}
</div>
```

**要点**：
- 移除焦点模式下的固定定位样式（`position: fixed`）
- 设置固定高度 `h-[50vh]`
- 添加垂直滚动 `overflow-y-auto`
- 保持宽度 100%，独占一行

### 2. 卡片组件

**文件**: `web/src/components/MemoView/MemoView.tsx`

**关键修改**：

```typescript
// 卡片容器
<article className="h-[33.33vh] overflow-y-auto">
  {/* 卡片内容 */}
</article>
```

**要点**：
- 设置固定高度 `h-[33.33vh]`（约1/3屏幕高度）
- 添加垂直滚动 `overflow-y-auto`
- 确保内容超出时显示滚动条

### 3. 瀑布流布局

**文件**: `web/src/components/MasonryView/MasonryView.tsx`

**关键修改**：

由于卡片现在是固定高度，可以简化瀑布流布局逻辑：

```typescript
// 简化的网格布局
<div className="grid grid-cols-3 gap-2">
  {memoList.map((memo) => (
    <div key={memo.name} className="h-[33.33vh]">
      {renderer(memo, renderContext)}
    </div>
  ))}
</div>
```

**要点**：
- 使用简单的 CSS Grid 布局（3列）
- 移除复杂的高度计算逻辑
- 移除动态高度分布算法（因为所有卡片高度相同）

### 4. 布局 Hook

**文件**: `web/src/components/MasonryView/useMasonryLayout.ts`

**关键修改**：

由于卡片固定高度，可以大幅简化布局逻辑：

```typescript
// 简化的分布算法
const distribution = useMemo(() => {
  const cols: number[][] = Array.from({ length: columns }, () => []);
  
  memoList.forEach((_, index) => {
    const columnIndex = index % columns;
    cols[columnIndex].push(index);
  });
  
  return cols;
}, [memoList, columns]);
```

**要点**：
- 移除高度测量逻辑
- 使用简单的轮询分配算法
- 不再需要 `handleHeightChange` 回调

### 5. 页面容器

**文件**: `web/src/components/PagedMemoList/PagedMemoList.tsx`

**关键修改**：

确保页面使用正常文档流：

```typescript
// 页面容器
<div className="flex flex-col">
  {/* 编辑框 */}
  <MemoEditor className="h-[50vh]" />
  
  {/* 卡片列表 */}
  <MasonryView memoList={memos} />
</div>
```

**要点**：
- 不使用 `position: fixed` 或 `position: sticky`
- 保持现有的无限滚动逻辑（监听 `window.scroll` 事件）
- 编辑框和卡片列表在正常文档流中垂直排列

## 滚动机制

### 三层滚动

1. **页面级滚动**（最外层）
   - 整个页面可以上下滚动
   - 编辑框可以滚出视口
   - 触发无限滚动加载更多卡片

2. **编辑框滚动**（中层）
   - 编辑框内容超出 50vh 时
   - 编辑框内部出现滚动条
   - 独立于页面滚动

3. **卡片滚动**（内层）
   - 卡片内容超出 33.33vh 时
   - 卡片内部出现滚动条
   - 独立于页面滚动和其他卡片

### 滚动条样式

为了保持一致的用户体验，所有滚动条应使用相同的样式：

```css
/* 自定义滚动条样式（可选） */
.custom-scrollbar::-webkit-scrollbar {
  width: 8px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.3);
}
```

## 响应式设计

### 桌面端（默认）

- 编辑框：50vh
- 卡片：33.33vh
- 布局：3列网格

### 平板端（md 断点）

- 编辑框：50vh
- 卡片：33.33vh
- 布局：2列网格

### 移动端（sm 断点）

- 编辑框：40vh（调整为更小）
- 卡片：40vh（调整为更大，便于阅读）
- 布局：1列

```typescript
// 响应式类名示例
<div className="h-[40vh] md:h-[50vh]">编辑框</div>
<div className="h-[40vh] md:h-[33.33vh]">卡片</div>
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
  {/* 卡片列表 */}
</div>
```

## 性能考虑

### 1. 虚拟滚动（可选优化）

如果卡片数量非常多（>100），可以考虑实现虚拟滚动：

- 只渲染视口内及附近的卡片
- 使用 `react-window` 或 `react-virtual` 库
- 需要配合固定高度使用

### 2. 懒加载图片

卡片内的图片应使用懒加载：

```typescript
<img loading="lazy" src={imageUrl} />
```

### 3. 无限滚动优化

- 保持现有的分页加载机制
- 每次加载 20-30 个卡片
- 使用 React Query 的缓存机制

## 测试清单

### 功能测试

- [ ] 编辑框高度固定为 50vh
- [ ] 编辑框内容超出时显示滚动条
- [ ] 编辑框内容可以正常滚动
- [ ] 卡片高度固定为 33.33vh
- [ ] 卡片内容超出时显示滚动条
- [ ] 卡片内容可以正常滚动
- [ ] 页面可以向下滚动
- [ ] 向下滚动时编辑框滚出视口
- [ ] 向上滚动时编辑框重新进入视口
- [ ] 无限滚动功能正常工作
- [ ] 加载更多卡片时布局不闪烁

### 布局测试

- [ ] 3列布局在桌面端正常显示
- [ ] 2列布局在平板端正常显示
- [ ] 1列布局在移动端正常显示
- [ ] 卡片之间的间距一致
- [ ] 编辑框和卡片列表之间的间距合适

### 交互测试

- [ ] 编辑框滚动不影响页面滚动
- [ ] 卡片滚动不影响页面滚动
- [ ] 页面滚动不影响编辑框和卡片的内部滚动
- [ ] 滚动条样式一致
- [ ] 触摸设备上滚动流畅

### 性能测试

- [ ] 加载 100+ 卡片时性能良好
- [ ] 滚动流畅，无卡顿
- [ ] 内存使用合理
- [ ] 图片懒加载正常工作

## 潜在问题和解决方案

### 问题1：固定高度导致内容截断

**现象**：卡片内容很长时，用户可能不知道有更多内容。

**解决方案**：
- 确保滚动条始终可见（或在悬停时显示）
- 在卡片底部添加"展开"按钮（可选）
- 使用渐变效果提示有更多内容

### 问题2：瀑布流高度计算逻辑失效

**现象**：原有的动态高度计算逻辑不再需要。

**解决方案**：
- 移除 `useMasonryLayout` 中的高度测量逻辑
- 简化为简单的轮询分配算法
- 移除 `handleHeightChange` 回调

### 问题3：移动端体验不佳

**现象**：50vh 在移动端可能太大，33.33vh 可能太小。

**解决方案**：
- 使用响应式高度：移动端 40vh，桌面端 50vh
- 移动端改为单列布局
- 调整卡片高度以适应移动端屏幕

### 问题4：焦点模式冲突

**现象**：编辑框的焦点模式使用固定定位，与新布局冲突。

**解决方案**：
- 移除焦点模式的固定定位
- 或者在焦点模式下使用不同的布局策略
- 焦点模式下可以临时改变高度（如全屏）

### 问题5：无限滚动触发时机

**现象**：固定高度可能影响无限滚动的触发逻辑。

**解决方案**：
- 保持现有的滚动监听逻辑
- 调整触发阈值（如距离底部 300px）
- 确保自动加载逻辑正常工作

## 实施步骤

1. **创建设计文档**（本文档）✅
2. **修改编辑框组件**
   - 设置固定高度 50vh
   - 添加 overflow-y: auto
   - 移除焦点模式固定定位
3. **修改卡片组件**
   - 设置固定高度 33.33vh
   - 添加 overflow-y: auto
4. **简化瀑布流布局**
   - 移除动态高度计算
   - 使用简单的网格布局
5. **测试和调整**
   - 功能测试
   - 布局测试
   - 性能测试
   - 响应式测试

## 相关文件

- `web/src/components/MemoEditor/index.tsx` - 编辑框组件
- `web/src/components/MemoView/MemoView.tsx` - 卡片组件
- `web/src/components/MasonryView/MasonryView.tsx` - 瀑布流布局
- `web/src/components/MasonryView/useMasonryLayout.ts` - 布局逻辑
- `web/src/components/PagedMemoList/PagedMemoList.tsx` - 分页列表
- `web/src/components/MemoView/components/MemoBody.tsx` - 卡片内容

## 参考资料

- [CSS Grid Layout](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Grid_Layout)
- [CSS Overflow](https://developer.mozilla.org/en-US/docs/Web/CSS/overflow)
- [Viewport units (vh, vw)](https://developer.mozilla.org/en-US/docs/Web/CSS/length#viewport-percentage_lengths)
- [Intersection Observer API](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API) - 用于无限滚动

## 更新日志

- 2026-01-21: 初始版本，定义设计方案和实施步骤
