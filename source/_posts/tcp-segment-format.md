---
title: TCP分段数据格式
date: 2024-05-28 16:01:40
excerpt: 本文根据IBM的《TCP/IP Tutorial and Technical Overview》简要摘录TCP分段相关知识
tags:
- 计算机网络
---

## TCP分段

TCP分段（Segment）格式如下：

```mermaid
erDiagram
    bytes SourcePort    "发送方端口，2字节"
    bytes DestPort      "接收方端口，2字节"
    bytes SeqNumber     "序列号，4字节"
    bytes AckNumber     "确认号，4字节"
    bits DataOffset     "数据偏移，4位，4字节为单位"
    bits Reserved       "保留，3位"
    bits Flags          "标志符，9位"
    bytes Window        "窗口大小，2字节"
    bytes Checksum      "校验和，2字节"
    bytes UrgentPointer "紧急指针，2字节"
    bytes Options       "选项字段，最多40字节"
    bytes Padding       "有选项时填充到4字节对齐"
    bytes Data          "分段数据，可变长度"
```

SeqNumber: 分段中第一个字节的序列号，如果是SYN分段，序列号就是起始序列号（n），分段第一个字节就是n+1，这也是为啥三次握手时ACK的值是n+1

AckNumber: 如果ACK控制位设置了则此值包含接收方期待收到的下一个字节序列号

DataOffset: 表示数据段的偏移量，单位是4字节，它表示了数据段的开始位置

Flags共有9位，其含义分别如下：

- NS-ECN-nonce ECN显式拥塞通知（Explicit Congestion Notification）
- CWR 拥塞窗口减少
- ECE-ECN-Echo 根据SYN标志位有不同含义
- URG 高优先级数据包标志位，为1的话紧急指针字段有效
- ACK 确认号字段
- PSH 为1表示带有PUSH标志位，指示接收方应该尽快把报文段交给应用层而不用等待缓冲区装满
- RST 为1表示出现严重错误，需要重建TCP连接，也可以用于拒绝非法报文段和拒绝连接请求
- SYN 为1表示是请求连接或者是连接接收请求，用于建立连接和同步序列号
- FIN 为1表示发送方没有数据要传输了，要求释放连接

Window：在ACK报文段中使用，它定义了从AckNumber开始接收方想接收多少个字节

Checksum: 对IP伪首部/TCP首部和TCP数据进行计算得出的校验和，计算时Checksum字段本身当作0来计算

> IP伪首部和UDP协议类似，都是3个字节，分别包含源IP/目的IP/8位0/8位协议/16位长度信息

Urgent Pointer: 紧急指针，指示紧急数据的偏移量，只有在URG标志位为1时才有效

Options: 和IP数据报选项类似，本文仅列举几种重要的类型

- 2 最大报文段长度（Maximum segment size，MSS）建立连接时接收方设置，用于指明自己能处理的最大报文段长度，未指定则任意大小即可
- 3 窗口扩大因子 取值0-14，用来把TCP窗口的值左移的位数，使窗口值翻倍。只能出现在同步报文段中，否则将会被忽略
- 4 SackOK 发送端支持并同意使用SACK (Selective Acknowledgment)选项
- 5 Sack选项 允许接收方通知发送方所有已经接收到的报文段，因此发送方只需要重发丢失的报文段即可。为了防止大量报文丢失导致Sack选项数据太大，只允许报告4个分段区间，Sack选项中也值应该报告最近接收到的数据段信息

