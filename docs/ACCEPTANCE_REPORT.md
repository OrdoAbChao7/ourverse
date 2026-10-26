# OURVERSE 验收报告

日期：2026-10-26
工作目录：`E:\Projects\OURVERSE`
结论：**本地版本完成，线上能力待账号 / 授权**。没有部署、没有创建云资源、没有上传私人内容、没有调用收费模型。

本报告只列出实际执行过的命令与结果。关键日志与截图随仓库保留在 `artifacts/`；完整截图、离线 ZIP、本地 dump 与 Playwright 报告保留在工作区（部分由 `.gitignore` 排除），均可用本报告的命令复现。

---

## 1. 最终门禁（本轮重跑）

| 命令 | 时间（+08:00） | 退出码 | 结果 |
| --- | --- | --- | --- |
| `npm run verify`（typecheck + lint + 124 单测 + build） | 11:50 | **0** | `Test Files 11 passed | 1 skipped`；`Tests 124 passed | 12 skipped`；`built in 2.49s` |
| `npm run test:e2e` | 11:52 | **0** | **29 passed / 1 skipped**（30 个用例） |
| `npx supabase db reset` | 11:47 | **0** | 4 个迁移全部应用；`Finished supabase db reset` |
| `npx supabase test db` | 11:47 | **0** | **87/87 PASS**；`All tests successful.` |
| Supabase 集成测试（`vitest run tests/supabase/…`） | 11:49 | **0** | **12/12 passed** |
| 真实 Supabase UI E2E（`e2e/supabase-local.spec.ts`） | 11:49 | **0** | **1/1 passed** |
| `node scripts/verify-export.mjs … --strict`（目录 + ZIP） | 11:52 | **0** | **23 个文件通过**，0 缺失 / 0 不匹配 / 0 额外 |

证据：`artifacts/verify.log`、`artifacts/e2e.log`、`artifacts/db-reset.log`、`artifacts/pgtap.log`、`artifacts/supabase-integration.log`、`artifacts/supabase-ui-e2e.log`、`artifacts/export-verify.log`。

> 说明：关键日志（`verify` / `e2e` / `pgtap` / `supabase-integration` / `supabase-ui-e2e` / `export-verify` / `db-reset`）与关键截图已随仓库保留；完整截图集、离线 ZIP、本地数据库 dump 与 Playwright HTML 报告保留在工作区，可由本报告的命令重新生成。

---

## 2. S0 — 仓库审计、骨架、设计契约

| 验收项 | 状态 | 证据 |
| --- | --- | --- |
| React + TS strict + Vite 初始化，依赖锁定 | **PASS** | `package.json`、`package-lock.json`、`tsconfig.json`（`strict`、`noUncheckedIndexedAccess`、`verbatimModuleSyntax`） |
| `npm install` 成功 | **PASS** | 413 packages；esbuild 安装脚本经 `npm approve-scripts` 批准（记录于 `docs/PROGRESS.md`） |
| `typecheck / lint / test / build` 零退出码 | **PASS** | `npm run verify` exit 0（2026-10-26 11:50） |
| 路由外壳与 404 | **PASS** | `src/app/router.tsx`；`e2e/auth.spec.ts`「unknown routes show a 404 page」 |
| 设计 token | **PASS** | `src/styles/globals.css`：`#08111F`、`#101B35`、`#B9A1E8`、`#F0D49C`、`#82C5CF` 等 |
| `.env.example` 与密钥边界 | **PASS** | 仅 `VITE_*` 公开值；service_role / 模型密钥无前端入口 |
| 375px / 1440px 截图 | **PASS** | `artifacts/screenshots/evidence-*-1440.png`、`evidence-*-mobile.png` |
| 无生产密钥 / 无真人资料 | **PASS** | 演示内容全部虚构；密钥扫描见 §9 |
| DEMO 标识 | **PASS** | 登录、首页、设置、onboarding 均以 `repo.isDemo` 控制 |
| `docs/architecture.md` | **PASS** | 本次交付新增 |

**S0：PASS**

---

## 3. S1 — 双人身份、隐私与记忆 CRUD

### 3.1 真实后端

| 验收项 | 状态 | 证据 |
| --- | --- | --- |
| A 创建空间 → B 接受一次性邀请 → 双方读写 | **PASS** | `e2e/supabase-local.spec.ts` 1/1（真实 Docker Supabase + 真实 Vite 前端） |
| B 看不到 A 私密（列表、详情、URL） | **PASS** | 同上；集成测试「enforces memory visibility for a co-member」「refuses cross-author updates and deletes」 |
| C / 匿名不可访问 | **PASS** | pgTAP：C 非成员、anon 无表权限；集成测试「blocks anonymous tables and outsider writes through raw supabase-js」 |
| B 不能编辑/删除 A 的记录 | **PASS** | 集成测试「refuses cross-author updates and deletes」；pgTAP 权限断言 |
| 邀请过期 / 重复 / 第三人拒绝 | **PASS** | pgTAP 邀请断言；集成测试「reports a consumed invite as invalid」；UI E2E 第三账号被拒 |
| ≥20 条 CRUD/权限测试，≥8 条失败/越权 | **PASS** | `tests/data/local-repository.test.ts` 24 条（含越权、匿名、失效邀请、非法上传）；`tests/supabase` 12 条；pgTAP 87 条 |
| 5MB 图片上传 / 显示 / 删除 | **PASS** | 集成测试「uploads, serves and deletes a 5MB image through private storage」；存储策略与 path 触发器 |
| 非法 MIME / 超限拒绝 | **PASS** | `tests/domain/uploads.test.ts`（MIME、魔数、大小、数量）；E2E 上传选择器拒绝 |
| 真实 RLS 验证 | **PASS** | `npx supabase test db` 87/87；`docs/supabase-evidence.md` |
| 云端项目 | **BLOCKED_EXTERNAL** | 未创建；需要用户账号与授权 |

### 3.2 权限规则

- 私密记录仅作者；共同记录两名成员；附件继承记忆；非成员 / 匿名零访问；软删除对所有读取路径立即生效。
- 执行规范：`src/domain/permissions.ts`；本地实现 `src/data/local/local-repository.ts`；SQL 实现 `supabase/migrations/20261026090100_helpers_rls_storage.sql`。
- 负向测试覆盖：列表、详情、搜索、附件、纪念日、胶囊、导出、AI 检索、匿名、第三方。

**S1：PASS（本地真实后端）；云端 BLOCKED_EXTERNAL**

---

## 4. S2 — 星空、时间线、纪念日、时间胶囊

| 验收项 | 状态 | 证据 |
| --- | --- | --- |
| 12 条可见样本按日期排序 | **PASS** | 种子 13 条，每位成员可见 12；`e2e/auth.spec.ts` 首页计数 12；时间线 E2E |
| 每个星点可定位真实记忆，无装饰假星 | **PASS** | `src/domain/stars.ts`「maps every memory to exactly one real star」；`e2e/memory.spec.ts` 星空联动 |
| 首页 → 星空 → 记录 → 时间线（桌面/手机） | **PASS** | `e2e/mobile.spec.ts`、`e2e/responsive.spec.ts`、`e2e/memory.spec.ts` |
| 修改/删除后时间线与星空一致 | **PASS** | `e2e/memory.spec.ts`「edits and deletes a memory, keeping timeline and stars consistent」 |
| 胶囊到期前正文被服务端拒绝 | **PASS** | pgTAP：开启前对 B **和作者 A** 均不可读；集成测试「keeps capsule bodies sealed until the authoritative open time」 |
| 调快本机时间不能提前解锁 | **PASS** | 单调时钟单测；`e2e/capsule.spec.ts`「even if the device clock jumps forward」 |
| `prefers-reduced-motion` 无持续动画 | **PASS** | `e2e/responsive.spec.ts`「stops the continuous star animation」；`evidence-stars-reduced-motion-1440.png` |
| 至少 5 条 E2E + 双端截图 | **PASS** | capsule、memory、responsive、mobile、anniversary 等；截图在 `artifacts/screenshots/` |
| 纪念日自定义倒计时 | **PASS** | `e2e/anniversary.spec.ts`；`src/domain/anniversaries.test.ts` |

**S2：PASS**

---

## 5. S3 — 真正离线的数字博物馆

| 验收项 | 状态 | 证据 |
| --- | --- | --- |
| 12 条记录、≥6 件媒体 | **PASS** | `e2e/export.spec.ts` 断言 12 条 / 6 附件；`meta.json` 计数 |
| 全新目录解压 + 完全断网 + `file://` 打开 | **PASS** | E2E `browser.newContext({ offline: true })` + `pathToFileURL(index.html)`；时间线、搜索、灯箱可用 |
| 图片 / 音频 / 视频真实加载 | **PASS** | `naturalWidth > 0`；`duration > 1`；`videoWidth = 1280` |
| 无远程资源 / 密钥 / 签名 URL | **PASS** | 运行时远程请求数组为空；`--strict` 扫描无远程引用、无 `fetch(`、无模块脚本 |
| 全部哈希一致 | **PASS** | 目录与 ZIP 各 23 个文件通过；`SHA256SUMS.txt` 覆盖除自身外全部文件 |
| 篡改一个文件后校验失败 | **PASS** | E2E 篡改 Markdown 后验证脚本 exit 1 |
| 导出权限：不包含对方私密 | **PASS** | `tests/domain/export-scope.test.ts`（all / shared / mine / outsider / anonymous）；导出前再次按权限过滤 |
| 恢复指南 | **PASS** | `README.txt`、`docs/backup-and-restore.md` |
| ZIP 流式写入与降级 | **PASS** | `save-file.ts`：File System Access API → Blob；300 MB 内存上限 |
| 媒体编解码限制记录 | **PASS** | WebM / MP3 / JPEG / PNG / WebP 在本机 Chrome 实测可播放；README 提示浏览器差异 |

**S3：PASS**

---

## 6. S4 — 记忆检索助手

### 6.1 20 题测试集

`tests/domain/ask.test.ts` 中的 `describe('20-question retrieval suite')`：

- **8 道可答题**：6 道具体问题 +「计数」+「显式月份」，全部返回可定位的 source ID；
- **6 道无证据题**：固定拒绝，不出现具体日期或事件；
- **6 道隔离题**：B 不能检索 A 的私密关键词/标题，计数与「最近」不越界，A 自己的私密仍可见（方向性隔离）。

| 验收项 | 状态 | 证据 |
| --- | --- | --- |
| 20 题全部通过 | **PASS** | `npm test` 的 ask 套件 |
| 答案带 `[n]` 引用与来源卡 | **PASS** | `e2e/ask.spec.ts`「answers from records with a clickable citation」 |
| 无证据不编造 | **PASS** | 6 题套件 + E2E「refuses to invent an answer」 |
| 权限隔离 | **PASS** | 6 题套件 + 隔离 E2E + 集成测试 |
| fake model 拒绝越界引用 / 无引用 / 超时 | **PASS** | `tests/domain/ask.test.ts` model adapter safety |
| 模型不写回记忆 | **PASS** | `runModel` 只返回字符串，无仓库写入；`model.ts` |
| 禁用模型时检索页可用 | **PASS** | 默认关闭；E2E「AI stays disabled by default and explains exactly what enabling sends」 |
| 服务端保管密钥、不记录敏感正文 | **PASS** | `supabase/functions/ai-ask/index.ts`；`docs/supabase-evidence.md` §5 |
| 真实提供商质量 | **BLOCKED_NO_PROVIDER_KEY** | 未配置密钥，未发起外部调用 |
| 托管 CORS 预检 | **NOT_RUN_BY_DESIGN** | 本地 Kong 固定 `*`；函数自身拒绝非法 Origin |

**S4：PASS（检索模式与安全边界）；模型质量 BLOCKED**

---

## 7. S5 — 发布候选与交付

| 验收项 | 状态 | 证据 |
| --- | --- | --- |
| `npm run verify` 全绿 | **PASS** | exit 0；124 passed |
| 核心 E2E 全绿 | **PASS** | 29 passed / 1 conditional skip |
| 桌面 + 移动截图，无横向滚动 | **PASS** | `artifacts/screenshots/`；`e2e/responsive.spec.ts`、`e2e/mobile.spec.ts` 的溢出断言 |
| 无重大控制台错误 | **PASS** | E2E 页面错误监听；离线包 `pageErrors` 为空；截图脚本记录 console error |
| 验收报告（本文件） | **PASS** | S0–S5 矩阵 + 命令 + 证据 |
| README 可从新机器启动 demo | **PASS** | `README.md` §2；Node 20.19+ |
| 隐私说明 | **PASS** | `docs/privacy.md` |
| 备份与恢复说明 | **PASS** | `docs/backup-and-restore.md`（本地 dump 命令已实测 exit 0） |
| 无硬编码密钥 / 私人资料 | **PASS** | 见 §9 扫描 |
| 公开部署 | **NOT_DEPLOYED_BY_DESIGN** | 未授权；无远程仓库；`dist/` 可部署 |
| 公网链接 | **N/A_BY_DESIGN** | 不以没有公网链接判失败 |

**S5：PASS（本地交付）；部署 NOT_DEPLOYED_BY_DESIGN**

---

## 8. 测试与证据明细

### 8.1 自动化测试

| 套件 | 文件数 | 用例数 | 结果 |
| --- | --- | --- | --- |
| 领域 / 单元 / 本地仓库 / 导出 / 组件 | 11 | 124 | **PASS** |
| Supabase 真实集成 | 1 | 12 | **PASS**（需本地 Supabase） |
| Playwright E2E（desktop + mobile） | 11 个 spec | 30 | **29 PASS / 1 条件跳过** |
| pgTAP（真实 Postgres） | 1 | 87 断言 | **PASS** |
| axe-core WCAG 2.1 A/AA | 2 条 E2E | 核心页面 + 登录/弹窗 | **0 violations** |

默认 `npm test` 时，12 个 Supabase 用例因缺少 `SUPABASE_LOCAL_URL` / `ANON_KEY` 而跳过；这不是失败。真实运行命令见 `README.md` §6。

### 8.2 视觉与性能

- 截图：`artifacts/screenshots/`，包含 1440px、375px、离线包、真实 Supabase、reduced-motion。
- Lighthouse（登录页，`http://localhost:4173/login`，2026-10-26T02:52Z）：
  - Performance **94**
  - Accessibility **100**
  - 本次只运行了这两个 category；不宣称 Best Practices / SEO 分数。
- 主要页面无横向溢出、无控制台错误；移动端底部导航与触控流程通过。

### 8.3 离线包实测

```
结果：23 个文件通过，0 个缺失，0 个哈希不匹配，0 个额外文件。
严格模式：未发现远程引用或模块脚本。
校验通过：哈希全部一致。
```

目录与 ZIP 均通过；E2E 还验证了篡改检测、断网加载、媒体解码与交互。

### 8.4 Supabase 实测

- `npx supabase test db`：**87/87 PASS**（2026-10-26 11:47）。
- 集成测试：**12/12 PASS**（11:49）。
- UI E2E：**1/1 PASS**（11:49）。
- 覆盖：A/B/C 三人、邀请一次性、空间容量、私密隔离、跨作者更新拒绝、软删除、5MB 上传、胶囊服务端锁、AI 偏好隔离、成员移除即时失效、匿名无权限、存储路径绑定。
- 本地 Kong 的 CORS `*` 与云端未验证项已如实标注。

---

## 9. 安全与保密检查

| 检查 | 结果 |
| --- | --- |
| 前端环境变量仅公开值 | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `VITE_AI_PROXY_ENABLED` |
| service_role key 是否出现在 `src/` | 未出现 |
| 模型密钥是否出现在仓库 | 未出现；示例只有占位符 |
| `.env` / `.env.local` 是否被跟踪 | 未跟踪；`.gitignore` 排除 |
| 演示数据是否虚构 | 是；13 条记忆、3 个身份均为虚构 |
| 第三方请求 | 演示模式无；真实模式仅配置的 Supabase；无分析/广告/CDN/在线字体 |
| 导出包是否含令牌/签名 URL | 否；`--strict` 与运行时远程请求检查均通过 |
| 日志是否记录正文 | `ai-ask` 明确不记录请求/来源正文；E2E 日志只含断言输出 |

> 说明：仓库中仍有一个未使用的 `date-fns` 依赖（源码未导入）。它不包含密钥，也不影响运行；与 ADR-004 的「不引入日期库」不一致，已在 `docs/ISSUES.md` 记为 LIM-06，未擅自移除外部改动。

---

## 10. 未完成 / BLOCKED 汇总

| 项 | 状态 | 说明 / 下一步 |
| --- | --- | --- |
| 云端 Supabase 项目 | **BLOCKED_EXTERNAL** | 需要用户账号、项目创建与费用授权；步骤见 `docs/supabase-setup.md` §8 |
| 真实邮件（验证 / 邀请） | **BLOCKED_EXTERNAL** | 需要邮件服务、域名与 SMTP 配置；本地使用 Mailpit |
| Cloudflare Pages 部署 | **NOT_DEPLOYED_BY_DESIGN** | 未授权；`dist/` 为静态产物 |
| 真实 LLM 调用 | **BLOCKED_NO_PROVIDER_KEY** | 需要服务端 `AI_PROVIDER` / `AI_API_KEY`；检索模式不依赖 |
| 托管 CORS 预检 | **NOT_RUN_BY_DESIGN** | 本地 Kong 固定 `*`；需真实 Origin 复测 |
| 云备份 / PITR / 恢复演练 | **OPERATOR_ACTION** | 需要云项目与运维窗口；本地 dump 命令已验证 |
| 自动化 Storage 备份 | **NOT_IMPLEMENTED** | 需要官方 S3 / Dashboard / 运维脚本 |
| 离线包一键导入 | **NOT_IMPLEMENTED** | 离线包是可读副本；按 JSON / Markdown 迁移 |
| 本机 Docker 偶发退出 | **ENV_RISK** | 重跑 Supabase 前确认 `docker info` |
| `04_CLAUDE_CODE_GOAL.md` | **MISSING_SOURCE** | 原始资料中不存在；按 PRD + 验收 + 主提示词执行 |

---

## 11. Definition of Done 对照

| 条目 | 状态 |
| --- | --- |
| 代码可从干净检出安装并启动，关键页面可操作 | **PASS**（本机 `npm install` + `npm run dev`；锁文件存在） |
| 双人邀请、权限、CRUD、私有媒体在真实后端正/负例通过 | **PASS**（本地真实 Supabase 12/12 + 87/87 + UI E2E 1/1）；云端 BLOCKED |
| 星空、时间线与同一数据源连接；纪念日、胶囊有效 | **PASS** |
| 离线 ZIP 脱机打开，完整性校验 | **PASS** |
| AI 给来源、不编造、不泄漏 | **PASS**（检索）；真实模型 BLOCKED |
| 测试、构建、核心 E2E、截图、验收报告齐全 | **PASS** |
| 无账号/人工验收项标记 BLOCKED | **PASS** |

---

## 12. 复现入口

```powershell
cd E:\Projects\OURVERSE
npm install
npm run verify
npm run test:e2e
```

真实后端：

```powershell
npx supabase start
npx supabase db reset
npx supabase test db
# 然后按 README §6 运行集成测试与 UI E2E
```

---

## 13. 最终结论

**本地 GOAL 已完成**：产品可运行、数据真实持久化、双人隔离在本地与真实 Postgres 双侧验证、离线包真实断网可打开、AI 有引用且在无证据时拒绝、全部本地门禁通过。

**线上能力未完成且未伪装完成**：云 Supabase、邮件、部署、模型密钥与托管 CORS 均等待用户授权或运维配置。当前状态应描述为「本地版本已完成，线上能力待账号 / 授权」，而不是「已上线」。
