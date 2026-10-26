# OURVERSE · 双人星球

一个只属于两个人的私人数字记忆世界：星空首页、时间线、数字博物馆、时间胶囊、双人隔离、可选 AI 记忆助手，以及断网也能打开的离线博物馆导出。

- **默认演示模式**：不需要账号、不需要网络、不需要任何密钥。数据写入本机 IndexedDB，界面明确标注 `DEMO`。
- **真实后端已实现**：Supabase Auth / Postgres / RLS / Storage / Edge Function，代码与迁移均在仓库中，并已用本地 Docker Supabase 真实验证。
- **未部署**：本仓库没有创建任何云项目、没有上传任何私人内容、没有推送远程仓库。

> 视觉基线：Midnight Observatory（`#08111F` / `#101B35` / `#B9A1E8` / `#F0D49C` / `#82C5CF`），支持 375px 与 1440px、键盘操作与 `prefers-reduced-motion`。

---

## 1. 已实现的系统

| 系统 | 实现 | 关键位置 |
| --- | --- | --- |
| A 星空首页 / 纪念日倒计时 | 每一条记忆映射为一颗真实的星；按月组成星座；用户自定义纪念日倒计时；首页速记 | `src/features/home/HomePage.tsx`、`src/features/stars/StarsPage.tsx`、`src/domain/stars.ts`、`src/domain/anniversaries.ts` |
| B 时间线 | 新建 / 编辑 / 软删除、搜索、标签、地点、按年分组、私密 / 共同可见 | `src/features/timeline/TimelinePage.tsx`、`src/features/memories/*`、`src/domain/search.ts` |
| C 数字博物馆 | 图片 / 音频 / 视频 / 文字展品、灯箱、下载、权限继承 | `src/features/gallery/GalleryPage.tsx`、`src/features/media/*`、`src/domain/uploads.ts` |
| D 时间胶囊 | 未来开启日期、密封正文、开启前对**所有人**不可读；真实后端由数据库时钟强制 | `src/features/capsules/CapsulesPage.tsx`、`src/data/local/clock.ts`、`supabase/migrations/*` |
| E 双人认证与隔离 | 邀请制、最多两人、一次性邀请、私密 / 共同可见、软删除、成员移除即时失效 | `src/domain/permissions.ts`、`src/data/local/local-repository.ts`、`src/data/supabase/supabase-repository.ts`、`supabase/migrations/*` |
| F 记忆助手 | 检索优先、逐条引用、无证据时明确拒绝；模型默认关闭，只能经服务端代理启用 | `src/features/ask/*`、`src/domain/ask/*`、`supabase/functions/ai-ask/*` |
| G 离线博物馆 | 固定 ZIP 布局、自包含 `index.html`、相对路径媒体、SHA-256 清单、流式写入 | `src/features/export/*`、`scripts/verify-export.mjs` |

**演示数据**：3 个虚构身份（林雾、江照、演示访客）、13 条虚构记忆（每位成员可见 12 条）、6 个媒体文件、3 个纪念日、3 个时间胶囊。全部为虚构内容，不含真人资料。

---

## 2. 快速开始（演示模式，推荐先跑这个）

要求：Node.js **20.19+**（本仓库用 24.19 验证），npm 10+。

```powershell
cd E:\Projects\OURVERSE
npm install
npm run dev
```

打开 `http://localhost:5173`。不设置任何环境变量时：

1. 以「林雾」或「江照」进入演示空间；
2. 同一浏览器开两个标签页，分别用两个身份登录，可观察真实的双人隔离；
3. 页面中的 `DEMO` 徽标表示当前不是真实云端数据；
4. 演示数据全部保存在本机 IndexedDB，不会上传。

> 演示模式使用 `sessionStorage` 保存当前标签页的身份，因此新标签页需要重新选择身份；这正是为了在同一浏览器中并排演示 A / B 两人。

生产构建：

```powershell
npm run build
npm run preview   # http://localhost:4173
```

---

## 3. 真实 Supabase 后端

### 3.1 本地 Supabase（已实际验证）

前置：Docker Desktop 以 Linux containers 运行。

```powershell
npx supabase start
npx supabase db reset          # 应用全部迁移（会重建本地数据库）
npx supabase test db           # RLS / 胶囊 / 邀请 / 存储的 pgTAP 套件
npx supabase status -o env     # 获取本地 URL 与 anon key
```

配置前端（只写公开的 anon key，绝不写 service_role key）：

```dotenv
# .env.local
VITE_BACKEND=supabase
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<local anon key>
VITE_AI_PROXY_ENABLED=false
```

```powershell
npm run dev
```

真实后端行为：

- 注册 / 登录使用 Supabase Auth；
- 空间、邀请、成员、记忆、附件、胶囊、AI 偏好全部经过 RLS；
- 附件存放在私有 `memories` bucket，路径为 `<space_id>/<memory_id>/<file_name>`，读取使用短期签名 URL，并在每次复用时重新鉴权；
- 时间胶囊以数据库 `now()` 为准，客户端无法修改 `opens_at`，开启前正文对作者本人也不可见；
- 邀请令牌只保存 SHA-256 哈希，明文仅返回一次。

完整操作、RPC 签名、部署前检查清单见 [`docs/supabase-setup.md`](docs/supabase-setup.md)；实际执行过的命令与结果见 [`docs/supabase-evidence.md`](docs/supabase-evidence.md)。

### 3.2 云端 Supabase（未执行，BLOCKED_EXTERNAL）

创建云项目、配置自定义域名、真实邮件发送、部署 Edge Function 都需要用户自己的账号、费用授权与数据使用授权。本仓库**没有**执行这些操作。操作步骤已写在 `docs/supabase-setup.md` 第 8 节，等待授权。

---

## 4. AI 记忆助手

默认是**纯检索模式**，不调用任何外部模型：

- 只检索当前查看者有权看到的记忆；
- 计数、最早、最近、关键词、日期问题由确定性规则回答；
- 每个事实段落带可点击的 `[n]` 来源；
- 没有证据时回答「暂无足够证据」，不会编造日期或事件；
- 模型开关默认关闭；开启前界面明确说明会发送什么。

模型增强路径：`supabase/functions/ai-ask`（Deno Edge Function）。密钥只存在服务端，浏览器永远拿不到；模型输出必须通过引用校验（编号存在、ID 属于本次检索集合），否则整段拒绝并回退检索答案。

真实模型调用：**BLOCKED_NO_PROVIDER_KEY**。没有配置任何提供商密钥，因此没有发生外部 AI 请求。函数本身已在本地 Edge Runtime 完成鉴权、无来源拒绝、越权来源剔除、无密钥 503、非法 Origin 403 的冒烟验证。

---

## 5. 离线数字博物馆

在「设置 → 离线数据博物馆」中选择导出范围并生成 ZIP：

- `全部`：共同记录 + 自己的私密记录；
- `共同`：只导出共同记录；
- `我的`：自己的共同与私密记录。

ZIP 固定包含：

```text
index.html          # 自包含：内联数据/CSS/原生 JS，无 fetch、无模块、无 CDN
assets/             # 原始媒体，按 0001-... 命名，不转码
memories.json       # 结构化记忆与附件索引
memories/*.md       # 每条记忆一个 Markdown 文件（含 frontmatter）
meta.json           # 空间、成员、纪念日、计数
manifest.json       # 文件清单与哈希
SHA256SUMS.txt      # sha256sum 兼容校验
README.txt          # 打开、校验、迁移、长期保存说明
```

验证：

```powershell
node scripts/verify-export.mjs artifacts/exports/e2e-extracted --strict
node scripts/verify-export.mjs artifacts/exports/e2e-museum.zip --strict
```

`--strict` 会额外拒绝远程引用、`fetch(`、模块脚本与外部 `<script src>`。实测 23 个文件全部通过，0 缺失 / 0 哈希不匹配 / 0 额外文件。

断网 E2E 已真实验证：浏览器 `offline: true` 下通过 `file://` 打开，12 条记忆、图片 `naturalWidth > 0`、音频 `duration > 1`、视频 `videoWidth = 1280`，时间线搜索与灯箱可用，远程请求为 0，页面错误为 0。

> 导出的 ZIP 默认**不加密**。任何拿到文件的人都能读取。请只放在可信设备，不要上传公开网盘或代码仓库。

---

## 6. 测试与验收

| 层级 | 命令 | 当前结果（2026-10-26） |
| --- | --- | --- |
| 类型检查 | `npm run typecheck` | 0 errors |
| Lint | `npm run lint` | 0 errors / 0 warnings |
| 单元 + 领域 + 仓库 | `npm test` | **124 passed**（11 个文件），12 个 Supabase 集成用例按条件跳过 |
| 生产构建 | `npm run build` | 成功（`dist/`） |
| 一键验证 | `npm run verify` | **exit 0** |
| 浏览器 E2E（演示） | `npm run test:e2e` | **29 passed / 1 skipped**（30 个用例，跳过的是需真实后端的用例） |
| 真实 Supabase 集成 | 见下文 | **12 passed** |
| 真实 Supabase UI E2E | 见下文 | **1 passed** |
| 真实 Postgres RLS | `npx supabase test db` | **87/87 PASS** |
| 离线包校验 | `node scripts/verify-export.mjs … --strict` | **PASS**（目录与 ZIP） |
| 可访问性 | `npx playwright test e2e/a11y.spec.ts` | axe WCAG 2.1 A/AA，0 violations |
| Lighthouse（登录页） | `artifacts/lighthouse/login.json` | Performance **94** / Accessibility **100** |

真实 Supabase 集成测试：

```powershell
eval "$(npx supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=' \
  | sed 's/^API_URL=/SUPABASE_LOCAL_URL=/; s/^ANON_KEY=/SUPABASE_LOCAL_ANON_KEY=/; s/^SERVICE_ROLE_KEY=/SUPABASE_LOCAL_SERVICE_ROLE_KEY=/')"
export SUPABASE_LOCAL_URL SUPABASE_LOCAL_ANON_KEY SUPABASE_LOCAL_SERVICE_ROLE_KEY
npx vitest run tests/supabase/repository.integration.test.ts
```

真实 Supabase UI E2E：

```powershell
# 终端 1：用真实后端启动开发服务器（不要把密钥写进仓库）
$env:VITE_BACKEND='supabase'
$env:VITE_SUPABASE_URL='http://127.0.0.1:54321'
$env:VITE_SUPABASE_ANON_KEY='<local anon key>'
npx vite --port 5174 --strictPort

# 终端 2
$env:E2E_SUPABASE_APP_URL='http://localhost:5174'
npx playwright test e2e/supabase-local.spec.ts --project=desktop
```

证据文件都在 `artifacts/`：

- `verify.log`、`e2e.log`、`pgtap.log`、`supabase-integration.log`、`supabase-ui-e2e.log`；
- `export-verify.log`、`exports/`（真实 ZIP 与解压目录）；
- `screenshots/`（1440 / 375 / 离线包 / 真实 Supabase）；
- `lighthouse/login.json`；
- `playwright-report/`、`test-results/`。

---

## 7. 隐私与安全（摘要）

- 私人记录默认只有作者可见；共同记录只有当前空间的两名成员可见；第三方与匿名用户看不到任何内容。
- 分享可见性只能由作者切换；另一位成员不能编辑或删除作者的内容。
- 删除是软删除：列表、详情、附件、检索、导出立即不可见；真实后端保留行以支持审计，不执行不可逆删除。
- 附件只能属于创建它的记忆；真实后端用路径触发器、RLS 与私有 bucket 三重约束。
- 时间胶囊的正文在开启前对所有人不可读；真实后端由数据库时间与 RLS 强制。
- 前端只使用 anon key；service_role key 与服务端模型密钥从不进入浏览器或仓库。
- 演示模式不发起任何网络请求；真实模式只请求配置的 Supabase 项目。
- 导出包默认不加密，这是已知且明确告知的风险。

完整说明见 [`docs/privacy.md`](docs/privacy.md)。备份与恢复见 [`docs/backup-and-restore.md`](docs/backup-and-restore.md)。

---

## 8. 项目结构

```text
src/
  app/                 应用壳、路由守卫、认证/仓库上下文、星空背景
  domain/              与存储无关的规则：权限、搜索、星空、日期、上传、胶囊、AI、导出范围
  data/
    repository.ts      唯一数据边界
    local/             IndexedDB 演示后端 + 确定性种子 + 单调时钟
    supabase/          真实后端（Auth / RLS / Storage / RPC）
  features/            页面与业务交互（home, timeline, gallery, capsules, ask, settings, export…）
  components/          自建 UI 原语（Button / Field / Dialog / Toast…）
  lib/                 日期、文本、Markdown、哈希、样式工具
  styles/globals.css   Midnight Observatory 设计 token
supabase/
  migrations/          版本化 schema、RLS、Storage、RPC、server_now
  tests/               pgTAP（87 条断言）
  functions/ai-ask/    服务端模型代理
tests/                 Vitest：领域 / 本地仓库 / 导出 / Supabase 集成
e2e/                   Playwright：认证、隔离、CRUD、胶囊、AI、导出、离线、响应式、a11y
scripts/               离线包校验、演示媒体生成、截图 QA
docs/                  产品文档副本、架构、隐私、备份、进度、决策、问题、验收报告
artifacts/             实际命令输出与截图（不作为产品代码）
```

---

## 9. 文档索引

| 文档 | 内容 |
| --- | --- |
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | 分阶段进度、实际命令与结果、阻塞 |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | ADR-001…009：技术栈、双后端、设计系统、胶囊时钟、离线包、AI、RLS 验证 |
| [`docs/architecture.md`](docs/architecture.md) | 分层、数据流、双后端一致性、权限模型、AI 与导出管线 |
| [`docs/privacy.md`](docs/privacy.md) | 数据分类、可见性、AI 边界、删除与保留、导出风险 |
| [`docs/backup-and-restore.md`](docs/backup-and-restore.md) | 演示数据、Supabase、离线博物馆、恢复演练 |
| [`docs/ISSUES.md`](docs/ISSUES.md) | 实际缺陷、根因、修复与回归测试；外部阻塞 |
| [`docs/ACCEPTANCE_REPORT.md`](docs/ACCEPTANCE_REPORT.md) | S0–S5 验收矩阵、证据路径、未完成项 |
| [`docs/supabase-setup.md`](docs/supabase-setup.md) | Supabase 本地/云端操作与上线前清单 |
| [`docs/supabase-evidence.md`](docs/supabase-evidence.md) | 真实执行的 Supabase 命令输出 |

---

## 10. 未完成 / 外部阻塞（如实列出）

| 项 | 状态 | 原因 / 下一步 |
| --- | --- | --- |
| 云端 Supabase 项目创建与迁移 | **BLOCKED_EXTERNAL** | 需要用户自己的 Supabase 账号与授权；步骤见 `docs/supabase-setup.md` §8 |
| 真实邮件发送（注册验证 / 邀请邮件） | **BLOCKED_EXTERNAL** | 需要邮件服务与域名配置；本地使用 Mailpit |
| Cloudflare Pages 部署 | **NOT_DEPLOYED_BY_DESIGN** | 未获部署授权；产物为 `dist/` 静态文件，可部署 |
| 真实 LLM 提供商调用 | **BLOCKED_NO_PROVIDER_KEY** | 需要服务端 `AI_PROVIDER` / `AI_API_KEY`；纯检索模式不依赖 |
| 托管环境 CORS 预检 | **NOT_RUN_BY_DESIGN** | 本地 Kong 固定返回 `*`，不能作为生产 CORS 证据；需在真实 Origin 验证 |
| 云备份 / PITR | **OPERATOR_ACTION** | 需要云项目与计费授权 |
| 本机 Docker 稳定性 | **环境问题** | 本轮观察到 Docker Desktop 守护进程偶发退出；重跑 Supabase 测试前先确认 `docker info` |

---

## 11. 常见问题

**页面一直是启动动画？** 演示模式首次启动需要把内置媒体写入 IndexedDB；如果停留过久，打开 DevTools 查看错误，或在设置页重置演示数据。

**两个标签页身份互相影响？** 演示身份是 `sessionStorage`，按标签页隔离；刷新会保留，新标签页需重新选择。

**真实后端登录后仍看到 DEMO？** 只有 `VITE_BACKEND=supabase` 且 URL / anon key 都存在时才使用真实后端；缺一个会回退演示并提示。

**邀请链接打不开？** 邀请一次性有效，默认 72 小时；创建者可在设置中重新生成，旧链接立即失效。

**时间胶囊为什么现在还打不开？** 未到开启时间；演示模式用单调时钟，真实后端用数据库时间。把系统时间调快不会解锁演示胶囊，也无法绕过真实后端。

**导出按钮没有弹出「另存为」？** 浏览器不支持 File System Access API 时会回退为普通下载；超过 300 MB 的内存回退会被拒绝，建议使用 Chrome / Edge。

**Docker / Supabase 测试失败？** 先运行 `docker info`。守护进程未就绪时，`npx supabase test db` 会报 `ECONNREFUSED 127.0.0.1:54322`，这不是 RLS 失败。等 Docker 恢复后执行 `npx supabase db reset && npx supabase test db`。

---

## 12. 状态声明

本仓库在本地完成了可运行的产品、演示数据、真实后端实现与三层真实测试。**没有**部署到公网、**没有**创建云端资源、**没有**上传任何私人内容、**没有**配置或调用收费模型。所有外部动作都在等待用户明确授权。
