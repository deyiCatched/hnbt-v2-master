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
        
        const response = await axios.get('https://httpbin.org/ip', {
            httpsAgent: agent,
            timeout: 5000
        });

        console.log('response', response.data);

        const currentIP = response.data.origin;
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