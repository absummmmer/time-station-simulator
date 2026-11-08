# 台站信号参考

本文件记录模拟器实现的四台授时信号的发播结构。界面显示和控制见
[MANUAL.md](MANUAL.md)。

## BPM（中国，国家授时中心）

| 项目 | 实现 |
| --- | --- |
| 频率 | 2.5 / 5 / 10 / 15 MHz |
| 秒脉冲 | 1 kHz |
| 时码 | 125 Hz 副载波 BCD，1 bit/s；200 ms 为 0、480 ms 为 1、800 ms 为定位标记 |
| 时码帧 | 60 bit/min，包含分、时、日、月、年、UT1 改正与闰秒预告字段 |
| UT1 / 呼号 | 按 BPM 的 UTC / UT1 / 呼号时段发播 |
| 默认时码音量 | 0%（需要时在电台控制中手动提高） |

时码定位标记为 P1=9 s、P2=19 s、P3=29 s、P4=39 s、P5=49 s、P0=59 s。
UT1 改正值在 50–54 s 发送，bit 50 为符号，51–54 为 0.1 s BCD 数值。

BPM 的 `+BCD` 状态表示在常规授时信号上叠加 125 Hz 副载波时码，区别于
WWV/WWVH 的 100 Hz BCD。

## WWV（美国，NIST）

参考：[NIST WWV](https://www.nist.gov/pml/time-and-frequency-division/time-distribution/radio-station-wwv)、
[WWV/WWVH Digital Time Code](https://www.nist.gov/pml/time-and-frequency-division/time-distribution/radio-station-wwv/wwv-and-wwvh-digital-time-code)。

| 项目 | 实现 |
| --- | --- |
| 频率 | 2.5 / 5 / 10 / 15 / 20 MHz；25 MHz 实验广播 |
| 秒脉冲 | 1000 Hz，5 ms；前 10 ms 与后 25 ms 静音 |
| 整分标记 | 1000 Hz，800 ms |
| 整点标记 | 1500 Hz，800 ms |
| 无秒脉冲 | 每分钟 29 s、59 s |
| 音调 | 500 / 600 / 440 Hz，按分钟表轮换 |
| 时码 | 100 Hz BCD 子载波，每秒 1 bit |
| UT1 | 前 16 秒双 tick：1–8 为正，9–16 为负，每个 0.1 s；BCD 使用 bit 50 符号与 bit 56–58 的 0.1/0.2/0.4 s |
| 语音 | 每分钟一次，整分前报时；整点和呼号另有安排 |
| 呼号 | 0、30 分 |

## WWVH（美国，NIST）

参考：[NIST WWVH](https://www.nist.gov/pml/time-and-frequency-division/time-distribution/radio-station-wwvh)。

| 项目 | 实现 |
| --- | --- |
| 频率 | 2.5 / 5 / 10 / 15 MHz |
| 秒脉冲 | 1200 Hz，5 ms；前后静音结构与 WWV 相同 |
| 整分标记 | 1200 Hz，800 ms |
| 整点标记 | 1500 Hz，800 ms |
| 无秒脉冲 | 每分钟 29 s、59 s |
| 音调 | 500 / 600 / 440 Hz，分钟表与 WWV 不同 |
| 时码 | 与 WWV 共用 100 Hz BCD 结构 |
| UT1 | 双 tick 与 BCD 规则同 WWV |
| 语音 | 比 WWV 更早开始报时 |
| 呼号 | 29、59 分 |

## RWM（俄罗斯）

参考：Wikipedia *RWM*、ITU-R TF.768-2 Table 1 / Figure 1。

| 项目 | 实现 |
| --- | --- |
| 频率 | 4.996 / 9.996 / 14.996 MHz |
| 模式 | N0N / A1A（CW）；无时码、无语音 |
| 0–8 分、30–38 分 | 未调制载波 |
| 8–9 分、38–39 分 | 发射机关闭 |
| 9–10 分、39–40 分 | Morse 呼号 “RWM RWM RWM…”，55 s 处硬截断 |
| 10–20 分、40–50 分 | 1 Hz 脉冲：整分 500 ms，其余 100 ms；含 DUT1/dUT1 双脉冲 |
| 20–30 分、50–60 分 | 10 Hz 脉冲：普通 20 ms，整秒 40 ms，整分 500 ms |
| 停发 | 每个 10 分钟脉冲模式最后一分钟的 55–59 秒 |

Morse 时序：点 70 ms、划 210 ms、点间隔 70 ms、字母间隔 210 ms、词间隔
630 ms。

RWM 的 DUT1 规则：

- 1–8 秒表示正值，9–16 秒表示负值；
- 双脉冲的第二个脉冲从秒后 200 ms 开始；
- dUT1：正值在 21–24 秒，负值在 31–34 秒，步进 0.02 s。

RWM 不发送一天中的时刻，只发送标准时间间隔和 DUT1/dUT1。CW 载波本身没有
可听音频，模拟器提供 BF 拍频（100–4000 Hz，默认 4000 Hz）用于试听。

## 默认电平

WWV/WWVH 的默认峰值比例依据 NIST SP 432 中 100 / 50 / 50 / 75 的调制关系：

| 分量 | 相对电平 | 默认绝对峰值 |
| --- | ---: | ---: |
| 秒脉冲、整分/整点标记 | 1.00 | 0.56 |
| 标准音调 | 0.50 | 0.28 |
| 100 Hz BCD 时码 | 0.50 | 0.28 |
| 语音 | 0.75 | 0.42 |

BPM 的 1 kHz 脉冲使用相同 0.56 峰值；BCD 在 100% 时为脉冲的一半，200% 时与
脉冲等响。RWM 的脉冲和 Morse 呼号也使用 0.56 峰值。

## 参考资料

- 蒙智谋《BPM 短波时码授时发播技术方案》，《时间频率学报》2014, 37(3):
  145–150，DOI `10.13875/j.issn.1674-0637.2014-03-0145-06`
- NIST SP 432, *NIST Time and Frequency Services*
- ITU-R TF.768-2
- 各台站官方网站及公开信号规范

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
