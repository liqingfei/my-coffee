# standalone 形态 — 单机部署

一台 ECS（无公网）跑 docker compose：`backend`（Node+Prisma+SQLite）+ `frontend`（nginx 托管 Vite 静态 + 反代 `/api` 到 backend）。SQLite 落命名卷 `coffee-data`，重部署不丢数据。

## 执行顺序

```bash
source ~/.aliyun-env
./01-build-images.sh   # 本地构建镜像，tag = git 短 sha（或 IMAGE_TAG 覆盖）
./02-push-acr.sh        # ACR 临时令牌登录，push 镜像
./03-ecs-deploy.sh      # ECS 上：装 docker/compose → 写 compose → login → pull → up -d → 首次 seed
./04-healthcheck.sh     # 验收：首页 / /api/menu / 镜像版本
```

## 变量（覆盖默认见 lib/common.sh）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `ECS_ID` | 空 | 目标 ECS 实例 ID（必填） |
| `ACR_REGISTRY` | registry.cn-hangzhou.aliyuncs.com | 建议填 **VPC 端点** |
| `ACR_NAMESPACE` | mycoffee | ACR 命名空间 |
| `ACR_INSTANCE_ID` | 空 | 企业版实例 ID（个人版留空） |
| `OSS_BUCKET` / `OSS_INTERNAL_HOST` | | 文件传输用内网签名（本形态 ECS 内不需，预留） |
| `IMAGE_TAG` | git 短 sha | 覆盖固定 tag/digest 做回滚 |

## 滚更（换镜像）

改代码 → 重跑 `01→02→03`，`docker compose pull && up -d` 仅镜像变化才重建，数据卷不动。固定 digest 回滚：`IMAGE_TAG=<旧digest> ./03-ecs-deploy.sh`。

## seed 说明

`prisma/seed.ts` 用「先清空再写入」实现幂等，**会同时清空 orders/deliveries**。因此 03 脚本只在**首次部署**（`/opt/my-coffee/.seeded` 不存在）时执行；强需重跑：`SEED_FORCE=1 ./03-ecs-deploy.sh`（会清空订单）。

## 对外入口

ECS 无公网，本形态仅内网 `宿主机:8080`。对外访问走 `../fc-gateway/`（FC 反代 + 免 ICP 域名）。
