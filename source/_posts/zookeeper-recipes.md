---
title: zookeeper常用场景
date: 2022-08-23 21:08:54
excerpt: 本文简要叙述了ZooKeeper的一些常见实用场景，比如同步屏障、分布式队列
tags:
- Software
- Zookeeper
---

## 同步屏障Barrier

当同步屏障存在时，所有客户端都进行等待，直到屏障被删除客户端开始执行自己的逻辑。可以利用ZK的节点删除事件通知来实现它。

``` Java
package com.will.zk;

import org.apache.zookeeper.*;
import org.apache.zookeeper.data.Stat;
import org.apache.zookeeper.KeeperException.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;

public class ZKBarrier<T> implements AsyncCallback.StatCallback {
    private static final Logger LOGGER = LoggerFactory.getLogger(ZKBarrier.class);


    private final ZooKeeper zk;
    private final String path;
    private final CompletableFuture<?> future;

    private boolean needWatch;

    public ZKBarrier(ZooKeeper zk, String path, CompletableFuture<?> future) {
        this.zk = zk;
        this.path = path;
        this.future = future;
        this.needWatch = true;
    }

    public void watchBarrier() {
        zk.exists(path, this::process, this, future);
    }

    private void process(WatchedEvent event) {
        LOGGER.info("接收到zk事件回调");
        if (needWatch) {
            watchBarrier();
        }
        if (event.getType() == Watcher.Event.EventType.NodeDeleted) {
            LOGGER.info("node被删除");
            needWatch = false;
        }
    }

    @Override
    public void processResult(int rc, String path, Object ctx, Stat stat) {
        Code code = Code.get(rc);

        if (code == Code.NONODE) {
            CompletableFuture<?> future  = ctx instanceof CompletableFuture<?> ? (CompletableFuture<?>) ctx: null;
            if (future != null) {
                future.complete(null);
            }
        }
    }

    private static Thread createThread(ZooKeeper zk, String path, CountDownLatch latch) {
        Thread t = new Thread(() -> {
            CompletableFuture<Integer> future = new CompletableFuture<>();
            ZKBarrier<Integer> barrier = new ZKBarrier<>(zk, path, future);
            LOGGER.info("watch barrier");
            barrier.watchBarrier();
            try {
                future.get();
            } catch (InterruptedException e) {
                e.printStackTrace();
                Thread.currentThread().interrupt();
            } catch (ExecutionException e) {
                e.printStackTrace();
            }

            LOGGER.info("barrier missing, begin to work");
            latch.countDown();
        });

        t.setDaemon(true);

        return t;
    }

    public static void main(String[] args) throws InterruptedException, KeeperException, IOException {
        String servers = "localhost:2181";
        int timeout = 1000;
        String path = "/barriers/barrier-1";

        ZooKeeper zk = new ZooKeeper(servers, timeout, event -> {});
        ZKOperator zkOperator = new ZKOperator(servers, timeout);
        zkOperator.create(path, "".getBytes(StandardCharsets.UTF_8));

        CountDownLatch latch = new CountDownLatch(2);
        createThread(zk, path, latch).start();
        createThread(zk, path, latch).start();

        latch.await();
    }
}
```

## 分布式队列

主要利用ZK创建子节点时节点名称可以单调递增的特性，通过获取子节点对节点名称进行排序即可实现队列先进先出的行为。

``` Java
package com.will.zk;

import org.apache.zookeeper.*;
import org.apache.zookeeper.data.ACL;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.CountDownLatch;

public class DistributedQueue {
    private static final Logger LOGGER = LoggerFactory.getLogger(DistributedQueue.class);

    private final ZooKeeper zk;
    private final String queueName;

    private final List<ACL> acl = ZooDefs.Ids.OPEN_ACL_UNSAFE;

    public DistributedQueue(ZooKeeper zk, String queueName) {
        this.zk = zk;
        this.queueName = queueName;
    }

    private String getQueuePath() {
        return String.format("/queues/%s", queueName);
    }

    private SortedSet<String> orderedChildren(Watcher watcher) throws InterruptedException, KeeperException {
        List<String> childNodeNames;
        childNodeNames = zk.getChildren(getQueuePath(), watcher);

        return new TreeSet<>(childNodeNames);
    }

    private static class LatchChildWatcher implements Watcher {
        private final CountDownLatch latch;

        public LatchChildWatcher() {
            latch = new CountDownLatch(1);
        }

        @Override
        public void process(WatchedEvent event) {
            latch.countDown();
        }

        public void await() throws InterruptedException {
            latch.await();
        }
    }

    public void offer(byte[] data) throws InterruptedException, KeeperException {
        for (;;) {
            try {
                zk.create(getQueuePath() + "/", data, acl, CreateMode.PERSISTENT_SEQUENTIAL);
                return;
            } catch (KeeperException.NoNodeException e) {
                zk.create(getQueuePath(), "".getBytes(StandardCharsets.UTF_8), acl, CreateMode.PERSISTENT);
            }
        }
    }

    public byte[] take() throws InterruptedException, KeeperException {
        SortedSet<String> sortedSet;
        while (true) {
            LatchChildWatcher childWatcher = new LatchChildWatcher();
            sortedSet = orderedChildren(childWatcher);

            if (sortedSet.size() == 0) {
                childWatcher.await();
                continue;
            }

            String firstChild = sortedSet.first();
            String zNode = getQueuePath() + "/" + firstChild;
            LOGGER.info("get first znode of queue: " + zNode);
            try {
                byte[] data = zk.getData(zNode, false, null);
                zk.delete(zNode, -1);

                return data;
            } catch (KeeperException.NoNodeException e) {
                LOGGER.debug("node not exist, maybe deleted by another client");
            }
        }
    }

    public static void main(String[] args) throws InterruptedException, KeeperException, IOException {
        String servers = "localhost:2181";
        int timeout = 1000;
        ZooKeeper zk = new ZooKeeper(servers, timeout, event -> {});
        String queueName = "queue-01";
        DistributedQueue queue = new DistributedQueue(zk, queueName);

        queue.offer("222".getBytes(StandardCharsets.UTF_8));

        byte[] data = queue.take();
        System.out.println(new String(data));
    }
}

```

ZooKeeper不适合做通用消息队列，主要有以下几个原因：

- ZK消息写入需要集群协商，写入速度较慢
- ZK数据全部存放在内存中，不能支撑大量消息
- ZK子节点太多时`getChildren`返回很慢
- ZK对节点数据大小存在硬性限制

参考: https://cwiki.apache.org/confluence/display/CURATOR/TN4
