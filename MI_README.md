# 小米抢券系统 - 完整使用指南

## 📋 系统概述

小米抢券系统是一个功能完整的小米商城补贴获取和券查询系统，支持智能抢购、券查询和用户信息管理。系统采用模块化设计，支持直连模式和代理模式，提供完整的日志记录和推送通知功能。

## 🚀 核心功能模块

### 1. 小米抢券系统 (`xiaomi.js`)

#### 📖 功能简介
基于小米商城 `/mtop/navi/saury/subsidy/fetch` 接口的智能抢券系统，支持定时抢购、并发请求和智能重试机制。

#### 🔧 核心特性
- **双模式支持**: 直连模式和代理模式
- **智能抢购**: 支持定时抢购和无限捡漏模式
- **并发处理**: 代理模式下每个账户使用3个代理IP并发请求
- **成功判断**: 基于 `tips` 字段和 `code` 状态综合判断抢券成功
- **推送通知**: 抢券成功后自动发送微信推送通知
- **详细日志**: 为每个账户生成独立的详细日志文件

#### 📚 使用方法

##### 命令行参数
```bash
node xiaomi.js [选项]

可用选项:
  --mode <模式>      运行模式: direct(直连) 或 proxy(代理) [默认: direct]
  --proxy <类型>     代理类型: 1 或 2 [默认: 1]
  --time <时间>      开始时间: HH:MM:SS [默认: 10:00:00]
  --help, -h         显示帮助信息
```

##### 使用示例
```bash
# 10:00开始的直连模式
node xiaomi.js --mode direct --time 10:00:00

# 10:00开始的代理模式（代理类型1）
node xiaomi.js --mode proxy --proxy 1 --time 10:00:00

# 09:30开始的代理模式（代理类型2）
node xiaomi.js --mode proxy --proxy 2 --time 09:30:00

# 立即开始（直连模式）
node xiaomi.js --mode direct
```

##### npm 快捷命令
```bash
npm run xiaomi:10:direct     # 10:00直连模式
npm run xiaomi:10:proxy      # 10:00代理模式
npm run xiaomi:10:proxy1     # 10:00代理模式(类型1)
npm run xiaomi:10:proxy2     # 10:00代理模式(类型2)
```

#### 🎯 抢券逻辑详解

##### 1. 智能抢购流程
```
准备阶段 (提前3分钟)
    ↓
等待抢购时间
    ↓
循环抢购执行
    ↓
成功判断与通知
```

##### 2. 成功判断机制
```javascript
// 主要判断条件：tips为空字符串表示抢券成功
if (tips === '') {
    result.success = true;
    result.message = '抢券成功';
    // 发送推送通知
    this.sendSuccessNotification(accountInfo);
} 
// 次要判断条件：code不为0也可能表示抢券成功
else if (response.data.code !== 0) {
    result.success = true;
    result.message = response.data.message || '抢券成功';
    // 发送推送通知
    this.sendSuccessNotification(accountInfo);
}
```

##### 3. 模式对比

| 特性 | 直连模式 | 代理模式 |
|------|----------|----------|
| 连接方式 | 本机IP直接连接 | 使用代理IP池 |
| 并发请求 | 单次请求 | 3个代理并发请求 |
| 重试限制 | 无限制（捡漏模式） | 最多50轮 |
| 适用场景 | 测试、捡漏 | 正式抢购 |
| 成功率 | 中等 | 高 |

#### 📊 日志系统
- **实时日志**: 控制台实时显示抢购进度
- **独立日志**: 每个账户生成独立的 `.txt` 日志文件
- **详细记录**: 包含请求信息、响应数据、错误详情等
- **日志位置**: `simple-logs/` 目录

#### 📱 推送通知
- **推送服务**: 基于Server酱(方糖)的微信推送
- **推送格式**: `name-phone 抢券成功`
- **推送内容**: 包含账户信息、抢券时间、状态详情等

---

### 2. 小米查券系统 (`run-xiaomi-query.js`)

#### 📖 功能简介
基于小米商城 `/mtop/navi/venue/batch` 接口的券查询系统，支持查询所有用户或指定用户的券状态，重点关注已领取的优惠券信息。

#### 🔧 核心特性
- **灵活查询**: 支持查询所有用户或指定手机号用户
- **重点关注已领取券**: 详细显示已领取券的关键信息
- **双模式支持**: 直连模式和代理模式
- **智能过滤**: 根据手机号精确筛选用户
- **详细统计**: 提供完整的券状态统计信息

#### 📚 使用方法

##### 命令行参数
```bash
node run-xiaomi-query.js [选项]

可用选项:
  --phone <手机号>   查询指定手机号的用户 [默认: 查询所有用户]
  --mode <模式>      运行模式: direct(直连) 或 proxy(代理) [默认: direct]
  --help, -h         显示帮助信息
```

##### 使用示例
```bash
# 查询所有用户
node run-xiaomi-query.js

# 查询指定手机号的用户
node run-xiaomi-query.js --phone 18602385677

# 使用代理模式查询指定用户
node run-xiaomi-query.js --phone 18602385677 --mode proxy
```

#### 🎯 查券逻辑详解

##### 1. 券状态分类
```javascript
// 券状态码定义
const availableCoupons = cates.filter(cate => cate.statusCode === 0); // 尚未领取资格
const takenCoupons = cates.filter(cate => cate.statusCode === 2);     // 已被领取
const otherStatusCoupons = cates.filter(cate => cate.statusCode !== 0 && cate.statusCode !== 2);
```

##### 2. 重点关注已领取券
系统会详细显示已领取券的以下信息：
- 📱 **账户信息**: 姓名和手机号
- 🏷️ **券类型**: 具体的券名称和代码
- 💳 **支付方式**: 支持的支付方式
- 📝 **状态描述**: 详细的领取状态信息
- 🖼️ **图标链接**: 券的图标URL
- ⏰ **查询时间**: 查询的具体时间

##### 3. 查询结果展示
```
📋 账户 重庆手机青柽柽 查券结果:
   🟢 可领取券: 2 个
   🔴 已被领取: 1 个
   ⚪ 其他状态: 0 个

🎯 已领取优惠券详情:
   1. 📱 账户: 重庆手机青柽柽 (18602385677)
      🏷️ 券类型: 智能穿戴 (B03)
      💳 支付方式: UNIONPAY
      📝 状态描述: 资格已被四川省地区领取
      🖼️ 图标: https://img.youpin.mi-img.com/shopcenter/...
      ⏰ 查询时间: 2025/10/12 16:48:11
      ---
```

#### 📊 统计信息
- **总账户数**: 参与查询的账户总数
- **成功查询数**: 成功获取券信息的账户数
- **有可用券账户**: 拥有可领取券的账户数
- **总可用券数**: 所有账户可领取券的总数
- **总已领取券数**: 所有账户已领取券的总数

---

### 3. 小米用户信息提取 (`xiaomiAccount.js`)

#### 📖 功能简介
从HTTP请求中自动提取小米商城用户的关键信息，并生成标准格式的账户配置文件，简化用户信息管理流程。

#### 🔧 核心特性
- **智能解析**: 自动从HTTP请求中提取关键参数
- **标准格式**: 生成统一格式的账户配置文件
- **批量管理**: 支持多个账户信息的累积保存
- **交互式界面**: 提供友好的用户输入界面
- **信息验证**: 显示提取信息的完整性状态

#### 📚 使用方法

##### 运行程序
```bash
node xiaomiAccount.js
```

##### 操作流程
1. **输入账户名称**: 为账户设置易于识别的名称
2. **输入手机号码**: 提供账户对应的手机号
3. **粘贴HTTP请求**: 从浏览器开发者工具或抓包工具中复制完整的HTTP请求内容
4. **确认保存**: 程序自动解析并保存到 `xiaomi-accounts.json`

#### 🎯 提取的关键信息

##### 1. 认证信息
- `serviceToken`: 服务令牌，用于API认证
- `userId`: 用户ID，唯一标识用户身份

##### 2. 设备信息
- `dId`: 设备标识符
- `dModel`: 设备型号信息

##### 3. 跟踪信息
- `sentryTrace`: Sentry跟踪ID
- `baggage`: 跟踪载荷信息

##### 4. 业务参数
- `cateCode`: 券类型代码
- `regionId`: 地区ID
- `activityCategory`: 活动分类
- `paymentMode`: 支付方式

#### 📄 生成的账户格式
```json
{
    "name": "重庆手机青柽柽",
    "phone": "18602385677",
    "accId": "xiaomi_acc_1760107740887",
    "grabToken": "xiaomi_token_1760107740887",
    "uniqueId": "1760107740887",
    "serviceToken": "0mKjiBnIABWojh0PWnyR...",
    "userId": "212277518",
    "dId": "OXBJOW5jM2cyZDd2bUh2TTJncDFHS0pCTFl3SUx1QUhEcXFMRytRN2x6aURaK3NSVXV2aHZmUGR6UWtoWDhIUg==",
    "dModel": "aVBob25lMTcsMQ==",
    "sentryTrace": "cd4fbb3024e641c78a5af343fdd8fcb7-6204db2398b74172-1",
    "baggage": "sentry-environment=RELEASE,sentry-public_key=ee0a98b8e8e3417c89db4f9fd258ef62,sentry-release=com.xiaomi.mishop%405.2.257%2B2509112112,sentry-sample_rate=1,sentry-trace_id=cd4fbb3024e641c78a5af343fdd8fcb7,sentry-transaction=MSNewMainViewController",
    "cateCode": "B01",
    "regionId": "10",
    "activityCategory": "100",
    "paymentMode": "UNIONPAY"
}
```

#### 🔍 信息提取状态
程序会显示每个关键信息的提取状态：
```
📋 提取的关键信息:
   serviceToken: ✅ 已提取
   userId: 212277518
   dId: ✅ 已提取
   dModel: ✅ 已提取
   sentryTrace: ✅ 已提取
   baggage: ✅ 已提取
   cateCode: B01
   regionId: 10
   activityCategory: 100
   paymentMode: UNIONPAY
```

---

## 🔧 系统配置

### 1. 依赖安装
```bash
npm install
```

### 2. 账户配置
将提取的账户信息保存到 `xiaomi-accounts.json` 文件中，系统会自动读取所有账户信息。

### 3. 推送配置
推送通知基于Server酱(方糖)服务，需要在 `notification.js` 中配置正确的API Key。

### 4. 代理配置
如果使用代理模式，需要在 `proxy-config.js` 中配置代理源信息。

## 📊 系统架构

```
小米抢券系统
├── xiaomi.js              # 抢券核心模块
├── xiaomi-query.js        # 查券服务模块
├── run-xiaomi-query.js    # 查券执行脚本
├── xiaomiAccount.js       # 用户信息提取工具
├── notification.js        # 推送通知服务
├── proxy-config.js        # 代理配置管理
├── concurrent-proxy-manager.js  # 并发代理管理
├── simple-logger.js       # 日志记录服务
└── xiaomi-accounts.json   # 用户账户配置文件
```

## 🎯 最佳实践

### 1. 抢券策略
- **测试阶段**: 使用直连模式进行功能测试
- **正式抢购**: 使用代理模式提高成功率
- **捡漏模式**: 使用直连模式进行持续捡漏

### 2. 账户管理
- **定期更新**: 定期更新账户的 `serviceToken` 等信息
- **分类管理**: 为不同用途的账户设置不同的名称
- **信息备份**: 定期备份 `xiaomi-accounts.json` 文件

### 3. 日志监控
- **实时监控**: 关注控制台输出的实时日志
- **日志分析**: 定期分析日志文件中的错误信息
- **性能优化**: 根据日志信息优化请求参数和策略

## 🚨 注意事项

### 1. 合规使用
- 请确保遵守小米商城的服务条款
- 避免过于频繁的请求，以免触发反爬虫机制
- 合理使用系统功能，不要影响正常用户的使用体验

### 2. 数据安全
- 妥善保管账户信息，避免泄露
- 定期更新认证令牌
- 不要在公共场所使用系统

### 3. 系统维护
- 定期检查系统更新
- 监控代理IP的有效性
- 及时处理错误和异常情况

## 📞 技术支持

如有问题或建议，请查看系统日志文件或联系技术支持团队。

---

**版本**: 2.0  
**更新时间**: 2025年10月  
**兼容性**: Node.js 16+  
