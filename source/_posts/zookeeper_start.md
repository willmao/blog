---
title: zookeeper集群节点启动流程
date: 2022-08-19 22:24:49
excerpt: 本文简要叙述了ZooKeeper启动流程
tags:
- 软件
---

![Zookeeper](/images/Apache_ZooKeeper_logo.svg)

> 因为公司的ZooKeeper当年部署方式不当，导致运行两三年之后经常出现问题，所以最近稍微看了一下ZooKeeper源代码，理解了一下ZooKeeper启动流程，故作此文以志之。

## 端口介绍

ZooKeeper默认使用以下三个TCP端口：

- 2181 用于接受客户端连接和读写请求
- 2888 用于数据同步通信，只有Leader节点监听，Follower连接此端口接受通知
- 3888 用于投票选举通信端口

## 重要概念

ZooKeeper系统中有几个比较重要的数字:

- epoch 选举的代数，每次选举成功后会自动加1，此指也是选举判断Leader节点的一个首要依据
- zxid 事务ID，64位，前32位为Epoch，后32位为自增事物ID，此指也是选举时使用的一个重要依据
- myid 节点ID，标志ZooKeeper身份，此值在集群第一次启动时也会作为选举依据，值大的节点优先

## 启动流程

ZooKeeper以集群方式部署时启动流程如下（部分不涉及主流程的线程图中忽略）

```mermaid
flowchart TD
  start_jvm[启动zkServer.sh]
  start_jvm -- 读取配置文件 ---> cnxn_factory[构造客户端监听线程]
  cnxn_factory ---> load_database[加载已有数据库]
  load_database -- 获取epoch/zxid ---> start_theads[启动监听线程2181/3888]
  start_theads ---> start_fast_leader_election[开始快速选举]
  start_fast_leader_election -- 广播发送/接收投票信息 ---> change_peer_state{Is Leader?}
  change_peer_state --->|Yes| make_zk_leader[创建ZooKeeper Leader节点]
  change_peer_state ---> |No| make_zk_follower[创建ZooKeeper Follower节点]
  make_zk_leader ---> listen_leader_port[Leader启动监听2888]
  make_zk_follower ---> connect_to_leader[连接到Leader 2888端口]
  listen_leader_port ---> process_client_request[处理客户端请求]
  connect_to_leader ---> sync_from_leader[从Leader节点同步修改]
```

## 选举算法

ZooKeeper从磁盘文件中读取myid/epoch/zxid，使用FastLeaderElection算法进行投票选举，两个节点之间判断依据如下：

- epoch值大的节点获胜
- epoch相同，最新zxid值大的节点获胜
- epoch/zxid相同，节点ID值大的节点获胜

ZooKeeper集群第一次部署时，epoch和zxid都是0，下图描述了第一次集群选举过程

```mermaid
sequenceDiagram
  actor N1 as Node 1
  actor N2 as Node 2
  actor N3 as Node 3

  par 第一轮
    N1 -->> N2: MyID: 1, Epoch 0, Zxid 0, Leader: 1, State: LOOKING
    N1 -->> N3: MyID: 1, Epoch 0, Zxid 0, Leader: 1, State: LOOKING
    N2 -->> N1: MyID: 2, Epoch 0, Zxid 0, Leader: 2, State: LOOKING
    N2 -->> N3: MyID: 2, Epoch 0, Zxid 0, Leader: 2, State: LOOKING
    N3 -->> N1: MyID: 3, Epoch 0, Zxid 0, Leader: 3, State: LOOKING
    N3 -->> N2: MyID: 3, Epoch 0, Zxid 0, Leader: 3, State: LOOKING
  end

  Note over N1,N3: Epoch/Zxid都相同，MyID最大的节点Node 3获胜

  par 第二轮
    N1 -->> N2: MyID: 1, Epoch 0, Zxid 0, Leader: 3, State: LOOKING
    N1 -->> N3: MyID: 1, Epoch 0, Zxid 0, Leader: 3, State: LOOKING
    N2 -->> N1: MyID: 2, Epoch 0, Zxid 0, Leader: 3, State: LOOKING
    N2 -->> N3: MyID: 2, Epoch 0, Zxid 0, Leader: 3, State: LOOKING
  end

  Note over N1,N3: Node 3获得多数投票，成为Leader节点，Node 1/2成为Follower
  par 第三轮
    N1 -->> N2: MyID: 1, Epoch 0, Zxid 0, Leader: 3, State: FOLLOWING
    N1 -->> N3: MyID: 1, Epoch 0, Zxid 0, Leader: 3, State: FOLLOWING
    N2 -->> N1: MyID: 2, Epoch 0, Zxid 0, Leader: 3, State: FOLLOWING
    N2 -->> N3: MyID: 2, Epoch 0, Zxid 0, Leader: 3, State: FOLLOWING
    N3 -->> N1: MyID: 3, Epoch 0, Zxid 0, Leader: 3, State: LEADING
    N3 -->> N2: MyID: 3, Epoch 0, Zxid 0, Leader: 3, State: LEADING
  end

  Note over N1,N3: 投票结束，Node 3打开2888端口，Node 1/2的连接此端口
```

## 状态变化

当ZooKeeper集群结束选举之后，各个节点进入对应的LEADING/FOLLOWING/OBSERVING状态并创建对应的ZooKeeper，集群进入稳定状态，节点开始处理客户端读写请求，如果发生异常情况，节点将会请求新一轮投票，
其状态变化如下图所示

```mermaid
stateDiagram-v2
    [*] --> RUNNING

    state RUNNING {
        [*] --> LOOKING
        LOOKING --> LEADING
        LOOKING --> FOLLOWING
        LOOKING --> OBSERVING

        LEADING --> LOOKING
        FOLLOWING --> LOOKING
        OBSERVING --> LOOKING
    }

    RUNNING --> [*]
```

> 一般来说当Follower节点同步Leader节点失败的时候会触发新一轮投票，比如读写超时