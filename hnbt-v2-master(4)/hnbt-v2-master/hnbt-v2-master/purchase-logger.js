import fs from 'fs';
import path from 'path';

/**
 * 抢购日志记录器
 */
class PurchaseLogger {
    constructor() {
        this.logDir = './logs';
        this.ensureLogDirectory();
    }

    /**
     * 确保日志目录存在
     */
    ensureLogDirectory() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    /**
     * 获取当前时间戳
     * @returns {string} 格式化的时间戳
     */
    getTimestamp() {
        return new Date().toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZone: 'Asia/Shanghai'
        });
    }

    /**
     * 获取日志文件名
     * @param {Object} accountInfo - 账户信息对象
     * @returns {string} 日志文件路径
     */
    getLogFileName(accountInfo) {
        const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const phone = accountInfo.phone || 'unknown';
        const tourismSubsidyId = accountInfo.tourismSubsidyId || 'unknown';
        return path.join(this.logDir, `${phone}_${tourismSubsidyId}_${date}.log`);
    }

    /**
     * 写入日志
     * @param {Object} accountInfo - 账户信息对象
     * @param {string} content - 日志内容
     */
    writeLog(accountInfo, content) {
        try {
            const logFile = this.getLogFileName(accountInfo);
            const timestamp = this.getTimestamp();
            const logEntry = `[${timestamp}] ${content}\n`;
            
            fs.appendFileSync(logFile, logEntry, 'utf8');
        } catch (error) {
            console.error('写入日志失败:', error.message);
        }
    }

    /**
     * 记录抢购开始
     * @param {Object} accountInfo - 账户信息
     * @param {Object} proxyInfo - 代理信息
     */
    logPurchaseStart(accountInfo, proxyInfo) {
        const logContent = `
=== 抢购开始 ===
账户: ${accountInfo.name} (${accountInfo.phone})
账户ID: ${accountInfo.accId}
唯一ID: ${accountInfo.uniqueId}
代理服务器: ${proxyInfo.server}:${proxyInfo.port}
代理来源: ${proxyInfo.source}
验证IP: ${proxyInfo.validatedIP}
旅游补贴ID: ${accountInfo.tourismSubsidyId}
餐饮补贴ID: ${accountInfo.foodSubsidyId || '无'}
===============================`;
        
        this.writeLog(accountInfo, logContent);
        console.log('📝 已记录抢购开始日志');
    }

    /**
     * 记录API请求
     * @param {Object} accountInfo - 账户信息对象
     * @param {string} step - 步骤名称
     * @param {string} method - 请求方法
     * @param {string} url - 请求URL
     * @param {Object} headers - 请求头
     * @param {Object} data - 请求数据
     * @param {Object} proxyInfo - 代理信息
     */
    logRequest(accountInfo, step, method, url, headers, data, proxyInfo) {
        const logContent = `
--- ${step} 请求 ---
方法: ${method}
URL: ${url}
代理: ${proxyInfo.server}:${proxyInfo.port} (${proxyInfo.validatedIP})
请求头: ${JSON.stringify(headers, null, 2)}
请求数据: ${data ? JSON.stringify(data, null, 2) : '无'}`;
        
        this.writeLog(accountInfo, logContent);
    }

    /**
     * 记录API响应
     * @param {Object} accountInfo - 账户信息对象
     * @param {string} step - 步骤名称
     * @param {number} statusCode - HTTP状态码
     * @param {Object} responseData - 响应数据
     * @param {boolean} success - 是否成功
     * @param {string} error - 错误信息
     */
    logResponse(accountInfo, step, statusCode, responseData, success, error = null) {
        const logContent = `
--- ${step} 响应 ---
状态码: ${statusCode || '未知'}
成功: ${success ? '是' : '否'}
响应数据: ${JSON.stringify(responseData, null, 2)}
错误信息: ${error || '无'}`;
        
        this.writeLog(accountInfo, logContent);
    }

    /**
     * 记录步骤结果
     * @param {Object} accountInfo - 账户信息对象
     * @param {string} step - 步骤名称
     * @param {boolean} success - 是否成功
     * @param {string} message - 消息
     * @param {number} attempt - 尝试次数
     */
    logStepResult(accountInfo, step, success, message, attempt = 1) {
        const logContent = `
*** ${step} 结果 ***
尝试次数: ${attempt}
结果: ${success ? '成功' : '失败'}
消息: ${message}`;
        
        this.writeLog(accountInfo, logContent);
    }

    /**
     * 记录抢购最终结果
     * @param {Object} accountInfo - 账户信息对象
     * @param {boolean} success - 是否成功
     * @param {string} message - 结果消息
     * @param {Object} finalData - 最终数据
     */
    logFinalResult(accountInfo, success, message, finalData = null) {
        const logContent = `
🎯 === 抢购最终结果 === 🎯
结果: ${success ? '✅ 成功' : '❌ 失败'}
消息: ${message}
最终数据: ${finalData ? JSON.stringify(finalData, null, 2) : '无'}
结束时间: ${this.getTimestamp()}
===============================`;
        
        this.writeLog(accountInfo, logContent);
        console.log(`📝 已记录最终结果: ${success ? '成功' : '失败'}`);
    }

    /**
     * 记录错误信息
     * @param {Object} accountInfo - 账户信息对象
     * @param {string} step - 步骤名称
     * @param {Error} error - 错误对象
     */
    logError(accountInfo, step, error) {
        const logContent = `
💥 === 错误日志 === 💥
步骤: ${step}
错误消息: ${error.message}
错误堆栈: ${error.stack}
时间: ${this.getTimestamp()}`;
        
        this.writeLog(accountInfo, logContent);
    }
}

// 创建全局日志实例
export const purchaseLogger = new PurchaseLogger();

/**
 * 便捷的日志记录函数
 */
export function logPurchaseStart(accountInfo, proxyInfo) {
    purchaseLogger.logPurchaseStart(accountInfo, proxyInfo);
}

export function logRequest(accountInfo, step, method, url, headers, data, proxyInfo) {
    purchaseLogger.logRequest(accountInfo, step, method, url, headers, data, proxyInfo);
}

export function logResponse(accountInfo, step, statusCode, responseData, success, error) {
    purchaseLogger.logResponse(accountInfo, step, statusCode, responseData, success, error);
}

export function logStepResult(accountInfo, step, success, message, attempt) {
    purchaseLogger.logStepResult(accountInfo, step, success, message, attempt);
}

export function logFinalResult(accountInfo, success, message, finalData) {
    purchaseLogger.logFinalResult(accountInfo, success, message, finalData);
}

export function logError(accountInfo, step, error) {
    purchaseLogger.logError(accountInfo, step, error);
} 