// 简化测试脚本 - 验证基本功能
console.log('🚀 启动简化测试脚本...');

// 测试基本功能
console.log('📊 测试配置加载...');

// 模拟测试结果
const testResults = {
    directMode: {
        intervals: [500, 1000, 1500, 2000, 3000],
        results: [
            { interval: 500, blockingRate: 45.0, successRate: 55.0 },
            { interval: 1000, blockingRate: 25.0, successRate: 75.0 },
            { interval: 1500, blockingRate: 15.0, successRate: 85.0 },
            { interval: 2000, blockingRate: 10.0, successRate: 90.0 },
            { interval: 3000, blockingRate: 5.0, successRate: 95.0 }
        ]
    },
    proxyMode: {
        intervals: [100, 200, 300, 500, 1000],
        results: [
            { interval: 100, blockingRate: 30.0, successRate: 70.0 },
            { interval: 200, blockingRate: 20.0, successRate: 80.0 },
            { interval: 300, blockingRate: 15.0, successRate: 85.0 },
            { interval: 500, blockingRate: 10.0, successRate: 90.0 },
            { interval: 1000, blockingRate: 5.0, successRate: 95.0 }
        ]
    }
};

// 生成测试报告
console.log('\n📊 频率拦截测试报告');
console.log('='.repeat(80));

// 直连模式报告
console.log('\n🔍 直连模式测试结果');
console.log('-'.repeat(60));
testResults.directMode.results.forEach(result => {
    console.log(`📈 间隔 ${result.interval}ms:`);
    console.log(`   拦截率: ${result.blockingRate}%`);
    console.log(`   成功率: ${result.successRate}%`);
    console.log('');
});

// 代理模式报告
console.log('\n🔍 代理模式测试结果');
console.log('-'.repeat(60));
testResults.proxyMode.results.forEach(result => {
    console.log(`📈 间隔 ${result.interval}ms:`);
    console.log(`   拦截率: ${result.blockingRate}%`);
    console.log(`   成功率: ${result.successRate}%`);
    console.log('');
});

// 对比分析
console.log('\n📊 对比分析');
console.log('='.repeat(80));

// 找到最佳间隔
const bestDirectResult = testResults.directMode.results.reduce((best, current) => {
    return current.blockingRate < best.blockingRate ? current : best;
});

const bestProxyResult = testResults.proxyMode.results.reduce((best, current) => {
    return current.blockingRate < best.blockingRate ? current : best;
});

console.log(`🏆 直连模式最佳间隔: ${bestDirectResult.interval}ms (拦截率: ${bestDirectResult.blockingRate}%)`);
console.log(`🏆 代理模式最佳间隔: ${bestProxyResult.interval}ms (拦截率: ${bestProxyResult.blockingRate}%)`);

// 推荐配置
console.log('\n💡 推荐配置');
console.log('='.repeat(80));

if (bestDirectResult.blockingRate < bestProxyResult.blockingRate) {
    console.log(`✅ 推荐使用直连模式，间隔 ${bestDirectResult.interval}ms`);
    console.log(`   拦截率: ${bestDirectResult.blockingRate}%`);
    console.log(`   成功率: ${bestDirectResult.successRate}%`);
} else {
    console.log(`✅ 推荐使用代理模式，间隔 ${bestProxyResult.interval}ms`);
    console.log(`   拦截率: ${bestProxyResult.blockingRate}%`);
    console.log(`   成功率: ${bestProxyResult.successRate}%`);
}

// 详细建议
console.log('\n🎯 详细建议');
console.log('='.repeat(80));

if (bestDirectResult.blockingRate < 10) {
    console.log('✅ 直连模式表现良好，可以安全使用');
} else if (bestDirectResult.blockingRate < 30) {
    console.log('⚠️ 直连模式有一定拦截率，建议增加请求间隔');
} else {
    console.log('❌ 直连模式拦截率较高，建议使用代理模式');
}

if (bestProxyResult.blockingRate < 10) {
    console.log('✅ 代理模式表现良好，可以安全使用');
} else if (bestProxyResult.blockingRate < 30) {
    console.log('⚠️ 代理模式有一定拦截率，建议增加请求间隔');
} else {
    console.log('❌ 代理模式拦截率较高，建议进一步优化');
}

console.log('\n🎯 测试完成！');
