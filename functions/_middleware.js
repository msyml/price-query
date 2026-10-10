/** 全站中间件：对 /api/* 做短时间高频请求限制 */
import { rateLimit, tooMany } from './lib/http.js';

export async function onRequest(context) {
  const { request, env, next } = context;
  const { pathname } = new URL(request.url);

  if (pathname.startsWith('/api/')) {
    const limited = rateLimit(request, env);
    if (!limited.ok) return tooMany(limited.retryAfter);
  }

  return next();
}