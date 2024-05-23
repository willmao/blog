---
title: HaProxy获取客户端真实IP
date: 2024-02-19 14:15:37
excerpt: 本文叙述了通过代理服务器获取客户端真实IP地址的通用方法并给出了使用HaProxy在阿里云环境下获取客户端真实IP地址的配置示例
tags:
- 计算机网络
- HTTP协议
- HAProxy
---

应用程序部署时一般都会部署在高性能代理服务器后面，如HAProxy和Nginx，由这些代理服务器统一处理TLS握手、IP校验等工作。如何获取客户端真实IP是一个常见的问题，本文将简要叙述如何在HAProxy中获取客户端真实IP地址。

## 方法

常见应用程序部署结构如下：

client => [proxy1 => proxy2 => proxy3 =>] HAProxy

因为客户端到HAProxy之间可能存在若干个代理服务器，所以按照如下方法获取客户端IP，

- 如果客户端和服务器之间不存在代理服务器，直接用客户端IP作为真实IP
- 如果客户端和服务器之间存在代理服务器，从X-FORWARDED-FOR头中获取我们信任的最远的代理服务器（从后向前推）客户端IP作为真实IP

从X-FORWARDED-FOR头中提取真实IP时，一定要验证直接连接到HAProxy的客户端IP，因为非信任代理可以随意设置HTTP头，同时也要了解各个中间代理对HTTP头的修改行为。

## 案例

以部署在阿里云环境中的一个应用系统为例，流量请求流程如下：

client => waf => slb => HAProxy => application

因为waf和slb都会自动在请求头X-FORWARDED-FOR中添加客户端IP，所以我们可以通过如下HAPROXY规则获取客户端真实IP并保存到X-REAL-IP头中并打印到日志中。

```
# 阿里云slb地址范围为100.64.0.0/10
acl from_slb src 100.64.0.0/10
# /usr/local/etc/haproxy/waf_ip.list文件中包含waf回源IP地址列表
acl from_waf req.hdr_ip(X-Forwarded-For,-1) -f /usr/local/etc/haproxy/waf_ip.list
http-request set-header X-Real-IP %[req.hdr(X-Forwarded-For,-2)] if from_slb from_waf
http-request set-header X-Real-IP %[req.hdr(X-Forwarded-For,-1)] if from_slb !from_waf
http-request set-header X-Real-IP %[src] if !from_slb
http-request capture hdr(X-Real-IP) len 15
```