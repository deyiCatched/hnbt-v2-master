// purchase.js - 抢购函数模块
// 注意：代理IP检测已移至独立模块 proxy-test.js，主函数中已验证代理可用性

import { executePurchaseFlow } from './purchase-flow.js';

/**
 * 抢购函数
 * @param {Object} accountInfo - 账号信息
 * @param {string} accountInfo.name - 姓名
 * @param {string} accountInfo.phone - 手机号
 * @param {string} accountInfo.accId - 账号ID
 * @param {string} accountInfo.grabToken - 抢购令牌
 * @param {string} accountInfo.uniqueId - 唯一ID
 * @param {number} accountInfo.tourismSubsidyId - 旅游补贴ID
 * @param {number} accountInfo.foodSubsidyId - 餐饮补贴ID
 * @param {Object} proxyInfo - 已验证的代理信息
 * @param {string} proxyInfo.server - 代理服务器地址
 * @param {number} proxyInfo.port - 代理端口
 * @param {string} proxyInfo.source - 代理来源
 * @param {string} proxyInfo.validatedIP - 已验证的真实IP地址
 */
export async function purchaseFunction(accountInfo, proxyInfo) {
    try {
        console.log('=== 开始抢购流程 ===');
        console.log('账号信息:', {
            name: accountInfo.name,
            phone: accountInfo.phone,
            uniqueId: accountInfo.uniqueId
        });
        console.log('代理信息:', `${proxyInfo.server}:${proxyInfo.port} (${proxyInfo.source})`);
        console.log('验证IP:', proxyInfo.validatedIP);

        // 代理IP已在主函数中验证通过，直接使用
        console.log('✅ 使用已验证的代理IP:', proxyInfo.validatedIP);

        // 执行真正的抢购流程
        console.log('🎯 开始执行抢购业务逻辑...');
        const purchaseResult = await executePurchaseFlow(accountInfo, proxyInfo);

        if (purchaseResult.success) {
            console.log('🎉 抢购成功！');
            return {
                success: true,
                message: purchaseResult.message || '抢购成功！',
                usedProxy: `${proxyInfo.server}:${proxyInfo.port}`,
                realIP: proxyInfo.validatedIP,
                data: purchaseResult.data
            };
        } else {
            console.error('💥 抢购失败:', purchaseResult.error);
            return {
                success: false,
                error: purchaseResult.error,
                usedProxy: `${proxyInfo.server}:${proxyInfo.port}`,
                realIP: proxyInfo.validatedIP
            };
        }

    } catch (error) {
        console.error('抢购过程中发生错误:', error.message);
        return { success: false, error: error.message };
    }
} 