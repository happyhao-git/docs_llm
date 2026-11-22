import { readFile, stat } from 'node:fs/promises'
import dotenv from 'dotenv'
import pg from 'pg'

// Internal source records never leave the service. In particular, only the
// model_mapping JSON member is selected from account credentials.
export type SourceRecord = Record<string, any>
export interface ModelSource {
  groups: SourceRecord[]; mappings: SourceRecord[]; channels: SourceRecord[]
  prices: SourceRecord[]; intervals: SourceRecord[]; routes: SourceRecord[]
  official: Record<string, SourceRecord>; pricingUpdatedAt: string
  poolGroupIds?: string[]; pools?: SourceRecord[]; poolMappings?: SourceRecord[]
}
async function databaseUrl() {
  if (process.env.SUB2API_DATABASE_URL) return process.env.SUB2API_DATABASE_URL
  const env = dotenv.parse(await readFile(process.env.SUB2API_DEPLOY_ENV_PATH || '/opt/llm/sub2api-deploy/.env'))
  if (!env.POSTGRES_PASSWORD) throw new Error('未配置 Sub2API 只读数据源')
  return `postgresql://${encodeURIComponent(env.POSTGRES_USER || 'sub2api')}:${encodeURIComponent(env.POSTGRES_PASSWORD)}@127.0.0.1:5432/${encodeURIComponent(env.POSTGRES_DB || 'sub2api')}`
}
export async function readModelSource(): Promise<ModelSource> {
  const filename = process.env.SUB2API_PRICING_PATH || '/opt/llm/sub2api-deploy/data/model_pricing.json'
  const client = new pg.Client({ connectionString: await databaseUrl(),
    options: '-c default_transaction_read_only=on', connectionTimeoutMillis: 5000,
    statement_timeout: 15000, query_timeout: 16000 })
  try {
    await client.connect()
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const rows = async (sql: string) => (await client.query(sql)).rows
    const groups = await rows(`SELECT id,name,platform,subscription_type,rate_multiplier,is_exclusive,sort_order,
      model_allowlist,platform_rate_multipliers,model_pricing,model_routing_enabled,model_routing,
      image_rate_independent,image_rate_multiplier,allow_image_generation,image_count_billing,
      image_price_1k,image_price_2k,image_price_4k,video_rate_independent,video_rate_multiplier,
      video_model_prices,video_price_480p,video_price_720p,video_price_1080p,
      audio_realtime_price_per_min,audio_tts_price_per_million_chars,audio_stt_price_per_hour,
      peak_rate_enabled,peak_start,peak_end,peak_rate_multiplier,long_context_pricing_enabled,
      force_openai_fast,free_openai_fast,allow_live
      FROM groups WHERE deleted_at IS NULL AND status='active' ORDER BY sort_order,id`)
    const mappings = await rows(`SELECT ag.group_id,a.platform,a.credentials->'model_mapping' AS mapping
      FROM accounts a JOIN account_groups ag ON ag.account_id=a.id
      WHERE a.deleted_at IS NULL AND a.status='active' AND a.schedulable=true
        AND (a.expires_at IS NULL OR a.expires_at>now() OR a.auto_pause_on_expired=false)`)
    const channels = await rows(`SELECT c.id,c.billing_model_source,c.restrict_models,c.model_mapping,cg.group_id
      FROM channels c JOIN channel_groups cg ON cg.channel_id=c.id WHERE c.status='active'`)
    const prices = await rows('SELECT * FROM channel_model_pricing ORDER BY id')
    const intervals = await rows('SELECT * FROM channel_pricing_intervals ORDER BY sort_order,id')
    const routes = await rows('SELECT group_id,public_model,match_type,target_platform,upstream_model,priority FROM composite_model_routes WHERE deleted_at IS NULL AND enabled=true ORDER BY priority,id')
    const poolGroupIds = (await rows('SELECT group_id FROM direct_pool_configs WHERE enabled=true')).map(g => String(g.group_id))
    const pools = await rows(`SELECT p.id,p.group_id,p.platform,p.name,p.rate_multiplier,p.is_default,p.sort_order
      FROM direct_account_pools p JOIN direct_pool_configs c ON c.group_id=p.group_id AND c.enabled=true
      WHERE p.enabled=true ORDER BY p.sort_order,p.id`)
    const poolMappings = await rows(`SELECT p.id AS pool_id,p.group_id,a.platform,a.credentials->'model_mapping' AS mapping
      FROM direct_account_pools p JOIN direct_pool_configs c ON c.group_id=p.group_id AND c.enabled=true
      JOIN direct_pool_members m ON m.pool_id=p.id AND m.group_id=p.group_id
      JOIN account_groups ag ON ag.group_id=p.group_id AND ag.account_id=m.account_id
      JOIN accounts a ON a.id=m.account_id AND a.platform=p.platform
      WHERE p.enabled=true AND a.deleted_at IS NULL AND a.status='active' AND a.schedulable=true
        AND (a.expires_at IS NULL OR a.expires_at>now() OR a.auto_pause_on_expired=false)`)
    const before = await stat(filename)
    const official = JSON.parse(await readFile(filename, 'utf8'))
    const after = await stat(filename)
    if (before.mtimeMs !== after.mtimeMs || before.size !== after.size) throw new Error('价格文件更新中，请稍后重试')
    if (!official || typeof official !== 'object' || Array.isArray(official) || !Object.keys(official).length) throw new Error('价格文件格式无效')
    await client.query('COMMIT')
    return { groups, mappings, channels, prices, intervals, routes, official, pricingUpdatedAt: after.mtime.toISOString(), poolGroupIds, pools, poolMappings }
  } finally { await client.end() }
}
