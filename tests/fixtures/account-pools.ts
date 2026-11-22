import { modelSourceFixture } from './model-source.js'

export function accountPoolSource() {
  const source = modelSourceFixture()
  source.poolGroupIds = ['12', '67', '78']
  source.pools = []
  source.poolMappings = []
  for (const groupId of source.poolGroupIds) {
    const group = source.groups.find(g => g.id === groupId)!
    Object.assign(group, { image_rate_independent: true, image_rate_multiplier: 1, image_price_1k: groupId === '12' ? 3 : 2 })
    for (const [index, name] of ['ChatGPT-Plus【稳定】', 'ChatGPT-Pro【企业稳定】', 'ChatGPT【官Key】'].entries()) {
      const id = `${groupId}-${index}`, rate = (groupId === '12' ? [4, 8, 15] : [2.667, 5.334, 10])[index]
      source.pools.push({ id, group_id: groupId, platform: 'openai', name, rate_multiplier: rate, is_default: index === 0 })
      source.poolMappings.push({ group_id: groupId, pool_id: id, platform: 'openai', mapping: {
        'gpt-example': 'gpt-example', 'gpt-image-test': 'gpt-image-test', ...(index === 2 ? { 'gpt-official-only': 'gpt-example' } : {})
      } })
    }
  }
  source.official['gpt-official-only'] = source.official['gpt-example']
  return source
}
