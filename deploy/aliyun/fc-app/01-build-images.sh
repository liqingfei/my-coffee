#!/usr/bin/env bash
# 01-build-images.sh — 本地构建 my-coffee FC custom-container 镜像（方案二）
# 设计阶段模板：待 DESIGN.md 评审通过 + 后端 Prisma sqlite→postgresql 迁移落地后执行。
set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

export FC_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/my-coffee-fc:${IMAGE_TAG}"
log "构建 FC custom-container 镜像 → ${FC_IMAGE}"
docker build -f deploy/aliyun/fc-app/Dockerfile.fc -t "${FC_IMAGE}" "${REPO_ROOT}"
docker tag "${FC_IMAGE}" "${ACR_REGISTRY}/${ACR_NAMESPACE}/my-coffee-fc:latest"
log "构建完成。下一步：./02-push-acr.sh"
