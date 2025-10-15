import { getProxyFromSource } from './proxy-config.js';
import { testProxyIP } from './proxy-test.js';
import { logSimpleError } from './simple-logger.js';

/**
 * 独立的代理管理器类 - 每个账户都有自己的实例
 */
class IndependentProxyManager {
    constructor(accountInfo, proxyType, initialProxy = null) {
        this.accountInfo = accountInfo;
        this.currentProxyType = proxyType;
        this.maxSwitchAttempts = 20;
        this.switchCount = 0;
        this.currentProxy = initialProxy;
        this.accountId = `${accountInfo.name}(${accountInfo.phone})`;
    }

    /**
     * 检查是否为网络错误（代理IP问题）
     * @param {Error} error - 错误对象
     * @returns {boolean} 是否为网络错误
     */
    isNetworkError(error) {
        if (!error) return false;
        
        const errorMessage = error.message?.toLowerCase() || '';
        const errorCode = error.code || '';
        const status = error.response?.status || 0;
        
        console.log(`🔍 [${this.accountId}] 错误检测 - 状态码: ${status}, 错误代码: ${errorCode}, 消息: ${errorMessage}`);
        
        // 检查各种网络错误情况
        const isNetworkErr = (
            // HTTP 500系列错误 或 无状态码（网络层错误）
            (status >= 500 || status === 0) ||
            // 连接错误代码（代理IP问题）
            errorCode === 'ECONNRESET' ||
            errorCode === 'ECONNREFUSED' ||
            errorCode === 'ETIMEDOUT' ||
            errorCode === 'ENOTFOUND' ||
            errorCode === 'ECONNABORTED' ||
            errorCode === 'EHOSTUNREACH' ||
            errorCode === 'ENETUNREACH' ||
            errorCode === 'EAI_AGAIN' ||
            // TLS/SSL相关错误（代理连接问题）
            errorMessage.includes('tls') ||
            errorMessage.includes('ssl') ||
            errorMessage.includes('secure') ||
            errorMessage.includes('certificate') ||
            errorMessage.includes('handshake') ||
            // 套接字相关错误（连接断开）
            errorMessage.includes('socket') ||
            errorMessage.includes('disconnected') ||
            errorMessage.includes('closed') ||
            errorMessage.includes('ended') ||
            // 代理相关错误
            errorMessage.includes('proxy') ||
            errorMessage.includes('tunnel') ||
            // 连接相关错误（但排除HTTP状态错误）
            (status === 0 && (
                errorMessage.includes('connect') ||
                errorMessage.includes('connection') ||
                errorMessage.includes('refused') ||
                errorMessage.includes('reset') ||
                errorMessage.includes('timeout') ||
                errorMessage.includes('unreachable')
            )) ||
            // 网络相关错误（DNS等）
            errorMessage.includes('network') ||
            errorMessage.includes('dns') ||
            errorMessage.includes('resolve') ||
            // Axios 网络层错误
            errorMessage.includes('network error') ||
            (status === 0 && errorMessage.includes('request failed')) ||
            errorMessage.includes('request timeout') ||
            // 其他网络层错误
            errorMessage.includes('getaddrinfo') ||
            errorMessage.includes('eai_again') ||
            errorMessage.includes('lookup')
        );
        
        if (isNetworkErr) {
            console.log(`⚠️ [${this.accountId}] 检测到网络错误，将触发代理切换`);
        } else {
            console.log(`ℹ️ [${this.accountId}] 非网络错误，不触发代理切换`);
        }
        
        return isNetworkErr;
    }

    /**
     * 获取同类型新代理IP
     * @returns {Promise<Object|null>} 新的代理信息，失败返回null
     */
    async switchProxy() {
        console.log(`📊 [${this.accountId}] 当前代理切换状态: ${this.switchCount}/${this.maxSwitchAttempts}`);
        
        if (this.switchCount >= this.maxSwitchAttempts) {
            console.error(`💥 [${this.accountId}] 已达到最大代理获取次数 (${this.maxSwitchAttempts})，无法继续获取`);
            logSimpleError(this.accountInfo, '代理切换', `已达到最大获取次数 ${this.maxSwitchAttempts}`);
            return null;
        }

        this.switchCount++;

        console.log(`🔄 [${this.accountId}] 重新获取代理IP：类型${this.currentProxyType} (第${this.switchCount}/${this.maxSwitchAttempts}次获取)`);
        
        logSimpleError(this.accountInfo, '代理切换', `重新获取类型${this.currentProxyType}的新IP (${this.switchCount}/${this.maxSwitchAttempts})`);

        try {
            // 获取同类型的新代理IP
            const proxyList = await getProxyFromSource(this.currentProxyType, 1);
            
            // 检查是否成功获取到代理IP
            if (!proxyList || proxyList.length === 0) {
                throw new Error('代理API返回的IP列表为空，可能是配额用完或服务不可用');
            }
            
            const proxyInfo = Array.isArray(proxyList) ? proxyList[0] : proxyList;
            
            // 测试新代理是否可用
            const testResult = await testProxyIP(proxyInfo);
            
            if (testResult.success) {
                console.log(`✅ [${this.accountId}] 新代理IP获取成功！新IP: ${testResult.ip}`);
                console.log(`🔄 [${this.accountId}] 重置代理切换计数器，为下次可能的切换做准备`);
                
                // 成功获取新代理后，重置切换计数器，为下次可能的切换做准备
                this.resetSwitchCount();
                
                // 更新当前代理
                this.currentProxy = {
                    ...proxyInfo,
                    validatedIP: testResult.ip
                };
                
                return this.currentProxy;
            } else {
                console.log(`❌ [${this.accountId}] 新代理IP验证失败: ${testResult.error}`);
                // 验证失败时，检查是否还能继续尝试
                if (this.switchCount < this.maxSwitchAttempts) {
                    return await this.switchProxy();
                } else {
                    logSimpleError(this.accountInfo, '代理切换', `验证失败且已达到最大尝试次数: ${testResult.error}`);
                    return null;
                }
            }
            
        } catch (error) {
            console.error(`💥 [${this.accountId}] 获取新代理失败:`, error.message);
            logSimpleError(this.accountInfo, '代理切换', `获取失败: ${error.message}`);
            
            // 特殊处理：如果是代理列表为空，增加延迟避免过于频繁的请求
            if (error.message.includes('IP列表为空')) {
                console.log(`⏳ [${this.accountId}] 代理服务暂时不可用，等待5秒后重试...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
            
            // 检查是否还能继续尝试
            if (this.switchCount < this.maxSwitchAttempts) {
                return await this.switchProxy();
            } else {
                console.error(`💥 [${this.accountId}] 已达到最大代理切换次数，停止尝试`);
                return null;
            }
        }
    }

    /**
     * 重置切换计数
     */
    resetSwitchCount() {
        this.switchCount = 0;
    }

    /**
     * 获取当前状态信息
     * @returns {Object} 状态信息
     */
    getStatus() {
        return {
            accountId: this.accountId,
            currentProxyType: this.currentProxyType,
            switchCount: this.switchCount,
            maxSwitchAttempts: this.maxSwitchAttempts,
            canSwitch: this.switchCount < this.maxSwitchAttempts,
            currentProxy: this.currentProxy
        };
    }

    /**
     * 设置当前代理
     * @param {Object} proxy - 代理信息
     */
    setCurrentProxy(proxy) {
        this.currentProxy = proxy;
        this.resetSwitchCount(); // 设置新代理时重置计数器
    }

    /**
     * 获取当前代理
     * @returns {Object|null} 当前代理信息
     */
    getCurrentProxy() {
        return this.currentProxy;
    }
}

/**
 * 代理管理器工厂 - 为每个账户创建独立的管理器
 */
export class MultiProxyManagerFactory {
    constructor() {
        this.managerMap = new Map(); // 使用Map存储每个账户的代理管理器
    }

    /**
     * 为账户创建独立的代理管理器
     * @param {Object} accountInfo - 账户信息
     * @param {number} proxyType - 代理类型
     * @param {Object} initialProxy - 初始代理信息
     * @returns {IndependentProxyManager} 独立的代理管理器
     */
    createManager(accountInfo, proxyType, initialProxy = null) {
        const accountKey = `${accountInfo.phone}_${accountInfo.accId}`;
        const manager = new IndependentProxyManager(accountInfo, proxyType, initialProxy);
        this.managerMap.set(accountKey, manager);
        return manager;
    }

    /**
     * 获取或创建账户的代理管理器
     * @param {string|Object} accountIdOrInfo - 账户ID字符串或账户信息对象
     * @param {number} proxyType - 代理类型
     * @param {Object} initialProxy - 初始代理信息
     * @returns {IndependentProxyManager} 代理管理器
     */
    getManager(accountIdOrInfo, proxyType, initialProxy) {
        // 兼容两种调用方式
        let accountKey, accountInfo;
        
        if (typeof accountIdOrInfo === 'string') {
            // 字符串格式：'name(phone)'
            accountKey = accountIdOrInfo;
            // 从字符串解析出基本信息（简化处理）
            const match = accountIdOrInfo.match(/^(.+)\((.+)\)$/);
            if (match) {
                accountInfo = {
                    name: match[1],
                    phone: match[2],
                    accId: match[2] // 使用phone作为accId的临时替代
                };
            } else {
                accountInfo = {
                    name: accountIdOrInfo,
                    phone: accountIdOrInfo,
                    accId: accountIdOrInfo
                };
            }
        } else {
            // 对象格式
            accountInfo = accountIdOrInfo;
            accountKey = `${accountInfo.phone}_${accountInfo.accId}`;
        }
        
        // 检查是否已存在管理器
        let manager = this.managerMap.get(accountKey);
        
        if (!manager) {
            // 创建新的管理器
            manager = new IndependentProxyManager(accountInfo, proxyType, initialProxy);
            this.managerMap.set(accountKey, manager);
        } else if (initialProxy) {
            // 更新已存在管理器的代理信息
            manager.setCurrentProxy(initialProxy);
        }
        
        return manager;
    }

    /**
     * 获取所有管理器的状态
     * @returns {Array} 所有管理器状态
     */
    getAllStatus() {
        return Array.from(this.managerMap.values()).map(manager => manager.getStatus());
    }

    /**
     * 清除所有管理器
     */
    clear() {
        this.managerMap.clear();
    }
}

// 创建全局多账户代理管理器工厂
export const multiProxyFactory = new MultiProxyManagerFactory();
