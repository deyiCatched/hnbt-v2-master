// 测试脚本 - 分析不同IP模式下的请求拦截情况
// 用于测试"资格数量有限，领取失败，请稍后重试"的触发条件

import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { getProxyFromSource } from './proxy-config.js';
import { testProxyIP } from './proxy-test.js';

/**
 * 测试配置
 */
const TEST_CONFIG = {
    // 测试目标API
    apiUrl: 'https://shop-api.retail.mi.com/mtop/navi/saury/subsidy/fetch',
    // 测试次数
    testRounds: 10,
    // 请求间隔（毫秒）
    requestInterval: 1000,
    // 测试账户信息
    testAccount: {
        name: "tdy",
        phone: "17623076304",
        cookie: "route=3ee9b61decf80caa35f6fea8dafbca41; sensorsdata2015jssdkcross=%7B%22distinct_id%22%3A%22196f08a288c19b2-091deb59f7fe508-3c627b45-334836-196f08a288d1e67%22%2C%22first_id%22%3A%22%22%2C%22props%22%3A%7B%22%24latest_traffic_source_type%22%3A%22%E7%9B%B4%E6%8E%A5%E6%B5%81%E9%87%8F%22%2C%22%24latest_search_keyword%22%3A%22%E6%9C%AA%E5%8F%96%E5%88%B0%E5%80%BC_%E7%9B%B4%E6%8E%A5%E6%89%93%E5%BC%80%22%2C%22%24latest_referrer%22%3A%22%22%7D%2C%22identities%22%3A%22eyIkaWRlbnRpdHlfY29va2llX2lkIjoiMTk2ZjA4YTI4OGMxOWIyLTA5MWRlYjU5ZjdmZTUwOC0zYzYyN2I0NS0zMzQ4MzYtMTk2ZjA4YTI4OGQxZTY3In0%3D%22%2C%22history_login_id%22%3A%7B%22name%22%3A%22%22%2C%22value%22%3A%22%22%7D%2C%22%24device_id%22%3A%22196f08a288c19b2-091deb59f7fe508-3c627b45-334836-196f08a288d1e67%22%7D",
        xTingyun: "c=B|p35OnrDoP8k;x=dd59ef8475b541f4",
        appNo: "YJHX3C044025046",
        channelNo: "Q000101",
        token: "sh_097ad75b50adbfae012314b37e5140369b2a30006384e1b2e6f3088bfde4d95b_sh",
        areaCode: "500112",
        longitude: "106.5193283420139",
        latitude: "29.63534966362847",
        acquireType: "1",
        cateCode: "B01",
        activityId: "29",
        coordType: "gcj02ll",
        gpsAreaCode: "500112"
    }
};

/**
 * 测试结果统计
 */
class TestResults {
    constructor(testName) {
        this.testName = testName;
        this.totalRequests = 0;
        this.successfulRequests = 0;
        this.blockedRequests = 0;
        this.networkErrors = 0;
        this.otherErrors = 0;
        this.responses = [];
        this.startTime = Date.now();
    }

    addResult(response, error = null) {
        this.totalRequests++;
        
        if (error) {
            if (this.isBlockingError(error)) {
                this.blockedRequests++;
            } else if (this.isNetworkError(error)) {
                this.networkErrors++;
            } else {
                this.otherErrors++;
            }
        } else if (response) {
            this.successfulRequests++;
            this.responses.push({
                status: response.status,
                data: response.data,
                timestamp: Date.now()
            });
        }
    }

    isBlockingError(error) {
        const errorMessage = error.message?.toLowerCase() || '';
        const responseData = error.response?.data || {};
        
        // 检查是否包含"资格数量有限"错误
        return errorMessage.includes('资格数量有限') || 
               errorMessage.includes('领取失败') ||
               (typeof responseData === 'string' && responseData.includes('资格数量有限')) ||
               (responseData.message && responseData.message.includes('资格数量有限'));
    }

    isNetworkError(error) {
        const errorMessage = error.message?.toLowerCase() || '';
        const errorCode = error.code || '';
        
        return errorCode === 'ECONNRESET' ||
               errorCode === 'ECONNREFUSED' ||
               errorCode === 'ETIMEDOUT' ||
               errorMessage.includes('network') ||
               errorMessage.includes('timeout');
    }

    getResults() {
        const duration = Date.now() - this.startTime;
        return {
            testName: this.testName,
            duration: duration,
            totalRequests: this.totalRequests,
            successfulRequests: this.successfulRequests,
            blockedRequests: this.blockedRequests,
            networkErrors: this.networkErrors,
            otherErrors: this.otherErrors,
            successRate: this.totalRequests > 0 ? (this.successfulRequests / this.totalRequests * 100).toFixed(2) : 0,
            blockingRate: this.totalRequests > 0 ? (this.blockedRequests / this.totalRequests * 100).toFixed(2) : 0,
            responses: this.responses
        };
    }
}

/**
 * 创建请求配置
 */
function createRequestConfig(proxy = null) {
    const config = {
        method: 'POST',
        url: TEST_CONFIG.apiUrl,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': TEST_CONFIG.testAccount.cookie,
            'x-tingyun': TEST_CONFIG.testAccount.xTingyun,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        data: new URLSearchParams({
            appNo: TEST_CONFIG.testAccount.appNo,
            channelNo: TEST_CONFIG.testAccount.channelNo,
            token: TEST_CONFIG.testAccount.token,
            areaCode: TEST_CONFIG.testAccount.areaCode,
            longitude: TEST_CONFIG.testAccount.longitude,
            latitude: TEST_CONFIG.testAccount.latitude,
            acquireType: TEST_CONFIG.testAccount.acquireType,
            cateCode: TEST_CONFIG.testAccount.cateCode,
            activityId: TEST_CONFIG.testAccount.activityId,
            coordType: TEST_CONFIG.testAccount.coordType,
            gpsAreaCode: TEST_CONFIG.testAccount.gpsAreaCode
        }),
        timeout: 10000
    };

    if (proxy) {
        config.httpsAgent = new HttpsProxyAgent(`http://${proxy.server}:${proxy.port}`);
    }

    return config;
}

/**
 * 测试模式1：相同IP情况（不使用代理）
 */
async function testSameIP() {
    console.log('\n🔍 测试模式1：相同IP情况（不使用代理）');
    const results = new TestResults('相同IP模式');
    
    for (let i = 0; i < TEST_CONFIG.testRounds; i++) {
        try {
            console.log(`📤 发送第 ${i + 1} 个请求...`);
            const config = createRequestConfig();
            const response = await axios(config);
            results.addResult(response);
            console.log(`✅ 请求成功 - 状态码: ${response.status}`);
        } catch (error) {
            results.addResult(null, error);
            if (results.isBlockingError(error)) {
                console.log(`🚫 请求被拦截: ${error.message}`);
            } else if (results.isNetworkError(error)) {
                console.log(`🌐 网络错误: ${error.message}`);
            } else {
                console.log(`❌ 其他错误: ${error.message}`);
            }
        }
        
        if (i < TEST_CONFIG.testRounds - 1) {
            await new Promise(resolve => setTimeout(resolve, TEST_CONFIG.requestInterval));
        }
    }
    
    return results.getResults();
}

/**
 * 测试模式2：代理模式不同IP情况（每次请求使用不同代理）
 */
async function testDifferentProxyIP() {
    console.log('\n🔍 测试模式2：代理模式不同IP情况（每次请求使用不同代理）');
    const results = new TestResults('不同代理IP模式');
    
    for (let i = 0; i < TEST_CONFIG.testRounds; i++) {
        try {
            console.log(`📤 发送第 ${i + 1} 个请求...`);
            
            // 获取新的代理IP
            const proxyList = await getProxyFromSource(1, 1);
            const proxy = proxyList[0];
            
            // 测试代理IP是否可用
            const isProxyValid = await testProxyIP(proxy.server, proxy.port);
            if (!isProxyValid) {
                console.log(`⚠️ 代理IP无效，跳过此次请求`);
                continue;
            }
            
            console.log(`🌐 使用代理IP: ${proxy.server}:${proxy.port}`);
            
            const config = createRequestConfig(proxy);
            const response = await axios(config);
            results.addResult(response);
            console.log(`✅ 请求成功 - 状态码: ${response.status}`);
        } catch (error) {
            results.addResult(null, error);
            if (results.isBlockingError(error)) {
                console.log(`🚫 请求被拦截: ${error.message}`);
            } else if (results.isNetworkError(error)) {
                console.log(`🌐 网络错误: ${error.message}`);
            } else {
                console.log(`❌ 其他错误: ${error.message}`);
            }
        }
        
        if (i < TEST_CONFIG.testRounds - 1) {
            await new Promise(resolve => setTimeout(resolve, TEST_CONFIG.requestInterval));
        }
    }
    
    return results.getResults();
}

/**
 * 测试模式3：同一账户分配不同IP情况（使用代理池）
 */
async function testAccountWithProxyPool() {
    console.log('\n🔍 测试模式3：同一账户分配不同IP情况（使用代理池）');
    const results = new TestResults('代理池模式');
    
    // 预先获取多个代理IP
    console.log('🔄 正在获取代理池...');
    const proxyList = await getProxyFromSource(1, 5); // 获取5个代理IP
    console.log(`✅ 成功获取 ${proxyList.length} 个代理IP`);
    
    let proxyIndex = 0;
    
    for (let i = 0; i < TEST_CONFIG.testRounds; i++) {
        try {
            console.log(`📤 发送第 ${i + 1} 个请求...`);
            
            // 轮换使用代理IP
            const proxy = proxyList[proxyIndex % proxyList.length];
            proxyIndex++;
            
            // 测试代理IP是否可用
            const isProxyValid = await testProxyIP(proxy.server, proxy.port);
            if (!isProxyValid) {
                console.log(`⚠️ 代理IP无效，使用下一个代理`);
                proxyIndex++;
                continue;
            }
            
            console.log(`🌐 使用代理IP: ${proxy.server}:${proxy.port}`);
            
            const config = createRequestConfig(proxy);
            const response = await axios(config);
            results.addResult(response);
            console.log(`✅ 请求成功 - 状态码: ${response.status}`);
        } catch (error) {
            results.addResult(null, error);
            if (results.isBlockingError(error)) {
                console.log(`🚫 请求被拦截: ${error.message}`);
            } else if (results.isNetworkError(error)) {
                console.log(`🌐 网络错误: ${error.message}`);
            } else {
                console.log(`❌ 其他错误: ${error.message}`);
            }
        }
        
        if (i < TEST_CONFIG.testRounds - 1) {
            await new Promise(resolve => setTimeout(resolve, TEST_CONFIG.requestInterval));
        }
    }
    
    return results.getResults();
}

/**
 * 运行所有测试并生成报告
 */
async function runAllTests() {
    console.log('🚀 开始IP拦截测试...');
    console.log(`📊 测试配置: ${TEST_CONFIG.testRounds} 轮请求，间隔 ${TEST_CONFIG.requestInterval}ms`);
    
    const allResults = [];
    
    try {
        // 运行测试模式1
        const result1 = await testSameIP();
        allResults.push(result1);
        
        // 等待一段时间避免影响
        console.log('\n⏳ 等待5秒后开始下一个测试...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // 运行测试模式2
        const result2 = await testDifferentProxyIP();
        allResults.push(result2);
        
        // 等待一段时间避免影响
        console.log('\n⏳ 等待5秒后开始下一个测试...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // 运行测试模式3
        const result3 = await testAccountWithProxyPool();
        allResults.push(result3);
        
    } catch (error) {
        console.error('❌ 测试过程中发生错误:', error);
    }
    
    // 生成测试报告
    generateTestReport(allResults);
}

/**
 * 生成测试报告
 */
function generateTestReport(results) {
    console.log('\n📊 测试报告');
    console.log('=' * 60);
    
    results.forEach(result => {
        console.log(`\n🔍 ${result.testName}`);
        console.log(`⏱️  测试时长: ${result.duration}ms`);
        console.log(`📈 总请求数: ${result.totalRequests}`);
        console.log(`✅ 成功请求: ${result.successfulRequests} (${result.successRate}%)`);
        console.log(`🚫 被拦截请求: ${result.blockedRequests} (${result.blockingRate}%)`);
        console.log(`🌐 网络错误: ${result.networkErrors}`);
        console.log(`❌ 其他错误: ${result.otherErrors}`);
    });
    
    // 对比分析
    console.log('\n📊 对比分析');
    console.log('=' * 60);
    
    const bestResult = results.reduce((best, current) => {
        return current.blockingRate < best.blockingRate ? current : best;
    });
    
    console.log(`🏆 最佳模式: ${bestResult.testName}`);
    console.log(`📉 最低拦截率: ${bestResult.blockingRate}%`);
    console.log(`📈 最高成功率: ${bestResult.successRate}%`);
    
    // 建议
    console.log('\n💡 建议');
    console.log('=' * 60);
    
    if (bestResult.testName === '相同IP模式') {
        console.log('✅ 建议使用相同IP模式，拦截率最低');
    } else if (bestResult.testName === '不同代理IP模式') {
        console.log('✅ 建议使用不同代理IP模式，每次请求使用新的代理IP');
    } else if (bestResult.testName === '代理池模式') {
        console.log('✅ 建议使用代理池模式，在多个代理IP之间轮换');
    }
    
    console.log('\n🎯 测试完成！');
}

// 运行测试
if (import.meta.url === `file://${process.argv[1]}`) {
    runAllTests().catch(console.error);
}

export { runAllTests, testSameIP, testDifferentProxyIP, testAccountWithProxyPool };
