#!/usr/bin/env bash
# 03-fc-deploy.sh — 部署/更新 my-coffee FC3.0 函数（方案二：custom-container + RDS PG）
#
# 机制：aliyun fc-open ROA 直调 FC3.0 API
#   - API 版本 2023-03-30（@alicloud/fc20230330 包名即 API 版本；非 2023-08-30）
#   - 管理域端点 <accountId>.<region>.fc.aliyuncs.com（非 *.fcapp.run 调用域）
#   - fc-open 产品表虽标 FC2.0（2021-04-06），但 ROA 签名通用，--endpoint/--version
#     覆盖即打到 FC3.0 管理域（CR 4nafodcz 两线索实证：ListFunctions 返 200）。
#   - 鉴权=ECS 实例 RAM 角色 STS（--mode EcsRamRole，令牌 CLI 内部取自元数据，
#     不进 argv/env 文件/disk——门禁⑥）。不回退静态 AK（铁律红线）。
#
# 幂等：GetFunction 探存在 →
#   - FunctionNotFound（404 预期分支，非失败）→ CreateFunction（POST /functions）首发；
#   - 已存在 → UpdateFunction（PUT /functions/{name}）换镜像（读现容器 env/binds 只换镜像重建，
#     数据卷不动——FC 无状态函数，镜像引用切换；RDS 数据卷不在 FC 侧，重部署不误删）。
#   404 分流：FunctionNotFound=预期→POST 建；auth/网络错→die 带 RequestId，不一刀 die。
#   HTTP trigger 同幂等（GET by name → 存在跳过，否则建）。
#
# 前置：RDS PG 就绪（~/.aliyun-env 装配 RDS_DATABASE_URL）、ACR 镜像已 push（02）、
#        FC VPC/SG 就绪（与 RDS 同 VPC，FC 内网访 RDS:5432）。
# maximumInstanceCount 不在 CreateFunctionInput——FC3.0 无 flat 字段（scaling-policy 定义），
# 属运维策略非部署步骤，03 不设（no-op 报账，TL bmec5e8z 裁 (b)），折进 TODO v2 控制台五件批。
set -euo pipefail
# IMAGE_TAG 必须显式传入（02-push 的 bake tag）。common.sh 默认回退 git short sha，
# 但 HEAD≠bake 产物（本仓 HEAD=a8e9fcd，bake 镜像=:35f9252）→ 默认静默指错 tag =
# UpdateFunction 换不存在的镜像必挂（ACR 双锚 🟡1 同型病）。故 source common.sh 之前先
# fail-loud 钉死，不让 common.sh 的 git-sha 默认掩盖缺省（CR 预宣焦点 IMAGE_TAG :?）。
: "${IMAGE_TAG:?缺少 IMAGE_TAG（02-push 的 bake tag，须显式传入；勿依赖 git HEAD 默认——HEAD≠bake 产物）}"
source "$(dirname "$0")/../lib/common.sh"
set +u   # aliyun CLI 补全在 set -u 下引用 ZSH_VERSION（unbound）→ 放开 nounset；-e/pipefail 保留
export PATH="/opt/node/bin:${PATH}"

# 🔴 tmpfile 生命周期（CR 预宣焦点，🔴级）：含 DATABASE_URL 的 body 临时文件必须
# EXIT/INT/TERM 清，die 中途不留 /tmp 残文件=凭证落盘。trap 兜底 + 各处显式 rm 双保险。
_CLEANUP_FILES=()
_fc_cleanup() {
  [ "${#_CLEANUP_FILES[@]}" -gt 0 ] && rm -f "${_CLEANUP_FILES[@]}" 2>/dev/null || true
}
trap _fc_cleanup EXIT INT TERM
# _tmpf <pattern> <varname> —— 建 600 临时文件 + 登记进 trap 清理表 + 经 varname 回传路径。
#   **直接调用**（勿 `$(...)` 包裹）——命令子壳会让 `_CLEANUP_FILES+=` 的 append 随子壳丢弃，
#   trap 届时见空数组=清理失效=凭证落盘（此 bug 已实测定位）。varname 硬编码，eval 安全。
_tmpf() {
  local f
  f="$(mktemp "$1")" || die "mktemp $1 失败"
  chmod 600 "$f"
  _CLEANUP_FILES+=("$f")
  eval "$2=\$f"
}

: "${RDS_DATABASE_URL:?缺少 RDS_DATABASE_URL（仓库外 ~/.aliyun-env 注入 RDS 内网连接串）}"
: "${FC_VPC_ID:?缺少 FC_VPC_ID}"
: "${FC_VSWITCH_ID:?缺少 FC_VSWITCH_ID}"
: "${FC_SG_ID:?缺少 FC_SG_ID}"

# common.sh 默认已给：ACR_REGISTRY/ACR_NAMESPACE/ACR_INSTANCE_ID/FC_FUNCTION_NAME/REGION/IMAGE_TAG/AUTH_ARGS

# FC3.0 管理域端点：<accountId>.<region>.fc.aliyuncs.com（accountId=非凭证资源 ID，见门禁⑥，可入库/可覆盖）
FC_ACCOUNT_ID="${FC_ACCOUNT_ID:-5884645900446711}"
FC_MGMT_ENDPOINT="${FC_MGMT_ENDPOINT:-${FC_ACCOUNT_ID}.${REGION}.fc.aliyuncs.com}"
FC_API_VERSION="2023-03-30"
FC_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/my-coffee-fc:${IMAGE_TAG}"

# fc-open ROA 鉴权+端点基参（--endpoint/--version 覆盖打到 FC3.0 管理域；产品表不挡 ROA 签名）
FC_ARGS=(--endpoint "$FC_MGMT_ENDPOINT" --version "$FC_API_VERSION" "${AUTH_ARGS[@]}")

# fc_api <METHOD> <path> [body-file] —— body 走临时文件 file://（aliyun CLI v3 文件读取前缀；
#   非 curl 的 @file——@file 被原样作 body 字符串发出，FC JSON 解析在首字符 '@' 处炸，
#   首跑 1-6a60d405 实证。DATABASE_URL 经文件不进 argv/日志，chmod600+trap 清理）。
#   stdout=响应，stderr 透传；退出码=aliyun 退出码（调用方按形状分流）
fc_api() {
  local method="$1" path="$2" bodyfile="${3:-}"
  if [ -n "$bodyfile" ]; then
    aliyun fc-open "$method" "$path" "${FC_ARGS[@]}" --body "file://${bodyfile}"
  else
    aliyun fc-open "$method" "$path" "${FC_ARGS[@]}"
  fi
}

# fc_route_get <blob> —— GetFunction/GetTrigger 响应分流（不依赖字段名，按 ErrorCode 判定）：
#   返回 0=已存在（响应无 ErrorCode，是正常 JSON 对象）；
#        1=FunctionNotFound/TriggerNotFound（404 预期分支→调方走 Create）；
#        2=其他错（AccessDenied/网络等→调方 die 带 RequestId）。
#   值不进日志：blob 不打印，错误体只在 die 时透出 RequestId。
fc_route_get() {
  local blob="$1"
  if printf '%s' "$blob" | grep -q 'ErrorCode:'; then
    if printf '%s' "$blob" | grep -q 'FunctionNotFound\|TriggerNotFound'; then
      return 1   # 404 预期分支
    fi
    return 2   # AccessDenied/网络等 → die
  fi
  return 0   # 无 ErrorCode = 已存在
}

# fc_die <blob> —— 从错误体抽 RequestId 并 fail-loud die
fc_die() {
  local blob="$1" ctx="${2:-FC API}"
  local rid
  rid="$(printf '%s' "$blob" | sed -n 's/.*RequestId: \([0-9A-Za-z-]*\).*/\1/p' | head -1)"
  [ -z "$rid" ] && rid="$(printf '%s' "$blob" | sed -n 's/.*X-Fc-Request-Id:\[\([0-9A-Za-z-]*\)\].*/\1/p' | head -1)"
  [ -z "$rid" ] && rid="<no-RequestId>"
  die "${ctx} 失败（非 404 预期分支）：${blob} | RequestId=${rid}"
}

# build_function_config <with_name:1|0> <out-file>
#   生成 FC3.0 CreateFunctionInput/UpdateFunctionInput JSON（camelCase）。
#   DATABASE_URL 单源：消费 ~/.aliyun-env 现成装配值注入 environmentVariables，03 不二次拼装；
#   值经 python3 environ 传入 → 写临时文件（file:// 读），不进 argv/不进日志（只报键名+长度）。
#   memorySize/timeout/instanceConcurrency 消费 s.yaml 审定值（zgn7xu3x 审'd），不另造数。
#   customContainerConfig.acrInstanceId 钉死（CR 预宣锚①：不钉 FC 拉镜像端点解析错必挂）。
build_function_config() {
  local with_name="$1" out="$2"
  FC_IMAGE="$FC_IMAGE" FC_FUNCTION_NAME="$FC_FUNCTION_NAME" \
  ACR_INSTANCE_ID="$ACR_INSTANCE_ID" FC_VPC_ID="$FC_VPC_ID" \
  FC_VSWITCH_ID="$FC_VSWITCH_ID" FC_SG_ID="$FC_SG_ID" \
  RDS_DATABASE_URL="$RDS_DATABASE_URL" WITH_NAME="$with_name" OUT_FILE="$out" \
  python3 -c 'import json,os
def e(k): return os.environ[k]
cfg={
  "runtime":"custom-container",
  "customContainerConfig":{
    "image": e("FC_IMAGE"),
    "command":["sh","-c","npx prisma migrate deploy && node fc-server.js"],
    "port":9000,
    "acrInstanceId": e("ACR_INSTANCE_ID")
  },
  "handler":"index",
  "memorySize":512,
  "timeout":60,
  "instanceConcurrency":10,
  "vpcConfig":{
    "vpcId": e("FC_VPC_ID"),
    "vSwitchIds":[ e("FC_VSWITCH_ID") ],
    "securityGroupId": e("FC_SG_ID")
  },
  "environmentVariables":{
    "NODE_ENV":"production",
    "DATABASE_URL": e("RDS_DATABASE_URL"),
    "FRONTEND_DIST":"/app/frontend-dist",
    "PORT":"9000",
    "SHUTDOWN_TIMEOUT_MS":"8000"
  }
}
if os.environ["WITH_NAME"]=="1":
    cfg["functionName"]=e("FC_FUNCTION_NAME")
json.dump(cfg, open(os.environ["OUT_FILE"],"w"))
'
  chmod 600 "$out"
}

# build_trigger_config <out-file> —— HTTP trigger（anonymous，免 ICP 域名）
#   triggerConfig 是 string（FC3.0 API 要求 JSON 串化），内层 authType/methods。
build_trigger_config() {
  local out="$1"
  python3 -c 'import json
cfg={
  "triggerName":"http",
  "triggerType":"http",
  "triggerConfig": json.dumps({"authType":"anonymous","methods":["GET","POST","PUT","DELETE","OPTIONS"]})
}
json.dump(cfg, open("'"$out"'","w"))'
  chmod 600 "$out"
}

FN_PATH="/${FC_API_VERSION}/functions/${FC_FUNCTION_NAME}"

log "FC3.0 部署：函数=${FC_FUNCTION_NAME} 镜像=${FC_IMAGE} 端点=${FC_MGMT_ENDPOINT} 鉴权=${AUTH_MODE}"
log "DATABASE_URL：键名=DATABASE_URL 值长=${#RDS_DATABASE_URL}（值不进日志/argv）"

# --- 幂等探存在（GetFunction）——404 分流 ---
#   action 集（CR 预宣焦点④核 policy S2）：fc:GetFunction（实测 my-coffee-proxy 返 404 非
#   AccessDenied=已授权）/ fc:CreateFunction（首发）/ fc:UpdateFunction（重跑换镜像）。
GET_BLOB="$(fc_api GET "$FN_PATH" 2>&1)" || true
case "$(fc_route_get "$GET_BLOB"; echo $?)" in
  0)
    log "函数已存在 → UpdateFunction 换镜像（${FC_IMAGE}）"
    _tmpf /tmp/fcbody-XXXX.json BODY
    build_function_config 0 "$BODY"
    fc_api PUT "$FN_PATH" "$BODY" >/dev/null
    rm -f "$BODY"
    log "UpdateFunction 完成"
    ;;
  1)
    log "函数不存在（FunctionNotFound 预期分支）→ CreateFunction 首发"
    _tmpf /tmp/fcbody-XXXX.json BODY
    build_function_config 1 "$BODY"
    fc_api POST "/${FC_API_VERSION}/functions" "$BODY" >/dev/null
    rm -f "$BODY"
    log "CreateFunction 完成"
    ;;
  2)
    fc_die "$GET_BLOB" "GetFunction"
    ;;
esac

# maximumInstanceCount=20：FC3.0 schema=horizontalScalingPolicies 需 metric+target 自动伸缩规则，非 flat cap；
# 属运维策略非部署步骤，控制台人定见 TODO v2 五件批（04/C4 不 gate；zgn7xu3x 审定值 20 硬账不丢）。
log "maximumInstanceCount=20：FC3.0 schema=horizontalScalingPolicies 需 metric+target 自动伸缩规则，非 flat cap，控制台定义见 TODO v2（@aidbs-demo 人定）；04 不 gate；zgn7xu3x 审定值 20 硬账不丢（走通报记 ❌「未定义（FC3.0 schema 故）」）"

# --- HTTP trigger（最小权限：仅 fc:CreateTrigger；试建→已存在则跳，避免依赖 fc:GetTrigger）---
#   CR 预宣焦点④：trigger action 核 policy——此处仅用 CreateTrigger 一个 action（GetTrigger
#   不在必需集，免其不在 S2 名单时阻走通）。重复建返回 AlreadyExists→跳过；真 AccessDenied→die。
_tmpf /tmp/fctrig-XXXX.json TBCFG
build_trigger_config "$TBCFG"
TRIG_BLOB="$(fc_api POST "/${FC_API_VERSION}/functions/${FC_FUNCTION_NAME}/triggers" "$TBCFG" 2>&1)" || true
rm -f "$TBCFG"
if printf '%s' "$TRIG_BLOB" | grep -q '"triggerName"'; then
  log "HTTP trigger 已建（anonymous，免 ICP 域名）"
elif printf '%s' "$TRIG_BLOB" | grep -qi 'AlreadyExists\|already exist'; then
  log "HTTP trigger 已存在，跳过"
else
  fc_die "$TRIG_BLOB" "CreateTrigger"
fi

log "部署完成。下一步：./04-healthcheck.sh"
log "回滚：IMAGE_TAG=<旧tag/digest> ./03-fc-deploy.sh（UpdateFunction 换回旧镜像，digest 固定可复现）"
# maximumInstanceCount=20：no-op 报账（FC3.0 无 flat 字段，运维策略非部署步骤），折进 TODO v2 控制台五件批
