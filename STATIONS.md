# Station Signal Reference

[English](STATIONS.md) | [简体中文](STATIONS.zh-CN.md)

This document records the transmission structures implemented by the simulator.
For display and controls, see [MANUAL.md](MANUAL.md).

## BPM (China, National Time Service Center)

| Item | Implementation |
| --- | --- |
| Frequencies | 2.5 / 5 / 10 / 15 MHz |
| Second pulse | 1 kHz |
| Time code | 125 Hz subcarrier BCD, 1 bit/s; 200 ms = 0, 480 ms = 1, 800 ms = position marker |
| Time-code frame | 60 bits/min, including minute, hour, day, month, year, UT1 correction, and leap-second fields |
| UT1 / identification | BPM UTC / UT1 / call periods |
| Default time-code level | 0% (raise it in Station controls when needed) |

Position markers are P1=9 s, P2=19 s, P3=29 s, P4=39 s, P5=49 s, P0=59 s.
UT1 correction is sent in the 50–54 s field: bit 50 is the sign and bits 51–54
are the 0.1 s BCD magnitude.

BPM's `+BCD` status means the 125 Hz subcarrier time code was added to the normal
signal; it is different from WWV/WWVH's 100 Hz BCD.

## WWV (United States, NIST)

References: [NIST WWV](https://www.nist.gov/pml/time-and-frequency-division/time-distribution/radio-station-wwv),
[WWV/WWVH Digital Time Code](https://www.nist.gov/pml/time-and-frequency-division/time-distribution/radio-station-wwv/wwv-and-wwvh-digital-time-code).

| Item | Implementation |
| --- | --- |
| Frequencies | 2.5 / 5 / 10 / 15 / 20 MHz; 25 MHz experimental |
| Second pulse | 1000 Hz, 5 ms; 10 ms silence before and 25 ms after |
| Minute marker | 1000 Hz, 800 ms |
| Hour marker | 1500 Hz, 800 ms |
| No second pulse | Seconds 29 and 59 of each minute |
| Tones | 500 / 600 / 440 Hz on a minute schedule |
| Time code | 100 Hz BCD subcarrier, 1 bit/s |
| UT1 | First 16 seconds: double tick on seconds 1–8 for positive and 9–16 for negative, 0.1 s each; BCD uses bit 50 sign and bits 56–58 for 0.1/0.2/0.4 s |
| Voice | Once per minute before the minute boundary; hour and identification announcements follow their own schedule |
| Identification | Minutes 0 and 30 |

## WWVH (United States, NIST)

Reference: [NIST WWVH](https://www.nist.gov/pml/time-and-frequency-division/time-distribution/radio-station-wwvh).

| Item | Implementation |
| --- | --- |
| Frequencies | 2.5 / 5 / 10 / 15 MHz |
| Second pulse | 1200 Hz, 5 ms; same silence structure as WWV |
| Minute marker | 1200 Hz, 800 ms |
| Hour marker | 1500 Hz, 800 ms |
| No second pulse | Seconds 29 and 59 of each minute |
| Tones | 500 / 600 / 440 Hz; minute schedule differs from WWV |
| Time code | Same 100 Hz BCD structure as WWV |
| UT1 | Same double-tick and BCD rules as WWV |
| Voice | Starts earlier than WWV |
| Identification | Minutes 29 and 59 |

## RWM (Russia)

References: Wikipedia *RWM*; ITU-R TF.768-2 Table 1 / Figure 1.

| Item | Implementation |
| --- | --- |
| Frequencies | 4.996 / 9.996 / 14.996 MHz |
| Mode | N0N / A1A (CW); no time code or voice |
| 00–08, 30–38 min | Unmodulated carrier |
| 08–09, 38–39 min | Transmitter off |
| 09–10, 39–40 min | Morse “RWM RWM RWM…”, hard cutoff at 55 s |
| 10–20, 40–50 min | 1 Hz pulses: 500 ms on the minute, 100 ms otherwise; DUT1/dUT1 double pulses |
| 20–30, 50–60 min | 10 Hz pulses: 20 ms normally, 40 ms on whole seconds, 500 ms on the minute |
| End of pulse mode | No pulses at seconds 55–59 of the last minute |

Morse timing: dot 70 ms, dash 210 ms, intra-character gap 70 ms, letter gap
210 ms, word gap 630 ms.

RWM DUT1 rules:

- seconds 1–8 indicate positive values, seconds 9–16 negative;
- the second pulse of a DUT1 pair starts 200 ms after the second;
- dUT1: positive at seconds 21–24, negative at 31–34, in 0.02 s steps.

RWM does not send the time of day; it sends standard intervals and DUT1/dUT1. The
CW carrier itself has no audible audio, so the simulator provides a BF beat
frequency (100–4000 Hz, default 4000 Hz) for listening.

## Default levels

WWV/WWVH default peak ratios follow the NIST SP 432 100/50/50/75 relationship:

| Component | Relative level | Default absolute peak |
| --- | ---: | ---: |
| Second pulses, minute/hour markers | 1.00 | 0.56 |
| Standard tones | 0.50 | 0.28 |
| 100 Hz BCD time code | 0.50 | 0.28 |
| Voice | 0.75 | 0.42 |

BPM's 1 kHz pulses use the same 0.56 peak; BCD at 100% is half the pulse peak and
at 200% equals it. RWM pulses and Morse also use the 0.56 peak.

## References

- 蒙智谋, “BPM 短波时码授时发播技术方案,” *时间频率学报*, 2014, 37(3):
  145–150, DOI `10.13875/j.issn.1674-0637.2014-03-0145-06`
- NIST SP 432, *NIST Time and Frequency Services*
- ITU-R TF.768-2
- Official station sites and published signal specifications

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
