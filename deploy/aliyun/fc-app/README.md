# fc-app 形态 — 方案二（FC + RDS PostgreSQL）整体上 FC

> **状态：方案设计阶段产出物，未执行。** 待 `DESIGN.md` 经 CR review + TL 验收通过、RDS PostgreSQL 就绪、后端 Prisma sqlite→postgresql 迁移落地后，认领实现任务再执行 01→04。

## 形态
单个 FC3 custom-container 函数同时托管 `/api`（后端 Express）与 `/`（前端 Vite 静态），DB = RDS PostgreSQL（VPC 内网）。FC 实例无状态，数据全落 RDS，持久可靠。对外入口 = FC HTTP 触发器 + 免 ICP 域名（fcapp.run）。

详见 `DESIGN.md`（架构拓扑 / FC↔RDS 网络 / 免ICP域名 / 连接池数学 / 优雅关闭 / 风险 / 验收）。

## 执行顺序（设计通过 + RDS 就绪后）
```bash
source ~/.aliyun-env   # 需含 RDS_DATABASE_URL / FC_VPC_ID / FC_VSWITCH_ID / FC_SG_ID / FC_DOMAIN
./01-build-images.sh
./02-push-acr.sh
./03-fc-deploy.sh
./04-healthcheck.sh
```

## 关键设计约束（CR 门禁）
- 优雅关闭顺序：`SIGTERM → server.close() 拒新 → drain → prisma.$disconnect() → exit`（见 `fc-server.js`，先关 HTTP 再断 DB，正确性）
- 连接池数学：`instanceConcurrency(10) × connection_limit(3) = 60 ≤ RDS max_connections(2420 实测真值)`，余量 40×；与后端数据层设计交叉校验；超阈值启用 RDS Proxy（见 DESIGN.md 第五节）
- 镜像走 ACR VPC 端点；令牌临时、base64 传输、不缓存
- 回滚：`IMAGE_TAG=<旧tag/digest> ./03-fc-deploy.sh`，RDS 数据不受影响

## 文件
| 文件 | 说明 |
| --- | --- |
| `DESIGN.md` | 部署架构设计（评审主交付物） |
| `fc-server.js` | FC 入口：托管 /api+静态 + 优雅关闭 |
| `Dockerfile.fc` | 多阶段镜像构建 |
| `s.yaml` | FC3 部署描述（VPC/安全组/env/触发器） |
| `01~04` 脚本 | build → push → deploy → healthcheck |
