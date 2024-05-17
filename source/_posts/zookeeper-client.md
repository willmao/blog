---
title: ZooKeeper客户端基本使用
date: 2022-08-22 21:57:36
tags:
- Software
- Zookeeper
---

![ZooKeeper](/images/Apache_ZooKeeper_logo.svg)

## 客户端构造

使用ZooKeeper客户端和ZooKeeper集群交互时主要使用啊`org.apache.zookeeper.ZooKeeper`类，此类常用构造器签名如下:

``` Java
public ZooKeeper(String connectString, int sessionTimeout, Watcher watcher)throws IOException
```

ZooKeeper客户端建立连接为异步方式，其参数含义如下：

- connectString 逗号分隔的服务器列表，客户端会打乱顺序并逐个尝试连接直到可以成功连接
- sessionTimeout 会话超时时间，其区间范围为[2 * TickTime, 20 * TickTime]
- watcher 默认监听器，连接发生变化时将会调用此监听器的`process`方法，有些异步方法指定watch参数为`true`时将使用此watcher监听节点变化

使用ZooKeeper客户端必须谨慎处理连接状态变化，部分场景下客户端可以通过重连恢复会话，部分场景则必须手动重新建立连接，所以如果使用原生ZooKeeper客户端建议将ZooKeeper客户端包装一层再使用，在包装类里进行自动重连操作。
更简单的做法是用`Apache Curator`(https://curator.apache.org/index.html)框架。

ZooKeeper包装类示例：

```Java
package com.will.zk;

import org.apache.zookeeper.WatchedEvent;
import org.apache.zookeeper.Watcher;
import org.apache.zookeeper.ZooKeeper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.Closeable;
import java.io.IOException;
import java.util.concurrent.CountDownLatch;

/**
 * ZK操作包装类，会话过期时自动重新构造新客户端
 */
public class ZKOperator implements Closeable, AutoCloseable, Watcher {
    private static final Logger LOGGER = LoggerFactory.getLogger(ZKOperator.class);

    private final String servers;
    private final int timeout;
    private final CountDownLatch latch;

    private ZooKeeper zooKeeper;

    public ZKOperator(String servers, int timeout) {
        this.servers = servers;
        this.timeout = timeout;
        this.latch = new CountDownLatch(1);

        try {
            connect();
        } catch (IOException e) {
            LOGGER.error("failed to connect to servers: " + servers, e);
        }

        try {
            latch.await();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }

        if (zooKeeper == null) {
            throw new IllegalStateException("failed to init zookeeper connection");
        }
    }

    private void connect() throws IOException {
        zooKeeper = new ZooKeeper(servers, timeout, this);
    }

    private void reconnect() {
        int retries = 0;
        while (true) {
            retries ++;
            try {
                if (!zooKeeper.getState().equals(ZooKeeper.States.CLOSED)) {
                    break;
                }

                zooKeeper.close();
                LOGGER.info("ZooKeeper Connection Closed, Reconnect");
                connect();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            catch (IOException e) {
                LOGGER.warn(String.format("failed to reconnect for %s times", retries));
            }
        }
    }

    @Override
    public void process(WatchedEvent event) {
        Event.KeeperState state = event.getState();

        switch (state) {
            case SyncConnected:
                LOGGER.info("ZooKeeper SyncConnected");
                latch.countDown();
                break;
            case Expired:
                LOGGER.warn("ZooKeeper Session Expired, Reconnect");
                reconnect();
                break;
            case Disconnected:
                LOGGER.warn("ZooKeeper Client Disconnected From Servers, Waiting For Auto-Reconnect");
                break;
            default:
                LOGGER.info(String.format("ZooKeeper Client Current State: %s, Do Nothing", state));
                break;
        }
    }

    public ZooKeeper getZooKeeper() {
        return zooKeeper;
    }

    @Override
    public void close() {
        ZooKeeper copy = zooKeeper;
        if (copy != null) {
            try {
                copy.close();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    public static void main(String[] args) {
        try(ZKOperator operator = new ZKOperator("localhost:2181", 1000)) {
            System.out.println(operator.getZooKeeper().getSessionId());
        }
    }
}
```

## 监听节点数据变化

ZooKeeper客户端监听数据变化方法为`getData`，一次只能监听一个节点，并且只触发一次，当数据变化事件触发之后需要重新注册watcher，此外当会话过期时watcher也不会恢复，需要重新注册。

```Java
package com.will.zk;

import org.apache.zookeeper.AsyncCallback;
import org.apache.zookeeper.KeeperException.Code;
import org.apache.zookeeper.WatchedEvent;
import org.apache.zookeeper.Watcher;
import org.apache.zookeeper.ZooKeeper;
import org.apache.zookeeper.data.Stat;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public abstract class ZNodeDataMonitor implements AsyncCallback.DataCallback {
    private static final Logger LOGGER = LoggerFactory.getLogger(ZNodeDataMonitor.class);

    private final ZooKeeper zk;
    private final String path;

    public ZNodeDataMonitor(ZooKeeper zk, String path) {
        this.zk = zk;
        this.path = path;
    }

    protected void watchData() {
        zk.getData(path, this::process, this, null);
    }

    /**
     * 处理状态变化，注意当ZK连接断开时需要重新watch
     * @param event 事件
     */
    private void process(WatchedEvent event) {
        if (event.getType() == Watcher.Event.EventType.NodeDataChanged
                || event.getState() == Watcher.Event.KeeperState.Expired) {
            watchData();
        }
    }

    @Override
    public void processResult(int rc, String path, Object ctx, byte[] data, Stat stat) {
        Code code = Code.get(rc);

        if (code == Code.OK) {
            try {
                onChange(path, data, stat.getVersion());
            } catch (Exception e) {
                LOGGER.error("failed to handle data change: ", e);
            }
        }
    }

    abstract void onChange(String path, byte[] data, int version);
}
```

抽象类使用示例

```Java
package com.will.zk;

import org.apache.zookeeper.ZooKeeper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.concurrent.CountDownLatch;

public class NumberNodeDataMonitor extends ZNodeDataMonitor {
    private static final Logger LOGGER = LoggerFactory.getLogger(NumberNodeDataMonitor.class);

    // 监控3次数据变化
    private static final CountDownLatch latch = new CountDownLatch(3);

    public NumberNodeDataMonitor(ZooKeeper zk, String path) {
        super(zk, path);
    }

    @Override
    void onChange(String path, byte[] data, int version) {
        LOGGER.info(String.format("路径: %s 数据发生变化，新数据: %s, 版本号: %s", path, new String(data), version));
        latch.countDown();
    }


    public static void main(String[] args) throws InterruptedException, IOException {
        String servers = "localhost:2181";
        int timeout = 1000;
        String path = "/numbers";
        ZooKeeper zk = new ZooKeeper(servers, timeout, event -> {});
        new NumberNodeDataMonitor(zk, path).watchData();
        latch.await();
    }
}
```

## 监控子节点变化

ZooKeeper客户端方法`getChildren`可以接收到子节点创建和删除事件，子节点数据变化时不会通知。

```Java
package com.will.zk;

import org.apache.zookeeper.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;

public abstract class ZNodeChildrenMonitor implements AsyncCallback.ChildrenCallback {
    private static final Logger LOGGER = LoggerFactory.getLogger(ZNodeChildrenMonitor.class);

    private final ZooKeeper zk;
    private final String path;

    public ZNodeChildrenMonitor(ZooKeeper zk, String path) {
        this.zk = zk;
        this.path = path;
    }

    public void watchChildren(){
        zk.getChildren(path, this::process, this, null);
    }

    private void process(WatchedEvent event) {
        if (event.getType() == Watcher.Event.EventType.NodeChildrenChanged
                || event.getState() == Watcher.Event.KeeperState.Expired) {
            watchChildren();
        }
    }

    @Override
    public void processResult(int rc, String path, Object ctx, List<String> children) {
        KeeperException.Code code = KeeperException.Code.get(rc);
        if (code == KeeperException.Code.OK) {
            try {
                onChange(path, children);
            } catch (Exception e) {
                LOGGER.error("failed to handle children change: ", e);
            }
        }
    }

    abstract void onChange(String path, List<String> childNodeNames);
}
```

抽象类使用示例

```Java
package com.will.zk;

import org.apache.zookeeper.ZooKeeper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.CountDownLatch;

public class NumberChildrenMonitor extends ZNodeChildrenMonitor {
    private static final Logger LOGGER = LoggerFactory.getLogger(NumberChildrenMonitor.class);

    private static final CountDownLatch latch = new CountDownLatch(5);

    public NumberChildrenMonitor(ZooKeeper zk, String path) {
        super(zk, path);
    }

    @Override
    void onChange(String path, List<String> childNodeNames) {
        LOGGER.info(String.format("路径: %s 子节点发生变化, 当前节点数量: %s", path, childNodeNames.size()));
        latch.countDown();
    }

    public static void main(String[] args) throws InterruptedException, IOException {
        String servers = "localhost:2181";
        int timeout = 1000;
        String path = "/numbers";
        ZooKeeper zk = new ZooKeeper(servers, timeout, event -> {});

        NumberChildrenMonitor monitor = new NumberChildrenMonitor(zk, path);
        monitor.watchChildren();
        latch.await();
    }
}
```