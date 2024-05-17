---
title: 浅谈图片格式
date: 2024-05-17 11:06:03
tags:
- Image Formats
- Image Disguise
- 图片格式
- 图片检验
- 图片伪造
---

> 2022年服务器中被上传了不少恶意伪装的图片，虽然文件看起来是1x1的PNG格式图片并且浏览器里也能正常显示，但是这些文件大小却从数百KB到数MB不等。分析访问日志后发现这些图片其实是伪造的，其内部包含了MPEG-2格式的视频片段。最近又遇到了类似情况，索性研究一下各种图片格式的编码结构。

## 图片基本概念

### 颜色深度

位图中用于表示每一个像素的颜色所用的二进制比特位数，常用单位为位/像素（bpp）。颜色深度越高，可用色彩越多。常见的有以下几种：

- 1位 2中颜色，黑白两色
- 8位 256中颜色，其中特殊情况为灰阶图像，RGB三个颜色相同，如（200，200，200）
- 24位 16777216种颜色，超过人眼能识别的颜色种类，所以又叫真彩色
- 32位 基于24，增加8位支持Alpha通道，支持图像透明显示

### 颜色亮度

表示人眼对发光体或被照射物体表面的发光或反射光强度实际感受的物理量, 单位烛光每平方米（cd/m2），旧称尼特（nit）

## 常见图片格式

目前，我们常见的图片格式主要有以下几种：

- JPEG
- PNG
- GIF
- BMP

下面将逐个介绍各个视频格式的简要编码方法及其伪造方法。



## JPEG

由联合图像专家小组(Joint Photographic Experts Group)开发的一种有损压缩的图片格式，文件名常见后缀`.jpeg`和`.jpg`。它将RGB格式的颜色转换成YUV（亮度、色调和饱和度）格式的色彩空间，因为人眼对亮度变化的敏感度比颜色变化要高，所以YUV三个分量可以按照不同比例进行抽样，UV可以采用更低的抽样比例，从而达到压缩图片的效果。

JPEG适合颜色平滑变化的图片，因为这中情况下在保证图片质量的情况下，可以大幅度压缩。它不适合线条绘图，容易导致图片失真。

在微信中发送图片，如果不选择原图发送，则默认微信会使用JPEG格式发送，会导致图片被压缩而失真。

## PNG

便携式网络图形（Portable Network Graphics）由W3C提出的支持无损压缩的位图图形格式。因为它支持无损压缩，所以一般PNG图片比JPEG格式的要大。PNG编码格式比较简单，主要包含文件头和多个数据块，文件头固定为`0x89504e470d0a1a0a`，数据块格式如下：

- 长度(Length) 四个字节，最大为2G-1个字节
- 数据块类型 四个字节，数据块类型ASCII码的字节表示，数据块类型为四个字符
- 数据块数据 可变长度，存储数据块实际数据
- CRC码 四个字节，用来存储校验码

PNG数据块有两种，一种是必须包含、读写软件都必须要支持的关键块，另一种是辅助块。为了向前兼容，PNG规范中允许软件忽略它不认识的附加块。

### GIF

图像互换格式（Graphics Interchange Format），是一种位图图形文件格式。互联网早起带宽小的时候提出来的无损压缩图片格式，只能表示256中颜色。可以通过插入多帧图片实现动画效果。

### BMP

微软开发的位图格式，一般不压缩，图片存储格式比较简单。


## 图片伪造

基于上面的信息，如何构造一个可以正常打开而又包含我们向塞入的额外数据呢，


方法一：直接向文件默认追加数据

一般软件在读取文件时，读取到EOF时就停止了，额外数据直接被忽略掉，图片也能正常打开。这种办法的一个缺点是你想读取额外数据的时候可能需要特殊处理，因为一些编程语言的IO库也是读取到EOF终止读取了。

方法二：构造合法的数据块存入文件中

以PNG格式为例，PNG格式中可以定义辅助数据块，只要按照格式计算好CRC循环校验码即可构造出一个合法的辅助块，将此辅助块插入PNG支持的位置即可。构造PNG数据块的Go语言示例如下：

```golang
func generatePngChunk(name string, data []byte) ([]byte, error) {
	if len(name) != 4 {
		return nil, errors.New("IDAT type name must be 4 letters")
	}
	// name := "fRAc"
	n := uint32(len(data))

	if int(n) != len(data) {
		return nil, errors.New(name + " chunk is too large: " + strconv.Itoa(len(data)))
	}

	header := make([]byte, 8)
	footer := make([]byte, 4)
	binary.BigEndian.PutUint32(header[:4], n)
	header[4] = name[0]
	header[5] = name[1]
	header[6] = name[2]
	header[7] = name[3]

	crc := crc32.NewIEEE()
	crc.Write(header[4:8])
	crc.Write(data)
	binary.BigEndian.PutUint32(footer[:4], crc.Sum32())

	result := make([]byte, 0)
	result = append(result, header...)
	result = append(result, data...)
	result = append(result, footer...)

	return result, nil
}
```

上述函数中的数据块名称要填写PNG标准中支持的值，否则一些软件会直接报告文件损坏。上述方法想要从文件中获取额外数据也需要自己写客户端实现。


## 图片格式检测

1. 检测图片文件头信息中的文件格式是否和文件后缀匹配
2. 检验图片文件大小是否和图片长宽估算的文件大小匹配
3. 检验图片尾块后是否还有数据，比如PNG格式文件尾块12个字节为`0x0000000049454e44ae426082`
4. 检验图片中是否包含异常数据块



参考:

- [JPEG](https://zh.wikipedia.org/wiki/JPEG)
- [PNG](https://zh.wikipedia.org/wiki/PNG)
- [GIF](https://zh.wikipedia.org/wiki/GIF)
- [BMP](https://zh.wikipedia.org/zh-cn/BMP)