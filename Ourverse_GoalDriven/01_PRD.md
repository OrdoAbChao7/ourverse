# OURVERSE / 双人星球 — 产品需求说明书（PRD）

版本：v1.0 ｜ 产品定位：仅面向受邀两位成员的私人数字记忆世界 ｜ 默认语言：简体中文

## 1. 产品愿景与边界

创建一个可通过手机和电脑访问的**私密双人数字空间**：记录共同经历，在星空中探索回忆，保存照片/音视频，安排未来时间胶囊；最后将经双方授权的记录导出成可离线浏览、可长期保存的数字博物馆。

核心原则：**真实记忆优先于 AI 生成；安全和可迁移性优先于视觉噱头**。AI 是可选的检索助手，不能伪造经历，也不能默认将私人数据发往模型服务商。

本产品支持非恋爱关系的双人用途（朋友/伴侣/家庭成员），文案可配置，不强制称谓。应用不得以任何方式冒充另一个人发言。

## 2. 用户与角色

- Space Owner：空间创建者，生成有效期短、一次性使用的邀请链接。
- Space Member：接受邀请并独立登录的第二位成员。
- 每个空间恰好至多两个正式成员。无公开注册浏览入口；未登录只能看到中性登录页。
- 内容有 shared（双方可见）与 private（仅作者本人可见）两种可见性。个人私有内容不得进入对方检索、公共导出或 AI 上下文。
- shared 内容允许双方查看，但仅作者可编辑和删除；附件与关联对象继承相同权限。撤销成员资格必须阻断后续请求。

## 3. 导航结构与页面

1. `/login` — 登录/接受邀请：简洁、私密、不透露双方身份。
2. `/app` — 首页：星空主视觉、认识天数/倒计时卡、近期新增记忆、今日想写一句话。
3. `/app/timeline` — 时光长廊：按年月浏览、搜索筛选、点击进入回忆详情。
4. `/app/memories/new` — 创建记忆：标题、日期时间、描述（Markdown）、标签、可见性、可选地点标签、照片/视频/音频附件。
5. `/app/stars` — 星空记忆：一颗星代表一条记忆，点击弹窗与详情链接；星座分组按年/月生成，不随机篡改历史。
6. `/app/gallery` — 数字博物馆：相册、视频、语音与主题展厅，保留原文件下载。
7. `/app/capsules` — 时间胶囊：预定开放时间、标题、内容、解锁状态；服务器端授权与解锁检查，前端隐藏不能代替访问控制。
8. `/app/ask` — 记忆助手（可选 AI）：问答、证据卡片、缺乏证据时拒答、索引状态。
9. `/app/settings` — 双人身份/邀请、导入导出、空间主题、隐私权限、数据管理。

## 4. 核心需求优先级

### P0：可运行、私密、可记录（MVP 必需）
- 完成响应式移动端/桌面端页面，包含真实空状态、加载状态、错误状态。
- 邮箱登录或魔法链接登录（采用 Supabase Auth），一次性邀请，仅限两个人。
- 两人可独立登录，新增/编辑/删除自己的记忆；支持 shared/private 与日期排序。
- 文件上传到私有 Bucket，支持 JPEG/PNG/WebP、MP4、MP3/M4A；服务端验证 MIME、扩展名、大小并处理错误。
- 照片不对外公开，不使用 public Bucket；访问通过受授权的短期签名链接或后端授权代理。
- 提供文字搜索、按日期/标签筛选、记忆详情、单个原文件下载。
- 支持演示模式，使用明确标注为虚构的种子数据，禁止在 Git 中保存真实私人素材。

### P1：差异化交互（MVP 必需）
- 星空记忆视图：有控件可切换普通时间轴；初版可用 Canvas/2D，不为了 3D 牺牲性能。
- 纪念日倒计时：用户自定义事件日期，不凭空设定恋爱开始日。
- 轻量小互动：随机抽取共同记忆卡片 / 双人留言，至少完成其中一种。
- 时间胶囊：创建后到期前任何客户端不能读取内容正文（含 API）；到期后双方按权限解锁。

### P2：数字博物馆与离线保存（MVP 必需）
- 用户明确选择导出范围：仅本人私有、共同内容、或全部本人可访问内容；不能越权导出他人私有条目。
- 导出 ZIP：`index.html`、`assets/`、`memories.json`、`memories/*.md`、`manifest.json`、`SHA256SUMS.txt`、`README.txt`。
- `index.html` 与资源使用相对路径，断网后双击 `index.html` 可以查看时间线、图片、文字与本地音视频（平台允许时）。离线核心不依赖 fetch、ES module、CDN 或服务端。
- 离线包不使用远程 AI；不包含密钥、session token 或上传签名链接。生成后对文件哈希进行校验，提供还原/校验说明。大文件导出须显示预计体积和上限、提示存储空间不足，优先采用流式导出，不能默默因浏览器内存不足失败。
- 明示 ZIP 默认不加密；可选另行制作加密备份，不能承诺 U 盘几十年不损坏，要求至少两处独立备份。

### P3：有证据的记忆助手（增强功能）
- 首版使用**明确日期/关键词检索**完成基础问答和来源链接，不要求预先配置付费 API。
- 接入 AI 后采用 retrieval-first，模型只回答授权检索到的内容，展示点击可直达记录的 citation ID。
- 无证据输出“暂无足够记录”，不能杜撰日期、地点、人物、共同经历；不把推测自动写入记忆数据库。
- 默认禁用 AI 外部调用，须在设置里明确启用并告知会传送哪些内容；服务端调用模型，不向浏览器公开密钥。
- 隐私隔离必须在检索层实现，不能只靠提示词。用户可关闭 AI 并删除相应索引/缓存。

### 明确不做（v1 排除）
- 自动读取微信/QQ 私聊内容、假冒本人自动发送消息、无授权主动监控。
- 训练双方声音克隆模型或上传真实私人素材到公共仓库。
- 完整 3D MMO、复杂多 Agent、实时视频通话、移动原生 App、默认发布公网。
- 依赖视觉截图或动画来假装已经实现数据库、权限和业务流程。

## 5. 视觉体验设计

风格名：**Midnight Observatory / 午夜观星台**。

- 主色：`#08111F` 深夜蓝；背景过渡 `#101B35`；文本 `#F5F7FA`；次级 `#A9B8CB`。
- 点缀：`#B9A1E8` 星雾紫、`#F0D49C` 暖星金、`#82C5CF` 银河青。
- UI：克制的玻璃感卡片、细边界、长留白、细腻动效，避免大面积高饱和霓虹。
- 字体：系统中文无衬线优先，数字可使用系统等宽字体；不得依赖在线字体才能显示。
- 背景星空必须可降级；`prefers-reduced-motion` 时禁用持续运动；弱性能设备自动简化星粒子。
- 桌面导航：左侧紧凑栏 + 主内容区。手机：底部导航（首页、回忆、星空、博物馆、我的）。
- 第一屏要体现：私人空间、当前双方配置、最近一条记忆、主 CTA“写下这一刻”，不是通用企业管理后台。
- 首页欢迎文案示例：`把故事留在星光里。`，后面内容由用户配置。

## 6. 技术架构（推荐默认方案）

| 层 | 方案 | 说明 |
|---|---|---|
| Web | Vite + React + TypeScript(strict) | 静态产物，适配 Cloudflare Pages |
| UI | Tailwind CSS + shadcn/ui（按需）+ Motion | 无障碍、轻交互为先 |
| 路由 | React Router | SPA 路由、懒加载 |
| 数据 | Supabase Postgres | migrations 版本化，RLS 双人隔离 |
| 身份认证 | Supabase Auth | 邀请准入由服务端验证，不开放随意加入空间 |
| 私有文件 | Supabase Storage 私有 Bucket | 授权读写、短时访问链接 |
| Server | Supabase Edge Functions（必要时） | 邀请 token、受控导出/AI 调用等高权限操作 |
| AI | 可选 provider + 检索层 | 无密钥时纯搜索依然可用 |
| 质量 | Vitest + Testing Library + Playwright | 单元、集成、端到端 |
| 发布 | Cloudflare Pages + Supabase | 部署必须由用户明确授权并提供凭据 |

**开发降级规则**：没有 Supabase 账号或密钥时，必须提供 `demo` 模式（仅本地虚构数据 + localStorage/IndexedDB 可选），让 UI / 数据模型 / 导出链路可验证；不得假装线上认证、RLS 已验收。切换真实后端只能经过真实联调测试。

## 7. 关键数据模型（先写 migrations，再实现）

- `spaces(id, display_name, created_by, created_at, relationship_start_at_nullable)`
- `space_members(id, space_id, user_id, role, joined_at)`，唯一(space_id, user_id)，空间最多两名成员（在受控事务/函数中检查）。
- `space_invites(id, space_id, token_hash, expires_at, used_at, invited_email_nullable, created_by)`；明文令牌仅发送时显示，不永久落库。
- `memories(id, space_id, author_id, title, body_md, occurred_at, visibility, location_label_nullable, tags, created_at, updated_at, deleted_at_nullable)`。
- `attachments(id, memory_id, storage_path, mime_type, byte_size, sha256_nullable, created_at)`；存储路径必须与 space_id 绑定。
- `anniversaries(id, space_id, author_id, name, date, repeat_rule_nullable, visibility)`。
- `capsules(id, space_id, author_id, title, opens_at, visibility, created_at)` 仅存可公开给有权成员的元数据；`capsule_contents(capsule_id, body_md)` 单独储存密封正文，正文读取权限依赖数据库服务器时间 `now() >= opens_at`，不得通过普通客户端更新 `opens_at` 以提前解锁。
- `activity_logs(id, space_id, actor_id, action, target_id, created_at)`（最小审计，不存敏感正文）。

访问控制：所有暴露给客户端的表开启 RLS 并限制 grants；匿名者不能读取空间数据，非成员不可访问；private 仅本人可读；shared 双方可读；写操作有作者约束；附件存储路径同权限。通过第三个测试账号执行越权负测。

## 8. 状态与边界

- 错误：断网、无效/过期邀请、上传失败、附件丢失、重复提交、存储限额、被删除记录、AI 超时。
- 不使用云端数据的纯演示模式只展示**演示**提示，不泄漏真实数据。
- 日期按用户选择的时区展示；保存为 ISO 时间戳+原始发生日期（纯日期与时刻要区分）。
- 删除与导出等高风险操作进行明确确认；可实现软删除与恢复（增强阶段）。
- AI 的引用和记忆元数据不能在 UI 上泄漏私有标题/内容给另一方。

## 9. 可用性与性能目标

- 375px 和 1440px 视口无横向溢出，无核心功能因触摸屏缺失。
- Chrome/Edge 最新稳定版；Android Chrome 和 iOS Safari 尽可能兼容（在可访问设备上实测；不可实测时必须注明）。
- 关键交互有键盘操作、可见焦点、颜色对比度和缩减动效支持。
- 生产构建无 TS 错误；核心 E2E 全通过；图片懒加载，星空页面可关闭动效。
- Lighthouse 目标：桌面/移动性能 >=80、Accessibility >=90（有真实可测环境才算通过；否则标记待测）。

## 10. 交付成果

1. 完整源码 + lockfile + 不含敏感凭据的 `.env.example`。
2. `README.md`：Windows / WSL 安装、开发、demo 运行、生产环境配置、部署、测试、故障排查。
3. `docs/architecture.md`、`docs/privacy.md`、`docs/backup-and-restore.md`。
4. `supabase/migrations/*` + RLS 自动化测试；`tests/`、`e2e/`。
5. `scripts/verify` 或 `npm run verify`，串行执行类型检查、lint、测试、构建；浏览器 E2E 单独命令。
6. `docs/ACCEPTANCE_REPORT.md`：每条验收项对应证据、测试命令、状态（PASS/BLOCKED/FAIL）。
7. 最少 12 条**明确标注为虚构**的 demo 记忆样本、6 个附件占位测试素材及完整用户旅程。

## 11. 外部依赖与用户操作门槛

需要真实 Supabase、Cloudflare 账号/密钥、域名或 LLM API 时，Agent 必须先完成可离线演示版与自动测试，再报告需要用户提供的最小配置。禁止自动购买服务、部署公网、提交/上传真实私人数据、导入第三方聊天记录。
