#!/usr/bin/env node

/**
 * 无阻塞并发模式测试脚本
 * 用于验证xiaomi.js中代理模式的无阻塞并发优化
 */

import { XiaomiSubsidyAcquirer } from './xiaomi.js';

// 模拟账户信息
const testAccount = {
    name: "测试账户",
    phone: "13800138000",
    accId: "test_acc_001",
    grabToken: "test_token_001",
    uniqueId: "001",
    serviceToken: "test_service_token_123456789",
    userId: "123456789",
    dId: "test_device_id",
    dModel: "test_device_model",
    sentryTrace: "test_sentry_trace",
    baggage: "test_baggage",
    cateCode: "B01",
    regionId: "10",
    activityCategory: "100",
    paymentMode: "UNIONPAY"
};

// 模拟代理列表
const testProxyList = [
    {
        server: "proxy1.example.com",
        port: 8080,
        source: "test",
        validatedIP: "192.168.1.1"
    },
    {
        server: "proxy2.example.com", 
        port: 8080,
        source: "test",
        validatedIP: "192.168.1.2"
    },
    {
        server: "proxy3.example.com",
        port: 8080,
        source: "test", 
        validatedIP: "192.168.1.3"
    }
];

/**
 * 测试无阻塞并发模式
 */
async function testNonBlockingMode() {
    console.log('🧪 开始测试无阻塞并发模式');
    console.log('='.repeat(50));
    
    const acquirer = new XiaomiSubsidyAcquirer('proxy', 1);
    
    console.log('📋 测试配置:');
    console.log(`   账户: ${testAccount.name} (${testAccount.phone})`);
    console.log(`   代理数量: ${testProxyList.length}`);
    console.log(`   模式: 代理模式 (无阻塞并发)`);
    console.log('');
    
    try {
        console.log('🚀 开始执行无阻塞并发请求...');
        const startTime = Date.now();
        
        // 执行无阻塞并发请求
        const result = await acquirer.acquireSubsidy(testAccount, testProxyList);
        
        const duration = Date.now() - startTime;
        
        console.log('\n📊 测试结果:');
        console.log(`   总耗时: ${duration}ms`);
        console.log(`   请求状态: ${result.success ? '✅ 成功' : '❌ 失败'}`);
        console.log(`   错误信息: ${result.error || '无'}`);
        console.log(`   使用代理: ${result.proxy ? `${result.proxy.server}:${result.proxy.port}` : '无'}`);
        
        if (result.success) {
            console.log('\n🎉 无阻塞并发模式测试成功！');
        } else {
            console.log('\n⚠️ 请求失败，但这是预期的（因为使用的是模拟数据）');
        }
        
    } catch (error) {
        console.error('💥 测试过程中发生错误:', error.message);
    }
}

/**
 * 性能对比测试
 */
async function performanceComparison() {
    console.log('\n⚡ 性能对比测试');
    console.log('='.repeat(50));
    
    const acquirer = new XiaomiSubsidyAcquirer('proxy', 1);
    
    // 测试多次请求的响应时间
    const testRounds = 3;
    const responseTimes = [];
    
    for (let i = 1; i <= testRounds; i++) {
        console.log(`\n🔄 第 ${i}/${testRounds} 轮测试...`);
        
        const startTime = Date.now();
        try {
            await acquirer.acquireSubsidy(testAccount, testProxyList);
            const duration = Date.now() - startTime;
            responseTimes.push(duration);
            console.log(`   响应时间: ${duration}ms`);
        } catch (error) {
            console.log(`   请求异常: ${error.message}`);
        }
    }
    
    if (responseTimes.length > 0) {
        const avgTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
        const minTime = Math.min(...responseTimes);
        const maxTime = Math.max(...responseTimes);
        
        console.log('\n📈 性能统计:');
        console.log(`   平均响应时间: ${avgTime.toFixed(2)}ms`);
        console.log(`   最快响应时间: ${minTime}ms`);
        console.log(`   最慢响应时间: ${maxTime}ms`);
        console.log(`   测试轮次: ${responseTimes.length}/${testRounds}`);
    }
}

/**
 * 并发压力测试
 */
async function concurrencyStressTest() {
    console.log('\n🔥 并发压力测试');
    console.log('='.repeat(50));
    
    const acquirer = new XiaomiSubsidyAcquirer('proxy', 1);
    
    // 创建多个测试账户
    const testAccounts = [];
    for (let i = 1; i <= 5; i++) {
        testAccounts.push({
            ...testAccount,
            name: `测试账户${i}`,
            phone: `1380013800${i}`,
            userId: `12345678${i}`
        });
    }
    
    console.log(`📋 并发测试配置:`);
    console.log(`   账户数量: ${testAccounts.length}`);
    console.log(`   每个账户代理数: ${testProxyList.length}`);
    console.log(`   总并发请求数: ${testAccounts.length * testProxyList.length}`);
    
    const startTime = Date.now();
    
    try {
        // 并发执行所有账户的请求
        const promises = testAccounts.map(account => 
            acquirer.acquireSubsidy(account, testProxyList)
        );
        
        const results = await Promise.allSettled(promises);
        
        const duration = Date.now() - startTime;
        
        console.log('\n📊 并发测试结果:');
        console.log(`   总耗时: ${duration}ms`);
        console.log(`   成功请求: ${results.filter(r => r.status === 'fulfilled' && r.value.success).length}`);
        console.log(`   失败请求: ${results.filter(r => r.status === 'rejected' || !r.value.success).length}`);
        console.log(`   平均每请求耗时: ${(duration / testAccounts.length).toFixed(2)}ms`);
        
    } catch (error) {
        console.error('💥 并发测试失败:', error.message);
    }
}

/**
 * 主测试函数
 */
async function main() {
    console.log('🧪 小米无阻塞并发模式测试套件');
    console.log('='.repeat(60));
    
    try {
        // 基础功能测试
        await testNonBlockingMode();
        
        // 性能对比测试
        await performanceComparison();
        
        // 并发压力测试
        await concurrencyStressTest();
        
        console.log('\n🎊 所有测试完成！');
        console.log('\n💡 说明:');
        console.log('   - 由于使用模拟数据，请求会失败，这是正常的');
        console.log('   - 重点观察响应时间和并发处理能力');
        console.log('   - 无阻塞模式应该能更快地返回结果');
        
    } catch (error) {
        console.error('💥 测试套件执行失败:', error.message);
    }
}

// 运行测试
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith('test-non-blocking.js')) {
    main().catch(error => {
        console.error('💥 测试启动失败:', error.message);
        process.exit(1);
    });
}

export { testNonBlockingMode, performanceComparison, concurrencyStressTest };

