import { NextFunction, Request, Response } from "express";

// 业务错误：携带 HTTP 状态码，由统一错误中间件转成响应体
export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (msg: string) => new AppError(400, msg);
export const notFound = (msg: string) => new AppError(404, msg);
export const conflict = (msg: string) => new AppError(409, msg);

// 统一错误处理中间件：AppError -> 对应状态码；Prisma P2002(唯一约束) -> 409；其余 -> 500
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "P2002"
  ) {
    res.status(409).json({ error: "资源冲突：唯一约束被违反" });
    return;
  }
  // body-parser / express 中间件错误（如 JSON 解析失败）携带 4xx statusCode，按 400 类返回而非 500
  const statusCode = (err as { statusCode?: unknown })?.statusCode;
  if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
    res.status(statusCode).json({ error: "请求体格式错误" });
    return;
  }
  // eslint-disable-next-line no-console
  console.error("[unhandled error]", err);
  res.status(500).json({ error: "服务器内部错误" });
}
