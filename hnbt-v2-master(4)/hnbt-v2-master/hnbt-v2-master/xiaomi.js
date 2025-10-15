// xiaomi.js - 小米商城补贴获取批量重发系统
// 基于 https://shop-api.retail.mi.com/mtop/navi/saury/subsidy/fetch 接口

import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import readline from 'readline';
import { getProxyFromSource } from './proxy-config.js';
import { testProxyIP } from './proxy-test.js';
import { proxyManager, isNetworkError, switchProxy } from './proxy-manager.js';
import { logSimpleError } from './simple-logger.js';
import { concurrentProxyManager } from './concurrent-proxy-manager.js';
import { optimizedProxyTester } from './optimized-proxy-test.js';
import { notificationService } from './notification.js';

/**
 * 地区映射配置
 */
const REGION_MAP = {
    'cq': { name: '重庆', regionId: '10' },
    'yn': { name: '云南', regionId: '14' },
    'fj': { name: '福建', regionId: '23' }
};

/**
 * 在线用户信息获取配置
 */
const ONLINE_API_CONFIG = {
    baseURL: 'http://8.148.75.17:3000',
    endpoint: '/api/purchase/records',
    defaultLimit: 20
};

/**
 * 从在线API获取用户信息
 * @param {number} page - 页码，默认为1
 * @param {number} limit - 每页数量，默认为20
 * @returns {Promise<Array>} 用户信息数组
 */
async function fetchOnlineUserAccounts(page = 1, limit = 20) {
    try {
        console.log(`🌐 正在从在线API获取用户信息... (第${page}页，每页${limit}条)`);
        
        const url = `${ONLINE_API_CONFIG.baseURL}${ONLINE_API_CONFIG.endpoint}`;
        const params = {
            page: page,
            limit: limit
        };
        
        const response = await axios.get(url, { 
            params: params,
            timeout: 10000 // 10秒超时
        });
        
        if (response.data && response.data.success && response.data.data) {
            const userRecords = response.data.data;
            console.log(`✅ 成功获取 ${userRecords.length} 条用户记录`);
            
            // 将API数据转换为账户信息格式
            const accounts = userRecords.map(record => {
                // 解析cookie中的serviceToken和userId
                const cookieData = parseCookie(record.cookie);
                
                return {
                    name: record.name,
                    phone: record.phone,
                    accId: `online_acc_${record.id}`,
                    grabToken: `online_token_${record.id}`,
                    uniqueId: record.id.toString(),
                    serviceToken: cookieData.serviceToken || '',
                    userId: cookieData.userId || '',
                    dId: 'OXBJOW5jM2cyZDd2bUh2TTJncDFHS0pCTFl3SUx1QUhEcXFMRytRN2x6aURaK3NSVXV2aHZmUGR6UWtoWDhIUg==', // 默认值
                    dModel: 'aVBob25lMTcsMQ==', // 默认值
                    sentryTrace: '1e52fc5869554d0b8f935be162226a76-dda486e670d9448d-1', // 默认值
                    baggage: 'sentry-environment=RELEASE,sentry-public_key=ee0a98b8e8e3417c89db4f9fd258ef62,sentry-release=com.xiaomi.mishop%405.2.257%2B2509112112,sentry-sample_rate=1,sentry-trace_id=1e52fc5869554d0b8f935be162226a76,sentry-transaction=MSNewMainViewController', // 默认值
                    cateCode: record.product_type || 'B01', // 使用API中的product_type
                    regionId: '10', // 默认重庆地区
                    activityCategory: '100', // 默认值
                    paymentMode: 'UNIONPAY', // 默认值
                    // 保留原始记录信息用于调试
                    originalRecord: {
                        id: record.id,
                        is_success: record.is_success,
                        created_at: record.created_at,
                        updated_at: record.updated_at,
                        purchase_time: record.purchase_time,
                        purchaser: record.purchaser
                    }
                };
            });
            
            console.log(`📊 转换完成: ${accounts.length} 个账户信息`);
            
            // 显示获取到的账户信息摘要
            console.log(`📋 账户信息摘要:`);
            accounts.forEach((account, index) => {
                console.log(`   ${index + 1}. ${account.name} (${account.phone}) - ${account.cateCode}`);
            });
            
            return accounts;
        } else {
            throw new Error('API响应格式不正确或请求失败');
        }
        
    } catch (error) {
        console.error(`💥 获取在线用户信息失败:`, error.message);
        
        // 如果是网络错误，提供更详细的错误信息
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            console.error(`🌐 网络连接错误，请检查API服务是否正常运行: ${ONLINE_API_CONFIG.baseURL}`);
        } else if (error.response) {
            console.error(`📡 API响应错误: ${error.response.status} - ${error.response.statusText}`);
        }
        
        throw error;
    }
}

/**
 * 解析cookie字符串，提取serviceToken和userId
 * @param {string} cookieString - cookie字符串
 * @returns {Object} 包含serviceToken和userId的对象
 */
function parseCookie(cookieString) {
    const result = {
        serviceToken: '',
        userId: ''
    };
    
    if (!cookieString) {
        return result;
    }
    
    try {
        // 移除可能的前后空格
        const cleanCookie = cookieString.trim();
        
        // 查找serviceToken
        const serviceTokenMatch = cleanCookie.match(/serviceToken=([^;]+)/);
        if (serviceTokenMatch) {
            result.serviceToken = serviceTokenMatch[1];
        }
        
        // 查找userId
        const userIdMatch = cleanCookie.match(/userId=([^;]+)/);
        if (userIdMatch) {
            result.userId = userIdMatch[1];
        }
        
        console.log(`🍪 解析cookie成功: serviceToken=${result.serviceToken ? '已获取' : '未找到'}, userId=${result.userId || '未找到'}`);
        
    } catch (error) {
        console.error(`💥 解析cookie失败:`, error.message);
    }
    
    return result;
}

/**
 * 生成安全的文件名，移除或替换非法字符
 * @param {string} name - 原始名称
 * @param {string} phone - 手机号
 * @returns {string} 安全的文件名
 */
function generateSafeFilename(name, phone) {
    // 移除或替换文件名中的非法字符
    const safeName = name
        .replace(/[<>:"/\\|?*]/g, '_')  // 替换Windows不允许的字符
        .replace(/\s+/g, '_')           // 替换空格为下划线
        .replace(/_+/g, '_')            // 合并多个下划线
        .replace(/^_|_$/g, '')          // 移除开头和结尾的下划线
        .substring(0, 50);              // 限制长度避免文件名过长
    
    // 确保手机号也是安全的
    const safePhone = phone.replace(/[^0-9]/g, '');
    
    return `${safeName}_${safePhone}.txt`;
}

/**
 * 小米商城补贴获取器
 */
class XiaomiSubsidyAcquirer {
    constructor(mode = 'direct', proxyType = 1) {
        this.baseURL = 'https://shop-api.retail.mi.com';
        this.endpoint = '/mtop/navi/saury/subsidy/fetch';
        this.maxRetries = 3;
        this.retryDelay = 1000; // 1秒
        this.batchSize = 10; // 批量处理大小
        this.results = [];
        
        // 模式配置
        this.mode = mode; // 'direct' 或 'proxy'
        this.proxyType = proxyType; // 代理类型
        
        console.log(`🔧 初始化补贴获取器 - 模式: ${mode === 'direct' ? '直连模式' : '代理模式'}`);
        if (mode === 'proxy') {
            console.log(`🌐 代理类型: ${proxyType}`);
        }
    }

    /**
     * 创建请求配置
     * @param {Object} accountInfo - 账户信息
     * @param {Object} proxyInfo - 代理信息
     * @returns {Object} axios配置
     */
    createRequestConfig(accountInfo, proxyInfo) {
        // 从账户信息中提取请求参数
        const serviceToken = accountInfo.serviceToken;
        const userId = accountInfo.userId;
        const dId = accountInfo.dId;
        const dModel = accountInfo.dModel;
        const sentryTrace = accountInfo.sentryTrace;
        const baggage = accountInfo.baggage;
        
        // 从账户信息中提取请求体参数
        const cateCode = accountInfo.cateCode;
        const regionId = accountInfo.regionId;
        const activityCategory = accountInfo.activityCategory;
        const paymentMode = accountInfo.paymentMode;
        const config = {
            method: 'POST',
            url: `${this.baseURL}${this.endpoint}`,
            headers: {
                'Host': 'shop-api.retail.mi.com',
                'equipmenttype': '2',
                'x-user-agent': 'channel/mishop platform/mishop.ios',
                'baggage': baggage || 'sentry-environment=RELEASE,sentry-public_key=ee0a98b8e8e3417c89db4f9fd258ef62,sentry-release=com.xiaomi.mishop%405.2.257%2B2509112112,sentry-sample_rate=1,sentry-trace_id=1e52fc5869554d0b8f935be162226a76,sentry-transaction=MSNewMainViewController',
                'Accept': '*/*',
                'd-id': dId || 'OXBJOW5jM2cyZDd2bUh2TTJncDFHS0pCTFl3SUx1QUhEcXFMRytRN2x6aURaK3NSVXV2aHZmUGR6UWtoWDhIUg==',
                'sentry-trace': sentryTrace || '1e52fc5869554d0b8f935be162226a76-dda486e670d9448d-1',
                'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Content-Type': 'application/json',
                'User-Agent': 'MiShop/2509112112 CFNetwork/3826.600.41 Darwin/24.6.0',
                'Connection': 'keep-alive',
                'Cookie': `serviceToken=${serviceToken}; userId=${userId}`,
                'd-model': dModel || 'aVBob25lMTcsMQ=='
            },
            data: [
                {},
                {
                    "cateCode": cateCode || "B01",
                    "regionId": regionId || "10",
                    "activityCategory": activityCategory || "100",
                    "paymentMode": paymentMode || "UNIONPAY"
                }
            ],
            timeout: 30000 // 30秒超时
        };

        // 根据模式决定是否使用代理
        if (this.mode === 'proxy' && proxyInfo && proxyInfo.server && proxyInfo.port && proxyInfo.server !== 'placeholder') {
            // 代理模式：使用代理IP
            const proxyUrl = `http://${proxyInfo.server}:${proxyInfo.port}`;
            config.httpsAgent = new HttpsProxyAgent(proxyUrl);
            config.httpAgent = new HttpsProxyAgent(proxyUrl);
            console.log(`🌐 使用代理: ${proxyInfo.server}:${proxyInfo.port}`);
        } else {
            // 直连模式：直接使用本机IP
            console.log(`🔗 使用直连模式（本机IP）`);
        }

        return config;
    }

    /**
     * 执行补贴获取请求（支持直连模式和代理模式）
     * @param {Object} accountInfo - 账户信息
     * @param {Array} proxyList - 代理IP列表
     * @returns {Promise<Object>} 请求结果
     */
    async acquireSubsidy(accountInfo, proxyList) {
        const startTime = Date.now();
        
        try {
            if (this.mode === 'proxy') {
                // 代理模式：使用3个代理IP并发请求
                console.log(`🎯 开始为账户 ${accountInfo.name}(${accountInfo.phone}) 代理模式并发获取补贴...`);
                console.log(`📡 使用3个代理IP进行并发请求`);

                if (!proxyList || proxyList.length === 0) {
                    throw new Error('代理模式下需要提供代理IP列表');
                }

                // 并发执行3个请求，每个请求使用不同的代理IP
                const promises = [];
                for (let i = 0; i < Math.min(3, proxyList.length); i++) {
                    const proxy = proxyList[i];
                    promises.push(this.executeSingleRequest(accountInfo, proxy, i + 1));
                }

                // 等待所有请求完成
                const results = await Promise.allSettled(promises);
                
                const duration = Date.now() - startTime;
                console.log(`✅ 代理模式并发请求完成，总耗时: ${duration}ms`);

                // 分析结果，找到第一个成功的请求
                let successResult = null;
                let errorMessages = [];
                
                results.forEach((result, index) => {
                    if (result.status === 'fulfilled' && result.value) {
                        if (result.value.success && !successResult) {
                            successResult = result.value;
                            console.log(`🎉 账户 ${accountInfo.name}: 第${index + 1}个代理请求成功！`);
                        } else if (!result.value.success) {
                            errorMessages.push(`代理${index + 1}: ${result.value.error || '请求失败'}`);
                        }
                    } else if (result.status === 'rejected') {
                        errorMessages.push(`代理${index + 1}: ${result.reason?.message || '请求异常'}`);
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
                            proxy: proxyList[0], // 使用第一个代理作为代表
                            error: `代理模式并发${proxyList.length}次请求全部失败: ${errorMessages.join(', ')}`,
                            duration: duration,
                            timestamp: new Date().toISOString(),
                            isNetworkError: true
                        };
                    }
                }

            } else {
                // 直连模式：单次请求，不并发
                console.log(`🎯 开始为账户 ${accountInfo.name}(${accountInfo.phone}) 直连模式获取补贴...`);
                console.log(`📡 使用本机IP单次请求（不并发）`);

                // 直接执行单次请求
                const result = await this.executeSingleRequest(accountInfo, null, 1);
                
                const duration = Date.now() - startTime;
                console.log(`✅ 直连模式请求完成，总耗时: ${duration}ms`);

                return result;
            }

        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`💥 账户 ${accountInfo.name} 请求失败:`, error.message);

            const result = {
                success: false,
                account: accountInfo,
                proxy: this.mode === 'proxy' && proxyList && proxyList.length > 0 ? proxyList[0] : null,
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
        const startTime = Date.now();
        
        try {
            const config = this.createRequestConfig(accountInfo, proxyInfo);
            const response = await axios(config);

            const duration = Date.now() - startTime;

            // 解析响应
            const result = {
                success: true,
                account: accountInfo,
                proxy: proxyInfo,
                response: response.data,
                requestIndex: requestIndex,
                duration: duration,
                timestamp: new Date().toISOString()
            };

            // 检查业务逻辑结果 - 基于tips判断抢券成功
            if (response.data && response.data.code !== undefined) {
                const tips = response.data.data && response.data.data.tips;
                
                // 判断条件：tips为空字符串表示抢券成功
                if (tips === '') {
                    result.success = true;
                    result.message = '抢券成功';
                    result.tips = '';
                    
                    // 发送抢券成功推送通知 - 确认成功，包含完整响应体
                    this.sendSuccessNotification(accountInfo, 'confirmed', response.data);
                    
                } else {
                    // tips不为空字符串，表示失败
                    result.success = false;
                    if (tips) {
                        result.error = tips;
                    } else {
                        result.error = response.data.message || '抢券失败';
                    }
                }
            }

            // 单次请求完成后立即写入日志
            this.saveSingleRequestLog(result);

            return result;

        } catch (error) {
            const duration = Date.now() - startTime;
            const result = {
                success: false,
                account: accountInfo,
                proxy: proxyInfo,
                error: error.message,
                requestIndex: requestIndex,
                duration: duration,
                timestamp: new Date().toISOString(),
                isNetworkError: isNetworkError(error)
            };

            // 单次请求完成后立即写入日志
            this.saveSingleRequestLog(result);

            return result;
        }
    }


    /**
     * 带重试机制的补贴获取（直连模式）
     * @param {Object} accountInfo - 账户信息
     * @param {Array} proxyList - 代理IP列表（已弃用，保持兼容性）
     * @param {boolean} skipRetry - 是否跳过重试（用于智能抢购模式）
     * @returns {Promise<Object>} 最终结果
     */
    async acquireSubsidyWithRetry(accountInfo, proxyList, skipRetry = false) {
        // 如果跳过重试，直接执行一次请求
        if (skipRetry) {
            return await this.acquireSubsidy(accountInfo, proxyList);
        }

        let lastResult = null;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            console.log(`🔄 第 ${attempt}/${this.maxRetries} 次尝试获取补贴...`);

            const result = await this.acquireSubsidy(accountInfo, proxyList);
            lastResult = result;

            // 如果成功，直接返回
            if (result.success) {
                return result;
            }

            // 如果是网络错误且还有重试机会，等待后重试
            if (result.isNetworkError && attempt < this.maxRetries) {
                console.log(`🔄 检测到网络错误，等待后重试...`);
                
                // 等待一段时间后重试
                console.log(`⏳ 等待 ${this.retryDelay}ms 后重试...`);
                await new Promise(resolve => setTimeout(resolve, this.retryDelay));
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

            // 根据模式准备代理IP或创建空列表
            let accountProxyLists = [];
            
            if (this.mode === 'proxy') {
                // 代理模式：为每个账户准备3个代理IP
                console.log(`🔧 代理模式：为 ${batch.length} 个账户准备代理IP...`);
                accountProxyLists = await concurrentProxyManager.prepareProxiesForAccounts(
                    batch, 
                    this.proxyType, 
                    3
                );
            } else {
                // 直连模式：创建空的代理列表
                console.log(`🔧 直连模式：为 ${batch.length} 个账户准备请求...`);
                accountProxyLists = batch.map(() => []); // 创建空的代理列表
            }
            
            // 并发处理当前批次
            const batchPromises = batch.map(async (account, index) => {
                const proxyList = accountProxyLists[index];
                
                // 根据模式处理账户
                if (this.mode === 'proxy') {
                    console.log(`🎯 处理账户 ${account.name}（代理模式）`);
                    const validProxies = proxyList.filter(p => p.server !== 'placeholder');
                    if (validProxies.length === 0) {
                        console.log(`⚠️ 账户 ${account.name} 没有可用代理，跳过处理`);
                        return {
                            success: false,
                            account: account,
                            error: '没有可用的代理IP',
                            timestamp: new Date().toISOString()
                        };
                    }
                } else {
                    console.log(`🎯 处理账户 ${account.name}（直连模式）`);
                }
                
                return await this.acquireSubsidyWithRetry(account, proxyList);
            });

            const batchResults = await Promise.allSettled(batchPromises);
            
            // 处理批次结果
            batchResults.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    results.push(result.value);
                    const account = batch[index];
                    if (result.value.success) {
                        console.log(`✅ 账户 ${account.name} 处理成功`);
                    } else {
                        console.log(`❌ 账户 ${account.name} 处理失败: ${result.value.error}`);
                    }
                } else {
                    console.error(`💥 账户 ${batch[index].name} 处理异常:`, result.reason);
                    results.push({
                        success: false,
                        account: batch[index],
                        error: result.reason?.message || '处理异常',
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
     * 获取批量代理IP（使用并发代理管理器）
     * @param {number} count - 需要的代理数量
     * @param {number} proxyType - 代理类型
     * @returns {Promise<Array>} 代理列表
     */
    async getBatchProxies(count, proxyType) {
        return await concurrentProxyManager.getConcurrentProxies(count, proxyType);
    }

    /**
     * 获取单个代理IP（带重试机制，按需获取避免浪费）
     * @param {number} proxyType - 代理类型
     * @param {number} maxRetries - 最大重试次数
     * @param {number} index - 代理序号
     * @param {number} total - 总代理数
     * @returns {Promise<Object>} 代理信息
     */
    async getSingleProxyWithRetry(proxyType, maxRetries, index, total) {
        let retryCount = 0;
        
        while (retryCount < maxRetries) {
            try {
                // 获取1个代理IP进行校验
                const proxyList = await getProxyFromSource(proxyType, 1);
                
                if (!proxyList || proxyList.length === 0) {
                    throw new Error('获取的代理列表为空');
                }
                
                const proxy = proxyList[0];
                
                // 校验代理IP
                const testResult = await testProxyIP(proxy);
                
                if (testResult.success) {
                    console.log(`✅ 代理 ${index}/${total}: ${proxy.server}:${proxy.port} (${testResult.ip})`);
                    return {
                        ...proxy,
                        validatedIP: testResult.ip
                    };
                } else {
                    console.log(`❌ 代理 ${index}/${total} 验证失败: ${testResult.error} (重试 ${retryCount + 1}/${maxRetries})`);
                }
                
            } catch (error) {
                console.error(`💥 代理 ${index}/${total} 获取失败: ${error.message} (重试 ${retryCount + 1}/${maxRetries})`);
            }
            
            retryCount++;
            if (retryCount < maxRetries) {
                // 短暂延迟后重试
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        // 达到最大重试次数，返回占位符
        console.log(`⚠️ 代理 ${index}/${total} 获取失败，使用占位符`);
        return {
            server: 'placeholder',
            port: 8080,
            source: 'placeholder',
            validatedIP: 'placeholder'
        };
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
     * 保存结果到文件
     * @param {Array} results - 结果数组
     * @param {string} filename - 文件名
     */
    saveResults(results, filename) {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const logDir = 'simple-logs';
            const filepath = `${logDir}/xiaomi-results-${timestamp}.json`;
            
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
            
            // 注意：单次请求日志已在每次请求完成后立即保存，无需批量保存
            
            return filepath;
        } catch (error) {
            console.error('💥 保存结果失败:', error.message);
            return null;
        }
    }

    /**
     * 为每个账户保存独立的日志文件
     * @param {Array} results - 结果数组
     * @param {string} logDir - 日志目录
     */
    saveIndividualLogs(results, logDir) {
        try {
            console.log('📝 开始为每个账户创建独立日志文件...');
            
            results.forEach((result, index) => {
                if (result.account) {
                    const account = result.account;
                    const filename = generateSafeFilename(account.name, account.phone);
                    const filepath = `${logDir}/${filename}`;
                    
                    // 创建日志内容
                    const logContent = this.createIndividualLogContent(result, index + 1);
                    
                    // 写入文件（追加模式）
                    fs.appendFileSync(filepath, logContent, 'utf8');
                    console.log(`📄 账户日志已保存: ${filename}`);
                }
            });
            
            console.log(`✅ 成功为 ${results.length} 个账户创建独立日志文件`);
        } catch (error) {
            console.error('💥 创建独立日志文件失败:', error.message);
        }
    }

    /**
     * 创建单个账户的日志内容
     * @param {Object} result - 单个结果
     * @param {number} index - 结果索引
     * @returns {string} 日志内容
     */
    createIndividualLogContent(result, index) {
        const timestamp = new Date().format('YYYY-MM-DD HH:mm:ss');
        const account = result.account;
        
        let logContent = '';
        logContent += `========================================\n`;
        logContent += `小米商城补贴获取日志 - ${account.name} (${account.phone})\n`;
        logContent += `========================================\n`;
        logContent += `时间: ${timestamp}\n`;
        logContent += `账户: ${account.name}\n`;
        logContent += `手机: ${account.phone}\n`;
        logContent += `用户ID: ${account.userId || 'N/A'}\n`;
        logContent += `结果序号: ${index}\n`;
        logContent += `\n`;
        
        // 请求信息
        logContent += `📡 请求信息:\n`;
        if (result.proxy) {
            logContent += `   代理IP: ${result.proxy.server}:${result.proxy.port}\n`;
            logContent += `   验证IP: ${result.proxy.validatedIP || 'N/A'}\n`;
            logContent += `   代理来源: ${result.proxy.source || 'N/A'}\n`;
        }
        if (result.duration) {
            logContent += `   请求耗时: ${result.duration}ms\n`;
        }
        if (result.requestIndex) {
            logContent += `   请求序号: ${result.requestIndex}\n`;
        }
        logContent += `\n`;
        
        // 结果信息
        logContent += `📊 执行结果:\n`;
        logContent += `   状态: ${result.success ? '✅ 成功' : '❌ 失败'}\n`;
        if (result.success && result.message) {
            logContent += `   成功信息: ${result.message}\n`;
        }
        if (result.success && result.tips) {
            logContent += `   提示信息: ${result.tips}\n`;
        }
        if (result.error) {
            logContent += `   错误信息: ${result.error}\n`;
        }
        logContent += `\n`;
        
        // 响应信息
        if (result.response) {
            logContent += `📨 响应信息:\n`;
            logContent += `   响应码: ${result.response.code || 'N/A'}\n`;
            logContent += `   响应消息: ${result.response.message || 'N/A'}\n`;
            if (result.response.data) {
                logContent += `   业务数据:\n`;
                if (result.response.data.tips) {
                    logContent += `     提示信息: ${result.response.data.tips}\n`;
                }
                if (result.response.data.cateCode) {
                    logContent += `     分类代码: ${result.response.data.cateCode}\n`;
                }
            }
            logContent += `\n`;
        }
        
        // 完整响应（用于调试）
        if (result.response) {
            logContent += `🔍 完整响应数据:\n`;
            logContent += `${JSON.stringify(result.response, null, 2)}\n`;
            logContent += `\n`;
        }
        
        logContent += `========================================\n\n`;
        
        return logContent;
    }

    /**
     * 保存单次请求日志
     * @param {Object} result - 单次请求结果
     */
    saveSingleRequestLog(result) {
        try {
            const logDir = 'simple-logs';
            
            // 确保目录存在
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
                console.log(`📁 创建日志目录: ${logDir}`);
            }
            
            if (result.account) {
                const account = result.account;
                const filename = generateSafeFilename(account.name, account.phone);
                const filepath = `${logDir}/${filename}`;
                
                // 创建单次请求日志内容
                const logContent = this.createSingleRequestLogContent(result);
                
                // 验证日志内容不为空
                if (!logContent || logContent.trim().length === 0) {
                    console.warn(`⚠️ 日志内容为空，跳过保存: ${filename}`);
                    return;
                }
                
                // 写入文件（追加模式）
                fs.appendFileSync(filepath, logContent, 'utf8');
                console.log(`📝 单次请求日志已保存: ${filename} (请求${result.requestIndex || 'N/A'})`);
            } else {
                console.warn(`⚠️ 结果中缺少账户信息，跳过日志保存`);
            }
        } catch (error) {
            console.error('💥 保存单次请求日志失败:', error.message);
            console.error('💥 错误详情:', error);
            
            // 尝试保存到备用位置
            try {
                const backupDir = 'logs-backup';
                if (!fs.existsSync(backupDir)) {
                    fs.mkdirSync(backupDir, { recursive: true });
                }
                
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const backupFile = `${backupDir}/error-${timestamp}.txt`;
                const errorContent = `日志保存错误: ${error.message}\n时间: ${new Date().toISOString()}\n结果: ${JSON.stringify(result, null, 2)}\n`;
                
                fs.writeFileSync(backupFile, errorContent, 'utf8');
                console.log(`📁 错误日志已保存到备用位置: ${backupFile}`);
            } catch (backupError) {
                console.error('💥 备用日志保存也失败:', backupError.message);
            }
        }
    }

    /**
     * 创建单次请求日志内容
     * @param {Object} result - 单次请求结果
     * @returns {string} 日志内容
     */
    createSingleRequestLogContent(result) {
        const timestamp = new Date().toISOString();
        const account = result.account;
        
        let logContent = '';
        logContent += `========================================\n`;
        logContent += `小米商城单次请求日志 - ${account.name} (${account.phone})\n`;
        logContent += `========================================\n`;
        logContent += `时间: ${timestamp}\n`;
        logContent += `账户: ${account.name}\n`;
        logContent += `手机: ${account.phone}\n`;
        logContent += `用户ID: ${account.userId || 'N/A'}\n`;
        logContent += `请求序号: ${result.requestIndex || 'N/A'}\n`;
        logContent += `\n`;
        
        // 请求信息
        logContent += `📡 请求信息:\n`;
        if (result.proxy && result.proxy.server && result.proxy.server !== 'placeholder') {
            logContent += `   连接模式: 代理模式\n`;
            logContent += `   代理: ${result.proxy.server}:${result.proxy.port}\n`;
            logContent += `   代理IP: ${result.proxy.validatedIP}\n`;
        } else {
            logContent += `   连接模式: 直连（本机IP）\n`;
        }
        if (result.duration) {
            logContent += `   请求耗时: ${result.duration}ms\n`;
        }
        logContent += `\n`;
        
        // 结果信息
        logContent += `📊 执行结果:\n`;
        logContent += `   状态: ${result.success ? '✅ 成功' : '❌ 失败'}\n`;
        if (result.success && result.message) {
            logContent += `   成功信息: ${result.message}\n`;
        }
        if (result.success && result.tips) {
            logContent += `   提示信息: ${result.tips}\n`;
        }
        if (result.error) {
            logContent += `   错误信息: ${result.error}\n`;
        }
        logContent += `\n`;
        
        // 响应信息
        if (result.response) {
            logContent += `📨 响应信息:\n`;
            logContent += `   响应码: ${result.response.code || 'N/A'}\n`;
            logContent += `   响应消息: ${result.response.message || 'N/A'}\n`;
            if (result.response.data) {
                logContent += `   业务数据:\n`;
                if (result.response.data.tips) {
                    logContent += `     提示信息: ${result.response.data.tips}\n`;
                }
                if (result.response.data.cateCode) {
                    logContent += `     分类代码: ${result.response.data.cateCode}\n`;
                }
            }
            logContent += `\n`;
        }
        
        // 完整响应（用于调试）
        if (result.response) {
            logContent += `🔍 完整响应数据:\n`;
            logContent += `${JSON.stringify(result.response, null, 2)}\n`;
            logContent += `\n`;
        }
        
        logContent += `========================================\n\n`;
        
        return logContent;
    }

    /**
     * 发送抢券成功推送通知
     * @param {Object} accountInfo - 账户信息
     * @param {string} successType - 成功类型: 'confirmed' (tips为空)
     * @param {Object} responseData - 完整的响应体数据
     */
    async sendSuccessNotification(accountInfo, successType = 'confirmed', responseData = null) {
        try {
            const pushMessage = `${accountInfo.name}-${accountInfo.phone} 抢券成功`;
            console.log(`📱 发送抢券成功推送: ${pushMessage}`);
            
            // 调用小米抢券专用推送服务，传递完整响应体
            await notificationService.sendXiaomiSuccessNotification(accountInfo, pushMessage, successType, responseData);
        } catch (error) {
            console.error(`💥 推送通知发送失败:`, error.message);
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
        const successRate = total > 0 ? (success / total * 100).toFixed(2) : 0;

        console.log('\n📊 执行统计:');
        console.log(`   总请求数: ${total}`);
        console.log(`   成功数: ${success}`);
        console.log(`   失败数: ${failed}`);
        console.log(`   成功率: ${successRate}%`);

        if (success > 0) {
            console.log('\n🎉 成功账户:');
            results.filter(r => r.success).forEach(result => {
                console.log(`   ✅ ${result.account.name} (${result.account.phone})`);
            });
        }

        if (failed > 0) {
            console.log('\n😞 失败账户:');
            results.filter(r => !r.success).forEach(result => {
                console.log(`   ❌ ${result.account.name} (${result.account.phone}): ${result.error}`);
            });
        }
    }
}

/**
 * 根据地区筛选账户
 * @param {Array} accounts - 账户列表
 * @param {string} region - 地区代码 (cq/yn/fj)
 * @returns {Array} 筛选后的账户列表
 */
function filterAccountsByRegion(accounts, region) {
    const regionInfo = REGION_MAP[region];
    if (!regionInfo) {
        console.log(`⚠️ 无效的地区代码: ${region}，使用默认地区重庆`);
        return accounts.filter(account => account.regionId === '10');
    }
    
    const filteredAccounts = accounts.filter(account => account.regionId === regionInfo.regionId);
    console.log(`🔍 地区筛选结果: ${regionInfo.name} (${region}) - 找到 ${filteredAccounts.length}/${accounts.length} 个匹配账户`);
    
    if (filteredAccounts.length === 0) {
        console.log(`⚠️ 没有找到 ${regionInfo.name} 地区的账户，请检查账户配置`);
    } else {
        console.log(`✅ 将只对 ${regionInfo.name} 地区的账户进行抢购，避免IP浪费`);
    }
    
    return filteredAccounts;
}

/**
 * 批量执行小米补贴获取
 * @param {Array} accounts - 账户列表
 * @param {number} proxyType - 代理类型
 * @param {string} region - 地区代码
 * @returns {Promise<Array>} 执行结果
 */
export async function executeXiaomiBatch(accounts, proxyType = 1, region = 'cq') {
    try {
        console.log('🚀 开始执行小米补贴获取批量任务');
        console.log(`📋 总账户数量: ${accounts.length}`);
        console.log(`🌐 代理类型: ${proxyType}`);
        console.log(`🌍 抢购地区: ${REGION_MAP[region]?.name || '重庆'} (${region})`);

        // 根据地区筛选账户
        const filteredAccounts = filterAccountsByRegion(accounts, region);
        
        if (filteredAccounts.length === 0) {
            console.log('❌ 没有找到匹配的账户，任务结束');
            return [];
        }

        const acquirer = new XiaomiSubsidyAcquirer('direct', proxyType);
        const results = await acquirer.processBatch(filteredAccounts, proxyType);

        // 保存结果
        const filepath = acquirer.saveResults(results);
        
        // 打印统计信息
        acquirer.printStatistics(results);

        console.log('\n🎊 批量执行完成！');
        return results;

    } catch (error) {
        console.error('💥 批量执行失败:', error.message);
        throw error;
    }
}

/**
 * 智能抢购执行器
 */
class SmartXiaomiAcquirer {
    constructor(accounts, mode = 'direct', proxyType = 1, startTime = '10:00:00', region = 'cq') {
        // 根据地区筛选账户
        this.allAccounts = accounts;
        this.accounts = filterAccountsByRegion(accounts, region);
        this.region = region;
        this.regionInfo = REGION_MAP[region] || REGION_MAP['cq'];
        
        this.mode = mode; // 'direct' 或 'proxy'
        this.proxyType = proxyType;
        this.startTime = startTime;
        this.targetTime = parseTime(startTime);
        this.prepareTime = new Date(this.targetTime.getTime() - 3 * 60 * 1000); // 提前3分钟
        this.availableProxies = [];
        this.successfulAccounts = new Set();
        this.failedAccounts = new Set();
        this.isRunning = false;
        // 根据模式设置最大重试次数：直连模式无限制用于捡漏，代理模式限制50轮
        this.maxRetryCount = mode === 'direct' ? Infinity : 50;
        this.retryInterval = 200; // 重试间隔200ms
    }

    /**
     * 开始智能抢购流程
     */
    async start() {
        console.log('🚀 启动小米智能抢购系统');
        console.log(`📅 抢购时间: ${this.startTime}`);
        console.log(`⏰ 准备时间: ${this.prepareTime.toLocaleTimeString()}`);
        console.log(`🌍 抢购地区: ${this.regionInfo.name} (${this.region})`);
        console.log(`👥 总账户数量: ${this.allAccounts.length}`);
        console.log(`🎯 筛选后账户数量: ${this.accounts.length}`);
        
        // 根据模式显示不同的提示信息
        if (this.mode === 'direct') {
            console.log(`🔗 直连模式: 无限制抢购，用于捡漏`);
            console.log(`⚠️ 注意: 直连模式将持续抢购直到手动停止 (Ctrl+C) 或所有账户成功`);
        } else {
            console.log(`🌐 代理模式: 最大 ${this.maxRetryCount} 轮抢购`);
        }
        
        // 第一阶段：提前3分钟准备代理IP
        await this.prepareProxies();
        
        // 第二阶段：等待抢购时间
        await this.waitForStartTime();
        
        // 第三阶段：循环抢购
        await this.startSubsidyLoop();
    }

    /**
     * 提前3分钟准备代理IP（并发优化版本）
     */
    async prepareProxies() {
        const now = new Date();
        if (now < this.prepareTime) {
            const waitTime = this.prepareTime.getTime() - now.getTime();
            console.log(`⏳ 等待准备时间，还需 ${Math.floor(waitTime / 1000)} 秒...`);
            
            // 实时显示倒计时
            await this.showCountdown(waitTime, '准备时间');
        }

        if (this.mode === 'proxy') {
            console.log('🔧 代理模式：准备代理IP...');
            
            // 代理模式：为所有账户准备代理IP
            this.accountProxyLists = await concurrentProxyManager.prepareProxiesForAccounts(
                this.accounts, 
                this.proxyType, 
                3
            );
            
            // 统计和显示结果
            let successCount = 0;
            this.accountProxyLists.forEach((proxyList, accountIndex) => {
                const account = this.accounts[accountIndex];
                const validProxies = proxyList.filter(p => p.server !== 'placeholder');
                if (validProxies.length > 0) {
                    successCount++;
                    console.log(`   账户 ${account.name}:`);
                    validProxies.forEach((proxy, proxyIndex) => {
                        console.log(`     ${proxyIndex + 1}. ${proxy.server}:${proxy.port} (${proxy.validatedIP})`);
                    });
                }
            });
            
            console.log(`📊 代理模式准备完成: ${successCount}/${this.accounts.length} 个账户获得有效代理`);
        } else {
            console.log('🔧 直连模式：准备直接请求...');
            
            // 直连模式：不需要准备代理IP，创建空的代理列表
            this.accountProxyLists = this.accounts.map(() => []);
            
            console.log(`📊 直连模式准备完成: ${this.accounts.length} 个账户将使用本机IP直接请求`);
        }
    }

    /**
     * 等待抢购时间
     */
    async waitForStartTime() {
        const now = new Date();
        if (now < this.targetTime) {
            const waitTime = this.targetTime.getTime() - now.getTime();
            console.log(`⏰ 等待抢购时间，还需 ${Math.floor(waitTime / 1000)} 秒...`);
            
            // 实时显示倒计时
            await this.showCountdown(waitTime, '抢购时间');
        }
        
        console.log('🎯 抢购时间到！开始执行...');
    }

    /**
     * 显示实时倒计时
     * @param {number} waitTime - 等待时间（毫秒）
     * @param {string} type - 倒计时类型（准备时间/抢购时间）
     */
    async showCountdown(waitTime, type) {
        const totalSeconds = Math.floor(waitTime / 1000);
        let remainingSeconds = totalSeconds;
        
        console.log(`\n⏰ ${type}倒计时开始 (${totalSeconds}秒):`);
        
        // 每秒更新一次倒计时
        while (remainingSeconds > 0) {
            const minutes = Math.floor(remainingSeconds / 60);
            const seconds = remainingSeconds % 60;
            const timeStr = minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;
            
            // 使用 \r 覆盖当前行，实现实时更新
            process.stdout.write(`\r⏰ ${type}倒计时: ${timeStr} (剩余 ${remainingSeconds} 秒) `);
            
            // 等待1秒
            await new Promise(resolve => setTimeout(resolve, 1000));
            remainingSeconds--;
        }
        
        // 倒计时结束，换行并显示完成信息
        console.log(`\n✅ ${type}倒计时结束！`);
    }

    /**
     * 开始循环抢购
     */
    async startSubsidyLoop() {
        this.isRunning = true;
        let round = 1;
        
        while (this.isRunning && this.successfulAccounts.size < this.accounts.length && round <= this.maxRetryCount) {
            // 根据模式显示不同的日志信息
            if (this.mode === 'direct') {
                console.log(`\n🔄 第 ${round} 轮抢购开始 (直连模式-捡漏模式)`);
                console.log(`📊 状态: 成功 ${this.successfulAccounts.size}/${this.accounts.length}, 失败 ${this.failedAccounts.size}`);
                console.log(`🔁 捡漏模式：将持续抢购直到手动停止或所有账户成功`);
            } else {
                console.log(`\n🔄 第 ${round}/${this.maxRetryCount} 轮抢购开始 (代理模式)`);
                console.log(`📊 状态: 成功 ${this.successfulAccounts.size}/${this.accounts.length}, 失败 ${this.failedAccounts.size}`);
            }
            
            // 获取未成功的账户
            const remainingAccounts = this.accounts.filter(account => 
                !this.successfulAccounts.has(account.phone)
            );
            
            if (remainingAccounts.length === 0) {
                console.log('🎉 所有账户都已成功抢到补贴！');
                break;
            }
            
            // 并发执行抢购
            const promises = remainingAccounts.map(async (account) => {
                if (this.successfulAccounts.has(account.phone)) {
                    return null; // 已成功，跳过
                }
                
                // 根据模式处理
                const accountIndex = this.accounts.indexOf(account);
                const proxyList = this.accountProxyLists[accountIndex] || [];
                
                if (this.mode === 'proxy') {
                    // 代理模式：检查是否有可用代理
                    const validProxies = proxyList.filter(p => p.server !== 'placeholder');
                    if (validProxies.length === 0) {
                        console.log(`⚠️ 账户 ${account.name} 没有可用代理，跳过处理`);
                        return {
                            success: false,
                            account: account,
                            error: '没有可用的代理IP',
                            timestamp: new Date().toISOString()
                        };
                    }
                    console.log(`🚀 账户 ${account.name}: 开始代理模式并发请求...`);
                } else {
                    // 直连模式
                    console.log(`🚀 账户 ${account.name}: 开始直连模式请求...`);
                }
                
                const acquirer = new XiaomiSubsidyAcquirer(this.mode, this.proxyType);
                return await acquirer.acquireSubsidyWithRetry(account, proxyList, true); // 跳过重试，由循环处理
            });
            
            const results = await Promise.allSettled(promises);
            
            // 处理结果
            results.forEach((result, index) => {
                if (result.status === 'fulfilled' && result.value) {
                    const account = remainingAccounts[index];
                    if (result.value.success) {
                        console.log(`✅ 账户 ${account.name} 抢补贴成功！`);
                        this.successfulAccounts.add(account.phone);
                    } else {
                        console.log(`❌ 账户 ${account.name} 抢补贴失败: ${result.value.error}`);
                        this.failedAccounts.add(account.phone);
                    }
                }
            });
            
            // 显示当前轮次结果
            console.log(`📈 第 ${round} 轮结果: 成功 ${this.successfulAccounts.size}/${this.accounts.length}`);
            
            // 如果还有未成功的账户，等待后继续下一轮
            if (this.successfulAccounts.size < this.accounts.length) {
                if (this.mode === 'direct') {
                    // 直连模式：无限循环，等待后继续
                    console.log(`⏳ 直连模式等待 ${this.retryInterval}ms 后继续捡漏...`);
                } else {
                    // 代理模式：检查是否还有轮次
                    if (round < this.maxRetryCount) {
                        console.log(`⏳ 等待 ${this.retryInterval}ms 后开始下一轮...`);
                    }
                }
                await new Promise(resolve => setTimeout(resolve, this.retryInterval));
            }
            
            round++;
        }
        
        // 显示最终结果
        if (this.successfulAccounts.size >= this.accounts.length) {
            console.log('🎉 所有账户都已成功抢到补贴！');
        } else if (round > this.maxRetryCount && this.mode === 'proxy') {
            console.log(`⚠️ 代理模式已达到最大重试次数 ${this.maxRetryCount}，停止抢购`);
        } else if (!this.isRunning) {
            console.log('🛑 用户手动停止了抢购');
        }
        
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
            console.log('\n🎉 成功抢到补贴的账户:');
            this.accounts.forEach(account => {
                if (this.successfulAccounts.has(account.phone)) {
                    console.log(`   ✅ ${account.name} (${account.phone})`);
                }
            });
        }
        
        if (this.failedAccounts.size > 0) {
            console.log('\n😞 未成功抢到补贴的账户:');
            this.accounts.forEach(account => {
                if (this.failedAccounts.has(account.phone)) {
                    console.log(`   ❌ ${account.name} (${account.phone})`);
                }
            });
        }
        
        // 保存每个账户的独立日志
        this.saveSmartAcquisitionLogs();
    }

    /**
     * 保存智能抢购的每个账户日志
     */
    saveSmartAcquisitionLogs() {
        try {
            console.log('\n📝 开始保存智能抢购日志...');
            const logDir = 'simple-logs';
            
            // 确保目录存在
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
                console.log(`📁 创建日志目录: ${logDir}`);
            }
            
            this.accounts.forEach((account, index) => {
                const filename = generateSafeFilename(account.name, account.phone);
                const filepath = `${logDir}/${filename}`;
                
                // 创建智能抢购日志内容
                const logContent = this.createSmartAcquisitionLogContent(account, index + 1);
                
                // 写入文件（追加模式）
                fs.appendFileSync(filepath, logContent, 'utf8');
                console.log(`📄 智能抢购日志已保存: ${filename}`);
            });
            
            console.log(`✅ 成功为 ${this.accounts.length} 个账户保存智能抢购日志`);
        } catch (error) {
            console.error('💥 保存智能抢购日志失败:', error.message);
        }
    }

    /**
     * 创建智能抢购的单个账户日志内容
     * @param {Object} account - 账户信息
     * @param {number} index - 账户索引
     * @returns {string} 日志内容
     */
    createSmartAcquisitionLogContent(account, index) {
        const timestamp = new Date().toISOString();
        const isSuccess = this.successfulAccounts.has(account.phone);
        
        let logContent = '';
        logContent += `========================================\n`;
        logContent += `小米商城智能抢购日志 - ${account.name} (${account.phone})\n`;
        logContent += `========================================\n`;
        logContent += `时间: ${timestamp}\n`;
        logContent += `账户: ${account.name}\n`;
        logContent += `手机: ${account.phone}\n`;
        logContent += `用户ID: ${account.userId || 'N/A'}\n`;
        logContent += `账户序号: ${index}\n`;
        logContent += `\n`;
        
        // 抢购设置
        logContent += `⚙️ 抢购设置:\n`;
        logContent += `   开始时间: ${this.startTime}\n`;
        logContent += `   代理类型: ${this.proxyType}\n`;
        logContent += `   最大重试: ${this.maxRetryCount} 轮\n`;
        logContent += `   重试间隔: ${this.retryInterval}ms\n`;
        logContent += `\n`;
        
        // 连接信息
        logContent += `📡 连接信息:\n`;
        if (result.proxy && result.proxy.server && result.proxy.server !== 'placeholder') {
            logContent += `   模式: 代理模式\n`;
            logContent += `   代理: ${result.proxy.server}:${result.proxy.port}\n`;
            logContent += `   代理IP: ${result.proxy.validatedIP}\n`;
        } else {
            logContent += `   模式: 直连模式（使用本机IP）\n`;
            logContent += `   代理: 无\n`;
        }
        logContent += `\n`;
        
        // 最终结果
        logContent += `📊 最终结果:\n`;
        logContent += `   状态: ${isSuccess ? '✅ 成功' : '❌ 失败'}\n`;
        if (isSuccess) {
            logContent += `   结果: 成功抢到补贴\n`;
        } else {
            logContent += `   结果: 未成功抢到补贴\n`;
        }
        logContent += `\n`;
        
        // 统计信息
        logContent += `📈 整体统计:\n`;
        logContent += `   总账户数: ${this.accounts.length}\n`;
        logContent += `   成功账户: ${this.successfulAccounts.size}\n`;
        logContent += `   失败账户: ${this.failedAccounts.size}\n`;
        logContent += `   成功率: ${((this.successfulAccounts.size / this.accounts.length) * 100).toFixed(2)}%\n`;
        logContent += `\n`;
        
        logContent += `========================================\n\n`;
        
        return logContent;
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
 * @param {string} mode - 运行模式 ('direct' 或 'proxy')
 * @param {number} proxyType - 代理类型
 * @param {string} startTime - 开始时间 (HH:MM:SS)
 * @param {string} region - 地区代码 (cq/yn/fj)
 */
export async function scheduleXiaomiExecution(accounts, mode = 'direct', proxyType = 1, startTime = '10:00:00', region = 'cq') {
    const acquirer = new SmartXiaomiAcquirer(accounts, mode, proxyType, startTime, region);
    return await acquirer.start();
}

/**
 * 创建交互式输入接口
 * @returns {readline.Interface} readline接口
 */
function createReadlineInterface() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

/**
 * 交互式输入函数
 * @param {readline.Interface} rl - readline接口
 * @param {string} question - 问题
 * @returns {Promise<string>} 用户输入
 */
function askQuestion(rl, question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.trim());
        });
    });
}

/**
 * 交互式选择抢购时间
 * @param {readline.Interface} rl - readline接口
 * @returns {Promise<string>} 抢购时间
 */
async function selectStartTime(rl) {
    console.log('\n⏰ 请选择抢购时间:');
    console.log('1. 10:00:00 (默认)');
    console.log('2. 09:30:00');
    console.log('3. 自定义时间');
    
    const choice = await askQuestion(rl, '\n请输入选择 (1-3): ');
    
    switch (choice) {
        case '1':
        case '':
            return '10:00:00';
        case '2':
            return '09:30:00';
        case '3':
            const customTime = await askQuestion(rl, '请输入自定义时间 (格式: HH:MM:SS): ');
            // 简单验证时间格式
            if (/^\d{2}:\d{2}:\d{2}$/.test(customTime)) {
                return customTime;
            } else {
                console.log('⚠️ 时间格式不正确，使用默认时间 10:00:00');
                return '10:00:00';
            }
        default:
            console.log('⚠️ 无效选择，使用默认时间 10:00:00');
            return '10:00:00';
    }
}

/**
 * 交互式选择抢购地区
 * @param {readline.Interface} rl - readline接口
 * @returns {Promise<string>} 地区代码
 */
async function selectRegion(rl) {
    console.log('\n🌍 请选择抢购地区:');
    console.log('1. 重庆 (cq) - regionId: 10');
    console.log('2. 云南 (yn) - regionId: 14');
    console.log('3. 福建 (fj) - regionId: 23');
    
    const choice = await askQuestion(rl, '\n请输入选择 (1-3): ');
    
    switch (choice) {
        case '1':
        case '':
            return 'cq';
        case '2':
            return 'yn';
        case '3':
            return 'fj';
        default:
            console.log('⚠️ 无效选择，使用默认地区重庆');
            return 'cq';
    }
}

/**
 * 交互式选择运行模式
 * @param {readline.Interface} rl - readline接口
 * @returns {Promise<Object>} 运行模式配置
 */
async function selectMode(rl) {
    console.log('\n🔧 请选择运行模式:');
    console.log('1. 直连模式 (direct) - 使用本机IP，适合测试');
    console.log('2. 代理模式 (proxy) - 使用代理IP，适合正式抢购');
    
    const choice = await askQuestion(rl, '\n请输入选择 (1-2): ');
    
    let mode = 'direct';
    let proxyType = 1;
    
    switch (choice) {
        case '1':
        case '':
            mode = 'direct';
            break;
        case '2':
            mode = 'proxy';
            console.log('\n🌐 请选择代理类型:');
            console.log('1. 代理类型 1 (默认)');
            console.log('2. 代理类型 2');
            
            const proxyChoice = await askQuestion(rl, '请输入选择 (1-2): ');
            proxyType = proxyChoice === '2' ? 2 : 1;
            break;
        default:
            console.log('⚠️ 无效选择，使用默认直连模式');
            mode = 'direct';
    }
    
    return { mode, proxyType };
}

/**
 * 交互式抢购流程
 * @param {Array} accounts - 账户列表（可选，如果不提供则从在线API获取）
 * @returns {Promise<void>}
 */
async function interactiveXiaomiExecution(accounts = null) {
    const rl = createReadlineInterface();
    
    try {
        console.log('🚀 欢迎使用小米补贴抢购系统 - 交互式模式');
        
        // 如果没有提供账户列表，从在线API获取
        if (!accounts) {
            console.log('🌐 从在线API获取用户信息...');
            try {
                accounts = await fetchOnlineUserAccounts(1, 100);
                if (!accounts || accounts.length === 0) {
                    console.error('❌ 未获取到任何用户账户信息，程序退出');
                    rl.close();
                    return;
                }
            } catch (error) {
                console.error('💥 获取在线用户信息失败:', error.message);
                console.log('🔄 尝试使用本地账户文件作为备用方案...');
                try {
                    const accountData = fs.readFileSync('xiaomi-accounts.json', 'utf8');
                    accounts = JSON.parse(accountData);
                    console.log('✅ 成功读取本地账户文件作为备用');
                } catch (localError) {
                    console.error('💥 本地账户文件也读取失败:', localError.message);
                    rl.close();
                    return;
                }
            }
        }
        
        console.log(`📋 当前账户总数: ${accounts.length}`);
        
        // 1. 选择抢购时间
        const startTime = await selectStartTime(rl);
        console.log(`✅ 已选择抢购时间: ${startTime}`);
        
        // 2. 选择抢购地区
        const region = await selectRegion(rl);
        const regionInfo = REGION_MAP[region];
        console.log(`✅ 已选择抢购地区: ${regionInfo.name} (${region})`);
        
        // 3. 筛选账户
        const filteredAccounts = filterAccountsByRegion(accounts, region);
        
        if (filteredAccounts.length === 0) {
            console.log('❌ 没有找到匹配的账户，程序退出');
            rl.close();
            return;
        }
        
        // 4. 选择运行模式
        const { mode, proxyType } = await selectMode(rl);
        console.log(`✅ 已选择运行模式: ${mode === 'direct' ? '直连模式' : '代理模式'}`);
        if (mode === 'proxy') {
            console.log(`✅ 代理类型: ${proxyType}`);
        }
        
        // 5. 确认信息
        console.log('\n📋 抢购配置确认:');
        console.log(`   ⏰ 抢购时间: ${startTime}`);
        console.log(`   🌍 抢购地区: ${regionInfo.name} (${region})`);
        console.log(`   👥 筛选账户: ${filteredAccounts.length}/${accounts.length} 个`);
        console.log(`   🔧 运行模式: ${mode === 'direct' ? '直连模式' : '代理模式'}`);
        if (mode === 'proxy') {
            console.log(`   🌐 代理类型: ${proxyType}`);
        }
        
        const confirm = await askQuestion(rl, '\n确认开始抢购? (y/n): ');
        
        if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes' || confirm === '') {
            console.log('\n🎯 开始执行抢购任务...');
            rl.close();
            
            // 执行抢购
            await scheduleXiaomiExecution(filteredAccounts, mode, proxyType, startTime, region);
        } else {
            console.log('❌ 用户取消抢购，程序退出');
            rl.close();
        }
        
    } catch (error) {
        console.error('💥 交互式流程出错:', error.message);
        rl.close();
    }
}

/**
 * 显示帮助信息
 */
function showHelp() {
    console.log(`
🚀 小米补贴获取系统 - 帮助信息

📋 用法:
  node xiaomi.js [选项]           # 命令行模式
  node xiaomi.js --interactive    # 交互式模式

🔧 可用选项:
  --mode <模式>      运行模式: direct(直连) 或 proxy(代理) [默认: direct]
  --proxy <类型>     代理类型: 1 或 2 [默认: 1]
  --time <时间>      开始时间: HH:MM:SS [默认: 10:00:00]
  --region <地区>    抢购地区: cq(重庆) yn(云南) fj(福建) [默认: cq]
  --interactive, -i  启动交互式模式
  --help, -h         显示此帮助信息

🌍 地区说明:
  cq - 重庆 (regionId: 10)
  yn - 云南 (regionId: 14)  
  fj - 福建 (regionId: 24)

📚 使用示例:
  # 交互式模式（推荐新手使用）
  node xiaomi.js --interactive
  
  # 10:00开始的直连模式，抢购重庆地区
  node xiaomi.js --mode direct --time 10:00:00 --region cq
  
  # 10:00开始的代理模式，抢购云南地区
  node xiaomi.js --mode proxy --proxy 1 --time 10:00:00 --region yn
  
  # 09:30开始的代理模式，抢购福建地区
  node xiaomi.js --mode proxy --proxy 2 --time 09:30:00 --region fj
  
  # 立即开始（直连模式，重庆地区）
  node xiaomi.js --mode direct --region cq

🚀 npm 指令快捷方式:
  npm run xiaomi:10:direct     # 10:00直连模式
  npm run xiaomi:10:proxy      # 10:00代理模式
  npm run xiaomi:10:proxy1     # 10:00代理模式(类型1)
  npm run xiaomi:10:proxy2     # 10:00代理模式(类型2)

📊 模式说明:
  🔗 直连模式: 每个账户单次请求，使用本机IP，适合测试
  🌐 代理模式: 每个账户使用3个代理IP并发请求，适合正式抢购

💡 地区筛选说明:
  系统会根据选择的地区自动筛选出相同regionId的账户进行抢购，避免IP浪费
`);
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
    // 从在线API获取账户信息
    try {
        console.log('🚀 启动小米补贴获取系统 - 在线模式');
        console.log('🌐 从在线API获取用户信息...');
        
        // 从在线API获取用户账户信息
        const accountList = await fetchOnlineUserAccounts(1, 20);
        
        if (!accountList || accountList.length === 0) {
            console.error('❌ 未获取到任何用户账户信息，程序退出');
            process.exit(1);
        }

        // 解析命令行参数
        const args = process.argv.slice(2);
        let mode = 'direct'; // 默认直连模式
        let proxyType = 1;
        let startTime = '10:00:00';
        let region = 'cq'; // 默认重庆
        let interactive = false; // 是否使用交互式模式

        for (let i = 0; i < args.length; i++) {
            if (args[i] === '--help' || args[i] === '-h') {
                showHelp();
                process.exit(0);
            } else if (args[i] === '--interactive' || args[i] === '-i') {
                interactive = true;
            } else if (args[i] === '--mode' && i + 1 < args.length) {
                mode = args[i + 1]; // 'direct' 或 'proxy'
            } else if (args[i] === '--proxy' && i + 1 < args.length) {
                proxyType = parseInt(args[i + 1]);
            } else if (args[i] === '--time' && i + 1 < args.length) {
                startTime = args[i + 1];
            } else if (args[i] === '--region' && i + 1 < args.length) {
                region = args[i + 1]; // 'cq', 'yn', 'fj'
            }
        }

        // 检查是否使用交互式模式
        if (interactive) {
            // 交互式模式：不需要验证参数，直接启动交互式流程（不传递账户列表，让函数自己获取）
            await interactiveXiaomiExecution();
        } else {
            // 命令行模式：验证参数并执行
            if (mode !== 'direct' && mode !== 'proxy') {
                console.error('❌ 无效的模式参数，请使用 --mode direct 或 --mode proxy');
                process.exit(1);
            }

            if (!REGION_MAP[region]) {
                console.error(`❌ 无效的地区参数: ${region}，请使用 --region cq/yn/fj`);
                process.exit(1);
            }

            console.log('🚀 小米补贴获取系统启动 - 命令行模式');
            console.log(`📋 总账户数量: ${accountList.length}`);
            console.log(`🔧 运行模式: ${mode === 'direct' ? '直连模式' : '代理模式'}`);
            console.log(`🌐 代理类型: ${proxyType}`);
            console.log(`🌍 抢购地区: ${REGION_MAP[region].name} (${region})`);
            console.log(`⏰ 执行时间: ${startTime}`);

            // 执行任务
            await scheduleXiaomiExecution(accountList, mode, proxyType, startTime, region);
        }

    } catch (error) {
        console.error('💥 启动失败:', error.message);
        process.exit(1);
    }
}

// 导出类和函数
export { XiaomiSubsidyAcquirer, SmartXiaomiAcquirer };
