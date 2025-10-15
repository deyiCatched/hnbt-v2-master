import axios from 'axios';

/**
 * 推送通知服务
 * 使用Server酱(方糖)进行微信推送
 */
class NotificationService {
    constructor() {
        this.apiKey = 'SCT203560Tsxq9NdGqboAvd2A37WCWxLC6';
        this.baseUrl = `https://sctapi.ftqq.com/${this.apiKey}.send`;
        this.channel = 9; // 方糖服务号
    }

    /**
     * 格式化预约档位
     * @param {number} tourismSubsidyId - 旅游补贴ID
     * @returns {string} 格式化后的档位文本
     */
    formatTourismLevel(tourismSubsidyId) {
        const levelMap = {
            18: '300档',
            19: '1500档', 
            20: '3000档',
            21: '800档'
        };
        return levelMap[tourismSubsidyId] || `${tourismSubsidyId}档`;
    }

    /**
     * 发送推送通知
     * @param {Object} accountInfo - 账户信息
     * @param {string} status - 状态: 'success' 或 'duplicate'
     * @param {string} message - 详细消息
     * @returns {Promise<boolean>} 是否发送成功
     */
    async sendNotification(accountInfo, status, message = '') {
        try {
            const currentTime = new Date().toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });

            const tourismLevel = this.formatTourismLevel(accountInfo.tourismSubsidyId);
            const statusText = status === 'success' ? '提交成功' : '重复提交';
            const statusIcon = status === 'success' ? '🎉' : '⚠️';

            // 构建推送标题 - 小米抢券专用格式
            const title = `${accountInfo.name}-${accountInfo.phone} ${statusText}`;

            // 构建推送内容 (支持Markdown)
            const desp = `
## ${statusIcon} 抢购结果通知

**账户信息：**
- 👤 **姓名：** ${accountInfo.name}
- 📱 **手机号：** ${accountInfo.phone}
- 🎯 **预约档位：** ${tourismLevel}
- ⏰ **提交时间：** ${currentTime}
- 📋 **状态：** ${statusText}

**详细信息：**
${message || (status === 'success' ? '恭喜！预约提交成功！' : '该账户已提交过申请，无需重复提交。')}

---
*抢购系统自动推送 - ${currentTime}*
            `.trim();

            // 构建请求参数
            const params = {
                title: title.substring(0, 32), // 限制标题长度
                desp: desp,
                short: `${accountInfo.name}(${accountInfo.phone}) ${statusText}`,
                noip: 1, // 隐藏调用IP
                channel: this.channel
            };

            console.log(`📱 正在发送推送通知: [${accountInfo.name}] ${statusText}`);

            // 发送POST请求
            const response = await axios.post(this.baseUrl, params, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                timeout: 10000 // 10秒超时
            });

            if (response.data && response.data.code === 0) {
                console.log(`✅ 推送发送成功: [${accountInfo.name}] ${statusText}`);
                return true;
            } else {
                console.error(`❌ 推送发送失败: [${accountInfo.name}]`, response.data);
                return false;
            }

        } catch (error) {
            console.error(`💥 推送发送异常: [${accountInfo.name}]`, error.message);
            return false;
        }
    }

    /**
     * 发送成功通知
     * @param {Object} accountInfo - 账户信息
     * @param {string} message - 成功消息
     * @returns {Promise<boolean>} 是否发送成功
     */
    async sendSuccessNotification(accountInfo, message = '') {
        return await this.sendNotification(accountInfo, 'success', message);
    }

    /**
     * 发送重复提交通知
     * @param {Object} accountInfo - 账户信息
     * @param {string} message - 重复提交消息
     * @returns {Promise<boolean>} 是否发送成功
     */
    async sendDuplicateNotification(accountInfo, message = '') {
        return await this.sendNotification(accountInfo, 'duplicate', message);
    }

    /**
     * 发送小米抢券成功通知
     * @param {Object} accountInfo - 账户信息
     * @param {string} message - 成功消息
     * @param {string} successType - 成功类型: 'confirmed' (tips为空)
     * @param {Object} responseData - 完整的响应体数据
     * @returns {Promise<boolean>} 是否发送成功
     */
    async sendXiaomiSuccessNotification(accountInfo, message = '', successType = 'confirmed', responseData = null) {
        try {
            const currentTime = new Date().toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });

            // 根据成功类型确定标题和图标
            const isConfirmed = successType === 'confirmed';
            const statusIcon = isConfirmed ? '🎉' : '⚠️';
            const statusText = isConfirmed ? '抢券成功' : '抢券成功(有概率)';
            const title = `${accountInfo.name}-${accountInfo.phone} ${statusText}`;

            // 构建推送内容 (支持Markdown)
            let desp = `
## ${statusIcon} 小米抢券成功通知

**账户信息：**
- 👤 **姓名：** ${accountInfo.name}
- 📱 **手机号：** ${accountInfo.phone}
- ⏰ **抢券时间：** ${currentTime}
- 📋 **状态：** ${statusText}

**成功原因：**
${isConfirmed ? 
    '✅ **确认成功** - tips为空字符串，抢券已确认成功' : 
    '⚠️ **概率成功** - code不为0，有成功概率，请关注后续状态'}

**详细信息：**
${message || (isConfirmed ? '恭喜！小米补贴抢券确认成功！' : '小米补贴抢券有成功概率，请关注后续状态！')}`;

            // 如果有完整响应体，添加到推送内容中
            if (responseData) {
                desp += `

**完整响应体：**
\`\`\`json
${JSON.stringify(responseData, null, 2)}
\`\`\``;
            }

            desp += `

---
*小米抢券系统自动推送 - ${currentTime}*`;

            desp = desp.trim();

            // 构建请求参数
            const params = {
                title: title.substring(0, 32), // 限制标题长度
                desp: desp,
                short: `${accountInfo.name}-${accountInfo.phone} ${statusText}`,
                noip: 1, // 隐藏调用IP
                channel: this.channel
            };

            console.log(`📱 正在发送小米抢券成功推送: ${title}`);

            // 发送POST请求
            const response = await axios.post(this.baseUrl, params, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                timeout: 10000 // 10秒超时
            });

            if (response.data && response.data.code === 0) {
                console.log(`✅ 小米抢券推送发送成功: ${title}`);
                return true;
            } else {
                console.error(`❌ 小米抢券推送发送失败: ${title}`, response.data);
                return false;
            }

        } catch (error) {
            console.error(`💥 小米抢券推送发送异常: ${accountInfo.name}-${accountInfo.phone}`, error.message);
            return false;
        }
    }
}

// 创建全局通知服务实例
export const notificationService = new NotificationService();
