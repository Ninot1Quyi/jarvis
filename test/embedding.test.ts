/**
 * Embedding Provider Integration Test
 *
 * Run: npx tsx test/embedding.test.ts
 *
 * Tests the doubao multimodal embedding API to verify:
 * 1. Request format matches official API spec
 * 2. Response is parsed correctly
 * 3. Returned embedding is a valid normalized vector
 * 4. embedBatch works for multiple texts
 * 5. createEmbeddingProvider factory wires config correctly
 */

import { OpenAIEmbeddingProvider, DashscopeEmbeddingProvider, createEmbeddingProvider } from '../src/memory/embedding.js'
import type { KeyConfig } from '../src/types.js'
import * as fs from 'fs'
import * as path from 'path'

// Load config
const configPath = path.join(import.meta.dirname, '..', 'config', 'config.json')
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as KeyConfig

const embeddingProviderName = (config.memory as any)?.embeddingProvider
const providerConfig = embeddingProviderName ? config[embeddingProviderName] as any : null

if (!providerConfig?.apiKey || !providerConfig?.embedding?.model) {
  console.error(`SKIP: embedding provider "${embeddingProviderName}" not configured in config/config.json`)
  process.exit(0)
}

const API_KEY = providerConfig.apiKey
const MODEL = providerConfig.embedding.model
const BASE_URL = (providerConfig.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '')
const API_URL = providerConfig.embedding.baseUrl ?? `${BASE_URL}/embeddings`

let passed = 0
let failed = 0

function assert(condition: boolean, msg: string): void {
  if (condition) {
    console.log(`  PASS: ${msg}`)
    passed++
  } else {
    console.error(`  FAIL: ${msg}`)
    failed++
  }
}

// ---- Test 1: Raw fetch to verify API format matches curl example ----
async function testRawFetch() {
  console.log('\n[Test 1] Raw fetch - verify request/response format')

  const embCfg = providerConfig.embedding
  const isDashscope = embCfg.apiType === 'dashscope'

  let url: string
  let body: string

  if (isDashscope) {
    url = 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding'
    body = JSON.stringify({
      model: MODEL,
      input: { contents: [{ text: 'hello world' }] },
      parameters: { dimension: embCfg.dimensions ?? 1024 },
    })
  } else {
    url = API_URL
    const isMultimodal = API_URL.includes('multimodal')
    const input = isMultimodal
      ? [{ type: 'text', text: 'hello world' }]
      : ['hello world']
    body = JSON.stringify({ model: MODEL, input })
  }

  console.log(`  URL: ${url}`)
  console.log(`  Body: ${body}`)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body,
  })

  console.log(`  Status: ${res.status}`)
  assert(res.ok, `HTTP ${res.status} should be 200`)

  const json = await res.json() as any

  if (isDashscope) {
    console.log(`  Response keys: ${Object.keys(json).join(', ')}`)
    assert(json.output !== undefined, 'response should have output field')
    const embeddings = json.output.embeddings
    assert(Array.isArray(embeddings), 'output.embeddings should be an array')
    assert(embeddings.length > 0, 'output.embeddings should have at least 1 entry')
    const embedding = embeddings[0].embedding
    assert(Array.isArray(embedding), 'embeddings[0].embedding should be an array')
    assert(embedding.length > 0, `embedding dimension = ${embedding.length}`)
    assert(typeof embedding[0] === 'number', 'embedding values should be numbers')
    console.log(`  Embedding dims: ${embedding.length}`)
    console.log(`  First 5 values: [${embedding.slice(0, 5).map((v: number) => v.toFixed(6)).join(', ')}]`)
  } else {
    console.log(`  Response keys: ${Object.keys(json).join(', ')}`)
    console.log(`  data length: ${json.data?.length}`)
    assert(Array.isArray(json.data), 'response.data should be an array')
    assert(json.data.length > 0, 'response.data should have at least 1 entry')
    const embedding = json.data[0].embedding
    assert(Array.isArray(embedding), 'data[0].embedding should be an array')
    assert(embedding.length > 0, `embedding dimension = ${embedding.length}`)
    assert(typeof embedding[0] === 'number', 'embedding values should be numbers')
    console.log(`  Embedding dims: ${embedding.length}`)
    console.log(`  First 5 values: [${embedding.slice(0, 5).map((v: number) => v.toFixed(6)).join(', ')}]`)
  }
}

// ---- Test 2: OpenAIEmbeddingProvider.embedQuery (single text) ----
async function testEmbedQuery() {
  console.log('\n[Test 2] OpenAIEmbeddingProvider.embedQuery')

  if (providerConfig.embedding.apiType === 'dashscope') {
    console.log('  SKIP: dashscope provider uses DashscopeEmbeddingProvider, not OpenAI')
    return
  }

  const provider = new OpenAIEmbeddingProvider({
    apiKey: API_KEY,
    model: MODEL,
    apiUrl: API_URL,
  })

  const embedding = await provider.embedQuery('Linux is the best operating system')

  assert(Array.isArray(embedding), 'embedQuery returns an array')
  assert(embedding.length > 0, `dimension = ${embedding.length}`)

  // Check L2 normalization: ||v|| should be ~1.0
  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0))
  assert(Math.abs(norm - 1.0) < 0.01, `L2 norm = ${norm.toFixed(6)} (should be ~1.0)`)
}

// ---- Test 3: embedBatch (multiple texts) ----
async function testEmbedBatch() {
  console.log('\n[Test 3] OpenAIEmbeddingProvider.embedBatch')

  if (providerConfig.embedding.apiType === 'dashscope') {
    console.log('  SKIP: dashscope provider uses DashscopeEmbeddingProvider, not OpenAI')
    return
  }

  const provider = new OpenAIEmbeddingProvider({
    apiKey: API_KEY,
    model: MODEL,
    apiUrl: API_URL,
  })

  const texts = [
    'The kernel manages hardware resources',
    'User preferences should be remembered',
    'Git worktrees enable parallel development',
  ]

  const embeddings = await provider.embedBatch(texts)

  assert(embeddings.length === texts.length, `got ${embeddings.length} embeddings for ${texts.length} texts`)

  for (let i = 0; i < embeddings.length; i++) {
    const norm = Math.sqrt(embeddings[i].reduce((s, v) => s + v * v, 0))
    assert(Math.abs(norm - 1.0) < 0.01, `embedding[${i}] L2 norm = ${norm.toFixed(6)}`)
  }

  // Sanity: same-dimension
  const dims = new Set(embeddings.map(e => e.length))
  assert(dims.size === 1, `all embeddings have same dimension: ${[...dims].join(', ')}`)
}

// ---- Test 4: createEmbeddingProvider factory ----
async function testFactory() {
  console.log('\n[Test 4] createEmbeddingProvider factory')

  const provider = createEmbeddingProvider(embeddingProviderName, config)
  assert(provider !== null, `factory returns a provider for ${embeddingProviderName}`)
  assert(provider!.model === MODEL, `model = ${provider!.model}`)

  const embedding = await provider!.embedQuery('test factory wiring')
  assert(embedding.length > 0, `embedding dimension = ${embedding.length}`)

  // Test with non-existent provider
  const none = createEmbeddingProvider('nonexistent', config)
  assert(none === null, 'factory returns null for unknown provider')

  const disabled = createEmbeddingProvider('none', config)
  assert(disabled === null, 'factory returns null for "none"')
}

// ---- Test 5: empty batch ----
async function testEmptyBatch() {
  console.log('\n[Test 5] Empty batch edge case')

  if (providerConfig.embedding.apiType === 'dashscope') {
    console.log('  SKIP: dashscope provider uses DashscopeEmbeddingProvider, not OpenAI')
    return
  }

  const provider = new OpenAIEmbeddingProvider({
    apiKey: API_KEY,
    model: MODEL,
    apiUrl: API_URL,
  })

  const result = await provider.embedBatch([])
  assert(result.length === 0, 'empty input returns empty output')
}

// ---- Test 6: DashscopeEmbeddingProvider text-only ----
async function testDashscopeTextOnly() {
  console.log('\n[Test 6] DashscopeEmbeddingProvider text-only')

  const embCfg = providerConfig.embedding
  if (embCfg.apiType !== 'dashscope') {
    console.log('  SKIP: current provider is not dashscope')
    return
  }

  const { DashscopeEmbeddingProvider } = await import('../src/memory/embedding.js')
  const provider = new DashscopeEmbeddingProvider({
    apiKey: API_KEY,
    model: MODEL,
    dimensions: embCfg.dimensions,
  })

  const embedding = await provider.embedQuery('Linux kernel memory management')
  assert(Array.isArray(embedding), 'embedQuery returns an array')
  assert(embedding.length > 0, `dimension = ${embedding.length}`)

  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0))
  assert(Math.abs(norm - 1.0) < 0.01, `L2 norm = ${norm.toFixed(6)} (should be ~1.0)`)
}

// ---- Test 7: DashscopeEmbeddingProvider multimodal ----
async function testDashscopeMultimodal() {
  console.log('\n[Test 7] DashscopeEmbeddingProvider multimodal (text + image)')

  const embCfg = providerConfig.embedding
  if (embCfg.apiType !== 'dashscope') {
    console.log('  SKIP: current provider is not dashscope')
    return
  }

  const { DashscopeEmbeddingProvider } = await import('../src/memory/embedding.js')
  const provider = new DashscopeEmbeddingProvider({
    apiKey: API_KEY,
    model: MODEL,
    dimensions: embCfg.dimensions,
  })

  // Create a tiny 1x1 red PNG as test image
  const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
  const dataUri = `data:image/png;base64,${tinyPng}`

  const inputs = [
    { text: 'A screenshot of the desktop', images: [dataUri] },
    { text: 'Pure text without images' },
  ]

  const embeddings = await provider.embedMultimodal(inputs)
  assert(embeddings.length === 2, `got ${embeddings.length} embeddings for 2 inputs`)

  for (let i = 0; i < embeddings.length; i++) {
    assert(embeddings[i].length > 0, `embedding[${i}] has dimension ${embeddings[i].length}`)
    const norm = Math.sqrt(embeddings[i].reduce((s, v) => s + v * v, 0))
    assert(Math.abs(norm - 1.0) < 0.01, `embedding[${i}] L2 norm = ${norm.toFixed(6)}`)
  }

  const dims = new Set(embeddings.map(e => e.length))
  assert(dims.size === 1, `all embeddings have same dimension: ${[...dims].join(', ')}`)
}

// ---- Test 8: Factory creates DashscopeEmbeddingProvider for apiType='dashscope' ----
async function testFactoryDashscope() {
  console.log('\n[Test 8] Factory creates DashscopeEmbeddingProvider for dashscope apiType')

  const embCfg = providerConfig.embedding
  if (embCfg.apiType !== 'dashscope') {
    console.log('  SKIP: current provider is not dashscope')
    return
  }

  const provider = createEmbeddingProvider(embeddingProviderName, config)
  assert(provider !== null, 'factory returns a provider')
  assert(provider!.id === 'dashscope', `provider.id = ${provider!.id} (expected dashscope)`)
  assert(provider!.multimodal === true, `provider.multimodal = ${provider!.multimodal}`)
  assert(provider!.model === MODEL, `model = ${provider!.model}`)
}

// ---- Test 9: DashscopeEmbeddingProvider embedBatch ----
async function testDashscopeBatch() {
  console.log('\n[Test 9] DashscopeEmbeddingProvider.embedBatch')

  const embCfg = providerConfig.embedding
  if (embCfg.apiType !== 'dashscope') {
    console.log('  SKIP: current provider is not dashscope')
    return
  }

  const { DashscopeEmbeddingProvider } = await import('../src/memory/embedding.js')
  const provider = new DashscopeEmbeddingProvider({
    apiKey: API_KEY,
    model: MODEL,
    dimensions: embCfg.dimensions,
  })

  const texts = [
    'Process scheduling in operating systems',
    'Virtual memory page tables',
    'File system inode structure',
  ]

  const embeddings = await provider.embedBatch(texts)
  assert(embeddings.length === texts.length, `got ${embeddings.length} embeddings for ${texts.length} texts`)

  for (let i = 0; i < embeddings.length; i++) {
    const norm = Math.sqrt(embeddings[i].reduce((s, v) => s + v * v, 0))
    assert(Math.abs(norm - 1.0) < 0.01, `embedding[${i}] L2 norm = ${norm.toFixed(6)}`)
  }

  const emptyResult = await provider.embedBatch([])
  assert(emptyResult.length === 0, 'empty input returns empty output')
}

// ---- Run all ----
async function main() {
  console.log('='.repeat(60))
  console.log('Embedding Provider Integration Test')
  console.log('='.repeat(60))

  try {
    await testRawFetch()
    await testEmbedQuery()
    await testEmbedBatch()
    await testFactory()
    await testEmptyBatch()
    await testDashscopeTextOnly()
    await testDashscopeMultimodal()
    await testFactoryDashscope()
    await testDashscopeBatch()
  } catch (err) {
    console.error('\nUNEXPECTED ERROR:', err)
    failed++
  }

  console.log('\n' + '='.repeat(60))
  console.log(`Results: ${passed} passed, ${failed} failed`)
  console.log('='.repeat(60))
  process.exit(failed > 0 ? 1 : 0)
}

main()
