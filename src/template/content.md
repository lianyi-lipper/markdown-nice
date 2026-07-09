# Markdown 排版教程

这里是本地默认模板，整合了 markdown 语法 16 关速查，覆盖标题、列表、代码块、数学公式等常用语法。

打开编辑器后你能在右侧预览区看到所有示例的渲染效果（取决于你选择的主题）。当你准备好写自己的内容时，**全选删除即可**。

---

## 第1关：标题

# 一级标题

## 二级标题

### 三级标题

---

## 第2关：无序列表

- 无序列表 1
- 无序列表 2
  - 无序列表 2.1
  - 无序列表 2.2

---

## 第3关：有序列表

1. 有序列表 1
2. 有序列表 2
3. 有序列表 3

---

## 第4关：引用

一级引用如下：

> ### 一级引用示例
>
> 读一本好书。 **——歌德**

二级引用如下：

>> ### 二级引用示例
>>
>> 读一本好书。 **——歌德**

三级引用如下：

>>> ### 三级引用示例
>>>
>>> 读一本好书。**——歌德**

---

## 第5关：粗体和斜体

**这个是粗体**

*这个是斜体*

***这个是粗体加斜体***

---

## 第6关：链接

[示例链接](https://example.com)

图片还可以和链接嵌套使用，能够实现推荐卡片的效果，用法如下：

[![示例链接卡片](images/card.png)](https://example.com)

*（该卡片预览图为 AI 生成）*

---

## 第7关：分割线

使用三个或以上的短横线 `---` 即可创建分割线：

---

效果如上所示。

---

## 第8关：删除线

~~这是要被删除的内容。~~

---

## 第9关：表格

| 姓名       | 年龄 |         工作 |
| :--------- | :--: | -----------: |
| 小可爱     |  18  |     吃可爱多 |
| 小小勇敢   |  20  |   爬棵勇敢树 |
| 小小小机智 |  22  | 看一本机智书 |

---

## 第10关：图片

![这里写图片描述](images/basic.jpg)

![同时设置宽度和高度](images/fixed.jpg =150x150)

![只设置宽度，推荐使用百分比](images/percent.jpg =40%x)

---

## 第11关：脚注

[全栈工程师](是指掌握多种技能，并能利用多种技能独立完成产品的人。 "什么是全栈工程师")

---

## 第12关：代码块

```java
// FileName: HelloWorld.java
public class HelloWorld {
  // Java 入口程序，程序从此入口
  public static void main(String[] args) {
    System.out.println("Hello,World!"); // 向控制台打印一条语句
  }
}
```

支持以下语言种类：

```
bash
clojure，cpp，cs，css
dart，dockerfile, diff
erlang
go，gradle，groovy
haskell
java，javascript，json，julia
kotlin
lisp，lua
makefile，markdown，matlab
objectivec
perl，php，python
r，ruby，rust
scala，shell，sql，swift
tex，typescript
verilog，vhdl
xml
yaml
```

diff 效果：

```diff
+ 新增项
- 删除项
```

---

## 第13关：数学公式

行内公式：$\ce{Hg^2+ ->[I-] HgI2 ->[I-] [Hg^{II}I4]^2-}$

块公式：$$H(D_2) = -\left(\frac{2}{4}\log_2 \frac{2}{4} + \frac{2}{4}\log_2 \frac{2}{4}\right) = 1$$

---

## 第14关：TOC

[TOC]

## 二级标题

### 三级标题

---

## 第15关：注音符号

这个编辑器支持{注音|zhù yīn}语法。

---

## 第16关：横屏滑动幻灯片

<![图1](images/slide-1.jpg),![图2](images/slide-2.jpg),![图3](images/slide-3.jpg)>

---

教程结束。准备好后，**Ctrl+A 删除全文**，开始你自己的内容。
