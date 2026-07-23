#!/usr/bin/env bash
# 03-ecs-deploy.sh — 在目标 ECS（无公网）上部署/滚更 my-coffee
# 通道：本地 aliyun CLI → RunCommand（base64 下发）→ 轮询结果。
# 幂等：重复执行 = 拉新镜像 + docker compose up -d（仅镜像变化才重建），
#       不删 coffee-data 卷、不丢 SQLite 数据。
# 用法：source 仓库外 .env 后执行 ./03-ecs-deploy.sh
#       可选：SEED_FORCE=1 ./03-ecs-deploy.sh  强制重跑 seed（会清空订单！）
set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

[[ -n "${ECS_ID}" ]] || die "缺少 ECS_ID（见 lib/env.example）"

BACKEND_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/my-coffee-backend:${IMAGE_TAG}"
FRONTEND_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/my-coffee-frontend:${IMAGE_TAG}"

# --- 本地取 ACR 临时令牌（ECS 上不一定有 aliyun CLI，故本地取后注入远端脚本） ---
log "获取 ACR 临时令牌…"
TOKEN_LINE="$(acr_token)"
ACR_USER="$(printf '%s' "${TOKEN_LINE}" | cut -f1)"
ACR_B64="$(printf '%s' "${TOKEN_LINE}" | cut -f2)"
[[ -n "${ACR_USER}" && -n "${ACR_B64}" ]] || die "acr_token 返回空"

SEED_FORCE="${SEED_FORCE:-0}"

log "组装远端部署脚本（镜像引用已注入）…"
# 远端脚本：内层 compose heredoc 用引号定界符 'YML'（远端不再展开），
# 外层用未引号 EOF（本地展开 ${BACKEND_IMAGE} 等为具体值）。
REMOTE_SCRIPT="$(cat <<EOF
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
echo "[remote] ensure docker + compose"
command -v docker >/dev/null 2>&1 || { yum -y -q install docker >/dev/null && systemctl enable --now docker; }
docker compose version >/dev/null 2>&1 || yum -y -q install docker-compose-plugin >/dev/null || true
mkdir -p /opt/my-coffee
cat > /opt/my-coffee/docker-compose.yml <<'YML'
services:
  backend:
    image: ${BACKEND_IMAGE}
    container_name: my-coffee-backend
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - PORT=3001
      - DATABASE_URL=file:/data/dev.db
    volumes:
      - coffee-data:/data
    networks:
      - coffee-net
  frontend:
    image: ${FRONTEND_IMAGE}
    container_name: my-coffee-frontend
    restart: unless-stopped
    ports:
      - "8080:80"
    depends_on:
      - backend
    networks:
      - coffee-net
volumes:
  coffee-data:
networks:
  coffee-net:
YML
cd /opt/my-coffee
echo "[remote] docker login ACR（令牌经 base64 -d 管道传入）"
printf '%s' '${ACR_B64}' | base64 -d | docker login '${ACR_REGISTRY}' -u '${ACR_USER}' --password-stdin
echo "[remote] pull images"
docker compose pull
echo "[remote] up -d（幂等：镜像不变则不重建，卷不删）"
docker compose up -d
echo "[remote] wait backend ready"
for i in \$(seq 1 30); do
  if docker exec my-coffee-frontend sh -c 'wget -qO- http://backend:3001/api/menu >/dev/null 2>&1 || curl -fsS http://backend:3001/api/menu >/dev/null 2>&1' 2>/dev/null; then
    echo "[remote] backend ready"; break
  fi
  sleep 2
done
# 首次部署才 seed（seed 会清空订单，绝不在有数据时重跑）
if [[ "${SEED_FORCE}" == "1" ]]; then
  echo "[remote] SEED_FORCE=1 → 强制 seed（将清空订单/菜单）"
  docker compose exec -T backend sh -c 'npx prisma db seed' || echo "[remote] seed 失败，请手动检查"
elif [[ ! -f /opt/my-coffee/.seeded ]]; then
  echo "[remote] 首次部署 → seed 初始菜单"
  docker compose exec -T backend sh -c 'npx prisma db seed' && touch /opt/my-coffee/.seeded || echo "[remote] seed 失败，请手动检查"
else
  echo "[remote] 已 seed 过，跳过（保留现有数据）"
fi
docker compose ps
EOF
)"

log "下发到 ECS ${ECS_ID}（超时 600s）…"
printf '%s' "${REMOTE_SCRIPT}" | run_on_ecs "${ECS_ID}" 600

log "部署完成。验证：./04-healthcheck.sh"
