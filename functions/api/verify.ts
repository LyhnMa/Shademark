import type { Env } from '../lib/db';
import { jsonResponse, errorResponse } from '../lib/db';
import { requireAPIKey, verifySignature, createSignature } from '../lib/auth';
import { verifyCode } from '../lib/verify';
import { checkVerifyQuota } from '../lib/subscription';

export async function onRequestPost(context: any): Promise<Response> {
  const { request, env } = context;
  const { key, response } = await requireAPIKey(request, env);
  if (response) return response;

  // 验证 API 额度按「平台统一订阅」等级区分（free 60/分钟，pro 600/分钟）
  const quota = await checkVerifyQuota(env.DB, key.developer_id);
  if (!quota.allowed) {
    return errorResponse(`API 调用超出当前等级额度（${quota.limit} 次/分钟），升级 Pro 可提升到更高额度`, 429);
  }

  const body = await request.json<any>().catch(() => ({}));
  const { code_value } = body;

  if (!code_value) return errorResponse('缺少激活码', 400);

  const result = await verifyCode(env.DB, code_value);
  return jsonResponse(result);
}
