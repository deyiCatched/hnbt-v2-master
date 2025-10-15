// analyze-sign-pattern.js - 深入分析sign模式
import fs from 'fs';
import crypto from 'crypto';

/**
 * 分析sign的可能模式
 */
function analyzeSignPattern() {
    console.log('🔍 开始分析sign的可能模式');
    
    // 原始请求中的sign值
    const originalUrlSign = '90e09b8480a4bc8302049ada1dca46bb';
    const originalBodySign = 'f1c5371f709221a9f6f99258cc0bf406';
    
    console.log(`📋 原始URL sign: ${originalUrlSign}`);
    console.log(`📋 原始Body sign: ${originalBodySign}`);
    
    // 读取账户信息
    const accountData = fs.readFileSync('xiaomi-accounts.json', 'utf8');
    const accounts = JSON.parse(accountData);
    const testAccount = accounts[0];
    
    console.log(`\n📱 测试账户信息:`);
    console.log(`   姓名: ${testAccount.name}`);
    console.log(`   手机: ${testAccount.phone}`);
    console.log(`   用户ID: ${testAccount.userId}`);
    console.log(`   ServiceToken: ${testAccount.serviceToken.substring(0, 50)}...`);
    console.log(`   设备ID: ${testAccount.dId}`);
    console.log(`   分类代码: ${testAccount.cateCode}`);
    console.log(`   地区ID: ${testAccount.regionId}`);
    console.log(`   活动分类: ${testAccount.activityCategory}`);
    
    // 分析可能的sign生成方式
    console.log('\n🧮 分析可能的sign生成方式:');
    
    // 1. 分析原始sign的特征
    console.log('\n1️⃣ 原始sign特征分析:');
    console.log(`   URL sign长度: ${originalUrlSign.length} (标准MD5: 32位)`);
    console.log(`   Body sign长度: ${originalBodySign.length} (标准MD5: 32位)`);
    console.log(`   都是有效的MD5格式: ${/^[a-f0-9]{32}$/.test(originalUrlSign) && /^[a-f0-9]{32}$/.test(originalBodySign)}`);
    
    // 2. 尝试基于用户信息的各种组合
    console.log('\n2️⃣ 基于用户信息的sign生成尝试:');
    
    const combinations = [
        // 基于用户ID
        { name: '用户ID', data: testAccount.userId },
        { name: '用户ID(字符串)', data: String(testAccount.userId) },
        
        // 基于设备信息
        { name: '设备ID', data: testAccount.dId },
        { name: '设备模型', data: testAccount.dModel },
        
        // 基于token
        { name: 'ServiceToken前32位', data: testAccount.serviceToken.substring(0, 32) },
        { name: 'ServiceToken后32位', data: testAccount.serviceToken.substring(testAccount.serviceToken.length - 32) },
        
        // 基于业务参数
        { name: '分类代码', data: testAccount.cateCode },
        { name: '地区ID', data: testAccount.regionId },
        { name: '活动分类', data: testAccount.activityCategory },
        { name: '支付方式', data: testAccount.paymentMode },
        
        // 组合方式
        { name: '用户ID+分类代码', data: `${testAccount.userId}${testAccount.cateCode}` },
        { name: '分类代码+地区ID', data: `${testAccount.cateCode}${testAccount.regionId}` },
        { name: '地区ID+活动分类', data: `${testAccount.regionId}${testAccount.activityCategory}` },
        { name: '用户ID+地区ID+活动分类', data: `${testAccount.userId}${testAccount.regionId}${testAccount.activityCategory}` },
        
        // 基于手机号
        { name: '手机号', data: testAccount.phone },
        { name: '手机号后8位', data: testAccount.phone.substring(3) },
        
        // 固定字符串
        { name: '固定字符串1', data: 'xiaomi_query_api' },
        { name: '固定字符串2', data: 'mtop_navi_venue_batch' },
        { name: '固定字符串3', data: 'verify_query' },
    ];
    
    combinations.forEach((combo, index) => {
        const md5Hash = crypto.createHash('md5').update(combo.data).digest('hex');
        const isMatchUrl = md5Hash === originalUrlSign;
        const isMatchBody = md5Hash === originalBodySign;
        
        console.log(`   ${index + 1}. ${combo.name}: ${md5Hash}`);
        if (isMatchUrl) {
            console.log(`      🎉 匹配URL sign!`);
        }
        if (isMatchBody) {
            console.log(`      🎉 匹配Body sign!`);
        }
    });
    
    // 3. 分析可能的加密方式
    console.log('\n3️⃣ 可能的加密方式分析:');
    
    const encryptionMethods = [
        { name: 'MD5', func: (data) => crypto.createHash('md5').update(data).digest('hex') },
        { name: 'SHA1', func: (data) => crypto.createHash('sha1').update(data).digest('hex') },
        { name: 'SHA256', func: (data) => crypto.createHash('sha256').update(data).digest('hex') },
    ];
    
    const testData = [
        testAccount.userId,
        testAccount.cateCode,
        `${testAccount.userId}${testAccount.cateCode}`,
        testAccount.phone
    ];
    
    testData.forEach(data => {
        console.log(`\n   测试数据: "${data}"`);
        encryptionMethods.forEach(method => {
            const hash = method.func(data);
            const isMatchUrl = hash === originalUrlSign;
            const isMatchBody = hash === originalBodySign;
            
            console.log(`     ${method.name}: ${hash.substring(0, 16)}...`);
            if (isMatchUrl) {
                console.log(`       🎉 匹配URL sign!`);
            }
            if (isMatchBody) {
                console.log(`       🎉 匹配Body sign!`);
            }
        });
    });
    
    // 4. 分析可能的HMAC签名
    console.log('\n4️⃣ HMAC签名分析:');
    
    const hmacKeys = [
        testAccount.serviceToken,
        testAccount.dId,
        'xiaomi_secret_key',
        'mtop_secret',
        testAccount.userId
    ];
    
    const hmacData = [
        testAccount.userId,
        testAccount.cateCode,
        `${testAccount.userId}_${testAccount.cateCode}`,
        '/mtop/navi/venue/batch'
    ];
    
    hmacKeys.forEach(key => {
        hmacData.forEach(data => {
            const hmacHash = crypto.createHmac('sha256', key).update(data).digest('hex');
            const isMatchUrl = hmacHash === originalUrlSign;
            const isMatchBody = hmacHash === originalBodySign;
            
            console.log(`   HMAC-SHA256(key:${key.substring(0, 10)}..., data:"${data}"): ${hmacHash.substring(0, 16)}...`);
            if (isMatchUrl) {
                console.log(`     🎉 匹配URL sign!`);
            }
            if (isMatchBody) {
                console.log(`     🎉 匹配Body sign!`);
            }
        });
    });
    
    // 5. 结论
    console.log('\n📊 分析结论:');
    console.log('   1. Sign确实是32位MD5格式');
    console.log('   2. Sign不是简单的用户信息组合');
    console.log('   3. Sign可能涉及复杂的密钥或算法');
    console.log('   4. Sign可能与请求的特定上下文相关');
    console.log('   5. Sign可能需要特定的生成时机或条件');
    
    console.log('\n💡 建议:');
    console.log('   1. 需要分析小米APP的源码或抓包更多样本');
    console.log('   2. 可能需要逆向工程分析签名算法');
    console.log('   3. 或者寻找其他不需要签名的API接口');
    console.log('   4. 考虑使用模拟器或真机环境获取真实sign');
}

// 运行分析
analyzeSignPattern();
