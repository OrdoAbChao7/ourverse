# OURVERSE — 架构决策记录（ADR）

每条决策记录：背景 / 决策 / 理由 / 影响。

## ADR-001 技术栈：React 19 + TypeScript strict + Vite + Tailwind v4 + Motion

**背景**：PRD 推荐 Vite + React + TS + Tailwind + shadcn/ui + Motion。

**决策**：采用 React 19、TS strict、Vite 6、Tailwind CSS v4（CSS-first `@theme`）、Motion（按需使用）、React Router 7、Vitest、Playwright。

**理由**：与 PRD 推荐一致；Tailwind v4 的 token 能力更适合建立本项目的设计契约；Vite 产物是静态文件，兼容 Cloudflare Pages。

**影响**：不使用 Next.js / 服务端渲染。首屏依赖字体系统栈，无在线字体请求。

## ADR-002 双后端：Repository 接口 + local（demo）+ Supabase（真实）

**背景**：没有真实 Supabase 凭据时，仍必须交付可运行、可测试的产品，同时不能把 demo 冒充真实 RLS。

**决策**：
- `src/domain/*` 定义与数据库无关的规则；
- `src/data/repository.ts` 是唯一数据边界；
- `LocalRepository` 用 IndexedDB 实现同一规则（权限、胶囊时钟、邀请容量、上传校验）；
- `SupabaseRepository` 通过 `supabase-js` + RLS 实现同一接口；
- UI 永远不直接访问存储。

**影响**：所有页面可在无账号时完整运行；真实后端的验收项单独标记 `BLOCKED_EXTERNAL` 或由本地 Supabase 真实验证。

## ADR-003 自建设计系统，不引入 shadcn/ui

**背景**：PRD 写「shadcn/ui（按需）」，同时要求高度定制的「午夜观星台」视觉。

**决策**：用 Tailwind v4 token + 一组自制原语（Button / Field / Dialog / Toast / EmptyState 等）替代 shadcn/ui。

**理由**：避免默认外观与大量未使用的 radix 依赖；本项目需要严格的视觉一致性、暗色 token 与 reduced-motion 行为；组件数量可控（< 20）。

**影响**：需自行保证键盘交互与焦点管理；已通过组件测试与 Playwright 覆盖关键路径。

## ADR-004 不引入日期库

**背景**：需要中文日期展示、纯日期 vs 时刻区分、周年计算。

**决策**：`src/lib/date.ts` 手写格式化与日历日计算；「发生日期」存 `occurredOn`(YYYY-MM-DD) + `occurredTime`(HH:mm|null)，并派生 ISO 时间用于排序。

**理由**：中文格式需求固定，避免 locale 包体与日期库默认 UTC 转换带来的错日问题。

## ADR-005 时间胶囊：服务端时钟优先；demo 用单调时钟

**真实后端**：`capsules.opens_at` 由数据库保存，正文放在独立表 `capsule_contents`，SELECT 策略要求 `now() >= opens_at`；客户端不能修改 `opens_at`（触发器拒绝）。**这是唯一可称为“安全”的实现。**

**Demo 后端**：使用以 `performance.now()` 为基准的单调时钟；会话内把系统时间调快不会提前解锁。纯离线客户端无法识别「会话开始前就被修改的系统时钟」，因此 demo 的时钟不构成安全边界，UI 与文档明确说明。

**验收**：真实服务端拒绝案例由 Supabase 本地/云端 RLS 测试验证；demo 的单调时钟由单元测试 + E2E 验证；两者分开标注。

## ADR-006 离线数字博物馆：自包含 HTML + 相对资源 + SHA-256

**决策**：导出 ZIP 固定包含 `index.html`、`assets/`、`memories.json`、`memories/*.md`、`manifest.json`、`SHA256SUMS.txt`、`README.txt`（追加 `meta.json`）。`index.html` 内联数据、CSS 与原生 JS（无 ES module、无 fetch、无 CDN），图片/音视频/文字全部使用相对路径，`file://` 双击可浏览。

**理由**：直接满足「断网、无数据库、无 AI API 仍可浏览」；Markdown/JSON 保证可迁移；SHA-256 提供完整性校验。

**影响**：离线包体积约等于媒体原始大小；导出选择使用 File System Access API 流式写入（Chrome/Edge），其余浏览器回退为内存 ZIP 并明确提示体积上限。

## ADR-007 AI 助手：检索优先、引用可追溯、默认关闭

**决策**：
- 检索层在 `src/domain/ask/retrieval.ts`，只接收 `canViewMemory` 允许的记录；
- 无模型时提供确定性答案（计数/最早/最近/关键词），所有事实段落附 source 编号；
- 模型 adapter 仅在用户显式启用后调用，经 Supabase Edge Function 代理，服务端保管密钥；
- 模型输出必须通过引用校验（编号存在、ID 属于本次检索集合），否则整段丢弃并回退检索答案；
- 模型输出永不写回记忆数据库。

**理由**：防止模型幻觉与私有内容泄漏；无密钥时产品仍可用。

## ADR-008 用本地 Supabase 栈验证真实 RLS

**决策**：若 Docker 可用，使用 `supabase start` + `supabase test db`（pgTAP）在真实 Postgres 上验证 RLS、容量限制、胶囊解锁；与云端项目的差异在验收报告中说明。云端集成（真实邮件、域名）仍标记 `BLOCKED_EXTERNAL`。

## ADR-009 Demo 会话按标签页隔离

**决策**：demo 身份保存在 `sessionStorage`，数据保存在 IndexedDB。这样同一浏览器两个标签页可以分别以 A / B 登录并共享同一份“服务器数据”，用于真实地演示与测试双人隔离，而不需要两套云凭据。

**影响**：demo 模式下新开标签页需要重新选择身份；真实 Supabase 模式使用其持久会话。
