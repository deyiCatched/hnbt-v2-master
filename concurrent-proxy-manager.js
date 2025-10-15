// concurrent-proxy-manager.js - 并发代理管理器
// 优化代理IP获取和校验的性能

import { getProxyFromSource } from './proxy-config.js';
import { testProxyIP } from './proxy-test.js';
import { optimizedProxyTester } from './optimized-proxy-test.js';

/**
 * 并发代理管理器
 */
class ConcurrentProxyManager {
    constructor() {
        this.maxConcurrentRequests = 20; // 最大并发请求数
        this.requestTimeout = 8000; // 请求超时时间（毫秒）
        this.retryDelay = 300; // 重试延迟（毫秒）
    }

    /**
     * 并发获取和校验代理IP
     * @param {number} count - 需要的代理数量
     * @param {number} proxyType - 代理类型
     * @returns {Promise<Array>} 代理列表
     */
    async getConcurrentProxies(count, proxyType) {
        console.log(`🚀 开始并发获取 ${count} 个有效代理IP...`);
        const startTime = Date.now();
        
        // 创建并发任务池
        const taskPool = [];
        const results = [];
        let completedCount = 0;
        let successCount = 0;
        
        // 创建任务
        for (let i = 0; i < count; i++) {
            taskPool.push({
                id: i + 1,
                promise: this.getSingleProxyTask(proxyType, i + 1, count)
            });
        }
        
        // 分批处理并发任务，避免过载
        const batchSize = Math.min(this.maxConcurrentRequests, count);
        const batches = this.chunkArray(taskPool, batchSize);
        
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];
            console.log(`📦 处理第 ${batchIndex + 1}/${batches.length} 批代理任务 (${batch.length} 个)`);
            
            // 并发执行当前批次
            const batchPromises = batch.map(task => 
                task.promise.then(result => {
                    completedCount++;
                    results[task.id - 1] = result;
                    
                    if (result.success) {
                        successCount++;
                        console.log(`✅ 代理 ${task.id}/${count}: ${result.proxy.server}:${result.proxy.port} (${result.ip}) - 进度: ${completedCount}/${count}`);
                    } else {
                        console.log(`❌ 代理 ${task.id}/${count}: 失败 - 进度: ${completedCount}/${count}`);
                    }
                    
                    return result;
                })
            );
            
            // 等待当前批次完成
            await Promise.allSettled(batchPromises);
            
            // 批次间短暂延迟
            if (batchIndex < batches.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
        
        const duration = Date.now() - startTime;
        const validProxies = results.filter(r => r && r.success);
        
        console.log(`📊 并发代理获取完成: ${successCount}/${count} 个成功，耗时 ${duration}ms`);
        console.log(`⚡ 平均每个代理耗时: ${Math.round(duration / count)}ms`);
        
        // 返回标准格式的代理列表
        return results.map(result => {
            if (result && result.success) {
                return {
                    ...result.proxy,
                    validatedIP: result.ip
                };
            } else {
                return {
                    server: 'placeholder',
                    port: 8080,
                    source: 'placeholder',
                    validatedIP: 'placeholder'
                };
            }
        });
    }

    /**
     * 单个代理获取任务（优化版本：按需获取IP并校验）
     * @param {number} proxyType - 代理类型
     * @param {number} index - 代理序号
     * @param {number} total - 总代理数
     * @returns {Promise<Object>} 任务结果
     */
    async getSingleProxyTask(proxyType, index, total) {
        const maxRetries = 3;
        
        for (let retry = 0; retry < maxRetries; retry++) {
            try {
                // 获取1个代理IP进行校验
                const proxyList = await this.withTimeout(
                    getProxyFromSource(proxyType, 1),
                    this.requestTimeout
                );
                
                if (!proxyList || proxyList.length === 0) {
                    throw new Error('获取的代理列表为空');
                }
                
                const proxy = proxyList[0];
                
                // 校验代理IP
                const testResult = await this.withTimeout(
                    optimizedProxyTester.testProxy(proxy, 'fast'),
                    this.requestTimeout
                );
                
                if (testResult.success) {
                    return {
                        success: true,
                        proxy: proxy,
                        ip: testResult.ip,
                        index: index
                    };
                } else {
                    // 校验失败，重试
                    if (retry < maxRetries - 1) {
                        console.log(`⚠️ 代理 ${index}/${total} 校验失败，重试中...`);
                        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                    }
                }
                
            } catch (error) {
                if (retry < maxRetries - 1) {
                    console.log(`⚠️ 代理 ${index}/${total} 获取失败，重试中...`);
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                }
            }
        }
        
        return {
            success: false,
            error: `代理 ${index} 获取失败`,
            index: index
        };
    }

    /**
     * 为Promise添加超时控制
     * @param {Promise} promise - 原始Promise
     * @param {number} timeout - 超时时间（毫秒）
     * @returns {Promise} 带超时的Promise
     */
    withTimeout(promise, timeout) {
        return Promise.race([
            promise,
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('请求超时')), timeout)
            )
        ]);
    }

    /**
     * 将数组分割成指定大小的块
     * @param {Array} array - 要分割的数组
     * @param {number} size - 块大小
     * @returns {Array} 分割后的数组
     */
    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    /**
     * 为多个账户并发准备代理IP（确保每个账户都有3个有效IP）
     * @param {Array} accounts - 账户列表
     * @param {number} proxyType - 代理类型
     * @param {number} proxyCountPerAccount - 每个账户的代理数量，默认3个
     * @returns {Promise<Array>} 账户代理列表
     */
    async prepareProxiesForAccounts(accounts, proxyType, proxyCountPerAccount = 3) {
        console.log(`🚀 开始为 ${accounts.length} 个账户并发准备代理IP（确保每个账户${proxyCountPerAccount}个有效IP）...`);
        const startTime = Date.now();
        
        // 创建账户代理准备任务
        const accountTasks = accounts.map((account, index) => 
            this.ensureValidProxiesForAccount(account, proxyType, proxyCountPerAccount)
                .then(proxyList => {
                    const validProxies = proxyList.filter(p => p.server !== 'placeholder');
                    console.log(`✅ 账户 ${account.name}: 获得 ${validProxies.length}/${proxyCountPerAccount} 个有效代理`);
                    return {
                        account: account,
                        proxyList: proxyList,
                        validCount: validProxies.length
                    };
                })
                .catch(error => {
                    console.error(`❌ 账户 ${account.name}: 代理准备失败 - ${error.message}`);
                    return {
                        account: account,
                        proxyList: [],
                        validCount: 0,
                        error: error.message
                    };
                })
        );
        
        // 并发执行所有账户的代理准备
        const results = await Promise.allSettled(accountTasks);
        
        const duration = Date.now() - startTime;
        const accountProxyLists = [];
        let totalValidProxies = 0;
        
        results.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value) {
                accountProxyLists.push(result.value.proxyList);
                totalValidProxies += result.value.validCount;
            } else {
                accountProxyLists.push([]);
            }
        });
        
        console.log(`📊 账户代理准备完成: ${totalValidProxies} 个有效代理，耗时 ${duration}ms`);
        console.log(`⚡ 平均每个账户耗时: ${Math.round(duration / accounts.length)}ms`);
        
        return accountProxyLists;
    }

    /**
     * 确保单个账户获得指定数量的有效代理IP（按需获取，避免浪费）
     * @param {Object} account - 账户信息
     * @param {number} proxyType - 代理类型
     * @param {number} requiredCount - 需要的有效代理数量
     * @returns {Promise<Array>} 代理列表
     */
    async ensureValidProxiesForAccount(account, proxyType, requiredCount = 3) {
        console.log(`🔧 为账户 ${account.name} 准备 ${requiredCount} 个有效代理IP...`);
        
        const validProxies = [];
        const maxAttempts = 10; // 最大尝试次数
        let attempts = 0;
        
        while (validProxies.length < requiredCount && attempts < maxAttempts) {
            attempts++;
            const needCount = requiredCount - validProxies.length;
            
            try {
                // 按需获取IP：需要多少个就获取多少个
                const proxyList = await this.withTimeout(
                    getProxyFromSource(proxyType, needCount),
                    this.requestTimeout
                );
                
                if (!proxyList || proxyList.length === 0) {
                    console.log(`⚠️ 账户 ${account.name}: 第${attempts}次尝试获取代理为空`);
                    await new Promise(resolve => setTimeout(resolve, 500));
                    continue;
                }
                
                console.log(`📡 账户 ${account.name}: 第${attempts}次尝试，获取到 ${proxyList.length} 个代理IP，开始校验...`);
                
                // 并发校验所有获取到的代理IP
                const validationPromises = proxyList.map(async (proxy, index) => {
                    try {
                        const testResult = await this.withTimeout(
                            optimizedProxyTester.testProxy(proxy, 'fast'),
                            this.requestTimeout
                        );
                        
                        if (testResult.success) {
                            console.log(`✅ 账户 ${account.name}: 代理${index + 1}校验成功 - ${proxy.server}:${proxy.port}`);
                            return {
                                ...proxy,
                                validatedIP: testResult.ip
                            };
                        } else {
                            console.log(`❌ 账户 ${account.name}: 代理${index + 1}校验失败 - ${proxy.server}:${proxy.port}`);
                            return null;
                        }
                    } catch (error) {
                        console.log(`💥 账户 ${account.name}: 代理${index + 1}校验异常 - ${error.message}`);
                        return null;
                    }
                });
                
                const validationResults = await Promise.allSettled(validationPromises);
                
                // 收集有效的代理IP
                let successCount = 0;
                validationResults.forEach(result => {
                    if (result.status === 'fulfilled' && result.value && validProxies.length < requiredCount) {
                        validProxies.push(result.value);
                        successCount++;
                    }
                });
                
                console.log(`📊 账户 ${account.name}: 第${attempts}次尝试，校验通过 ${successCount}/${proxyList.length} 个代理，总计有效代理 ${validProxies.length}/${requiredCount}`);
                
                // 如果还没达到要求，短暂延迟后继续
                if (validProxies.length < requiredCount) {
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
                
            } catch (error) {
                console.log(`⚠️ 账户 ${account.name}: 第${attempts}次尝试失败 - ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        // 如果仍然不够，用占位符填充
        while (validProxies.length < requiredCount) {
            validProxies.push({
                server: 'placeholder',
                port: 8080,
                source: 'placeholder',
                validatedIP: 'placeholder'
            });
        }
        
        console.log(`✅ 账户 ${account.name}: 最终获得 ${validProxies.filter(p => p.server !== 'placeholder').length}/${requiredCount} 个有效代理`);
        
        return validProxies;
    }
}

// 创建单例实例
const concurrentProxyManager = new ConcurrentProxyManager();

// 导出单例和类
export { concurrentProxyManager, ConcurrentProxyManager };
