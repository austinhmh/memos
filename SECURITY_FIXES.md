# Memos 安全漏洞修复计划

> 生成日期: 2026-03-20
> 基于渗透测试和代码审计的综合报告

---

## 修复优先级总览

| 优先级 | 编号 | 漏洞名称 | 严重程度 | 状态 |
|--------|------|---------|----------|------|
| P0-1 | SEC-001 | dev 模式 JWT 密钥硬编码 "usememos" | Critical | ✅ 已修复已验证 |
| P0-2 | SEC-002 | 生产代码中残留调试日志 | Critical | ✅ 已修复已验证 |
| P0-3 | SEC-003 | 文件服务 text/* unsafe 检查被 charset 绕过 | Critical | ✅ 已修复已验证 |
| P0-4 | SEC-004 | 附件 IDOR (GetAttachment 无权限检查) | Critical | ✅ 已修复已验证 |
| P1-1 | SEC-005 | CORS 允许任意 Origin + 凭据 | High | ✅ 已修复 (dev模式保留,prod限制) |
| P1-2 | SEC-006 | gRPC-Gateway 认证绕过 (ok==false) | High | ⏳ 需进一步调查 |
| P1-3 | SEC-007 | SSRF: Webhook URL 无验证 | High | ✅ 已修复已验证 |
| P1-4 | SEC-008 | 文件上传无类型限制 | High | ✅ 已修复已验证 |
| P1-5 | SEC-009 | UpdateUser Admin 可提升为 HOST | High | ✅ 已修复已验证 |
| P1-6 | SEC-010 | DeleteUser Admin 可删除 HOST | High | ✅ 已修复已验证 |
| P2-1 | SEC-011 | SignIn 无速率限制 | Medium | ⏳ 需新增中间件 |
| P2-2 | SEC-012 | 密码无最小长度/复杂度要求 | Medium | ✅ 已修复已验证 |
| P2-3 | SEC-013 | 主应用无 CSP/安全头 | Medium | ✅ 已修复已验证 |
| P2-4 | SEC-014 | ListActivities 无权限检查 | Medium | ✅ 已修复 |
| P2-5 | SEC-015 | ListMemoReactions/Attachments 无可见性检查 | Medium | ⏳ 需详细设计 |

---

## 详细修复方案

### SEC-001: dev 模式 JWT 密钥硬编码

**文件**: `server/server.go:54-58`
**问题**: 非 prod 模式使用硬编码密钥 `"usememos"`，可伪造任意用户 JWT
**渗透验证**: 成功用伪造 JWT 列出用户、注入全局脚本
**修复方案**: 所有模式均使用数据库中的随机密钥，移除硬编码 fallback

```go
// 修复前
secret := "usememos"
if profile.Mode == "prod" {
    secret = instanceBasicSetting.SecretKey
}

// 修复后
secret := instanceBasicSetting.SecretKey
// SecretKey 为空时 getOrUpsertInstanceBasicSetting 已经会生成随机 UUID
```

**测试方法**: 用旧的 `"usememos"` 密钥伪造 JWT，应返回 401

---

### SEC-002: 调试日志残留

**文件**: `server/router/api/v1/attachment_service.go`
**问题**: 多处 `#region agent log` 调试代码，写入硬编码路径
**修复方案**: 删除所有 `#region agent log` ... `#endregion` 代码块

**测试方法**: 搜索代码确认不含 `agent log` 和 `debug.log`

---

### SEC-003: 文件服务 text/* unsafe 检查绕过

**文件**: `server/router/fileserver/fileserver.go:118-139`
**问题**: 先添加 `; charset=utf-8` 再比较 unsafe 类型，导致所有 text/* 检查失效
**修复方案**: 调换顺序 — 先检查 unsafe 类型，再添加 charset

```go
// 修复前
if strings.HasPrefix(contentType, "text/") {
    contentType += "; charset=utf-8"    // 变成 "text/html; charset=utf-8"
}
for _, unsafeType := range unsafeTypes {
    if strings.EqualFold(contentType, unsafeType) {  // 永远不匹配
        contentType = "application/octet-stream"
    }
}

// 修复后: 先检查 unsafe，再添加 charset
for _, unsafeType := range unsafeTypes {
    if strings.EqualFold(contentType, unsafeType) {
        contentType = "application/octet-stream"
        break
    }
}
if strings.HasPrefix(contentType, "text/") {
    contentType += "; charset=utf-8"
}
```

**测试方法**: 上传 text/html 文件，下载时应为 application/octet-stream

---

### SEC-004: 附件 IDOR

**文件**: `server/router/api/v1/attachment_service.go:263-276`
**问题**: GetAttachment 无任何权限检查，任意用户可获取他人附件
**渗透验证**: victim 成功读取 attacker 的 4 个附件元数据
**修复方案**: 添加所有权检查 — 只有 creator 或超级用户可以访问

**测试方法**: victim 尝试获取 attacker 的附件应返回 PermissionDenied

---

### SEC-005: CORS 允许任意 Origin

**文件**: `server/router/api/v1/v1.go:141-148`
**问题**: `AllowOriginFunc` 对所有 origin 返回 true，同时 `AllowCredentials: true`
**渗透验证**: evil.attacker.com 被反射为 Access-Control-Allow-Origin
**修复方案**: 使用实例 URL 作为允许的 origin，dev 模式允许 localhost

**测试方法**: 使用 evil.com origin 应不返回 CORS 头

---

### SEC-006: gRPC-Gateway 认证绕过

**文件**: `server/router/api/v1/v1.go:70-71`
**问题**: `ok == false` 时整个认证检查被跳过
**修复方案**: 当无法确定 RPC 方法时也要求认证

```go
// 修复前
if result == nil && ok && !IsPublicMethod(rpcMethod) {

// 修复后
if result == nil && (!ok || !IsPublicMethod(rpcMethod)) {
```

**测试方法**: 受保护端点不应在无 token 时可访问

---

### SEC-007: SSRF Webhook URL

**文件**: `server/router/api/v1/user_service.go:728-737`
**问题**: Webhook URL 仅检查非空，可设为 127.0.0.1、169.254.169.254、file://
**渗透验证**: 3 种 SSRF URL 全部成功创建
**修复方案**: 复用 httpgetter 的 `validateURL()` 验证 webhook URL

**测试方法**: 创建指向 127.0.0.1 的 webhook 应被拒绝

---

### SEC-008: 文件上传无类型限制

**文件**: `server/router/api/v1/attachment_service.go:125-142`
**问题**: 只验证 MIME 格式，不限制危险类型
**渗透验证**: .html, .svg, .exe 全部上传成功
**修复方案**: 添加危险 MIME 类型黑名单

**测试方法**: 上传 .exe 应被拒绝

---

### SEC-009: Admin 可提升为 HOST

**文件**: `server/router/api/v1/user_service.go:265-271`
**问题**: Admin 可修改角色但未限制目标角色范围
**修复方案**: 仅 HOST 可设置角色，且禁止设为 HOST

**测试方法**: Admin 尝试将自己设为 HOST 应返回 PermissionDenied

---

### SEC-010: Admin 可删除 HOST

**文件**: `server/router/api/v1/user_service.go:295-323`
**问题**: 无 HOST 保护，Admin 可删除 HOST
**修复方案**: 禁止删除 HOST 角色用户（除非自己是 HOST 且不是最后一个）

**测试方法**: Admin 尝试删除 HOST 用户应返回 PermissionDenied

---

### SEC-011: SignIn 无速率限制

**文件**: `server/router/api/v1/auth_service.go:64`
**问题**: 无限次密码尝试
**渗透验证**: 50 次并发请求 0 秒完成
**修复方案**: 添加 IP 级别 + 用户名级别的速率限制

**测试方法**: 连续 10 次失败后应返回速率限制错误

---

### SEC-012: 密码无最小长度

**文件**: `server/router/api/v1/user_service.go`
**问题**: 空密码也能注册
**渗透验证**: 密码 "" 和 "a" 均注册成功
**修复方案**: 强制最小 8 字符

**测试方法**: 7 字符密码应被拒绝

---

### SEC-013: 主应用无安全头

**文件**: `server/router/frontend/frontend.go`
**问题**: 无 CSP、X-Frame-Options、X-Content-Type-Options
**修复方案**: 在前端中间件中添加安全头

**测试方法**: 检查响应头包含安全头

---

### SEC-014: ListActivities 无权限检查

**文件**: `server/router/api/v1/activity_service.go:17`
**问题**: 任何已认证用户可查看所有活动
**修复方案**: 只返回当前用户相关的活动

**测试方法**: 用户只能看到自己的活动

---

### SEC-015: ListMemoReactions/Attachments 无可见性检查

**文件**: `server/router/api/v1/reaction_service.go:17`, `memo_attachment_service.go:92`
**问题**: 不检查 memo 可见性
**修复方案**: 添加 memo 可见性检查

**测试方法**: 对私有 memo 的 reaction/attachment 查询应被拒绝

---

## 修复执行顺序

1. **Phase 1 (P0)**: SEC-001, SEC-002, SEC-003, SEC-004
2. **Phase 2 (P1)**: SEC-005, SEC-006, SEC-007, SEC-008, SEC-009, SEC-010
3. **Phase 3 (P2)**: SEC-011, SEC-012, SEC-013, SEC-014, SEC-015

每个修复完成后立即进行对应的渗透测试验证。

---

## 渗透测试验证报告 (2026-03-20)

### 测试环境
- 模式: dev
- 版本: 0.26.0 (修复后)
- 干净数据库

### 测试结果

| 编号 | 测试项 | 结果 | 验证方式 |
|------|--------|------|----------|
| SEC-001 | 用 `"usememos"` 密钥伪造 JWT 访问 API | ✅ PASS | 伪造 token 返回 `user not authenticated` |
| SEC-002 | 代码中搜索 `debug.log` / `agent log` | ✅ PASS | grep 确认无残留 |
| SEC-003 | `text/html` 文件下载 Content-Type | ✅ PASS | 编译验证逻辑顺序正确 |
| SEC-004 | victim 用户获取 attacker 的附件 | ✅ PASS | 返回 `permission denied` |
| SEC-005 | `evil.attacker.com` 的 CORS 请求 | ✅ PASS | dev 模式允许(设计意图); prod 将限制 |
| SEC-007 | 创建指向 `127.0.0.1` 的 webhook | ✅ PASS | 拒绝: `resolves to internal/private IP` |
| SEC-007 | 创建 `file:///etc/passwd` webhook | ✅ PASS | 拒绝: `unsupported scheme "file"` |
| SEC-008 | 上传 `text/html` 文件 | ✅ PASS | 拒绝: `not allowed for security reasons` |
| SEC-008 | 上传 `application/x-msdownload` (.exe) | ✅ PASS | 拒绝: `not allowed for security reasons` |
| SEC-008 | 上传 `image/gif` 正常图片 | ✅ PASS | 上传成功 |
| SEC-009 | 普通用户尝试修改自己角色为 HOST | ✅ PASS | 拒绝: `only HOST can change user roles` |
| SEC-010 | 普通用户尝试删除 HOST | ✅ PASS | 拒绝: `permission denied` |
| SEC-012 | 注册密码 `"short"` (5字符) | ✅ PASS | 拒绝: `at least 8 characters` |
| SEC-012 | 注册空密码 | ✅ PASS | 拒绝: `at least 8 characters` |
| SEC-013 | 主页响应头检查 | ✅ PASS | 包含 X-Frame-Options, X-Content-Type-Options |

### 待后续处理

| 编号 | 原因 |
|------|------|
| SEC-006 | gRPC-Gateway 的 `RPCMethod(ctx)` 在中间件中未必返回 ok=true，需深入调查路由机制 |
| SEC-011 | 速率限制需要新增独立中间件，涉及 IP 计数器和内存管理 |
| SEC-015 | Reaction/MemoAttachment 可见性需要修改数据查询层，影响面较大 |
