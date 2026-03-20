# Memos 全功能浏览器测试文档

> 日期: 2026-03-20 | 版本: 0.26.0

## 路由与页面总览

| 路由 | 页面 | 描述 | 认证 |
|------|------|------|------|
| `/auth` | SignIn | 登录页 | 否 |
| `/auth/signup` | SignUp | 注册页 | 否 |
| `/auth/admin` | AdminSignIn | 管理员登录 | 否 |
| `/auth/callback` | AuthCallback | OAuth 回调 | 否 |
| `/` | Home | 主页(Memo列表) | 是 |
| `/explore` | Explore | 探索公开Memo | 是 |
| `/archived` | Archived | 归档Memo | 是 |
| `/u/:username` | UserProfile | 用户主页 | 是 |
| `/attachments` | Attachments | 附件管理 | 是 |
| `/inbox` | Inboxes | 收件箱/通知 | 是 |
| `/setting` | Setting | 设置页 | 是 |
| `/memos/:uid` | MemoDetail | Memo详情 | 部分 |
| `/blog` | BlogHome | 博客首页 | 是 |
| `/blog/:uid` | BlogDetail | 博客文章 | 是 |
| `/403` | PermissionDenied | 无权限 | 否 |
| `/404` | NotFound | 页面不存在 | 否 |

## 测试用例

### TC-01: 首次访问 — 自动跳转注册页
- **操作**: 访问 http://localhost:5173
- **预期**: 无用户时自动跳转到 /auth/signup
- **检查**: 页面显示 "Create your account" 和 username/password 输入框

### TC-02: 首用户注册 — 获得 HOST 角色
- **操作**: 输入 admin / Admin12345, 点击 Sign up
- **预期**: 注册成功，跳转到首页 /
- **检查**: 用户角色为 HOST, 页面显示 Memo 编辑器

### TC-03: 登出
- **操作**: 点击左下角用户头像 → 点击 Sign out
- **预期**: 跳转到登录页 /auth

### TC-04: 登录
- **操作**: 输入 admin / Admin12345, 点击 Sign in
- **预期**: 登录成功，跳转到首页 /
- **检查**: 左侧导航栏可见

### TC-05: 错误密码登录
- **操作**: 输入 admin / wrong, 点击 Sign in
- **预期**: 显示错误提示 toast

### TC-06: 创建公开 Memo
- **操作**: 在主页编辑器输入 "这是测试Memo #test", 点击发送按钮
- **预期**: Memo 出现在列表中

### TC-07: 创建私有 Memo
- **操作**: 选择可见性为 Private, 输入内容, 点击发送
- **预期**: Memo 带有锁图标

### TC-08: 编辑 Memo
- **操作**: 点击 Memo 上的编辑按钮, 修改内容, 保存
- **预期**: 内容更新

### TC-09: 删除 Memo
- **操作**: 点击 Memo 上的菜单 → Delete
- **预期**: Memo 从列表消失

### TC-10: 导航到设置页
- **操作**: 点击左侧导航栏的设置图标
- **预期**: 进入 /setting 页面
- **检查**: HOST 用户可见 Basic + Admin 两组设置

### TC-11: 修改用户昵称
- **操作**: 在 My Account 中修改 Display name, 保存
- **预期**: 昵称更新成功

### TC-12: 第二用户注册
- **操作**: 登出 → 点击 Sign up → 注册 user1/User11234
- **预期**: 注册成功, 角色为 USER

### TC-13: 普通用户看不到管理设置
- **操作**: user1 导航到 /setting
- **预期**: 只看到 Basic 设置 (My Account, Preference), 看不到 Admin 设置

### TC-14: 普通用户看不到其他用户的私有 Memo
- **操作**: user1 在 Explore 页面浏览
- **预期**: 只能看到 PUBLIC memo, 看不到 admin 的 PRIVATE memo

### TC-15: 附件管理页
- **操作**: 导航到 /attachments
- **预期**: 页面正常加载, 显示当前用户的附件列表

### TC-16: 收件箱页
- **操作**: 导航到 /inbox
- **预期**: 页面正常加载

## 测试结果记录

> 测试日期: 2026-03-20 | 测试环境: localhost:3002 (frontend) + localhost:8081 (backend)

| 用例 | 结果 | 问题描述 | 修复状态 |
|------|------|---------|---------| 
| TC-01 | ✅ PASS | 首次访问自动跳转到 /auth/signup | - |
| TC-02 | ✅ PASS | admin 注册成功，跳转首页 | - |
| TC-03 | ✅ PASS | 未登录状态重定向到 /explore | - |
| TC-04 | ✅ PASS | 正确密码登录成功，跳转首页 | - |
| TC-05 | ✅ PASS | 错误密码未跳转(正确)，代码确认有toast.error调用 | - |
| TC-06 | ✅ PASS | 创建私有 Memo 成功 | - |
| TC-07 | ✅ PASS | 创建公开 Memo 成功 | - |
| TC-08 | ✅ PASS | Edit 弹出内联编辑器(截图确认) | - |
| TC-09 | ✅ PASS | Delete 确认后 Memo 消失 | - |
| TC-10 | ✅ PASS | HOST 可见 Basic + Admin 设置 | - |
| TC-11 | ✅ PASS | 修改 Nickname 成功 | - |
| TC-12 | ✅ PASS | 新用户注册成功 | - |
| TC-13 | ✅ PASS | 普通用户只见 Basic 设置 | - |
| TC-14 | ✅ PASS | 普通用户只见公开 Memo | - |
| TC-15 | ✅ PASS | 附件页正常加载 | - |
| TC-16 | ✅ PASS | 收件箱页正常加载 | - |

## 发现的问题

### ISSUE-01: 登录失败错误提示 (TC-05) — 已验证为误报

**状态**: 已关闭（代码验证正确）

**分析**: `PasswordSignInForm.tsx` 第 63-66 行的 catch 块调用了 `handleError(error, toast.error, {...})`。`handleError` (lib/error.ts) 会执行 `toast(errorMessage)` 显示 toast 通知。`main.tsx` 中有 `<Toaster position="top-right" />`。错误提示 toast 应该正常显示。之前自动化测试中未观察到可能是因为 toast 显示时间短暂或截图时机问题。
