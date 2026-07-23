#!/usr/bin/env bash
# 02b-migrate.sh — RDS PostgreSQL schema migrate（fail-first 独立部署步骤）
#
# 缘起（CR aohix7ut + TL ebwcq4mj/cd9be9qo 设计裁）：prisma migrate deploy 从 FC 冷启
#   路径移出 → 独立 ECS 步骤。根因（ls 实证 @prisma/engines + .prisma/client）：query engine
#   本已焙（build `npx prisma generate`+runtime COPY node_modules，.prisma/client dlopen 位），
#   schema engine 亦已焙（@prisma/engines postinstall 焙 `schema-engine-linux-musl` executable）。
#   FC 受限沙箱扰动平台探测 → CLI 误下载 openssl-1.1.x 变体（非用已焙 musl 品）→ musl 根文件系统
#   加载该变体失败 → garbage 输出→parse error+EPERM。移出 migrate 后 FC 零 schema engine 需求
#   （FC 只 `node fc-server.js` 走 query dlopen 路，零 download/execve）；migrate 走本脚本
#   （ECS podman 无沙箱扰动→探测正确返回 linux-musl→CLI 用已焙 schema-engine-linux-musl，零下载）。
#   C4「并发冷启 migrate 不死锁」验收项整类消灭（特殊情况本身消除非修复）。
#
# 机制：podman run --rm -e DATABASE_URL <local-image> npx prisma migrate deploy
#   - 镜像本地（01 已 build :IMAGE_TAG）→ 零 ACR pull / 零新 RAM action（RAM-neutral，
#     migrate=DATABASE_URL SQL 连接 fc_user DB owner，非 RAM API 面）
#   - DATABASE_URL 经 `-e DATABASE_URL`（**仅键名无 `=`值**）从父 env 拷贝→值不入 podman argv
#     （ps 面最小暴露，门禁⑥ / 最小暴露 475hrbwc）；父 env 由 export 注入（非 argv）
#   - 命令 `npx prisma migrate deploy` 替换镜像 CMD（Dockerfile.fc CMD exec-form
#     `["sh","-c","migrate && node fc-server.js"]`，run args 替换 CMD 不论 form），经 node 基镜
#     ENTRYPOINT docker-entrypoint.sh `exec "$@"` 落 migrate-only（不起 server）。ls 实证此路通
#     （docker run <img> ls -l … 已返输出=command-replacement via entrypoint exec 生效）
#   - schema engine：ECS podman 无沙箱扰动→平台探测正确返回 linux-musl→CLI 用已焙
#     `schema-engine-linux-musl`（零下载；FC 沙箱探测被扰误下 openssl-1.1.x 变体=FC EPERM
#     根因，ECS 无此路）；query engine 已焙 .prisma/client（PrismaClient dlopen，零 download/execve）
#
# 验收线（CR aohix7ut 钉死，逐条对账）：
#   - fail-first：部署序 01→02→02b(migrate)→03→04，03 UpdateFunction 换镜像**之前**跑
#     （schema 先于 code，败即 abort=函数永不接期待新 schema 的码）
#   - DATABASE_URL 走 03 同款 ~/.aliyun-env 同文件（零新增托管面）
#   - 日志只状态（applied/pending 计数，键名不印值，门禁⑥）
#   - 幂等可重跑（prisma migrate deploy 只应 pending，已 applied 跳过）
#   - additive-only 不变式至 GA（新 schema 须兼容旧码=回滚窗：UpdateFunction 回旧 tag 时
#     旧码对新 schema 安全；本脚本不验 additive-only=后端 schema 纪律，仅执行 migrate）
#   - 注入经环境变量不经 argv（ps 面）
#
# 前置：01-build-images.sh 已 build 本地镜像（:IMAGE_TAG）+ ~/.aliyun-env 装配 RDS_DATABASE_URL。
#   本脚本不 pull（镜像须本地；pull 走 02，ACR auth 非本步骤职责）。
set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

: "${IMAGE_TAG:?缺少 IMAGE_TAG（与 01/02/03 同 tag，本地镜像须在场）}"
: "${RDS_DATABASE_URL:?缺少 RDS_DATABASE_URL（仓库外 ~/.aliyun-env 注入 RDS 内网连接串）}"

FC_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/my-coffee-fc:${IMAGE_TAG}"

# 镜像本地在场校验（缺则提示先跑 01，不静默 pull）
if ! docker image inspect "${FC_IMAGE}" >/dev/null 2>&1; then
  die "本地镜像 ${FC_IMAGE} 不在 → 先跑 01-build-images.sh（IMAGE_TAG=${IMAGE_TAG}）。本脚本不 pull（pull 走 02，ACR auth 非本步骤）。"
fi

log "RDS migrate（fail-first，镜像=${FC_IMAGE}）"
log "DATABASE_URL：键名=DATABASE_URL 值长=${#RDS_DATABASE_URL}（值不进日志/argv，-e 键名拷贝自父 env）"

# DATABASE_URL 注入父 env（非 argv）→ docker run -e DATABASE_URL 仅键名拷贝，值不入 podman argv。
#   export 在本脚本进程 env（~/.aliyun-env 已 source 同款），非 ps 可观测的 argv 面。
export DATABASE_URL="${RDS_DATABASE_URL}"

# podman run：--rm 退即清；-e DATABASE_URL 仅键名（值从父 env 拷贝）；sh -c 覆盖镜像 CMD；
#   timeout 300 兜底（migrate 应秒级，schema engine 首次下载+加载数秒；挂死有上限）。
#   输出捕到 MIGRATE_OUT（不直吐 stdout=可过滤状态行，免 prisma 进度条噪音+保护值不泄露）。
MIGRATE_OUT=""
if ! MIGRATE_OUT="$(timeout 300 docker run --rm \
  -e DATABASE_URL \
  "${FC_IMAGE}" \
  npx prisma migrate deploy 2>&1)"; then
  log "migrate 失败（fail-first abort，03 不接新 schema 期待的码）："
  # 错误体截尾 surface（prisma 错误印 schema/db 名 host 非连接串值；grep -v 兜底滤 DATABASE_URL 字面）
  printf '%s\n' "${MIGRATE_OUT}" | grep -v 'DATABASE_URL' | grep -Ev '[0-9]+%|Downloading Prisma' | tail -20
  die "migrate 失败 → abort（schema 未就绪，勿跑 03 UpdateFunction）"
fi

# 成功：只报状态行（applied/pending/sync/migration，键名不印值；datasource 行含 host+db 名=资源 ID 非凭证，门禁⑥可显）
log "migrate 成功。状态："
printf '%s\n' "${MIGRATE_OUT}" | grep -Ei 'applied|pending|sync|migration|database|schema name' | grep -v 'DATABASE_URL' | tail -15
log "下一步：./03-fc-deploy.sh（schema 已就绪，UpdateFunction 换镜像安全，FC command 仅 node fc-server.js）"
