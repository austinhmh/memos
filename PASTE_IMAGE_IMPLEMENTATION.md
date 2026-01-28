# 粘贴图片上传与智能删除功能实现总结

## 实现完成时间
2025-01-28

## 功能概述

成功实现了两个核心功能：
1. **粘贴图片自动上传**：用户粘贴图片后自动上传到S3，并在光标位置插入Markdown语法
2. **智能删除追踪**：追踪Markdown中的图片引用，自动删除未被引用的附件及其S3文件

## 实现的文件清单

### 前端文件（1个）
- ✅ `web/src/components/MemoEditor/components/EditorContent.tsx` - 实现粘贴事件处理和图片上传

### 后端文件（4个）
- ✅ `proto/store/memo.proto` - 添加 `image_urls` 字段
- ✅ `plugin/markdown/markdown.go` - 提取图片URL
- ✅ `server/runner/memopayload/runner.go` - 保存图片URL到数据库
- ✅ `server/router/api/v1/memo_service.go` - 实现智能删除逻辑
- ✅ `store/attachment.go` - 增强删除日志

## 关键实现细节

### 1. 前端粘贴处理

**文件**: `web/src/components/MemoEditor/components/EditorContent.tsx`

**功能**:
- 监听粘贴事件，从剪贴板读取图片文件
- 调用 `uploadService.uploadFiles()` 上传图片
- 上传成功后，在光标位置插入 `![filename](url)` 语法
- 显示上传状态，错误处理

**调试日志**:
```javascript
console.log('[EditorContent] Paste event detected, items count:', items.length);
console.log('[EditorContent] Found image files:', imageFiles.length);
console.log('[EditorContent] Uploading files...');
console.log('[EditorContent] Upload success, attachments:', attachments);
console.log('[EditorContent] Inserted markdown at cursor position:', markdown);
console.error('[EditorContent] Upload failed:', error);
```

### 2. Proto 定义更新

**文件**: `proto/store/memo.proto`

**修改**:
```protobuf
message MemoPayload {
  Property property = 1;
  Location location = 2;
  repeated string tags = 3;
  repeated string image_urls = 4;  // 新增字段
  // ...
}
```

### 3. 图片URL提取

**文件**: `plugin/markdown/markdown.go`

**功能**:
- 在 `ExtractAll` 方法中遍历AST节点
- 识别 `*gast.Image` 类型节点
- 提取 `img.Destination` 作为图片URL
- 返回 `ImageURLs []string`

**调试日志**:
```go
slog.Debug("Extracting image URLs from markdown", 
    "content_length", len(content),
    "matches_found", len(matches))
slog.Debug("Extracted image URLs", 
    "urls", imageURLs,
    "count", len(imageURLs))
```

### 4. 保存图片URL

**文件**: `server/runner/memopayload/runner.go`

**功能**:
- 在 `RebuildMemoPayload` 中保存提取的图片URL
- 更新 `memo.Payload.ImageUrls`

**调试日志**:
```go
slog.Debug("Rebuilding memo payload",
    "memo_id", memo.ID,
    "content_length", len(memo.Content))
slog.Debug("Extracted data from markdown",
    "tags", data.Tags,
    "image_urls", data.ImageURLs,
    "image_count", len(data.ImageURLs))
slog.Info("Updated memo payload",
    "memo_id", memo.ID,
    "image_urls_count", len(data.ImageURLs))
```

### 5. 智能删除逻辑

**文件**: `server/router/api/v1/memo_service.go`

**功能**:
- 新增 `cleanupUnreferencedAttachments()` 函数
- 在 `UpdateMemo` 中，内容更新后调用清理函数
- 提取附件UID，与 `payload.image_urls` 对比
- 删除未被引用的附件

**URL匹配逻辑**:
```go
func extractAttachmentUID(url string) string {
    if strings.HasPrefix(url, "/file/attachments/") {
        parts := strings.Split(strings.TrimPrefix(url, "/file/attachments/"), "/")
        if len(parts) > 0 && parts[0] != "" {
            return parts[0]
        }
    }
    return ""
}
```

**调试日志**:
```go
slog.Debug("Starting cleanup of unreferenced attachments", "memo_id", memoID)
slog.Debug("Found attachments for memo", "memo_id", memoID, "attachment_count", len(attachments))
slog.Debug("Extracted referenced UIDs from image URLs", "image_urls", memo.Payload.ImageUrls, "referenced_uids", referencedUIDs)
slog.Info("Deleting unreferenced attachment", "memo_id", memoID, "attachment_id", att.ID, "attachment_uid", att.UID, "filename", att.Filename)
slog.Info("Cleanup completed", "memo_id", memoID, "deleted_count", deletedCount)
```

### 6. 增强删除日志

**文件**: `store/attachment.go`

**功能**:
- 在 `DeleteAttachment` 方法中添加详细日志
- 记录本地文件删除、S3对象删除的每个步骤
- S3删除失败时记录警告但继续删除数据库记录

**调试日志**:
```go
slog.Debug("Deleting attachment", "attachment_id", delete.ID, "storage_type", attachment.StorageType)
slog.Debug("Deleting local file", "attachment_id", attachment.ID, "path", p)
slog.Info("Deleting S3 object", "attachment_id", attachment.ID, "s3_key", s3ObjectPayload.Key, "bucket", s3Config.Bucket)
slog.Warn("Failed to delete S3 object (continuing with DB deletion)", "attachment_id", attachment.ID, "error", err)
slog.Info("Successfully deleted attachment", "attachment_id", delete.ID, "storage_type", attachment.StorageType)
```

## 测试指南

### 测试场景1：粘贴单张图片

**操作步骤**:
1. 复制一张图片到剪贴板
2. 在编辑器中粘贴（Ctrl+V / Cmd+V）
3. 打开浏览器开发者工具 Console 面板
4. 观察日志输出
5. 验证 Markdown 语法插入：`![filename](url)`
6. 保存 Memo
7. 观察后端日志

**预期前端日志**:
```
[EditorContent] Paste event detected, items count: 1
[EditorContent] Found image files: 1
[EditorContent] Uploading files...
[EditorContent] Upload success, attachments: [...]
[EditorContent] Inserted markdown at cursor position: ![image.png](/file/attachments/abc123/image.png)
```

**预期后端日志**:
```
Rebuilding memo payload memo_id=123
Extracted image URLs urls=["/file/attachments/abc123/image.png"] count=1
Updated memo payload memo_id=123 image_urls_count=1
```

### 测试场景2：删除图片引用

**操作步骤**:
1. 编辑已有 Memo，删除 Markdown 中的 `![...](...)` 语法
2. 保存 Memo
3. 观察后端日志中的清理流程
4. 验证附件列表中图片已删除
5. 验证 S3 中文件已删除（如果使用 S3）

**预期后端日志**:
```
Starting cleanup of unreferenced attachments memo_id=123
Found attachments for memo memo_id=123 attachment_count=2
Extracted referenced UIDs referenced_uids={"abc123": true}
Deleting unreferenced attachment attachment_uid=xyz789 filename=old.png
Deleting S3 object s3_key=xyz789/old.png
Successfully deleted attachment attachment_id=456
Cleanup completed memo_id=123 deleted_count=1
```

### 测试场景3：外部图片URL

**操作步骤**:
1. 手动输入外部图片 URL：`![](https://example.com/image.png)`
2. 保存 Memo
3. 验证外部图片不会被删除
4. 观察日志中 UID 提取失败（预期行为）

**预期后端日志**:
```
Extracted image URLs urls=["https://example.com/image.png"] count=1
Extracted referenced UIDs referenced_uids={}  # 外部URL无法提取UID
# 不会触发删除操作
```

## 日志查看方法

### 前端日志
```bash
# 浏览器开发者工具 Console 面板
# 过滤关键词：[EditorContent]
```

### 后端日志
```bash
# 启动服务时设置日志级别
MEMOS_MODE=dev go run ./cmd/memos

# 查看日志输出
# 过滤关键词：image, attachment, cleanup
```

## 编译验证

✅ 后端编译成功（Go 1.25.0）
✅ 前端无 lint 错误
✅ Proto 代码重新生成成功

## 注意事项

1. **向后兼容**: 旧的 Memo 没有 `image_urls` 字段，清理逻辑会检查 `nil` 情况
2. **错误容忍**: S3 删除失败只记录警告，不阻止 Memo 保存
3. **性能优化**: 图片 URL 提取在 `memopayload` runner 中异步执行
4. **URL 格式**: 只处理本地附件 URL（`/file/attachments/{uid}/{filename}`），外部 URL 不受影响

## 下一步

功能已完全实现并通过编译验证。建议：

1. 启动开发服务器进行实际测试
2. 验证粘贴图片上传功能
3. 验证智能删除追踪功能
4. 检查所有日志输出是否符合预期
5. 测试边界情况（多张图片、外部URL等）

## 相关文档

- 详细计划：`/root/.cursor/plans/粘贴图片上传与智能删除_abfed3d3.plan.md`
- Memos 架构指南：`AGENTS.md`
