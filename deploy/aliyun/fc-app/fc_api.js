#!/usr/bin/env node
// fc_api.js — (b3') FC3.0 API 最小 node helper（仅替换 03-fc-deploy.sh 的 fc_api 内脏）。
//
// 缘起：aliyun CLI `--body` 不展开文件前缀（@file / file:// / stdin - 三路实证全死，
// RequestId 1-6a60d405/1-6a60d615/not support flag form -）。DATABASE_URL 经 body 下发无 CLI
// 通道 → 走 @alicloud/fc20230330 SDK typed 方法。本文件是 fc_api 的 node 实现，03 的 bash
// 编排（fc_route_get 三态分流 / trap 清理 / _tmpf / 日志报账 / 幂等主循环）原样不动。
//
// 契约（CR nnjyxwri 钉死）：node fc_api.js <METHOD> <PATH> [BODYFILE]
//   - stdout = 响应体 JSON（2xx）；stderr = 归一化错误 blob（非 2xx）
//   - 退出码：0=2xx / 非零=API 错（与原 fc_api 语义一致，fc_route_get·fc_die 原样消费）
//   - body 经 fs.readFile(BODYFILE) 程序传，never argv/never log（门禁⑥ / 最小暴露 475hrbwc）
//   - 凭证：Credential{type:'ecs_ram_role'} 纯 ECS RAM 角色 STS，不回退静态 AK（铁律①）
//   - 错误输出只印 ErrorCode/Message/RequestId——SDK 错误对象有时回显请求体，硬过滤（门禁③）
//
// SDK 解析：本文件就近 package.json（fc-app/package.json 钉 @alicloud/fc20230330@4.7.9 +
// @alicloud/credentials@2.4.5）；03 调用前 export NODE_PATH=$(dirname)/node_modules。
// 分派：METHOD+PATH → typed SDK 方法（getFunction/createFunction/updateFunction/createTrigger）。
'use strict';
const fs = require('fs');

const METHOD = process.argv[2];
const PATH = process.argv[3];
const BODYFILE = process.argv[4];

if (!METHOD || !PATH) {
  process.stderr.write('fc_api.js: usage: node fc_api.js <METHOD> <PATH> [BODYFILE]\n');
  process.exit(2);
}

// 归一化错误 blob → stderr，退出非零。硬过滤：只出 ErrorCode/Message/RequestId，
// 绝不 JSON.stringify(e)（SDK 某些错误类型会回显请求体，含 DATABASE_URL=门禁③格红灯）。
function emitError(e) {
  const code = e && (e.code || (e.data && e.data.Code)) || 'UnknownError';
  const msg = e && (e.message || (e.data && e.data.Message)) || String(e);
  const rid = e && (e.requestId || (e.data && e.data.RequestId)) || '<no-RequestId>';
  // 单行 Message：截断 + 去换行（避免 blob 多行打乱 fc_die 的 sed 抽取）
  const oneLine = String(msg).replace(/\s+/g, ' ').slice(0, 300);
  process.stderr.write(`ErrorCode: ${code}\nMessage: ${oneLine}\nRequestId: ${rid}\n`);
  process.exit(1);
}

(async () => {
  let m, credMod;
  try {
    m = require('@alicloud/fc20230330');
    credMod = require('@alicloud/credentials');
  } catch (e) {
    process.stderr.write(`fc_api.js: SDK 解析失败（NODE_PATH=${process.env.NODE_PATH || '<unset>'}）：${e.message}\n`);
    process.stderr.write('fc_api.js: 修复：cd deploy/aliyun/fc-app && npm ci（见 package.json）\n');
    process.exit(2);
  }
  const Client = m.default || m;
  const Credential = credMod.default;

  // 凭证：纯 EcsRamRole STS（元数据取，不进 argv/env 文件/disk；不回退静态 AK——铁律①）
  const client = new Client({
    endpoint: process.env.FC_MGMT_ENDPOINT,
    region: process.env.REGION || 'cn-hangzhou',
    credential: new Credential({ type: 'ecs_ram_role' }),
  });

  // PATH 分派：/2023-03-30/{functions|custom-domains}[/{name}[/triggers]]
  //   ['', '2023-03-30', seg, name?, sub?]
  //   functions:       GET/{name}=getFunction, POST=createFunction, PUT/{name}=updateFunction, POST/{name}/triggers=createTrigger
  //   custom-domains:  GET/{name}=getCustomDomain（无 request 参）, POST=createCustomDomain, PUT/{name}=updateCustomDomain
  const parts = PATH.split('/');
  const ver = parts[1];
  const seg = parts[2];
  const name = parts[3];   // function name 或 custom domain name
  const sub = parts[4];
  if (seg !== 'functions' && seg !== 'custom-domains') {
    process.stderr.write(`fc_api.js: 不支持的 PATH（仅 /functions 或 /custom-domains 系）：${PATH}\n`);
    process.exit(2);
  }

  // body：经 fs.readFile 程序传，never argv（DATABASE_URL / certConfig.privateKey 不进 ps 可观测面，门禁⑥）
  let body = null;
  if (BODYFILE) {
    try {
      body = JSON.parse(fs.readFileSync(BODYFILE, "utf8"));
    } catch (e) { emitError(e); return; }   // ENOENT+SyntaxError 同归门禁③
  }

  let resp;
  try {
    if (seg === 'functions') {
      if (METHOD === 'GET' && name && !sub) {
        resp = await client.getFunction(name, new m.GetFunctionRequest({}));
      } else if (METHOD === 'POST' && !name) {
        resp = await client.createFunction(new m.CreateFunctionRequest({ body }));
      } else if (METHOD === 'PUT' && name && !sub) {
        resp = await client.updateFunction(name, new m.UpdateFunctionRequest({ body }));
      } else if (METHOD === 'POST' && name && sub === 'triggers') {
        resp = await client.createTrigger(name, new m.CreateTriggerRequest({ body }));
      } else {
        process.stderr.write(`fc_api.js: 无 typed 映射：METHOD=${METHOD} PATH=${PATH}\n`);
        process.exit(2);
      }
    } else {  // custom-domains
      if (METHOD === 'GET' && name && !sub) {
        resp = await client.getCustomDomain(name);   // SDK 签名 getCustomDomain(domainName)，无 request 参
      } else if (METHOD === 'POST' && !name) {
        resp = await client.createCustomDomain(new m.CreateCustomDomainRequest({ body }));
      } else if (METHOD === 'PUT' && name && !sub) {
        resp = await client.updateCustomDomain(name, new m.UpdateCustomDomainRequest({ body }));
      } else {
        process.stderr.write(`fc_api.js: 无 typed 映射：METHOD=${METHOD} PATH=${PATH}\n`);
        process.exit(2);
      }
    }
  } catch (e) {
    emitError(e);
    return;
  }

  // 成功：响应体 JSON → stdout（functions: fc_route_get/trigger grep 消费；trigger 路需 '"triggerName"'）。
  // custom-domains: ④c —— createCustomDomain/getCustomDomain 响应可能含 certConfig（FC 通常 privateKey
  // write-only 不回显，但防御性剥离防落 03/05 日志/argv，门禁⑥ 同 DATABASE_URL 口径；certName 保留供 05 grep 确认）。
  const out = (resp && resp.body) ? resp.body : {};
  if (seg === 'custom-domains' && out.certConfig) {
    out.certConfig = { certName: (out.certConfig.certName || '<redacted>') };
  }
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
})();
