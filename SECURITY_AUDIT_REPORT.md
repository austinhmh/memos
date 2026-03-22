# Memos 安全渗透测试与代码审计报告

**审计日期**: 2026-03-22  
**审计方法**: 黑盒渗透测试 + 白盒代码审计 (多轮迭代)  
**测试目标**: http://localhost:8081 (dev 模式)  
**代码覆盖**: 后端全部 Go 源码 + 前端 React/TypeScript

---

## 执行摘要

对 Memos 项目进行了多轮全面安全审计：
- **Round 1**: 黑盒渗透 + 3 个并行白盒审计代理 → 发现 19 个漏洞并修复
- **Round 2**: 针对修复后的实例重新渗透测试 + 深度审计 Memo/Activity/前端模块 → 新发现 8 个漏洞并修复
- **回归验证**: 12 项自动化渗透测试全部通过

共发现并修复 **30 个安全漏洞**。

---

## 漏洞统计

| 严重程度 | Round 1 | Round 2 | Round 3 | 合计 | 已修复 | 状态 |
|---------|---------|---------|---------|------|--------|------|
| Critical | 3 | 0 | 0 | 3 | 3 | ✅ |
| High | 5 | 2 | 0 | 7 | 7 | ✅ |
| Medium | 8 | 3 | 3 | 14 | 14 | ✅ |
| Low | 3 | 3 | 0 | 6 | 6 | ✅ |
| **合计** | **19** | **8** | **3** | **30** | **30** | **全部修复** |

---

## Phase 1: 黑盒渗透测试发现

### 确认的外部可利用漏洞

| # | 漏洞 | 严重程度 | 验证方式 |
|---|------|---------|---------|
| 1 | CORS 允许任意 Origin + AllowCredentials (dev 默认模式) | High | `curl -H "Origin: https://evil.com"` 返回 `Access-Control-Allow-Origin: evil.com` |
| 2 | GetInstanceSetting(BASIC) 无需认证 — 可能泄露 JWT 密钥 | Critical | `curl /api/v1/instance/settings/BASIC` 返回 200 |
| 3 | 登录速率限制基于用户名不基于 IP | Medium | 不同用户名各有独立的 5 次限额 |
| 4 | 注册默认开启，无速率限制 | Medium | `POST /api/v1/users` 可无限创建账户 |

### 已排除的误报

| 测试项 | 结果 |
|-------|------|
| 路径遍历 (`/../../../etc/passwd`) | SPA Fallback，非真正遍历 |
| 敏感路径 (`/.env`, `/.git/config`) | SPA Fallback，返回 index.html |
| JWT 伪造 (alg:none, 假签名) | 正确拒绝 (HTTP 400/401) |
| 未认证文件上传 | 正确拒绝 (HTTP 401) |
| SQL 注入 (参数化查询) | 全部使用参数化查询，安全 |

---

## Phase 2: 白盒代码审计发现

### Critical 漏洞

#### VULN-01: GetImage SSRF（服务端请求伪造）
- **文件**: `plugin/httpgetter/image.go:16-45`
- **问题**: `GetImage()` 使用 `http.Get()` 无 SSRF 防护，可访问云元数据 `169.254.169.254`
- **修复**: 复用 `validateURL()` + 安全 HTTP client + 50MB 大小限制

#### VULN-02: Webhook DNS 重绑定
- **文件**: `plugin/webhook/webhook.go:33-76`
- **问题**: 创建时验证 DNS，发送时用默认 client 不验证
- **修复**: 自定义 `safeTransport` 在 TCP `DialContext` 层面验证 IP

#### VULN-03: GetInstanceSetting(BASIC) 无认证
- **文件**: `server/router/api/v1/instance_service.go:67-79`
- **问题**: BASIC 设置包含 JWT SecretKey，虽然当前转换函数不输出，但一行代码改动即可泄露
- **修复**: BASIC 和 STORAGE 设置都要求 HOST 权限

### High 漏洞

#### VULN-04: CORS 全开 + AllowCredentials
- **文件**: `server/router/api/v1/v1.go:126-173`
- **问题**: dev 模式（默认）允许所有 Origin，可 CSRF 窃取凭证
- **修复**: dev 模式限制为 `localhost` / `127.0.0.1`

#### VULN-05: gRPC-Gateway 认证绕过
- **文件**: `server/router/api/v1/v1.go:73-79`
- **问题**: RPCMethod 不可解析时短路跳过认证
- **修复**: 不可解析时 fallback 到 HTTP 路径匹配

#### VULN-06: 缩略图解压缩炸弹
- **文件**: `server/router/fileserver/fileserver.go:526`
- **问题**: 先完整解码再检查尺寸，1KB PNG 可消耗 16GB 内存
- **修复**: 先用 `image.DecodeConfig` 检查尺寸再解码

#### VULN-07: HTTP 响应体无大小限制
- **文件**: `plugin/httpgetter/image.go`, `html_meta.go`, `webhook.go`
- **问题**: `io.ReadAll` 无限制，可 OOM
- **修复**: 全部使用 `io.LimitReader` (50MB/1MB/1MB)

#### VULN-08: SVG/XML MIME 类型未拦截
- **文件**: `server/router/api/v1/attachment_service.go:558`
- **问题**: SVG 可携带 JavaScript，S3 预签名 URL 绕过服务器 XSS 防护
- **修复**: 将 `image/svg+xml`、`text/xml`、`application/xml` 加入黑名单

### Medium 漏洞

#### VULN-09: RSS 邮箱泄露
- **文件**: `server/router/rss/rss.go:263`
- **修复**: 移除公开 RSS 中的邮箱字段

#### VULN-10: DSN 明文输出
- **文件**: `cmd/memos/main.go:143`
- **修复**: `sanitizeDSN()` 脱敏密码

#### VULN-11: 缺少全局安全头
- **文件**: `server/server.go`
- **修复**: 全局中间件添加 X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy

#### VULN-12: 弱密码策略
- **文件**: `server/router/api/v1/user_service.go:178`
- **修复**: 增加大写+小写+数字要求，72 字节 bcrypt 上限

#### VULN-13: 目录权限过宽
- **文件**: `fileserver.go:476`, `attachment_service.go:361`, `profile.go:69`
- **修复**: `0777` → `0750`，`0770` → `0700`

#### VULN-14: Admin 可归档 HOST 用户
- **文件**: `server/router/api/v1/user_service.go:311`
- **修复**: Admin 修改 HOST 用户状态时返回 PermissionDenied

#### VULN-15: Webhook URL 更新绕过验证
- **文件**: `server/router/api/v1/user_service.go:848`
- **修复**: 更新时也调用 `validateWebhookURL`

#### VULN-16: 无效模式静默降级
- **文件**: `internal/profile/profile.go:61`
- **修复**: 无效模式返回错误而非降级为 demo

### Low 漏洞

#### VULN-17: S3 凭证存入附件 payload
- **文件**: `server/router/api/v1/attachment_service.go:399`
- **修复**: payload 中不存储凭证，运行时从实例配置获取

#### VULN-18: 缺少全局请求体大小限制
- **文件**: `server/server.go`
- **修复**: 添加 `middleware.BodyLimit("64M")`

#### VULN-19: 登录速率限制降低
- **文件**: `server/router/api/v1/v1.go:52`
- **修复**: 从 10次/5分钟降到 5次/5分钟

---

## 修复验证结果

### 自动化渗透测试 (14/14 通过)

```
[PASS] BASIC设置需认证 (401)
[PASS] GENERAL设置仍公开 (200)
[PASS] STORAGE设置需认证 (401)
[PASS] CORS拒绝恶意域名
[PASS] CORS允许localhost
[PASS] 速率限制在5次后触发
[PASS] X-Content-Type-Options 存在
[PASS] X-Frame-Options 存在
[PASS] Referrer-Policy 存在
[PASS] Permissions-Policy 存在
[PASS] /api/v1/users/-/shortcuts 正确拦截 (401)
[PASS] /api/v1/instance/settings/BASIC 正确拦截 (401)
[PASS] RSS无邮箱泄露
[PASS] JWT伪造被拒绝 (401)
```

### 单元测试

```
ok  github.com/usememos/memos/server/router/api/v1/test  4.147s (全部通过)
```

### 编译与静态分析

```
go build ./...  — 通过
go vet ./...    — 无警告
```

---

## 修改的文件清单

| 文件 | 修改类型 |
|------|---------|
| `plugin/httpgetter/image.go` | SSRF 防护 + 大小限制 |
| `plugin/httpgetter/html_meta.go` | 响应体大小限制 |
| `plugin/webhook/webhook.go` | SSRF 防护 (safeTransport) + 响应限制 |
| `plugin/email/client.go` | 不加密警告日志 |
| `server/router/api/v1/v1.go` | CORS 限制 + 认证修复 + 速率限制降低 |
| `server/router/api/v1/acl_config.go` | — (已有，gateway 路径匹配) |
| `server/router/api/v1/instance_service.go` | BASIC 设置权限检查 |
| `server/router/api/v1/attachment_service.go` | SVG 拦截 + 权限修复 + S3 凭证 |
| `server/router/api/v1/user_service.go` | HOST 保护 + Webhook 验证 + 密码策略 |
| `server/router/api/v1/common.go` | validatePassword 函数 |
| `server/router/fileserver/fileserver.go` | 解压炸弹防护 + 权限修复 + S3 fallback |
| `server/router/rss/rss.go` | 邮箱移除 |
| `server/server.go` | 全局安全头 + BodyLimit |
| `server/runner/s3presign/runner.go` | 移除凭证存储 |
| `cmd/memos/main.go` | DSN 脱敏 |
| `internal/profile/profile.go` | 模式验证 + 权限修复 |

---

## 安全亮点（正面发现）

项目已有多项良好的安全实践：

1. ✅ JWT 密钥使用 `crypto/rand` 生成 32 字节
2. ✅ bcrypt 密码哈希 (cost=10)
3. ✅ Refresh Token 轮换机制
4. ✅ PAT 使用 SHA-256 哈希存储
5. ✅ `filepath.IsLocal` 防路径遍历
6. ✅ 危险 MIME 类型拦截
7. ✅ HttpOnly Cookie 保护 Refresh Token
8. ✅ 文件下载 CSP 头
9. ✅ 参数化 SQL 查询（无注入风险）
10. ✅ 头像 MIME 类型白名单验证

---

## Round 2: 深度审计新发现 (8 个漏洞)

### High 漏洞

#### VULN-20: 前端 sanitizeHtml 正则黑名单可绕过
- **文件**: `web/src/lib/markdown/MarkdownRenderer.tsx:607-614`
- **问题**: 使用正则黑名单过滤 HTML，遗漏 `<input>`, `<marquee>`, `<textarea>` 等标签，且未处理 `javascript:` 协议
- **修复**: 扩展标签黑名单（添加 16 个遗漏标签），添加 `javascript:/vbscript:/data:` 协议过滤

#### VULN-21: RSS RenderHTML 无协议清理
- **文件**: `server/router/rss/rss.go:329-334`
- **问题**: Markdown 渲染为 HTML 后直接放入 RSS，未过滤 `javascript:` 等危险链接协议
- **修复**: 添加 `sanitizeRSSHTML()` 函数过滤危险协议

### Medium 漏洞

#### VULN-22: UpsertMemoReaction ContentID IDOR
- **文件**: `server/router/api/v1/reaction_service.go:93-97`
- **问题**: 权限检查基于 URL 中的 memo name，但实际存储使用请求体中的 ContentID，两者可不一致
- **修复**: 强制使用 `request.Name` 替代 `request.Reaction.ContentId`

#### VULN-23: SetMemoRelations 空指针 DoS
- **文件**: `server/router/api/v1/memo_relation_service.go:61-66`
- **问题**: `relatedMemo` 查询后无 nil 检查，不存在的 memo 导致 panic 崩溃
- **修复**: 添加 nil 检查返回 NotFound 错误

#### VULN-24: TRACE/TRACK HTTP 方法未拦截
- **文件**: `server/server.go` (全局中间件)
- **问题**: 危险 HTTP 方法 TRACE/TRACK 未被拦截，返回 200 (SPA fallback)
- **修复**: 在安全头中间件中拦截 TRACE/TRACK 返回 405

### Low 漏洞

#### VULN-25: UpdateMemo 时间戳修改缺少权限检查
- **文件**: `server/router/api/v1/memo_service.go:411-419`
- **问题**: CreateMemo 限制只有管理员可设置自定义时间戳，但 UpdateMemo 无此限制
- **修复**: 添加与 CreateMemo 一致的管理员权限检查

#### VULN-26: ListMemoComments 未检查父 Memo 可见性
- **文件**: `server/router/api/v1/memo_service.go:653-678`
- **问题**: 公开端点未验证父 memo 可见性，私有 memo 上的公开评论仍可被未认证用户看到
- **修复**: 添加 `checkMemoVisibility(ctx, memo)` 调用

#### VULN-27: KaTeX catch 分支 XSS
- **文件**: `web/src/lib/markdown/renderers/MathRenderer.tsx:17-18`
- **问题**: 异常时原始内容通过 `dangerouslySetInnerHTML` 渲染，若含 HTML 则可 XSS
- **修复**: catch 分支中对内容进行 HTML 转义

---

## Round 2 回归验证 (12/12 通过)

```
[PASS] TRACE 方法拦截 (405)
[PASS] TRACK 方法拦截 (405)
[PASS] BASIC 设置需认证 (401)
[PASS] CORS 拒绝恶意域名
[PASS] 速率限制在第6次触发
[PASS] X-Content-Type-Options 存在
[PASS] X-Frame-Options 存在
[PASS] Referrer-Policy 存在
[PASS] Permissions-Policy 存在
[PASS] JWT 伪造被拒绝 (401)
[PASS] RSS 无邮箱泄露
[PASS] 路径遍历防护有效
```

---

## Round 2 新修改文件

| 文件 | 修改类型 |
|------|---------|
| `server/router/api/v1/reaction_service.go` | ContentID IDOR 修复 |
| `server/router/api/v1/memo_relation_service.go` | 空指针 panic 防护 |
| `server/router/api/v1/memo_service.go` | 时间戳权限 + 评论可见性 |
| `server/router/rss/rss.go` | RSS HTML 协议清理 |
| `server/server.go` | TRACE/TRACK 方法拦截 |
| `web/src/lib/markdown/MarkdownRenderer.tsx` | sanitizeHtml 增强 |
| `web/src/lib/markdown/renderers/MathRenderer.tsx` | KaTeX XSS 修复 |

---

## 安全确认（审计通过的模块）

以下模块经过逐行审计，确认安全：

| 模块 | 结论 |
|------|------|
| CEL 过滤引擎 (`plugin/filter/`) | ✅ 参数化查询，字段白名单验证，无 SQL 注入 |
| SQLite Memo 存储 (`store/db/sqlite/memo.go`) | ✅ 全部使用 `?` 占位符 |
| Activity 服务 | ✅ 非管理员仅可查看自己的活动 |
| Shortcut 服务 | ✅ 严格所有者检查，无 IDOR |
| IDP 服务 | ✅ Create/Update/Delete 限 HOST，敏感字段脱敏 |
| Memo 核心授权 | ✅ CreateMemo/ListMemos/GetMemo/DeleteMemo 权限完整 |
| UpdateUser | ✅ UpdateMask 白名单，每字段独立权限检查，无批量赋值 |
| SetMemoAttachments | ✅ 创建者/管理员 + 附件所有者双重验证 |

---

## Round 3: 最终深度审计新发现 (3 个漏洞)

### Medium 漏洞

#### VULN-28: SignIn 时序侧信道用户枚举
- **文件**: `server/router/api/v1/auth_service.go:79-84`
- **问题**: 用户不存在时跳过 bcrypt 直接返回(~1ms)，用户存在时执行 bcrypt(~100ms)，响应时间差异可枚举用户名
- **修复**: 用户不存在时执行 dummy bcrypt 比较消除时序差异

#### VULN-29: UpdateUserWebhook 无 UpdateMask 时 SSRF 绕过
- **文件**: `server/router/api/v1/user_service.go:865-871`
- **问题**: VULN-15 修复不完整，UpdateMask 为 nil 时的分支未调用 `validateWebhookURL`
- **修复**: else 分支添加相同的 URL 验证

#### VULN-30: PHP/脚本文件上传未拦截
- **文件**: `server/router/api/v1/attachment_service.go:505-518 + 558-575`
- **问题**: `isDangerousMimeType` 缺少 PHP/Python/Perl/Ruby/HTA 等 MIME 类型；`validateFilename` 未检查危险文件扩展名
- **修复**: 1) 添加 13 个遗漏的危险 MIME 类型  2) 添加 25 个危险扩展名黑名单

---

## Round 3 验证结果 (12/12 通过)

```
[PASS] PHP扩展名拒绝 (400)
[PASS] PHP MIME拒绝 (400)
[PASS] SH扩展名拒绝 (400)
[PASS] PNG上传允许 (200)
[PASS] TRACE拒绝
[PASS] CORS安全
[PASS] X-Content-Type-Options
[PASS] X-Frame-Options
[PASS] Referrer-Policy
[PASS] Permissions-Policy
[PASS] BASIC需认证
[PASS] JWT伪造拒绝
```

## Round 3 修改文件

| 文件 | 修改类型 |
|------|---------|
| `server/router/api/v1/auth_service.go` | 时序侧信道防护 |
| `server/router/api/v1/user_service.go` | Webhook SSRF 完整修复 |
| `server/router/api/v1/attachment_service.go` | 危险 MIME + 扩展名黑名单 |
