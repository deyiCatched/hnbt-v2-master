import fs from 'fs';
import { purchaseFunction } from './purchase.js';
import { getProxyFromSource, getAvailableProxyTypes } from './proxy-config.js';
import { testProxyIP } from './proxy-test.js';
import { setProxyType, resetProxySwitchCount } from './proxy-manager.js';
import { multiAccountExecutor } from './multi-account-executor.js';
import { dynamicMultiAccountExecutor } from './dynamic-executor.js';

// ==================== 简易配置区域 ====================
// 如果不想使用命令行参数，可以直接在这里配置
const SIMPLE_CONFIG = {
    enableScheduledStart: true,     // 是否启用定时启动
    scheduledStartTime: "09:59:57", // 定时启动时间 (HH:MM:SS)
    defaultProxyType: 1             // 默认代理类型 (1=闪尘代理, 2=IP赞代理)
};
// ====================================================

/**
 * 解析命令行参数
 * @returns {Object} 解析后的参数
 */
function parseCommandLineArgs() {
    const args = process.argv.slice(2);
    const params = {
        proxyType: SIMPLE_CONFIG.defaultProxyType, // 从配置读取默认代理
        startTime: null // 开始时间
    };

    // 如果启用了简易配置，优先使用配置中的时间
    if (SIMPLE_CONFIG.enableScheduledStart) {
        const timeStr = SIMPLE_CONFIG.scheduledStartTime;
        const timeMatch = timeStr.match(/^(\d{2}):(\d{2}):(\d{2})$/);
        if (timeMatch) {
            const [, hours, minutes, seconds] = timeMatch;
            const h = parseInt(hours);
            const m = parseInt(minutes);
            const s = parseInt(seconds);
            
            if (h >= 0 && h <= 23 && m >= 0 && m <= 59 && s >= 0 && s <= 59) {
                const today = new Date();
                const startTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m, s);
                params.startTime = startTime;
                console.log(`⚙️ 使用简易配置的定时启动: ${timeStr}`);
            }
        }
    }

    // 解析 --proxy 参数
    const proxyIndex = args.findIndex(arg => arg === '--proxy' || arg === '-p');
    if (proxyIndex !== -1 && args[proxyIndex + 1]) {
        const proxyType = parseInt(args[proxyIndex + 1]);
        if (!isNaN(proxyType) && (proxyType === 1 || proxyType === 2)) {
            params.proxyType = proxyType;
        } else {
            console.warn('⚠️  无效的代理类型，将使用默认代理 (1)');
        }
    }

    // 解析 --start-time 参数
    const startTimeIndex = args.findIndex(arg => arg === '--start-time' || arg === '-s');
    if (startTimeIndex !== -1 && args[startTimeIndex + 1]) {
        const timeStr = args[startTimeIndex + 1];
        const timeMatch = timeStr.match(/^(\d{2}):(\d{2}):(\d{2})$/);
        if (timeMatch) {
            const [, hours, minutes, seconds] = timeMatch;
            const h = parseInt(hours);
            const m = parseInt(minutes);
            const s = parseInt(seconds);
            
            if (h >= 0 && h <= 23 && m >= 0 && m <= 59 && s >= 0 && s <= 59) {
                const today = new Date();
                const startTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m, s);
                params.startTime = startTime;
            } else {
                console.warn('⚠️  无效的时间格式，时间应该在 00:00:00 到 23:59:59 之间');
            }
        } else {
            console.warn('⚠️  无效的时间格式，请使用 HH:MM:SS 格式 (例如: 10:00:00)');
        }
    }

    return params;
}

/**
 * 显示使用帮助
 */
function showUsage() {
    console.log('\n📖 使用方法:');
    console.log('  npm start                                        # 使用默认代理 (闪尘代理)');
    console.log('  npm start -- --proxy 1                          # 使用闪尘代理');
    console.log('  npm start -- --proxy 2                          # 使用IP赞代理');
    console.log('  npm start -- -p 1                               # 简写形式');
    console.log('  npm start -- --proxy 1 --start-time 10:00:00    # 定时启动: 10点开始抢购');
    console.log('  npm start -- -p 1 -s 09:30:00                   # 简写形式: 9点30分开始');
    console.log('\n🔗 可用代理源:');
    
    const availableProxies = getAvailableProxyTypes();
    availableProxies.forEach(proxy => {
        console.log(`  ${proxy.type}: ${proxy.name}`);
    });
    
    console.log('\n⏰ 定时启动功能:');
    console.log('  --start-time HH:MM:SS        # 设置抢购开始时间 (24小时制)');
    console.log('  -s HH:MM:SS                  # 简写形式');
    console.log('  ⚠️  如果设置了开始时间，程序会进入预备状态等待到指定时间');
    console.log('  ⚠️  如果当前时间已超过设置时间，会立即开始抢购');
    console.log('');
}

/**
 * 格式化时间显示
 * @param {Date} date - 时间对象
 * @returns {string} 格式化后的时间字符串
 */
function formatTime(date) {
    return date.toLocaleTimeString('zh-CN', { hour12: false });
}

/**
 * 计算时间差并显示倒计时
 * @param {Date} targetTime - 目标时间
 * @param {Date} currentTime - 当前时间
 * @returns {Object} 倒计时信息
 */
function getCountdown(targetTime, currentTime) {
    const diffMs = targetTime.getTime() - currentTime.getTime();
    
    if (diffMs <= 0) {
        return { 
            isExpired: true, 
            display: '时间已到',
            totalSeconds: 0
        };
    }
    
    const totalSeconds = Math.floor(diffMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    return {
        isExpired: false,
        display: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`,
        totalSeconds
    };
}

/**
 * 等待到指定时间
 * @param {Date} targetTime - 目标时间
 */
async function waitUntilTime(targetTime) {
    return new Promise((resolve) => {
        const checkTime = () => {
            const now = new Date();
            const countdown = getCountdown(targetTime, now);
            
            if (countdown.isExpired) {
                console.log('⏰ 开始时间到达，立即启动抢购！');
                resolve();
            } else {
                // 清屏并显示倒计时
                process.stdout.write('\x1b[2J\x1b[H'); // 清屏
                console.log('🕐 等待开始时间...');
                console.log(`⏰ 设定开始时间: ${formatTime(targetTime)}`);
                console.log(`⏱️  当前时间: ${formatTime(now)}`);
                console.log(`⏳ 剩余时间: ${countdown.display}`);
                console.log('=====================================');
                console.log('⚠️  程序已进入预备状态，代理IP已分配完成');
                console.log('⚠️  请等待到指定时间后自动开始抢购...');
                console.log('⚠️  按 Ctrl+C 可随时退出程序');
                console.log('=====================================\n');
                
                // 1秒后再次检查
                setTimeout(checkTime, 1000);
            }
        };
        
        checkTime();
    });
}

/**
 * 读取账户信息
 * @returns {Promise<Array>} 账户信息数组
 */
async function loadAccountInfo() {
    try {
        console.log('📖 正在读取账户信息...');
        
        const accountData = fs.readFileSync('accounts.json', 'utf8');
        const accounts = JSON.parse(accountData);
        
        // 确保是数组格式
        const accountList = Array.isArray(accounts) ? accounts : [accounts];
        
        console.log(`✅ 成功读取 ${accountList.length} 个账户信息:`);
        accountList.forEach((account, index) => {
            console.log(`   账户 ${index + 1}: ${account.name} (${account.phone})`);
        });

        return accountList;

    } catch (error) {
        console.error('❌ 读取账户信息失败:', error.message);
        throw error;
    }
}

/**
 * 批量获取并验证代理IP
 * @param {number} proxyType - 代理类型
 * @param {number} count - 需要的代理IP数量
 * @param {number} maxAttempts - 最大尝试次数
 * @returns {Promise<Array>} 验证通过的代理信息数组
 */
async function getBatchValidatedProxyIPs(proxyType, count, maxAttempts = 10) {
    const validProxies = [];
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`\n🔄 第 ${attempt}/${maxAttempts} 次批量获取 ${count} 个代理IP`);
            
            // 批量获取代理IP
            const proxyList = await getProxyFromSource(proxyType, count);
            
            console.log(`📦 获取到 ${proxyList.length} 个代理IP，开始验证...`);
            
            // 并发验证所有代理IP
            const validationTasks = proxyList.map(async (proxy, index) => {
                try {
                    console.log(`🔍 验证代理 ${index + 1}/${proxyList.length}: ${proxy.server}:${proxy.port}`);
                    
                    const testResult = await testProxyIP(proxy);
                    
                    if (testResult.success) {
                        console.log(`✅ 代理 ${index + 1} 验证成功: ${testResult.ip}`);
                        return {
                            ...proxy,
                            validatedIP: testResult.ip
                        };
                    } else {
                        console.log(`❌ 代理 ${index + 1} 验证失败: ${testResult.error}`);
                        return null;
                    }
                } catch (error) {
                    console.error(`💥 代理 ${index + 1} 验证异常:`, error.message);
                    return null;
                }
            });
            
            // 等待所有验证完成
            const validationResults = await Promise.allSettled(validationTasks);
            
            // 收集有效的代理
            const batchValidProxies = validationResults
                .filter(result => result.status === 'fulfilled' && result.value)
                .map(result => result.value);
            
            validProxies.push(...batchValidProxies);
            
            console.log(`✅ 本批次验证成功: ${batchValidProxies.length}/${proxyList.length} 个代理IP`);
            console.log(`📊 累计有效代理: ${validProxies.length} 个`);
            
            // 如果获得足够的有效代理IP，返回结果
            if (validProxies.length >= count) {
                console.log(`🎉 已获得足够的代理IP (${validProxies.length}/${count})！`);
                return validProxies.slice(0, count); // 返回所需数量的代理
            }
            
            if (attempt < maxAttempts) {
                const needed = count - validProxies.length;
                console.log(`⚠️ 还需要 ${needed} 个有效代理IP，继续获取...`);
            }
            
        } catch (error) {
            console.error(`💥 第 ${attempt} 次批量获取代理IP失败:`, error.message);
            
            if (attempt < maxAttempts) {
                console.log('🔄 立即重试批量获取代理IP...');
            }
        }
    }
    
    if (validProxies.length === 0) {
        throw new Error(`经过 ${maxAttempts} 次尝试，无法获取到任何可用的代理IP`);
    }
    
    console.log(`⚠️ 最终只获得 ${validProxies.length}/${count} 个有效代理IP`);
    return validProxies;
}

/**
 * 主函数
 */
async function main() {
    try {
        // 解析命令行参数
        const cmdArgs = parseCommandLineArgs();
        
        // 检查是否需要显示帮助
        if (process.argv.includes('--help') || process.argv.includes('-h')) {
            showUsage();
            return;
        }

        console.log('🚀 启动抢购程序...');
        console.log(`📡 使用代理类型: ${cmdArgs.proxyType}`);
        
        // 检查是否设置了开始时间
        if (cmdArgs.startTime) {
            const now = new Date();
            const countdown = getCountdown(cmdArgs.startTime, now);
            
            console.log(`⏰ 设定开始时间: ${formatTime(cmdArgs.startTime)}`);
            console.log(`⏱️  当前时间: ${formatTime(now)}`);
            
            if (countdown.isExpired) {
                console.log('⚠️  设定时间已过，立即开始抢购！');
            } else {
                console.log(`⏳ 距离开始还有: ${countdown.display}`);
                console.log('🔄 程序将进入预备状态...');
            }
        }
        
        console.log('=====================================');

        // 初始化代理管理器
        setProxyType(cmdArgs.proxyType);
        resetProxySwitchCount(); // 重置切换计数器，确保每次运行都有完整的切换机会

        // 1. 读取账户信息
        const accountList = await loadAccountInfo();

        // 2. 检查定时启动逻辑
        if (cmdArgs.startTime) {
            const now = new Date();
            const countdown = getCountdown(cmdArgs.startTime, now);
            
            if (!countdown.isExpired) {
                console.log('=====================================');
                console.log('📋 进入预备状态：提前获取和分配代理IP...');
                
                // 进入预备状态：先获取和分配代理IP，但不开始抢购
                await dynamicMultiAccountExecutor.executePrepareMode(
                    accountList, 
                    cmdArgs.proxyType
                );
                
                console.log('✅ 预备状态完成：所有代理IP已分配，等待开始时间...');
                
                // 等待到指定时间
                await waitUntilTime(cmdArgs.startTime);
                
                // 时间到达，开始抢购
                console.log('=====================================');
                console.log('🎯 开始时间到达！启动所有账户抢购流程...');
                
                // 启动所有账户的抢购流程
                const results = await dynamicMultiAccountExecutor.startPurchaseFlow();
                
                console.log('=====================================');
                
                const successCount = results.filter(r => r.success).length;
                const totalCount = results.length;
                
                if (successCount > 0) {
                    console.log(`🎉 定时抢购完成: ${successCount}/${totalCount} 个账户成功`);
                } else {
                    console.error(`💥 定时抢购失败: 所有 ${totalCount} 个账户都失败了`);
                    process.exit(1);
                }
                
                return;
            }
        }

        // 正常执行模式
        console.log('=====================================');
        console.log(`✅ 开始执行 ${accountList.length} 个账户的动态并发抢购...`);
        console.log('🚀 特性: 验证通过的代理IP将立即分配给账户并开始抢购');

        // 使用动态执行器：验证通过的代理立即分配，无需等待所有验证完成
        const results = await dynamicMultiAccountExecutor.executeDynamicMultipleAccounts(
            accountList, 
            cmdArgs.proxyType
        );

        console.log('=====================================');
        
        // 统计结果
        const successCount = results.filter(r => r.success).length;
        const totalCount = results.length;
        
        if (successCount > 0) {
            console.log(`🎉 多账户抢购完成: ${successCount}/${totalCount} 个账户成功`);
        } else {
            console.error(`💥 多账户抢购失败: 所有 ${totalCount} 个账户都失败了`);
            process.exit(1);
        }

    } catch (error) {
        console.error('💥 程序执行过程中发生致命错误:', error.message);
        
        // 如果是代理相关错误，显示使用帮助
        if (error.message.includes('代理') || error.message.includes('白名单')) {
            showUsage();
        }
        
        process.exit(1);
    }
}

// 启动程序
main(); 