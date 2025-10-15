// xiaomi-query.js - 小米查券功能模块
// 基于 /mtop/navi/venue/batch 接口

import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import crypto from 'crypto';
import fs from 'fs';
import { notificationService } from './notification.js';

/**
 * 小米查券服务
 */
class XiaomiQueryService {
    constructor(mode = 'direct', proxyType = 1) {
        this.baseURL = 'https://shop-api.retail.mi.com';
        this.endpoint = '/mtop/navi/venue/batch';
        this.mode = mode; // 'direct' 或 'proxy'
        this.proxyType = proxyType;
        
        console.log(`🔧 初始化查券服务 - 模式: ${mode === 'direct' ? '直连模式' : '代理模式'}`);
    }

    /**
     * 生成MD5签名（常见的sign生成方式）
     * @param {string} data - 要签名的数据
     * @returns {string} MD5签名
     */
    generateMD5Sign(data) {
        return crypto.createHash('md5').update(data).digest('hex');
    }

    /**
     * 生成URL sign（根据regionId动态选择）
     * @param {Object} accountInfo - 账户信息
     * @returns {string} URL签名
     */
    generateURLSign(accountInfo) {
        const regionId = parseInt(accountInfo.regionId) || 10;
        
        // 根据regionId选择对应的URL sign
        switch (regionId) {
            case 10: // 重庆地区
                return '90e09b8480a4bc8302049ada1dca46bb';
            case 14: // 山西地区
                return '56f1d49f6f29c469a071c6f52f1361ca';
            case 23: // 福建地区
                return '5527b8bbd5c3485ce1f15732da35bcda';
            default:
                console.log(`⚠️ 未知的regionId: ${regionId}，使用重庆地区默认签名`);
                return '90e09b8480a4bc8302049ada1dca46bb';
        }
    }

    /**
     * 生成请求体sign（根据regionId动态选择）
     * @param {string} parameter - 参数字符串
     * @param {Object} accountInfo - 账户信息
     * @returns {string} 请求体签名
     */
    generateBodySign(parameter, accountInfo) {
        const regionId = parseInt(accountInfo.regionId) || 10;
        
        // 根据regionId选择对应的Body sign
        switch (regionId) {
            case 10: // 重庆地区
                return 'f1c5371f709221a9f6f99258cc0bf406';
            case 14: // 山西地区
                return 'e57961b5d0b02606aa3f9b53d93f558a';
            case 23: // 福建地区
                return '27bc8147025fe8db0db421fc1024dff4';
            default:
                console.log(`⚠️ 未知的regionId: ${regionId}，使用重庆地区默认签名`);
                return 'f1c5371f709221a9f6f99258cc0bf406';
        }
    }

    /**
     * 创建查券请求配置
     * @param {Object} accountInfo - 账户信息
     * @param {Object} proxyInfo - 代理信息
     * @returns {Object} axios配置
     */
    createQueryConfig(accountInfo, proxyInfo) {
        const regionId = parseInt(accountInfo.regionId) || 10;
        
        // 根据地区构建不同的参数
        let paramsArray;
        let cateCodes;
        let pageId;
        
        if (regionId === 14) {
            // 山西地区：使用空数组和特定的cateCodes
            paramsArray = [];
            cateCodes = ["B01", "B02", "B03", "A01", "A02", "A03", "A0401", "A0402", "A0403", "A05", "A06", "A07", "A08", "A09", "A12", "A10", "A11"];
            pageId = "16408";
        } else if (regionId === 23) {
            // 福建地区：使用空数组和特定的cateCodes
            paramsArray = [];
            cateCodes = ["B01", "B02", "B03", "A0401", "A0402", "A0403", "A01", "A02", "A03", "A05", "A06", "A07", "A08", "A12", "A09", "A10", "A11"];
            pageId = "16421";
        } else {
            // 重庆地区：使用原有的参数结构
            paramsArray = [{
                needQualify: true,
                paymentMode: accountInfo.paymentMode || "UNIONPAY",
                cateCodes: ["B01", "B02", "B03"]
            }];
            cateCodes = ["B01", "B02", "A05", "B03", "A01", "A02", "A03", "A06", "A07", "A08", "A09", "A10", "A11", "A12", "A0401"];
            pageId = "16434";
        }
        
        // 构建查询参数
        const parameter = JSON.stringify({
            needQualify: true,
            cateCodes: cateCodes,
            regionId: regionId,
            activityCategory: parseInt(accountInfo.activityCategory) || 100,
            activityRuleEwenId: accountInfo.activityRuleEwenId || "139o9a",
            params: paramsArray
        });

        // 生成签名
        const urlSign = this.generateURLSign(accountInfo);
        const bodySign = this.generateBodySign(parameter, accountInfo);

        // 显示地区信息
        let regionName;
        switch (regionId) {
            case 10:
                regionName = '重庆地区';
                break;
            case 14:
                regionName = '山西地区';
                break;
            case 23:
                regionName = '福建地区';
                break;
            default:
                regionName = '未知地区';
        }
        
        console.log(`🌍 查券地区: ${regionName} (regionId: ${regionId})`);
        console.log(`🔐 URL Sign: ${urlSign}`);
        console.log(`🔐 Body Sign: ${bodySign}`);
        console.log(`📋 Params: ${JSON.stringify(paramsArray)}`);
        console.log(`📄 Page ID: ${pageId}`);

        // 构建URL
        const url = `${this.baseURL}${this.endpoint}?page_id=${pageId}&pdl=mishop&sign=${urlSign}&_r=20373`;

        const config = {
            method: 'POST',
            url: url,
            headers: {
                'Host': 'shop-api.retail.mi.com',
                'equipmenttype': '2',
                'x-user-agent': 'channel/mishop platform/mishop.ios',
                'baggage': accountInfo.baggage || 'sentry-environment=RELEASE,sentry-public_key=ee0a98b8e8e3417c89db4f9fd258ef62,sentry-release=com.xiaomi.mishop%405.2.257%2B2509112112,sentry-sample_rate=1,sentry-trace_id=18902825b3de41298feec81026888370,sentry-transaction=MSNewMainViewController',
                'Accept': '*/*',
                'd-id': accountInfo.dId || 'OXBJOW5jM2cyZDd2bUh2TTJncDFHS0pCTFl3SUx1QUhEcXFMRytRN2x6aURaK3NSVXV2aHZmUGR6UWtoWDhIUg==',
                'sentry-trace': accountInfo.sentryTrace || '18902825b3de41298feec81026888370-b1639d4ee0eb406f-1',
                'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Content-Type': 'application/json',
                'User-Agent': 'MiShop/2509112112 CFNetwork/3826.600.41 Darwin/24.6.0',
                'Connection': 'keep-alive',
                'Cookie': `mishop_dSid=${accountInfo.mishop_dSid || ''}; mishop_dToken=${accountInfo.mishop_dToken || ''}; userId=${accountInfo.userId}; serviceToken=${accountInfo.serviceToken}; xmUuid=${accountInfo.xmUuid || 'XMGUEST-C2BD987F-601B-43D8-AD78-53EA70BC4634'}`,
                'd-model': accountInfo.dModel || 'aVBob25lMTcsMQ=='
            },
            data: {
                query_list: [{
                    resolver: "verify",
                    sign: bodySign,
                    parameter: parameter,
                    variable: {}
                }]
            },
            timeout: 30000
        };

        // 根据模式决定是否使用代理
        if (this.mode === 'proxy' && proxyInfo && proxyInfo.server && proxyInfo.server !== 'placeholder') {
            const proxyUrl = `http://${proxyInfo.server}:${proxyInfo.port}`;
            config.httpsAgent = new HttpsProxyAgent(proxyUrl);
            config.httpAgent = new HttpsProxyAgent(proxyUrl);
            console.log(`🌐 使用代理查券: ${proxyInfo.server}:${proxyInfo.port}`);
        } else {
            console.log(`🔗 使用直连模式查券`);
        }

        return config;
    }

    /**
     * 执行查券请求
     * @param {Object} accountInfo - 账户信息
     * @param {Object} proxyInfo - 代理信息
     * @returns {Promise<Object>} 查券结果
     */
    async queryCoupons(accountInfo, proxyInfo = null) {
        const startTime = Date.now();
        
        try {
            console.log(`🔍 开始为账户 ${accountInfo.name}(${accountInfo.phone}) 查询券信息...`);
            
            const config = this.createQueryConfig(accountInfo, proxyInfo);
            const response = await axios(config);

            const duration = Date.now() - startTime;

            const result = {
                success: true,
                account: accountInfo,
                proxy: proxyInfo,
                response: response.data,
                duration: duration,
                timestamp: new Date().toISOString()
            };

            // 分析查券结果
            this.analyzeQueryResult(result);

            // 记录查券日志
            this.saveQueryLog(result);

            return result;

        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`💥 账户 ${accountInfo.name} 查券失败:`, error.message);

            const result = {
                success: false,
                account: accountInfo,
                proxy: proxyInfo,
                error: error.message,
                duration: duration,
                timestamp: new Date().toISOString()
            };

            // 记录查券日志
            this.saveQueryLog(result);

            return result;
        }
    }

    /**
     * 分析查券结果
     * @param {Object} result - 查券结果
     */
    analyzeQueryResult(result) {
        if (result.response && result.response.data) {
            const data = result.response.data;
            
            // 检查响应码
            if (result.response.code === 0 && data.result_list) {
                const resultList = data.result_list;
                
                if (resultList.length > 0) {
                    const userResult = resultList[0];
                    const cates = userResult.cates || [];
                    
                    // 分析各种状态的券
                    const availableCoupons = cates.filter(cate => cate.statusCode === 0); // 尚未领取资格
                    const takenCoupons = cates.filter(cate => cate.statusCode === 2); // 已被领取
                    const otherStatusCoupons = cates.filter(cate => cate.statusCode !== 0 && cate.statusCode !== 2);
                    
                    result.availableCoupons = availableCoupons.length;
                    result.takenCoupons = takenCoupons.length;
                    result.otherStatusCoupons = otherStatusCoupons.length;
                    result.couponDetails = cates;
                    
                    // 显示查券结果
                    console.log(`📋 账户 ${result.account.name} 查券结果:`);
                    console.log(`   🟢 可领取券: ${availableCoupons.length} 个`);
                    console.log(`   🔴 已被领取: ${takenCoupons.length} 个`);
                    console.log(`   ⚪ 其他状态: ${otherStatusCoupons.length} 个`);
                    
                    // 重点关注已领取的券
                    if (takenCoupons.length > 0) {
                        console.log(`\n🎯 已领取优惠券详情:`);
                        takenCoupons.forEach((coupon, index) => {
                            console.log(`   ${index + 1}. 📱 账户: ${result.account.name} (${result.account.phone})`);
                            console.log(`      🏷️ 券类型: ${coupon.cateName} (${coupon.cateCode})`);
                            console.log(`      💳 支付方式: ${coupon.paymentMode}`);
                            console.log(`      📝 状态描述: ${coupon.statusDesc}`);
                            console.log(`      🖼️ 图标: ${coupon.imgUrl}`);
                            console.log(`      ⏰ 查询时间: ${new Date().toLocaleString('zh-CN')}`);
                            console.log(`      ---`);
                        });
                    }
                    
                    // 显示其他券的状态（简要信息）
                    if (availableCoupons.length > 0) {
                        console.log(`\n🟢 可领取券:`);
                        availableCoupons.forEach(coupon => {
                            console.log(`   - ${coupon.cateName}(${coupon.cateCode}): ${coupon.statusDesc}`);
                        });
                    }
                    
                    if (otherStatusCoupons.length > 0) {
                        console.log(`\n⚪ 其他状态券:`);
                        otherStatusCoupons.forEach(coupon => {
                            console.log(`   - ${coupon.cateName}(${coupon.cateCode}): ${coupon.statusDesc}`);
                        });
                    }
                } else {
                    result.availableCoupons = 0;
                    result.couponDetails = [];
                    console.log(`📋 账户 ${result.account.name}: 暂无券信息`);
                }
            } else {
                result.availableCoupons = 0;
                result.couponDetails = [];
                console.log(`❌ 账户 ${result.account.name}: 查券失败 - ${result.response.message || '未知错误'}`);
            }
        }
    }

    /**
     * 发送查券成功推送通知
     * @param {Object} accountInfo - 账户信息
     * @param {number} couponCount - 可用券数量
     */
    async sendQuerySuccessNotification(accountInfo, couponCount) {
        try {
            const pushMessage = `${accountInfo.name}-${accountInfo.phone} 发现${couponCount}个可用券`;
            console.log(`📱 发送查券成功推送: ${pushMessage}`);
            
            // 调用推送服务
            await notificationService.sendXiaomiSuccessNotification(accountInfo, pushMessage);
        } catch (error) {
            console.error(`💥 查券推送通知发送失败:`, error.message);
        }
    }

    /**
     * 保存查券日志
     * @param {Object} result - 查券结果
     */
    saveQueryLog(result) {
        try {
            const logDir = 'simple-logs';
            
            // 确保目录存在
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            
            if (result.account) {
                const account = result.account;
                const filename = `${account.name}-${account.phone}-query.txt`;
                const filepath = `${logDir}/${filename}`;
                
                // 创建查券日志内容
                const logContent = this.createQueryLogContent(result);
                
                // 写入文件（追加模式）
                fs.appendFileSync(filepath, logContent, 'utf8');
                console.log(`📝 查券日志已保存: ${filename}`);
            }
        } catch (error) {
            console.error('💥 保存查券日志失败:', error.message);
        }
    }

    /**
     * 创建查券日志内容
     * @param {Object} result - 查券结果
     * @returns {string} 日志内容
     */
    createQueryLogContent(result) {
        const timestamp = new Date().toISOString();
        const account = result.account;
        
        let logContent = '';
        logContent += `========================================\n`;
        logContent += `小米查券日志 - ${account.name} (${account.phone})\n`;
        logContent += `========================================\n`;
        logContent += `时间: ${timestamp}\n`;
        logContent += `账户: ${account.name}\n`;
        logContent += `手机: ${account.phone}\n`;
        logContent += `用户ID: ${account.userId || 'N/A'}\n`;
        logContent += `\n`;
        
        // 请求信息
        logContent += `📡 请求信息:\n`;
        if (result.proxy && result.proxy.server && result.proxy.server !== 'placeholder') {
            logContent += `   连接模式: 代理模式\n`;
            logContent += `   代理: ${result.proxy.server}:${result.proxy.port}\n`;
        } else {
            logContent += `   连接模式: 直连模式\n`;
        }
        if (result.duration) {
            logContent += `   请求耗时: ${result.duration}ms\n`;
        }
        logContent += `\n`;
        
        // 结果信息
        logContent += `📊 查券结果:\n`;
        logContent += `   状态: ${result.success ? '✅ 成功' : '❌ 失败'}\n`;
        if (result.availableCoupons !== undefined) {
            logContent += `   可用券数量: ${result.availableCoupons}\n`;
        }
        if (result.error) {
            logContent += `   错误信息: ${result.error}\n`;
        }
        logContent += `\n`;
        
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
     * 批量查券
     * @param {Array} accounts - 账户列表
     * @param {Array} proxyList - 代理列表
     * @param {string} targetPhone - 目标手机号（可选，用于查询指定用户）
     * @returns {Promise<Array>} 查券结果列表
     */
    async batchQuery(accounts, proxyList = [], targetPhone = null) {
        // 根据手机号过滤账户
        let targetAccounts = accounts;
        if (targetPhone) {
            targetAccounts = accounts.filter(account => account.phone === targetPhone);
            if (targetAccounts.length === 0) {
                console.log(`❌ 未找到手机号为 ${targetPhone} 的账户`);
                return [];
            }
            console.log(`🎯 查询指定用户: ${targetAccounts[0].name} (${targetPhone})`);
        }
        
        console.log(`🚀 开始批量查券，账户数量: ${targetAccounts.length}`);
        
        const results = [];
        
        for (let i = 0; i < targetAccounts.length; i++) {
            const account = targetAccounts[i];
            const proxy = this.mode === 'proxy' && proxyList[i] ? proxyList[i] : null;
            
            console.log(`\n📋 查券进度: ${i + 1}/${targetAccounts.length} - ${account.name}`);
            
            const result = await this.queryCoupons(account, proxy);
            results.push(result);
            
            // 账户间延迟
            if (i < targetAccounts.length - 1) {
                console.log(`⏳ 账户间延迟 2 秒...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        // 打印查券统计
        this.printQueryStatistics(results);
        
        return results;
    }

    /**
     * 打印查券统计信息
     * @param {Array} results - 查券结果列表
     */
    printQueryStatistics(results) {
        const total = results.length;
        const success = results.filter(r => r.success).length;
        const failed = total - success;
        const totalAvailableCoupons = results.reduce((sum, r) => sum + (r.availableCoupons || 0), 0);
        const totalTakenCoupons = results.reduce((sum, r) => sum + (r.takenCoupons || 0), 0);
        
        console.log('\n📊 查券统计:');
        console.log(`   总查询数: ${total}`);
        console.log(`   成功数: ${success}`);
        console.log(`   失败数: ${failed}`);
        console.log(`   总可用券: ${totalAvailableCoupons}`);
        console.log(`   总已领取券: ${totalTakenCoupons}`);
        
        // 重点关注已领取券的账户
        const accountsWithTakenCoupons = results.filter(r => r.takenCoupons > 0);
        if (accountsWithTakenCoupons.length > 0) {
            console.log('\n🎯 已领取券的账户:');
            accountsWithTakenCoupons.forEach(result => {
                console.log(`   ✅ ${result.account.name} (${result.account.phone}): ${result.takenCoupons}个已领取券`);
            });
        }
        
        // 显示有可用券的账户
        const accountsWithAvailableCoupons = results.filter(r => r.availableCoupons > 0);
        if (accountsWithAvailableCoupons.length > 0) {
            console.log('\n🎉 有可用券的账户:');
            accountsWithAvailableCoupons.forEach(result => {
                console.log(`   🟢 ${result.account.name} (${result.account.phone}): ${result.availableCoupons}个可用券`);
            });
        }
    }
}

// 导出类和函数
export { XiaomiQueryService };

// 如果直接运行此文件
if (process.argv[1] === new URL(import.meta.url).pathname) {
    // 示例用法
    console.log('🔍 小米查券服务启动');
    
    const queryService = new XiaomiQueryService('direct');
    
    // 示例账户信息
    const sampleAccount = {
        name: '测试账户',
        phone: '13800138000',
        userId: '2843350322',
        serviceToken: 'your_service_token_here',
        dId: 'OXBJOW5jM2cyZDd2bUh2TTJncDFHS0pCTFl3SUx1QUhEcXFMRytRN2x6aURaK3NSVXV2aHZmUGR6UWtoWDhIUg==',
        dModel: 'aVBob25lMTcsMQ==',
        regionId: 10,
        activityCategory: 100,
        cateCode: 'B01',
        paymentMode: 'UNIONPAY'
    };
    
    // 执行查券
    queryService.queryCoupons(sampleAccount);
}
