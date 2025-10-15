import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { logPurchaseStart, logRequest, logResponse, logStepResult, logFinalResult, logError } from './purchase-logger.js';
import { 
    logSystemStart, 
    logStartGetTicket, 
    logGetTicketResult, 
    logStartVerifyTicket, 
    logVerifyTicketResult, 
    logStartSubmitReservation, 
    logSubmitReservationResult, 
    logTicketExpired, 
    logSimpleFinalResult, 
    logSimpleError,
    logNetworkErrorDetection
} from './simple-logger.js';
import { isNetworkError, switchProxy, resetProxySwitchCount } from './proxy-manager.js';

// 目标服务器域名
const BASE_URL = 'https://ai-smart-subsidy-backend.digitalhainan.com.cn';

/**
 * 创建带代理的axios实例
 * @param {Object} proxyInfo - 代理信息
 * @returns {Object} axios实例
 */
function createProxyAxios(proxyInfo) {
    const proxyUrl = `http://${proxyInfo.server}:${proxyInfo.port}`;
    const agent = new HttpsProxyAgent(proxyUrl);
    
    return axios.create({
        httpsAgent: agent,
        timeout: 10000,
        baseURL: BASE_URL
    });
}

// 构建一个概率函数，传入一个概率，返回一个布尔值
function getProbability(probability = 0.5) {
    return Math.random() < probability;
}

/**
 * 获取通用请求头
 * @param {Object} accountInfo - 账户信息
 * @returns {Object} 请求头
 */
function getCommonHeaders(accountInfo) {
    return {
        'authorization': `Bearer ${accountInfo.grabToken}`,
        'uid': accountInfo.accId,
        'AppPlatform': 'H5',
        'Content-Type': 'application/json',
        'Connection': 'keep-alive',
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "zh-CN,zh-Hans;q=0.9",
        "Accept": "application/json, text/plain, */*",
    };
}

/**
 * 步骤1：获取系统ticket
 * @param {Object} accountInfo - 账户信息
 * @param {Object} proxyInfo - 代理信息
 * @returns {Promise<Object>} ticket信息
 */
export async function getSystemTicket(accountInfo, proxyInfo) {
    const axiosInstance = createProxyAxios(proxyInfo);
    const headers = getCommonHeaders(accountInfo);
    const stepName = '获取系统ticket';
    const url = `${BASE_URL}/hyd-queue/core/simple/entry`;
    
    console.log('🎫 正在获取系统ticket...');
    
    // 记录简洁日志：开始获取ticket
    logStartGetTicket(accountInfo);
    
    let attemptCount = 0;
    
    while (true) {
        attemptCount++;
        
        try {
            // 记录请求日志
            logRequest(accountInfo, stepName, 'GET', url, headers, null, proxyInfo);
            
            const response = await axiosInstance.get('/hyd-queue/core/simple/entry', {
                headers
            });
            
            // if (getProbability(0.5)) {
            //     response.data = {
            //         "success": true,
            //         "code": "0",
            //         "message": null,
            //         "data": {
            //           "beginTime": "2025-07-07 10:00:00",
            //           "begin": true,
            //           "access": true,
            //           "allNums": "5000+",
            //           "ticket": "b112eb049d7a4d71b4dcfe33c64a4b82"
            //         },
            //         "extend": null,
            //         "debugMessage": "",
            //         "debugTrace": null,
            //         "requestId": "ff81eae4ea3d401b8e32a63c114a33cd.394775.17583337800690417"
            //       }
            // }

            const { success, data, message } = response.data;
            
            // 记录响应日志
            logResponse(accountInfo, stepName, response.status, response.data, success && data?.ticket, 
                       success && data?.ticket ? null : (message || 'ticket为空'));
            
            if (success && data && data.ticket) {
                console.log('✅ 成功获取ticket，开始校验...');
                
                logStepResult(accountInfo, stepName, true, `成功获取ticket: ${data.ticket}`, attemptCount);
                
                // 记录简洁日志：获取ticket成功
                logGetTicketResult(accountInfo, true, null, response.data);
                
                // 成功获取ticket后重置代理切换计数器
                resetProxySwitchCount();
                
                return {
                    success: true,
                    ticket: data.ticket,
                    data: data
                };
            }
            
            // 失败情况 - 记录简洁日志
            logGetTicketResult(accountInfo, false, message || '获取ticket失败', response.data);
            
            // 失败情况处理 - 立即重试，不显示详细信息
            
        } catch (error) {
            // 记录错误日志
            logError(accountInfo, stepName, error);
            logResponse(accountInfo, stepName, null, null, false, error.message);
            
            // 检查是否为网络错误（代理IP问题）
            const isNetErr = isNetworkError(error);
            
            // 记录网络错误检测详情到简洁日志
            logNetworkErrorDetection(accountInfo, error, isNetErr);
            
            // 记录简洁日志：错误
            logGetTicketResult(accountInfo, false, error.message);
            
            // 如果是网络错误，抛出特殊错误以触发代理切换
            if (isNetErr) {
                throw new Error(`NETWORK_ERROR: ${error.message}`);
            }
        }
    }
}

/**
 * 步骤2：校验系统ticket
 * @param {string} ticket - 系统ticket
 * @param {Object} accountInfo - 账户信息
 * @param {Object} proxyInfo - 代理信息
 * @returns {Promise<Object>} 校验结果
 */
export async function verifyTicket(ticket, accountInfo, proxyInfo) {
    const axiosInstance = createProxyAxios(proxyInfo);
    const headers = getCommonHeaders(accountInfo);
    const stepName = '校验系统ticket';
    const url = `${BASE_URL}/ai-smart-subsidy-approval/api/queue/ticket/check`;
    const requestData = { ticket };
    
    console.log('🔍 正在校验系统ticket...');
    
    // 记录简洁日志：开始校验ticket
    logStartVerifyTicket(accountInfo);
    
    let attemptCount = 0;
    
    while (true) {
        attemptCount++;
        
        try {
            // 记录请求日志
            logRequest(accountInfo, stepName, 'POST', url, headers, requestData, proxyInfo);
            
            const response = await axiosInstance.post('/ai-smart-subsidy-approval/api/queue/ticket/check', 
                requestData, 
                { headers }
            );

            // if (getProbability(0.5)) {
            //     response.data = {
            //         "success": true,
            //         "code": "0",
            //         "message": null,
            //         "data": null,
            //         "extend": null,
            //         "debugMessage": "",
            //         "debugTrace": null,
            //         "requestId": "1b209698a29e4144bbfcd12486cf0f29.568694.17583337934490799"
            //       }
            // }
            
            const { success, message } = response.data;
            
            // 记录响应日志
            logResponse(accountInfo, stepName, response.status, response.data, success, 
                       success ? null : (message || '校验失败'));
            
            if (success) {
                console.log('✅ ticket校验成功，开始提交预约...');
                logStepResult(accountInfo, stepName, true, 'ticket校验通过', attemptCount);
                
                // 记录简洁日志：校验ticket成功
                logVerifyTicketResult(accountInfo, true, null, response.data);
                
                // 成功校验ticket后重置代理切换计数器
                resetProxySwitchCount();
                
                return {
                    success: true,
                    ticket: ticket
                };
            }
            
            // 校验失败 - 记录简洁日志
            logVerifyTicketResult(accountInfo, false, message || '校验ticket失败', response.data);
            
            // 校验失败，立即重试，不显示详细信息
            
        } catch (error) {
            // 记录错误日志
            logError(accountInfo, stepName, error);
            logResponse(accountInfo, stepName, null, null, false, error.message);
            
            // 检查是否为网络错误（代理IP问题）
            const isNetErr = isNetworkError(error);
            
            // 记录网络错误检测详情到简洁日志
            logNetworkErrorDetection(accountInfo, error, isNetErr);
            
            // 记录简洁日志：错误
            logVerifyTicketResult(accountInfo, false, error.message);
            
            // 如果是网络错误，抛出特殊错误以触发代理切换
            if (isNetErr) {
                throw new Error(`NETWORK_ERROR: ${error.message}`);
            }
        }
    }
}

/**
 * 步骤3：提交预约
 * @param {string} ticket - 已校验的ticket
 * @param {Object} accountInfo - 账户信息
 * @param {Object} proxyInfo - 代理信息
 * @returns {Promise<Object>} 提交结果
 */
export async function submitReservation(ticket, accountInfo, proxyInfo) {
    const axiosInstance = createProxyAxios(proxyInfo);
    const headers = getCommonHeaders(accountInfo);
    const stepName = '提交预约申请';
    const url = `${BASE_URL}/ai-smart-subsidy-approval/api/apply/submitApply`;
    
    console.log('📋 正在提交预约申请...');
    
    // 记录简洁日志：开始提交预约
    logStartSubmitReservation(accountInfo);
    
    // 构建请求参数
    const requestData = {
        ticket: ticket,
        uniqueId: accountInfo.uniqueId,
        tourismSubsidyId: accountInfo.tourismSubsidyId
    };
    
    // 如果存在foodSubsidyId，则添加到请求中
    if (accountInfo.foodSubsidyId) {
        requestData.foodSubsidyId = accountInfo.foodSubsidyId;
    }
    
    let attemptCount = 0;
    
    while (true) {
        attemptCount++;
        
        try {
            // 记录请求日志
            logRequest(accountInfo, stepName, 'POST', url, headers, requestData, proxyInfo);
            
            const response = await axiosInstance.post('/ai-smart-subsidy-approval/api/apply/submitApply', 
                requestData, 
                { headers }
            );

            // 模拟三种情况：成功、失败、重复提交
            // const randomValue = Math.random();
            // if (randomValue < 0.4) {
            //     // 40% 概率成功
            //     response.data = {
            //         "success": true,
            //         "code": "0",
            //         "message": null,
            //         "data": null,
            //         "extend": null,
            //         "debugMessage": null,
            //         "debugTrace": null,
            //         "requestId": "dc1f845505f5480c9e05bb8461389a6f.2542039.17583339135710339"
            //     };
            // } else if (randomValue < 0.7) {
            //     // 30% 概率普通失败
            //     response.data = {
            //         "success": false,
            //         "code": "CUSTOM_ERROR",
            //         "message": "提交失败！当前旅游补贴档位暂无补贴名额，每天10点放出新名额",
            //         "data": null,
            //         "extend": null,
            //         "debugMessage": null,
            //         "debugTrace": null,
            //         "requestId": "dc1f845505f5480c9e05bb8461389a6f.2542039.17583339135710339"
            //     };
            // } else {
            //     // 30% 概率重复提交
            //     response.data = {
            //         "success": false,
            //         "code": "CUSTOM_ERROR",
            //         "message": "该用户已提交过申请，不能重复提交",
            //         "data": null,
            //         "extend": null,
            //         "debugMessage": null,
            //         "debugTrace": null,
            //         "requestId": "9dada5591d684fb9be899705141647cb.2542666.17583337961630443"
            //     };
            // }
            
            const { success, message, code } = response.data;
            
            // 记录响应日志
            logResponse(accountInfo, stepName, response.status, response.data, success, 
                       success ? null : `${message || '未知原因'} (${code || '无代码'})`);
            
            if (success) {
                console.log('🎉 预约提交成功！');
                logStepResult(accountInfo, stepName, true, '预约提交成功！', attemptCount);
                
                // 记录简洁日志：预约提交成功
                logSubmitReservationResult(accountInfo, true, null, response.data);
                
                // 成功提交预约后重置代理切换计数器
                resetProxySwitchCount();
                
                return {
                    success: true,
                    message: '提交成功！',
                    data: response.data
                };
            }
            
            // 检查是否为ticket过期错误
            if (code === 'TICKET_INVALID' || (message && (message.includes('票据无效') || message.includes('已过期')))) {
                console.log('⚠️ 检测到ticket过期，需要重新获取ticket');
                logStepResult(accountInfo, stepName, false, `ticket过期: ${message}`, attemptCount);
                
                // 记录简洁日志：ticket过期
                logSubmitReservationResult(accountInfo, false, `ticket过期: ${message}`, response.data);
                
                return {
                    success: false,
                    error: 'TICKET_EXPIRED',
                    message: message,
                    needRefreshTicket: true
                };
            }
            
            // 检查是否为重复提交错误
            if (code === 'CUSTOM_ERROR' && message && message.includes('已提交过申请')) {
                console.log('⚠️ 检测到重复提交，该账户已申请过，停止抢购');
                logStepResult(accountInfo, stepName, false, `重复提交: ${message}`, attemptCount);
                
                // 记录简洁日志：重复提交
                logSubmitReservationResult(accountInfo, false, `重复提交: ${message}`, response.data);
                
                // 抛出特殊异常以便上层处理
                const duplicateError = new Error(`DUPLICATE_SUBMISSION: ${message}`);
                duplicateError.code = code;
                duplicateError.shouldStop = true;
                duplicateError.originalData = response.data;
                throw duplicateError;
            }
            
            // 其他失败情况 - 记录简洁日志
            logSubmitReservationResult(accountInfo, false, message || '预约提交失败', response.data);
            
            // 其他失败情况，立即重试，不显示详细信息
            
        } catch (error) {
            // 记录错误日志
            logError(accountInfo, stepName, error);
            logResponse(accountInfo, stepName, null, null, false, error.message);
            
            // 检查是否为网络错误（代理IP问题）
            const isNetErr = isNetworkError(error);
            
            // 记录网络错误检测详情到简洁日志
            logNetworkErrorDetection(accountInfo, error, isNetErr);
            
            // 记录简洁日志：错误
            logSubmitReservationResult(accountInfo, false, error.message);
            
            // 如果是网络错误，抛出特殊错误以触发代理切换
            if (isNetErr) {
                throw new Error(`NETWORK_ERROR: ${error.message}`);
            }
        }
    }
}

/**
 * 带网络错误处理的请求执行器
 * @param {Function} requestFunc - 要执行的请求函数
 * @param {Object} accountInfo - 账户信息
 * @param {Object} proxyInfo - 当前代理信息
 * @param {string} stepName - 步骤名称
 * @returns {Promise<Object>} 执行结果，包含可能的新代理信息
 */
async function executeWithNetworkErrorHandling(requestFunc, accountInfo, proxyInfo, stepName) {
    let currentProxyInfo = proxyInfo;
    
    try {
        const result = await requestFunc(currentProxyInfo);
        return {
            success: true,
            result: result,
            proxyInfo: currentProxyInfo
        };
    } catch (error) {
        // 检查是否为网络错误（代理IP问题）
        const isNetErr = isNetworkError(error) || error.message?.includes('NETWORK_ERROR:');
        
        // 如果不是网络错误，记录网络错误检测详情到简洁日志
        if (!error.message?.includes('NETWORK_ERROR:')) {
            logNetworkErrorDetection(accountInfo, error, isNetErr);
        }
        
        if (isNetErr) {
            // 提取原始错误消息
            const originalMessage = error.message?.includes('NETWORK_ERROR:') 
                ? error.message.replace('NETWORK_ERROR: ', '')
                : error.message;
                
            console.log(`⚠️ 检测到网络错误 (${stepName}): ${originalMessage}`);
            logSimpleError(accountInfo, stepName, `网络错误，尝试获取新代理: ${originalMessage}`);
            
            // 尝试获取同类型新代理
            const newProxyInfo = await switchProxy(accountInfo);
            
            if (newProxyInfo) {
                console.log(`🔄 新代理获取成功，重新执行 ${stepName}...`);
                
                // 使用新代理重新执行
                try {
                    const result = await requestFunc(newProxyInfo);
                    return {
                        success: true,
                        result: result,
                        proxyInfo: newProxyInfo,
                        proxySwitched: true
                    };
                } catch (retryError) {
                    const originalRetryMessage = retryError.message?.includes('NETWORK_ERROR:') 
                        ? retryError.message.replace('NETWORK_ERROR: ', '')
                        : retryError.message;
                    console.error(`💥 使用新代理重试 ${stepName} 仍然失败:`, originalRetryMessage);
                    return {
                        success: false,
                        error: retryError,
                        proxyInfo: newProxyInfo
                    };
                }
            } else {
                console.error(`💥 无法获取到可用代理，${stepName} 执行失败`);
                return {
                    success: false,
                    error: error,
                    proxyInfo: currentProxyInfo
                };
            }
        } else {
            // 非网络错误，直接返回
            return {
                success: false,
                error: error,
                proxyInfo: currentProxyInfo
            };
        }
    }
}

/**
 * 完整的抢购流程
 * @param {Object} accountInfo - 账户信息
 * @param {Object} proxyInfo - 代理信息
 * @returns {Promise<Object>} 抢购结果
 */
export async function executePurchaseFlow(accountInfo, proxyInfo) {
    try {
        console.log('🚀 开始执行完整抢购流程...');
        console.log('👤 账户:', accountInfo.name);
        console.log('🌐 代理:', `${proxyInfo.server}:${proxyInfo.port} (${proxyInfo.source})`);
        console.log('📍 真实IP:', proxyInfo.validatedIP);
        console.log('=====================================');
        
        // 记录抢购开始日志
        logPurchaseStart(accountInfo, proxyInfo);
        
        // 记录简洁日志：系统开始
        logSystemStart(accountInfo, proxyInfo);
        
        let currentTicket = null;
        let ticketRefreshCount = 0;
        const maxTicketRefresh = 10; // 最大ticket刷新次数，防止无限循环
        let currentProxyInfo = proxyInfo; // 跟踪当前使用的代理
        
        while (ticketRefreshCount < maxTicketRefresh) {
            try {
                // 步骤1：获取系统ticket（带网络错误处理）
                console.log(`🎫 正在获取ticket (第${ticketRefreshCount + 1}次)...`);
                
                const ticketExecution = await executeWithNetworkErrorHandling(
                    async (proxy) => await getSystemTicket(accountInfo, proxy),
                    accountInfo,
                    currentProxyInfo,
                    '获取系统ticket'
                );
                
                if (!ticketExecution.success) {
                    const errorMsg = '获取系统ticket失败';
                    logFinalResult(accountInfo, false, errorMsg);
                    throw new Error(errorMsg);
                }
                
                // 更新代理信息（如果发生了切换）
                if (ticketExecution.proxySwitched) {
                    currentProxyInfo = ticketExecution.proxyInfo;
                    console.log('📍 代理已切换，新IP:', currentProxyInfo.validatedIP);
                }
                
                const ticketResult = ticketExecution.result;
                
                // 步骤2：校验ticket（带网络错误处理）
                const verifyExecution = await executeWithNetworkErrorHandling(
                    async (proxy) => await verifyTicket(ticketResult.ticket, accountInfo, proxy),
                    accountInfo,
                    currentProxyInfo,
                    '校验系统ticket'
                );
                
                if (!verifyExecution.success) {
                    const errorMsg = '校验ticket失败';
                    logFinalResult(accountInfo, false, errorMsg);
                    throw new Error(errorMsg);
                }
                
                // 更新代理信息（如果发生了切换）
                if (verifyExecution.proxySwitched) {
                    currentProxyInfo = verifyExecution.proxyInfo;
                    console.log('📍 代理已切换，新IP:', currentProxyInfo.validatedIP);
                }
                
                const verifyResult = verifyExecution.result;
                currentTicket = verifyResult.ticket;
                console.log('✅ ticket获取并校验成功，开始提交预约...');
                
                // 步骤3：提交预约（带网络错误处理，循环提交直到成功或ticket过期）
                const submitExecution = await executeWithNetworkErrorHandling(
                    async (proxy) => await submitReservation(currentTicket, accountInfo, proxy),
                    accountInfo,
                    currentProxyInfo,
                    '提交预约申请'
                );
                
                // 更新代理信息（如果发生了切换）
                if (submitExecution.proxySwitched) {
                    currentProxyInfo = submitExecution.proxyInfo;
                    console.log('📍 代理已切换，新IP:', currentProxyInfo.validatedIP);
                }
                
                const submitResult = submitExecution.success ? submitExecution.result : { 
                    success: false, 
                    error: submitExecution.error?.message || '提交失败',
                    needRefreshTicket: false
                };
                
                if (submitResult.success) {
                    console.log('🎊 抢购流程执行完成！');
                    
                    // 记录最终成功结果
                    logFinalResult(accountInfo, submitResult.success, submitResult.message, submitResult.data);
                    
                    // 记录简洁日志：最终成功结果
                    logSimpleFinalResult(accountInfo, true, submitResult.message);
                    
                    return submitResult;
                }
                
                // 检查是否需要重新获取ticket
                if (submitResult.needRefreshTicket) {
                    ticketRefreshCount++;
                    console.log(`🔄 ticket已过期，准备重新获取 (${ticketRefreshCount}/${maxTicketRefresh})`);
                    
                    // 记录简洁日志：ticket过期重新获取
                    logTicketExpired(accountInfo, ticketRefreshCount);
                    
                    if (ticketRefreshCount >= maxTicketRefresh) {
                        const errorMsg = `已达到最大ticket刷新次数 (${maxTicketRefresh})，停止尝试`;
                        console.error('💥', errorMsg);
                        logFinalResult(accountInfo, false, errorMsg);
                        
                        // 记录简洁日志：最终失败结果
                        logSimpleFinalResult(accountInfo, false, errorMsg);
                        
                        return {
                            success: false,
                            error: errorMsg
                        };
                    }
                    
                    // 立即重新获取ticket，无需等待
                    console.log('🔄 立即重新获取ticket...');
                    continue; // 重新开始整个流程
                } else {
                    // 其他类型的失败
                    logFinalResult(accountInfo, false, submitResult.error || submitResult.message);
                    
                    // 记录简洁日志：最终失败结果
                    logSimpleFinalResult(accountInfo, false, submitResult.error || submitResult.message);
                    
                    return submitResult;
                }
                
            } catch (error) {
                // 如果是在ticket获取或校验阶段失败，直接抛出
                throw error;
            }
        }
        
        // 如果到这里说明超过了最大刷新次数
        const errorMsg = `超过最大ticket刷新次数 (${maxTicketRefresh})`;
        logFinalResult(accountInfo, false, errorMsg);
        
        // 记录简洁日志：最终失败结果
        logSimpleFinalResult(accountInfo, false, errorMsg);
        
        return {
            success: false,
            error: errorMsg
        };
        
    } catch (error) {
        console.error('💥 抢购流程执行失败:', error.message);
        
        // 记录最终失败结果
        logFinalResult(accountInfo, false, error.message);
        logError(accountInfo, '完整抢购流程', error);
        
        // 记录简洁日志：最终失败结果
        logSimpleFinalResult(accountInfo, false, error.message);
        
        return {
            success: false,
            error: error.message
        };
    }
} 