# OURVERSE — 开始使用

这个目录是交给编码 Agent 的完整设计包，包含：

- `01_PRD.md`：产品定位、功能、设计语言、技术架构、数据模型、隐私约束。
- `02_GOALS_AND_ACCEPTANCE.md`：S0–S5 严格阶段验收、测试与停止规则。
- `03_AGENT_MASTER_PROMPT.md`：可交给主 Agent 的完整 Goal/Criteria/执行要求。

## 推荐启动方式（独立新项目）

1. 新建空项目目录 `ourverse`；在根目录建立 `docs/`，将以上前三份文档复制到 `docs/`。
2. 在项目根目录启动你正在使用的编码 Agent。
3. 将本文件下面的 Goal/Criteria 复制进对应扩展的向导，或把 `03_AGENT_MASTER_PROMPT.md` 的全文交给 Agent。
4. 等 S0 完成并实测后再开启 S1，依次推进。不要把“独立运行 + 真实后端 + 公网部署”混为一项验收。

## 适配 A：Pi 的 pi-goal-driven 扩展

参考：https://github.com/vurihuang/pi-goal-driven

首次安装（仅在已经检查并信任扩展源码后）：

```bash
pi install npm:pi-subagents
pi install npm:pi-goal-driven
```

在 Pi 输入：

```text
/goal-driven
```

在弹出的 Goal / Criteria for Success 框中，分别复制下面两段内容（或精简为当前阶段）；保存后运行：

```text
/goal-driven:work
```

若扩展未安装或不支持该命令，则使用下面的 Codex/Pi 通用提示词执行，而不是猜测命令。

### Goal 填写内容

实现本目录 docs/01_PRD.md 和 docs/02_GOALS_AND_ACCEPTANCE.md 定义的 OURVERSE 私人双人数字记忆应用，按 S0→S5 可验证阶段推进。交付真实可用的权限与记忆 CRUD、星空时间线、纪念日与时间胶囊、离线数字博物馆 ZIP，以及可禁用且引用来源的记忆检索助手。严禁假装通过真实后端验收或擅自公开部署。

### Criteria for Success 填写内容

完整满足 docs/02_GOALS_AND_ACCEPTANCE.md 的 S0–S5 每项标准；每阶段必须通过实际运行的 typecheck、lint、unit、build 和必要的 E2E；RLS、Storage 越权测试须通过真实服务验证；离线 ZIP 必须断网双击 index.html 可浏览并通过 SHA-256 校验；AI 必须先授权检索、来源可追溯且无证据拒答；每一项给出测试命令、状态和证据文件，缺少密钥或服务的真实测试一律标记 BLOCKED_EXTERNAL；不得无授权 push、公开部署或上传真实私人数据。

## 适配 B：Codex 原生 /goal

当前 Codex 的 `/goal` 用于持久目标；若找不到命令，可检查已安装版本以及 `features.goals` 设置。官方参考：https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex

在 Codex 聊天中输入：

```text
/goal 阅读 docs/01_PRD.md、docs/02_GOALS_AND_ACCEPTANCE.md 和 docs/03_AGENT_MASTER_PROMPT.md，实现 OURVERSE 项目。严格按照 S0→S5 阶段顺序执行，每个阶段必须提供运行证据并达到对应标准；未通过不得宣称完成。无账号/密钥时先完成 demo 与本地可验证功能，将真实集成标记 BLOCKED_EXTERNAL。最终提交源码、测试、截图和 docs/ACCEPTANCE_REPORT.md，禁止未经授权部署公网或 push。
```

## 适配 C：只支持普通文本的 Claude Code / Pi / 其他代理

让 Agent 读取 `docs/03_AGENT_MASTER_PROMPT.md` 全文，明确执行“初次启动必须执行”中四件事。若支持独立 Agent 角色，可将主 Agent 用于总控、子 Agent 用于互不冲突的子任务，但是否持续运行由实际工具能力决定。

## 注意事项

- 两个不同命令生态不能混用：`/goal-driven` 是特定 Pi 扩展，而 `/goal` 视 Codex 或所装 Pi 扩展不同可能有不同语义。
- 本包是设计与指令，不是已经实现或部署的 Web 应用。
- 所有成本（数据库、存储、域名、模型 API）取决于真实用量与供应商套餐；没有提供账户时只能交付 demo + 待联调清单。
