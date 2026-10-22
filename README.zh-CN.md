# claude-usage-card：把用量统计卡片带回桌面应用

一个 [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview)，把 Claude 桌面应用 Code 分页以前的用量统计卡片带回来。

[English](./README.md) · 社区非官方项目，与 Anthropic 无关，也未获其认可。

2026 年 10 月中旬以前，Code 分页的新对话画面会显示一张 Claude Code 用量卡片：对话数、消息数、token、活跃天数、每日热力图，还有 Models 分页。用户反映它在 Desktop v2.42304.0 之后消失了（[anthropics/claude-code#102961](https://github.com/anthropics/claude-code/issues/102961)、[#102098](https://github.com/anthropics/claude-code/issues/102098)），数据仍能通过 `/stats` 查看，但版面不同。usage-card 把这张卡片重新画出来，显示在对话旁边的面板里。

## 显示内容

时间范围：**All**、**30d**、**7d**，**↻** 手动刷新。对话开始时和之后每 10 分钟也会自动刷新。

**Overview**

- Sessions、Messages、Total tokens、Active days、Peak hour、Favorite model
- 当前和最长的连续使用天数
- 每日热力图，鼠标停在某天上会显示当天的 token 和消息数
- 你的 token 相当于几本《哈利·波特与魔法石》

**Models**

- 每日 token 柱状图，按模型分色
- 每个模型的 token、占比、输入、输出、缓存写入和缓存读取

## 什么时候打开

- 新对话里，发出第一条消息时自动打开。新对话的开始画面是应用自己的界面，插件画不进去，所以卡片没办法放回原来的位置。
- 其他时候输入 `/usage-card` 打开。手动关掉后，同一个对话里不会再自动弹出。

终端里也能显示同样的卡片，图表换成字符画的热力图和迷你折线。

## 安装

需要 **Python 3**，并能在 `PATH` 里以 `python`、`python3` 或 `py` 找到。已在 Windows 上的 Claude Code 2.1.304 测试过，用 `claude --version` 查看你的版本。

> **Mod 仍处于早期测试阶段。** 如果装好了却什么都没出现，可能你的环境还没开启 mod。在 `~/.claude/settings.json` 里加上下面这段，再开一个新对话：
>
> ```json
> "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" }
> ```
>
> 这会开启你安装的所有插件里的 mod，不只是这一个。运行 `claude --debug` 可以看到 mod 没有加载的原因。

在 Claude Code 的终端里：

```
/plugin install usage-card --marketplace Huuuuung/claude-usage-card
```

在命令行里：

```bash
claude plugin install usage-card --marketplace Huuuuung/claude-usage-card
```

在桌面应用里：点输入框旁边的 **+**，选 **Plugins**，用 **Add marketplace** 添加 `Huuuuung/claude-usage-card`，再点 **Add plugin**。

也可以不安装，克隆后直接试用：

```bash
git clone https://github.com/Huuuuung/claude-usage-card
claude --plugin-dir ./claude-usage-card
```

## 数字怎么算

数据来自这台电脑上的 Claude Code 对话记录 `~/.claude/projects/**/*.jsonl`（设置了 `CLAUDE_CONFIG_DIR` 时在它下面），不包括其他电脑、网页版和 claude.ai 聊天的用量。

- **每次回复只算一次。** Claude Code 会把一次回复拆成好几行记录（文字一行、每个工具调用各一行），每行都带着同一份用量数字；分叉和恢复的对话也会复制之前的记录。usage-card 按消息 id 和请求 id 去重。逐行相加的工具算出的 token 大约多一倍，旧卡片的总数看起来就是这样，所以你看到的数字可能比印象中低。
- **Total tokens** 是输入 + 输出 + 缓存写入。**缓存读取**（每次请求从缓存重新读回的旧上下文）通常大得多，单独列在 Models 分页。
- **Messages** 是你的提问加上 Claude 的回复。**Sessions** 是对话数，不含子代理。
- 日期和高峰时段按你电脑的本地时间计算。

## 隐私

所有数据都留在你的电脑上，usage-card 不发出任何网络请求。它读取上述对话记录，并把每次回复的计数缓存在 `~/.claude/cache/usage-card.json`，之后只重新读取有变化的记录。Claude Code 定期清理旧记录后，缓存里的计数仍会保留，所以旧的历史不会丢。删掉这个文件即可重新统计。

## 工作原理

`scripts/aggregate.py` 读取对话记录，输出每天的汇总 JSON；mod 本身（`hooks/register.tsx`）运行这个脚本并画出面板。mod 自己一次只能读 4 MiB 以内的文件，而对话记录经常更大，所以交给脚本处理。

用 `claude plugin test .` 运行测试，用 `claude plugin validate .` 检查 mod。

## 许可证

[MIT](./LICENSE)
