// xiaomi.js - 小米商城补贴获取批量重发系统
// 基于 https://shop-api.retail.mi.com/mtop/navi/saury/subsidy/fetch 接口

import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import https from 'https';
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
            limit: limit,
            is_success:"false",
            name:'tdy'
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
 * 小米商城补贴获取器
 */
class XiaomiSubsidyAcquirer {
    constructor(mode = 'direct', proxyType = 1, options = {}) {
        this.baseURL = 'https://shop-api.retail.mi.com';
        this.endpoint = '/mtop/navi/saury/subsidy/fetch';
        this.maxRetries = 3;
        this.retryDelay = 1000; // 1秒
        this.batchSize = 10; // 批量处理大小
        this.results = [];
        
        // 模式配置
        this.mode = mode; // 'direct' 或 'proxy'
        this.proxyType = proxyType; // 代理类型
        
        // 直连模式优化配置
        this.directConcurrency = options.directConcurrency || 1; // 直连模式固定为单次请求
        this.enableConnectionPool = options.enableConnectionPool !== false; // 默认启用连接池
        this.connectionPoolSize = options.connectionPoolSize || 20; // 连接池大小
        
        // 初始化连接池
        this.initializeConnectionPools();
        
        console.log(`🔧 初始化补贴获取器 - 模式: ${mode === 'direct' ? '直连模式' : '代理模式'}`);
        if (mode === 'proxy') {
            console.log(`🌐 代理类型: ${proxyType}`);
        } else {
            console.log(`🔗 直连模式配置: 单次请求, 连接池=${this.enableConnectionPool ? '启用' : '禁用'}`);
        }
    }

    /**
     * 初始化HTTP连接池
     */
    initializeConnectionPools() {
        if (!this.enableConnectionPool) {
            console.log(`⚠️ 连接池已禁用，将使用传统连接方式`);
            return;
        }

        // 创建直连模式的连接池Agent
        this.directConnectionAgent = new https.Agent({
            keepAlive: true,              // 保持连接活跃
            keepAliveMsecs: 60000,        // 心跳包间隔60秒
            maxSockets: this.connectionPoolSize,  // 最大并发连接数
            maxFreeSockets: Math.floor(this.connectionPoolSize / 2), // 最大空闲连接数
            timeout: 30000,               // 连接超时30秒
            scheduling: 'fifo'            // 先进先出调度
        });

        // 为直连模式创建共享的axios实例
        this.directAxiosInstance = axios.create({
            httpsAgent: this.directConnectionAgent,
            timeout: 30000,
            baseURL: this.baseURL
        });

        console.log(`✅ 直连模式连接池已初始化: 最大连接数=${this.connectionPoolSize}, 空闲连接数=${Math.floor(this.connectionPoolSize / 2)}`);
    }

    /**
     * 获取连接池状态信息
     * @returns {Object} 连接池状态
     */
    getConnectionPoolStatus() {
        if (!this.enableConnectionPool || !this.directConnectionAgent) {
            return { enabled: false, message: '连接池未启用' };
        }

        const agent = this.directConnectionAgent;
        return {
            enabled: true,
            maxSockets: agent.maxSockets,
            maxFreeSockets: agent.maxFreeSockets,
            keepAlive: agent.keepAlive,
            keepAliveMsecs: agent.keepAliveMsecs,
            // 注意: 实际运行时的连接数需要从agent内部获取，这里提供配置信息
            message: `连接池已启用 - 最大连接:${agent.maxSockets}, 最大空闲:${agent.maxFreeSockets}`
        };
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
            // 直连模式：使用连接池（如果启用）
            if (this.enableConnectionPool && this.directConnectionAgent) {
                config.httpsAgent = this.directConnectionAgent;
                console.log(`🔗 使用直连模式（连接池复用）`);
            } else {
                console.log(`🔗 使用直连模式（传统连接）`);
            }
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
                // 代理模式：使用3个代理IP并发请求（无阻塞模式）
                console.log(`🎯 开始为账户 ${accountInfo.name}(${accountInfo.phone}) 代理模式无阻塞并发获取补贴...`);
                console.log(`📡 使用3个代理IP进行无阻塞并发请求`);

                if (!proxyList || proxyList.length === 0) {
                    throw new Error('代理模式下需要提供代理IP列表');
                }

                // 无阻塞并发执行：使用Promise.race获取最快成功的结果
                return await this.executeNonBlockingProxyRequests(accountInfo, proxyList, startTime);

            } else {
                // 直连模式：单次请求，使用连接池
                console.log(`🎯 开始为账户 ${accountInfo.name}(${accountInfo.phone}) 直连模式获取补贴...`);
                console.log(`📡 使用本机IP单次请求（连接池复用）`);

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
     * 无阻塞代理请求执行器（真正的无阻塞版本）
     * @param {Object} accountInfo - 账户信息
     * @param {Array} proxyList - 代理IP列表
     * @param {number} startTime - 开始时间
     * @returns {Promise<Object>} 请求结果
     */
    async executeNonBlockingProxyRequests(accountInfo, proxyList, startTime) {
        const maxConcurrent = Math.min(3, proxyList.length);
        const promises = [];
        let firstSuccess = null;
        let completedCount = 0;
        let errorMessages = [];
        
        console.log(`🚀 启动 ${maxConcurrent} 个代理无阻塞并发请求...`);
        
        // 创建所有并发请求
        for (let i = 0; i < maxConcurrent; i++) {
            const proxy = proxyList[i];
            const promise = this.executeSingleRequest(accountInfo, proxy, i + 1)
                .then(result => {
                    completedCount++;
                    if (result.success && !firstSuccess) {
                        firstSuccess = result;
                        console.log(`🎉 账户 ${accountInfo.name}: 第${i + 1}个代理请求成功！`);
                        // 确保推送通知在成功时立即发送
                        if (result.message === '抢券成功') {
                            console.log(`📱 抢券成功推送通知已发送: ${accountInfo.name}`);
                        }
                    } else if (!result.success) {
                        errorMessages.push(`代理${i + 1}: ${result.error || '请求失败'}`);
                    }
                    return result;
                })
                .catch(error => {
                    completedCount++;
                    console.log(`❌ 账户 ${accountInfo.name}: 第${i + 1}个代理请求异常: ${error.message}`);
                    errorMessages.push(`代理${i + 1}: ${error.message}`);
                    return {
                        success: false,
                        account: accountInfo,
                        proxy: proxy,
                        error: error.message,
                        timestamp: new Date().toISOString(),
                        isNetworkError: isNetworkError(error)
                    };
                });
            
            promises.push(promise);
        }

        // 使用Promise.race获取最快的结果（真正的无阻塞）
        try {
            const raceResult = await Promise.race(promises);
            
            if (raceResult.success) {
                const duration = Date.now() - startTime;
                console.log(`⚡ 账户 ${accountInfo.name} 代理无阻塞请求成功，总耗时: ${duration}ms`);
                return raceResult;
            }
        } catch (error) {
            console.log(`⚠️ 账户 ${accountInfo.name} Promise.race异常: ${error.message}`);
        }

        // 如果没有立即成功，等待所有完成（但这是备用方案，通常不会执行到这里）
        console.log(`⏳ 账户 ${accountInfo.name} 等待所有代理请求完成...`);
        const allResults = await Promise.allSettled(promises);
        const duration = Date.now() - startTime;
        
        // 找到第一个成功的结果
        for (const result of allResults) {
            if (result.status === 'fulfilled' && result.value.success) {
                console.log(`✅ 账户 ${accountInfo.name} 代理请求成功，总耗时: ${duration}ms`);
                return result.value;
            }
        }

        // 返回第一个失败结果
        const firstResult = allResults.find(r => r.status === 'fulfilled');
        if (firstResult) {
            return firstResult.value;
        }

        // 所有都失败
        return {
            success: false,
            account: accountInfo,
            proxy: proxyList[0],
            error: `代理模式并发${maxConcurrent}次请求全部失败: ${errorMessages.join(', ')}`,
            duration: duration,
            timestamp: new Date().toISOString(),
            isNetworkError: true
        };
    }

    /**
     * 超高速无阻塞代理请求执行器（实验性功能）
     * @param {Object} accountInfo - 账户信息
     * @param {Array} proxyList - 代理IP列表
     * @param {number} startTime - 开始时间
     * @returns {Promise<Object>} 请求结果
     */
    async executeUltraFastProxyRequests(accountInfo, proxyList, startTime) {
        const maxConcurrent = Math.min(3, proxyList.length);
        const promises = [];
        let firstSuccess = null;
        let completedCount = 0;
        
        // 创建所有并发请求
        for (let i = 0; i < maxConcurrent; i++) {
            const proxy = proxyList[i];
            const promise = this.executeSingleRequest(accountInfo, proxy, i + 1)
                .then(result => {
                    completedCount++;
                    if (result.success && !firstSuccess) {
                        firstSuccess = result;
                        console.log(`🚀 账户 ${accountInfo.name}: 第${i + 1}个代理超高速成功！`);
                    }
                    return result;
                })
                .catch(error => {
                    completedCount++;
                    console.log(`❌ 账户 ${accountInfo.name}: 第${i + 1}个代理请求异常: ${error.message}`);
                    return {
                        success: false,
                        account: accountInfo,
                        proxy: proxy,
                        error: error.message,
                        timestamp: new Date().toISOString(),
                        isNetworkError: isNetworkError(error)
                    };
                });
            
            promises.push(promise);
        }

        // 使用Promise.race获取最快的结果
        const raceResult = await Promise.race(promises);
        
        if (raceResult.success) {
            const duration = Date.now() - startTime;
            console.log(`⚡ 账户 ${accountInfo.name} 超高速代理请求成功，总耗时: ${duration}ms`);
            return raceResult;
        }

        // 如果没有立即成功，等待所有完成
        const allResults = await Promise.allSettled(promises);
        const duration = Date.now() - startTime;
        
        // 找到第一个成功的结果
        for (const result of allResults) {
            if (result.status === 'fulfilled' && result.value.success) {
                console.log(`✅ 账户 ${accountInfo.name} 代理请求成功，总耗时: ${duration}ms`);
                return result.value;
            }
        }

        // 返回第一个失败结果
        const firstResult = allResults.find(r => r.status === 'fulfilled');
        if (firstResult) {
            return firstResult.value;
        }

        // 所有都失败
        return {
            success: false,
            account: accountInfo,
            proxy: proxyList[0],
            error: '所有代理请求都失败',
            duration: duration,
            timestamp: new Date().toISOString(),
            isNetworkError: true
        };
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
            
            // 根据模式选择axios实例
            let response;
            if (this.mode === 'direct' && this.enableConnectionPool && this.directAxiosInstance) {
                // 直连模式使用连接池实例
                response = await this.directAxiosInstance(config);
            } else {
                // 代理模式或禁用连接池时使用传统方式
                response = await axios(config);
            }

            const duration = Date.now() - startTime;

            // 解析响应
            const result = {
                success: true,
                account: accountInfo,
                proxy: proxyInfo,
                response: response.data,
                requestIndex: requestIndex,
                duration: duration,
                timestamp: new Date().toISOString(),
                connectionPoolUsed: this.mode === 'direct' && this.enableConnectionPool
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
                isNetworkError: isNetworkError(error),
                connectionPoolUsed: this.mode === 'direct' && this.enableConnectionPool
            };

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
     * 批量处理账户（无阻塞并发模式）
     * @param {Array} accounts - 账户列表
     * @param {number} proxyType - 代理类型
     * @returns {Promise<Array>} 处理结果
     */
    async processBatch(accounts, proxyType) {
        console.log(`🚀 开始无阻塞批量处理 ${accounts.length} 个账户...`);
        
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
            
            // 无阻塞并发处理当前批次
            const batchResults = await this.processBatchNonBlocking(batch, accountProxyLists);
            results.push(...batchResults);

            // 批次间延迟
            if (i < batches.length - 1) {
                console.log(`⏳ 批次间延迟 2 秒...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        return results;
    }

    /**
     * 无阻塞批次处理
     * @param {Array} batch - 当前批次账户
     * @param {Array} accountProxyLists - 账户代理列表
     * @returns {Promise<Array>} 处理结果
     */
    async processBatchNonBlocking(batch, accountProxyLists) {
        const results = [];
        const runningTasks = new Map();
        
        // 启动所有账户的请求任务
        batch.forEach((account, index) => {
            const proxyList = accountProxyLists[index];
            
            // 根据模式处理账户
            if (this.mode === 'proxy') {
                console.log(`🎯 启动账户 ${account.name}（代理模式）`);
                const validProxies = proxyList.filter(p => p.server !== 'placeholder');
                if (validProxies.length === 0) {
                    console.log(`⚠️ 账户 ${account.name} 没有可用代理，跳过处理`);
                    results.push({
                        success: false,
                        account: account,
                        error: '没有可用的代理IP',
                        timestamp: new Date().toISOString()
                    });
                    return;
                }
            } else {
                console.log(`🎯 启动账户 ${account.name}（直连模式）`);
            }
            
            // 启动异步任务
            const task = this.acquireSubsidyWithRetry(account, proxyList)
                .then(result => {
                    runningTasks.delete(account.phone);
                    if (result.success) {
                        console.log(`✅ 账户 ${account.name} 处理成功`);
                    } else {
                        console.log(`❌ 账户 ${account.name} 处理失败: ${result.error}`);
                    }
                    return result;
                })
                .catch(error => {
                    runningTasks.delete(account.phone);
                    console.error(`💥 账户 ${account.name} 处理异常:`, error.message);
                    return {
                        success: false,
                        account: account,
                        error: error.message || '处理异常',
                        timestamp: new Date().toISOString()
                    };
                });
            
            runningTasks.set(account.phone, task);
        });

        // 等待所有任务完成
        if (runningTasks.size > 0) {
            console.log(`⏳ 等待 ${runningTasks.size} 个账户任务完成...`);
            const taskResults = await Promise.allSettled(Array.from(runningTasks.values()));
            
            taskResults.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    results.push(result.value);
                } else {
                    console.error(`💥 任务异常:`, result.reason);
                    // 从批次中找到对应的账户
                    const account = batch[index];
                    results.push({
                        success: false,
                        account: account,
                        error: result.reason?.message || '任务异常',
                        timestamp: new Date().toISOString()
                    });
                }
            });
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

        const acquirer = new XiaomiSubsidyAcquirer('direct', proxyType, this.options);
        const results = await acquirer.processBatch(filteredAccounts, proxyType);

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
    constructor(accounts, mode = 'direct', proxyType = 1, startTime = '10:00:00', region = 'cq', options = {}) {
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
        
        // 直连模式优化配置
        this.options = options;
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
            
            // 显示直连模式优化配置
            console.log(`📊 直连模式: 单次请求（无并发）`);
            if (this.options.enableConnectionPool !== undefined) {
                console.log(`🔌 连接池: ${this.options.enableConnectionPool ? '启用' : '禁用'}`);
                if (this.options.enableConnectionPool && this.options.connectionPoolSize) {
                    console.log(`📈 连接池大小: ${this.options.connectionPoolSize}`);
                }
            }
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
     * 开始循环抢购（无阻塞并发模式）
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
                console.log(`\n🔄 第 ${round}/${this.maxRetryCount} 轮抢购开始 (代理模式-无阻塞并发)`);
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
            
            // 无阻塞并发执行抢购
            await this.executeNonBlockingRound(remainingAccounts, round);
            
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
     * 执行无阻塞轮次抢购
     * @param {Array} remainingAccounts - 剩余账户列表
     * @param {number} round - 当前轮次
     */
    async executeNonBlockingRound(remainingAccounts, round) {
        const runningTasks = new Map();
        const roundResults = [];
        
        // 启动所有账户的抢购任务
        remainingAccounts.forEach((account) => {
            if (this.successfulAccounts.has(account.phone)) {
                return; // 已成功，跳过
            }
            
            // 根据模式处理
            const accountIndex = this.accounts.indexOf(account);
            const proxyList = this.accountProxyLists[accountIndex] || [];
            
            if (this.mode === 'proxy') {
                // 代理模式：检查是否有可用代理
                const validProxies = proxyList.filter(p => p.server !== 'placeholder');
                if (validProxies.length === 0) {
                    console.log(`⚠️ 账户 ${account.name} 没有可用代理，跳过处理`);
                    roundResults.push({
                        success: false,
                        account: account,
                        error: '没有可用的代理IP',
                        timestamp: new Date().toISOString()
                    });
                    return;
                }
                console.log(`🚀 账户 ${account.name}: 启动代理模式无阻塞并发请求...`);
            } else {
                // 直连模式
                console.log(`🚀 账户 ${account.name}: 启动直连模式请求...`);
            }
            
            // 启动异步任务
            const task = this.executeAccountTask(account, proxyList, round)
                .then(result => {
                    runningTasks.delete(account.phone);
                    return result;
                })
                .catch(error => {
                    runningTasks.delete(account.phone);
                    console.error(`💥 账户 ${account.name} 任务异常:`, error.message);
                    return {
                        success: false,
                        account: account,
                        error: error.message || '任务异常',
                        timestamp: new Date().toISOString()
                    };
                });
            
            runningTasks.set(account.phone, task);
        });

        // 等待所有任务完成
        if (runningTasks.size > 0) {
            console.log(`⏳ 第 ${round} 轮等待 ${runningTasks.size} 个账户任务完成...`);
            const taskResults = await Promise.allSettled(Array.from(runningTasks.values()));
            
            taskResults.forEach((result) => {
                if (result.status === 'fulfilled' && result.value) {
                    roundResults.push(result.value);
                } else {
                    console.error(`💥 轮次任务异常:`, result.reason);
                }
            });
        }

        // 处理轮次结果
        roundResults.forEach((result) => {
            if (result.success) {
                console.log(`✅ 账户 ${result.account.name} 抢补贴成功！`);
                this.successfulAccounts.add(result.account.phone);
            } else {
                console.log(`❌ 账户 ${result.account.name} 抢补贴失败: ${result.error}`);
                this.failedAccounts.add(result.account.phone);
            }
        });
    }

    /**
     * 执行单个账户任务
     * @param {Object} account - 账户信息
     * @param {Array} proxyList - 代理列表
     * @param {number} round - 轮次
     * @returns {Promise<Object>} 任务结果
     */
    async executeAccountTask(account, proxyList, round) {
        const acquirer = new XiaomiSubsidyAcquirer(this.mode, this.proxyType, this.options);
        return await acquirer.acquireSubsidyWithRetry(account, proxyList, true); // 跳过重试，由循环处理
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
        
        // 智能抢购完成，仅通过推送通知判断成功
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
export async function scheduleXiaomiExecution(accounts, mode = 'direct', proxyType = 1, startTime = '10:00:00', region = 'cq', options = {}) {
    const acquirer = new SmartXiaomiAcquirer(accounts, mode, proxyType, startTime, region, options);
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
    console.log('1. 直连模式 (direct) - 使用本机IP，支持连接池和并发优化');
    console.log('2. 代理模式 (proxy) - 使用代理IP，适合正式抢购');
    
    const choice = await askQuestion(rl, '\n请输入选择 (1-2): ');
    
    let mode = 'direct';
    let proxyType = 1;
    let options = {};
    
    switch (choice) {
        case '1':
        case '':
            mode = 'direct';
            
            // 直连模式配置选项
            console.log('\n🔗 直连模式配置:');
            console.log('📝 注意: 直连模式使用单次请求，通过连接池复用提升性能');
            
            // 连接池配置
            console.log('\n🔌 连接池配置:');
            console.log('1. 启用连接池 (推荐) - 提升速度，节省握手时间');
            console.log('2. 禁用连接池 - 传统连接方式');
            
            const poolChoice = await askQuestion(rl, '请选择连接池配置 (1-2): ');
            const enableConnectionPool = poolChoice !== '2';
            
            // 连接池大小配置（如果启用）
            let connectionPoolSize = 20;
            if (enableConnectionPool) {
                console.log('\n📈 连接池大小配置:');
                console.log('1. 20个连接 (默认)');
                console.log('2. 50个连接 (高并发)');
                console.log('3. 自定义大小');
                
                const poolSizeChoice = await askQuestion(rl, '请选择连接池大小 (1-3): ');
                switch (poolSizeChoice) {
                    case '1':
                    case '':
                        connectionPoolSize = 20;
                        break;
                    case '2':
                        connectionPoolSize = 50;
                        break;
                    case '3':
                        const customPoolSize = await askQuestion(rl, '请输入自定义连接池大小 (10-100): ');
                        const parsedPoolSize = parseInt(customPoolSize);
                        if (parsedPoolSize >= 10 && parsedPoolSize <= 100) {
                            connectionPoolSize = parsedPoolSize;
                        } else {
                            console.log('⚠️ 无效输入，使用默认值 20');
                            connectionPoolSize = 20;
                        }
                        break;
                    default:
                        console.log('⚠️ 无效选择，使用默认值 20');
                        connectionPoolSize = 20;
                }
            }
            
            options = {
                directConcurrency: 1, // 直连模式固定为单次请求
                enableConnectionPool,
                connectionPoolSize
            };
            
            console.log(`\n✅ 直连模式配置完成:`);
            console.log(`   📊 请求模式: 单次请求（无并发）`);
            console.log(`   🔌 连接池: ${enableConnectionPool ? '启用' : '禁用'}`);
            if (enableConnectionPool) {
                console.log(`   📈 连接池大小: ${connectionPoolSize}`);
            }
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
            options = {
                directConcurrency: 1,
                enableConnectionPool: true,
                connectionPoolSize: 20
            };
    }
    
    return { mode, proxyType, options };
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
        const { mode, proxyType, options } = await selectMode(rl);
        console.log(`✅ 已选择运行模式: ${mode === 'direct' ? '直连模式' : '代理模式'}`);
        if (mode === 'proxy') {
            console.log(`✅ 代理类型: ${proxyType}`);
        } else {
            console.log(`✅ 直连模式配置: 单次请求, 连接池=${options.enableConnectionPool ? '启用' : '禁用'}`);
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
            await scheduleXiaomiExecution(filteredAccounts, mode, proxyType, startTime, region, options);
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
  🌐 代理模式: 每个账户使用3个代理IP无阻塞并发请求，适合正式抢购
  ⚡ 无阻塞并发: 使用Promise.race实现真正的无阻塞，成功结果立即返回

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
