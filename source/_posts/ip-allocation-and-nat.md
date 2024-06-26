---
title: IP地址耗尽和NAT
date: 2024-05-22 06:28:05
excerpt: 本文根据IBM的《TCP/IP Tutorial and Technical Overview》简要摘录IP地址耗尽问题和网络地址转换（NAT）部分相关知识
tags:
- 计算机网络
---

## IP地址耗尽问题

可实际使用的公网IP地址主要是A/B/C三类，每类IP地址的网络数和容纳的主机数量如下：

- A 2^7 -2 = 126个网络，每个网络能容纳16777214个主机
- B 2^14 - 2 = 16382个网络，每个网络容纳65534个主机
- C 2^21 - 2 = 2097150个网络，每个网络容纳254个主机

在互联网发展早期，互联网中的网络数量大约每两年就翻倍，早期互联网中组织和机构申请的主要是B类IP地址，C类几乎没人申请，毕竟组织和机构都要考虑自己的网络中主机数量增长的需求，C类只能容纳254个主机，不太够用。按照这个趋势，B类地址很快就会被申请光了。为了缓解IP地址分配耗尽的问题，专家组提出一些更严格的分配策略：

- A类网络的上半部分(64到127)网络编号永久保留，以备将来转换到新的分配模式
- B类网络必须有充足的理由才能申请
    - 组织内部必须要划分32个或以上的子网
    - 组织必须拥有4096个主机
- 不满足B类网络的组织可以申请一段连续的C类网络，这些网络拥有共同的比特前缀

> 申请A类网络的组织也必须要满足申请B类网络的要求，A类地址申请每个案例单独处理

## 私有IP地址

因为组织内部并不是所有主机都需要公网IP，所以专家们提出了私有IP地址空间的概念：

- 10.0.0.0 一个单独的A类网络
- 172.16.0.0到172.31.0.0 16个连续的B类网络
- 192.168.0.0到192.168.255.0. 256个连续C类网络

任何组织可以使用上述IP地址段，因为这些地址在网络上不是唯一的，所有在公网上提供服务的路由器，会丢掉发往这些私有IP地址的数据报。机构内部使用私有IP地址的路由器，要么公布到私有IP的路由，要么转发包含私有IP地址的数据报到外部路由器。

被分配了私有IP地址的主机在IP层没有直接访问外部网络的能力，想要访问外部网络，必须使用应用层网关，比如SOCKS服务或者NAT（网络地址转换）。

## NAT

NAT又被称为IP地址伪装（IP masquerading），它提供了将私有IP地址映射到官方分配的公有IP地址的能力。有三种NAT:

- Traditional NAT 传统网络地址转换
- Basic NAT 基本网络地址转换
- NAPT 网络地址端口转换

### 传统NAT

传统NAT泛指所有基于NAT的技术和实现，它基于一个事实，就是私有网络中只有一部分主机需要网络，当主机需要网络访问时，就给它分配一个外部IP地址，这样就只需要少量公网IP地址就可以满足业务需求。

### 基本NAT

基本NAT拥有一个外部IP地址池，当私有IP地址需要访问外部网络时，就从IP地址池中获取一个可用外部IP地址，将IP数据报的源地址改成这个外部IP地址，同时记录私有IP地址和外部IP地址的映射关系。当外部网络有返回报文时，根据映射关系将数据报转发给私有IP地址。

因为IP数据报首部中包含Checksum，修改数据报中的源IP地址将导致数据报的Checksum发生变化，所以Checksum必须重新计算一次。因为存在部分协议比如FTP协议，其源IP地址在数据报的数据中，所以基本NAT也必须要能够识别这种情况并做处理。

### NAPT

NAPT在基本NAT的基础上增加了传输标志符，比如TCP/UDP的端口信息，或者是ICMP的查询ID信息。因为主机/路由器可以使用65535个端口，所以NAPT极大的减少了外部IP数量的需求。

### NAT的限制

如上所述，NAT主要通过修改IP数据报首部中的源IP信息来工作，所以它存在一些限制：

- 对于应用协议将IP地址写入IP报文数据中的情况需要特殊处理
- 修改IP报文需要大量计算，因为每个数据报都要检查和修改一遍
- 同一个会话的请求和响应数据报必须经过同一个路由器处理
- 不能处理乱序的TCP/UDP分段（fragment），因为只有第一个分段中包含会话信息，后续的分段中没有端口信息中，只有和第一个分段中相同的编号信息
- NAT在IP数据报中修改了IP信息，IPSEC检查数据报的完整性会失败，在IPSEC AH协议中修改任何一个比特位都会导致检查失败，IPSEC提供了ESP协议，将数据报封装在UDP数据报中，只检查封装报文的完整性，这也叫NAT-T（NAT Traversal，NAT穿透）

> 根据上面所说，NAT破坏了网络分层模型，工作在三层的IPSEC协议需要依赖四层的UDP协议才能在NAT下工作