# 备份与恢复

私人记忆的丢失不可逆。本文给出三层备份方式：演示数据、真实 Supabase、离线博物馆。所有命令都应在你信任的设备与终端中执行。

> 本仓库**没有**执行云端备份、PITR 或恢复演练；下面标注「已在本地验证」的命令是实际运行过的，其余为运维步骤。

## 1. 备份什么

| 内容 | 位置（真实后端） | 备份方式 |
| --- | --- | --- |
| 空间、成员、记忆、纪念日、胶囊、邀请、AI 偏好、活动 | Postgres `public` schema | 数据库 dump / PITR |
| 附件原始字节 | Storage bucket `memories` | Storage 复制 / 官方备份 |
| Auth 用户 | `auth` schema | 数据库 dump（含敏感数据，严格保管） |
| 用户可见的完整内容副本 | 应用内导出 | 离线博物馆 ZIP |
| 演示数据 | 本机 IndexedDB `ourverse-local` | 应用内导出（演示数据）或重置 |

**数据库 dump 不包含 Storage 对象。** 只恢复数据库会得到「有记录、无媒体」的不完整状态。

## 2. 演示模式（本机 IndexedDB）

### 备份

在「设置 → 离线数据博物馆」导出 ZIP。演示空间同样支持三种范围。ZIP 是可读、可校验的副本，适合长期保存。

### 恢复 / 重置

- 设置页的「重置演示数据」会**清空并重新播种**本机 IndexedDB。这是破坏性操作，只影响当前浏览器。
- 浏览器 DevTools → Application → IndexedDB → 删除 `ourverse-local` 也会清空；下次打开会重新播种。
- 演示 ZIP 目前没有「一键重新导入」功能；它是可读备份（Markdown / JSON / 原始媒体），不是数据库快照。需要恢复演示空间时，使用重置后重新录入，或按 `memories.json` 编写导入脚本。

## 3. 真实 Supabase

### 3.1 本地栈（已实际验证）

获取本地连接串：

```powershell
npx supabase status
# DB_URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

导出 schema 与数据（本仓库实际执行过，exit 0）：

```powershell
npx supabase db dump --db-url 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' `
  -f artifacts/local-schema-dump.sql

npx supabase db dump --data-only --db-url 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' `
  -f artifacts/local-data-dump.sql
```

如需包含角色：

```powershell
npx supabase db dump --role-only --db-url 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' `
  -f artifacts/local-roles-dump.sql
```

附件仍不包含在 SQL dump 中。本地 Stack 的对象位于 Docker volume，不能当作可移植备份。

### 3.2 云端项目（运维执行，未在本仓库执行）

1. 在 Supabase Dashboard 确认备份策略；生产项目启用 **PITR** 或每日备份。
2. 用只读/运维凭据导出：

```powershell
# 连接串使用 direct connection 或 session pooler；不要把密码写进仓库。
$env:SUPABASE_DB_URL = '<postgres-connection-string>'
npx supabase db dump --db-url $env:SUPABASE_DB_URL -f backup-schema.sql
npx supabase db dump --data-only --db-url $env:SUPABASE_DB_URL -f backup-data.sql
```

3. 复制 Storage bucket `memories`：
   - Dashboard → Storage → 下载对象；或
   - 用官方 S3 协议与运维凭据，通过受信任的 S3 客户端同步；或
   - 在受控运维脚本中使用 service_role key（**绝不进入浏览器、仓库或 CI 日志**）。
4. 将 dump 与 Storage 副本存入两个独立位置，至少一份离线/异地，并记录导出时间与 SHA-256。
5. 备份文件含私人内容与可能的 Auth 数据：加密后保存，限制访问。

### 3.3 恢复（运维执行，未在本仓库演练）

**原则：先在 staging 恢复并验证，再考虑生产。**

1. 停止写入（维护窗口），记录当前版本与迁移状态。
2. 在隔离的 staging 项目恢复数据库：
   - 使用 Dashboard 的备份/PITR 恢复；或
   - `psql "$env:SUPABASE_DB_URL" -f backup-schema.sql`，再 `psql ... -f backup-data.sql`。
3. 恢复 Storage 对象到 `memories` bucket，保持原路径 `<space_id>/<memory_id>/<file_name>`。
4. 运行迁移，确保 schema 与代码版本一致（恢复的 dump 可能早于当前迁移）。
5. 执行验证：
   - `npx supabase test db`（在测试库上）；
   - 应用内以 A / B 分别登录，抽查共同记录、私密隔离、附件、胶囊；
   - 用 `scripts/verify-export.mjs` 校验一份新导出的离线包。
6. 确认无误后切换生产。恢复后立即轮换在恢复过程中暴露的凭据。

> 本仓库不提供自动删除或自动覆盖生产数据的脚本。恢复必须由运维者在明确授权下执行。

## 4. 离线博物馆作为内容级备份

适用：长期保存、迁移、断网查看、非技术用户。

```powershell
# 生成后
node scripts/verify-export.mjs <解压目录或 ZIP> --strict
```

- 校验通过只代表**当前副本完整**，不代表它是最新版本；
- 每次大版本升级或重要录入后重新导出，旧副本保留到新副本校验通过；
- 至少保留两份，分别放在不同设备/介质；
- ZIP 默认不加密，存储前请自行加密。

## 5. 恢复演练清单

- [ ] 备份文件存在，SHA-256 与记录一致
- [ ] 备份包含 `public` schema、`auth` schema（如需要）与 Storage 对象
- [ ] 在隔离环境成功恢复
- [ ] 迁移版本与代码匹配
- [ ] A / B 双人隔离与附件读取正常
- [ ] 胶囊未开启正文仍不可读
- [ ] 离线包可断网打开，媒体可播放
- [ ] 记录恢复耗时、执行人、数据截止时间
- [ ] 恢复后轮换可能暴露的密钥

## 6. 已知限制

- 没有自动化定时备份；需要运维配置。
- 没有自动化 Storage 增量备份；需要 S3/官方工具。
- 没有跨区域复制。
- 没有「一键导入离线包」功能；离线包是长期可读副本，不是数据库快照。
- 云备份、PITR 与恢复演练均未在本仓库执行，属于 **BLOCKED_EXTERNAL / OPERATOR_ACTION**。
