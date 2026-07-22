#!/usr/bin/env bash
# =============================================================================
# lib/common.sh — my-coffee 阿里云部署公共库
# 所有形态脚本顶部 `source "$(dirname "$0")/../lib/common.sh"` 引入本文件。
# 设计原则：资源默认值集中在此、可被环境变量覆盖；凭证只走仓库外 .env；
#           ECS 无公网——远程执行只走 run_on_ecs，文件传输只走 OSS 内网签名 URL。
# =============================================================================
set -euo pipefail

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

# ACR（镜像走 VPC 端点 push/pull，不走公网；忘注入则 fail-loud，勿静默回落公网/错命名空间）
export ACR_REGISTRY="${ACR_REGISTRY:?缺少 ACR_REGISTRY（ACR VPC 端点，见 lib/env.example）}"
export ACR_NAMESPACE="${ACR_NAMESPACE:?缺少 ACR_NAMESPACE（ACR 命名空间，见 lib/env.example）}"
export ACR_INSTANCE_ID="${ACR_INSTANCE_ID:-}"

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
# 2) 凭证校验（未 source 仓库外 .env 时立即报错退出）
# ---------------------------------------------------------------------------
: "${ALIBABA_CLOUD_ACCESS_KEY_ID:?请先 source 仓库外的 .env（见 lib/env.example），缺少 ALIBABA_CLOUD_ACCESS_KEY_ID}"
: "${ALIBABA_CLOUD_ACCESS_KEY_SECRET:?请先 source 仓库外的 .env（见 lib/env.example），缺少 ALIBABA_CLOUD_ACCESS_KEY_SECRET}"

# ---------------------------------------------------------------------------
# 3) 统一鉴权参数数组（显式 AK 模式，不依赖本地 profile；每条 aliyun 命令都带）
#    用法： aliyun ecs DescribeInstances "${AK_ARGS[@]}" ...
# ---------------------------------------------------------------------------
AK_ARGS=(--mode AK \
         --access-key-id "$ALIBABA_CLOUD_ACCESS_KEY_ID" \
         --access-key-secret "$ALIBABA_CLOUD_ACCESS_KEY_SECRET" \
         --region "$REGION")

# ---------------------------------------------------------------------------
# 4) log() / die()：统一带时间戳日志与失败退出
# ---------------------------------------------------------------------------
log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

die() {
  printf '[%s][ERROR] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# 5) run_on_ecs <instance_id> [timeout] <<EOF ... EOF
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
      "${AK_ARGS[@]}" \
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
        "${AK_ARGS[@]}" \
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
# 6) oss_sign oss://bucket/key [expires]
#    用 OSS【内网】端点签名 URL，供无公网 ECS 下载文件。
#    依赖 aliyun oss sign（ossutil 内置），显式 AK + 内网 endpoint。
#    返回（stdout）签名 URL。
# ---------------------------------------------------------------------------
oss_sign() {
  local cloud_url="$1"
  local expires="${2:-3600}"
  [[ -n "$OSS_BUCKET" ]] || die "oss_sign: 缺少 OSS_BUCKET（见 lib/env.example）"
  aliyun oss sign "$cloud_url" \
      "${AK_ARGS[@]}" \
      --endpoint "$OSS_INTERNAL_HOST" \
      --timeout "$expires"
}

# ---------------------------------------------------------------------------
# 7) acr_token
#    aliyun cr GetAuthorizationToken 取临时令牌，输出 "USER\tBASE64_TOKEN"
#    令牌含特殊字符 → base64 后传输；调用方 `base64 -d | docker login --password-stdin`
#    （个人版实例 ACR_INSTANCE_ID 可为空；企业版必填）
# ---------------------------------------------------------------------------
acr_token() {
  local args=("${AK_ARGS[@]}")
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
