// run-xiaomi-query.js - 直接运行小米查券功能
import fs from 'fs';
import { XiaomiQueryService } from './xiaomi-query.js';

/**
 * 显示帮助信息
 */
function showHelp() {
    console.log(`
🚀 小米查券功能 - 帮助信息

📋 用法:
  node run-xiaomi-query.js [选项]

🔧 可用选项:
  --phone <手机号>   查询指定手机号的用户 [默认: 查询所有用户]
  --mode <模式>      运行模式: direct(直连) 或 proxy(代理) [默认: direct]
  --help, -h         显示此帮助信息

📚 使用示例:
  # 查询所有用户
  node run-xiaomi-query.js
  
  # 查询指定手机号的用户
  node run-xiaomi-query.js --phone 18602385677
  
  # 使用代理模式查询指定用户
  node run-xiaomi-query.js --phone 18602385677 --mode proxy

🎯 功能说明:
  - 默认查询所有用户账户的券信息
  - 使用 --phone 参数可以查询指定手机号的用户
  - 支持直连模式和代理模式
  - 重点关注已领取的优惠券信息
`);
}

/**
 * 直接运行小米查券功能
 */
async function runXiaomiQuery() {
    try {
        console.log('🚀 启动小米查券功能');

        // 解析命令行参数
        const args = process.argv.slice(2);
        let targetPhone = null;
        let mode = 'direct';

        for (let i = 0; i < args.length; i++) {
            if (args[i] === '--help' || args[i] === '-h') {
                showHelp();
                process.exit(0);
            } else if (args[i] === '--phone' && i + 1 < args.length) {
                targetPhone = args[i + 1];
            } else if (args[i] === '--mode' && i + 1 < args.length) {
                mode = args[i + 1];
            }
        }

        // 验证模式参数
        if (mode !== 'direct' && mode !== 'proxy') {
            console.error('❌ 无效的模式参数，请使用 --mode direct 或 --mode proxy');
            process.exit(1);
        }

        console.log('📋 读取账户信息...');
        
        // 读取账户信息
        const accountData = fs.readFileSync('xiaomi-accounts.json', 'utf8');
        const accounts = JSON.parse(accountData);
        const accountList = Array.isArray(accounts) ? accounts : [accounts];
        
        console.log(`✅ 成功读取 ${accountList.length} 个账户信息`);

        // 显示查询配置
        console.log(`🔧 运行模式: ${mode === 'direct' ? '直连模式' : '代理模式'}`);
        if (targetPhone) {
            console.log(`🎯 目标手机号: ${targetPhone}`);
            const targetAccount = accountList.find(acc => acc.phone === targetPhone);
            if (targetAccount) {
                console.log(`📱 目标用户: ${targetAccount.name} (${targetAccount.phone})`);
            } else {
                console.log(`❌ 未找到手机号为 ${targetPhone} 的账户`);
                console.log(`📋 可用手机号: ${accountList.map(acc => acc.phone).join(', ')}`);
                process.exit(1);
            }
        } else {
            console.log(`📋 查询范围: 所有用户 (${accountList.length} 个账户)`);
        }
        
        // 创建查券服务实例
        const queryService = new XiaomiQueryService(mode, 1);
        
        console.log('\n🔍 开始批量查券...');
        
        // 执行批量查券
        const results = await queryService.batchQuery(accountList, [], targetPhone);
        
        // 统计结果
        const totalAccounts = results.length;
        const successfulQueries = results.filter(r => r.success).length;
        const accountsWithAvailableCoupons = results.filter(r => r.availableCoupons > 0).length;
        const totalAvailableCoupons = results.reduce((sum, r) => sum + (r.availableCoupons || 0), 0);
        const totalTakenCoupons = results.reduce((sum, r) => sum + (r.takenCoupons || 0), 0);
        
        // 显示最终统计
        console.log('\n🎊 查券完成！统计结果：');
        console.log(`📊 总账户数: ${totalAccounts}`);
        console.log(`✅ 成功查询: ${successfulQueries}`);
        console.log(`🎯 有可用券账户: ${accountsWithAvailableCoupons}`);
        console.log(`🟢 总可用券数: ${totalAvailableCoupons}`);
        console.log(`🔴 总已被领取券数: ${totalTakenCoupons}`);
        
        // 显示详细结果
        console.log('\n📋 详细查券结果:');
        results.forEach((result, index) => {
            const account = result.account;
            console.log(`\n${index + 1}. ${account.name} (${account.phone})`);
            console.log(`   查询状态: ${result.success ? '✅ 成功' : '❌ 失败'}`);
            console.log(`   耗时: ${result.duration}ms`);
            
            if (result.success) {
                console.log(`   🟢 可领取券: ${result.availableCoupons || 0} 个`);
                console.log(`   🔴 已被领取券: ${result.takenCoupons || 0} 个`);
                console.log(`   ⚪ 其他状态券: ${result.otherStatusCoupons || 0} 个`);
                
                if (result.couponDetails && result.couponDetails.length > 0) {
                    console.log(`   券详情:`);
                    result.couponDetails.forEach(coupon => {
                        const statusIcon = coupon.statusCode === 0 ? '🟢' : coupon.statusCode === 2 ? '🔴' : '⚪';
                        console.log(`     ${statusIcon} ${coupon.cateName}(${coupon.cateCode}): ${coupon.statusDesc}`);
                    });
                }
            } else {
                console.log(`   错误信息: ${result.error}`);
            }
        });
        
        // 重点关注已领取的券
        if (totalTakenCoupons > 0) {
            console.log('\n🎯 已领取优惠券汇总:');
            results.forEach(result => {
                if (result.takenCoupons > 0 && result.couponDetails) {
                    const takenCoupons = result.couponDetails.filter(coupon => coupon.statusCode === 2);
                    takenCoupons.forEach(coupon => {
                        console.log(`   📱 ${result.account.name}(${result.account.phone}): ${coupon.cateName} - ${coupon.statusDesc}`);
                    });
                }
            });
        }
        
        // 如果有可用券，显示提示
        if (totalAvailableCoupons > 0) {
            console.log('\n🎉 发现可用券！');
            results.forEach(result => {
                if (result.availableCoupons > 0) {
                    console.log(`   📱 ${result.account.name}(${result.account.phone}): ${result.availableCoupons} 个可用券`);
                }
            });
        }
        
        console.log('\n✨ 查券任务完成！');
        
    } catch (error) {
        console.error('💥 查券失败:', error.message);
        console.error('错误详情:', error);
        process.exit(1);
    }
}

// 运行查券功能
runXiaomiQuery();
