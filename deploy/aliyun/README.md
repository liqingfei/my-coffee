# my-coffee 阿里云部署

my-coffee（希希咖啡店：Express+Prisma 后端 / React+Vite 前端）在阿里云的部署资源。方案二（已选定）= FC custom-container + RDS PostgreSQL；方案一备选 standalone = ECS + SQLite 卷。

## 目录索引

| 路径 | 说明 |
| --- | --- |
| `lib/env.example` | 凭证与资源变量模板（复制到仓库外填值后 source） |
| `lib/common.sh` | 公共库：凭证校验 / AK_ARGS / log·die / run_on_ecs / oss_sign / acr_token |
| `standalone/` | **方案一/备选**单机形态（一台 ECS + docker compose：backend + nginx 前端 + SQLite 卷） |
| `fc-app/` | **方案二（已选定）**整体上 FC：单 FC custom-container 函数（/api+静态）+ RDS PostgreSQL，免 ICP 域名入口。见 `fc-app/DESIGN.md` |
| `standalone/Dockerfile.backend` / `Dockerfile.frontend` / `nginx.conf` / `docker-compose.yml` | 镜像与编排 |
| `standalone/01-build-images.sh` | 本地构建 backend/frontend 镜像 |
| `standalone/02-push-acr.sh` | 推送至 ACR（临时令牌，base64 传输） |
| `standalone/03-ecs-deploy.sh` | 在 ECS 上幂等部署/滚更（不丢数据） |
| `standalone/04-healthcheck.sh` | 验收：首页/API/镜像版本 |
| `fc-gateway/` | 对外入口（方案一配套）：FC 反代 ECS 内网 + 免 ICP 域名 |
| `ALIYUN-DEPLOYMENT.md` | 部署方案：架构 / 资源创建全过程 / 各方案对比 / 踩坑 / 方案二选型记录 |

## 快速开始

```bash
# 1) 准备仓库外凭证文件（绝不提交）
cp deploy/aliyun/lib/env.example ~/.aliyun-env
chmod 600 ~/.aliyun-env
vi   ~/.aliyun-env      # 填 AK / ECS_ID / ACR / OSS / 等
source ~/.aliyun-env

# 2) 构建 → 推送 → 部署 → 验收
cd deploy/aliyun/standalone
./01-build-images.sh
./02-push-acr.sh
./03-ecs-deploy.sh
./04-healthcheck.sh
```

## 约定

- 凭证不入库：只走仓库外 `.env`（source）或运行容器读取；提交前必扫敏感串。
- ECS 无公网：远程执行只走 `run_on_ecs`（RunCommand+base64），文件传输走 OSS 内网签名 URL；不假设 SSH。
- 镜像走 ACR VPC 端点，令牌临时、不缓存。
- 资源全变量化：默认值集中在 `lib/common.sh`，换环境只改环境变量。
- 脚本幂等可单独重跑：换镜像优先滚更（pull+up -d），重部署不删 `coffee-data` 卷。

## 在线环境表

> 部署后在此登记当前线上 ECS_ID / 镜像 tag(digest) / 入口，便于回滚定位。

| 日期 | ECS_ID | 后端镜像 tag(digest) | 前端镜像 tag(digest) | 对外入口 | 备注 |
| --- | --- | --- | --- | --- | --- |
| _待首次部署后填写_ | | | | | |
