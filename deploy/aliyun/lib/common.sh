#!/usr/bin/env bash
# =============================================================================
# lib/common.sh — my-coffee 阿里云部署公共库
# 所有形态脚本顶部 `source "$(dirname "$0")/../lib/common.sh"` 引入本文件。
# 设计原则：资源默认值集中在此、可被环境变量覆盖；凭证只走仓库外 .env；
#           ECS 无公网——远程执行只走 run_on_ecs，文件传输只走 OSS 内网签名 URL。
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# utilities: log() / die()（前置——鉴权段与各函数均调用）
# ---------------------------------------------------------------------------
log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

die() {
  printf '[%s][ERROR] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# 0) 仓库外凭证/资源文件（canonical path = ~/.aliyun-env，人类落值处）
#    set -a 自动导出 → 文件格式无关：bare `VAR=` 与 `export VAR=` 都读得，
#    消灭「选一文件 + 统一 export」的格式分支（不压分支、杀分支）。
#    ENV_FILE 可覆盖；ALIBABA_CLOUD_ACCESS_KEY_ID 已在环境（先 source 过）则不重复读。
#    skeleton ~/.my-coffee-aliyun.env 退役——一文件收口于人类落值处。
# ---------------------------------------------------------------------------
: "${ENV_FILE:=$HOME/.aliyun-env}"
if [[ -z "${ALIBABA_CLOUD_ACCESS_KEY_ID:-}" && -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

# ---------------------------------------------------------------------------
# 1) 可覆盖的资源默认值（换环境只改环境变量，不改本文件）
# ---------------------------------------------------------------------------
export REGION="${REGION:-cn-hangzhou}"

# 目标 ECS（单机 standalone）
export ECS_ID="${ECS_ID:-}"

# ACR（镜像走 VPC 端点 push/pull，不走公网）
# 默认值=本项目已知的 ACR 企业版实例资源标识（host/namespace/instance-id 均为
# 非凭证资源 ID，见门禁⑥，可入库；换环境/换实例时用环境变量覆盖，不改本文件）。
# 留 fail-loud 兜底：若显式置空且无默认（理论上不发生）仍点名，勿静默回落公网。
export ACR_REGISTRY="${ACR_REGISTRY:-codematrix-dev-registry-vpc.cn-hangzhou.cr.aliyuncs.com}"
export ACR_NAMESPACE="${ACR_NAMESPACE:-codematrix}"
export ACR_INSTANCE_ID="${ACR_INSTANCE_ID:-cri-16ux7uiujvf8lfeg}"
[[ -n "$ACR_REGISTRY" && -n "$ACR_NAMESPACE" ]] \
  || die "ACR_REGISTRY/ACR_NAMESPACE 解析为空（见 lib/env.example）"

# RDS PostgreSQL（方案二 DB；端点+库名为非凭证资源 ID 可入库，口令只走 ~/.aliyun-env）
# ④ 直连端点：DescribeDBInstanceNetInfo 实测本实例仅暴露 rwlb（读写分离代理）内网端点，
#    即 RDS 的 VPC 内网地址，fc_user 直连可用——非「需 pgm-xxx.pg 主实例端点」误判。
export RDS_PG_ENDPOINT="${RDS_PG_ENDPOINT:-pgm-1udy8leas753wge4.rwlb.rds.aliyuncs.com}"
export RDS_PG_DB_NAME="${RDS_PG_DB_NAME:-mycoffee_prod}"

# FC VPC 配置（FC 函数与 RDS 同 VPC/同 vSwitch = 内网可达 RDS 的前提）
# VPC/vSwitch 取自 RDS DescribeDBInstanceNetInfo；SG=codematrix-fc-eni（DescribeSecurityGroups 实测）
export FC_VPC_ID="${FC_VPC_ID:-vpc-bp1pbo0j6ru12qqa5bm4z}"
export FC_VSWITCH_ID="${FC_VSWITCH_ID:-vsw-bp1a50ro3oqfc7cys6m93}"
export FC_SG_ID="${FC_SG_ID:-sg-bp199se1hm6jqjfuhwqf}"

# OSS（无公网 ECS 经内网签名 URL 下载文件）
export OSS_BUCKET="${OSS_BUCKET:-}"
export OSS_INTERNAL_HOST="${OSS_INTERNAL_HOST:-oss-${REGION}-internal.aliyuncs.com}"

# 镜像 tag：优先环境变量，否则取 git 短 sha，再退化为时间戳占位（脚本环境无 git 时）
if [[ -z "${IMAGE_TAG:-}" ]]; then
  if git -C "$(dirname "${BASH_SOURCE[0]}")/../../.." rev-parse --short HEAD >/dev/null 2>&1; then
    IMAGE_TAG="$(git -C "$(dirname "${BASH_SOURCE[0]}")/../../.." rev-parse --short HEAD)"
  else
    IMAGE_TAG="dev-$(date +%Y%m%d%H%M%S)"
  fi
fi
export IMAGE_TAG

# 对外入口（FC 反代，可选）
export FC_SERVICE_NAME="${FC_SERVICE_NAME:-my-coffee-gateway}"
export FC_FUNCTION_NAME="${FC_FUNCTION_NAME:-my-coffee-proxy}"

# 后端服务端口（容器内监听）
export BACKEND_PORT="${BACKEND_PORT:-3001}"
# 前端 nginx 对内端口
export FRONTEND_PORT="${FRONTEND_PORT:-80}"

# ---------------------------------------------------------------------------
# 2) 鉴权：优先静态 AK（(b) 回退路——~/.aliyun-env 注入则走 AK）；否则探 ECS
#    实例 RAM 角色元数据 → EcsRamRole 模式（(a) STS，临时令牌、无静态长值
#    可泄露——三次泄露根因机制上消除）。两者皆无 → fail-loud 点名 instance-id。
#    instance-id / role-name 均从元数据自动取，不硬编。
#    元数据探针只取角色【名】（ram/security-credentials/ 列表端点），绝不取
#    凭证值端点（.../<role> 返回 STS 临时令牌 = 门禁⑥红灯）——角色在场即放行。
#    AK `:?` 硬守卫改可选非删：保留 (b) 回退路 = 零破坏（线下带 AK 仍可用）。
# ---------------------------------------------------------------------------
META_BASE="http://100.100.100.200/latest/meta-data"
_meta_get() {  # _meta_get <path> → 取元数据值（IMDSv1 优先，IMDSv2 兜底）
  # 三处 curl 均 `|| true` 兜底：元数据不可达（超时/非 ECS 无路由）时 curl 退非零，
  # set -euo pipefail 会当场杀进程 → 下游 fail-loud die() 永远到不了（CR 🟡1 真洞）。
  # 受害者恰是没 AK、不在 ECS 的首跑开发者 = 3 秒卡死后零输出。空值/错误 body 交给
  # 下游 die 接，这里只负责不把进程杀在探针里。
  local v
  v="$(curl -s --max-time 3 "${META_BASE}/$1" 2>/dev/null)" || true
  # 加固模式无 token GET 返 403/Forbidden（非 404），并进 IMDSv2 fallback
  if [[ -z "$v" || "$v" == *404* || "$v" == *403* || "$v" == *Forbidden* || "$v" == *"NotFound"* || "$v" == *"Invalid"* ]]; then
    local tok
    tok="$(curl -s -X PUT --max-time 3 "http://100.100.100.200/latest/api/token" \
           -H 'X-aliyun-ecs-metadata-token-ttl-seconds:60' 2>/dev/null)" || true
    v="$(curl -s --max-time 3 -H "X-aliyun-ecs-metadata-token: ${tok}" "${META_BASE}/$1" 2>/dev/null)" || true
  fi
  printf '%s' "$v"
}

if [[ -n "${ALIBABA_CLOUD_ACCESS_KEY_ID:-}" && -n "${ALIBABA_CLOUD_ACCESS_KEY_SECRET:-}" ]]; then
  AUTH_MODE=AK
  log "鉴权=AK 模式（静态 AK，回退路 (b)）"
else
  INSTANCE_ID="$(_meta_get instance-id | tr -d '\n[:space:]')"
  ROLE_NAME="$(_meta_get ram/security-credentials/ | tr -d '\n[:space:]')"
  if [[ -z "$INSTANCE_ID" ]]; then
    die "鉴权失败：环境无静态 AK（未注入 ALIBABA_CLOUD_ACCESS_KEY_ID/SECRET），且本机不在阿里云 ECS（元数据端点无 instance-id）。请 source 仓库外 .env（见 lib/env.example）走 (b) AK，或在阿里云 ECS 上执行。"
  fi
  if [[ -z "$ROLE_NAME" || "$ROLE_NAME" == *404* ]]; then
    die "鉴权失败：ECS ${INSTANCE_ID} 未挂实例 RAM 角色，aliyun CLI / s deploy 取不到 STS。请给 ${INSTANCE_ID} 挂 RAM 角色（信任策略 Principal.Service=ecs.aliyuncs.com，权限策略见 fc-app 部署 RAM 策略），挂完即生效、无需停机/重启。"
  fi
  AUTH_MODE=EcsRamRole
  export INSTANCE_ID ROLE_NAME AUTH_MODE
  # 供 Serverless Devs / @alicloud/credentials SDK 凭证链取 ECS 角色 STS（令牌由 SDK
  # 从元数据现取，不进 argv/env 文件/disk——🟡2 消解）。两候选 env 键并设，运行时
  # 03-fc-deploy 验证确切生效键；不生效则改走 `s config add` profile，届时频道报。
  export ALIBABA_CLOUD_ECS_RAM="$ROLE_NAME"
  export ALICLOUD_ECS_RAM="$ROLE_NAME"
  log "鉴权=EcsRamRole 模式（角色 ${ROLE_NAME}，ECS ${INSTANCE_ID}，临时令牌、无静态 AK）"
fi

# ---------------------------------------------------------------------------
# 3) 统一鉴权参数数组（每条 aliyun 命令都带 "${AUTH_ARGS[@]}"）
#    AK 模式带 access-key 值；EcsRamRole 模式只带角色名（令牌由 CLI 从元数据
#    现取，不进 argv/env/disk——🟡2 折进）。pre-flight=角色在场无值探针（🟡3 折进）。
# ---------------------------------------------------------------------------
if [[ "$AUTH_MODE" == "AK" ]]; then
  AUTH_ARGS=(--mode AK \
             --access-key-id "$ALIBABA_CLOUD_ACCESS_KEY_ID" \
             --access-key-secret "$ALIBABA_CLOUD_ACCESS_KEY_SECRET" \
             --region "$REGION")
else
  AUTH_ARGS=(--mode EcsRamRole --ram-role-name "$ROLE_NAME" --region "$REGION")
fi

# ---------------------------------------------------------------------------
# 4) run_on_ecs <instance_id> [timeout] <<EOF ... EOF
#    远程脚本从 stdin 读入 → base64 编码 → aliyun ecs RunCommand 下发
#    （规避转义地狱）→ 轮询 DescribeInvocationResults 到终态
#    → base64 -d 还原并打印 Output。
#    ECS 无公网，这是唯一的远程执行通道；用 python3 解析 JSON。
#    退出码 = 远端脚本退出码；失败（超时/异常）die。
# ---------------------------------------------------------------------------
run_on_ecs() {
  local instance_id="$1"
  local timeout="${2:-300}"
  [[ -n "$instance_id" ]] || die "run_on_ecs: 缺少 instance_id"
  local script
  script="$(cat)"   # 从 stdin 读入整段远程脚本
  local b64
  b64="$(printf '%s' "$script" | base64 -w 0)"

  local invoke_resp
  invoke_resp="$(aliyun ecs RunCommand \
      "${AUTH_ARGS[@]}" \
      --RegionId "$REGION" \
      --InstanceId.1 "$instance_id" \
      --Type RunShellScript \
      --ContentEncoding Base64 \
      --CommandContent "$b64" \
      --Timeout "$timeout" \
      --WorkingDir /root)"

  local invoke_id
  invoke_id="$(printf '%s' "$invoke_resp" | python3 -c 'import sys,json;print(json.load(sys.stdin)["InvokeId"])')"
  log "RunCommand 已下发 InvokeId=${invoke_id}，轮询结果…"

  # 轮询到终态
  local status="" output_b64="" exit_code=""
  local elapsed=0
  local poll_interval=5
  while :; do
    local resp
    resp="$(aliyun ecs DescribeInvocationResults \
        "${AUTH_ARGS[@]}" \
        --RegionId "$REGION" \
        --InvokeId "$invoke_id" \
        --InstanceId.1 "$instance_id")"
    # 取该实例的结果（只下发了 1 台）
    local parsed
    parsed="$(printf '%s' "$resp" | python3 -c '
import sys,json
d=json.load(sys.stdin)
inv=(d.get("Invocation") or {}).get("InvocationResults") or []
if not inv:
    print("PENDING\t\t")
else:
    r=inv[0]
    print("\t".join([str(r.get("InvocationStatus","")),
                     str(r.get("Output","") or ""),
                     str(r.get("ExitCode",""))]))
')"
    status="$(printf '%s' "$parsed" | cut -f1)"
    output_b64="$(printf '%s' "$parsed" | cut -f2)"
    exit_code="$(printf '%s' "$parsed" | cut -f3)"
    case "$status" in
      Finished|Success)
        # Output 可能是 base64（ContentEncoding=Base64 时返回 base64）也可能是明文，先尝试 base64 -d，失败则按明文
        if [[ -n "$output_b64" ]]; then
          printf '%s' "$output_b64" | base64 -d 2>/dev/null || printf '%s' "$output_b64"
        fi
        if [[ "$exit_code" == "0" || "$exit_code" == "None" || -z "$exit_code" ]]; then
          return 0
        else
          die "run_on_ecs: 远端脚本退出码=${exit_code}"
        fi
        ;;
      Failed|Timeout|Invalid|Cancelled)
        [[ -n "$output_b64" ]] && printf '%s' "$output_b64" | base64 -d 2>/dev/null || true
        die "run_on_ecs: 远端执行状态=${status}"
        ;;
      *)
        ;;
    esac
    sleep "$poll_interval"
    elapsed=$((elapsed + poll_interval))
    [[ "$elapsed" -ge "$timeout" ]] && die "run_on_ecs: 本地轮询超时（${timeout}s）"
  done
}

# ---------------------------------------------------------------------------
# 5) oss_sign oss://bucket/key [expires]
#    用 OSS【内网】端点签名 URL，供无公网 ECS 下载文件。
#    依赖 aliyun oss sign（ossutil 内置），显式 AK + 内网 endpoint。
#    返回（stdout）签名 URL。
# ---------------------------------------------------------------------------
oss_sign() {
  local cloud_url="$1"
  local expires="${2:-3600}"
  [[ -n "$OSS_BUCKET" ]] || die "oss_sign: 缺少 OSS_BUCKET（见 lib/env.example）"
  aliyun oss sign "$cloud_url" \
      "${AUTH_ARGS[@]}" \
      --endpoint "$OSS_INTERNAL_HOST" \
      --timeout "$expires"
}

# ---------------------------------------------------------------------------
# 6) acr_token
#    aliyun cr GetAuthorizationToken 取临时令牌，输出 "USER\tBASE64_TOKEN"
#    令牌含特殊字符 → base64 后传输；调用方 `base64 -d | docker login --password-stdin`
#    （个人版实例 ACR_INSTANCE_ID 可为空；企业版必填）
# ---------------------------------------------------------------------------
acr_token() {
  local args=("${AUTH_ARGS[@]}")
  [[ -n "$ACR_INSTANCE_ID" ]] && args+=(--InstanceId "$ACR_INSTANCE_ID")
  local resp
  resp="$(aliyun cr GetAuthorizationToken "${args[@]}")"
  printf '%s' "$resp" | python3 -c '
import sys,json,base64
d=json.load(sys.stdin)
user=d.get("TempUserName") or d.get("username") or d.get("UserName") or ""
tok=d.get("EncodeToken") or d.get("authorizationToken") or d.get("AuthorizationToken") or ""
# EncodeToken 已是 base64；若返回明文 token 再 base64 一次
import binascii
def is_b64(s):
    try:
        base64.b64decode(s, validate=True); return True
    except Exception:
        return False
if tok and not is_b64(tok):
    tok=base64.b64encode(tok.encode()).decode()
print(user+"\t"+tok)
'
}

# ---------------------------------------------------------------------------
# 自检：脚本被 source 时打印一行确认（便于排查是否成功加载）
# ---------------------------------------------------------------------------
log "common.sh loaded: REGION=${REGION} IMAGE_TAG=${IMAGE_TAG} ECS_ID=${ECS_ID:-<unset>}"
