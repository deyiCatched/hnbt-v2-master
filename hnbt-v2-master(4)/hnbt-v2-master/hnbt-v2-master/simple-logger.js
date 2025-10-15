import fs from 'fs';
import path from 'path';

/**
 * 简洁版日志记录器
 * 只记录操作信息和接口响应结果，不包含详细的请求参数和响应数据
 */
class SimpleLogger {
    constructor() {
        this.logDir = './simple-logs';
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
        const id = accountInfo.id || 'unknown';
        
        // 新的命名格式：{phone}-{id}-{date}
        return path.join(this.logDir, `${phone}-${id}-${date}.log`);
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
            console.error('写入简洁日志失败:', error.message);
        }
    }

    /**
     * 记录系统开始
     * @param {Object} accountInfo - 账户信息
     * @param {Object} proxyInfo - 代理信息
     */
    logSystemStart(accountInfo, proxyInfo) {
        this.writeLog(accountInfo, '系统开始');
        this.writeLog(accountInfo, `分配到代理ip：${proxyInfo.validatedIP || proxyInfo.server + ':' + proxyInfo.port}`);
    }

    /**
     * 记录开始获取ticket
     * @param {Object} accountInfo - 账户信息
     */
    logStartGetTicket(accountInfo) {
        this.writeLog(accountInfo, '开始获取ticket');
    }

    /**
     * 记录获取ticket结果
     * @param {Object} accountInfo - 账户信息
     * @param {boolean} success - 是否成功
     * @param {string} message - 消息
     * @param {Object} responseData - 响应数据 (用于提取完整信息)
     */
    logGetTicketResult(accountInfo, success, message, responseData = null) {
        if (success) {
            this.writeLog(accountInfo, '获取ticket成功');
        } else {
            this.writeLog(accountInfo, message || '获取ticket失败');
        }
    }

    /**
     * 记录开始校验ticket
     * @param {Object} accountInfo - 账户信息
     */
    logStartVerifyTicket(accountInfo) {
        this.writeLog(accountInfo, '开始校验ticket');
    }

    /**
     * 记录校验ticket结果
     * @param {Object} accountInfo - 账户信息
     * @param {boolean} success - 是否成功
     * @param {string} message - 消息
     * @param {Object} responseData - 响应数据
     */
    logVerifyTicketResult(accountInfo, success, message, responseData = null) {
        if (success) {
            this.writeLog(accountInfo, '校验ticket成功');
        } else {
            this.writeLog(accountInfo, message || '校验ticket失败');
        }
    }

    /**
     * 记录开始提交预约
     * @param {Object} accountInfo - 账户信息
     */
    logStartSubmitReservation(accountInfo) {
        this.writeLog(accountInfo, '开始提交预约申请');
    }

    /**
     * 记录提交预约结果
     * @param {Object} accountInfo - 账户信息
     * @param {boolean} success - 是否成功
     * @param {string} message - 消息
     * @param {Object} responseData - 响应数据
     */
    logSubmitReservationResult(accountInfo, success, message, responseData = null) {
        if (success) {
            this.writeLog(accountInfo, '预约提交成功！');
        } else {
            this.writeLog(accountInfo, message || '预约提交失败');
        }
    }

    /**
     * 记录ticket过期需要重新获取
     * @param {Object} accountInfo - 账户信息
     * @param {number} refreshCount - 当前刷新次数
     */
    logTicketExpired(accountInfo, refreshCount) {
        this.writeLog(accountInfo, `ticket已过期，开始第${refreshCount}次重新获取`);
    }

    /**
     * 记录最终结果
     * @param {Object} accountInfo - 账户信息
     * @param {boolean} success - 是否成功
     * @param {string} message - 结果消息
     */
    logFinalResult(accountInfo, success, message) {
        if (success) {
            this.writeLog(accountInfo, `🎉 抢购成功！${message ? ' - ' + message : ''}`);
        } else {
            this.writeLog(accountInfo, `💥 抢购失败：${message || '未知原因'}`);
        }
    }

    /**
     * 记录错误信息（仅记录错误消息，不记录堆栈）
     * @param {Object} accountInfo - 账户信息
     * @param {string} step - 步骤名称
     * @param {string} errorMessage - 错误消息
     */
    logError(accountInfo, step, errorMessage) {
        this.writeLog(accountInfo, `错误 - ${step}: ${errorMessage}`);
    }

    /**
     * 记录网络错误检测详情
     * @param {Object} accountInfo - 账户信息
     * @param {Object} error - 错误对象
     * @param {boolean} isNetworkError - 是否被检测为网络错误
     */
    logNetworkErrorDetection(accountInfo, error, isNetworkError) {
        const errorCode = error.code || '无';
        const status = error.response?.status || '无';
        const message = error.message || '无详细信息';
        
        this.writeLog(accountInfo, `网络错误检测 - 代码:${errorCode} 状态:${status} 结果:${isNetworkError ? '是网络错误' : '非网络错误'}`);
        this.writeLog(accountInfo, `错误详情: ${message}`);
    }

    /**
     * 记录代理IP测试结果
     * @param {Object} accountInfo - 账户信息
     * @param {boolean} success - 是否成功
     * @param {string} ip - 测试得到的IP
     */
    logProxyTest(accountInfo, success, ip) {
        if (success) {
            this.writeLog(accountInfo, `代理IP测试成功：${ip}`);
        } else {
            this.writeLog(accountInfo, '代理IP测试失败');
        }
    }
}

// 创建全局简洁日志实例
export const simpleLogger = new SimpleLogger();

/**
 * 便捷的简洁日志记录函数
 */
export function logSystemStart(accountInfo, proxyInfo) {
    simpleLogger.logSystemStart(accountInfo, proxyInfo);
}

export function logStartGetTicket(accountInfo) {
    simpleLogger.logStartGetTicket(accountInfo);
}

export function logGetTicketResult(accountInfo, success, message, responseData) {
    simpleLogger.logGetTicketResult(accountInfo, success, message, responseData);
}

export function logStartVerifyTicket(accountInfo) {
    simpleLogger.logStartVerifyTicket(accountInfo);
}

export function logVerifyTicketResult(accountInfo, success, message, responseData) {
    simpleLogger.logVerifyTicketResult(accountInfo, success, message, responseData);
}

export function logStartSubmitReservation(accountInfo) {
    simpleLogger.logStartSubmitReservation(accountInfo);
}

export function logSubmitReservationResult(accountInfo, success, message, responseData) {
    simpleLogger.logSubmitReservationResult(accountInfo, success, message, responseData);
}

export function logTicketExpired(accountInfo, refreshCount) {
    simpleLogger.logTicketExpired(accountInfo, refreshCount);
}

export function logSimpleFinalResult(accountInfo, success, message) {
    simpleLogger.logFinalResult(accountInfo, success, message);
}

export function logSimpleError(accountInfo, step, errorMessage) {
    simpleLogger.logError(accountInfo, step, errorMessage);
}

export function logNetworkErrorDetection(accountInfo, error, isNetworkError) {
    simpleLogger.logNetworkErrorDetection(accountInfo, error, isNetworkError);
}

export function logProxyTest(accountInfo, success, ip) {
    simpleLogger.logProxyTest(accountInfo, success, ip);
}
