import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

/**
 * 测试代理IP是否正常工作
 * @param {Object} proxyInfo - 代理信息
 * @param {string} proxyInfo.server - 代理服务器地址
 * @param {number} proxyInfo.port - 代理端口
 * @param {string} proxyInfo.source - 代理来源
 * @returns {Promise<Object>} 测试结果
 */
export async function testProxyIP(proxyInfo) {
    try {
        const proxyUrl = `http://${proxyInfo.server}:${proxyInfo.port}`;
        const agent = new HttpsProxyAgent(proxyUrl);

        console.log(`🔍 正在测试 ${proxyInfo.source} 代理IP: ${proxyInfo.server}:${proxyInfo.port}`);
        
        // 使用多个快速测试地址，按优先级尝试（优先选择响应更快的服务）
        const testUrls = [
            'https://api.ipify.org?format=json',        // 快速响应，简单JSON格式
            'https://httpbin.org/ip',                   // 原服务，稳定可靠
            'https://ipinfo.io/json',                   // 备用快速服务
            'https://api.myip.com'                      // 另一个备用服务
        ];
        
        let response = null;
        let lastError = null;
        
        for (const testUrl of testUrls) {
            try {
                response = await axios.get(testUrl, {
                    httpsAgent: agent,
                    timeout: 4000  // 4秒超时验证
                });
                break; // 成功则跳出循环
            } catch (error) {
                lastError = error;
                // 仅在最后一个地址失败时输出详细错误信息
                if (testUrl === testUrls[testUrls.length - 1]) {
                    console.log(`⚠️ 所有测试地址都无法访问，最后错误: ${error.message}`);
                }
                continue; // 尝试下一个地址
            }
        }
        
        if (!response) {
            throw lastError || new Error('所有测试地址都无法访问');
        }

        console.log('response', response.data);

        // 根据不同的API返回格式解析IP地址
        let currentIP = null;
        const responseData = response.data;
        
        if (responseData.ip) {
            // api.ipify.org, ipinfo.io 格式: {"ip": "xxx.xxx.xxx.xxx"}
            currentIP = responseData.ip;
        } else if (responseData.origin) {
            // httpbin.org 格式: {"origin": "xxx.xxx.xxx.xxx"}
            currentIP = responseData.origin;
        } else if (typeof responseData === 'string') {
            // api.myip.com 可能返回纯文本格式
            currentIP = responseData.trim();
        } else {
            throw new Error('无法解析IP地址响应格式');
        }
        
        console.log('📍 当前请求IP:', currentIP);

        return {
            success: true,
            ip: currentIP,
            proxyInfo: proxyInfo
        };

    } catch (error) {
        console.error(`❌ 代理IP测试失败 (${proxyInfo.source}):`, error.message);
        return {
            success: false,
            error: error.message,
            proxyInfo: proxyInfo
        };
    }
}

/**
 * 带重试机制的代理IP测试
 * @param {Object} proxyInfo - 代理信息
 * @param {number} maxRetries - 最大重试次数，默认3次
 * @param {number} retryDelay - 重试延迟（毫秒），默认2000ms
 * @returns {Promise<Object>} 测试结果
 */
export async function testProxyIPWithRetry(proxyInfo, maxRetries = 3, retryDelay = 2000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`🔄 第 ${attempt}/${maxRetries} 次代理测试`);
        
        const result = await testProxyIP(proxyInfo);
        
        if (result.success) {
            console.log(`✅ 代理IP测试成功！使用IP: ${result.ip}`);
            return result;
        }
        
        if (attempt < maxRetries) {
            console.log(`⏳ 等待 ${retryDelay/1000} 秒后重试...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }
    
    console.error(`💥 代理IP测试失败，已重试 ${maxRetries} 次`);
    return {
        success: false,
        error: `代理测试失败，重试${maxRetries}次后仍无法连接`,
        proxyInfo: proxyInfo
    };
} 