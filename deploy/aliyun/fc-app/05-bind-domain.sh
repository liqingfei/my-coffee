#!/usr/bin/env bash
# 05-bind-domain.sh — 绑定 devsapp.net 自定义域到 my-coffee-proxy FC 函数（方案二对外入口）
#
# 机制：FC3.0 custom-domain API（fc_api.js 的 /custom-domains 分派 →
#   getCustomDomain / createCustomDomain / updateCustomDomain typed 方法）。
#   - 域名 = <FC_FUNCTION_NAME>.fcv3.<accountId>.<region>.fc.devsapp.net
#     （Aliyun 拥有域，label=函数名，account=同 codematrix 参考 5884645900446711；
#      非用户自有域，免 ICP）。GET NotFound ErrorCode 实证=DomainNameNotFound
#      （RequestId 1-6a61c872-15e79efa-88363ca6266b，policy 已验生效=非 AccessDenied）。
#   - protocol=HTTPS（CR/QA 安全门禁：PII 入口禁 HTTP 明文 CWE-319）。
#     HTTPS-only 而非 HTTP,HTTPS：HTTP,HTTPS 里 HTTP 分支不需 cert 也能成=
#     不能证 auto-provision，且 HTTP 分支会以明文回 PII=门禁红灯；HTTPS-only
#     成才证 FC auto-provision 了 *.fc.devsapp.net 证书，是更严的判别器（bstnf1e6）。
#   - 首建无 certConfig 试 auto-provision（devsapp.net=Aliyun 域，FC 可能自动签证书）；
#     若 create 报 cert required → surface 不自改，转 PEM 路径（aliyun SSL 免费证书
#     tmpfile+chmod600+trap rm 注入 certConfig，门禁⑥ 同 DATABASE_URL 口径，CR ⑤）。
#
# 幂等：GetCustomDomain 探存在 →
#   - DomainNameNotFound（404 预期分支）→ CreateCustomDomain 首发；
#   - 已存在 → 跳过（不重复绑；换路由须 UpdateCustomDomain，05 首轮不涉及）；
#   - AccessDenied/网络 → die 带 RequestId（policy ① 已解锁验过 NotFound，若再现
#     AccessDenied=policy 回退或 scope 问题，surface 不自改——跑炸即 surface 不自行二改跑）。
#
# 前置：03-fc-deploy.sh 已建函数 my-coffee-proxy（HTTP trigger live fcapp.run）；
#        policy fc:Get/Create/UpdateCustomDomain 已授（@aidbs-demo 49scizdr，GET NotFound
#        已验生效）。Delete 不授（幂等绑只授真用 action，CR ⑤ least-priv）。
set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"
set +u   # aliyun CLI 补全在 set -u 下引用 ZSH_VERSION（unbound）→ 放开 nounset；-e/pipefail 保留
export PATH="/opt/node/bin:${PATH}"

# (b3') fc_api.js SDK 依赖就近解析（同 03）：fc-app/package.json 钉 @alicloud/fc20230330@4.7.9
FC_APP_DIR="$(cd "$(dirname "$0")" && pwd)"
export NODE_PATH="${FC_APP_DIR}/node_modules${NODE_PATH:+:${NODE_PATH}}"
if [ ! -d "${FC_APP_DIR}/node_modules/@alicloud/fc20230330" ]; then
  log "fc_api.js SDK 依赖未装 → npm ci（${FC_APP_DIR}）"
  ( cd "$FC_APP_DIR" && npm ci ) || die "npm ci 失败（fc_api.js 依赖；检查网络 / package-lock）"
fi

# 🔴 tmpfile 生命周期（含 certConfig.privateKey 的 body 临时文件，PEM 路径用；首轮无
#   certConfig 仍守同口径）：EXIT/INT/TERM 清，die 中途不留 /tmp 残文件=凭证落盘。
#   trap 兜底 + 显式 rm 双保险（同 03）。
_CLEANUP_FILES=()
_fc_cleanup() {
  [ "${#_CLEANUP_FILES[@]}" -gt 0 ] && rm -f "${_CLEANUP_FILES[@]}" 2>/dev/null || true
}
trap _fc_cleanup EXIT INT TERM
_tmpf() {
  local f
  f="$(mktemp "$1")" || die "mktemp $1 失败"
  chmod 600 "$f"
  _CLEANUP_FILES+=("$f")
  eval "$2=\$f"
}

# fc_api <METHOD> <path> [body-file] —— 走 node helper fc_api.js（typed SDK 方法）。
#   stdout=响应体 JSON（2xx），stderr=归一化错误 blob（非 2xx，ErrorCode/Message/RequestId
#   硬过滤——SDK 错误对象有时回显请求体=门禁③红灯）；凭证 helper 内 EcsRamRole 纯 STS（铁律①）。
fc_api() {
  local method="$1" path="$2" bodyfile="${3:-}"
  if [ -n "$bodyfile" ]; then
    node "${FC_APP_DIR}/fc_api.js" "$method" "$path" "$bodyfile"
  else
    node "${FC_APP_DIR}/fc_api.js" "$method" "$path"
  fi
}

# domain_route_get <blob> —— GetCustomDomain 响应分流（不依赖字段名，按 ErrorCode 判定）：
#   返回 0=已存在（响应无 ErrorCode，正常 JSON）；1=DomainNameNotFound（404 预期→Create）；
#        2=其他错（AccessDenied/网络等→die 带 RequestId）。
#   实证 ErrorCode 串=DomainNameNotFound（GET 探针 RequestId 1-6a61c872-15e79efa-88363ca6266b）。
domain_route_get() {
  local blob="$1"
  if printf '%s' "$blob" | grep -q 'ErrorCode:'; then
    if printf '%s' "$blob" | grep -q 'DomainNameNotFound'; then
      return 1   # 404 预期分支
    fi
    return 2   # AccessDenied/网络等 → die
  fi
  return 0   # 无 ErrorCode = 已存在
}

# fc_die <blob> —— 从错误体抽 RequestId 并 fail-loud die（同 03）
fc_die() {
  local blob="$1" ctx="${2:-FC custom-domain}"
  local rid
  rid="$(printf '%s' "$blob" | sed -n 's/.*RequestId: \([0-9A-Za-z-]*\).*/\1/p' | head -1)"
  [ -z "$rid" ] && rid="<no-RequestId>"
  die "${ctx} 失败（非 404 预期分支）：${blob} | RequestId=${rid}"
}

FC_API_VERSION="2023-03-30"
FC_ACCOUNT_ID="${FC_ACCOUNT_ID:-5884645900446711}"
export FC_MGMT_ENDPOINT="${FC_MGMT_ENDPOINT:-${FC_ACCOUNT_ID}.${REGION}.fc.aliyuncs.com}"
# devsapp.net 域：label=函数名，account=FC_ACCOUNT_ID，region=${REGION}
DOMAIN="${FC_CUSTOM_DOMAIN:-${FC_FUNCTION_NAME}.fcv3.${FC_ACCOUNT_ID}.${REGION}.fc.devsapp.net}"

# build_domain_config <with_name:1|0> <out-file>
#   生成 CreateCustomDomainInput JSON（camelCase）。
#   protocol=HTTPS，routeConfig.routes[0]={functionName,path:"/*"}（单函数反代全路由）。
#   首轮无 certConfig（试 auto-provision）；PEM 路径待 create 实证后注入（CR ⑤）。
build_domain_config() {
  local with_name="$1" out="$2"
  DOMAIN="$DOMAIN" FC_FUNCTION_NAME="$FC_FUNCTION_NAME" WITH_NAME="$with_name" OUT_FILE="$out" \
  python3 -c 'import json,os
cfg={
  "protocol":"HTTPS",
  "routeConfig":{
    "routes":[
      {"functionName":os.environ["FC_FUNCTION_NAME"],"path":"/*"}
    ]
  }
}
if os.environ["WITH_NAME"]=="1":
    cfg["domainName"]=os.environ["DOMAIN"]
json.dump(cfg, open(os.environ["OUT_FILE"],"w"))
'
  chmod 600 "$out"
}

DOM_PATH="/${FC_API_VERSION}/custom-domains/${DOMAIN}"

log "devsapp.net 绑定：域=${DOMAIN} 函数=${FC_FUNCTION_NAME} protocol=HTTPS 端点=${FC_MGMT_ENDPOINT} 鉴权=${AUTH_MODE}"
log "策略：首轮无 certConfig 试 auto-provision（devsapp.net=Aliyun 域，FC 可能自动签 *.fc.devsapp.net）"

GET_BLOB="$(fc_api GET "$DOM_PATH" 2>&1)" || true
case "$(domain_route_get "$GET_BLOB"; echo $?)" in
  0)
    log "自定义域已存在 → 跳过（幂等；换路由须 UpdateCustomDomain，05 首轮不涉及）"
    ;;
  1)
    log "域不存在（DomainNameNotFound 预期分支，policy ① 已验生效）→ CreateCustomDomain 首发"
    _tmpf /tmp/fcdom-XXXX.json BODY
    build_domain_config 1 "$BODY"
    CREATE_BLOB="$(fc_api POST "/${FC_API_VERSION}/custom-domains" "$BODY" 2>&1)" || true
    rm -f "$BODY"
    if printf '%s' "$CREATE_BLOB" | grep -q '"domainName"'; then
      log "CreateCustomDomain 完成"
      # CR ④c：验成功响应不回显 privateKey。fc_api.js 已防御性剥离 certConfig→{certName}，
      #   首轮无 certConfig 故响应 certConfig 应 absent/null。若响应含 privateKey 字面=红灯 surface。
      if printf '%s' "$CREATE_BLOB" | grep -q 'privateKey'; then
        die "④c 红灯：CreateCustomDomain 成功响应回显 privateKey（fc_api.js 剥离失效，surface 不自改）"
      fi
      log "④c 验过：成功响应无 privateKey 回显"
    else
      fc_die "$CREATE_BLOB" "CreateCustomDomain"
    fi
    ;;
  2)
    fc_die "$GET_BLOB" "GetCustomDomain"
    ;;
esac

# 健康验收：curl https://<domain>/api/menu=200 + /api/health=ok
log "等 8s 域名路由/证书生效…"
sleep 8
MENU_CODE="$(curl -s -o /dev/null -w '%{http_code}' "https://${DOMAIN}/api/menu" || true)"
HEALTH_CODE="$(curl -s -o /dev/null -w '%{http_code}' "https://${DOMAIN}/api/health" || true)"
if [ "$MENU_CODE" = "200" ]; then
  log "✅ /api/menu=200（devsapp.net HTTPS 入口可达，菜单可见）"
else
  log "⚠ /api/menu=${MENU_CODE:-<curl-err>}（域名路由/证书可能仍在生效中；cert required 则转 PEM 路径）"
fi
if [ "$HEALTH_CODE" = "200" ]; then
  log "✅ /api/health=200"
else
  log "⚠ /api/health=${HEALTH_CODE:-<curl-err>}"
fi

log "devsapp.net 绑定流程完成。回滚：UpdateCustomDomain 解路由（Delete 不授，CR ⑤ least-priv）"
