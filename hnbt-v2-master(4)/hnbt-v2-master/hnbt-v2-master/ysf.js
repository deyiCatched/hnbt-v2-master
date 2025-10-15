// ysf.js - 银联优惠券获取批量重发系统
// 基于 https://scene.cup.com.cn/gfmnew/appback/couponAcquire 接口

import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { getProxyFromSource } from './proxy-config.js';
import { testProxyIP } from './proxy-test.js';
import { proxyManager, isNetworkError, switchProxy } from './proxy-manager.js';
import { logSimpleError } from './simple-logger.js';

/**
 * 银联优惠券获取器
 */
class YSFCouponAcquirer {
    constructor() {
        this.baseURL = 'https://scene.cup.com.cn';
        this.endpoint = '/gfmnew/appback/couponAcquire';
        this.maxRetries = 3;
        this.retryDelay = 1000; // 1秒
        this.batchSize = 10; // 批量处理大小
        this.results = [];
    }

    /**
     * 创建请求配置
     * @param {Object} accountInfo - 账户信息
     * @param {Object} proxyInfo - 代理信息
     * @returns {Object} axios配置
     */
    createRequestConfig(accountInfo, proxyInfo) {
        // 从账户信息中提取请求参数
        const cookie = accountInfo.cookie
        const xTingyun = accountInfo.xTingyun ;
        const appNo = accountInfo.appNo ;
        const channelNo = accountInfo.channelNo ;
        const token = accountInfo.token ;
        
        // 从账户信息中提取请求体参数
        const areaCode = accountInfo.areaCode ;
        const longitude = accountInfo.longitude ;
        const latitude = accountInfo.latitude ;
        const acquireType = accountInfo.acquireType ;
        const cateCode = accountInfo.cateCode ;
        const activityId = accountInfo.activityId ;
        const engGrade = accountInfo.engGrade || null;
        const coordType = accountInfo.coordType ;
        const gpsAreaCode = accountInfo.gpsAreaCode ;

        const config = {
            method: 'POST',
            url: `${this.baseURL}${this.endpoint}`,
            headers: {
                'Host': 'scene.cup.com.cn',
                'Cookie': cookie,
                'Connection': 'keep-alive',
                'X-Tingyun': xTingyun,
                'Accept': 'application/json, text/plain, */*',
                'Content-Type': 'application/json',
                'Sec-Fetch-Site': 'same-origin',
                'appNo': appNo,
                'channelNo': channelNo,
                'Sec-Fetch-Mode': 'cors',
                'token': token,
                'Origin': 'https://scene.cup.com.cn',
                'bankCode': '',
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148  (com.unionpay.chsp) (cordova 4.5.4) (updebug 0) (version 1020) (UnionPay/1.0 CloudPay) (clientVersion 320) (language zh_CN) (languageFamily zh_CN) (upHtml) (walletMode 00)',
                'Referer': `https://scene.cup.com.cn/gsp_front/2025/index?appNo=${appNo}&channelNo=${channelNo}`,
                'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
                'Sec-Fetch-Dest': 'empty',
                'Accept-Encoding': 'gzip, deflate, br'
            },
            data: {
                "areaCode": areaCode,
                "longitude": longitude,
                "latitude": latitude,
                "acquireType": acquireType,
                "cateCode": cateCode,
                "activityId": activityId,
                "engGrade": engGrade,
                "coordType": coordType,
                "gpsAreaCode": gpsAreaCode
            },
            timeout: 30000 // 30秒超时
        };

        // 如果提供了代理信息且不是占位符，添加代理配置
        if (proxyInfo && proxyInfo.server && proxyInfo.port && proxyInfo.server !== 'placeholder') {
            const proxyUrl = `http://${proxyInfo.server}:${proxyInfo.port}`;
            config.httpsAgent = new HttpsProxyAgent(proxyUrl);
            config.httpAgent = new HttpsProxyAgent(proxyUrl);
        }

        return config;
    }

    /**
     * 执行单次优惠券获取请求（并发10次）
     * @param {Object} accountInfo - 账户信息
     * @param {Object} proxyInfo - 代理信息
     * @returns {Promise<Object>} 请求结果
     */
    async acquireCoupon(accountInfo, proxyInfo) {
        const startTime = Date.now();
        
        try {
            console.log(`🎯 开始为账户 ${accountInfo.name}(${accountInfo.phone}) 并发获取优惠券...`);
            console.log(`📡 使用代理: ${proxyInfo.server}:${proxyInfo.port} (${proxyInfo.validatedIP})`);

            // 并发执行10次请求
            const concurrentRequests = 10;
            const promises = [];
            
            for (let i = 0; i < concurrentRequests; i++) {
                const promise = this.executeSingleRequest(accountInfo, proxyInfo, i + 1);
                promises.push(promise);
            }

            // 等待所有请求完成
            const results = await Promise.allSettled(promises);
            
            const duration = Date.now() - startTime;
            console.log(`✅ 并发请求完成，总耗时: ${duration}ms`);

            // 分析结果，找到第一个成功的请求
            let successResult = null;
            let errorMessages = [];
            
            results.forEach((result, index) => {
                if (result.status === 'fulfilled' && result.value) {
                    if (result.value.success && !successResult) {
                        successResult = result.value;
                        console.log(`🎉 账户 ${accountInfo.name}: 第${index + 1}次请求成功！`);
                    } else if (!result.value.success) {
                        errorMessages.push(`第${index + 1}次: ${result.value.error || '请求失败'}`);
                    }
                } else if (result.status === 'rejected') {
                    errorMessages.push(`第${index + 1}次: ${result.reason?.message || '请求异常'}`);
                }
            });

            // 返回结果
            if (successResult) {
                return successResult;
            } else {
                // 如果没有成功，返回第一个失败的结果
                const firstResult = results.find(r => r.status === 'fulfilled' && r.value);
                if (firstResult) {
                    return firstResult.value;
                } else {
                    // 如果所有请求都失败，返回一个综合错误结果
                    return {
                        success: false,
                        account: accountInfo,
                        proxy: proxyInfo,
                        error: `并发10次请求全部失败: ${errorMessages.join(', ')}`,
                        duration: duration,
                        timestamp: new Date().toISOString(),
                        isNetworkError: true
                    };
                }
            }

        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`💥 账户 ${accountInfo.name} 并发请求失败:`, error.message);

            const result = {
                success: false,
                account: accountInfo,
                proxy: proxyInfo,
                error: error.message,
                duration: duration,
                timestamp: new Date().toISOString(),
                isNetworkError: isNetworkError(error)
            };

            return result;
        }
    }

    /**
     * 执行单次请求
     * @param {Object} accountInfo - 账户信息
     * @param {Object} proxyInfo - 代理信息
     * @param {number} requestIndex - 请求序号
     * @returns {Promise<Object>} 请求结果
     */
    async executeSingleRequest(accountInfo, proxyInfo, requestIndex) {
        try {
            const config = this.createRequestConfig(accountInfo, proxyInfo);
            const response = await axios(config);

            // 解析响应
            const result = {
                success: true,
                account: accountInfo,
                proxy: proxyInfo,
                response: response.data,
                requestIndex: requestIndex,
                timestamp: new Date().toISOString()
            };

            // 检查业务逻辑结果
            if (response.data && response.data.respCd) {
                if (response.data.respCd === '1000') {
                    // 检查响应消息，判断是否真正成功
                    if (response.data.respMsg) {
                        if (response.data.respMsg.includes('已发完') || 
                            response.data.respMsg.includes('请明日') ||
                            response.data.respMsg.includes('已领取') ||
                            response.data.respMsg.includes('已抢完')) {
                            result.success = false;
                            result.error = response.data.respMsg;
                        } else if (response.data.respMsg.includes('成功') || 
                                   response.data.respMsg.includes('领取成功') ||
                                   response.data.respMsg.includes('抢购成功')) {
                            result.success = true;
                        } else {
                            // 其他1000响应，可能是成功，但需要进一步判断
                            result.success = false;
                            result.error = response.data.respMsg;
                        }
                    } else {
                        // 没有响应消息的1000响应，可能是成功
                        result.success = true;
                    }
                } else {
                    result.success = false;
                    result.error = response.data.respMsg || '未知错误';
                }
            }

            return result;

        } catch (error) {
            const result = {
                success: false,
                account: accountInfo,
                proxy: proxyInfo,
                error: error.message,
                requestIndex: requestIndex,
                timestamp: new Date().toISOString(),
                isNetworkError: isNetworkError(error)
            };

            return result;
        }
    }

    /**
     * 带重试机制的优惠券获取
     * @param {Object} accountInfo - 账户信息
     * @param {Object} proxyInfo - 代理信息
     * @param {boolean} skipRetry - 是否跳过重试（用于智能抢购模式）
     * @returns {Promise<Object>} 最终结果
     */
    async acquireCouponWithRetry(accountInfo, proxyInfo, skipRetry = false) {
        // 如果跳过重试，直接执行一次请求
        if (skipRetry) {
            return await this.acquireCoupon(accountInfo, proxyInfo);
        }

        let lastResult = null;
        let currentProxy = proxyInfo;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            console.log(`🔄 第 ${attempt}/${this.maxRetries} 次尝试获取优惠券...`);

            const result = await this.acquireCoupon(accountInfo, currentProxy);
            lastResult = result;

            // 如果成功，直接返回
            if (result.success) {
                return result;
            }

            // 如果是网络错误且还有重试机会，尝试切换代理
            if (result.isNetworkError && attempt < this.maxRetries) {
                console.log(`🔄 检测到网络错误，尝试切换代理...`);
                
                const newProxy = await switchProxy(accountInfo);
                if (newProxy) {
                    currentProxy = newProxy;
                    console.log(`✅ 已切换到新代理: ${newProxy.server}:${newProxy.port}`);
                } else {
                    console.log(`⚠️ 无法获取新代理，继续使用当前代理`);
                }

                // 等待一段时间后重试
                if (attempt < this.maxRetries) {
                    console.log(`⏳ 等待 ${this.retryDelay}ms 后重试...`);
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                }
            } else {
                // 非网络错误或已达到最大重试次数，直接返回
                break;
            }
        }

        return lastResult;
    }

    /**
     * 批量处理账户
     * @param {Array} accounts - 账户列表
     * @param {number} proxyType - 代理类型
     * @returns {Promise<Array>} 处理结果
     */
    async processBatch(accounts, proxyType) {
        console.log(`🚀 开始批量处理 ${accounts.length} 个账户...`);
        
        const results = [];
        const batches = this.chunkArray(accounts, this.batchSize);

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            console.log(`\n📦 处理第 ${i + 1}/${batches.length} 批次 (${batch.length} 个账户)`);

            // 为当前批次获取代理IP
            const batchProxies = await this.getBatchProxies(batch.length, proxyType);
            
            // 并发处理当前批次
            const batchPromises = batch.map(async (account, index) => {
                const proxy = batchProxies[index] || batchProxies[0]; // 如果代理不够，使用第一个
                
                // 如果没有可用代理，创建一个默认的代理对象
                if (!proxy) {
                    console.log(`⚠️ 账户 ${account.name} 没有可用代理，跳过处理`);
                    return {
                        success: false,
                        account: account,
                        error: '没有可用的代理IP',
                        timestamp: new Date().toISOString()
                    };
                }
                
                return await this.acquireCouponWithRetry(account, proxy);
            });

            const batchResults = await Promise.allSettled(batchPromises);
            
            // 处理批次结果
            batchResults.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    results.push(result.value);
                } else {
                    results.push({
                        success: false,
                        account: batch[index],
                        error: result.reason?.message || '未知错误',
                        timestamp: new Date().toISOString()
                    });
                }
            });

            // 批次间延迟
            if (i < batches.length - 1) {
                console.log(`⏳ 批次间延迟 2 秒...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        return results;
    }

    /**
     * 获取批量代理IP
     * @param {number} count - 需要的代理数量
     * @param {number} proxyType - 代理类型
     * @returns {Promise<Array>} 代理列表
     */
    async getBatchProxies(count, proxyType) {
        const proxies = [];
        
        for (let i = 0; i < count; i++) {
            try {
                const proxyList = await getProxyFromSource(proxyType);
                // getProxyFromSource 返回数组，取第一个代理
                const proxy = Array.isArray(proxyList) ? proxyList[0] : proxyList;
                const testResult = await testProxyIP(proxy);
                
                if (testResult.success) {
                    proxies.push({
                        ...proxy,
                        validatedIP: testResult.ip
                    });
                    console.log(`✅ 代理 ${i + 1}/${count}: ${proxy.server}:${proxy.port} (${testResult.ip})`);
                } else {
                    console.log(`❌ 代理 ${i + 1}/${count} 验证失败: ${testResult.error}`);
                    // 如果验证失败，使用第一个成功的代理
                    if (proxies.length > 0) {
                        proxies.push(proxies[0]);
                    } else {
                        // 如果还没有成功的代理，创建一个占位符
                        proxies.push({
                            server: 'placeholder',
                            port: 8080,
                            source: 'placeholder',
                            validatedIP: 'placeholder'
                        });
                    }
                }
            } catch (error) {
                console.error(`💥 获取代理 ${i + 1}/${count} 失败:`, error.message);
                // 如果获取失败，使用第一个成功的代理
                if (proxies.length > 0) {
                    proxies.push(proxies[0]);
                } else {
                    // 如果还没有成功的代理，创建一个占位符
                    proxies.push({
                        server: 'placeholder',
                        port: 8080,
                        source: 'placeholder',
                        validatedIP: 'placeholder'
                    });
                }
            }
        }

        return proxies;
    }

    /**
     * 数组分块
     * @param {Array} array - 原数组
     * @param {number} size - 块大小
     * @returns {Array} 分块后的数组
     */
    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    /**
     * 保存结果到文件
     * @param {Array} results - 结果数组
     * @param {string} filename - 文件名
     */
    saveResults(results, filename) {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const logDir = 'simple-logs';
            const filepath = `${logDir}/ysf-results-${timestamp}.json`;
            
            // 确保目录存在
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
                console.log(`📁 创建日志目录: ${logDir}`);
            }
            
            const data = {
                timestamp: new Date().toISOString(),
                total: results.length,
                success: results.filter(r => r.success).length,
                failed: results.filter(r => !r.success).length,
                results: results
            };

            fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
            console.log(`📁 结果已保存到: ${filepath}`);
            
            return filepath;
        } catch (error) {
            console.error('💥 保存结果失败:', error.message);
            return null;
        }
    }

    /**
     * 打印统计信息
     * @param {Array} results - 结果数组
     */
    printStatistics(results) {
        const total = results.length;
        const success = results.filter(r => r.success).length;
        const failed = total - success;
        const networkErrors = results.filter(r => r.isNetworkError).length;

        console.log('\n📊 执行统计:');
        console.log(`   总请求数: ${total}`);
        console.log(`   成功数: ${success}`);
        console.log(`   失败数: ${failed}`);
        console.log(`   网络错误: ${networkErrors}`);
        console.log(`   成功率: ${((success / total) * 100).toFixed(2)}%`);

        if (failed > 0) {
            console.log('\n❌ 失败详情:');
            results.filter(r => !r.success).forEach((result, index) => {
                console.log(`   ${index + 1}. ${result.account.name}(${result.account.phone}): ${result.error}`);
            });
        }

        if (success > 0) {
            console.log('\n✅ 成功详情:');
            results.filter(r => r.success).forEach((result, index) => {
                console.log(`   ${index + 1}. ${result.account.name}(${result.account.phone}): 优惠券获取成功`);
            });
        }
    }
}

/**
 * 主执行函数
 * @param {Array} accounts - 账户列表
 * @param {number} proxyType - 代理类型
 * @returns {Promise<Array>} 执行结果
 */
export async function executeYSFBatch(accounts, proxyType = 1) {
    const acquirer = new YSFCouponAcquirer();
    
    try {
        console.log('🚀 启动银联优惠券批量获取系统...');
        console.log(`📋 账户数量: ${accounts.length}`);
        console.log(`📡 代理类型: ${proxyType}`);
        console.log('=====================================');

        // 设置代理类型
        proxyManager.setProxyType(proxyType);

        // 执行批量处理
        const results = await acquirer.processBatch(accounts, proxyType);

        // 打印统计信息
        acquirer.printStatistics(results);

        // 保存结果
        acquirer.saveResults(results);

        return results;

    } catch (error) {
        console.error('💥 批量执行失败:', error.message);
        throw error;
    }
}

/**
 * 智能抢购执行器
 */
class SmartCouponAcquirer {
    constructor(accounts, proxyType = 1, startTime = '10:00:00') {
        this.accounts = accounts;
        this.proxyType = proxyType;
        this.startTime = startTime;
        this.targetTime = parseTime(startTime);
        this.prepareTime = new Date(this.targetTime.getTime() - 3 * 60 * 1000); // 提前3分钟
        this.availableProxies = [];
        this.successfulAccounts = new Set();
        this.failedAccounts = new Set();
        this.isRunning = false;
        this.maxRetryCount = 50; // 最大重试次数
        this.retryInterval = 100; // 重试间隔1秒
    }

    /**
     * 开始智能抢购流程
     */
    async start() {
        console.log('🚀 启动智能抢购系统');
        console.log(`📅 抢购时间: ${this.startTime}`);
        console.log(`⏰ 准备时间: ${this.prepareTime.toLocaleTimeString()}`);
        console.log(`👥 账户数量: ${this.accounts.length}`);
        
        // 第一阶段：提前3分钟准备代理IP
        await this.prepareProxies();
        
        // 第二阶段：等待抢购时间
        await this.waitForStartTime();
        
        // 第三阶段：循环抢购
        await this.startCouponLoop();
    }

    /**
     * 提前3分钟准备代理IP
     */
    async prepareProxies() {
        const now = new Date();
        if (now < this.prepareTime) {
            const waitTime = this.prepareTime.getTime() - now.getTime();
            console.log(`⏳ 等待准备时间，还需 ${Math.floor(waitTime / 1000)} 秒...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        console.log('🔧 开始准备代理IP...');
        const acquirer = new YSFCouponAcquirer();
        
        // 获取足够的代理IP（每个账户一个，多准备一些）
        const proxyCount = Math.max(this.accounts.length * 2, 2);
        this.availableProxies = await acquirer.getBatchProxies(proxyCount, this.proxyType);
        
        console.log(`✅ 成功准备 ${this.availableProxies.length} 个可用代理IP`);
        
        // 显示代理IP信息
        this.availableProxies.forEach((proxy, index) => {
            console.log(`   ${index + 1}. ${proxy.server}:${proxy.port} (${proxy.validatedIP})`);
        });
    }

    /**
     * 等待抢购时间
     */
    async waitForStartTime() {
        const now = new Date();
        if (now < this.targetTime) {
            const waitTime = this.targetTime.getTime() - now.getTime();
            console.log(`⏰ 等待抢购时间，还需 ${Math.floor(waitTime / 1000)} 秒...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        console.log('🎯 抢购时间到！开始执行...');
    }

    /**
     * 开始循环抢购
     */
    async startCouponLoop() {
        this.isRunning = true;
        let round = 1;
        
        while (this.isRunning && this.successfulAccounts.size < this.accounts.length && round <= this.maxRetryCount) {
            console.log(`\n🔄 第 ${round} 轮抢购开始`);
            console.log(`📊 状态: 成功 ${this.successfulAccounts.size}/${this.accounts.length}, 失败 ${this.failedAccounts.size}`);
            
            // 获取未成功的账户
            const remainingAccounts = this.accounts.filter(account => 
                !this.successfulAccounts.has(account.phone)
            );
            
            if (remainingAccounts.length === 0) {
                console.log('🎉 所有账户都已成功抢到券！');
                break;
            }
            
            // 并发执行抢购
            const promises = remainingAccounts.map(async (account) => {
                if (this.successfulAccounts.has(account.phone)) {
                    return null; // 已成功，跳过
                }
                
                // 为账户分配代理IP
                const proxyIndex = this.accounts.indexOf(account) % this.availableProxies.length;
                const proxy = this.availableProxies[proxyIndex];
                
                if (!proxy) {
                    console.log(`⚠️ 账户 ${account.name} 没有可用代理`);
                    return {
                        success: false,
                        account: account,
                        error: '没有可用的代理IP',
                        timestamp: new Date().toISOString()
                    };
                }
                
                const acquirer = new YSFCouponAcquirer();
                return await acquirer.acquireCouponWithRetry(account, proxy, true); // 跳过重试，由循环处理
            });
            
            const results = await Promise.allSettled(promises);
            
            // 处理结果
            results.forEach((result, index) => {
                if (result.status === 'fulfilled' && result.value) {
                    const account = remainingAccounts[index];
                    if (result.value.success) {
                        console.log(`✅ 账户 ${account.name} 抢券成功！`);
                        this.successfulAccounts.add(account.phone);
                    } else {
                        console.log(`❌ 账户 ${account.name} 抢券失败: ${result.value.error}`);
                        this.failedAccounts.add(account.phone);
                    }
                }
            });
            
            // 显示当前轮次结果
            console.log(`📈 第 ${round} 轮结果: 成功 ${this.successfulAccounts.size}/${this.accounts.length}`);
            
            // 如果还有未成功的账户，等待后继续下一轮
            if (this.successfulAccounts.size < this.accounts.length && round < this.maxRetryCount) {
                console.log(`⏳ 等待 ${this.retryInterval}ms 后开始下一轮...`);
                await new Promise(resolve => setTimeout(resolve, this.retryInterval));
            }
            
            round++;
        }
        
        // 显示最终结果
        this.showFinalResults();
        this.isRunning = false;
    }

    /**
     * 显示最终结果
     */
    showFinalResults() {
        console.log('\n🎊 抢购结束！最终结果：');
        console.log(`✅ 成功账户: ${this.successfulAccounts.size}/${this.accounts.length}`);
        console.log(`❌ 失败账户: ${this.failedAccounts.size}/${this.accounts.length}`);
        
        if (this.successfulAccounts.size > 0) {
            console.log('\n🎉 成功抢到券的账户:');
            this.accounts.forEach(account => {
                if (this.successfulAccounts.has(account.phone)) {
                    console.log(`   ✅ ${account.name} (${account.phone})`);
                }
            });
        }
        
        if (this.failedAccounts.size > 0) {
            console.log('\n😞 未成功抢到券的账户:');
            this.accounts.forEach(account => {
                if (this.failedAccounts.has(account.phone)) {
                    console.log(`   ❌ ${account.name} (${account.phone})`);
                }
            });
        }
    }

    /**
     * 停止抢购
     */
    stop() {
        console.log('🛑 停止抢购...');
        this.isRunning = false;
    }
}

/**
 * 定时执行函数
 * @param {Array} accounts - 账户列表
 * @param {number} proxyType - 代理类型
 * @param {string} startTime - 开始时间 (HH:MM:SS)
 */
export async function scheduleYSFExecution(accounts, proxyType = 1, startTime = '10:00:00') {
    const acquirer = new SmartCouponAcquirer(accounts, proxyType, startTime);
    return await acquirer.start();
}

/**
 * 解析时间字符串
 * @param {string} timeStr - 时间字符串 (HH:MM:SS)
 * @returns {Date} 时间对象
 */
function parseTime(timeStr) {
    const [hours, minutes, seconds] = timeStr.split(':').map(Number);
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), today.getDate(), hours, minutes, seconds);
}

// 如果直接运行此文件
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (process.argv[1] === __filename) {
    // 读取账户信息
    try {
        const accountData = fs.readFileSync('accounts.json', 'utf8');
        const accounts = JSON.parse(accountData);
        const accountList = Array.isArray(accounts) ? accounts : [accounts];

        // 解析命令行参数
        const args = process.argv.slice(2);
        const proxyType = args.includes('--proxy') && args[args.indexOf('--proxy') + 1] ? 
            parseInt(args[args.indexOf('--proxy') + 1]) : 1;
        const startTime = args.includes('--time') && args[args.indexOf('--time') + 1] ? 
            args[args.indexOf('--time') + 1] : '10:00:00';

        console.log('🎯 银联优惠券批量获取系统');
        console.log(`📋 账户数量: ${accountList.length}`);
        console.log(`📡 代理类型: ${proxyType}`);
        console.log(`⏰ 执行时间: ${startTime}`);
        console.log('=====================================');

        // 执行定时任务
        scheduleYSFExecution(accountList, proxyType, startTime)
            .then(results => {
                console.log('🎉 批量执行完成！');
                process.exit(0);
            })
            .catch(error => {
                console.error('💥 执行失败:', error.message);
                process.exit(1);
            });

    } catch (error) {
        console.error('💥 启动失败:', error.message);
        process.exit(1);
    }
}
