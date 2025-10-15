import { getProxyFromSource } from './proxy-config.js';
import { testProxyIP } from './proxy-test.js';
import { logSimpleError } from './simple-logger.js';

/**
 * 代理管理器 - 处理动态代理切换
 */
class ProxyManager {
    constructor() {
        this.currentProxyType = 1; // 默认使用代理类型1
        this.maxSwitchAttempts = 20; // 最大切换次数
        this.switchCount = 0;
    }

    /**
     * 设置当前代理类型
     * @param {number} proxyType - 代理类型
     */
    setProxyType(proxyType) {
        this.currentProxyType = proxyType;
        this.switchCount = 0; // 重置切换计数
    }

    /**
     * 获取下一个可用的代理类型（暂不使用，保留备用）
     * @returns {number} 下一个代理类型
     */
    getNextProxyType() {
        // 简单的轮换策略：1 -> 2 -> 1 -> 2...
        return this.currentProxyType === 1 ? 2 : 1;
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
        
        console.log(`🔍 错误检测 - 状态码: ${status}, 错误代码: ${errorCode}, 消息: ${errorMessage}`);
        
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
            console.log(`⚠️ 检测到网络错误，将触发代理切换`);
        } else {
            console.log(`ℹ️ 非网络错误，不触发代理切换`);
        }
        
        return isNetworkErr;
    }

    /**
     * 获取同类型新代理IP（重新获取而非切换类型）
     * @param {Object} accountInfo - 账户信息（用于日志）
     * @returns {Promise<Object|null>} 新的代理信息，失败返回null
     */
    async switchProxy(accountInfo) {
        console.log(`📊 当前代理切换状态: ${this.switchCount}/${this.maxSwitchAttempts}`);
        
        if (this.switchCount >= this.maxSwitchAttempts) {
            console.error(`💥 已达到最大代理获取次数 (${this.maxSwitchAttempts})，无法继续获取`);
            if (accountInfo) {
                logSimpleError(accountInfo, '代理切换', `已达到最大获取次数 ${this.maxSwitchAttempts}`);
            }
            return null;
        }

        this.switchCount++;

        console.log(`🔄 重新获取代理IP：类型${this.currentProxyType} (第${this.switchCount}/${this.maxSwitchAttempts}次获取)`);
        
        if (accountInfo) {
            logSimpleError(accountInfo, '代理切换', `重新获取类型${this.currentProxyType}的新IP (${this.switchCount}/${this.maxSwitchAttempts})`);
        }

        try {
            // 获取同类型的新代理IP
            const proxyList = await getProxyFromSource(this.currentProxyType);
            // getProxyFromSource 返回数组，取第一个代理
            const proxyInfo = Array.isArray(proxyList) ? proxyList[0] : proxyList;
            
            // 测试新代理是否可用
            const testResult = await testProxyIP(proxyInfo);
            
            if (testResult.success) {
                console.log(`✅ 新代理IP获取成功！新IP: ${testResult.ip}`);
                console.log(`🔄 重置代理切换计数器，为下次可能的切换做准备`);
                // 成功获取新代理后，重置切换计数器，为下次可能的切换做准备
                this.resetSwitchCount();
                return {
                    ...proxyInfo,
                    validatedIP: testResult.ip
                };
            } else {
                console.log(`❌ 新代理IP验证失败: ${testResult.error}`);
                // 递归尝试获取下一个同类型代理
                return await this.switchProxy(accountInfo);
            }
            
        } catch (error) {
            console.error(`💥 获取新代理失败:`, error.message);
            if (accountInfo) {
                logSimpleError(accountInfo, '代理切换', `获取失败: ${error.message}`);
            }
            
            // 递归尝试获取下一个同类型代理
            return await this.switchProxy(accountInfo);
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
            currentProxyType: this.currentProxyType,
            switchCount: this.switchCount,
            maxSwitchAttempts: this.maxSwitchAttempts,
            canSwitch: this.switchCount < this.maxSwitchAttempts
        };
    }
}

// 创建全局代理管理器实例
export const proxyManager = new ProxyManager();

/**
 * 便捷函数：检查是否为网络错误
 * @param {Error} error - 错误对象
 * @returns {boolean} 是否为网络错误
 */
export function isNetworkError(error) {
    return proxyManager.isNetworkError(error);
}

/**
 * 便捷函数：获取同类型新代理IP
 * @param {Object} accountInfo - 账户信息
 * @returns {Promise<Object|null>} 新的代理信息
 */
export function switchProxy(accountInfo) {
    return proxyManager.switchProxy(accountInfo);
}

/**
 * 便捷函数：设置代理类型
 * @param {number} proxyType - 代理类型
 */
export function setProxyType(proxyType) {
    proxyManager.setProxyType(proxyType);
}

/**
 * 便捷函数：重置切换计数
 */
export function resetProxySwitchCount() {
    proxyManager.resetSwitchCount();
}

/**
 * 便捷函数：获取代理管理器状态
 * @returns {Object} 状态信息
 */
export function getProxyManagerStatus() {
    return proxyManager.getStatus();
}

/**
 * 分析错误类型并给出建议
 * @param {Error} error - 错误对象
 * @returns {Object} 错误分析结果
 */
export function analyzeError(error) {
    if (!error) return { type: 'unknown', description: '未知错误' };
    
    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = error.code || '';
    const status = error.response?.status || 0;
    
    // TLS/SSL错误
    if (errorMessage.includes('tls') || errorMessage.includes('secure') || errorMessage.includes('handshake')) {
        return {
            type: 'tls_error',
            description: 'TLS/SSL连接失败',
            suggestion: '代理服务器在建立安全连接时断开，建议立即切换代理',
            shouldSwitchProxy: true
        };
    }
    
    // 连接被拒绝
    if (errorCode === 'ECONNREFUSED' || errorMessage.includes('refused')) {
        return {
            type: 'connection_refused',
            description: '连接被拒绝',
            suggestion: '代理IP已失效或端口不可用，建议立即切换代理',
            shouldSwitchProxy: true
        };
    }
    
    // 连接超时
    if (errorCode === 'ETIMEDOUT' || errorMessage.includes('timeout')) {
        return {
            type: 'timeout',
            description: '连接超时',
            suggestion: '代理响应缓慢或网络不稳定，建议切换代理',
            shouldSwitchProxy: true
        };
    }
    
    // 套接字错误
    if (errorMessage.includes('socket') || errorMessage.includes('disconnected')) {
        return {
            type: 'socket_error',
            description: '套接字连接问题',
            suggestion: '网络连接中断，建议切换代理',
            shouldSwitchProxy: true
        };
    }
    
    // HTTP错误
    if (status >= 500) {
        return {
            type: 'http_server_error',
            description: `HTTP ${status} 服务器错误`,
            suggestion: '目标服务器问题，可尝试切换代理或稍后重试',
            shouldSwitchProxy: true
        };
    }
    
    // 业务逻辑错误
    if (status >= 400 && status < 500) {
        return {
            type: 'http_client_error',
            description: `HTTP ${status} 客户端错误`,
            suggestion: '请求参数或认证问题，不建议切换代理',
            shouldSwitchProxy: false
        };
    }
    
    return {
        type: 'other',
        description: '其他类型错误',
        suggestion: '需要进一步分析',
        shouldSwitchProxy: false
    };
}
