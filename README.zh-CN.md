# Time Station Simulator

[English](README.md) | [简体中文](README.zh-CN.md)

BPM、WWV、WWVH、RWM 四台短波授时信号的浏览器端多路模拟器。音频由 Web Audio
实时调度，时间基准与 DUT1 数据来自可自托管的
[`time-api`](https://github.com/absummmmer/time-api)（也可接入任何兼容该接口的服务）。

页面不包含任何内置后端地址。首次使用 `AUTO`、`SYNC` 或 `DUT1 AUTO` 时，需要填写
Time API 的基地址；地址只保存在当前浏览器中。

## 功能

- 四台同时运行，音量独立：
  - **BPM**：1 kHz 秒脉冲、UTC/UT1/呼号时段、可选 125 Hz 副载波 BCD 时码；
  - **WWV**：1000 Hz 秒脉冲、100 Hz BCD、分钟音调表、语音报时、呼号；
  - **WWVH**：1200 Hz 秒脉冲、100 Hz BCD、分钟音调表、语音报时、呼号；
  - **RWM**：1 Hz / 10 Hz 脉冲、DUT1 与 dUT1 双脉冲、Morse 呼号；
    BF 拍频可在 100–4000 Hz 之间调整。
- 四台共享同一 UTC/DUT1 时间基准，音频调度使用统一的 look-ahead 时钟。
- 支持网络同步、自动同步、同步审计日志和 clock trace；审计与 trace 在本地保留
  48 小时，可导出为 CSV。
- 同步间隔内会用最近的同步历史对稳定频偏做缓慢微调；最近同步状态显示
  `TRIM ±x.xxppm` 或 `TRIM HOLD`。
- 设备延迟档案：为耳机、声卡等不同输出设备保存独立补偿值；同一设备内还会慢速
  估计音频时钟偏差，并只校正音频调度倍率。
- NTP 观测信息来自后端，浏览器不直接访问 NTP。
- 单页静态应用；除配置的 Time API 外没有运行时外部依赖，不加载 CDN。
- 支持桌面和移动端布局，提供隐藏设置面板与禅模式。

## 快速开始

### 1. 启动 Time API

可使用配套的 [`time-api`](https://github.com/absummmmer/time-api)，默认监听
`http://localhost:8080`。在 `time-api` 目录中运行：

```bash
docker compose up -d --build
```

详细配置见配套的 [`time-api`](https://github.com/absummmmer/time-api) 项目。

### 2. 托管本目录

页面必须通过 HTTP(S) 访问，不能直接双击 `index.html`：

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000/
```

也可以部署到任意静态站点或反向代理。

### 3. 配置后端地址

首次启用 `AUTO`、点击 `SYNC` 或开启 DUT1 自动更新时，页面会弹出后端设置框。
填写 Time API 基地址，例如：

```text
http://localhost:8080
```

也可以直接粘贴 `/v1/time`、`/v1/time/ntp` 或 `/v1/dut1` 端点，页面会自动归一化为
基地址。需要反向代理路径前缀时，可直接填写带路径的基地址。

后端必须允许页面 origin 访问（CORS）。HTTPS 页面不能调用 HTTP 后端（localhost
除外）；生产环境建议让页面和 API 都走 HTTPS。

地址保存在当前浏览器的 `localStorage`。之后可从同步审计面板右上角的 🔌 修改，
或访问 `?setup=backend`。

## 浏览器要求

- 支持 Web Audio API 和 `AudioContext` 的现代浏览器；
- 首次播放需要用户手势（拖动主控音量即可）；
- 建议使用桌面版 Chrome、Edge、Firefox 或 Safari 的近期版本。

## 操作简介

- 拖动主时钟下方的主控音量开始播放；初始音量为 0。
- 点击任意台站右侧的百分比，一次展开或收起全部台站滑块。
- 点击状态行的 emoji 时钟打开时钟校准；点击 UT1 时间打开页面展示；点击台站
  状态打开电台控制。
- 点击主时钟的小时/分钟区域进入或退出禅模式。
- 详细界面与状态说明见 [MANUAL.zh-CN.md](MANUAL.zh-CN.md)。

## 目录结构

```text
index.html                 页面外壳
core.js                    配置、时间格式化、设置与状态
audio-engine.js            Web Audio 调度、台站总线和音效
time-sync.js               时间采样、同步审计、DUT1 与 trace 数据
observability.js           trace 图、NTP 详情、审计表和导出面板
app.js                     台站行、设置面板、音频控件和启动接线
styles.css                 自定义样式和组件样式
tailwind.css               预编译的 Tailwind CSS
tailwind.input.css         Tailwind 输入
tailwind.config.cjs        Tailwind 配置
audio/                     台站音频素材
dseg7-*.woff/.woff2        七段显示字体
tests/                     jsdom 测试套件
DEPLOY.md                  部署说明（英文）
MANUAL.md                  用户手册（英文）
MANUAL.zh-CN.md            用户手册（中文）
README.md                  本说明（英文）
README.zh-CN.md            本说明（中文）
STATIONS.md                台站信号参考（英文）
STATIONS.zh-CN.md          台站信号参考（中文）
THIRD_PARTY.md             第三方素材与许可（英文）
```

## 开发与构建

页面使用原生 JavaScript classic scripts，不需要打包器。修改 Tailwind utility
class 后重新生成 CSS：

```bash
npm install
npm run build:css
```

测试：

```bash
cd tests
npm install
npm test
```

测试直接用 jsdom 加载部署文件，不维护应用副本。详细列表见
[tests/README.md](tests/README.md)。

## 时间与精度说明

本项目的目标是生成与授时广播结构一致的背景音频，并提供一个便于日常计时的
页面时钟；它不是计量级 UTC 标准，也不是短波接收机的替代品。

- 页面显示与音频都依赖后端时间；后端上游、网络路径、音频输出链路和人工校准
  都会影响最终听到的相位。
- 设备延迟档案用于吸收本机音频链路差异，需要在更换耳机/声卡后重新校准。
- 音频调度使用单调时钟和慢速速率估计，避免系统墙钟跳变直接影响已排程音频。
- 频率微调只减少同步间隔内的稳定漂移，不能消除同步测量本身的不确定度
  （通常为几毫秒）或参考源台阶；每次同步仍会执行权威校正。

## 范围

- 模拟四台授时信号的发播结构和听感，不模拟电离层、衰落、同频干扰或接收机调谐。
- 不包含其他授时台。
- 不提供可追溯的 UTC 校准服务；对精度有严格要求的场景应使用专门的授时设备。

## 第三方与许可

WWV/WWVH 音频素材来自 [kalafut/wwv](https://github.com/kalafut/wwv)，MIT
License。DSEG7 字体使用 SIL Open Font License 1.1。完整说明和许可文本见
[THIRD_PARTY.md](THIRD_PARTY.md)、`THIRD_PARTY_WWV_LICENSE.txt`、
`DSEG7-LICENSE.txt` 与 `DSEG7-MINI-LICENSE.txt`。

本项目代码使用 MIT License，见 [LICENSE](LICENSE)。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
