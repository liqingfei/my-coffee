#!/usr/bin/env bash
# 03-fc-deploy.sh — 用 s deploy 部署/更新 my-coffee FC 函数（方案二）
# 幂等：重跑 = UpdateFunction（换镜像），FC 从 ACR VPC 拉新镜像，不重建函数。
# 前置：RDS PostgreSQL 就绪（VPC 连接串+凭证）、FC VPC/安全组就绪、后端 Prisma 迁移已落地。
set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"
export PATH="/opt/node/bin:${PATH}"   # s CLI 在此路径

: "${RDS_DATABASE_URL:?缺少 RDS_DATABASE_URL（仓库外 .env 注入 RDS 内网连接串）}"
: "${FC_VPC_ID:?缺少 FC_VPC_ID}"
: "${FC_VSWITCH_ID:?缺少 FC_VSWITCH_ID}"
: "${FC_SG_ID:?缺少 FC_SG_ID}"

cd "$(dirname "$0")"
log "s deploy（s.yaml）部署/更新 FC 函数…"
s deploy --use-remote   # 用远程 s.yaml 解析，本地无 docker 也能部署（镜像已在 ACR）

log "部署完成。下一步：./04-healthcheck.sh"
log "回滚：IMAGE_TAG=<旧tag/digest> ./03-fc-deploy.sh"
