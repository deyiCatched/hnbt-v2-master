#!/usr/bin/env node

/**
 * 共享代理模式测试脚本
 * 用于验证新的共享代理IP管理功能
 */

import { SharedProxyManager } from './xiaomi.js';

async function testSharedProxyManager() {
    console.log('🧪 开始测试共享代理管理器...');
    
    // 创建共享代理管理器
    const proxyManager = new SharedProxyManager(1);
    
    console.log('\n📊 初始状态:');
    console.log(proxyManager.getStatus());
    
    try {
        // 测试获取代理
        console.log('\n🔄 测试获取代理IP...');
        const proxy = await proxyManager.getValidProxy();
        
        if (proxy) {
            console.log(`✅ 成功获取代理: ${proxy.server}:${proxy.port}`);
            console.log(`📍 验证IP: ${proxy.validatedIP}`);
            
            // 再次获取，应该返回缓存的代理
            console.log('\n🔄 测试缓存代理IP...');
            const cachedProxy = await proxyManager.getValidProxy();
            console.log(`✅ 缓存代理IP: ${cachedProxy.server}:${cachedProxy.port}`);
            
            // 检查状态
            console.log('\n📊 获取代理后的状态:');
            const status = proxyManager.getStatus();
            console.log(status);
            console.log(`🔄 重试信息: ${status.retryCount}/${status.maxRetryAttempts}`);
            
        } else {
            console.log('❌ 无法获取代理IP');
            console.log('\n📊 最终状态:');
            const finalStatus = proxyManager.getStatus();
            console.log(finalStatus);
        }
        
        // 测试重试机制
        console.log('\n🔄 测试重试机制（刷新代理）...');
        const newProxy = await proxyManager.refreshProxy();
        if (newProxy) {
            console.log(`✅ 重试获取代理成功: ${newProxy.server}:${newProxy.port}`);
        } else {
            console.log('❌ 重试获取代理失败');
        }
        
    } catch (error) {
        console.error('💥 测试失败:', error.message);
        console.log('\n📊 错误时的状态:');
        const errorStatus = proxyManager.getStatus();
        console.log(errorStatus);
    }
    
    console.log('\n✅ 测试完成');
}

// 运行测试
testSharedProxyManager().catch(console.error);
