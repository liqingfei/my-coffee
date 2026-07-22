#!/usr/bin/env bash
# 02-push-acr.sh — 登录 ACR（临时令牌，base64 传输）并推送后端/前端镜像
# 用法：source 仓库外 .env 后执行 ./02-push-acr.sh
# 注意：ACR_REGISTRY 应配置为 VPC 端点（如 registry-vpc.cn-hangzhou.aliyuncs.com），
#       ECS 侧 pull 与本机 push 均走内网，不经公网。
set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

BACKEND_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/my-coffee-backend:${IMAGE_TAG}"
FRONTEND_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/my-coffee-frontend:${IMAGE_TAG}"

log "获取 ACR 临时令牌…"
TOKEN_LINE="$(acr_token)"
ACR_USER="$(printf '%s' "${TOKEN_LINE}" | cut -f1)"
ACR_B64="$(printf '%s' "${TOKEN_LINE}" | cut -f2)"
[[ -n "${ACR_USER}" && -n "${ACR_B64}" ]] || die "acr_token 返回空，检查 ACR_INSTANCE_ID / AK 权限"

log "docker login（令牌经 base64 -d 管道传入，不落盘）…"
printf '%s' "${ACR_B64}" | base64 -d | docker login "${ACR_REGISTRY}" -u "${ACR_USER}" --password-stdin

log "推送后端镜像…"
docker push "${BACKEND_IMAGE}"
docker push "${ACR_REGISTRY}/${ACR_NAMESPACE}/my-coffee-backend:latest"

log "推送前端镜像…"
docker push "${FRONTEND_IMAGE}"
docker push "${ACR_REGISTRY}/${ACR_NAMESPACE}/my-coffee-frontend:latest"

# 记录 digest 供回滚（不缓存令牌，仅缓存镜像引用）
log "推送完成。回滚锚点："
log "  backend : ${BACKEND_IMAGE}"
log "  frontend: ${FRONTEND_IMAGE}"
log "如需固定 digest，用 docker inspect --format='{{.RepoDigests}}' ${BACKEND_IMAGE} 取值后重跑 03 脚本覆盖 IMAGE_TAG。"
