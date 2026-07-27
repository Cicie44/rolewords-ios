# AGENTS.md

## Project

RoleWords（职词）是一款面向中文用户的 IT 职业英语单词学习与面试准备 iOS App。

Tagline:

> Words for your next role.

第一版只开发 iOS，不考虑 Android 和 Web。

## Core Product

RoleWords 的核心功能是背单词，不是实时聊天或口语练习。

默认词书：

- Developer
- Project Manager
- AI Research

每本词书最终约包含 500 个单词或短语。

每个学习项可以包含：

- 英文单词或短语
- 中文释义
- 词性
- 简短英文解释
- 英文例句
- 例句中文翻译
- 分类和标签
- 学习状态

用户可以将单词、短语或完整句子收藏到生词本。

## Interview Preparation

用户可以：

1. 上传 CV。
2. 填写岗位名称和公司名称。
3. 选择性填写 Job Description。
4. 获取大约 10 个 AI 生成的面试问题。
5. 在每个问题下选择性补充自己的经历和回答要点。
6. 生成大约 10 组个性化面试问答。
7. 将重要单词、短语或句子收藏到生词本。

行为类问题优先使用 STAR 结构，但不要强迫所有问题使用 STAR。

## v0.1 Scope

第一版需要：

- 开发测试账号
- 单词卡学习
- 三本默认词书
- 中英文释义和例句
- 学习状态
- 生词本
- CV 上传
- 岗位信息填写
- AI 面试问题生成
- AI 参考回答生成
- 面试历史记录

第一版不做：

- Speaking
- 发音评分
- 实时语音面试
- 英语水平测试
- Android
- Web
- 付费系统
- 社交功能

## Tech Stack

- Expo
- React Native
- TypeScript
- Expo Router
- Supabase
- Supabase Edge Functions
- AI API

AI API Key、Supabase Service Role Key 等敏感信息不能放在客户端代码中。

## Development Guidelines

- 保持实现简单，项目由一名开发者维护。
- 一次只完成一个边界明确的任务。
- 不要主动增加未要求的功能。
- 不要过度设计或引入复杂架构。
- 优先使用 Expo 和 React Native 官方能力。
- 添加新依赖前先解释用途。
- 用户界面以 iPhone 为主要设计目标。
- 用户可见内容需要考虑中英文显示。
- CV 和用户面试信息属于隐私数据。
- 不要在未经允许的情况下提交或推送代码。

## Working Process

开始任务前：

1. 简要说明准备修改什么。
2. 如果需求不明确，先提出问题。

完成任务后：

1. 总结修改内容。
2. 列出修改过的文件。
3. 说明如何测试。
4. 报告尚未解决的问题。
5. 等待确认后再进行下一项任务。

最后，用中文回答我
