# OURVERSE — 开发进度

> 本文件按阶段记录：做了什么、实际执行过什么命令、结果、当前阻塞、下一步。
> 只写可核对的事实；未实际运行的检查不会标记为通过。

## 当前状态

- 日期：2026-10-26
- 本地阶段：**S0–S5 完成，本地验收通过**
- 线上演示：**已部署 GitHub Pages（demo 模式）** → <https://ordoabchao7.github.io/ourverse/>
- 真实云端：**BLOCKED_EXTERNAL**（未创建云 Supabase 项目、未配置邮件、未部署 Cloudflare Pages）
- 分支：`master`（本地 + GitHub `OrdoAbChao7/ourverse`）
- 云端 Supabase / 邮件 / 模型密钥：**BLOCKED_EXTERNAL / BLOCKED_NO_PROVIDER_KEY**

一句话结论：**本地版本已完成，线上能力待账号 / 授权。** 详见 `docs/ACCEPTANCE_REPORT.md`。

## 环境审计（实际执行）

| 项 | 结果 |
|---|---|
| Node / npm | v24.19.0 / 11.17.0 |
| git | 2.51.0.windows.1 |
| Docker | 29.7.2（Docker Desktop + WSL2；本轮偶发守护进程退出，见 ISSUE-20） |
| Supabase CLI | 2.122.0（`npx`） |
| 本地 Postgres | 17.11；API `127.0.0.1:54321`；DB `54322`；Studio `54323`；Mailpit `54324` |
| 浏览器 | 系统 Chrome + Playwright Chromium（desktop / Pixel 7 模拟） |
| npm registry | https://registry.npmmirror.com |
| 设计文档 | `Ourverse_GoalDriven/` 下 4 份；已复制到 `docs/`，原目录未改动 |
| 缺失文档 | `04_CLAUDE_CODE_GOAL.md` 不存在；以 PRD + 验收文档 + 主 Agent 提示词为准 |

## 阶段结果

| 阶段 | 状态 | 主要证据 |
| --- | --- | --- |
| S0 仓库审计 / 骨架 / 设计契约 | **PASS** | `npm run verify` exit 0；路由 404；1440/375 截图；DEMO 标识；`docs/architecture.md` |
| S1 双人身份 / 隐私 / CRUD | **PASS（本地真实后端）** | pgTAP 87/87；Supabase 集成 12/12；真实 UI E2E 1/1；5 MB 上传；越权负例 |
| S2 星空 / 时间线 / 纪念日 / 胶囊 | **PASS** | 每颗星映射真实记忆；修改/删除后一致；胶囊时钟；reduced-motion；≥5 条 E2E |
| S3 离线数字博物馆 | **PASS** | 12 条 / 6 媒体；断网 `file://`；23 文件哈希；篡改检测；媒体真实解码 |
| S4 记忆检索助手 | **PASS（检索与安全边界）** | 20 题套件（8 可答 / 6 无证据 / 6 隔离）；引用校验；模型默认关闭；真实模型 BLOCKED |
| S5 发布候选与交付 | **PASS（本地）** | `verify` + 29 E2E；截图；README / 隐私 / 备份 / 验收报告；无密钥；GitHub Pages demo 已部署 |

## 最终命令记录（2026-10-26）

| 时间（+08:00） | 命令 | 退出码 / 结果 |
| --- | --- | --- |
| 11:47 | `npx supabase db reset` | 0；4 个迁移应用成功 |
| 11:47 | `npx supabase test db` | 0；**87/87 PASS** |
| 11:49 | `npx vitest run tests/supabase/repository.integration.test.ts` | 0；**12/12 passed** |
| 11:49 | `E2E_SUPABASE_APP_URL=http://localhost:5174 npx playwright test e2e/supabase-local.spec.ts --project=desktop` | 0；**1/1 passed** |
| 11:50 | `npm run verify` | 0；typecheck / lint 0；**124 passed**；build 成功 |
| 11:52 | `npm run test:e2e` | 0；**29 passed / 1 conditional skip** |
| 11:52 | `node scripts/verify-export.mjs … --strict`（目录 + ZIP） | 0；**23 文件通过**；无远程引用 |
| 11:56 | `npx supabase db dump --db-url …`（schema / data-only） | 0；备份命令可用（未执行恢复） |
| 12:17 | `gh repo create ourverse --public … --push` | 0；远程 `OrdoAbChao7/ourverse`，分支 `master` |
| 12:18 | GitHub Actions `Deploy to GitHub Pages`（run 40268307156） | 0；build + deploy 均成功 |
| 12:20 | 线上检查（curl + Playwright） | `/ourverse/` 200；demo 登录、首页、`/app/timeline` 深链接可用；移动端 375px 回归通过 |
| 更早 | Lighthouse（登录页 preview） | Performance **94** / Accessibility **100**；仅这两个 category |

日志：`artifacts/verify.log`、`e2e.log`、`db-reset.log`、`pgtap.log`、`supabase-integration.log`、`supabase-ui-e2e.log`、`export-verify.log`。截图在 `artifacts/screenshots/`。

## 已实现（代码层面）

- [x] Vite + React 19 + TS strict + Tailwind v4 + Motion；Midnight Observatory token
- [x] 领域层：权限、搜索、日期、星空、上传校验、单调时钟、AI 检索/答案/模型校验、导出范围
- [x] 本地后端：IndexedDB schema、13 条虚构记忆（每位成员可见 12）、6 媒体、3 胶囊、3 纪念日
- [x] 真实后端：Supabase Auth、空间/邀请/成员 RPC、RLS、私有 Storage、胶囊服务端锁、`server_now()`
- [x] 单一 `Repository` 接口 + 两个后端；Supabase 客户端按需动态导入
- [x] 首页、时间线、记忆详情/编辑、星空、画廊、胶囊、AI、设置、onboarding、404
- [x] 离线博物馆：固定布局、自包含查看器、SHA-256、流式保存、校验脚本
- [x] AI Edge Function：JWT、RLS 重取、同意校验、引用校验、无密钥 503
- [x] Vitest（136 用例，含 12 集成）+ Playwright（30 用例）+ pgTAP（87）+ axe + Lighthouse

## 未完成 / 外部阻塞

| 项 | 状态 | 下一步 |
| --- | --- | --- |
| 云端 Supabase 项目 | **BLOCKED_EXTERNAL** | 用户授权的项目；按 `docs/supabase-setup.md` §8 执行 |
| 真实邮件 | **BLOCKED_EXTERNAL** | 邮件服务 + 域名 + SMTP |
| Cloudflare Pages 部署 | **NOT_DEPLOYED_BY_DESIGN** | 明确授权后才能部署；当前无远程 |
| 真实模型调用 | **BLOCKED_NO_PROVIDER_KEY** | 服务端 `AI_PROVIDER` / `AI_API_KEY` |
| 托管 CORS 验收 | **NOT_RUN_BY_DESIGN** | 部署后在真实 Origin 验证 |
| 云备份 / PITR / 恢复演练 | **OPERATOR_ACTION** | 云项目 + 运维窗口 |
| 自动化 Storage 备份 | **NOT_IMPLEMENTED** | 官方 S3 / Dashboard / 运维脚本 |
| 离线包一键导入 | **NOT_IMPLEMENTED** | 按 `memories.json` / Markdown 迁移 |
| 未使用的 `date-fns` | **OPEN / P3** | 源码未导入；与 ADR-004 不一致；待确认后删除 |
| Docker 偶发退出 | **ENV_RISK** | 重跑 Supabase 前确认 `docker info` |

## 下一步（需要用户 / 运维参与）

1. 确认是否保留或移除未使用的 `date-fns`。
2. 提供/授权一个预发布 Supabase 项目与邮件配置；按 `docs/supabase-setup.md` §8 上线前演练。
3. 决定是否授权 Cloudflare Pages 部署；当前产物在 `dist/`。
4. 如需 AI 增强，配置服务端提供商密钥与 `AI_ALLOWED_ORIGIN`，在真实 Origin 验证 CORS。
5. 配置并演练云备份 / PITR；导入真实使用前先做一次恢复测试。

## 验收入口

- 总报告：`docs/ACCEPTANCE_REPORT.md`
- 架构：`docs/architecture.md`
- 隐私：`docs/privacy.md`
- 备份：`docs/backup-and-restore.md`
- 问题与根因：`docs/ISSUES.md`
- Supabase 实测：`docs/supabase-evidence.md`
- 快速启动：`README.md`
