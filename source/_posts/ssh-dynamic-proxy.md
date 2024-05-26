---
title: ssh协议动态代理
date: 2024-05-15 22:06:06
excerpt: 本文简要叙述了SSH协议端口转发的原理，并重点研究了SSH动态代理的实现机制，给出了一个Go语言实现的多网卡SSH协议动态代理的实现
tags:
- 计算机网络
---

ssh是服务器管理中常用的一种远程工具，它可以在不安全的链路上提供一定程度的安全访问。它是建立在The Secure Shell Protocol上的，ssh协议主要包含Transport、Authentication和Connection三个子RFC。因为ssh协议比较普及，而且它提供了一定的安全访问链路，所以ssh协议也常被用来穿透网络。本文主要介绍ssh协议中的端口转发功能并重点介绍动态端口转发的实现方式。


## ssh转发方式

ssh有三种转发方式，分别是：

- 本地转发，将本机端口映射到远程服务器的端口(不一定是ssh server)，访问本机的流量将通过ssh隧道转发到远程服务器端口上
- 远程转发，将ssh服务器的端口映射到本地计算机的端口上(不一定是本机)，访问ssh服务器的端口的流量将通过ssh隧道转发到本地计算机的端口上
- 动态转发，将本机指定端口的请求，都通过ssh隧道转发出去，因为目标地址不确定，所以叫做动态代理，常用于http/https代理

## ssh代理的实现

不管哪种转发方式，都是在隧道基础上建立到目标服务器的连接，这时候代理服务器中存在一个连接对，一个是ssh的隧道连接，一个是到目标服务器指定端口的TCP连接，代理服务器只要转发这两个连接就行了。具体来说就是不停的读取输入方向的连接的数据，写入代理连接中，然后把代理连接的响应写入到输入连接中去即可。

## ssh动态端口转发

ssh动态端口转发常用于HTTP/HTTPS代理，ssh隧道建立命令一般如下：

```shell
ssh -ND local-port user@server-ip # N为不执行命令 D为动态转发
```

ssh客户端会在本机local-port上启动一个socks代理服务器监听，然后将访问此端口的请求都通过这个端口发送到ssh server上去，ssh server会转发这些请求。

那么问题来了，ssh server是怎么知道客户端连接的目标服务器呢？一种办法就是解析请求内容，HTTP请求中存在Host这个Header来标志目标服务器地址。这种办法在HTTPS上却不能工作，因为TLS连接建立之后，HTTP请求Header和Body都是通过加密传输的，ssh代理服务器也没有办法解析。
其实ssh协议中对于特定类型的请求，可以额外附带一些信息，ssh客户端就是通过额外信息来告诉ssh服务器自己的目标连接地址和端口。服务器解析
额外信息后即可获得目标地址，然后就可以建立到目标服务器的连接，接着就可以开始转发流量了。

golang中提供了ssh server的基础包，用它来可以很容易实现连接监听、用户认证和流量转发功能。用golang实现的ssh动态代理核心代码如下：

```golang
func processDirectTcpIpNewChannel(serverConn *ssh.ServerConn, newChannel ssh.NewChannel) {
	var payload forwardedTCPPayload
	if err := ssh.Unmarshal(newChannel.ExtraData(), &payload); err != nil {
		log.Println(err)
		newChannel.Reject(ssh.ConnectionFailed, "can't parse tcp forward payload")
	}

	log.Printf("process tcp port forwarding, host: %s, port: %d, origial host: %s, original port: %d\n", payload.Addr, payload.Port, payload.OriginAddr, payload.OriginPort)

	// use server local address to dial for supporting multiple network interfaces
	localAddr := serverConn.LocalAddr()

	tcpAddr, _ := net.ResolveTCPAddr(localAddr.Network(), localAddr.String())

	var dialerIp net.IP
	if !tcpAddr.IP.IsLoopback() {
		dialerIp = tcpAddr.IP
	}

	log.Printf("server local addr: %s, dialer ip: %s\n", localAddr.String(), tcpAddr.IP)
	dialer := net.Dialer{
		LocalAddr: &net.TCPAddr{IP: dialerIp},
	}

	remoteAddr := fmt.Sprintf("%s:%d", payload.Addr, payload.Port)
	conn, err := dialer.Dial("tcp", remoteAddr)
	if err != nil {
		log.Println(err)
		newChannel.Reject(ssh.ConnectionFailed, "connect to dest host failed")
		return
	}

	channel, requests, err := newChannel.Accept()
	if err != nil {
		log.Println(err)
		newChannel.Reject(ssh.ConnectionFailed, "failed to accept")
		return
	}

	go func(in <-chan *ssh.Request) {
		for req := range in {
			log.Println(req.Type)
		}
	}(requests)

	done := make(chan struct{})

	go forward(conn, channel, done)

	go forward(channel, conn, done)

	<-done
	<-done
}

func sshProxyConnectionManager(nConn net.Conn, config *ssh.ServerConfig, conns map[ssh.ServerConn]struct{}) {
	// Before use, a handshake must be performed on the incoming
	// net.Conn.
	conn, chans, reqs, err := ssh.NewServerConn(nConn, config)
	if err != nil {
		log.Println("failed to handshake: ", err)
		return
	}

	if conn.Permissions == nil {
		log.Printf("logged in with username %s", conn.Conn.User())
	} else {
		log.Printf("logged in with key %s", conn.Permissions.Extensions["username"])
	}

	conns[*conn] = struct{}{}

	go func() {
		ssh.DiscardRequests(reqs)
	}()

	// Service the incoming Channel channel.
	for newChannel := range chans {
		switch newChannel.ChannelType() {
		case DirectTcpIpChannelType:
			go processDirectTcpIpNewChannel(conn, newChannel)
		default:
			newChannel.Reject(ssh.UnknownChannelType, ssh.UnknownChannelType.String())
			continue
		}
	}
}

func sshProxy(l net.Listener, config *ssh.ServerConfig, done chan bool) {
	running := true
	conns := make(map[ssh.ServerConn]struct{}, 10)

	go func() {
		<-done
		if len(conns) > 0 {
			log.Println("begin to close all current connections")
			for conn := range conns {
				conn.Close()
			}
		}

		log.Println("close listener")
		l.Close()
		running = false
	}()

	var wg sync.WaitGroup
	log.Println("begin to accept ssh connections")
	wg.Add(1)
	for running {
		nConn, err := l.Accept()
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				log.Println("listener closed, quit accept loop")
				wg.Done()
				break
			} else {
				wg.Done()
				log.Fatal("failed to accept incoming connection: ", err)
			}
		}

		go sshProxyConnectionManager(nConn, config, conns)
	}

	wg.Wait()
}
```

上述代码实现了一个ssh代理服务器中一个常见的小需求，即如果服务器上有多个网卡有公网IP，则希望ssh流量从哪个网卡进入，就通过哪个网卡转发。上述代码通过判断ssh连接连接到ssh服务器的本机IP（即网卡地址）来使用其对应的地址来建立代理连接。这样可以让一个代理服务器拥有多个公网IP，减少服务器成本，毕竟代理服务器的负载很低。

这个需求也可以根据用户ID来修改路由表实现，参考: [Per-UID routing](https://superuser.com/questions/1585398/how-can-i-configure-the-source-ip-to-use-for-ssh-dynamic-forwards)