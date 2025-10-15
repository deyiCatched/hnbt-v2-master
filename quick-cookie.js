#!/usr/bin/env node

/**
 * 快速Cookie提取工具
 * 专门用于快速获取指定格式的Cookie字符串
 */

import CookieTester from './cookie-test.js';

// 获取命令行参数
const args = process.argv.slice(2);

if (args.length === 0) {
    console.log('🍪 快速Cookie提取工具');
    console.log('用法: node quick-cookie.js <手机号>');
    console.log('示例: node quick-cookie.js 18602385677');
    process.exit(1);
}

const phone = args[0];

// 创建测试器实例
const tester = new CookieTester();

// 验证手机号格式
if (!tester.validatePhone(phone)) {
    console.log('❌ 手机号格式不正确，请输入11位有效手机号');
    process.exit(1);
}

// 查找账户
const account = tester.findAccountByPhone(phone);
if (!account) {
    console.log(`❌ 未找到手机号 ${phone} 对应的账户信息`);
    process.exit(1);
}

// 生成指定格式的Cookie
const formattedCookie = tester.generateFormattedCookie(account);

// 输出结果
console.log(`📱 手机号: ${phone}`);
console.log(`👤 用户名: ${account.name}`);
console.log(`🆔 用户ID: ${account.userId}`);
console.log('\n🍪 指定格式Cookie:');
console.log(`'Cookie': \`${formattedCookie}\``);

// 可选：输出纯Cookie字符串（不包含引号）
console.log('\n📋 纯Cookie字符串:');
console.log(formattedCookie);
