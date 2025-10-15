// xiaomiAccount.js - 小米商城用户信息提取程序
// 从HTTP请求中提取关键信息并保存到xiaomi-accounts.json
// 支持从在线API查询用户数据

import fs from 'fs';
import readline from 'readline';
import { fileURLToPath } from 'url';
import path from 'path';
import axios from 'axios';

/**
 * 在线用户信息获取配置
 */
const ONLINE_API_CONFIG = {
    baseURL: 'http://8.148.75.17:3000',
    endpoint: '/api/purchase/records',
    defaultLimit: 100
};

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
        
    } catch (error) {
        console.error(`💥 解析cookie失败:`, error.message);
    }
    
    return result;
}

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
            page: page,
            limit: limit
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
                    serviceToken: cookieData.serviceToken || '',
                    userId: cookieData.userId || '',
                    dId: 'OXBJOW5jM2cyZDd2bUh2TTJncDFHS0pCTFl3SUx1QUhEcXFMRytRN2x6aURaK3NSVXV2aHZmUGR6UWtoWDhIUg==', // 默认值
                    dModel: 'aVBob25lMTcsMQ==', // 默认值
                    sentryTrace: '1e52fc5869554d0b8f935be162226a76-dda486e670d9448d-1', // 默认值
                    baggage: 'sentry-environment=RELEASE,sentry-public_key=ee0a98b8e8e3417c89db4f9fd258ef62,sentry-release=com.xiaomi.mishop%405.2.257%2B2509112112,sentry-sample_rate=1,sentry-trace_id=1e52fc5869554d0b8f935be162226a76,sentry-transaction=MSNewMainViewController', // 默认值
                    cateCode: record.product_type || 'B01', // 使用API中的product_type
                    regionId: '10', // 默认重庆地区
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
 * 从在线API查询指定用户信息
 * @param {string} phone - 手机号
 * @returns {Promise<Object|null>} 用户信息对象或null
 */
async function queryUserByPhone(phone) {
    try {
        console.log(`🔍 正在查询手机号为 ${phone} 的用户信息...`);
        
        // 获取所有用户数据（可以根据需要优化为按手机号查询的API）
        const accounts = await fetchOnlineUserAccounts(1, 100);
        
        // 查找匹配的用户
        const user = accounts.find(account => account.phone === phone);
        
        if (user) {
            console.log(`✅ 找到用户: ${user.name} (${user.phone})`);
            return user;
        } else {
            console.log(`❌ 未找到手机号为 ${phone} 的用户`);
            return null;
        }
        
    } catch (error) {
        console.error(`💥 查询用户失败:`, error.message);
        return null;
    }
}

/**
 * 显示在线用户列表
 * @param {number} page - 页码，默认为1
 * @param {number} limit - 每页数量，默认为20
 */
async function displayOnlineUsers(page = 1, limit = 20) {
    try {
        const accounts = await fetchOnlineUserAccounts(page, limit);
        
        if (accounts && accounts.length > 0) {
            console.log(`\n📋 在线用户列表 (第${page}页，共${accounts.length}条):`);
            console.log('=====================================');
            
            accounts.forEach((account, index) => {
                console.log(`${index + 1}. ${account.name} (${account.phone})`);
                console.log(`   用户ID: ${account.userId}`);
                console.log(`   产品类型: ${account.cateCode}`);
                console.log(`   状态: ${account.originalRecord?.is_success === 1 ? '✅ 成功' : '❌ 未成功'}`);
                console.log(`   创建时间: ${account.originalRecord?.created_at}`);
                console.log('');
            });
            
            console.log(`📊 总计: ${accounts.length} 个用户`);
        } else {
            console.log('❌ 未找到任何用户数据');
        }
        
    } catch (error) {
        console.error('💥 显示用户列表失败:', error.message);
    }
}

/**
 * 从HTTP请求中提取小米商城用户的关键信息
 * @param {string} httpRequest - 完整的HTTP请求字符串
 * @returns {Object} 提取的关键信息对象
 */
function extractXiaomiAccountInfo(httpRequest) {
    try {
        const info = {};
        
        // 解析Cookie中的serviceToken和userId
        const cookieMatch = httpRequest.match(/Cookie:\s*([^\n\r]+)/i);
        if (cookieMatch) {
            const cookieStr = cookieMatch[1];
            const serviceTokenMatch = cookieStr.match(/serviceToken=([^;]+)/);
            const userIdMatch = cookieStr.match(/userId=([^;]+)/);
            
            if (serviceTokenMatch) {
                info.serviceToken = serviceTokenMatch[1];
            }
            if (userIdMatch) {
                info.userId = userIdMatch[1];
            }
        }
        
        // 解析d-id
        const dIdMatch = httpRequest.match(/d-id:\s*([^\n\r]+)/i);
        if (dIdMatch) {
            info.dId = dIdMatch[1].trim();
        }
        
        // 解析d-model
        const dModelMatch = httpRequest.match(/d-model:\s*([^\n\r]+)/i);
        if (dModelMatch) {
            info.dModel = dModelMatch[1].trim();
        }
        
        // 解析sentry-trace
        const sentryTraceMatch = httpRequest.match(/sentry-trace:\s*([^\n\r]+)/i);
        if (sentryTraceMatch) {
            info.sentryTrace = sentryTraceMatch[1].trim();
        }
        
        // 解析baggage
        const baggageMatch = httpRequest.match(/baggage:\s*([^\n\r]+)/i);
        if (baggageMatch) {
            info.baggage = baggageMatch[1].trim();
        }
        
        // 解析请求体中的参数
        const bodyMatch = httpRequest.match(/\[\{\},\{([^}]+)\}\]/);
        if (bodyMatch) {
            try {
                const bodyStr = '[' + bodyMatch[0].slice(1, -1) + ']';
                const bodyData = JSON.parse(bodyStr);
                
                if (bodyData && bodyData[1]) {
                    const params = bodyData[1];
                    info.cateCode = params.cateCode;
                    info.regionId = params.regionId;
                    info.activityCategory = params.activityCategory;
                    info.paymentMode = params.paymentMode;
                }
            } catch (parseError) {
                console.warn('⚠️ 解析请求体失败:', parseError.message);
            }
        }
        
        return info;
        
    } catch (error) {
        console.error('💥 提取账户信息失败:', error.message);
        return null;
    }
}

/**
 * 创建标准格式的xiaomi账户对象
 * @param {Object} extractedInfo - 从HTTP请求中提取的信息
 * @param {string} name - 账户名称
 * @param {string} phone - 手机号
 * @returns {Object} 标准格式的xiaomi账户对象
 */
function createXiaomiAccount(extractedInfo, name, phone) {
    if (!extractedInfo) {
        return null;
    }
    
    return {
        name: name || 'extracted_user',
        phone: phone || 'unknown',
        accId: `xiaomi_acc_${Date.now()}`,
        grabToken: `xiaomi_token_${Date.now()}`,
        uniqueId: Date.now().toString(),
        serviceToken: extractedInfo.serviceToken || '',
        userId: extractedInfo.userId || '',
        dId: extractedInfo.dId || '',
        dModel: extractedInfo.dModel || '',
        sentryTrace: extractedInfo.sentryTrace || '',
        baggage: extractedInfo.baggage || '',
        cateCode: extractedInfo.cateCode || 'B01',
        regionId: extractedInfo.regionId || '10',
        activityCategory: extractedInfo.activityCategory || '100',
        paymentMode: extractedInfo.paymentMode || 'UNIONPAY'
    };
}

/**
 * 将账户信息保存到xiaomi-accounts.json文件
 * @param {Object} accountInfo - 账户信息对象
 * @returns {boolean} 保存是否成功
 */
function saveAccountToFile(accountInfo) {
    try {
        const filename = 'xiaomi-accounts.json';
        let existingAccounts = [];
        
        // 如果文件存在，读取现有账户
        if (fs.existsSync(filename)) {
            const fileContent = fs.readFileSync(filename, 'utf8');
            existingAccounts = JSON.parse(fileContent);
        }
        
        // 确保是数组格式
        if (!Array.isArray(existingAccounts)) {
            existingAccounts = existingAccounts ? [existingAccounts] : [];
        }
        
        // 添加新账户
        existingAccounts.push(accountInfo);
        
        // 保存到文件
        fs.writeFileSync(filename, JSON.stringify(existingAccounts, null, 4), 'utf8');
        
        console.log(`✅ 账户信息已保存到 ${filename}`);
        console.log(`📊 当前账户总数: ${existingAccounts.length}`);
        
        return true;
        
    } catch (error) {
        console.error('💥 保存账户信息失败:', error.message);
        return false;
    }
}

/**
 * 显示提取的关键信息
 * @param {Object} extractedInfo - 提取的信息
 */
function displayExtractedInfo(extractedInfo) {
    console.log('\n📋 提取的关键信息:');
    console.log(`   serviceToken: ${extractedInfo.serviceToken ? '✅ 已提取' : '❌ 未找到'}`);
    console.log(`   userId: ${extractedInfo.userId || '❌ 未找到'}`);
    console.log(`   dId: ${extractedInfo.dId ? '✅ 已提取' : '❌ 未找到'}`);
    console.log(`   dModel: ${extractedInfo.dModel || '❌ 未找到'}`);
    console.log(`   sentryTrace: ${extractedInfo.sentryTrace ? '✅ 已提取' : '❌ 未找到'}`);
    console.log(`   baggage: ${extractedInfo.baggage ? '✅ 已提取' : '❌ 未找到'}`);
    console.log(`   cateCode: ${extractedInfo.cateCode || '❌ 未找到'}`);
    console.log(`   regionId: ${extractedInfo.regionId || '❌ 未找到'}`);
    console.log(`   activityCategory: ${extractedInfo.activityCategory || '❌ 未找到'}`);
    console.log(`   paymentMode: ${extractedInfo.paymentMode || '❌ 未找到'}`);
}

/**
 * 创建交互式输入界面
 * @returns {Promise<Object>} 用户输入的账户信息
 */
async function getUserInput() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        console.log('\n🔍 小米商城用户信息管理程序');
        console.log('=====================================');
        console.log('请选择操作模式：');
        console.log('1. 从HTTP请求提取新账户信息');
        console.log('2. 从在线API查询用户信息');
        console.log('3. 显示在线用户列表');
        console.log('4. 退出程序\n');
        
        rl.question('请输入选择 (1-4): ', async (choice) => {
            switch (choice.trim()) {
                case '1':
                    // 原有模式：从HTTP请求提取
                    rl.close();
                    resolve({ mode: 'extract', data: await getExtractInput() });
                    break;
                case '2':
                    // 查询模式：从在线API查询
                    rl.close();
                    resolve({ mode: 'query', data: await getQueryInput() });
                    break;
                case '3':
                    // 列表模式：显示在线用户
                    rl.close();
                    resolve({ mode: 'list', data: {} });
                    break;
                case '4':
                    // 退出
                    rl.close();
                    resolve({ mode: 'exit', data: {} });
                    break;
                default:
                    console.log('❌ 无效选择，请重新运行程序');
                    rl.close();
                    resolve({ mode: 'exit', data: {} });
            }
        });
    });
}

/**
 * 获取HTTP提取模式的输入
 * @returns {Promise<Object>} 提取模式输入数据
 */
async function getExtractInput() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        console.log('\n📝 HTTP请求提取模式');
        console.log('=====================================');
        
        rl.question('📝 请输入账户名称: ', (name) => {
            rl.question('📱 请输入手机号码: ', (phone) => {
                console.log('\n📄 请粘贴完整的HTTP请求内容（输入完成后按两次回车）:');
                
                let httpRequest = '';
                let emptyLineCount = 0;
                
                rl.on('line', (line) => {
                    if (line.trim() === '') {
                        emptyLineCount++;
                        if (emptyLineCount >= 2) {
                            rl.close();
                            resolve({ name, phone, httpRequest });
                        }
                    } else {
                        emptyLineCount = 0;
                        httpRequest += line + '\n';
                    }
                });
            });
        });
    });
}

/**
 * 获取查询模式的输入
 * @returns {Promise<Object>} 查询模式输入数据
 */
async function getQueryInput() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        console.log('\n🔍 在线用户查询模式');
        console.log('=====================================');
        
        rl.question('📱 请输入要查询的手机号码: ', (phone) => {
            rl.close();
            resolve({ phone });
        });
    });
}

/**
 * 主函数：处理用户输入并根据模式执行相应操作
 */
async function main() {
    try {
        // 获取用户输入
        const userInput = await getUserInput();
        
        switch (userInput.mode) {
            case 'extract':
                // HTTP提取模式
                await handleExtractMode(userInput.data);
                break;
            case 'query':
                // 在线查询模式
                await handleQueryMode(userInput.data);
                break;
            case 'list':
                // 显示列表模式
                await handleListMode();
                break;
            case 'exit':
                console.log('👋 程序已退出');
                return;
            default:
                console.log('❌ 未知操作模式');
        }
        
    } catch (error) {
        console.error('💥 程序执行失败:', error.message);
    }
}

/**
 * 处理HTTP提取模式
 * @param {Object} data - 提取模式数据
 */
async function handleExtractMode(data) {
    try {
        console.log('\n🔍 开始提取账户信息...');
        
        // 提取关键信息
        const extractedInfo = extractXiaomiAccountInfo(data.httpRequest);
        if (!extractedInfo) {
            console.error('❌ 提取账户信息失败');
            return;
        }
        
        // 显示提取的信息
        displayExtractedInfo(extractedInfo);
        
        // 创建标准格式的账户对象
        const accountInfo = createXiaomiAccount(extractedInfo, data.name, data.phone);
        
        console.log('\n📄 生成的账户信息:');
        console.log(JSON.stringify(accountInfo, null, 2));
        
        // 保存到文件
        const saved = saveAccountToFile(accountInfo);
        
        if (saved) {
            console.log('\n🎉 账户信息提取并保存成功！');
        } else {
            console.log('\n❌ 保存失败，请检查文件权限');
        }
        
    } catch (error) {
        console.error('💥 提取模式执行失败:', error.message);
    }
}

/**
 * 处理在线查询模式
 * @param {Object} data - 查询模式数据
 */
async function handleQueryMode(data) {
    try {
        console.log('\n🔍 开始查询用户信息...');
        
        // 查询用户信息
        const userInfo = await queryUserByPhone(data.phone);
        
        if (userInfo) {
            console.log('\n📄 查询到的用户信息:');
            console.log(JSON.stringify(userInfo, null, 2));
            
            // 显示关键信息摘要
            console.log('\n📋 关键信息摘要:');
            console.log(`   姓名: ${userInfo.name}`);
            console.log(`   手机: ${userInfo.phone}`);
            console.log(`   用户ID: ${userInfo.userId}`);
            console.log(`   产品类型: ${userInfo.cateCode}`);
            console.log(`   ServiceToken: ${userInfo.serviceToken ? '✅ 已获取' : '❌ 未获取'}`);
            console.log(`   状态: ${userInfo.originalRecord?.is_success === 1 ? '✅ 成功' : '❌ 未成功'}`);
            console.log(`   创建时间: ${userInfo.originalRecord?.created_at}`);
            console.log(`   更新时间: ${userInfo.originalRecord?.updated_at}`);
            
            if (userInfo.originalRecord?.purchase_time) {
                console.log(`   购买时间: ${userInfo.originalRecord.purchase_time}`);
            }
            if (userInfo.originalRecord?.purchaser) {
                console.log(`   购买者: ${userInfo.originalRecord.purchaser}`);
            }
        } else {
            console.log('\n❌ 查询失败或用户不存在');
        }
        
    } catch (error) {
        console.error('💥 查询模式执行失败:', error.message);
    }
}

/**
 * 处理显示列表模式
 */
async function handleListMode() {
    try {
        console.log('\n📋 开始获取在线用户列表...');
        
        // 显示用户列表
        await displayOnlineUsers(1, 20);
        
    } catch (error) {
        console.error('💥 列表模式执行失败:', error.message);
    }
}

// 如果直接运行此文件，执行主函数
const __filename = fileURLToPath(import.meta.url);
const __basename = path.basename(__filename, '.js');

if (process.argv[1].endsWith(__basename) || process.argv[1] === __filename) {
    main();
}

// 导出函数供其他模块使用
export {
    extractXiaomiAccountInfo,
    createXiaomiAccount,
    saveAccountToFile,
    fetchOnlineUserAccounts,
    queryUserByPhone,
    displayOnlineUsers,
    main
};
