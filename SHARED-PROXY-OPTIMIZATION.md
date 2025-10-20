# 小米抢购系统共享代理IP优化

## 优化概述

针对`xiaomi.js`中代理模式的阻塞问题，我们实现了共享代理IP管理器，所有账户公用一个代理IP，支持4秒响应验证和5分钟自动切换，大幅提升了抢购效率并降低了成本。

## 主要更改

### 1. 新增 SharedProxyManager 类

- **位置**: `xiaomi.js` 第194-348行
- **功能**: 管理单个共享代理IP的生命周期
- **特性**:
  - 4秒内响应验证
  - 5分钟自动过期切换
  - 并发安全的代理获取
  - 自动刷新机制

### 2. 修改 XiaomiSubsidyAcquirer 类

#### 构造函数优化
- 新增 `sharedProxyManager` 初始化（第444行）
- 仅在代理模式下创建共享代理管理器

#### acquireSubsidy 方法重构（第534-574行）
```javascript
// 代理模式：使用共享代理IP（新的共享模式）
if (!this.sharedProxyManager) {
    throw new Error('代理模式下共享代理管理器未初始化');
}

// 获取当前有效的共享代理IP
const sharedProxy = await this.sharedProxyManager.getValidProxy();
if (!sharedProxy) {
    throw new Error('无法获取有效的共享代理IP');
}

// 使用共享代理执行单次请求
return await this.executeSingleRequest(accountInfo, sharedProxy, 1);
```

### 3. 修改 SmartXiaomiAcquirer 类

#### prepareProxies 方法重写（第1337-1360行）
```javascript
if (this.mode === 'proxy') {
    console.log('🔧 代理模式：准备共享代理IP...');
    
    // 代理模式：初始化共享代理管理器，获取一个共享代理IP
    this.sharedProxyManager = new SharedProxyManager(this.proxyType);
    
    // 预先获取并验证共享代理IP
    const sharedProxy = await this.sharedProxyManager.refreshProxy();
    
    if (sharedProxy) {
        console.log(`✅ 共享代理IP准备完成: ${sharedProxy.server}:${sharedProxy.port} (${sharedProxy.validatedIP})`);
        console.log(`📊 代理模式准备完成: 所有 ${this.accounts.length} 个账户将共享使用这个代理IP`);
        console.log(`⏰ 代理IP有效期: 5分钟，4秒内响应验证`);
    } else {
        throw new Error('无法获取有效的共享代理IP');
    }
}
```

#### startAccountAsyncLoop 方法优化（第1442-1490行）
- 移除了原有的 `accountProxyLists` 依赖
- 使用共享代理管理器验证代理状态
- 传递共享代理管理器给子实例

### 4. 修改 processBatch 和 processBatchNonBlocking 方法

#### processBatch 方法（第916-932行）
- 代理模式不再为每个账户分配3个代理IP
- 改为使用共享代理管理器

#### processBatchNonBlocking 方法（第996-1061行）
- 代理模式使用共享代理管理器
- 为每个账户创建独立的acquirer实例并传递共享代理管理器

### 5. 更新帮助信息和交互说明

#### showHelp 函数（第1951-1954行）
```javascript
📊 模式说明:
  🔗 直连模式: 每个账户单次请求，使用本机IP，适合测试
  🌐 代理模式: 所有账户共享一个代理IP，4秒内响应验证，5分钟自动切换
  ⚡ 共享代理: 所有账户共用同一代理IP，IP过期自动切换，提高效率降低成本
```

#### selectMode 函数（第1749-1751行和1789-1794行）
- 更新代理模式描述
- 添加共享代理模式配置说明

### 6. 优化代理验证

#### proxy-test.js（第21行）
- 将代理验证超时从5秒改为4秒

## 核心特性

### 1. 共享代理IP管理
- **单IP共享**: 所有账户使用同一个代理IP
- **自动切换**: IP过期后自动获取新IP
- **状态监控**: 实时监控代理IP的有效性和剩余时间

### 2. 快速响应验证
- **4秒超时**: 代理IP验证响应时间限制为4秒
- **超时替换**: 超过4秒的代理IP会被自动替换
- **并发安全**: 多线程环境下的安全代理获取
- **重试机制**: 代理IP校验失败时自动重试最多10次，每次间隔1秒

### 3. 自动过期管理
- **5分钟生命周期**: 每个代理IP的有效期为5分钟
- **提前刷新**: 提前1分钟开始刷新新IP，确保无缝切换
- **状态跟踪**: 实时跟踪代理IP的过期时间

## 性能提升

### 1. 效率提升
- **减少代理获取**: 从每账户3个IP改为全局1个IP
- **降低延迟**: 避免了大量代理IP的并发验证
- **资源节省**: 大幅减少代理IP的使用量

### 2. 成本降低
- **IP使用量**: 从 账户数×3 降低到 1 个IP
- **验证成本**: 大幅减少代理IP的验证次数
- **维护简化**: 统一的代理IP管理

### 3. 稳定性增强
- **统一管理**: 所有账户使用相同的代理环境
- **快速故障转移**: 4秒内检测并替换无效IP
- **自动恢复**: IP问题自动解决，无需人工干预

## 兼容性

- **向后兼容**: 保留了原有的方法签名，确保现有代码正常工作
- **渐进式升级**: 可以逐步迁移到新的共享代理模式
- **配置灵活**: 支持多种代理类型和配置选项

## 使用方式

### 命令行模式
```bash
# 使用新的共享代理模式
node xiaomi.js --mode proxy --proxy 1 --time 10:00:00 --region cq
```

### 交互式模式
```bash
# 启动交互式模式，选择代理模式时自动使用共享代理
node xiaomi.js --interactive
```

## 测试验证

创建了 `test-shared-proxy.js` 测试脚本来验证共享代理管理器的功能：
- 代理IP获取和验证
- 缓存机制测试
- 状态监控验证
- 重试机制测试

## 重试机制优化

### 新增重试配置
```javascript
class SharedProxyManager {
    constructor(proxyType = 1) {
        // 重试配置
        this.maxRetryAttempts = 10; // 最大重试次数
        this.retryDelay = 1000; // 重试间隔1秒
        this.retryCount = 0; // 当前重试次数
    }
}
```

### 重试逻辑
1. **代理获取失败**: 当无法从源获取代理IP时，等待1秒后重试
2. **验证超时**: 当代理IP验证超过4秒时，立即重试获取新IP
3. **验证失败**: 当代理IP验证失败时，等待1秒后获取新IP重试
4. **异常处理**: 捕获所有异常，等待1秒后重试，直到达到最大重试次数

### 错误处理优化
- 详细的错误日志，包含重试次数和失败原因
- 状态监控包含重试信息 (`retryCount/maxRetryAttempts`)
- 失败时的详细错误信息，便于问题诊断
