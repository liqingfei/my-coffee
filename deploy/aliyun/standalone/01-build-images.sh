#!/usr/bin/env bash
# 01-build-images.sh — 本地构建 my-coffee 后端/前端镜像
# 用法：source 仓库外 .env 后执行 ./01-build-images.sh
set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

# 镜像引用（ACR VPC 端点；不走公网 push/pull）
export BACKEND_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/my-coffee-backend:${IMAGE_TAG}"
export FRONTEND_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/my-coffee-frontend:${IMAGE_TAG}"
export BACKEND_IMAGE_FRONTEND_DIGEST_TAG="${IMAGE_TAG}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

log "开始构建后端镜像 → ${BACKEND_IMAGE}"
docker build -f deploy/aliyun/standalone/Dockerfile.backend -t "${BACKEND_IMAGE}" "${REPO_ROOT}"

log "开始构建前端镜像 → ${FRONTEND_IMAGE}"
docker build -f deploy/aliyun/standalone/Dockerfile.frontend -t "${FRONTEND_IMAGE}" "${REPO_ROOT}"

# 顺带打 latest 软指向当前 tag，便于 ECS 侧 `docker compose pull` 默认拉最新
docker tag "${BACKEND_IMAGE}"  "${ACR_REGISTRY}/${ACR_NAMESPACE}/my-coffee-backend:latest"
docker tag "${FRONTEND_IMAGE}" "${ACR_REGISTRY}/${ACR_NAMESPACE}/my-coffee-frontend:latest"

log "构建完成。后端: ${BACKEND_IMAGE} | 前端: ${FRONTEND_IMAGE}"
log "下一步：执行 02-push-acr.sh 推送至 ACR。"
