/**
 * 常用网站主域名与友好别名映射字典
 */
export const BUILTIN_ALIASES = {
  // 综合与社群
  'bilibili.com': 'B站',
  'zhihu.com': '知乎',
  'github.com': 'GitHub',
  'gitee.com': 'Gitee',
  'gitlab.com': 'GitLab',
  'youtube.com': 'YouTube',
  'v2ex.com': 'V2EX',
  'juejin.cn': '掘金',
  'segmentfault.com': '思否',
  'csdn.net': 'CSDN',
  'cnblogs.com': '博客园',
  'stackoverflow.com': 'StackOverflow',
  'npmjs.com': 'npm',

  // 社交与资讯
  'weibo.com': '微博',
  'douban.com': '豆瓣',
  'xiaohongshu.com': '小红书',
  'x.com': 'X',
  'twitter.com': 'X',
  'reddit.com': 'Reddit',
  'facebook.com': 'Facebook',
  'instagram.com': 'Instagram',

  // 搜索与 AI 工具
  'google.com': 'Google',
  'baidu.com': '百度',
  'bing.com': 'Bing',
  'openai.com': 'ChatGPT',
  'chatgpt.com': 'ChatGPT',
  'claude.ai': 'Claude',

  // 电商与购物
  'taobao.com': '淘宝',
  'tmall.com': '天猫',
  'jd.com': '京东',
  'pinduoduo.com': '拼多多',
  'amazon.com': 'Amazon',

  // 音视频娱乐
  'youku.com': '优酷',
  'iqiyi.com': '爱奇艺',
  'douyu.com': '斗鱼',
  'huya.com': '虎牙',
  'twitch.tv': 'Twitch',
  'netflix.com': 'Netflix',
  'spotify.com': 'Spotify',

  // 协同办公与文档
  'feishu.cn': '飞书',
  'larksuite.com': 'Lark',
  'dingtalk.com': '钉钉',
  'notion.so': 'Notion',
  'yuque.com': '语雀',
};

/**
 * 获取域名的展示标题（优先命中自定义别名 > 内置映射 > 原始域名）
 * @param {string} domain 原始域名 (如 bilibili.com)
 * @param {Object} [options]
 * @param {boolean} [options.useFriendlyNames=true] 是否启用友好别名
 * @param {Object} [options.customAliases={}] 用户自定义别名键值对
 * @returns {string} 分组展示标题
 */
export function getGroupTitle(domain, { useFriendlyNames = true, customAliases = {} } = {}) {
  if (!domain || typeof domain !== 'string') return '';
  if (!useFriendlyNames) return domain;

  const lower = domain.toLowerCase().trim();

  // 1. 用户自定义最高优先级
  if (customAliases && typeof customAliases === 'object' && customAliases[lower]) {
    return String(customAliases[lower]).trim() || domain;
  }

  // 2. 内置字典
  if (BUILTIN_ALIASES[lower]) {
    return BUILTIN_ALIASES[lower];
  }

  return domain;
}
