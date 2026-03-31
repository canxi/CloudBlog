# CloudBlog

基于 Cloudflare Workers 的边缘博客平台，支持文章发布、评论管理、媒体上传、PWA 等功能。

## 功能特性

- 📝 Markdown 文章撰写与渲染（代码高亮、Mac 风格代码块）
- 💬 评论系统（待审/通过/垃圾标记）
- 🖼️ 媒体文件上传（R2 对象存储）
- 🔍 边缘搜索（Cloudflare Workers Search）
- 📱 响应式设计（移动端适配）
- 🔐 管理员认证（强制修改默认密码）
- 🛡️ PWA 支持（可安装到桌面）

## 技术栈

- **运行时**: Cloudflare Workers (Workerd)
- **语言**: TypeScript
- **框架**: Hono
- **数据库**: Cloudflare D1 (SQLite)
- **存储**: Cloudflare R2 (对象存储)
- **缓存**: Cloudflare KV
- **样式**: 原生 CSS（响应式设计）
- **Markdown**: marked.js

## 项目结构

```
cloudblog/
├── public/                  # 静态文件
│   ├── index.html          # 首页
│   ├── post.html           # 文章详情页
│   ├── write.html          # 写文章页
│   └── admin/              # 管理后台
│       ├── index.html      # 管理面板
│       └── login.html      # 登录页
├── src/
│   ├── index.ts            # 入口文件，路由配置
│   ├── routes/             # API 路由
│   │   ├── posts.ts       # 文章 CRUD
│   │   ├── comments.ts     # 评论管理
│   │   ├── auth.ts         # 认证
│   │   ├── media.ts        # 媒体上传
│   │   ├── search.ts       # 搜索
│   │   ├── migration.ts    # 数据库迁移
│   │   └── init.ts         # 初始化
│   ├── middleware/         # 中间件
│   │   └── auth.ts         # 会话认证
│   ├── db/                 # 数据库
│   │   └── schema.sql      # 表结构
│   └── types/              # 类型定义
│       └── migration.ts
├── test/                   # 测试
└── package.json
```

## 部署前准备

### 1. 创建 Cloudflare 账号

前往 [Cloudflare Dashboard](https://dash.cloudflare.com/) 注册账号。

### 2. 安装 Wrangler CLI

```bash
npm install -g wrangler
# 或使用 npx
npx wrangler --version
```

### 3. 创建 Cloudflare 资源

在 Cloudflare Dashboard 中创建以下资源：

#### D1 数据库
```bash
wrangler d1 create cloudblog-db
```
创建后会返回 `database_id`，记录备用。

#### KV 命名空间
```bash
wrangler kv:namespace create IMPORT_KV
wrangler kv:namespace create SEARCH_KV
```
记录返回的 `id`。

#### R2 存储桶
在 Cloudflare Dashboard → R2 → 创建存储桶，命名为 `cloudblog-images`。

### 4. 配置环境变量

创建 `wrangler.toml` 配置文件：

```toml
name = "cloudblog"
main = "src/index.ts"
compatibility_date = "2024-01-01"
assets = "public"

[env.production]
name = "cloudblog"

[[env.production.kv_namespaces]]
binding = "IMPORT_KV"
id = "你的IMPORT_KV_ID"

[[env.production.kv_namespaces]]
binding = "SEARCH_KV"
id = "你的SEARCH_KV_ID"

[[env.production.d1_databases]]
binding = "DB"
database_name = "cloudblog-db"
database_id = "你的D1数据库ID"

[[env.production.r2_buckets]]
binding = "IMAGES_BUCKET"
bucket_name = "cloudblog-images"
```

### 5. 初始化数据库

执行数据库迁移，创建表结构：

```bash
# 远程 D1 数据库
wrangler d1 execute cloudblog-db --remote --file=./src/db/schema.sql

# 本地开发用
wrangler d1 execute cloudblog-db --local --file=./src/db/schema.sql
```

## 本地开发

### 1. 安装依赖

```bash
npm install
```

### 2. 启动开发服务器

```bash
npm run dev
```

访问 `http://localhost:8787`

### 3. 本地数据库操作

```bash
# 查看数据库
wrangler d1 databases list

# 执行 SQL
wrangler d1 execute cloudblog-db --local --command="SELECT * FROM users"

# 查看表结构
wrangler d1 execute cloudblog-db --local --file=./src/db/schema.sql
```

## 部署到生产环境

### 方式一：Wrangler CLI 部署

```bash
# 设置 Cloudflare API Token
export CLOUDFLARE_API_TOKEN="你的API_Token"

# 部署
npm run deploy
```

**获取 API Token**: Cloudflare Dashboard → 右上角头像 → API Tokens → 创建自定义 Token

### 方式二：指定环境变量部署

```bash
CLOUDFLARE_API_TOKEN="你的API_Token" npx wrangler deploy
```

### 部署后验证

```bash
# 查看部署状态
wrangler deployments list

# 查看实时日志
wrangler tail
```

## 管理员使用

### 默认账号

首次部署后，使用以下默认账号登录管理后台：

- **用户名**: `admin`
- **密码**: `admin123`

⚠️ **重要**: 首次登录后系统会强制要求修改密码，请立即更改。

### 管理后台地址

```
https://你的域名/admin/
```

### 功能

- 📊 **概览**: 查看文章总数、待审评论等统计
- 📝 **文章管理**: 查看、编辑、删除所有文章（包括草稿）
- 💬 **评论管理**: 审核评论、标记垃圾、删除

## API 接口

### 公开接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/posts` | 获取文章列表 |
| GET | `/api/posts/:slug` | 获取单篇文章 |
| GET | `/api/comments/:slug` | 获取文章评论 |
| POST | `/api/comments` | 提交评论 |
| GET | `/api/search?q=` | 搜索文章 |

### 认证接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/auth/status` | 获取认证状态（公开） |
| GET | `/api/auth/me` | 获取当前用户信息 |
| POST | `/api/auth/change-password` | 修改密码 |

### 管理接口（需认证）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/posts` | 获取所有文章（含草稿） |
| POST | `/api/posts` | 创建文章 |
| PUT | `/api/posts/:slug` | 更新文章 |
| DELETE | `/api/posts/:slug` | 删除文章 |
| GET | `/api/admin/comments` | 获取所有评论 |
| PATCH | `/api/admin/comments/:id` | 审核评论 |
| DELETE | `/api/admin/comments/:id` | 删除评论 |
| POST | `/api/media/upload` | 上传媒体文件 |

## 博客地址

部署成功后可通过 Workers 分配的域名访问，或在 Cloudflare Dashboard 配置自定义域名。

## 常见问题

### Q: 部署后数据库报错？
A: 确保已执行 `wrangler d1 execute` 创建表结构，并正确配置 `wrangler.toml` 中的 `database_id`。

### Q: 图片上传失败？
A: 检查 R2 存储桶权限配置，确保 Workers 有权限写入。

### Q: 登录失败？
A: 检查 D1 数据库中是否有 `users` 表，以及管理员账号是否创建。可手动执行 `src/routes/init.ts` 中的逻辑。

### Q: 如何查看日志？
A: 使用 `wrangler tail` 查看实时日志，或在 Cloudflare Dashboard → Workers & Pages → 你的 Worker → 日志。

## 开发指南

### 代码规范

- 使用 TypeScript，严格类型检查
- API 错误返回统一格式：`{ error: '错误信息' }`
- 敏感操作需要管理员认证

### 测试

```bash
npm test
```

### 构建

```bash
npm run build
```

## License

MIT
