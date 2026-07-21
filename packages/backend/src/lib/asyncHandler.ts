import { NextFunction, Request, Response } from "express";
import { badRequest } from "./errors";

// 包装 async 路由：把 reject 统一交给错误中间件，避免每个路由手写 try/catch
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };

// 解析路径参数 id，非法正整数抛 400
export function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw badRequest(`非法的 id：${raw}`);
  }
  return id;
}
