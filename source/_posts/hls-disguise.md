---
title: HLS文件生成与伪造
date: 2024-05-17 14:08:36
tags:
- VIDEO
- HLS
- HTTP LIVE STREAMING
- 视频床
---

> HLS(HTTP Live Streaming)是视频点播和直播应用很普遍的技术，2022年发生过服务器被灰产上传大量伪造的PNG格式的图片，图片实际内容包含了HLS视频流TS文件。这样盗版网站就可以用我们服务器的流量来做他们的盗版业务，真是无本万利。最近研究了一下为啥图片内容被修改播放器还能播放的问题。

## HLS文件格式

HLS通过把视频内容拆分成多个小文件来避免传统的MP4格式文件头很大、首次加载很慢的问题。HLS包含两种文件，一个是视频索引文件m3u8，可以分多级索引，二级索引可以包含不同码率的TS（Transport Stream）文件。

参考：[HLS的M3U8文件介绍](https://zhuanlan.zhihu.com/p/162947124)

使用ffmpeg可以很方便的将视频文件生成HLS需要的m3u8索引文件和TS文件，命令如下：


```shell
# 将video.mp4的前一分钟视频拆分，大概每5秒一个文件
ffmpeg -i data/video.mp4 -to 00:01:00 \
    -c:v copy -c:a copy -f segment \
    -segment_time 5 -map 0 \
    -segment_list video.m3u8 \
    video_%03d.ts
```

## 文件伪装

灰产往往将TS文件伪装成正常的图片文件（PNG/JPG），然后寻找互联网上各种系统的上传漏洞，将这些TS文件上传上去，制作一个成对应的m3u8索引文件。高端一点的还会把m3u8文件也上传到另一些公司的系统里，盗版视频网站通过这些m3u8地址提供盗版视频的播放，当然用的是受害公司的服务器或者CDN流量，简直不要太坏！

一般来说直接将TS文件追加到图片文件之后就可以让很多软件正常打开图片了，或者将TS数据伪装成正常图片数据块应该也可以做到。

参考：[浅谈图片格式](./image-formats-and-disguise.md)


## 视频播放

我来一直很奇怪为啥被篡改的PNG/JPG在视频播放器里可以正常解码播放视频，看了HLS播放器[hls.js](https://github.com/video-dev/hls.js)的源代码并进行DEBUG之后稍微了解了一点。

TS文件流中包含一个Segment，每个段包含若干个Packet，每个Packet以0x47开始，长度为188个字节，一般来说Segment中的前两个包是两种固定格式的包，分别为PAT和PMT，所以hls.js在读取TS视频流进行解码时，会将读取指针seek到Segment起始位置，忽略掉前面的数据。寻找Segment起始地址的主要判断条件是`data[i] == 0x47 && data[i + 188] == 0x47`。

详情见源码: 

- [hls.js SeekOffset](https://github.com/video-dev/hls.js/blob/master/src/demux/tsdemuxer.ts#L97)
- [hls.js](https://github.com/video-dev/hls.js/blob/master/src/demux/tsdemuxer.ts#L259)

从上面的代码可以看出，如果图片原始的数据中相隔188字节出现0x47的话，很容易让hls.js认为发现了Segment，而如果其后面的数据不是连续的Packet则会返回-1，相当于没有找到，解码的时候就会从0开始，这种情况解码的时候就会出现错误。

所以并不是任意的图片都可以用来伪造TS文件，有几个办法来规避这个问题：

- 图片尺寸尽量小，比如1X1，如果图片大小小于188字节，则根本不会出现间隔188字节出现两个0x47
- 手动消除掉图片中的0x47值，如果图片不压缩，可以手动把图片像素中值中的0x47给替换掉，然后重新编码生成新图片

在测试hls.js的时候，发现小图片比较容易正常工作，大图片会导致Chrome浏览器的一些appendBuffer操作失败，具体原因还不知道，或许图片数据没有被完全跳过导致的。


参考：

- [HLS M3U8 TS](https://juejin.cn/post/6919464519387332616)