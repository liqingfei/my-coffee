# fc-gateway — 对外入口（可选）

阿里云账号安全基线可能自动封禁 ECS 公网端口。对外入口**不**走 ALB/EIP/高位端口，而用 **FC（函数计算）HTTP 触发器 + 免 ICP 域名** 反代到 ECS 内网 nginx（8080），规避封禁。

## 架构

```
外网用户 ──HTTPS──> FC HTTP 触发器(免 ICP 域名)
                        │  函数内 fetch ECS 内网 IP:8080
                        ▼
                   ECS nginx(:8080) ──/api──> backend(:3001)
                                     └──静态──> 前端 dist
```

## 前置（需在控制台/CLI 备好）

- ECS 内网 IP（`ECS_PRIVATE_IP`，VPC 内 FC 可达）。
- FC 服务/函数：`FC_SERVICE_NAME` / `FC_FUNCTION_NAME`（见 `lib/env.example`）。
- 免 ICP 域名绑定到 FC 触发器（FC 自带 `*.fcapp.run` 域名可先用）。

## s.yaml 模板

`s.yaml` 是 Serverless Devs 部署描述。填入真实值后 `s deploy`。

```yaml
# fc-gateway/s.yaml（复制后填值）
edition: 3.0.0
name: my-coffee-gateway
access: ak   # = 本地已 source 的 AK（s 读取环境变量 ALIBABA_CLOUD_ACCESS_KEY_*）

vars:
  region: ${REGION}

resources:
  gateway:
    component: fc3
    props:
      region: ${REGION}
      functionName: ${FC_FUNCTION_NAME}
      runtime: nodejs20
      handler: index.handler
      memorySize: 512
      timeout: 30
      internetAccess: true
      environmentVariables:
        ECS_BACKEND_URL: http://${ECS_PRIVATE_IP}:8080
      code:
        src: ./code
      triggers:
        - name: http
          type: http
          config:
            authType: anonymous
            methods: [GET, POST, PUT, DELETE, OPTIONS]
```

## 反代函数（code/index.js）

```js
// fc-gateway/code/index.js
// 将 FC HTTP 触发器请求原样转发到 ECS 内网 nginx（8080）。
const BACKEND = process.env.ECS_BACKEND_URL; // http://<ECS 内网IP>:8080

export async function handler(req) {
  const path = (req.rawPath || '/') ;
  const url = BACKEND.replace(/\/$/, '') + path;
  const init = { method: req.method || 'GET', headers: req.headers || {} };
  if (req.body && req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }
  const r = await fetch(url, init);
  const headers = {};
  r.headers.forEach((v, k) => { headers[k] = v; });
  return {
    statusCode: r.status,
    headers,
    body: await r.text(),
  };
}
```

## 部署

```bash
source ~/.aliyun-env   # 需额外导出 ECS_PRIVATE_IP
cd deploy/aliyun/fc-gateway
s deploy          # 用 s.yaml 部署 FC 函数 + HTTP 触发器
# 部署后获得 https://<...>.fcapp.run 域名，用 curl 验证 /api/menu
```

## 注意

- FC 与 ECS 必须同 VPC（或 VPC 互通），函数才能访问 ECS 内网 IP。
- `s` CLI 在本机路径 `/opt/node/bin/s`（确保在 PATH）。
- FC 换镜像/代码可直接 `s deploy` 覆盖；FC 从 ACR VPC 端点拉镜像（本方案用代码包，不走 ACR）。
