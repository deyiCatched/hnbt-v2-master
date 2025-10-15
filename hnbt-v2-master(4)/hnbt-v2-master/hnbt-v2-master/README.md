# HNBT-V2 抢购软件

## 项目结构

```
hnbt-v2/
├── accounts.json      # 账户信息配置文件
├── package.json       # 项目依赖配置
├── index.js          # 主入口文件
├── purchase.js       # 抢购函数模块
└── README.md         # 说明文档
```

## 功能说明

### 当前版本功能
1. ✅ 读取 `accounts.json` 中的账户信息
2. ✅ 调用代理API获取代理IP
3. ✅ 测试代理IP是否可用（通过请求 `https://httpbin.org/ip` 验证）
4. ✅ 完整的错误处理和日志输出
5. 🔄 抢购逻辑框架已搭建（待实现具体业务逻辑）

### 后续计划
- 多账号支持
- 具体抢购业务逻辑实现
- 重试机制
- 配置文件优化

## 使用方法

### 1. 安装依赖
```bash
npm install
```

### 2. 配置账户信息
确保 `accounts.json` 文件包含正确的账户信息：
```json
{
    "name": "李*",
    "phone": "15928650173",
    "accId": "19e6adb3f6834ebf8c588657159ebf74",
    "grabToken": "9cd91657d0654963949d3357d9dbf7f41758711127747",
    "uniqueId": "10",
    "tourismSubsidyId": 18,
    "foodSubsidyId": 23
}
```

### 3. 运行程序
```bash
npm start
# 或者
node index.js
```

## 核心模块说明

### purchase.js
- `purchaseFunction(accountInfo, proxyInfo)`: 主要的抢购函数
- `testProxyIP(proxyInfo)`: 测试代理IP是否可用

### index.js
- `loadAccountInfo()`: 读取账户配置
- `getProxyIP()`: 获取代理IP
- `main()`: 主流程控制

## 代理API说明

代理API返回格式：
```json
{
    "count": "1",
    "status": "0",
    "expire": "2025-09-26 16:39:16",
    "list": [
        {
            "sever": "103.43.135.9",
            "port": 56225,
            "net_type": 1
        }
    ]
}
```

## 错误处理

程序包含完整的错误处理机制：
- 账户信息读取失败
- 代理IP获取失败
- 代理IP连接测试失败
- 网络请求超时等

所有错误都会在控制台输出详细信息，便于调试。 