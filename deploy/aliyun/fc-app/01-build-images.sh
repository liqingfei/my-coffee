#!/usr/bin/env bash
# 01-build-images.sh — 本地构建 my-coffee FC custom-container 镜像（方案二）
# DESIGN.md 已 CR🟢+TL 验收通过、Prisma sqlite→postgresql 迁移已落 main（7c0d58a）；执行前 ~/.aliyun-env 注入 AK+ACR（common.sh :? fail-loud）。
set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

export FC_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/my-coffee-fc:${IMAGE_TAG}"
log "构建 FC custom-container 镜像 → ${FC_IMAGE}"
docker build -f deploy/aliyun/fc-app/Dockerfile.fc -t "${FC_IMAGE}" "${REPO_ROOT}"
docker tag "${FC_IMAGE}" "${ACR_REGISTRY}/${ACR_NAMESPACE}/my-coffee-fc:latest"
log "构建完成。下一步：./02-push-acr.sh"
