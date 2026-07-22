#!/usr/bin/env bash
# 02-push-acr.sh — ACR 临时令牌登录（base64 传输）并推送 FC 镜像到 ACR VPC 端点
set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

FC_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/my-coffee-fc:${IMAGE_TAG}"
log "获取 ACR 临时令牌…"
TOKEN_LINE="$(acr_token)"
ACR_USER="$(printf '%s' "${TOKEN_LINE}" | cut -f1)"
ACR_B64="$(printf '%s' "${TOKEN_LINE}" | cut -f2)"
[[ -n "${ACR_USER}" && -n "${ACR_B64}" ]] || die "acr_token 返回空"

log "docker login（令牌 base64 -d 管道传入，不落盘）…"
printf '%s' "${ACR_B64}" | base64 -d | docker login "${ACR_REGISTRY}" -u "${ACR_USER}" --password-stdin

log "推送 FC 镜像…"
docker push "${FC_IMAGE}"
docker push "${ACR_REGISTRY}/${ACR_NAMESPACE}/my-coffee-fc:latest"
log "推送完成。回滚锚点：${FC_IMAGE}"
log "下一步：./03-fc-deploy.sh"
