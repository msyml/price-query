# 商品价目查询（price-query）

移动端优先的价目查询站点。数据来自飞书多维表格，通过 Cloudflare Pages Functions 实时查询与增删改，部署到 Cloudflare Pages。

## 工作原理

页面数据来自飞书多维表格，通过 Cloudflare Pages Functions（`functions/`）**实时读写**，不再依赖构建期快照。

```
浏览器（输入口令 → 存 localStorage → 放进 x-passcode 请求头，口令变更后自动失效）
   │  GET / POST / PUT  /api/records
   ▼
Cloudflare Pages Functions（functions/，后端在这里）
   │  比对 ACCESS_PASSCODE → 用 App 凭证换 tenant_access_token
   ▼
飞书多维表格（读取列表 / 新增 / 编辑，实时生效）
```

功能：

- **列表页**：搜索（名称 / 拼音 / 条码）+ 品牌 / 分类筛选。
- **添加**：右上角「+ 添加」，填写 商品名称、所属分类、零售价（必填）和 商品品牌（**可留空**，支持关键词搜索联想）；保存时后端自动生成「拼音简称」写回表格。
- **品牌新建**：在品牌框输入表里没有的新品牌并保存，飞书「商品品牌」单选字段会**自动新建该选项**。
- **编辑**：卡片右上角的编辑图标。
- **实时**：新增 / 编辑后立即重新拉取列表，无需「同步」按钮。

设计要点：

- **凭证只在服务端**：飞书 App Secret 存在 Pages 项目的环境变量里，浏览器拿不到，也不进仓库。
- **口令鉴权**：页面访问口令即 API 口令（请求头 `x-passcode`），后端优先取 Cloudflare KV（绑定 `CONFIG` 的 `passcode` 键），未配置时回退到环境变量 `ACCESS_PASSCODE`。
- **远程改口令**：口令存在 Cloudflare KV，改口令只需在控制台改 KV 里的 `passcode` 值，**无需重新部署**（详见「远程改口令」）。
- **限流**：`functions/_middleware.js` 对所有 `/api/*` 做滑动窗口限流（默认每来源 60 次/分钟），超限返回 `429`。用量低时只用于挡住异常高频请求。
- **拼音规则统一**：新增/编辑时用 `pinyin-pro` 按「品牌首字母 + 商品名首字母」生成 `拼音简称`，与历史数据完全一致。该规则实现在 `shared/pricing.js`，**页面接口与快照脚本共用同一份代码**，不会出现两边规则漂移。
- **编辑可清空品牌**：编辑时把品牌清空会真正移除记录上的品牌（显式写 `null`），拼音简称同步去掉品牌前缀，两者始终一致；新增时品牌留空则不写该字段，避免在单选字段里建出空的品牌选项。
- **旧快照流水线保留**：`scripts/sync.mjs` 仍会生成 `public/data/snapshot.enc.json`（PBKDF2 + AES-256-GCM 加密）作为离线备份，页面已不再使用它。
- **写权限提醒**：访问口令同时就是写入口令，拿到口令的人都能新增/编辑表格数据。口令一旦外泄，价目表可被篡改；建议改成足够强的口令。

## 前置准备

### 1. 飞书多维表格

| 项目 | 说明 |
| --- | --- |
| `FEISHU_APP_ID` | 自建应用 App ID |
| `FEISHU_APP_SECRET` | 自建应用 App Secret |
| `FEISHU_APP_TOKEN` | 多维表格的「文档 token」（URL 里 `base/xxx?table=` 的那个 `xxx`）|
| `FEISHU_TABLE_ID` | 数据表 ID（URL 里 `table=tbl...`）|

自建应用需要：

1. 在飞书开放平台给应用开通权限 `bitable:app`（**查看、评论、编辑和管理多维表格**）。
   只给 `bitable:app:readonly` 的话，页面能查但**不能新增/编辑**，写入会报 `91403`。
2. **把应用加为该多维表格的协作者，权限选「可编辑」**（表格右上角「共享」→ 添加应用）。
   只加「可阅读」同样会在写入时报 `91403`。
3. 权限有变更后，需要在开放平台**创建新版本并发布**；自建应用未发布时调开放接口会失败。

> 判断权限是否生效：在项目里跑一次 `npm run dev`，打开页面点「+ 添加」保存；
> 若弹「飞书接口错误：91403 Forbidden」，就是上面两条还没配好。

表格字段（字段名**必须完全一致**，改名后接口会读到空值）：

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| 商品名称 | 文本 | 必填，为空则该行不显示 |
| 商品品牌 | **单选** | 品牌筛选；页面可关键词搜索/直接输入，输入新品牌时自动新建选项 |
| 所属分类 | **单选** | 分类筛选；新增时只能选已有选项 |
| 商品条码 | 文本 | 条码精确查询 |
| 批发价 | **数字** | 价格 |
| 零售价 | **数字** | 必填，新增/编辑时写入数字 |
| 散称价 | 文本 | 可选 |
| 整箱\|整包 | 文本 | 可选 |
| 拼音简称 | 文本 | 新增/编辑时后端自动生成并写回 |

> 品牌、分类是单选字段。
> 分类在页面新增时**只能选表里已有的选项**（页面从字段定义里拉取）；要新增分类，需先在飞书表格里给该字段加选项。
> 品牌可在页面直接输入新值，保存时飞书会**自动新建品牌选项**；也可在飞书里预加选项，页面刷新即可看到。

### 2. Cloudflare

**先说清楚：不需要买服务器。** 页面本身是静态资源，用 Cloudflare Pages 免费托管（官方明确「无限站点、无限请求、无限带宽」，无需绑卡）；读写飞书的那层后端跑在 **Pages Functions**，按 Workers 免费额度计费，个人用量远低于上限。

免费额度：

| 项目 | 免费额度 | 本项目用量 |
| --- | --- | --- |
| 静态请求 / 带宽 | **无限** | 每天几十次 |
| 构建次数 | 500 次/月 | 仅代码推送时触发，个位数 |
| 并发构建 | 1 | 1 |
| 站点数 / 自定义域名 | 100 / 100 | 1 / 0 |
| 单文件上限 | 25 MiB | 最大约 56 KB |
| Functions 请求（Workers 免费） | 10 万次/天 | 每次打开页面 1~2 次 |

#### 第1 步：注册账号

打开 <https://dash.cloudflare.com/sign-up> 注册，**不需要绑卡**。

#### 第 2 步：取 Account ID

登录后进入控制台，**右侧栏**直接显示 `Account ID`，点旁边的复制按钮。
也可以在 `My Profile → API Tokens` 页面看到。

填进 `.env`：

```
CLOUDFLARE_ACCOUNT_ID=粘贴你的 Account ID
```

#### 第 3 步：创建 API Token

1. 点右上角头像 → **My Profile** → 左侧 **API Tokens** → **Create Token**
2. 选**Create Custom Token**（模板里没有恰好适配 Pages 的）
3. 按下表配置权限：

| 权限 | 资源 | 级别 |
| --- | --- | --- |
| Cloudflare Pages | Account | **Edit** |
| Account Settings | Account | **Read** |

4. 再往下找到 **Client IP Address Filtering** 和 **TTL**，**都不用填**，直接
   **Continue to summary → Create Token**
5. 弹出的一次性明文 token **立刻复制**（关掉就再也看不到了），填进 `.env`：

```
CLOUDFLARE_API_TOKEN=粘贴刚生成的 token
```

#### 第 4 步：无需手动建项目

Pages 项目由CI 自动创建（workflow 里的 `pages project create`，
失败会被忽略）。首次部署成功后去
`Workers 和 Pages → price-query` 就能看到 `*.pages.dev` 域名。

> ⚠️ 国内访问 `pages.dev` 可能不稳定。如需国内可访问，把域名挂在
> **自己的域名**上（Pages 控制台 → Custom domains → 域名前不要带 http），
> 走Cloudflare CDN 即可；域名若不在 Cloudflare，先把 NS 指向 Cloudflare。

### 3. GitHub Secrets（走自动部署时必填）

仓库 `Settings → Secrets and variables → Actions`：

**Secrets**（敏感值）

| 名称 | 值 |
| --- | --- |
| `FEISHU_APP_ID` | 同 `.env` |
| `FEISHU_APP_SECRET` | 同 `.env` |
| `FEISHU_APP_TOKEN` | 同 `.env` |
| `FEISHU_TABLE_ID` | 同 `.env` |
| `ACCESS_PASSCODE` | 页面解锁口令，**必须与本地 `.env` 一致**，否则本地口令打不开线上数据 |
| `CLOUDFLARE_API_TOKEN` | 上一步生成 |
| `CLOUDFLARE_ACCOUNT_ID` | 上一步获取 |

**Variables**（非敏感，可选）

| 名称 | 值 |
| --- | --- |
| `CF_PROJECT_NAME` | Cloudflare Pages 项目名，留空则用默认 `price-query` |

> `.env.example` 被有意删除，避免密钥误入库。上面这张表就是它的替代品。

#### 一键从 .env 同步（推荐，省去手工复制）

不用逐个网页粘贴，用 `gh` 命令行同步：

```bash
npm i -g gh          # 若尚未安装 GitHub CLI
gh auth login        # 首次需浏览器授权
npm run secrets      # 校验 .env 并生成上传脚本（不打印明文密钥）
npm run secrets:upload   # 生成 + 自动执行上传
```

它按 workflow 的实际需要做键名映射（敏感项进 Secrets，`CF_PROJECT_NAME` 进 Variables），
并自动跳过 `.env` 中的空值。

两个安全设计：

- 脚本**不打印任何密钥明文**，只显示字符长度
- 上传脚本临时生成，已加入 `.gitignore`，执行完自动删除

> 注意：`.env` 里 `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` 目前为空，
> 这两项不会上传，需先去 Cloudflare 控制台取到值再补齐。

### 4. Pages 项目的环境变量（Functions 运行时用）

Functions 在线上运行时，从 **Pages 项目的环境变量**里读飞书凭证和口令，需要这 5 项：

`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_APP_TOKEN`、`FEISHU_TABLE_ID`、`ACCESS_PASSCODE`

可选（不配就用默认值，无需改动）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `RATE_LIMIT_MAX` | `60` | 单个来源在窗口内允许的 API 请求数，设为 `0` 关闭限流 |
| `RATE_LIMIT_WINDOW_MS` | `60000` | 限流窗口长度（毫秒） |
| `CONFIG`（KV 绑定） | 无 | 绑定 KV 命名空间后，后端优先从 `CONFIG.passcode` 取口令，实现远程改口令 |

**走 CI 部署时无需手动设置**：`deploy.yml` 会从 GitHub Secrets 生成并写入（`wrangler pages secret bulk`）。

**本地手动设置一次即可**（本机已登录 `wrangler` 或设好 `CLOUDFLARE_API_TOKEN`）：

```bash
npm run pages:secrets    # 把 .dev.vars 里的 5 个键批量写入 Pages 项目
```

### 5. 远程改口令（已配置，免重新部署）

访问口令托管在 **Cloudflare KV**（命名空间 `price-query-config`，id `05bb8902cd324118a8ae3be7063aedd5`），
后端绑定名 `CONFIG`、键 `passcode`。绑定写在仓库的 `wrangler.toml` 里，CI 部署会自动带上。

**改口令（随时可做，无需任何部署）：**

1. 控制台 **Workers 和 Pages → KV → `price-query-config`**
2. 编辑 `passcode` 这条的值，保存即可。约 1 分钟内全球生效（KV 最终一致性）。

后端读取顺序：`CONFIG.passcode`（KV）→ 为空则回退 `ACCESS_PASSCODE`（环境变量）。
所以环境变量仍作为兜底保留；本地 `npm run dev` 没有 KV 绑定，走环境变量，行为不变。

> 重新绑定/换命名空间：改 `wrangler.toml` 里的 `[[kv_namespaces]]` id，然后重新部署一次。

## 部署

### 方式A：GitHub Actions（推荐）

已配置好的工作流 `.github/workflows/deploy.yml`，两种触发方式：

| 触发 | 说明 |
| --- | --- |
| `push` 到 `main` | 代码改动后自动部署 |
| `workflow_dispatch` | 手动触发，Actions 页面点「Run workflow」 |

> 页面数据是后端实时读飞书的，不依赖构建，因此**没有定时构建**（旧的每日刷新任务已移除，避免无谓消耗构建额度）。

流程：检出代码 → 装依赖 → `npm run sync` 生成加密快照（旧流水线，备份用）→ 确保 Pages 项目存在 → 写入 Pages 环境变量 → 部署（含 `functions/`）。

前置条件（缺一不可）：

1. 上面的 Secrets / Variables 全部配好。
2. `npm run sync` 能在本地跑通（先在本地验证飞书权限，避免在 CI 里反复试）。
3. 代码已推送到 `origin/main`。

首次部署后拿到地址：Cloudflare 控制台 → Workers 和 Pages → `price-query` → 域名。

### 方式 B：本地快速发布（调试用）

```bash
npm run publish              # 拉数据 + 加密 + 部署
npm run publish -- --skip-deploy   # 只更新本地快照，不部署
```

需要本机已 `wrangler login`，或改用 `.env` 里的 API Token / Account ID 环境变量。

> `public/data/` 不在版本库里，本地部署不会污染仓库。

## 本地开发

```bash
npm install
npm run dev     # wrangler pages dev public，本地预览（同时起 functions）
```

本地起 Functions 需要 `.dev.vars`（已被 `.gitignore`，格式同 `.env`）：

```
FEISHU_APP_ID=...
FEISHU_APP_SECRET=...
FEISHU_APP_TOKEN=...
FEISHU_TABLE_ID=...
ACCESS_PASSCODE=...
```

改前端刷新即可；改 `functions/` 下的后端，wrangler 会自动重编译。

## 目录结构

```
├─ public/                  # 静态站点根目录，直接被部署
│  ├─ index.html
│  ├─ app.js                # 口令解锁 + 列表 / 筛选 + 添加 / 编辑
│  ├─ style.css
│  └─ data/snapshot.enc.json  # 旧流水线产物（不入库，页面已不用）
├─ shared/
│  └─ pricing.js            # 纯逻辑：字段映射 + 拼音 + 数值归一化（functions 与 scripts 共用）
├─ functions/               # Cloudflare Pages Functions（后端）
│  ├─ _middleware.js        # /api/* 限流（滑动窗口）
│  ├─ api/records.js        # GET 列表 / POST 新增
│  ├─ api/records/[id].js   # PUT 编辑
│  └─ lib/
│     ├─ feishu.js          # token + 记录/字段读写
│     ├─ normalize.js       # 校验 + 写入组装（纯逻辑转引 shared/pricing.js）
│     └─ http.js            # 鉴权 + 限流 + 统一响应
├─ scripts/                 # 旧的静态快照流水线（备份用）
│  ├─ sync.mjs              # 拉数据 → 加密 → 落盘
│  ├─ publish.mjs           # 本地一键发布
│  ├─ sync-secrets.mjs      # .env → GitHub Secrets/Variables 同步
│  └─ lib/
│     ├─ feishu.mjs
│     └─ snapshot.mjs       # 仅加密与落盘，归一化复用 shared/pricing.js
├─ .github/workflows/deploy.yml
└─ wrangler.toml
```

## 故障排查

| 现象 | 原因 |
| --- | --- |
| 打开页面提示「无法加载数据：口令不正确」 | `ACCESS_PASSCODE` 与你输入的口令不一致（线上值在 Pages 项目环境变量里） |
| 新增/编辑弹「飞书接口错误：91403 Forbidden」 | 飞书应用没有写权限：需开 `bitable:app`（非 readonly）+ 把应用设为多维表格「可编辑」协作者 + 发布新版本 |
| 新增时提示品牌/分类不是合法选项 | 品牌、分类是单选字段，只能选表里已有选项；先去飞书表格给字段加选项 |
| `获取 tenant_access_token 失败` | App ID/Secret 错，或应用未发布 |
| 页面能查但列表为空 | 应用没被加为多维表格协作者（读取报 `91403`） |
| 页面报 500 且提示缺少凭证 | Pages 项目环境变量没配，跑 `npm run pages:secrets` 或走 CI 部署 |
| CI 报依赖安装失败 | lock 文件指向国内镜像，可改用官方源，见下 |

lock 文件目前解析到 `registry.npmmirror.com`。GitHub Actions 的 runner 在海外，访问国内镜像偶有超时；workflow 中已用 `--registry=https://registry.npmjs.org` 兜底。