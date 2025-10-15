// optimized-proxy-test.js - 优化的代理IP测试器
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

/**
 * 优化的代理IP测试器
 */
class OptimizedProxyTester {
    constructor() {
        // 多个测试URL，优先使用国内快速服务
        this.testUrls = [
            'https://httpbin.org/ip',           // 备用：国际服务
            'https://api.ip.sb/ip',             // 主要：国内快速服务
            'https://ipinfo.io/ip',             // 备用：国际服务
            'https://icanhazip.com',            // 备用：简单服务
        ];
        
        // 超时配置
        this.timeouts = {
            connection: 2000,    // 连接超时 2秒
            response: 3000,      // 响应超时 3秒
            total: 5000          // 总超时 5秒
        };
        
        // 性能阈值
        this.performanceThresholds = {
            excellent: 1000,     // 优秀：< 1秒
            good: 2000,          // 良好：< 2秒
            acceptable: 3000,    // 可接受：< 3秒
            slow: 5000           // 慢：> 3秒
        };
    }

    /**
     * 快速测试代理IP（优先使用最快的测试方法）
     * @param {Object} proxyInfo - 代理信息
     * @returns {Promise<Object>} 测试结果
     */
    async testProxyFast(proxyInfo) {
        const startTime = Date.now();
        
        try {
            const proxyUrl = `http://${proxyInfo.server}:${proxyInfo.port}`;
            const agent = new HttpsProxyAgent(proxyUrl);

            console.log(`⚡ 快速测试 ${proxyInfo.source} 代理: ${proxyInfo.server}:${proxyInfo.port}`);
            
            // 使用最快的测试URL
            const response = await axios.get(this.testUrls[1], {
                httpsAgent: agent,
                timeout: this.timeouts.response,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            const duration = Date.now() - startTime;
            const currentIP = response.data.toString().trim();

            // 评估性能等级
            const performance = this.evaluatePerformance(duration);
            
            console.log(`✅ 代理测试成功: ${currentIP} (${duration}ms, ${performance})`);

            return {
                success: true,
                ip: currentIP,
                duration: duration,
                performance: performance,
                proxyInfo: proxyInfo,
                testMethod: 'fast'
            };

        } catch (error) {
            const duration = Date.now() - startTime;
            console.log(`❌ 快速测试失败: ${error.message} (${duration}ms)`);
            
            return {
                success: false,
                error: error.message,
                duration: duration,
                proxyInfo: proxyInfo,
                testMethod: 'fast'
            };
        }
    }

    /**
     * 全面测试代理IP（测试多个URL和性能）
     * @param {Object} proxyInfo - 代理信息
     * @returns {Promise<Object>} 测试结果
     */
    async testProxyComprehensive(proxyInfo) {
        const proxyUrl = `http://${proxyInfo.server}:${proxyInfo.port}`;
        const agent = new HttpsProxyAgent(proxyUrl);
        
        console.log(`🔍 全面测试 ${proxyInfo.source} 代理: ${proxyInfo.server}:${proxyInfo.port}`);
        
        const testResults = [];
        let successCount = 0;
        let totalDuration = 0;
        let fastestIP = null;
        let fastestDuration = Infinity;

        // 测试多个URL
        for (let i = 0; i < this.testUrls.length; i++) {
            const url = this.testUrls[i];
            const startTime = Date.now();
            
            try {
                const response = await axios.get(url, {
                    httpsAgent: agent,
                    timeout: this.timeouts.response,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });

                const duration = Date.now() - startTime;
                const currentIP = this.extractIP(response.data);
                
                testResults.push({
                    url: url,
                    success: true,
                    ip: currentIP,
                    duration: duration
                });
                
                successCount++;
                totalDuration += duration;
                
                // 记录最快的IP
                if (duration < fastestDuration) {
                    fastestDuration = duration;
                    fastestIP = currentIP;
                }
                
                console.log(`  ✅ ${url}: ${currentIP} (${duration}ms)`);
                
            } catch (error) {
                const duration = Date.now() - startTime;
                testResults.push({
                    url: url,
                    success: false,
                    error: error.message,
                    duration: duration
                });
                console.log(`  ❌ ${url}: ${error.message} (${duration}ms)`);
            }
        }

        // 计算综合结果
        const averageDuration = successCount > 0 ? totalDuration / successCount : Infinity;
        const successRate = (successCount / this.testUrls.length) * 100;
        const performance = this.evaluatePerformance(averageDuration);

        const result = {
            success: successCount > 0,
            ip: fastestIP,
            duration: fastestDuration,
            averageDuration: averageDuration,
            successRate: successRate,
            performance: performance,
            testResults: testResults,
            proxyInfo: proxyInfo,
            testMethod: 'comprehensive'
        };

        if (result.success) {
            console.log(`✅ 全面测试完成: ${fastestIP} (最快${fastestDuration}ms, 平均${Math.round(averageDuration)}ms, 成功率${Math.round(successRate)}%)`);
        } else {
            console.log(`❌ 全面测试失败: 所有URL都无法访问`);
        }

        return result;
    }

    /**
     * 智能测试代理IP（根据场景选择测试方法）
     * @param {Object} proxyInfo - 代理信息
     * @param {string} mode - 测试模式: 'fast', 'comprehensive', 'auto'
     * @returns {Promise<Object>} 测试结果
     */
    async testProxy(proxyInfo, mode = 'auto') {
        switch (mode) {
            case 'fast':
                return await this.testProxyFast(proxyInfo);
            case 'comprehensive':
                return await this.testProxyComprehensive(proxyInfo);
            case 'auto':
            default:
                // 自动模式：先快速测试，失败则全面测试
                const fastResult = await this.testProxyFast(proxyInfo);
                if (fastResult.success) {
                    return fastResult;
                } else {
                    console.log(`🔄 快速测试失败，尝试全面测试...`);
                    return await this.testProxyComprehensive(proxyInfo);
                }
        }
    }

    /**
     * 批量测试代理IP并排序
     * @param {Array} proxyList - 代理列表
     * @param {string} mode - 测试模式
     * @returns {Promise<Array>} 排序后的代理列表
     */
    async testProxiesBatch(proxyList, mode = 'fast') {
        console.log(`🚀 开始批量测试 ${proxyList.length} 个代理IP...`);
        
        const testPromises = proxyList.map(proxy => 
            this.testProxy(proxy, mode)
        );
        
        const results = await Promise.allSettled(testPromises);
        
        // 处理结果并排序
        const validProxies = [];
        const failedProxies = [];
        
        results.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value.success) {
                validProxies.push({
                    ...result.value.proxyInfo,
                    validatedIP: result.value.ip,
                    duration: result.value.duration,
                    performance: result.value.performance,
                    averageDuration: result.value.averageDuration || result.value.duration,
                    successRate: result.value.successRate || 100
                });
            } else {
                failedProxies.push(proxyList[index]);
            }
        });
        
        // 按响应速度排序（最快的在前）
        validProxies.sort((a, b) => a.duration - b.duration);
        
        console.log(`📊 批量测试完成: ${validProxies.length}/${proxyList.length} 个代理有效`);
        console.log(`🏆 最快代理: ${validProxies[0]?.server}:${validProxies[0]?.port} (${validProxies[0]?.duration}ms)`);
        
        return validProxies;
    }

    /**
     * 评估性能等级
     * @param {number} duration - 响应时间（毫秒）
     * @returns {string} 性能等级
     */
    evaluatePerformance(duration) {
        if (duration <= this.performanceThresholds.excellent) {
            return 'excellent';
        } else if (duration <= this.performanceThresholds.good) {
            return 'good';
        } else if (duration <= this.performanceThresholds.acceptable) {
            return 'acceptable';
        } else {
            return 'slow';
        }
    }

    /**
     * 从响应数据中提取IP地址
     * @param {any} data - 响应数据
     * @returns {string} IP地址
     */
    extractIP(data) {
        if (typeof data === 'string') {
            return data.trim();
        } else if (data && data.origin) {
            return data.origin;
        } else if (data && data.ip) {
            return data.ip;
        } else {
            return 'unknown';
        }
    }

    /**
     * 获取性能等级的中文描述
     * @param {string} performance - 性能等级
     * @returns {string} 中文描述
     */
    getPerformanceDescription(performance) {
        const descriptions = {
            'excellent': '优秀',
            'good': '良好', 
            'acceptable': '可接受',
            'slow': '较慢'
        };
        return descriptions[performance] || '未知';
    }
}

// 创建单例实例
const optimizedProxyTester = new OptimizedProxyTester();

// 导出单例和类
export { optimizedProxyTester, OptimizedProxyTester };

// 兼容性导出（保持原有接口）
export async function testProxyIP(proxyInfo) {
    return await optimizedProxyTester.testProxy(proxyInfo, 'fast');
}

export async function testProxyIPWithRetry(proxyInfo, maxRetries = 3, retryDelay = 2000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const result = await optimizedProxyTester.testProxy(proxyInfo, 'fast');
        
        if (result.success) {
            return result;
        }
        
        if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }
    
    return {
        success: false,
        error: `代理测试失败，重试${maxRetries}次后仍无法连接`,
        proxyInfo: proxyInfo
    };
}
