# 商品价目查询（price-query）

移动端优先的价目查询站点。数据来自飞书多维表格，定时同步后在本地加密，静态部署到 Cloudflare Pages。

## 工作原理

```
飞书多维表格
   │  App ID + App Secret → tenant_access_token
   ▼
scripts/sync.mjs
   │  拉取全表记录 → 归一化 + 计算拼音首字母
   ▼
public/data/snapshot.enc.json
   │  PBKDF2(口令) → AES-256-GCM 加密
   ▼
Cloudflare Pages（纯静态，无后端）
   │  浏览器输入口令 → WebCrypto 本地解密
   ▼
价目列表（数据全程不落到明文文件）
```

设计要点：

- **密钥不落库**：飞书凭证只存在 `.env`（本地）和 GitHub Secrets（CI），仓库中无任何明文凭证。
- **数据密文不入库**：`public/data/` 已被 `.gitignore`，每次部署都由流水线重新生成。
- **口令即密钥**：`ACCESS_PASSCODE` 同时用于加密和页面解锁，改它等于换一份新数据密文。
- **密码强度**：PBKDF2-SHA256 / 15万次迭代 / AES-256-GCM，暴力破解成本足够高。

## 前置准备

### 1. 飞书多维表格

| 项目 | 说明 |
| --- | --- |
| `FEISHU_APP_ID` | 自建应用 App ID |
| `FEISHU_APP_SECRET` | 自建应用 App Secret |
| `FEISHU_APP_TOKEN` | 多维表格的「文档 token」（URL 里 `base/xxx?table=` 的那个 `xxx`）|
| `FEISHU_TABLE_ID` | 数据表 ID（URL 里 `table=tbl...`）|

自建应用需要：

1. 在飞书开放平台给应用开通权限：`bitable:app`（多维表格读取）。
2. **把应用加为该多维表格的协作者**（在表格右上角「共享」里添加应用），只开权限不加协作者会报 `91403` 之类的错误。
3. 应用版本需已发布（未发布的自建应用调开放接口会失败）。

表格字段名（**必须完全一致**，字段名改了同步会得到空值）：

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| 商品名称 | 文本 | 必填，为空则该行被丢弃 |
| 商品品牌 | 文本 | 品牌筛选 + 拼音搜索 |
| 所属分类 | 文本 | 分类筛选 |
| 商品条码 | 文本 | 条码精确查询 |
| 批发价 | 数字/文本 | 价格 |
| 零售价 | 数字/文本 | 价格 |
| 散称价 | 文本 | 可选 |
| 整箱\|整包 | 文本 | 可选 |

> 拼音首字母由脚本本地计算（品牌 + 商品名），数据表里**不需要**「拼音简称」字段。

### 2. Cloudflare

**先说清楚：不需要买服务器。** 本项目是纯静态站（3 个 HTML/CSS/JS + 1 个加密 JSON），
用Cloudflare Pages 免费托管，官方明确「无限站点、无限请求、无限带宽」，无需绑卡。

免费额度（PagesFree 计划）：

| 项目 | 免费额度 | 本项目用量 |
| --- | --- | --- |
| 静态请求 / 带宽 | **无限** | 每天几十次 |
| 构建次数 | 500 次/月 | 约 30 次/月（每日刷新） |
| 并发构建 | 1 | 1 |
| 站点数 / 自定义域名 | 100 / 100 | 1 / 0 |
| 单文件上限 | 25 MiB | 最大约 56 KB |

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

## 部署

### 方式A：GitHub Actions（推荐）

已配置好的工作流 `.github/workflows/deploy.yml`，三种触发方式：

| 触发 | 说明 |
| --- | --- |
| `push` 到 `main` | 代码改动后自动部署 |
| `schedule` | 每天 UTC 22:00（北京 06:00）自动刷新价目数据 |
| `workflow_dispatch` | 手动触发，Actions 页面点「Run workflow」 |

流程：检出代码 → 装依赖 → `npm run sync` 拉数据并加密 → 确保 Pages 项目存在 → 部署。

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
npm run sync    # 生成本地加密快照
npm run dev     # wrangler pages dev public，本地预览
```

调试时用 `--skip-deploy` 只更新快照，改前端刷新即可看到新数据。

## 目录结构

```
├─ public/                  # 站点根目录，直接被部署
│  ├─ index.html
│  ├─ app.js                # 口令解锁 + 解密 + 筛选渲染
│  ├─ style.css
│  └─ data/snapshot.enc.json  # 密文快照（不入库，流水线生成）
├─ scripts/
│  ├─ sync.mjs              # 主流程：拉数据 → 加密 → 落盘
│  ├─ publish.mjs           # 本地一键发布
│  ├─ sync-secrets.mjs      # .env → GitHub Secrets/Variables 同步
│  └─ lib/
│     ├─ feishu.mjs         # tenant_access_token + 分页拉取
│     └─ snapshot.mjs       # 字段归一化 + 拼音 + AES-GCM 加密
├─ .github/workflows/deploy.yml
└─ wrangler.toml
```

## 故障排查

| 现象 | 原因 |
| --- | --- |
| `获取 tenant_access_token 失败` | App ID/Secret 错，或应用未发布 |
| `读取记录失败: 91403` | 应用没被加为多维表格协作者 |
| `读取记录失败` 但能拿到 token | 缺 `bitable:app` 权限 |
| 同步成功但页面报「无法加载数据快照文件」 | 快照没生成，检查 `public/data/` 是否被 `.gitignore` 误排除后仍需确认部署产物 |
| 输入口令提示「口令不正确」 | 线上 Secret 的 `ACCESS_PASSCODE` 与你手上的口令不一致 |
| CI 报依赖安装失败 | lock 文件指向国内镜像，可改用官方源，见下|
| 搜索拼音不生效 | 确认 `pinyin-pro` 已安装（`npm ci` 必须在 `npm run sync` 之前） |

lock 文件目前解析到 `registry.npmmirror.com`。GitHub Actions 的runner 在海外，访问国内镜像偶有超时；workflow 中已用 `--registry=https://registry.npmjs.org` 兜底。