// 真实环境双接口抢购频繁率监控脚本
import { XiaomiSubsidyAcquirer } from './xiaomi.js';
import axios from 'axios';

/**
 * 在线用户信息获取配置
 */
const ONLINE_API_CONFIG = {
    baseURL: 'http://8.148.75.17:3000',
    endpoint: '/api/purchase/records',
    defaultLimit: 20
};

/**
 * 地区映射配置
 */
const REGION_MAP = {
    'cq': { name: '重庆', regionId: '10' },
    'yn': { name: '云南', regionId: '21' },
    'fj': { name: '福建', regionId: '23' }
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
 * 检查是否触发频繁
 * @param {Object} responseData - 响应数据
 * @returns {boolean} 是否触发频繁
 */
function isFrequencyTriggered(responseData) {
    if (!responseData || !responseData.data) return false;
    const tips = responseData.data.tips || '';
    return tips.includes('资格数量有限，领取失败');
}

/**
 * 提取关键信息
 * @param {Object} responseData - 响应数据
 * @returns {string} 关键信息
 */
function extractKeyInfo(responseData) {
    if (!responseData) return '无响应';
    const tips = responseData.data?.tips || '';
    const message = responseData.message || '';
    if (tips) return tips;
    if (message) return message;
    return responseData.code === 0 ? '成功' : `错误码: ${responseData.code}`;
}

/**
 * 执行多账户双接口抢购监控
 * @param {Array} accounts - 账户信息列表
 * @param {number} maxRequests - 每个账户最大请求次数
 * @param {number} intervalMs - 请求间隔（毫秒）
 * @param {string} region - 地区筛选
 */
async function monitorDualApiFrequency(accounts, maxRequests = 3, intervalMs = 2000, region = 'cq') {
    console.log('🔍 多账户双接口抢购频繁率监控启动');
    console.log('📋 监控配置:');
    console.log(`   总账户数: ${accounts.length}`);
    console.log(`   地区筛选: ${REGION_MAP[region]?.name || '重庆'} (${region})`);
    console.log('   频繁判断: 包含"资格数量有限，领取失败"');
    console.log(`   每账户监控次数: ${maxRequests}次`);
    console.log(`   请求间隔: ${intervalMs}ms`);
    
    // 根据地区筛选账户
    const filteredAccounts = accounts.filter(account => account.regionId === REGION_MAP[region]?.regionId);
    console.log(`   筛选后账户数: ${filteredAccounts.length}`);
    
    if (filteredAccounts.length === 0) {
        console.log('❌ 没有找到匹配地区的账户，监控结束');
        return;
    }
    
    console.log('\n🔄 开始多账户监控...\n');
    
    // 全局统计信息
    let totalRequests = 0;
    let totalFrequencyCount = 0;
    let totalOriginalFrequencyCount = 0;
    let totalNewFrequencyCount = 0;
    let totalSuccessCount = 0;
    let totalOriginalSuccessCount = 0;
    let totalNewSuccessCount = 0;
    let accountResults = [];
    
    // 创建抢购器实例
    const acquirer = new XiaomiSubsidyAcquirer('direct', 1);
    
    // 遍历每个账户进行监控
    for (let accountIndex = 0; accountIndex < filteredAccounts.length; accountIndex++) {
        const account = filteredAccounts[accountIndex];
        console.log(`\n=== 账户 ${accountIndex + 1}/${filteredAccounts.length}: ${account.name} (${account.phone}) ===`);
        console.log(`   产品: ${account.cateCode}, 地区: ${getRegionNameByRegionId(account.regionId)}`);
        
        // 单个账户统计
        let accountRequests = 0;
        let accountFrequencyCount = 0;
        let accountOriginalFrequencyCount = 0;
        let accountNewFrequencyCount = 0;
        let accountSuccessCount = 0;
        let accountOriginalSuccessCount = 0;
        let accountNewSuccessCount = 0;
        
        // 对当前账户执行多次请求
        for (let i = 1; i <= maxRequests; i++) {
            console.log(`--- 账户 ${account.name} 请求 ${i}/${maxRequests} ---`);
            
            try {
                const startTime = Date.now();
                const currentTime = new Date().toLocaleTimeString();
                
                // 执行双接口抢购
                const result = await acquirer.executeSingleRequest(account, null, i);
                
                // 分析结果
                const originalResult = result.originalResult;
                const newResult = result.newResult;
                
                // 检查频繁触发
                const originalFrequency = originalResult ? isFrequencyTriggered(originalResult) : false;
                const newFrequency = newResult ? isFrequencyTriggered(newResult) : false;
                
                // 更新统计
                accountRequests++;
                totalRequests++;
                if (result.success) {
                    accountSuccessCount++;
                    totalSuccessCount++;
                }
                if (result.originalSuccess) {
                    accountOriginalSuccessCount++;
                    totalOriginalSuccessCount++;
                }
                if (result.newSuccess) {
                    accountNewSuccessCount++;
                    totalNewSuccessCount++;
                }
                if (originalFrequency) {
                    accountOriginalFrequencyCount++;
                    totalOriginalFrequencyCount++;
                }
                if (newFrequency) {
                    accountNewFrequencyCount++;
                    totalNewFrequencyCount++;
                }
                if (originalFrequency || newFrequency) {
                    accountFrequencyCount++;
                    totalFrequencyCount++;
                }
                
                // 输出关键日志
                const successApi = result.originalSuccess ? '原接口' : result.newSuccess ? '新接口' : '无';
                const frequencyFlag = (originalFrequency || newFrequency) ? ' 🔥频繁' : '';
                
                console.log(`${currentTime} ${result.success ? '✅' : '❌'} ${account.name}: ${successApi}成功${frequencyFlag}`);
                
                if (originalFrequency || newFrequency) {
                    console.log(`   🔥 频繁触发 - 原接口: ${originalFrequency ? '是' : '否'}, 新接口: ${newFrequency ? '是' : '否'}`);
                }
                
                console.log(`   📝 原接口: ${originalResult ? extractKeyInfo(originalResult) : '无响应'}`);
                console.log(`   📝 新接口: ${newResult ? extractKeyInfo(newResult) : '无响应'}`);
                console.log(`   ⏱️  耗时: ${Date.now() - startTime}ms`);
                console.log(`   🔧 使用: ${result.apiUsed}`);
                
                // 输出实时统计
                const frequencyRate = ((accountFrequencyCount / accountRequests) * 100).toFixed(1);
                const originalFreqRate = ((accountOriginalFrequencyCount / accountRequests) * 100).toFixed(1);
                const newFreqRate = ((accountNewFrequencyCount / accountRequests) * 100).toFixed(1);
                const successRate = ((accountSuccessCount / accountRequests) * 100).toFixed(1);
                
                console.log(`   📊 成功率: ${successRate}%, 频繁率: ${frequencyRate}% (原接口: ${originalFreqRate}%, 新接口: ${newFreqRate}%)`);
                
            } catch (error) {
                console.error(`❌ 账户 ${account.name} 请求 ${i} 失败:`, error.message);
            }
            
            // 请求间隔
            if (i < maxRequests) {
                console.log(`⏳ 等待${intervalMs/1000}秒...`);
                await new Promise(resolve => setTimeout(resolve, intervalMs));
            }
        }
        
        // 记录账户结果
        accountResults.push({
            account: account,
            requests: accountRequests,
            successCount: accountSuccessCount,
            frequencyCount: accountFrequencyCount,
            originalFrequencyCount: accountOriginalFrequencyCount,
            newFrequencyCount: accountNewFrequencyCount,
            successRate: ((accountSuccessCount / accountRequests) * 100).toFixed(1),
            frequencyRate: ((accountFrequencyCount / accountRequests) * 100).toFixed(1)
        });
        
        console.log(`\n📊 账户 ${account.name} 统计:`);
        console.log(`   请求数: ${accountRequests}`);
        console.log(`   成功数: ${accountSuccessCount} (${((accountSuccessCount/accountRequests)*100).toFixed(1)}%)`);
        console.log(`   频繁数: ${accountFrequencyCount} (${((accountFrequencyCount/accountRequests)*100).toFixed(1)}%)`);
        console.log(`   原接口频繁: ${accountOriginalFrequencyCount} (${((accountOriginalFrequencyCount/accountRequests)*100).toFixed(1)}%)`);
        console.log(`   新接口频繁: ${accountNewFrequencyCount} (${((accountNewFrequencyCount/accountRequests)*100).toFixed(1)}%)`);
        
        // 账户间间隔
        if (accountIndex < filteredAccounts.length - 1) {
            console.log(`⏳ 等待3秒后处理下一个账户...\n`);
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
    
    // 输出全局统计结果
    console.log('\n📊 全局统计结果:');
    console.log('='.repeat(60));
    console.log(`总账户数: ${filteredAccounts.length}`);
    console.log(`总请求数: ${totalRequests}`);
    console.log(`总成功数: ${totalSuccessCount} (${((totalSuccessCount/totalRequests)*100).toFixed(1)}%)`);
    console.log(`原接口成功: ${totalOriginalSuccessCount} (${((totalOriginalSuccessCount/totalRequests)*100).toFixed(1)}%)`);
    console.log(`新接口成功: ${totalNewSuccessCount} (${((totalNewSuccessCount/totalRequests)*100).toFixed(1)}%)`);
    console.log(`总频繁触发: ${totalFrequencyCount} (${((totalFrequencyCount/totalRequests)*100).toFixed(1)}%)`);
    console.log(`原接口频繁: ${totalOriginalFrequencyCount} (${((totalOriginalFrequencyCount/totalRequests)*100).toFixed(1)}%)`);
    console.log(`新接口频繁: ${totalNewFrequencyCount} (${((totalNewFrequencyCount/totalRequests)*100).toFixed(1)}%)`);
    
    // 账户详细统计
    console.log('\n📋 各账户详细统计:');
    accountResults.forEach((result, index) => {
        console.log(`${index + 1}. ${result.account.name} (${result.account.phone})`);
        console.log(`   成功率: ${result.successRate}%, 频繁率: ${result.frequencyRate}%`);
        console.log(`   原接口频繁: ${result.originalFrequencyCount}, 新接口频繁: ${result.newFrequencyCount}`);
    });
    
    // 分析结果
    console.log('\n💡 分析结果:');
    if (totalFrequencyCount > 0) {
        console.log(`⚠️  检测到${totalFrequencyCount}次频繁触发，建议:`);
        console.log('   1. 增加请求间隔时间');
        console.log('   2. 使用代理IP轮换');
        console.log('   3. 分散请求时间点');
        console.log('   4. 监控双接口的频繁率差异');
        
        if (totalOriginalFrequencyCount > totalNewFrequencyCount) {
            console.log('   5. 原接口频繁率更高，建议优先使用新接口');
        } else if (totalNewFrequencyCount > totalOriginalFrequencyCount) {
            console.log('   5. 新接口频繁率更高，建议优先使用原接口');
        } else {
            console.log('   5. 两个接口频繁率相当，建议均衡使用');
        }
    } else {
        console.log('✅ 未检测到频繁触发，当前配置正常');
    }
    
    // 双接口效果分析
    const dualApiSuccessRate = ((totalOriginalSuccessCount + totalNewSuccessCount - (totalOriginalSuccessCount && totalNewSuccessCount ? 1 : 0)) / totalRequests * 100).toFixed(1);
    console.log(`\n🎯 双接口抢购效果:`);
    console.log(`双接口成功率: ${dualApiSuccessRate}%`);
    console.log(`原接口成功率: ${((totalOriginalSuccessCount/totalRequests)*100).toFixed(1)}%`);
    console.log(`新接口成功率: ${((totalNewSuccessCount/totalRequests)*100).toFixed(1)}%`);
    
    if (totalOriginalSuccessCount > 0 && totalNewSuccessCount > 0) {
        console.log('✅ 双接口互补效果良好');
    } else if (totalOriginalSuccessCount > 0 || totalNewSuccessCount > 0) {
        console.log('⚠️  只有一个接口成功，建议检查另一个接口');
    } else {
        console.log('❌ 两个接口都未成功，建议检查账户配置');
    }
}

// 导出监控函数
export { monitorDualApiFrequency };

// 如果直接运行此文件，从在线API获取真实用户信息进行测试
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith('real-frequency-monitor.js')) {
    console.log('🚀 启动真实环境双接口抢购频繁率监控');
    console.log('🌐 从在线API获取真实用户信息...');
    
    try {
        // 从在线API获取真实用户信息
        const accounts = await fetchOnlineUserAccounts(1, 10); // 获取前10个用户
        
        if (!accounts || accounts.length === 0) {
            console.error('❌ 未获取到任何用户账户信息，监控结束');
            process.exit(1);
        }
        
        console.log(`✅ 成功获取 ${accounts.length} 个真实用户账户`);
        
        // 解析命令行参数
        const args = process.argv.slice(2);
        let maxRequests = 3; // 默认每个账户3次请求
        let intervalMs = 2000; // 默认2秒间隔
        let region = 'cq'; // 默认重庆地区
        
        for (let i = 0; i < args.length; i++) {
            if (args[i] === '--requests' && i + 1 < args.length) {
                maxRequests = parseInt(args[i + 1]);
            } else if (args[i] === '--interval' && i + 1 < args.length) {
                intervalMs = parseInt(args[i + 1]);
            } else if (args[i] === '--region' && i + 1 < args.length) {
                region = args[i + 1];
            } else if (args[i] === '--help' || args[i] === '-h') {
                console.log(`
🔍 双接口抢购频繁率监控脚本

📋 用法:
  node real-frequency-monitor.js [选项]

🔧 可用选项:
  --requests <次数>    每个账户请求次数 [默认: 3]
  --interval <毫秒>    请求间隔时间 [默认: 2000]
  --region <地区>      地区筛选: cq(重庆) yn(云南) fj(福建) [默认: cq]
  --help, -h           显示此帮助信息

📚 使用示例:
  # 默认配置（重庆地区，每账户3次请求，2秒间隔）
  node real-frequency-monitor.js
  
  # 云南地区，每账户5次请求，3秒间隔
  node real-frequency-monitor.js --region yn --requests 5 --interval 3000
  
  # 福建地区，每账户2次请求，1秒间隔
  node real-frequency-monitor.js --region fj --requests 2 --interval 1000

💡 说明:
  - 脚本会自动从在线API获取真实用户信息
  - 根据地区筛选对应的用户进行监控
  - 监控双接口抢购的频繁率情况
  - 输出详细的统计和分析结果
                `);
                process.exit(0);
            }
        }
        
        // 验证参数
        if (maxRequests < 1 || maxRequests > 10) {
            console.error('❌ 请求次数必须在1-10之间');
            process.exit(1);
        }
        
        if (intervalMs < 1000 || intervalMs > 10000) {
            console.error('❌ 请求间隔必须在1000-10000毫秒之间');
            process.exit(1);
        }
        
        if (!REGION_MAP[region]) {
            console.error(`❌ 无效的地区参数: ${region}，请使用 cq/yn/fj`);
            process.exit(1);
        }
        
        console.log(`\n📋 监控配置:`);
        console.log(`   地区: ${REGION_MAP[region].name} (${region})`);
        console.log(`   每账户请求次数: ${maxRequests}`);
        console.log(`   请求间隔: ${intervalMs}ms`);
        console.log(`   总账户数: ${accounts.length}`);
        
        // 运行监控
        await monitorDualApiFrequency(accounts, maxRequests, intervalMs, region);
        
    } catch (error) {
        console.error('💥 监控启动失败:', error.message);
        
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            console.error('🌐 网络连接错误，请检查API服务是否正常运行');
        } else if (error.response) {
            console.error(`📡 API响应错误: ${error.response.status} - ${error.response.statusText}`);
        }
        
        process.exit(1);
    }
}
