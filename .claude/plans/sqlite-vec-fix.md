# sqlite-vec 加载链路修复计划

## 问题定位

`src/memory/db.ts:26-32` 当前实现：
```ts
try {
  sqliteVec.load(this.db)
} catch (e) {
  console.warn('[Memory] sqlite-vec not available, vector search disabled')
}
```

**致命缺陷：**
1. 吞掉真实异常 `e`，无法诊断根因
2. 没有显式 vec0.so 路径加载作为 fallback
3. 没有 `vectorEnabled` 状态标记
4. `ensureVecTable()` 不知道扩展是否真的加载成功
5. 日志信息量太低

## 修复方案

### 1. 新增状态标记
```ts
private vectorEnabled: boolean = false
private vectorLoadError: string | null = null
```

### 2. 重构加载逻辑为独立方法
```ts
private loadVectorExtension(): void {
  // 尝试方式1: 包默认 loader
  try {
    sqliteVec.load(this.db)
    this.vectorEnabled = true
    console.info('[Memory] sqlite-vec loaded via package loader')
    return
  } catch (e) {
    const err1 = e instanceof Error ? e.message : String(e)
  }

  // 尝试方式2: 显式路径加载
  try {
    const extPath = sqliteVec.getLoadablePath()
    if (extPath && fs.existsSync(extPath)) {
      this.db.loadExtension(extPath)
      this.vectorEnabled = true
      console.info(`[Memory] sqlite-vec loaded from explicit path: ${extPath}`)
      return
    }
  } catch (e) {
    const err2 = e instanceof Error ? e.message : String(e)
  }

  // 全部失败
  this.vectorEnabled = false
  this.vectorLoadError = `${err1}; ${err2}`
  console.warn(`[Memory] sqlite-vec unavailable: ${this.vectorLoadError}`)
}
```

### 3. 增加能力验证
加载成功后，执行简单 SQL 验证：
```ts
private verifyVectorCapability(): boolean {
  try {
    this.db.exec("SELECT vec_distance_cosine('[0.1,0.2]'::BLOB, '[0.3,0.4]'::BLOB)")
    return true
  } catch {
    return false
  }
}
```

### 4. 修改 ensureVecTable 调用条件
```ts
// 只在 vectorEnabled 时才创建 vec0 表
if (meta?.vectorDims && this.vectorEnabled) {
  this.ensureVecTable(meta.vectorDims)
}
```

### 5. 更新 searchVector 返回逻辑
```ts
searchVector(...): SearchResult[] {
  if (!this.vectorEnabled) return []
  // 原有逻辑...
}
```

## 文件变更

- `src/memory/db.ts`: 主要修改
  - 新增 `vectorEnabled` 状态
  - 新增 `vectorLoadError` 诊断信息
  - 新增 `loadVectorExtension()` 方法
  - 新增 `verifyVectorCapability()` 方法
  - 修改 `openDb()` 调用新加载方法
  - 修改 `ensureSchema()` 条件判断
  - 修改 `searchVector()` 添加能力检查

## 验证步骤

1. 本地编译: `npm run build`
2. VM 内验证: 运行 memory 初始化脚本，检查日志输出
3. 确认三种情况都有清晰日志:
   - 包 loader 成功
   - 显式路径成功
   - 全部失败 + 错误原因

## 风险评估

- **零破坏性**: 失败时继续走 BM25，与当前行为一致
- **向后兼容**: 不改变 API，只改内部状态管理
- **可诊断**: 任何失败都会输出真实原因
