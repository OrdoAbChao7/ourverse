# OURVERSE 架构说明

本文描述实现结构、关键数据流与不变量。产品决策与取舍见 `docs/DECISIONS.md`。

## 1. 分层

```text
┌──────────────────────────────────────────────────────────┐
│ features/ + components/        页面、交互、可访问性        │
├──────────────────────────────────────────────────────────┤
│ app/                           路由、会话、启动、错误边界   │
├──────────────────────────────────────────────────────────┤
│ data/repository.ts             唯一数据边界（接口）         │
│   ├─ data/local/               IndexedDB 演示后端            │
│   └─ data/supabase/            Auth + RLS + Storage         │
├──────────────────────────────────────────────────────────┤
│ domain/                        纯规则，无 IO、无 React       │
├──────────────────────────────────────────────────────────┤
│ lib/                           日期、文本、哈希、Markdown    │
└──────────────────────────────────────────────────────────┘
```

约束：

- 页面永远不直接访问 IndexedDB、`supabase-js` 或存储 URL；
- `domain/` 不导入 React、浏览器 API 或任一后端；
- 两个后端实现同一个 `Repository` 接口，权限规则由 `domain/permissions.ts` 作为可执行规范，SQL 与本地代码分别实现同一组不变量；
- 启动时按环境选择后端，Supabase 客户端按需动态导入，演示构建不把真实后端打进首屏。

## 2. 启动与会话

1. `src/main.tsx` 挂载 React。
2. `src/App.tsx` 异步调用 `createRepository()`：
   - `VITE_BACKEND=supabase` 且 URL + anon key 都存在 → `SupabaseRepository`；
   - 否则 → `LocalRepository`，并保留明确的 DEMO 状态；
   - 初始化失败显示可重试的启动错误，而不是白屏。
3. `RepositoryProvider` → `ToastProvider` → `AuthProvider` → `RouterProvider`。
4. `src/app/router.tsx`：
   - `RequireAuth` 拦截未登录访问 `/app/*`；
   - `SpaceGate` 把没有空间的用户送到 `/onboarding`；
   - 启动阶段显示 `Splash`，不渲染半初始化页面；
   - 404 页面不泄露内部路径。

演示身份存在 `sessionStorage`（按标签页隔离），数据存在 IndexedDB（同一浏览器共享）；真实后端使用 Supabase 持久会话。

## 3. 权限模型

`Viewer = { userId, isMemberOfSpace }`。规则：

| 对象 | 读取 | 编辑 / 删除 |
| --- | --- | --- |
| 共同记忆 | 空间内两名成员 | 仅作者 |
| 私密记忆 | 仅作者 | 仅作者 |
| 附件 | 继承所属记忆，永不放宽 | 随记忆 |
| 共同纪念日 | 两名成员 | 仅作者 |
| 私密纪念日 | 仅作者 | 仅作者 |
| 胶囊元数据 | 同记忆可见性 | 仅作者，开启后不可改 |
| 胶囊正文 | 可见元数据 **且** 权威时间 ≥ `opensAt` | 不可改 |
| 已删除记忆 | 所有人不可见 | 不可编辑 |
| 非成员 / 匿名 | 无 | 无 |

同一规则在三处落地：

- `src/domain/permissions.ts`：纯函数与单元测试；
- `src/data/local/local-repository.ts`：每次读写前检查；
- `supabase/migrations/20261026090100_helpers_rls_storage.sql`：RLS 策略与 `storage.objects` 策略，另有路径触发器与容量触发器。

导出与 AI 检索不直接读库：它们先通过 `filterVisibleMemories` / `canViewMemory` 缩小集合，绝不把不可见记录交给后续管线。

## 4. 权威时间

- **真实后端**：`server_now()` RPC 返回数据库时间，客户端缓存与本地时钟的偏移；胶囊正文由 `capsule_contents` 的 RLS 条件 `now() >= opens_at` 强制，`opens_at` 修改由触发器拒绝。客户端时间不构成安全边界。
- **演示后端**：`MonotonicClock` 以 `performance.now()` 为基准锚定到墙上时钟，忽略系统时间跳变；因此会话开始后把系统时间调快不会提前解锁。
- 演示时钟仍不是安全边界（完全离线的客户端无法识别会话开始前就被篡改的时钟），UI 与文档明确区分两者。

## 5. 记忆、附件与上传

- 记忆使用 `occurredOn`（`YYYY-MM-DD`）+ `occurredTime`（`HH:mm | null`），派生 ISO 时间用于排序；避免时区把「日期」移到前一天。
- 上传先经过 `domain/uploads.ts`：
  - 扩展名与 MIME 精确匹配；
  - 魔数签名校验（JPEG/PNG/WebP/MP4/WebM/MP3/WAV 等）；
  - 单文件 5 MB 图片、30 MB 音频、80 MB 视频；每条记忆数量与总大小限制；
  - 文件名清理，存储路径绑定 `<space>/<memory>/<file>`。
- 真实后端：私有 bucket + 短期签名 URL；`getAttachmentUrl` 在复用缓存签名前**重新鉴权**，防止软删除后仍能凭旧 URL 访问。
- 演示后端：`AttachmentRecord.data` 存 `ArrayBuffer`（IndexedDB 可移植克隆），读取时构造 `Blob`。

## 6. 搜索与 AI 检索

`src/domain/search.ts`：

- 中文按 bigram、拉丁按词切分；
- 支持显式日期约束（`YYYY年M月D日`、`YYYY年M月`、ISO）；
- 标题/标签命中权重高于正文；
- 空查询按时间倒序返回可见记录。

`src/domain/ask/retrieval.ts`：

1. 先按权限过滤；
2. 去掉「我们」「条记录」等泛化 bigram、归档短语与日期片段，避免噪声主导排序；
3. 识别计数 / 最早 / 最近 / 查找意图；
4. 纯日期问题按日期筛选；日期 + 关键词时，日期只作为加权而非独立证据；
5. 无足够证据返回固定拒绝，不生成具体日期。

`src/domain/ask/answer.ts` 生成带 `[n]` 引用的确定性答案；`model.ts` 校验模型引用的子集关系、编号范围与超时；`remote-model.ts` 只调用 Supabase Edge Function。

`supabase/functions/ai-ask`：

- 校验 JWT；
- 只信任客户端传来的 source id，重新通过 RLS 读取数据库内容；
- 丢弃不可见 id；
- 要求用户 AI 偏好为开启；
- 服务端持有提供商密钥；
- 引用不合法 → `502 AI_OUTPUT_INVALID`，不回显未校验内容；
- 默认返回 `503 AI_NOT_CONFIGURED`，前端继续用检索答案。

## 7. 离线博物馆导出

`src/features/export/build-museum.ts`：

1. 接收当前 viewer、范围（`all | shared | mine`）与仓库数据；
2. 再次按权限过滤（不信任 UI 选择）；
3. 逐文件读取附件字节并计算 SHA-256；
4. 生成固定布局：`index.html`、`assets/`、`memories.json`、`memories/*.md`、`meta.json`、`manifest.json`、`SHA256SUMS.txt`、`README.txt`；
5. `offline-viewer.template.html` 内联数据、CSS 与原生 JS，不使用 `fetch`、ES module、CDN 或远程字体；
6. `zip.ts` 用 fflate 打包，`save-file.ts` 优先 File System Access API 流式写入，否则回退 Blob 下载（300 MB 内存上限，超限明确拒绝）。

`scripts/verify-export.mjs` 对目录或 ZIP 做哈希、缺失、额外文件与 `--strict` 远程引用检查；E2E 还在真实断网 + `file://` 下验证图片、音频、视频与交互。

## 8. 设计系统与可访问性

- Tailwind v4 CSS-first token 定义在 `src/styles/globals.css`：深夜蓝、紫、金、青四色与中性色阶；
- 玻璃质感克制使用，标题字重与字号建立层级；
- 自制原语（Button、Field、Dialog、Toast、TagInput 等）统一焦点、禁用、加载与错误状态；
- Dialog 有焦点陷阱与 `aria` 标签；图标按钮有可读名称；
- `prefers-reduced-motion` 下停止星空持续动画与大幅过渡；
- axe-core WCAG 2.1 A/AA 在核心页面、登录页、弹窗与移动端均无违规；
- 375px 与 1440px 均验证无横向溢出。

## 9. 测试策略

| 层 | 工具 | 覆盖 |
| --- | --- | --- |
| 纯规则 | Vitest | 权限、搜索、日期、星空、上传、时钟、AI 检索/答案/模型校验、导出范围 |
| 本地仓库 | Vitest + fake-indexeddb | 种子、CRUD、软删除、邀请、胶囊、AI 偏好、隔离、重置 |
| 真实后端 | Vitest + Supabase JS | 真实注册/空间/邀请/RLS/存储/胶囊/偏好，含 5 MB 上传 |
| 数据库 | pgTAP | 87 条断言：表、RLS、策略、触发器、RPC、存储、成员移除 |
| 浏览器 | Playwright | 认证、CRUD、搜索、星空、纪念日、胶囊、AI、隔离、导出、断网离线包、响应式、移动端、axe、真实 Supabase UI |

所有门禁都是实际执行的命令，没有删除或跳过测试来制造通过。

## 10. 性能与构建

- Vite 生产构建按 `vendor-react` / `vendor-motion` / `vendor-supabase` 与导出面板拆分；
- Supabase 客户端动态导入，演示首屏不需要它；
- 演示媒体作为静态资源按需加载，导出时读取原始字节；
- Lighthouse 登录页实测 Performance 94 / Accessibility 100（本地 preview，单次结果，不宣称普适分数）。
