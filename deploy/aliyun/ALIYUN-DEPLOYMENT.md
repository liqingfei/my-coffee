# my-coffee 阿里云部署方案

> 状态：**工具与脚本就绪**（deploy/aliyun/ 下全部生成并通过 bash 语法校验）。
> 待人工/控制台补齐：AK 权限、ECS 实例、ACR/OSS 资源、对外入口域名。
> 本文件给出架构、资源创建全过程、方案对比与踩坑。

## 方案选型结论（2026-07-21）

@aidbs-demo 拍板：**方案二（FC + RDS PostgreSQL，整体上 FC）**。详细设计见 [`fc-app/DESIGN.md`](fc-app/DESIGN.md)（方案设计阶段产出，待 CR review + TL 验收）。
- 方案一（ECS+compose+SQLite 卷）：`standalone/` 形态已就绪，作为备选/二期迁移起点。
- 方案三（FC+NAS+SQLite）：NFS 锁风险已排除，不采用。
- SQLite 不直接上 FC：FC 实例无状态/临时，本地文件会丢数据+并发不一致（团队共识）。

## 方案二关键约束（CR 门禁）
- 优雅关闭顺序：`SIGTERM → server.close() 拒新 → drain → prisma.$disconnect() → exit`（`fc-app/fc-server.js`）
- 连接池数学：`instanceConcurrency(10) × connection_limit(3) = 60 ≤ RDS max_connections(2420 实测真值)`，余量 40× 极充足；超阈值启用 RDS Proxy
- 待 RDS PostgreSQL 就绪（③ 主实例直连端点+prod 库）后执行 01→04；Prisma sqlite→postgresql 迁移已落 main（7c0d58a）

## 一、形态决策

my-coffee 运行组件：1 个 Node 后端（Express+Prisma+SQLite，端口 3001，API 在 `/api`）+ 1 个静态前端（Vite 构建，开发期 `/api` 代理到 3001）+ SQLite 文件库。体量小、单库、无外部依赖。

**选型：单机 standalone** — 一台 ECS + docker compose：

- `backend` 容器：`prisma migrate deploy` 自启动 + `node dist/index.js`，SQLite 落命名卷 `coffee-data`。
- `frontend` 容器：nginx 托管 Vite 静态 + `/api` 反代到 `backend:3001`，宿主机 `8080:80`（仅内网）。
- 对外入口：FC 反代 + 免 ICP 域名（可选，规避安全基线封端口）。

**未选**：web/server/db 分离（过度设计，SQLite 本就文件库）；FC-as-app（Express 常驻更适合容器长驻，FC 适合入口而非承载）。

## 二、架构图

```
            ┌─────────────┐  HTTPS  ┌─────────────┐
 外网用户 ──>│ FC HTTP 触发 │────────>│  (可选入口)  │  fc-gateway
            │  免ICP域名   │         │  fetch 内网  │
            └─────────────┘         └──────┬──────┘
                                           │ VPC 内网
                                           ▼
                          ┌──────────────────────────────┐
                          │  ECS（无公网）docker compose   │
                          │  ┌──────────┐   ┌──────────┐ │
                          │  │ frontend │──>│ backend  │ │
                          │  │ nginx:80 │/api│ node:3001│ │
                          │  └──────────┘   └────┬─────┘ │
                          └──────────────────────┼──────┘
                                                 ▼
                                     命名卷 coffee-data (dev.db)
```

## 三、资源创建全过程（首次）

1. **AK**：RAM 子账号，授予 `AliyunECSFullAccess` / `AliyunContainerRegistryFullAccess` / `AliyunOSSFullAccess` / `FCFullAccess`（按需收敛）。→ 填入仓库外 `.env`。
2. **ECS**（控制台或 CLI）：选有货非退市规格族（用 `DescribeResourcesModification` 查可改配集合），系统盘 Alibaba Cloud Linux，**不开公网**，记 `ECS_ID`、内网 IP。安全组仅放行 VPC 内网。
3. **ACR**：个人版实例或企业版。建命名空间 `mycoffee`。`ACR_REGISTRY` 填 **VPC 端点**（`registry-vpc.<region>.aliyuncs.com`）。
4. **OSS**（预留文件传输通道，本形态可暂不建）：bucket，记 `OSS_BUCKET`。
5. **FC**（对外入口，可选）：同 VPC，HTTP 触发器 + 免 ICP 域名。

脚本不创建上述资源（避免误建/计费），仅消费已存在的 ID/IP。

## 四、部署流程（脚本链）

```
01-build-images   本地 docker build backend/frontend → tag=git sha
02-push-acr       acr_token → docker login → push 镜像（VPC 端点）
03-ecs-deploy     RunCommand 下发：装 docker/compose → 写 compose.yml
                  → ACR login(令牌base64注入) → pull → up -d → 首次 seed
04-healthcheck    ECS 内 curl 首页 + /api/menu + 校验镜像 tag
```

## 五、方案对比

| 维度 | 单机 standalone（选） | web/server/db 分离 | FC-as-app |
| --- | --- | --- | --- |
| 适用 | 单库小应用 ✅ | 多服务/独立 DB | 事件驱动/短时 |
| 成本 | 1 ECS | 2~3 ECS | 按调用 |
| 运维 | 低 | 中 | 中 |
| my-coffee 契合 | 高（SQLite 文件库天然单机） | 过度设计 | Express 长驻更适合容器 |

## 六、踩坑记录

- **账号安全基线封 ECS 公网端口**：对外入口用 FC 反代 + 免 ICP 域名，不直绑 EIP/高位端口。
- **ECS 无公网**：远程执行只走 `run_on_ecs`（RunCommand+base64，规避转义）；文件传输走 OSS 内网签名 URL；不假设 SSH。
- **ACR 令牌含特殊字符**：`acr_token` 输出 `USER\tBASE64_TOKEN`，调用方 `base64 -d | docker login --password-stdin`，不落盘、不缓存。
- **seed 会清空订单**：`prisma/seed.ts` 用 deleteMany 实现幂等，会删 orders/deliveries → 03 脚本仅首次部署执行（`.seeded` 标记），`SEED_FORCE=1` 才强制。
- **SQLite 卷不可删**：03 用 `docker compose up -d`（不 `down -v`），`coffee-data` 卷跨重部署保留。
- **ECS 改配需停机**：跨规格族受兼容集合限制，部分停售（`out of usage`）；用 `DescribeResourcesModification` 查可改集合。
- **可移植性**：`$var` 紧贴中文一律 `${var}`（macOS bash 3.2 兼容）；aliyun CLI 命令显式带 `--region`。
- **FC 换镜像/代码**：直接 `s deploy` 覆盖（免本地 build 重建函数）；FC 从 ACR VPC 端点拉镜像。

## 七、回滚预案

镜像用 tag（= git sha）固定；出问题 `IMAGE_TAG=<旧tag> ./03-ecs-deploy.sh` 重跑滚回旧镜像，数据卷不动。需精确回滚可固定 digest：`docker inspect --format='{{.RepoDigests}}' <image>` 取值后覆盖 `IMAGE_TAG`。

## 八、验收清单（缺一不可）

- [ ] `04-healthcheck.sh`：前端首页可达（含 HTML）
- [ ] `/api/menu` 返回菜单 JSON
- [ ] 容器镜像 tag == 预期 `IMAGE_TAG`
- [ ] `coffee-data` 卷存在（数据保留）
- [ ] 对外入口（若启用 FC）：`curl https://<域名>/api/menu` 通

## 九、交付报告格式

每次部署输出：目标形态 | 镜像来源+tag(digest) | 新增/修改脚本文件 | 验收结果(首页/API/版本/入口) | 是否保留数据 | 遗留风险/回滚点。
