#!/usr/bin/env bash
# 04-healthcheck.sh — 验收：前端可达 / 后端 API 可达 / 镜像版本符合预期
# 在 ECS 内网本地 curl（经前端 nginx 8080 反代到后端 /api）。
# 用法：source 仓库外 .env 后执行 ./04-healthcheck.sh
set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

[[ -n "${ECS_ID}" ]] || die "缺少 ECS_ID"

BACKEND_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/my-coffee-backend:${IMAGE_TAG}"
FRONTEND_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/my-coffee-frontend:${IMAGE_TAG}"

REMOTE_SCRIPT="$(cat <<EOF
set -euo pipefail
command -v curl >/dev/null 2>&1 || yum -y -q install curl >/dev/null
echo "=== 前端首页 ==="
curl -fsS http://localhost:8080/ | head -c 200; echo
echo "=== 后端菜单 API ==="
curl -fsS http://localhost:8080/api/menu | head -c 300; echo
echo "=== 容器镜像版本 ==="
docker inspect my-coffee-frontend --format 'frontend image: {{.Config.Image}}'
docker inspect my-coffee-backend  --format 'backend  image: {{.Config.Image}}'
echo "=== 数据卷 ==="
docker volume ls | grep coffee-data || true
EOF
)"

log "在 ECS ${ECS_ID} 上执行验收…"
OUTPUT="$(printf '%s' "${REMOTE_SCRIPT}" | run_on_ecs "${ECS_ID}" 120 || true)"
printf '%s\n' "${OUTPUT}"

# 校验版本（镜像引用应等于预期 tag）
if printf '%s' "${OUTPUT}" | grep -q "${FRONTEND_IMAGE}" \
   && printf '%s' "${OUTPUT}" | grep -q "${BACKEND_IMAGE}"; then
  log "✅ 镜像版本符合预期（${IMAGE_TAG}）"
else
  die "❌ 镜像版本不符预期，期望 backend=${BACKEND_IMAGE} frontend=${FRONTEND_IMAGE}"
fi

printf '%s\n' "${OUTPUT}" | grep -q 'api/menu' && log "✅ 后端 /api/menu 可达" || die "❌ 后端 /api/menu 不可达"
printf '%s\n' "${OUTPUT}" | grep -Eq '<!DOCTYPE|<div|<html|<title' && log "✅ 前端首页可达" || die "❌ 前端首页不可达"

log "验收通过。数据卷 coffee-data 保留（未删除）。"
