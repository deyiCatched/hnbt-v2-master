import { multiProxyFactory } from "./multi-proxy-manager.js";
import {
  getSystemTicket,
  verifyTicket,
  submitReservation,
} from "./purchase-flow.js";
import {
  logPurchaseStart,
  logFinalResult,
  logError,
} from "./purchase-logger.js";
import {
  logStartGetTicket,
  logGetTicketResult,
  logStartVerifyTicket,
  logVerifyTicketResult,
  logStartSubmitReservation,
  logSubmitReservationResult,
  logTicketExpired,
  logNetworkErrorDetection,
} from "./simple-logger.js";
import { testProxyIP } from "./proxy-test.js";
import {
  logSystemStart,
  logSimpleFinalResult,
  logProxyTest,
} from "./simple-logger.js";
import { getProxyFromSource } from "./proxy-config.js";
import { notificationService } from "./notification.js";

/**
 * 动态多账户抢购执行器
 * 支持即时分配验证通过的代理IP并立即开始抢购
 */
export class DynamicMultiAccountExecutor {
  constructor() {
    this.results = new Map(); // 存储每个账户的执行结果
    this.runningTasks = new Map(); // 存储正在运行的任务
    this.proxyQueue = []; // 已验证的代理队列
    this.accountQueue = []; // 等待分配代理的账户队列
    this.completedAccounts = new Set(); // 已完成的账户
    this.proxyValidationTasks = new Map(); // 代理验证任务
  }

  /**
   * 动态执行多账户抢购
   * @param {Array} accountList - 账户列表
   * @param {number} proxyType - 代理类型
   * @returns {Promise<Array>} 所有账户的执行结果
   */
  async executeDynamicMultipleAccounts(accountList, proxyType) {
    console.log(`🎯 开始动态执行 ${accountList.length} 个账户的抢购任务...`);
    console.log(`📡 代理类型: ${proxyType}`);
    console.log("=====================================");

    // 初始化
    this.results.clear();
    this.runningTasks.clear();
    this.proxyQueue = [];
    this.accountQueue = [...accountList]; // 复制账户列表
    this.completedAccounts.clear();
    this.proxyValidationTasks.clear();
    multiProxyFactory.clear();

    // 启动代理获取和验证流程
    const proxyValidationPromise = this.startContinuousProxyValidation(
      proxyType,
      accountList.length
    );

    // 启动账户分配和抢购流程
    const accountExecutionPromise =
      this.startDynamicAccountExecution(proxyType);

    // 等待所有流程完成
    await Promise.all([proxyValidationPromise, accountExecutionPromise]);

    // 收集结果
    const finalResults = Array.from(this.results.values());

    // 显示汇总结果
    this.displaySummary(finalResults);

    return finalResults;
  }

  /**
   * 持续的代理IP获取和验证流程
   * @param {number} proxyType - 代理类型
   * @param {number} targetCount - 目标代理数量
   * @returns {Promise<void>}
   */
  async startContinuousProxyValidation(proxyType, targetCount) {
    console.log(`🌐 启动持续代理验证流程，目标: ${targetCount} 个有效代理`);

    let totalValidated = 0;
    let attempt = 1;
    const maxAttempts = 20; // 最大尝试次数

    // 持续获取代理直到所有账户都分配到代理
    while (this.accountQueue.length > 0 && attempt <= maxAttempts) {
      try {
        const waitingAccounts = this.accountQueue.length;
        console.log(
          `\n🔄 第 ${attempt} 次批量获取代理IP (待分配账户: ${waitingAccounts})`
        );

        // 计算本次需要获取的代理数量 - 一次性获取所有剩余账户需要的代理
        const batchSize = waitingAccounts; // 一次性获取所有剩余账户需要的代理

        console.log(`🌐 正在获取 ${batchSize} 个代理IP...`);

        // 获取代理IP
        const proxyList = await getProxyFromSource(proxyType, batchSize);
        console.log(`📦 获取到 ${proxyList.length} 个代理IP，开始并发验证...`);

        if (proxyList.length === 0) {
          console.log("❌ 本次未获取到任何代理IP，等待2秒后重试...");
          await new Promise((resolve) => setTimeout(resolve, 2000));
          attempt++;
          continue;
        }

        // 并发验证所有代理IP，但验证成功一个立即分配一个
        console.log(`🔥 启动 ${proxyList.length} 个代理的即时验证分配流程...`);

        const validationPromises = proxyList.map((proxy, index) =>
          this.validateAndImmediatelyAssign(proxy, index, proxyList.length)
        );

        // 等待所有验证任务完成（但每个验证成功后会立即分配）
        const validationResults = await Promise.allSettled(validationPromises);

        // 统计本批次结果
        let batchValidated = 0;
        validationResults.forEach((result) => {
          if (result.status === "fulfilled" && result.value) {
            batchValidated++;
            totalValidated++;
          }
        });

        console.log(
          `✅ 本批次验证完成: ${batchValidated}/${proxyList.length} 个代理验证成功并已分配`
        );
        console.log(
          `📊 累计验证成功: ${totalValidated} 个代理，剩余待分配账户: ${this.accountQueue.length}`
        );

        // 如果获取到的代理数量不足，或者验证成功率较低，立即进行下一轮
        if (
          proxyList.length < waitingAccounts ||
          batchValidated < proxyList.length * 0.5
        ) {
          console.log(`🔄 获取数量不足或成功率较低，立即进行下一轮获取...`);
        }

        attempt++;

        // 如果本批次完全没有验证成功，稍微等待一下再继续
        if (batchValidated === 0 && attempt <= maxAttempts) {
          console.log("⏳ 本批次无有效代理，等待2秒后继续...");
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } catch (error) {
        console.error(`💥 第 ${attempt} 次获取代理失败:`, error.message);
        attempt++;

        if (attempt <= maxAttempts) {
          console.log("⏳ 等待3秒后重试...");
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
    }

    console.log(`🎯 代理验证流程结束，总计验证: ${totalValidated} 个有效代理`);
  }

  /**
   * 验证单个代理IP
   * @param {Object} proxy - 代理信息
   * @param {number} index - 索引
   * @param {number} total - 总数
   * @returns {Promise<Object|null>} 验证结果
   */
  async validateSingleProxy(proxy, index, total) {
    try {
      console.log(
        `🔍 验证代理 ${index + 1}/${total}: ${proxy.server}:${proxy.port}`
      );

      const testResult = await testProxyIP(proxy);

      if (testResult.success) {
        console.log(`✅ 代理 ${index + 1} 验证成功: ${testResult.ip}`);
        return {
          ...proxy,
          validatedIP: testResult.ip,
        };
      } else {
        console.log(`❌ 代理 ${index + 1} 验证失败: ${testResult.error}`);
        return null;
      }
    } catch (error) {
      console.error(`💥 代理 ${index + 1} 验证异常:`, error.message);
      return null;
    }
  }

  /**
   * 验证代理并立即分配给账户（核心方法）
   * @param {Object} proxy - 代理信息
   * @param {number} index - 代理索引
   * @param {number} total - 总代理数量
   * @returns {boolean} 是否验证成功并分配
   */
  async validateAndImmediatelyAssign(proxy, index, total) {
    try {
      console.log(
        `🔍 验证代理 ${index + 1}/${total}: ${proxy.server}:${proxy.port}...`
      );
      const testResult = await testProxyIP(proxy);

      if (testResult.success) {
        const validatedProxy = {
          ...proxy,
          validatedIP: testResult.ip,
        };

        console.log(`✅ 代理 ${index + 1} 验证成功: ${testResult.ip}`);

        // 立即检查是否有等待的账户，如果有就立即分配
        if (this.accountQueue.length > 0) {
          const account = this.accountQueue.shift();
          const accountId = `${account.name}(${account.phone})`;
          console.log(
            `🚀 立即分配验证成功的代理: [${accountId}] <- ${validatedProxy.server}:${validatedProxy.port} (${validatedProxy.validatedIP})`
          );

          // 记录代理测试成功到简洁日志
          logProxyTest(account, true, validatedProxy.validatedIP);

          // 检查是否为预备模式
          if (this.preparedAccounts !== undefined) {
            // 预备模式：只分配代理，不启动抢购
            const accountProxyManager = multiProxyFactory.getManager(
              accountId,
              this.currentProxyType || 1,
              validatedProxy
            );

            this.preparedAccounts.set(accountId, {
              account: account,
              proxyManager: accountProxyManager,
            });

            console.log(`📋 [${accountId}] 已进入预备状态，等待统一启动`);
          } else {
            // 正常模式：立即启动抢购任务
            this.startSingleAccountTask(account, validatedProxy);
          }

          return true; // 验证成功并已分配
        } else {
          // 暂时没有等待的账户，加入代理队列
          console.log(
            `📋 验证成功的代理加入队列: ${validatedProxy.server}:${validatedProxy.port}`
          );
          this.proxyQueue.push(validatedProxy);
          return true; // 验证成功但未立即分配
        }
      } else {
        console.log(`❌ 代理 ${index + 1} 验证失败: ${testResult.error}`);
        return false;
      }
    } catch (error) {
      console.error(`💥 代理 ${index + 1} 验证异常:`, error.message);
      return false;
    }
  }

  /**
   * 将验证通过的代理添加到队列并触发分配
   * @param {Object} validatedProxy - 已验证的代理
   */
  addValidatedProxyToQueue(validatedProxy) {
    this.proxyQueue.push(validatedProxy);
    console.log(
      `📋 新增有效代理到队列: ${validatedProxy.server}:${validatedProxy.port} (队列长度: ${this.proxyQueue.length})`
    );

    // 立即尝试分配给等待的账户
    this.tryAssignProxyToAccount();
  }

  /**
   * 尝试为等待的账户分配代理并启动抢购
   */
  tryAssignProxyToAccount() {
    while (this.proxyQueue.length > 0 && this.accountQueue.length > 0) {
      const proxy = this.proxyQueue.shift();
      const account = this.accountQueue.shift();

      const accountId = `${account.name}(${account.phone})`;
      console.log(
        `🔗 立即分配代理: [${accountId}] <- ${proxy.server}:${proxy.port} (${proxy.validatedIP})`
      );

      // 记录代理测试成功到简洁日志
      logProxyTest(account, true, proxy.validatedIP);

      // 立即启动该账户的抢购任务
      this.startSingleAccountTask(account, proxy);
    }
  }

  /**
   * 启动单个账户的抢购任务
   * @param {Object} account - 账户信息
   * @param {Object} validatedProxy - 已验证的代理
   */
  startSingleAccountTask(account, validatedProxy) {
    const accountId = `${account.name}(${account.phone})`;
    console.log(`🚀 [${accountId}] 立即启动抢购任务...`);

    const task = this.executeSingleAccountWithProxy(account, validatedProxy);

    // 存储任务
    const accountKey = `${account.phone}_${account.accId}`;
    this.runningTasks.set(accountKey, task);

    // 处理任务完成
    task
      .then((result) => {
        this.results.set(accountKey, result);
        this.completedAccounts.add(accountKey);
        this.runningTasks.delete(accountKey);

        console.log(
          `${result.success ? "🎉" : "💥"} [${accountId}] 任务完成: ${
            result.success ? "成功" : "失败"
          }`
        );
      })
      .catch((error) => {
        const errorResult = {
          accountInfo: account,
          success: false,
          error: `任务异常: ${error.message}`,
          usedProxy: validatedProxy?.validatedIP || "unknown",
        };

        this.results.set(accountKey, errorResult);
        this.completedAccounts.add(accountKey);
        this.runningTasks.delete(accountKey);

        console.error(`💥 [${accountId}] 任务异常:`, error.message);
      });
  }

  /**
   * 动态账户执行流程（等待所有账户完成）
   * @param {number} proxyType - 代理类型
   * @returns {Promise<void>}
   */
  async startDynamicAccountExecution(proxyType) {
    console.log(`⏳ 启动动态账户分配监控...`);

    // 持续监控直到所有账户都完成或超时
    const maxWaitTime = 300000; // 最大等待5分钟
    const startTime = Date.now();

    while (this.runningTasks.size > 0 || this.accountQueue.length > 0) {
      // 检查超时
      if (Date.now() - startTime > maxWaitTime) {
        console.warn("⏰ 等待超时，强制结束剩余任务");
        break;
      }

      // 检查是否还有账户在等待但没有代理可用
      if (this.accountQueue.length > 0 && this.proxyQueue.length === 0) {
        // 稍微等待一下，让代理验证流程继续
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        // 如果有代理可用，立即分配
        this.tryAssignProxyToAccount();
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    console.log(
      `✅ 动态分配流程完成，共完成 ${this.completedAccounts.size} 个账户`
    );
  }

  /**
   * 执行单个账户的抢购（复用现有逻辑）
   * @param {Object} accountInfo - 账户信息
   * @param {Object} validatedProxy - 已验证的代理
   * @returns {Promise<Object>} 执行结果
   */
  async executeSingleAccountWithProxy(accountInfo, validatedProxy) {
    const accountId = `${accountInfo.name}(${accountInfo.phone})`;

    try {
      // 为该账户创建独立的代理管理器
      const proxyManager = multiProxyFactory.createManager(
        accountInfo,
        validatedProxy.source === "闪尘代理" ? 1 : 2,
        validatedProxy
      );

      // 记录系统开始到简洁日志
      logSystemStart(accountInfo, validatedProxy);

      // 执行抢购流程
      const result = await this.executeFlowWithProxyManager(
        accountInfo,
        proxyManager
      );

      // 记录最终结果
      logSimpleFinalResult(
        accountInfo,
        result.success,
        result.message || result.error
      );

      return {
        accountInfo,
        success: result.success,
        message: result.message,
        error: result.error,
        data: result.data,
        usedProxy: validatedProxy.validatedIP,
      };
    } catch (error) {
      console.error(`💥 [${accountId}] 抢购任务异常:`, error.message);

      // 记录错误到简洁日志
      logSimpleFinalResult(accountInfo, false, `任务异常: ${error.message}`);

      return {
        accountInfo,
        success: false,
        error: `任务异常: ${error.message}`,
        usedProxy: validatedProxy?.validatedIP || "unknown",
      };
    }
  }

  /**
   * 使用代理管理器执行抢购流程（复用现有逻辑）
   * @param {Object} accountInfo - 账户信息
   * @param {Object} proxyManager - 代理管理器
   * @returns {Promise<Object>} 执行结果
   */
  async executeFlowWithProxyManager(accountInfo, proxyManager) {
    const accountId = `${accountInfo.name}(${accountInfo.phone})`;

    try {
      console.log(`🚀 [${accountId}] 开始执行完整抢购流程...`);
      console.log(`👤 [${accountId}] 账户: ${accountInfo.name}`);
      const currentProxy = proxyManager.getCurrentProxy();
      console.log(
        `🌐 [${accountId}] 代理: ${currentProxy.server}:${currentProxy.port} (${currentProxy.source})`
      );
      console.log(`📍 [${accountId}] 真实IP: ${currentProxy.validatedIP}`);

      // 记录抢购开始日志
      logPurchaseStart(accountInfo, currentProxy);

      let currentTicket = null;
      let ticketRefreshCount = 0;
      const maxTicketRefresh = 10;

      while (ticketRefreshCount < maxTicketRefresh) {
        try {
          // 步骤1：获取系统ticket
          console.log(
            `🎫 [${accountId}] 正在获取ticket (第${
              ticketRefreshCount + 1
            }次)...`
          );

          const ticketResult = await this.executeStepWithProxyManager(
            () => getSystemTicket(accountInfo, proxyManager.getCurrentProxy()),
            proxyManager,
            accountInfo,
            "获取系统ticket"
          );

          if (!ticketResult.success) {
            const errorMsg = "获取系统ticket失败";
            logFinalResult(accountInfo, false, errorMsg);
            throw new Error(errorMsg);
          }

          // 步骤2：校验ticket
          const verifyResult = await this.executeStepWithProxyManager(
            () =>
              verifyTicket(
                ticketResult.result.ticket,
                accountInfo,
                proxyManager.getCurrentProxy()
              ),
            proxyManager,
            accountInfo,
            "校验系统ticket"
          );

          if (!verifyResult.success) {
            const errorMsg = "校验ticket失败";
            logFinalResult(accountInfo, false, errorMsg);
            throw new Error(errorMsg);
          }

          currentTicket = verifyResult.result.ticket;
          console.log(
            `✅ [${accountId}] ticket获取并校验成功，开始提交预约...`
          );

          // 步骤3：提交预约
          const submitResult = await this.executeStepWithProxyManager(
            () =>
              submitReservation(
                currentTicket,
                accountInfo,
                proxyManager.getCurrentProxy()
              ),
            proxyManager,
            accountInfo,
            "提交预约申请"
          );

          if (submitResult.success) {
            console.log(`🎊 [${accountId}] 抢购流程执行完成！`);

            // 记录最终成功结果
            logFinalResult(
              accountInfo,
              submitResult.success,
              submitResult.result.message,
              submitResult.result.data
            );

            // 发送成功推送通知
            try {
              await notificationService.sendSuccessNotification(
                accountInfo,
                submitResult.result.message
              );
            } catch (notifyError) {
              console.error(
                `📱 [${accountId}] 推送通知发送失败:`,
                notifyError.message
              );
            }

            return submitResult.result;
          }

          // 检查是否为重复提交
          if (submitResult.result && submitResult.result.shouldStop) {
            console.log(`⚠️ [${accountId}] 检测到重复提交，停止该账户抢购`);

            // 记录最终结果
            logFinalResult(
              accountInfo,
              false,
              submitResult.result.message,
              submitResult.result
            );

            // 发送重复提交推送通知
            try {
              await notificationService.sendDuplicateNotification(
                accountInfo,
                submitResult.result.message
              );
            } catch (notifyError) {
              console.error(
                `📱 [${accountId}] 推送通知发送失败:`,
                notifyError.message
              );
            }

            return {
              success: false,
              error: "DUPLICATE_SUBMISSION",
              message: submitResult.result.message,
              shouldStop: true,
            };
          }

          // 检查是否需要重新获取ticket
          if (submitResult.result && submitResult.result.needRefreshTicket) {
            ticketRefreshCount++;
            console.log(
              `🔄 [${accountId}] ticket已过期，准备重新获取 (${ticketRefreshCount}/${maxTicketRefresh})`
            );

            logTicketExpired(accountInfo, ticketRefreshCount);

            if (ticketRefreshCount >= maxTicketRefresh) {
              const errorMsg = `已达到最大ticket刷新次数 (${maxTicketRefresh})，停止尝试`;
              console.error(`💥 [${accountId}]`, errorMsg);
              logFinalResult(accountInfo, false, errorMsg);

              return {
                success: false,
                error: errorMsg,
              };
            }

            console.log(`🔄 [${accountId}] 立即重新获取ticket...`);
            continue;
          } else {
            logFinalResult(
              accountInfo,
              false,
              submitResult.error || submitResult.result?.error
            );

            return {
              success: false,
              error:
                submitResult.error ||
                submitResult.result?.error ||
                "提交预约失败",
            };
          }
        } catch (error) {
          throw error;
        }
      }

      const errorMsg = `超过最大ticket刷新次数 (${maxTicketRefresh})`;
      logFinalResult(accountInfo, false, errorMsg);

      return {
        success: false,
        error: errorMsg,
      };
    } catch (error) {
      console.error(`💥 [${accountId}] 抢购流程执行失败:`, error.message);

      logFinalResult(accountInfo, false, error.message);
      logError(accountInfo, "完整抢购流程", error);

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 执行单个步骤并处理网络错误
   * @param {Function} stepFunction - 要执行的步骤函数
   * @param {Object} proxyManager - 独立代理管理器
   * @param {Object} accountInfo - 账户信息
   * @param {string} stepName - 步骤名称
   * @returns {Promise<Object>} 执行结果
   */
  async executeStepWithProxyManager(
    stepFunction,
    proxyManager,
    accountInfo,
    stepName
  ) {
    const accountId = `${accountInfo.name}(${accountInfo.phone})`;

    try {
      const result = await stepFunction();
      // 检查结果是否表示需重新获取票据
      if (
        result &&
        result.success === false &&
        result.result.needRefreshTicket
      ) {
        return {
          success: false,
          result,
        };
      }
      return {
        success: true,
        result: result,
      };
    } catch (error) {
      // 检查是否为重复提交错误
      if (error.message?.includes("DUPLICATE_SUBMISSION:")) {
        const originalMessage = error.message.replace(
          "DUPLICATE_SUBMISSION: ",
          ""
        );
        return {
          success: false,
          result: {
            success: false,
            error: "DUPLICATE_SUBMISSION",
            message: originalMessage,
            shouldStop: true,
            code: error.code,
            originalData: error.originalData,
          },
        };
      }

      const isNetErr =
        proxyManager.isNetworkError(error) ||
        error.message?.includes("NETWORK_ERROR:");

      if (!error.message?.includes("NETWORK_ERROR:")) {
        logNetworkErrorDetection(accountInfo, error, isNetErr);
      }

      if (isNetErr) {
        const originalMessage = error.message?.includes("NETWORK_ERROR:")
          ? error.message.replace("NETWORK_ERROR: ", "")
          : error.message;

        console.log(
          `⚠️ [${accountId}] 检测到网络错误 (${stepName}): ${originalMessage}`
        );

        const newProxyInfo = await proxyManager.switchProxy();

        if (newProxyInfo) {
          console.log(
            `🔄 [${accountId}] 新代理获取成功，重新执行 ${stepName}...`
          );

          try {
            const result = await stepFunction();
            return {
              success: true,
              result: result,
            };
          } catch (retryError) {
            const originalRetryMessage = retryError.message?.includes(
              "NETWORK_ERROR:"
            )
              ? retryError.message.replace("NETWORK_ERROR: ", "")
              : retryError.message;
            console.error(
              `💥 [${accountId}] 使用新代理重试 ${stepName} 仍然失败:`,
              originalRetryMessage
            );
            return {
              success: false,
              error: retryError.message,
              result: null,
            };
          }
        } else {
          console.error(
            `💥 [${accountId}] 无法获取到可用代理，${stepName} 执行失败`
          );
          return {
            success: false,
            error: `无法获取到可用代理，${stepName} 执行失败`,
            result: null,
          };
        }
      } else {
        return {
          success: false,
          error: error.message,
          result: null,
        };
      }
    }
  }

  /**
   * 显示执行结果汇总
   * @param {Array} results - 执行结果数组
   */
  displaySummary(results) {
    console.log("\n🎯 ================ 抢购结果汇总 ================");

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.length - successCount;

    console.log(`📊 总计: ${results.length} 个账户`);
    console.log(`✅ 成功: ${successCount} 个`);
    console.log(`❌ 失败: ${failCount} 个`);
    console.log(
      `📈 成功率: ${Math.round((successCount / results.length) * 100)}%`
    );

    console.log("\n📋 详细结果:");
    results.forEach((result, index) => {
      const accountId = `${result.accountInfo.name}(${result.accountInfo.phone})`;
      const status = result.success ? "✅ 成功" : "❌ 失败";
      const message = result.success
        ? result.message || "抢购成功"
        : result.error;
      const proxy = result.usedProxy || "unknown";

      console.log(
        `   ${
          index + 1
        }. [${accountId}] ${status} - ${message} (代理: ${proxy})`
      );
    });

    console.log("=====================================\n");
  }

  /**
   * 预备模式：提前获取和分配代理IP，但不开始抢购
   * @param {Array} accountList - 账户列表
   * @param {number} proxyType - 代理类型
   * @returns {Promise<void>}
   */
  async executePrepareMode(accountList, proxyType) {
    console.log(
      `📋 进入预备模式：为 ${accountList.length} 个账户预先分配代理IP...`
    );

    // 初始化
    this.results.clear();
    this.runningTasks.clear();
    this.proxyQueue = [];
    this.accountQueue = [...accountList]; // 复制账户列表
    this.completedAccounts.clear();
    this.proxyValidationTasks.clear();
    this.preparedAccounts = new Map(); // 存储已准备好的账户
    multiProxyFactory.clear();

    // 存储当前代理类型
    this.currentProxyType = proxyType;

    // 启动代理获取和验证流程
    await this.startContinuousProxyValidation(proxyType, accountList.length);

    console.log("✅ 预备模式完成：所有代理IP已获取并分配完成");
    console.log(
      `📊 已准备账户: ${this.preparedAccounts.size}/${accountList.length}`
    );

    // 显示预备状态信息
    this.displayPreparedAccounts();
  }

  /**
   * 开始抢购流程：启动所有已准备好的账户
   * @returns {Promise<Array>} 所有账户的执行结果
   */
  async startPurchaseFlow() {
    console.log("🎯 启动所有已准备账户的抢购流程...");

    if (!this.preparedAccounts || this.preparedAccounts.size === 0) {
      throw new Error("没有已准备好的账户，请先执行预备模式");
    }

    // 为所有已准备的账户启动抢购任务
    const startTime = Date.now();
    for (const [accountId, accountData] of this.preparedAccounts.entries()) {
      const { account, proxyManager } = accountData;

      console.log(`🚀 [${accountId}] 立即启动抢购任务...`);

      // 启动抢购任务
      const task = this.executeFlowWithProxyManager(account, proxyManager).then(
        (result) => {
          this.results.set(accountId, {
            accountInfo: account,
            ...result,
            usedProxy:
              proxyManager.getCurrentProxy()?.server +
              ":" +
              proxyManager.getCurrentProxy()?.port,
          });
          console.log(
            `✅ [${accountId}] 抢购任务完成: ${
              result.success ? "成功" : "失败"
            }`
          );
          return result;
        }
      );

      this.runningTasks.set(accountId, task);
    }

    // 等待所有任务完成
    console.log(`⏳ 等待所有 ${this.preparedAccounts.size} 个账户抢购完成...`);
    await Promise.all(Array.from(this.runningTasks.values()));

    const endTime = Date.now();
    const totalTime = ((endTime - startTime) / 1000).toFixed(2);

    // 收集结果
    const finalResults = Array.from(this.results.values());

    console.log(`⏱️ 总执行时间: ${totalTime} 秒`);

    // 显示汇总结果
    this.displaySummary(finalResults);

    return finalResults;
  }

  /**
   * 显示已准备账户的状态
   */
  displayPreparedAccounts() {
    console.log("\n📋 已准备账户状态:");
    let index = 1;
    for (const [accountId, accountData] of this.preparedAccounts.entries()) {
      const { proxyManager } = accountData;
      const proxy = proxyManager.getCurrentProxy();
      if (proxy) {
        console.log(
          `   ${index}. [${accountId}] 代理: ${proxy.server}:${proxy.port} (${proxy.validatedIP})`
        );
      } else {
        console.log(`   ${index}. [${accountId}] 代理: 未分配`);
      }
      index++;
    }
    console.log("");
  }
}

// 创建全局动态多账户执行器实例
export const dynamicMultiAccountExecutor = new DynamicMultiAccountExecutor();
