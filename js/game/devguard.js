// devguard.js — 公开版占位实现
//
// 私有仓库里这个模块是"调试入口防爆破 + 陷阱"：PBKDF2 口令校验、蜜罐令牌、诱饵密码、
// 守卫状态自签名。那些东西一旦公开就等于把防护实现连 salt 一起交出去，
// 所以公开版整体换成这个空壳：保留同名导出让 24 处调用点照常工作，
// 但不含任何密钥、salt 或陷阱逻辑，调试入口在公开版里**不可进入**。
//
// 如果你想在公开版里保留开发者面板（比如方便别人跑测试），
// 把 verify() 改成一个你自己的判断即可 —— 但不要把私有版那套搬过来。

export const DevGuard = {
  MAX_FAILS: 0,

  /** 公开版没有封禁概念，永远返回 false，让调用方的"未封禁"分支照常走 */
  isBanned() { return false; },

  /** 剩余尝试次数：调用方只在密码框里显示，这里给个占位值 */
  remaining() { return 0; },

  /** 口令校验：公开版一律拒绝，调试入口因此不可达 */
  async verify() { return false; },

  state() { return { ban: false, fails: 0, log: [] }; },
  device() { return {}; },
  log() { return []; },

  // 以下四个在私有版里负责埋蜜罐、查篡改、计数与封禁；公开版无对应机制，全部空实现
  plantCanary() {},
  checkTamper() {},
  fail() { return false; },
  succeed() {},
  ban() {},
  _clear() {},
};

/** 采集设备信息：私有版会把它写进失败日志，公开版没有日志可写，返回空对象即可 */
export function deviceInfo() { return {}; }

export default DevGuard;
