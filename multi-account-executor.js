import { multiProxyFactory } from './multi-proxy-manager.js';
import { getSystemTicket, verifyTicket, submitReservation } from './purchase-flow.js';
import { logPurchaseStart, logFinalResult, logError } from './purchase-logger.js';
import { 
    logStartGetTicket, logGetTicketResult, logStartVerifyTicket, 
    logVerifyTicketResult, logStartSubmitReservation, logSubmitReservationResult,
    logTicketExpired, logNetworkErrorDetection 
} from './simple-logger.js';
import { testProxyIP } from './proxy-test.js';
import { logSystemStart, logSimpleFinalResult, logProxyTest } from './simple-logger.js';

/**
 * 多账户抢购执行器
 */
export class MultiAccountExecutor {
    constructor() {
        this.results = new Map(); // 存储每个账户的执行结果
        this.runningTasks = new Map(); // 存储正在运行的任务
    }

    /**
     * 为账户分配代理IP并验证
     * @param {Object} accountInfo - 账户信息
     * @param {Object} proxyInfo - 代理信息
     * @returns {Promise<Object|null>} 验证后的代理信息
     */
    async assignAndValidateProxy(accountInfo, proxyInfo) {
        const accountId = `${accountInfo.name}(${accountInfo.phone})`;
        
        try {
            console.log(`🔍 [${accountId}] 正在验证分配的代理IP: ${proxyInfo.server}:${proxyInfo.port}`);
            
            const testResult = await testProxyIP(proxyInfo);
            
            if (testResult.success) {
                console.log(`✅ [${accountId}] 代理IP验证成功: ${testResult.ip}`);
                
                // 记录到简洁日志
                logProxyTest(accountInfo, true, testResult.ip);
                
                return {
                    ...proxyInfo,
                    validatedIP: testResult.ip
                };
            } else {
                console.log(`❌ [${accountId}] 代理IP验证失败: ${testResult.error}`);
                
                // 记录到简洁日志
                logProxyTest(accountInfo, false, null);
                
                return null;
            }
        } catch (error) {
            console.error(`💥 [${accountId}] 代理IP验证异常:`, error.message);
            logProxyTest(accountInfo, false, null);
            return null;
        }
    }

    /**
     * 执行单个账户的抢购任务
     * @param {Object} accountInfo - 账户信息
     * @param {Object} validatedProxy - 已验证的代理信息
     * @param {number} proxyType - 代理类型
     * @returns {Promise<Object>} 执行结果
     */
    async executeSingleAccount(accountInfo, validatedProxy, proxyType) {
        const accountId = `${accountInfo.name}(${accountInfo.phone})`;
        
        try {
            console.log(`🚀 [${accountId}] 开始抢购任务...`);
            
            // 为该账户创建独立的代理管理器
            const proxyManager = multiProxyFactory.createManager(accountInfo, proxyType, validatedProxy);
            
            // 记录系统开始到简洁日志
            logSystemStart(accountInfo, validatedProxy);
            
            // 使用修改过的抢购流程，传入代理管理器
            const result = await this.executeWithIsolatedProxy(accountInfo, proxyManager);
            
            // 记录最终结果
            logSimpleFinalResult(accountInfo, result.success, result.message || result.error);
            
            console.log(`${result.success ? '🎉' : '💥'} [${accountId}] 抢购任务完成: ${result.success ? '成功' : '失败'}`);
            
            return {
                accountInfo,
                success: result.success,
                message: result.message,
                error: result.error,
                data: result.data,
                usedProxy: validatedProxy.validatedIP
            };
            
        } catch (error) {
            console.error(`💥 [${accountId}] 抢购任务异常:`, error.message);
            
            // 记录错误到简洁日志
            logSimpleFinalResult(accountInfo, false, `任务异常: ${error.message}`);
            
            return {
                accountInfo,
                success: false,
                error: `任务异常: ${error.message}`,
                usedProxy: validatedProxy?.validatedIP || 'unknown'
            };
        }
    }

    /**
     * 使用独立代理管理器执行抢购流程
     * @param {Object} accountInfo - 账户信息
     * @param {Object} proxyManager - 独立的代理管理器
     * @returns {Promise<Object>} 执行结果
     */
    async executeWithIsolatedProxy(accountInfo, proxyManager) {
        const accountId = `${accountInfo.name}(${accountInfo.phone})`;
        
        try {
            // 获取当前代理
            let currentProxy = proxyManager.getCurrentProxy();
            
            // 使用修改过的抢购流程，支持独立代理管理
            const result = await this.executeFlowWithProxyManager(accountInfo, proxyManager);
            
            return result;
            
        } catch (error) {
            console.error(`💥 [${accountId}] 独立代理执行失败:`, error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 使用代理管理器执行抢购流程（独立实现以支持独立代理管理）
     * @param {Object} accountInfo - 账户信息
     * @param {Object} proxyManager - 代理管理器
     * @returns {Promise<Object>} 执行结果
     */
    async executeFlowWithProxyManager(accountInfo, proxyManager) {
        const accountId = `${accountInfo.name}(${accountInfo.phone})`;
        
        try {
            console.log(`🚀 [${accountId}] 开始执行完整抢购流程...`);
            console.log(`👤 [${accountId}] 账户: ${accountInfo.name}`);
            const currentProxy = proxyManager.getCurrentProxy();
            console.log(`🌐 [${accountId}] 代理: ${currentProxy.server}:${currentProxy.port} (${currentProxy.source})`);
            console.log(`📍 [${accountId}] 真实IP: ${currentProxy.validatedIP}`);

            // 记录抢购开始日志
            logPurchaseStart(accountInfo, currentProxy);

            let currentTicket = null;
            let ticketRefreshCount = 0;
            const maxTicketRefresh = 10; // 最大ticket刷新次数，防止无限循环

            while (ticketRefreshCount < maxTicketRefresh) {
                try {
                    // 步骤1：获取系统ticket（带独立网络错误处理）
                    console.log(`🎫 [${accountId}] 正在获取ticket (第${ticketRefreshCount + 1}次)...`);
                    
                    const ticketResult = await this.executeStepWithProxyManager(
                        () => getSystemTicket(accountInfo, proxyManager.getCurrentProxy()),
                        proxyManager,
                        accountInfo,
                        '获取系统ticket'
                    );
                    
                    if (!ticketResult.success) {
                        const errorMsg = '获取系统ticket失败';
                        logFinalResult(accountInfo, false, errorMsg);
                        throw new Error(errorMsg);
                    }

                    // 步骤2：校验ticket（带独立网络错误处理）
                    const verifyResult = await this.executeStepWithProxyManager(
                        () => verifyTicket(ticketResult.result.ticket, accountInfo, proxyManager.getCurrentProxy()),
                        proxyManager,
                        accountInfo,
                        '校验系统ticket'
                    );
                    
                    if (!verifyResult.success) {
                        const errorMsg = '校验ticket失败';
                        logFinalResult(accountInfo, false, errorMsg);
                        throw new Error(errorMsg);
                    }

                    currentTicket = verifyResult.result.ticket;
                    console.log(`✅ [${accountId}] ticket获取并校验成功，开始提交预约...`);

                    // 步骤3：提交预约（带独立网络错误处理，循环提交直到成功或ticket过期）
                    const submitResult = await this.executeStepWithProxyManager(
                        () => submitReservation(currentTicket, accountInfo, proxyManager.getCurrentProxy()),
                        proxyManager,
                        accountInfo,
                        '提交预约申请'
                    );

                    if (submitResult.success) {
                        console.log(`🎊 [${accountId}] 抢购流程执行完成！`);
                        
                        // 记录最终成功结果
                        logFinalResult(accountInfo, submitResult.success, submitResult.result.message, submitResult.result.data);
                        
                        return submitResult.result;
                    }

                    // 检查是否需要重新获取ticket
                    if (submitResult.result && submitResult.result.needRefreshTicket) {
                        ticketRefreshCount++;
                        console.log(`🔄 [${accountId}] ticket已过期，准备重新获取 (${ticketRefreshCount}/${maxTicketRefresh})`);
                        
                        // 记录简洁日志：ticket过期重新获取
                        logTicketExpired(accountInfo, ticketRefreshCount);
                        
                        if (ticketRefreshCount >= maxTicketRefresh) {
                            const errorMsg = `已达到最大ticket刷新次数 (${maxTicketRefresh})，停止尝试`;
                            console.error(`💥 [${accountId}]`, errorMsg);
                            logFinalResult(accountInfo, false, errorMsg);
                            
                            return {
                                success: false,
                                error: errorMsg
                            };
                        }
                        
                        // 立即重新获取ticket
                        console.log(`🔄 [${accountId}] 立即重新获取ticket...`);
                        continue; // 重新开始整个流程
                    } else {
                        // 其他类型的失败
                        logFinalResult(accountInfo, false, submitResult.error || submitResult.result?.error);
                        
                        return {
                            success: false,
                            error: submitResult.error || submitResult.result?.error || '提交预约失败'
                        };
                    }

                } catch (error) {
                    // 如果是在ticket获取或校验阶段失败，直接抛出
                    throw error;
                }
            }

            // 如果到这里说明超过了最大刷新次数
            const errorMsg = `超过最大ticket刷新次数 (${maxTicketRefresh})`;
            logFinalResult(accountInfo, false, errorMsg);
            
            return {
                success: false,
                error: errorMsg
            };

        } catch (error) {
            console.error(`💥 [${accountId}] 抢购流程执行失败:`, error.message);
            
            // 记录最终失败结果
            logFinalResult(accountInfo, false, error.message);
            logError(accountInfo, '完整抢购流程', error);
            
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 执行单个步骤并处理网络错误（使用独立代理管理器）
     * @param {Function} stepFunction - 要执行的步骤函数
     * @param {Object} proxyManager - 独立代理管理器
     * @param {Object} accountInfo - 账户信息
     * @param {string} stepName - 步骤名称
     * @returns {Promise<Object>} 执行结果
     */
    async executeStepWithProxyManager(stepFunction, proxyManager, accountInfo, stepName) {
        const accountId = `${accountInfo.name}(${accountInfo.phone})`;
        
        try {
            const result = await stepFunction();
            return {
                success: true,
                result: result
            };
        } catch (error) {
            // 检查是否为网络错误（代理IP问题）
            const isNetErr = proxyManager.isNetworkError(error) || error.message?.includes('NETWORK_ERROR:');
            
            // 如果不是网络错误，记录网络错误检测详情到简洁日志
            if (!error.message?.includes('NETWORK_ERROR:')) {
                logNetworkErrorDetection(accountInfo, error, isNetErr);
            }
            
            if (isNetErr) {
                // 提取原始错误消息
                const originalMessage = error.message?.includes('NETWORK_ERROR:') 
                    ? error.message.replace('NETWORK_ERROR: ', '')
                    : error.message;
                    
                console.log(`⚠️ [${accountId}] 检测到网络错误 (${stepName}): ${originalMessage}`);
                
                // 尝试获取同类型新代理
                const newProxyInfo = await proxyManager.switchProxy();
                
                if (newProxyInfo) {
                    console.log(`🔄 [${accountId}] 新代理获取成功，重新执行 ${stepName}...`);
                    
                    // 使用新代理重新执行
                    try {
                        const result = await stepFunction();
                        return {
                            success: true,
                            result: result
                        };
                    } catch (retryError) {
                        const originalRetryMessage = retryError.message?.includes('NETWORK_ERROR:') 
                            ? retryError.message.replace('NETWORK_ERROR: ', '')
                            : retryError.message;
                        console.error(`💥 [${accountId}] 使用新代理重试 ${stepName} 仍然失败:`, originalRetryMessage);
                        return {
                            success: false,
                            error: retryError.message,
                            result: null
                        };
                    }
                } else {
                    console.error(`💥 [${accountId}] 无法获取到可用代理，${stepName} 执行失败`);
                    return {
                        success: false,
                        error: `无法获取到可用代理，${stepName} 执行失败`,
                        result: null
                    };
                }
            } else {
                // 非网络错误，直接返回
                return {
                    success: false,
                    error: error.message,
                    result: null
                };
            }
        }
    }

    /**
     * 并发执行多账户抢购
     * @param {Array} accountList - 账户列表
     * @param {Array} proxyList - 代理IP列表
     * @param {number} proxyType - 代理类型
     * @returns {Promise<Array>} 所有账户的执行结果
     */
    async executeMultipleAccounts(accountList, proxyList, proxyType) {
        console.log(`🎯 开始执行 ${accountList.length} 个账户的并发抢购任务...`);
        console.log(`📡 可用代理IP数量: ${proxyList.length}`);
        console.log('=====================================');

        // 清理之前的状态
        this.results.clear();
        this.runningTasks.clear();
        multiProxyFactory.clear();

        // 防重复执行检查
        if (accountList.length === 0) {
            throw new Error('没有可用的账户进行抢购');
        }
        
        if (proxyList.length === 0) {
            throw new Error('没有可用的代理IP进行抢购');
        }

        // 为每个账户分配代理IP并验证（1:1分配策略）
        console.log(`📋 开始为 ${accountList.length} 个账户分配代理IP...`);
        
        const assignmentTasks = accountList.map(async (account, index) => {
            const accountId = `${account.name}(${account.phone})`;
            
            console.log(`🔗 [${accountId}] 分配账户 ${index + 1}/${accountList.length}`);
            
            try {
                // 优先使用对应索引的代理IP
                let proxy = proxyList[index % proxyList.length];
                
                console.log(`🎯 [${accountId}] 分配代理IP: ${proxy.server}:${proxy.port} (索引:${index})`);
                
                const validatedProxy = await this.assignAndValidateProxy(account, proxy);
                
                if (validatedProxy) {
                    console.log(`✅ [${accountId}] 代理分配成功`);
                    return { account, validatedProxy, proxyType };
                }
                
                // 如果对应索引的代理无效，尝试其他代理
                console.log(`⚠️ [${accountId}] 主分配代理无效，尝试备用代理...`);
                
                for (let proxyIndex = 0; proxyIndex < proxyList.length; proxyIndex++) {
                    if (proxyIndex === (index % proxyList.length)) continue; // 跳过已尝试的
                    
                    proxy = proxyList[proxyIndex];
                    console.log(`🔄 [${accountId}] 尝试备用代理: ${proxy.server}:${proxy.port}`);
                    
                    const validatedProxy = await this.assignAndValidateProxy(account, proxy);
                    
                    if (validatedProxy) {
                        console.log(`✅ [${accountId}] 备用代理分配成功`);
                        return { account, validatedProxy, proxyType };
                    }
                }
                
                // 如果所有代理都无效
                throw new Error('无法为该账户分配有效的代理IP');
                
            } catch (error) {
                console.error(`💥 [${accountId}] 代理分配失败:`, error.message);
                return { account, error: error.message };
            }
        });

        // 等待所有代理分配完成
        const assignments = await Promise.allSettled(assignmentTasks);
        
        // 过滤出成功分配代理的账户
        const validAssignments = assignments
            .filter(result => result.status === 'fulfilled' && result.value.validatedProxy)
            .map(result => result.value);

        console.log(`✅ 成功为 ${validAssignments.length}/${accountList.length} 个账户分配了有效代理`);

        if (validAssignments.length === 0) {
            throw new Error('没有账户获得有效的代理IP，无法执行抢购');
        }

        // 并发执行所有有效账户的抢购任务
        console.log(`🏃‍♂️ 开始并发执行 ${validAssignments.length} 个抢购任务...`);
        
        const executionTasks = validAssignments.map(({ account, validatedProxy, proxyType }) => {
            const accountId = `${account.name}(${account.phone})`;
            console.log(`🚀 [${accountId}] 启动抢购任务...`);
            
            const task = this.executeSingleAccount(account, validatedProxy, proxyType);
            
            // 存储正在运行的任务
            const accountKey = `${account.phone}_${account.accId}`;
            this.runningTasks.set(accountKey, task);
            
            return task;
        });

        // 等待所有抢购任务完成
        console.log(`⏳ 等待 ${executionTasks.length} 个任务完成...`);
        const results = await Promise.allSettled(executionTasks);
        
        // 清理运行任务记录
        this.runningTasks.clear();

        // 整理结果
        const finalResults = results.map((result, index) => {
            const account = validAssignments[index].account;
            const accountId = `${account.name}(${account.phone})`;
            
            if (result.status === 'fulfilled') {
                return result.value;
            } else {
                console.error(`💥 [${accountId}] 任务执行异常:`, result.reason);
                return {
                    accountInfo: account,
                    success: false,
                    error: `任务执行异常: ${result.reason?.message || result.reason}`,
                    usedProxy: 'unknown'
                };
            }
        });

        // 显示汇总结果
        this.displaySummary(finalResults);

        return finalResults;
    }

    /**
     * 显示执行结果汇总
     * @param {Array} results - 执行结果数组
     */
    displaySummary(results) {
        console.log('\n🎯 ================ 抢购结果汇总 ================');
        
        const successCount = results.filter(r => r.success).length;
        const failCount = results.length - successCount;
        
        console.log(`📊 总计: ${results.length} 个账户`);
        console.log(`✅ 成功: ${successCount} 个`);
        console.log(`❌ 失败: ${failCount} 个`);
        console.log(`📈 成功率: ${Math.round(successCount / results.length * 100)}%`);
        
        console.log('\n📋 详细结果:');
        results.forEach((result, index) => {
            const accountId = `${result.accountInfo.name}(${result.accountInfo.phone})`;
            const status = result.success ? '✅ 成功' : '❌ 失败';
            const message = result.success ? (result.message || '抢购成功') : result.error;
            const proxy = result.usedProxy || 'unknown';
            
            console.log(`   ${index + 1}. [${accountId}] ${status} - ${message} (代理: ${proxy})`);
        });
        
        console.log('=====================================\n');
    }
}

// 创建全局多账户执行器实例
export const multiAccountExecutor = new MultiAccountExecutor();
