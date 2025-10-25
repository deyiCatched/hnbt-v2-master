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
    'yn': { name: '云南', regionId: '21' },
    'fj': { name: '福建', regionId: '23' }
};

/**
 * 根据regionId获取地区名称
 * @param {string} regionId - 地区ID
 * @returns {string} 地区名称
 */
function getRegionNameByRegionId(regionId) {
    for (const [key, value] of Object.entries(REGION_MAP)) {
        if (value.regionId === regionId.toString()) {
            return value.name;
        }
    }
    return `未知地区(${regionId})`;
}

/**
 * 在线用户信息获取配置
 */
const ONLINE_API_CONFIG = {
    baseURL: 'http://8.148.75.17:3000',
    endpoint: '/api/purchase/records',
    defaultLimit: 20
};

/**
 * 全局配置
 */
const config = {
    // 服务器状态更新配置
    statusUpdate: {
        enabled: true,  // 是否启用状态更新
        baseUrl: 'http://8.148.75.17:3000',
        purchaser: '唐德意'  // 抢购人，可配置修改
    }
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
            page,
            limit,
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
                    accountId: record.id, // 保留原始accountId用于状态更新
                    serviceToken: cookieData.serviceToken || '',
                    userId: cookieData.userId || '',
                    dId: 'OXBJOW5jM2cyZDd2bUh2TTJncDFHS0pCTFl3SUx1QUhEcXFMRytRN2x6aURaK3NSVXV2aHZmUGR6UWtoWDhIUg==', // 默认值
                    dModel: 'aVBob25lMTcsMQ==', // 默认值
                    sentryTrace: '1e52fc5869554d0b8f935be162226a76-dda486e670d9448d-1', // 默认值
                    baggage: 'sentry-environment=RELEASE,sentry-public_key=ee0a98b8e8e3417c89db4f9fd258ef62,sentry-release=com.xiaomi.mishop%405.2.257%2B2509112112,sentry-sample_rate=1,sentry-trace_id=1e52fc5869554d0b8f935be162226a76,sentry-transaction=MSNewMainViewController', // 默认值
                    cateCode: record.product_type || 'B01', // 使用API中的product_type
                    regionId: record.region_id ? record.region_id.toString() : '10', // 使用API中的region_id，默认重庆地区
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
                const regionName = getRegionNameByRegionId(account.regionId);
                console.log(`   ${index + 1}. ${account.name} (${account.phone}) - ${account.cateCode} [地区: ${regionName}]`);
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
 * 共享代理IP管理器
 */
class SharedProxyManager {
    constructor(proxyType = 1) {
        this.proxyType = proxyType;
        this.currentProxy = null;
        this.proxyExpiryTime = null;
        this.proxyValidationTimeout = 4000; // 4秒超时
        this.isRefreshing = false;
        this.proxyLifetime = 5 * 60 * 1000; // 5分钟过期时间
        
        // 重试配置
        this.maxRetryAttempts = 10; // 最大重试次数
        this.retryDelay = 1000; // 重试间隔1秒
        this.retryCount = 0; // 当前重试次数
    }

    /**
     * 获取当前有效的代理IP（带重试机制）
     * @returns {Promise<Object|null>} 代理信息
     */
    async getValidProxy() {
        // 如果当前代理有效且未过期，直接返回
        if (this.currentProxy && this.proxyExpiryTime && Date.now() < this.proxyExpiryTime) {
            return this.currentProxy;
        }

        // 如果正在刷新，等待刷新完成，然后检查结果
        if (this.isRefreshing) {
            await this.waitForRefresh();
            // 等待完成后，如果仍然没有有效代理，再次尝试刷新
            if (!this.currentProxy || !this.proxyExpiryTime || Date.now() >= this.proxyExpiryTime) {
                console.log('🔄 等待刷新完成但仍无有效代理，重新尝试刷新...');
                return await this.refreshProxy();
            }
            return this.currentProxy;
        }

        // 开始刷新代理
        return await this.refreshProxy();
    }

    /**
     * 刷新代理IP（带重试机制）
     * @returns {Promise<Object|null>} 新的代理信息
     */
    async refreshProxy() {
        this.isRefreshing = true;
        this.retryCount = 0;
        
        try {
            while (this.retryCount < this.maxRetryAttempts) {
                try {
                    this.retryCount++;
                    console.log(`🔄 正在获取新的共享代理IP... (尝试 ${this.retryCount}/${this.maxRetryAttempts})`);
                    
                    // 获取一个新的代理IP
                    const proxyList = await getProxyFromSource(this.proxyType, 1);
                    if (!proxyList || proxyList.length === 0) {
                        console.log(`❌ 无法获取代理IP，重试 ${this.retryCount}/${this.maxRetryAttempts}`);
                        if (this.retryCount < this.maxRetryAttempts) {
                            await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                            continue;
                        }
                        console.error('💥 达到最大重试次数，无法获取代理IP');
                        return null;
                    }

                    const proxy = proxyList[0];
                    
                    // 快速验证代理IP（4秒超时）
                    const testResult = await this.quickValidateProxy(proxy);
                    
                    if (testResult.success) {
                        // 验证成功，重置重试计数并返回
                        this.retryCount = 0;
                        this.currentProxy = {
                            ...proxy,
                            validatedIP: testResult.ip,
                            validatedAt: Date.now()
                        };
                        this.proxyExpiryTime = Date.now() + this.proxyLifetime;
                        
                        console.log(`✅ 共享代理IP更新成功: ${proxy.server}:${proxy.port} (${testResult.ip}) 验证耗时: ${testResult.duration}ms`);
                        return this.currentProxy;
                    } else {
                        console.log(`❌ 代理IP验证失败: ${testResult.error}，重试 ${this.retryCount}/${this.maxRetryAttempts}`);
                        if (this.retryCount < this.maxRetryAttempts) {
                            await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                            continue;
                        }
                        console.error('💥 达到最大重试次数，无法获取有效的代理IP');
                        return null;
                    }
                } catch (error) {
                    console.error(`💥 刷新代理IP失败: ${error.message}，重试 ${this.retryCount}/${this.maxRetryAttempts}`);
                    
                    if (this.retryCount < this.maxRetryAttempts) {
                        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                        continue;
                    }
                    
                    console.error('💥 达到最大重试次数，代理IP获取完全失败');
                    return null;
                }
            }
            
            // 如果走到这里，说明达到最大重试次数但没有成功
            console.error('💥 代理IP获取失败：达到最大重试次数');
            return null;
        } finally {
            this.isRefreshing = false;
        }
    }

    /**
     * 快速验证代理IP（4秒超时）
     * @param {Object} proxyInfo - 代理信息
     * @returns {Promise<Object>} 验证结果
     */
    async quickValidateProxy(proxyInfo) {
        try {
            const startTime = Date.now();
            
            // 使用快速验证，4秒超时
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('代理验证超时')), this.proxyValidationTimeout);
            });

            const validatePromise = testProxyIP(proxyInfo);
            
            const result = await Promise.race([validatePromise, timeoutPromise]);
            const duration = Date.now() - startTime;
            
            if (result.success && duration < this.proxyValidationTimeout) {
                return {
                    success: true,
                    ip: result.ip,
                    duration: duration
                };
            } else {
                return {
                    success: false,
                    error: duration >= this.proxyValidationTimeout ? '验证超时' : result.error
                };
            }
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 等待刷新完成
     * @returns {Promise<void>}
     */
    async waitForRefresh() {
        const maxWaitTime = 10000; // 最多等待10秒
        const checkInterval = 100; // 每100ms检查一次
        let waited = 0;

        while (this.isRefreshing && waited < maxWaitTime) {
            await new Promise(resolve => setTimeout(resolve, checkInterval));
            waited += checkInterval;
        }
    }

    /**
     * 检查代理是否即将过期（提前1分钟刷新）
     */
    shouldRefreshProxy() {
        if (!this.proxyExpiryTime) return true;
        const refreshThreshold = this.proxyLifetime - 60 * 1000; // 提前1分钟
        return (this.proxyExpiryTime - Date.now()) < refreshThreshold;
    }

    /**
     * 获取代理状态信息
     */
    getStatus() {
        return {
            hasProxy: !!this.currentProxy,
            isValid: this.currentProxy && this.proxyExpiryTime && Date.now() < this.proxyExpiryTime,
            expiryTime: this.proxyExpiryTime,
            remainingTime: this.proxyExpiryTime ? Math.max(0, this.proxyExpiryTime - Date.now()) : 0,
            isRefreshing: this.isRefreshing,
            retryCount: this.retryCount,
            maxRetryAttempts: this.maxRetryAttempts,
            currentProxy: this.currentProxy ? {
                server: this.currentProxy.server,
                port: this.currentProxy.port,
                validatedIP: this.currentProxy.validatedIP
            } : null
        };
    }
}

/**
 * 服务器状态更新服务
 */
class StatusUpdateService {
    constructor(options = {}) {
        this.config = { ...config.statusUpdate, ...options };
    }

    /**
     * 更新账户抢购状态
     * @param {string|number} accountId - 账户ID
     * @param {string} purchaser - 抢购人（可选，默认使用配置中的值）
     * @returns {Promise<Object>} 更新结果
     */
    async updatePurchaseStatus(accountId, purchaser = null) {
        if (!this.config.enabled) {
            console.log('🔄 状态更新已禁用，跳过更新');
            return { success: true, message: '状态更新已禁用' };
        }

        try {
            const url = `${this.config.baseUrl}/api/purchase/records/${accountId}/purchase-status`;
            const purchaserName = purchaser || this.config.purchaser;
            
            console.log(`🔄 正在更新账户${accountId}的抢购状态...`);
            
            // 按照API文档格式构建请求体
            const requestBody = {
                purchaser: purchaserName
                // 不传purchase_time，让服务器使用当前时间
            };
            
            const response = await axios.put(url, requestBody, {
                timeout: 10000,
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.status === 200) {
                console.log(`✅ 账户${accountId}状态更新成功`);
                return {
                    success: true,
                    message: '状态更新成功',
                    data: response.data,
                    accountId: accountId,
                    purchaser: purchaserName
                };
            } else {
                console.log(`❌ 账户${accountId}状态更新失败: HTTP ${response.status}`);
                return {
                    success: false,
                    message: `状态更新失败: HTTP ${response.status}`,
                    accountId: accountId,
                    status: response.status
                };
            }
        } catch (error) {
            console.error(`❌ 账户${accountId}状态更新异常:`, error.message);
            return {
                success: false,
                message: error.message,
                error: error,
                accountId: accountId
            };
        }
    }
}

/**
 * 小米商城补贴获取器
 */
class XiaomiSubsidyAcquirer {
    constructor(mode = 'direct', proxyType = 1, options = {}) {
        // 原接口配置
        this.baseURL = 'https://shop-api.retail.mi.com';
        this.endpoint = '/mtop/navi/saury/subsidy/fetch';
        
        // 新接口配置 - 双接口抢购
        this.newBaseURL = 'https://xiaomishop.retail.mi.com';
        this.newEndpoint = '/mtop/xiaomishop/product/govSubsidy/fetch';
        this.dualApiEnabled = true; // 启用双接口抢购
        this.dualApiDelay = 100; // 新接口延迟100ms调用
        
        this.maxRetries = 3;
        this.retryDelay = 100; // 所有模式统一使用100ms重试间隔
        this.batchSize = 10; // 批量处理大小
        this.results = [];
        
        // 模式配置
        this.mode = mode; // 'direct' 或 'proxy'
        this.proxyType = proxyType; // 代理类型
        
        // 直连模式配置 - 取消连接池，每个账户独立执行
        this.directConcurrency = 1; // 直连模式固定为单次请求
        this.enableConnectionPool = false; // 禁用连接池
        this.accountInterval = 100; // 每个账户抢购间隔100ms
        
        // 初始化状态更新服务
        this.statusUpdateService = new StatusUpdateService();
        
        // 初始化共享代理管理器（仅在代理模式下使用）
        this.sharedProxyManager = mode === 'proxy' ? new SharedProxyManager(proxyType) : null;
        
        // 模式配置日志已移除，重点关注业务结果
    }

    /**
     * 初始化HTTP连接池 - 已禁用连接池模式
     */
    initializeConnectionPools() {
        // 连接池模式已禁用，所有请求使用独立连接
    }

    /**
     * 获取连接池状态信息 - 连接池已禁用
     * @returns {Object} 连接池状态
     */
    getConnectionPoolStatus() {
        return { 
            enabled: false, 
            message: '连接池模式已禁用，每个账户使用独立连接' 
        };
    }

    /**
     * 创建原接口请求配置
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
                    "activityCategory": activityCategory || "100"
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
        }

        return config;
    }

    /**
     * 创建新接口请求配置（双接口抢购）
     * @param {Object} accountInfo - 账户信息
     * @param {Object} proxyInfo - 代理信息
     * @returns {Object} axios配置
     */
    createNewRequestConfig(accountInfo, proxyInfo) {
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
        
        const config = {
            method: 'POST',
            url: `${this.newBaseURL}${this.newEndpoint}`,
            headers: {
                'Host': 'xiaomishop.retail.mi.com',
                'dtoken': '',
                'Referer': 'https://xiaomishop.retail.mi.com',
                'x-mishop-app-source': 'front-RN',
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
                'd-id': dId || 'OXBJOW5jM2cyZDd2bUh2TTJncDFHS0pCTFl3SUx1QUhEcXFMRytRN2x6aURaK3NSVXV2aHZmUGR6UWtoWDhIUg==',
                'x-user-agent': 'channel/mishop platform/mishop.ios',
                'Cookie': `serviceToken=${serviceToken}; userId=${userId}`,
                'ai-recommend-status': '0',
                'mishop-model': 'iPhone17,1',
                'magic-device-id': '20251007170531339f86302c8846f111e7c3819ff39cd9008ee21bc4797a9b',
                'locale': 'CN',
                'baggage': baggage || 'sentry-environment=RELEASE,sentry-public_key=ee0a98b8e8e3417c89db4f9fd258ef62,sentry-release=com.xiaomi.mishop%405.2.257%2B2509112112,sentry-sample_rate=1,sentry-trace_id=1c1a0cfc529c49d1bddbd35f5fb25a6a,sentry-transaction=MSNewMainViewController',
                'mishop-client-id': '180100031055',
                'device-id': 'E6259B95C513B07CC07227E4828E4A71',
                'network-carrier': '6553565535',
                'ios-version': 'system=18.6.2&device=iPhone17,1',
                'ios-app-version': '5.2.257',
                'Connection': 'keep-alive',
                'mishop-channel-id': '',
                'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
                'device-oaid': '9pI9nc3g2d7vmHvM2gp1GKJBLYwILuAHDqqLG+Q7lziDZ+sRUuvhvfPdzQkhX8HR',
                'Accept': '*/*',
                'Content-Type': 'application/json',
                'mishop-client-versioncode': '5.2.257',
                'sentry-trace': sentryTrace || '1c1a0cfc529c49d1bddbd35f5fb25a6a-accc6dfdf19e4fba-1',
                'd-model': dModel || 'aVBob25lMTcsMQ==',
                'Accept-Encoding': 'gzip, deflate, br'
            },
            data: [
                {},
                {
                    "regionId": parseInt(regionId) || 10,
                    "activityCategory": parseInt(activityCategory) || 100,
                    "cateCode": cateCode || "B01"
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
        }

        return config;
    }

    /**
     * 执行补贴获取请求（支持直连模式和代理模式）
     * @param {Object} accountInfo - 账户信息
     * @param {Array} proxyList - 代理IP列表（已弃用，保留兼容性）
     * @returns {Promise<Object>} 请求结果
     */
    async acquireSubsidy(accountInfo, proxyList = null) {
        const startTime = Date.now();
        
        try {
            if (this.mode === 'proxy') {
                // 代理模式：使用共享代理IP（新的共享模式）
                if (!this.sharedProxyManager) {
                    throw new Error('代理模式下共享代理管理器未初始化');
                }

                // 获取当前有效的共享代理IP（带重试机制）
                const sharedProxy = await this.sharedProxyManager.getValidProxy();
                if (!sharedProxy) {
                    // 如果仍然获取不到有效代理，记录错误信息并抛出异常
                    const status = this.sharedProxyManager.getStatus();
                    throw new Error(`无法获取有效的共享代理IP - 重试次数: ${status.retryCount}/${status.maxRetryAttempts}`);
                }

                // 使用共享代理执行单次请求
                return await this.executeSingleRequest(accountInfo, sharedProxy, 1);

            } else {
                // 直连模式：单次请求，每个账户独立执行
                // 直接执行单次请求
                return await this.executeSingleRequest(accountInfo, null, 1);
            }

        } catch (error) {
            const duration = Date.now() - startTime;

            const result = {
                success: false,
                account: accountInfo,
                proxy: this.mode === 'proxy' && this.sharedProxyManager ? this.sharedProxyManager.currentProxy : null,
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
        
        // 创建所有并发请求
        for (let i = 0; i < maxConcurrent; i++) {
                    const proxy = proxyList[i];
            const promise = this.executeSingleRequest(accountInfo, proxy, i + 1)
                .then(result => {
                    completedCount++;
                    if (result.success && !firstSuccess) {
                        firstSuccess = result;
                    } else if (!result.success) {
                        errorMessages.push(`代理${i + 1}: ${result.error || '请求失败'}`);
                    }
                    return result;
                })
                .catch(error => {
                    completedCount++;
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
     * 执行单次请求（双接口同时抢购）
     * @param {Object} accountInfo - 账户信息
     * @param {Object} proxyInfo - 代理信息
     * @param {number} requestIndex - 请求序号
     * @returns {Promise<Object>} 请求结果
     */
    async executeSingleRequest(accountInfo, proxyInfo, requestIndex) {
        const startTime = Date.now();
        const currentTime = new Date().toLocaleTimeString();
        
        try {
            // 执行原接口请求
            const originalConfig = this.createRequestConfig(accountInfo, proxyInfo);
            const originalResponse = await axios(originalConfig);
            
            // 检查原接口结果并立即输出日志
            const originalSuccess = this.isRushSuccessful(originalResponse.data);
            if (originalSuccess) {
                console.log(`${currentTime} 🎉 ${accountInfo.name}(${accountInfo.phone}) 原接口抢券成功！`);
                await this.handleSuccess(accountInfo, originalResponse.data);
                return {
                    success: true,
                    account: accountInfo,
                    proxy: proxyInfo,
                    response: originalResponse.data,
                    requestIndex: requestIndex,
                    duration: Date.now() - startTime,
                    timestamp: new Date().toISOString(),
                    connectionPoolUsed: false,
                    apiUsed: 'original',
                    message: '原接口抢券成功',
                    originalResult: originalResponse.data
                };
            } else {
                const originalError = this.getOriginalApiError(originalResponse.data);
                console.log(`${currentTime} ⚠️  ${accountInfo.name}-${accountInfo.phone}: 原接口失败 - ${originalError}`);
            }
            
            // 无论原接口是否成功，都要在100ms后调用新接口
            if (this.dualApiEnabled) {
                // 等待100ms
                await new Promise(resolve => setTimeout(resolve, this.dualApiDelay));
                
                try {
                    // 执行新接口请求
                    const newConfig = this.createNewRequestConfig(accountInfo, proxyInfo);
                    const newResponse = await axios(newConfig);
                    
                    // 检查新接口结果并立即输出日志
                    const newSuccess = this.isNewApiSuccessful(newResponse.data);
                    if (newSuccess) {
                        console.log(`${currentTime} 🎉 ${accountInfo.name}(${accountInfo.phone}) 新接口抢券成功！`);
                        await this.handleSuccess(accountInfo, newResponse.data);
                        return {
                            success: true,
                            account: accountInfo,
                            proxy: proxyInfo,
                            response: newResponse.data,
                            requestIndex: requestIndex,
                            duration: Date.now() - startTime,
                            timestamp: new Date().toISOString(),
                            connectionPoolUsed: false,
                            apiUsed: 'new',
                            message: '新接口抢券成功',
                            originalResult: originalResponse.data,
                            newResult: newResponse.data
                        };
                    } else {
                        const newTips = newResponse.data && newResponse.data.data && newResponse.data.data.tips;
                        const newError = newTips || (newResponse.data.data && newResponse.data.data.message) || newResponse.data.message || '新接口抢券失败';
                        console.log(`${currentTime} ⚠️  ${accountInfo.name}: 新接口失败 - ${newError}`);
                    }
                    
                    // 两个接口都失败
                    const originalError = this.getOriginalApiError(originalResponse.data);
                    const newTips = newResponse.data && newResponse.data.data && newResponse.data.data.tips;
                    const newError = newTips || (newResponse.data.data && newResponse.data.data.message) || newResponse.data.message || '新接口抢券失败';
                    
                    return {
                        success: false,
                        account: accountInfo,
                        proxy: proxyInfo,
                        requestIndex: requestIndex,
                        duration: Date.now() - startTime,
                        timestamp: new Date().toISOString(),
                        connectionPoolUsed: false,
                        apiUsed: 'both',
                        error: `双接口都失败 - 原接口: ${originalError}, 新接口: ${newError}`,
                        originalResult: originalResponse.data,
                        newResult: newResponse.data
                    };
                    
                } catch (newError) {
                    // 新接口请求异常
                    console.log(`${currentTime} ❌ ${accountInfo.name}: 新接口异常 - ${newError.message}`);
                    
                    if (originalSuccess) {
                        // 原接口成功，新接口异常
                        return {
                            success: true,
                            account: accountInfo,
                            proxy: proxyInfo,
                            response: originalResponse.data,
                            requestIndex: requestIndex,
                            duration: Date.now() - startTime,
                            timestamp: new Date().toISOString(),
                            connectionPoolUsed: false,
                            apiUsed: 'original',
                            message: '原接口抢券成功，新接口异常',
                            originalResult: originalResponse.data,
                            newError: newError.message
                        };
                    } else {
                        // 原接口失败，新接口异常
                        const originalError = this.getOriginalApiError(originalResponse.data);
                        return {
                            success: false,
                            account: accountInfo,
                            proxy: proxyInfo,
                            requestIndex: requestIndex,
                            duration: Date.now() - startTime,
                            timestamp: new Date().toISOString(),
                            connectionPoolUsed: false,
                            apiUsed: 'both',
                            error: `双接口都失败 - 原接口: ${originalError}, 新接口异常: ${newError.message}`,
                            originalResult: originalResponse.data,
                            newError: newError.message
                        };
                    }
                }
            } else {
                // 双接口模式未启用，只使用原接口
                if (originalSuccess) {
                    return {
                        success: true,
                        account: accountInfo,
                        proxy: proxyInfo,
                        response: originalResponse.data,
                        requestIndex: requestIndex,
                        duration: Date.now() - startTime,
                        timestamp: new Date().toISOString(),
                        connectionPoolUsed: false,
                        apiUsed: 'original',
                        message: '原接口抢券成功'
                    };
                } else {
                    const tips = originalResponse.data && originalResponse.data.data && originalResponse.data.data.tips;
                    const tipsMessage = tips || (originalResponse.data.data && originalResponse.data.data.message) || originalResponse.data.message || '抢券失败';
                    
                    return {
                        success: false,
                        account: accountInfo,
                        proxy: proxyInfo,
                        requestIndex: requestIndex,
                        duration: Date.now() - startTime,
                        timestamp: new Date().toISOString(),
                        connectionPoolUsed: false,
                        apiUsed: 'original',
                        error: tipsMessage
                    };
                }
            }

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
                connectionPoolUsed: false,
                apiUsed: 'original'
            };

            // 使用简洁的日志格式输出错误
            console.log(`${currentTime} ❌ ${accountInfo.name}: 原接口请求失败 - ${error.message}`);

            return result;
        }
    }

    /**
     * 判断是否抢购成功（原接口）
     * @param {Object} responseData - API响应数据
     * @returns {boolean} 是否成功
     */
    isRushSuccessful(responseData) {
        if (!responseData) return false;
        
        // 根据小米API的实际响应格式：只有当code=0 && tips为空字符串才表示成功
        const isCodeSuccess = responseData.code === 0 || responseData.code === '0';
        const isTipsEmpty = responseData.data && 
                           (responseData.data.tips === '' || 
                            responseData.data.tips === null || 
                            responseData.data.tips === undefined);
        
        return isCodeSuccess && isTipsEmpty;
    }

    /**
     * 判断新接口是否抢购成功
     * @param {Object} responseData - 新接口API响应数据
     * @returns {boolean} 是否成功
     */
    isNewApiSuccessful(responseData) {
        if (!responseData) return false;
        
        // 新接口成功判断：只有当code=0 && tips为空字符串才表示成功
        const isCodeSuccess = responseData.code === 0 || responseData.code === '0';
        const isTipsEmpty = responseData.data && 
                           (responseData.data.tips === '' || 
                            responseData.data.tips === null || 
                            responseData.data.tips === undefined);
        
        return isCodeSuccess && isTipsEmpty;
    }

    /**
     * 获取原接口错误信息
     * @param {Object} responseData - 原接口响应数据
     * @returns {string} 错误信息
     */
    getOriginalApiError(responseData) {
        if (!responseData) return '无响应数据';
        
        const tips = responseData.data && responseData.data.tips;
        const message = responseData.data && responseData.data.message;
        const errorMessage = responseData.message;
        
        return tips || message || errorMessage || '未知错误';
    }

    /**
     * 处理抢购成功后的操作
     * @param {Object} accountInfo - 账户信息
     * @param {Object} responseData - API响应数据
     */
    async handleSuccess(accountInfo, responseData) {
        // 发送抢券成功推送通知 - 确认成功，包含完整响应体
        await this.sendSuccessNotification(accountInfo, 'confirmed', responseData);
        
        // 更新服务器状态 - 如果有accountId则推送状态更新
        if (accountInfo.accountId) {
            this.statusUpdateService.updatePurchaseStatus(accountInfo.accountId).catch(error => {
                console.error(`❌ 状态更新失败:`, error.message);
            });
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
            const result = await this.acquireSubsidy(accountInfo, proxyList);
            lastResult = result;

            // 如果成功，直接返回
            if (result.success) {
                return result;
            }

            // 如果是网络错误且还有重试机会，等待后重试
            if (result.isNetworkError && attempt < this.maxRetries) {
                // 等待一段时间后重试
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
        // 批量处理开始，重点关注tips字段输出
        
        const results = [];
        const batches = this.chunkArray(accounts, this.batchSize);

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            // 批次处理日志已移除，重点关注tips字段

            // 根据模式准备代理IP或创建空列表
            let accountProxyLists = [];
            
            if (this.mode === 'proxy') {
                // 代理模式：使用共享代理管理器（不再为每个账户分配单独的代理）
                if (!this.sharedProxyManager) {
                    // 如果没有共享代理管理器，创建一个
                    this.sharedProxyManager = new SharedProxyManager(this.proxyType);
                    await this.sharedProxyManager.refreshProxy();
                }
                
                // 创建空的代理列表，因为现在使用共享代理
                accountProxyLists = batch.map(() => []); // 空列表，acquirer内部会使用sharedProxyManager
            } else {
                // 直连模式：创建空的代理列表
                accountProxyLists = batch.map(() => []); // 创建空的代理列表
            }
            
            // 无阻塞并发处理当前批次
            const batchResults = await this.processBatchNonBlocking(batch, accountProxyLists);
            results.push(...batchResults);

            // 批次间延迟（仅代理模式）
            if (i < batches.length - 1 && this.mode === 'proxy') {
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
        
        // 所有模式都使用并发处理，但直连模式的账户间隔在重试机制中控制
        if (this.mode === 'direct') {
            // 直连模式：并发执行账户，账户内重试间隔100ms
            const runningTasks = new Map();
            
            // 启动所有账户的请求任务
            batch.forEach((account, index) => {
                const proxyList = accountProxyLists[index];
                
                // 启动异步任务
                const task = this.acquireSubsidyWithRetry(account, proxyList)
                    .then(result => {
                        runningTasks.delete(account.phone);
                        return result;
                    })
                    .catch(error => {
                        runningTasks.delete(account.phone);
                        const errorResult = {
                            success: false,
                            account: account,
                            error: error.message || '处理异常',
                            timestamp: new Date().toISOString()
                        };
                        console.log(`❌ ${account.name}: 网络异常 - ${error.message || '处理异常'}`);
                        return errorResult;
                    });
                
                runningTasks.set(account.phone, task);
            });

            // 等待所有任务完成
            if (runningTasks.size > 0) {
                const taskResults = await Promise.allSettled(Array.from(runningTasks.values()));
                
                taskResults.forEach((result) => {
                if (result.status === 'fulfilled') {
                    results.push(result.value);
                    } else {
                        console.error(`💥 任务异常:`, result.reason);
                    }
                });
            }
            
                } else {
            // 代理模式：使用共享代理管理器
            const runningTasks = new Map();
            
            // 检查共享代理管理器是否可用
            if (!this.sharedProxyManager) {
                console.log(`❌ 代理模式：共享代理管理器未初始化`);
                batch.forEach(account => {
                    results.push({
                        success: false,
                        account: account,
                        error: '共享代理管理器未初始化',
                        timestamp: new Date().toISOString()
                    });
                });
                return results;
            }
            
            // 启动所有账户的请求任务
            batch.forEach((account, index) => {
                // 为每个账户创建独立的acquirer，并传递共享代理管理器
                const acquirer = new XiaomiSubsidyAcquirer(this.mode, this.proxyType, this.options);
                acquirer.sharedProxyManager = this.sharedProxyManager;
                
                // 启动异步任务
                const task = acquirer.acquireSubsidyWithRetry(account, [])
                    .then(result => {
                        runningTasks.delete(account.phone);
                        return result;
                    })
                    .catch(error => {
                        runningTasks.delete(account.phone);
                        const errorResult = {
                            success: false,
                            account: account,
                            error: error.message || '处理异常',
                            timestamp: new Date().toISOString()
                        };
                        console.log(`❌ ${account.name}: 网络异常 - ${error.message || '处理异常'}`);
                        return errorResult;
                    });
                
                runningTasks.set(account.phone, task);
            });

            // 等待所有任务完成
            if (runningTasks.size > 0) {
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

        // 统计双接口使用情况
        const originalApiSuccess = results.filter(r => r.success && r.apiUsed === 'original').length;
        const newApiSuccess = results.filter(r => r.success && r.apiUsed === 'new').length;
        const bothApiFailed = results.filter(r => !r.success && r.apiUsed === 'both').length;

        console.log('\n📊 执行统计:');
        console.log(`   总请求数: ${total}`);
        console.log(`   成功数: ${success}`);
        console.log(`   失败数: ${failed}`);
        console.log(`   成功率: ${successRate}%`);

        if (this.dualApiEnabled) {
            console.log('\n🔄 双接口抢购统计:');
            console.log(`   原接口成功: ${originalApiSuccess}`);
            console.log(`   新接口成功: ${newApiSuccess}`);
            console.log(`   双接口都失败: ${bothApiFailed}`);
        }

        if (success > 0) {
            console.log('\n🎉 成功账户:');
            results.filter(r => r.success).forEach(result => {
                const apiInfo = result.apiUsed === 'original' ? '(原接口)' : result.apiUsed === 'new' ? '(新接口)' : '';
                console.log(`   ✅ ${result.account.name} (${result.account.phone}) ${apiInfo}`);
            });
        }

        if (failed > 0) {
            console.log('\n😞 失败账户:');
            results.filter(r => !r.success).forEach(result => {
                const apiInfo = result.apiUsed === 'original' ? '(原接口)' : result.apiUsed === 'new' ? '(新接口)' : result.apiUsed === 'both' ? '(双接口)' : '';
                console.log(`   ❌ ${result.account.name} (${result.account.phone}) ${apiInfo}: ${result.error}`);
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
    
    // 显示当前所有账户的地区分布
    const regionStats = {};
    accounts.forEach(account => {
        const regionName = getRegionNameByRegionId(account.regionId);
        regionStats[regionName] = (regionStats[regionName] || 0) + 1;
    });
    
    console.log(`📊 账户地区分布统计:`);
    Object.entries(regionStats).forEach(([regionName, count]) => {
        console.log(`   ${regionName}: ${count} 个账户`);
    });
    
    const filteredAccounts = accounts.filter(account => account.regionId === regionInfo.regionId);
    console.log(`🔍 地区筛选结果: ${regionInfo.name} (${region}) - 找到 ${filteredAccounts.length}/${accounts.length} 个匹配账户`);
    
    if (filteredAccounts.length === 0) {
        console.log(`⚠️ 没有找到 ${regionInfo.name} 地区的账户，请检查账户配置`);
        console.log(`💡 提示: 当前账户的地区分布为: ${Object.keys(regionStats).join(', ')}`);
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
        this.accountInterval = 100; // 直连模式每个账户间隔100ms
        
        // 直连模式优化配置
        this.options = options;
        
        // 初始化状态更新服务
        this.statusUpdateService = new StatusUpdateService();
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
        
        // 配置信息已简化，重点关注tips字段输出
        
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
                console.log(`❌ 代理模式准备失败: 无法获取有效的共享代理IP`);
                throw new Error('无法获取有效的共享代理IP');
            }
        } else {
            console.log('🔧 直连模式：准备直接请求...');
            
            // 直连模式：不需要准备代理IP
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
     * 开始异步多账户抢购
     */
    async startSubsidyLoop() {
        this.isRunning = true;
        console.log(`🚀 启动异步多账户抢购: ${this.accounts.length} 个账户`);
        console.log(`📊 模式: ${this.mode === 'direct' ? '直连模式' : '代理模式'}`);
        console.log(`⏱️ 单个账户重试间隔: 100ms`);
        
        // 为每个账户启动独立的异步抢购任务
        const accountTasks = this.accounts.map(account => {
            return this.startAccountAsyncLoop(account);
        });
        
        // 等待所有账户任务完成
        await Promise.allSettled(accountTasks);
        
        // 检查是否所有账户都已完成或成功
        const allSuccessful = this.successfulAccounts.size >= this.accounts.length;
        
        if (allSuccessful) {
                console.log('🎉 所有账户都已成功抢到补贴！');
        } else if (!this.isRunning) {
            console.log('🛑 用户手动停止了抢购');
        }
        
        this.showFinalResults();
        this.isRunning = false;
    }

    /**
     * 启动单个账户的异步循环抢购
     * @param {Object} account - 账户信息
     * @returns {Promise<void>}
     */
    async startAccountAsyncLoop(account) {
        // 检查代理模式是否有共享代理管理器
        if (this.mode === 'proxy') {
            if (!this.sharedProxyManager) {
                console.log(`❌ ${account.name}: 共享代理管理器未初始化，跳过账户`);
                return;
            }
            
            // 检查代理是否有效
            const proxyStatus = this.sharedProxyManager.getStatus();
            if (!proxyStatus.hasProxy || !proxyStatus.isValid) {
                console.log(`❌ ${account.name}: 没有有效的共享代理IP，跳过账户`);
                return;
            }
        }
        
        // 为每个账户创建独立的XiaomiSubsidyAcquirer实例，并传递共享代理管理器
        const acquirer = new XiaomiSubsidyAcquirer(this.mode, this.proxyType, this.options);
        
        // 如果是代理模式，将共享代理管理器传递给acquirer
        if (this.mode === 'proxy' && this.sharedProxyManager) {
            acquirer.sharedProxyManager = this.sharedProxyManager;
        }
        
        let attemptCount = 0;
        
        // 单个账户的异步循环抢购，100ms间隔重试
        while (this.isRunning && !this.successfulAccounts.has(account.phone)) {
            attemptCount++;
            
            try {
                const result = await acquirer.acquireSubsidy(account);
                
                if (result.success) {
                    this.successfulAccounts.add(account.phone);
                    console.log(`🎉 ${account.name}(${account.phone}) 抢购成功！ (尝试${attemptCount}次)`);
                    return; // 成功后退出循环
                }
                
                // 失败后等待100ms再重试
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error) {
                console.log(`❌ ${account.name}: 抢购异常 - ${error.message}`);
                // 异常后也等待100ms再重试
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
    }

    /**
     * 执行无阻塞轮次抢购（已弃用，保留用于兼容性）
     * @param {Array} remainingAccounts - 剩余账户列表
     * @param {number} round - 当前轮次
     */
    async executeNonBlockingRound(remainingAccounts, round) {
        const roundResults = [];
        
        // 所有模式都使用并发处理，账户间隔在重试机制中控制
        const runningTasks = new Map();
        
        // 启动所有账户的抢购任务
        remainingAccounts.forEach((account) => {
                if (this.successfulAccounts.has(account.phone)) {
                return; // 已成功，跳过
                }
                
                // 根据模式处理
                if (this.mode === 'proxy') {
                    // 代理模式：检查共享代理管理器是否可用
                    if (!this.sharedProxyManager) {
                        console.log(`❌ ${account.name}: 共享代理管理器未初始化`);
                        roundResults.push({
                            success: false,
                            account: account,
                            error: '共享代理管理器未初始化',
                            timestamp: new Date().toISOString()
                        });
                        return;
                    }
                    
                    const proxyStatus = this.sharedProxyManager.getStatus();
                    if (!proxyStatus.hasProxy || !proxyStatus.isValid) {
                        console.log(`❌ ${account.name}: 没有有效的共享代理IP`);
                        roundResults.push({
                            success: false,
                            account: account,
                            error: '没有有效的共享代理IP',
                            timestamp: new Date().toISOString()
                        });
                        return;
                    }
                }
            
            // 启动异步任务
            const task = this.executeAccountTask(account, [], round)
                .then(result => {
                    runningTasks.delete(account.phone);
                    if (result.success) {
                        this.successfulAccounts.add(result.account.phone);
                } else {
                        this.failedAccounts.add(result.account.phone);
                    }
                    return result;
                })
                .catch(error => {
                    runningTasks.delete(account.phone);
                    const errorResult = {
                        success: false,
                        account: account,
                        error: error.message || '任务异常',
                        timestamp: new Date().toISOString()
                    };
                    console.log(`❌ ${account.name}: 任务异常 - ${error.message || '处理异常'}`);
                    roundResults.push(errorResult);
                    this.failedAccounts.add(account.phone);
                    return errorResult;
                });
            
            runningTasks.set(account.phone, task);
        });

        // 等待所有任务完成
        if (runningTasks.size > 0) {
            const taskResults = await Promise.allSettled(Array.from(runningTasks.values()));
            
            taskResults.forEach((result) => {
                if (result.status === 'fulfilled' && result.value) {
                    roundResults.push(result.value);
                    } else {
                    console.error(`💥 轮次任务异常:`, result.reason);
                }
            });
        }
    }

    /**
     * 执行单个账户任务
     * @param {Object} account - 账户信息
     * @param {Array} proxyList - 代理列表（已弃用，保留兼容性）
     * @param {number} round - 轮次
     * @returns {Promise<Object>} 任务结果
     */
    async executeAccountTask(account, proxyList, round) {
        const acquirer = new XiaomiSubsidyAcquirer(this.mode, this.proxyType, this.options);
        
        // 如果是代理模式，传递共享代理管理器
        if (this.mode === 'proxy' && this.sharedProxyManager) {
            acquirer.sharedProxyManager = this.sharedProxyManager;
        }
        
        return await acquirer.acquireSubsidyWithRetry(account, [], true); // 跳过重试，由循环处理
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
    console.log('系统将根据选择的地区，自动筛选出对应region_id的用户进行抢购');
    console.log('1. 重庆 (cq) - regionId: 10');
    console.log('2. 云南 (yn) - regionId: 21');
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
    console.log('1. 直连模式 (direct) - 使用本机IP，支持并发优化');
    console.log('2. 代理模式 (proxy) - 共享代理IP，4秒验证，5分钟自动切换');
    
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
            console.log('📝 注意: 直连模式多个账户同步并发执行，同一账户重试间隔100ms，连接池已禁用');
            
            options = {
                directConcurrency: 1, // 直连模式固定为单次请求
                enableConnectionPool: false, // 连接池已禁用
                retryInterval: 100 // 重试间隔100ms
            };
            
            console.log(`\n✅ 直连模式配置完成:`);
            console.log(`   📊 请求模式: 多个账户并发执行`);
            console.log(`   🔌 连接池: 已禁用，使用独立连接`);
            console.log(`   ⏱️ 重试间隔: 100ms`);
            break;
            
        case '2':
            mode = 'proxy';
            console.log('\n🌐 请选择代理类型:');
            console.log('1. 代理类型 1 (默认)');
            console.log('2. 代理类型 2');
            
            const proxyChoice = await askQuestion(rl, '请输入选择 (1-2): ');
            proxyType = proxyChoice === '2' ? 2 : 1;
            
            console.log('\n🌐 共享代理模式配置说明:');
            console.log('📝 注意: 所有账户将共享使用一个代理IP');
            console.log('⏱️ 代理IP验证: 4秒内响应超时将被替换');
            console.log('🔄 自动切换: 代理IP每5分钟自动过期并切换新IP');
            console.log('💡 优势: 提高效率，降低成本，避免IP浪费');
            break;
        default:
            console.log('⚠️ 无效选择，使用默认直连模式');
            mode = 'direct';
            options = {
                directConcurrency: 1,
                enableConnectionPool: false,
                retryInterval: 100
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
        
        // 为没有accountId的账户添加accountId字段（使用uniqueId或生成一个）
        accounts = accounts.map(account => {
            if (!account.accountId) {
                // 优先使用uniqueId，如果也没有则生成一个
                account.accountId = account.uniqueId || `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            }
            return account;
        });
        
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
            console.log(`✅ 直连模式配置: 并发执行, 重试间隔${options.retryInterval || 100}ms, 连接池=禁用`);
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
  🌐 代理模式: 所有账户共享一个代理IP，4秒内响应验证，5分钟自动切换
  ⚡ 共享代理: 所有账户共用同一代理IP，IP过期自动切换，提高效率降低成本

🔄 双接口抢购功能:
  🎯 同时双接口: 系统会先调用原接口，无论结果如何都会在100ms后调用新接口
  📈 提高命中率: 双接口同时抢购，大幅提高抢券成功率
  🔍 智能判断: 自动判断哪个接口成功，只要有一个成功就算成功
  📊 详细统计: 显示原接口和新接口的成功率统计

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
        const accountList = await fetchOnlineUserAccounts(1, 100);
        
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
export { XiaomiSubsidyAcquirer, SmartXiaomiAcquirer, SharedProxyManager };
