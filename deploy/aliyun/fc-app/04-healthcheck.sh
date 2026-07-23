#!/usr/bin/env bash
# 04-healthcheck.sh — 验收：FC 免ICP 域名 /api/health + /api/menu + 前端首页
# 前置：03-fc-deploy.sh 完成，FC HTTP 触发器域名已知。
set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

: "${FC_DOMAIN:?缺少 FC_DOMAIN（FC HTTP 触发器免ICP域名，如 https://<acct>.<region>.fcapp.run）}"
FC_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/my-coffee-fc:${IMAGE_TAG}"

log "验收 FC 入口：${FC_DOMAIN}"
echo "=== /api/health ==="
curl -fsS "${FC_DOMAIN}/api/health" | head -c 200; echo
echo "=== /api/menu ==="
curl -fsS "${FC_DOMAIN}/api/menu" | head -c 300; echo
echo "=== 前端首页 ==="
curl -fsS "${FC_DOMAIN}/" | head -c 200; echo

log "✅ /api/health 可达"
curl -fsS "${FC_DOMAIN}/api/health" | grep -q 'ok' || die "❌ /api/health 未返回 ok"
curl -fsS "${FC_DOMAIN}/api/menu" >/dev/null || die "❌ /api/menu 不可达"
curl -fsS "${FC_DOMAIN}/" | grep -Eq '<!DOCTYPE|<html|<div|<title' || die "❌ 前端首页不可达"
log "✅ /api/menu 可达"
log "✅ 前端首页可达"
log "验收通过。镜像 ${FC_IMAGE}。RDS 数据持久（FC 实例无状态，DB 在 RDS）。"
