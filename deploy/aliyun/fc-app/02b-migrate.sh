#!/usr/bin/env bash
# 02b-migrate.sh — migrate 移出 FC 冷启后的独立 fail-first 步骤：schema 先于 code，
# migrate 败即 abort，函数永不接「期待新 schema 的码」。
# 根因沿革（build 期 Prisma engine 变体探测失输→重焙 linux-musl-openssl-3.0.x、migrate
# 移出冷启）单一权威源 = DESIGN.md §七 canonical drift 注，本脚本不复述以免双源漂移。
#
# 机制：podman run --rm -e DATABASE_URL <local-image> npx prisma migrate deploy
#   - 镜像本地（01 已 build :IMAGE_TAG）→ 零 ACR pull / 零新 RAM action（RAM-neutral，
#     migrate=DATABASE_URL SQL 连接 fc_user DB owner，非 RAM API 面）
#   - DATABASE_URL 经 `-e DATABASE_URL`（**仅键名无 `=`值**）从父 env 拷贝→值不入 podman argv
#     （ps 面最小暴露，门禁⑥ / 最小暴露 475hrbwc）；父 env 由 export 注入（非 argv）
#   - 命令 `npx prisma migrate deploy` 替换镜像 CMD（Dockerfile.fc CMD exec-form
#     `["node","fc-server.js"]`，run args 替换 CMD 不论 form），经 node 基镜
#     ENTRYPOINT docker-entrypoint.sh `exec "$@"` 落 migrate-only（不起 server）。ls 实证此路通
#     （docker run <img> ls -l … 已返输出=command-replacement via entrypoint exec 生效）
#   - schema engine：migrate 路有等价全路径 env 钉 **#5 PRISMA_SCHEMA_ENGINE_BINARY**（与 query
#     engine 路 #4 PRISMA_QUERY_ENGINE_LIBRARY 同机制族——Dev 5ws6rrho 源码实证：env-var map
#     schema-engine→PRISMA_SCHEMA_ENGINE_BINARY，resolver df()/wu() 读 env 置则 path.resolve 原样当
#     路径返回，零 probe）。alpine runtime 缺 openssl CLI → 不钉 #5 则 get-platform probe default
#     openssl-1.1.x → 搜裸名 schema-engine-linux-musl 不在 → abort（02b 前序实证，已由 #5 解）。
#     双 engine 皆 env 路径钉零 probe（QE za()#4 / SE wu-df#5），(c)「绕过探测」对两面统一成立。
#     根因沿革见上 §七 指针，本脚本不复述以免双源漂移；query engine 已焙 .prisma/client（#4 全路径
#     env 钉 loader，零探测，dlopen 直载）
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
# IMAGE_TAG 必须显式传入（与 03 同款 fail-loud）：common.sh 默认回退 git short sha 会掩盖
# 缺省 → source 前先钉，勿让 git-sha 默认指错 tag（CR 🟡1 fold，guard-liveness：死守卫比
# 没守卫糟——声称给不出的保护）。空 IMAGE_TAG 在此真 die，不进 common.sh 默认路径。
: "${IMAGE_TAG:?缺少 IMAGE_TAG（与 01/02/03 同 tag，本地镜像须在场）}"
source "$(dirname "$0")/../lib/common.sh"

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
#   timeout 300 兜底（migrate 应秒级，schema engine 已焙零运行时下载，加载本身数秒；挂死有上限）。
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
