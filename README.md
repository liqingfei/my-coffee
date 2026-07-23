# my-coffee（希希咖啡店）

多 Agent 协同咖啡点单系统。npm workspaces monorepo：后端 Express + TypeScript + Prisma（PostgreSQL），前端 React + Vite。生产形态 = 阿里云 FC3 custom-container 函数（单函数同时托管 `/api` 与前端静态资源）+ RDS PostgreSQL（VPC 内网）。

## 仓库结构

```
packages/backend/        后端源码（src/app.ts、src/index.ts、src/routes/{menu,orders,deliveries}.ts、src/lib/prisma.ts）
packages/backend/prisma/ schema.prisma + migrations + seed
packages/frontend/       前端源码（React + Vite）
qa-e2e/                  Playwright E2E 测试
docs/                    设计文档（A2 数据层设计等）
deploy/aliyun/fc-app/    生产部署脚本（FC + RDS，方案二，主路径）
deploy/aliyun/standalone/  单机部署脚本（docker-compose，备用形态）
```

## 开发

**前置**：Node 20+、本地或可达的 PostgreSQL 实例。

```bash
npm install                          # 安装依赖（postinstall 自动 prisma generate）

export DATABASE_URL="postgresql://<user>:<pass>@<host>:5432/<db>?connection_limit=3"
npm -w packages/backend run prisma:migrate   # 建表（dev 环境；生产用 prisma:deploy）
npm -w packages/backend run db:seed          # 种子数据

npm run dev                          # 同时起后端 + 前端
```

- 后端：`http://localhost:3001`（`PORT` 可覆盖）
- 前端：`http://localhost:5173`，开发期 `/api` 代理到后端 3001，无跨域

**质量门禁**：

```bash
npm test                # jest 后端测试（--runInBand）
npm run test:coverage   # 带覆盖率
npm run lint            # eslint
npx playwright test --config=qa-e2e/...   # E2E（staging 自签证书可设 E2E_IGNORE_CERT=1 跳过校验）
```

**约定**：

- 数据库连接单一事实源 = `DATABASE_URL`（连接池参数 `connection_limit` 钉在 URL 串尾，不再另读 env，见 docs/A2-data-layer-design.md）。
- schema 变更必须补 up/down migration；服务启动自动应用 migration。
- schema.prisma 的 `binaryTargets` 钉了 `linux-musl-openssl-3.0.x`（FC Alpine 3 镜像需要），本地 generate 不受影响，勿删。

## 部署与发布（生产：FC + RDS PostgreSQL）

脚本在 `deploy/aliyun/fc-app/`，架构设计见同目录 `DESIGN.md`。发布 = 构建镜像 → 推 ACR → 跑 migration → 换 FC 函数镜像 → 验收 →（首次）绑域名：

```bash
source ~/.aliyun-env        # 凭证模板见 deploy/aliyun/lib/env.example（放仓库外，chmod 600，勿提交）
cd deploy/aliyun/fc-app

./01-build-images.sh        # docker build Dockerfile.fc → ${ACR_REGISTRY}/${ACR_NAMESPACE}/my-coffee-fc:${IMAGE_TAG}
./02-push-acr.sh            # ACR 临时令牌登录（不落盘）→ push 镜像
./02b-migrate.sh            # prisma migrate deploy，fail-first：schema 先于代码，失败即中止，函数不会接到期待新 schema 的代码
./03-fc-deploy.sh           # FC3.0 API 幂等部署：函数不存在则 Create，存在则 Update 换镜像（IMAGE_TAG 必须显式传入）
./04-healthcheck.sh         # 验收免 ICP 域名：/api/health + /api/menu + 前端首页
./05-bind-domain.sh         # 首次：绑 devsapp.net 自定义域（HTTPS-only，免 ICP）
```

**回滚**：`IMAGE_TAG=<旧tag> ./03-fc-deploy.sh` —— 只换函数镜像引用，RDS 数据不受影响。前提是 schema 变更保持 additive-only（新 schema 兼容旧代码，回滚窗口才安全）。

**关键约束**（详见 DESIGN.md）：

- FC 函数无状态，数据全落 RDS；FC 与 RDS 同 VPC 内网连通。
- 优雅关闭：`SIGTERM → server.close() 拒新请求 → drain → prisma.$disconnect() → exit`。
- 连接池数学：`instanceConcurrency(10) × connection_limit(3) = 30~60 ≪ RDS max_connections`，超阈值再启用 RDS Proxy。
- 鉴权走 ECS 实例 RAM 角色 STS，不回退静态 AK；`RDS_DATABASE_URL` 等敏感值经环境变量注入，不进命令行参数、不落盘。

**备用形态**：`deploy/aliyun/standalone/`（docker-compose 单机：后端 + 前端 + nginx），脚本同构（01 build → 02 push → 03 ecs-deploy → 04 healthcheck）。

## 分支模型

- `main`：主干，只接受 PR 合入。
- `feat/*`、`fix/*`、`qa/*`：功能分支，PR 合入 main。
- `deploy/aliyun-fc`：部署脚本演进分支（已合入 main，后续部署脚本变更仍走 PR）。
