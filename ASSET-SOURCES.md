# 素材来源

以下记录素材来源与文件身份，不代表本项目拥有录音或角色版权。权利说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 内置音频

来源：[lin-alg/NaiLoong](https://github.com/lin-alg/NaiLoong)，固定提交 `fc5d92ba3a6434aef4cda638d1247d540b5d3993`。文件保留上游名称与原始字节；界面按用途显示音源名称，不将文件名作为原作者或角色归属的独立证明。

| 本地文件 | 固定来源 | 字节数 | 解码时长 | 声道 |
| --- | --- | ---: | ---: | ---: |
| `public/audio/nailong_laugh.mp3` | [MP3](https://raw.githubusercontent.com/lin-alg/NaiLoong/fc5d92ba3a6434aef4cda638d1247d540b5d3993/assets/audio/nailong_laugh.mp3) | 125804 | 15.649977 秒 | 1 |
| `public/audio/hola_ganbadie.mp3` | [MP3](https://raw.githubusercontent.com/lin-alg/NaiLoong/fc5d92ba3a6434aef4cda638d1247d540b5d3993/assets/audio/hola_ganbadie.mp3) | 27600 | 1.806599 秒 | 2 |
| `public/audio/gajiaosai.mp3` | [MP3](https://raw.githubusercontent.com/lin-alg/NaiLoong/fc5d92ba3a6434aef4cda638d1247d540b5d3993/assets/audio/gajiaosai.mp3) | 10265 | 1.109751 秒 | 2 |
| `public/audio/gagadilashui.mp3` | [MP3](https://raw.githubusercontent.com/lin-alg/NaiLoong/fc5d92ba3a6434aef4cda638d1247d540b5d3993/assets/audio/gagadilashui.mp3) | 12403 | 1.297914 秒 | 2 |
| `public/audio/dupu.mp3` | [MP3](https://raw.githubusercontent.com/lin-alg/NaiLoong/fc5d92ba3a6434aef4cda638d1247d540b5d3993/assets/audio/dupu.mp3) | 10596 | 1.194467 秒 | 2 |

时长在 44.1 kHz Web Audio 离线上下文中解码测得，不代表文件原始编码采样率。文件哈希如下：

| 文件 | Git blob SHA | SHA-256 |
| --- | --- | --- |
| `nailong_laugh.mp3` | `93ea9b3ac4a456871fbc4bbcc5d8740e0122cdfa` | `716c2d58d02c6543057a7adf6637b8224886f6f0d7c06ffa34bfdf18dde72c33` |
| `hola_ganbadie.mp3` | `875be8ecaf4aca21441b05a5888935eb85b37b11` | `45a94b77be6302d0f271461028f3ba48158e7662db585349aa21767a11525c6a` |
| `gajiaosai.mp3` | `9772871d709652346e0ada1619c2c8f5fbb7536d` | `e227e71610d8525f4c0706cb08ef50a18b1d3757374e47a17ed33cd1836e1162` |
| `gagadilashui.mp3` | `d80d32daaa5200a11b605e5bbdb1115ee0abd097` | `e4266f466e352659e3bb705383a0a73cd1740ac679849a037be5219457103d9e` |
| `dupu.mp3` | `0b703574c85d66a766427ccb2f75754df184ea39` | `38d353ef56b7ad8b9b38c1ade0ffb51d298fd34b622c77fe8c14eaaa7eef4dab` |

### 裁切参考

时间以文件开头为零点，单位为秒。以下建议来自波形能量分析，用于快速起音，不是词语边界标注。应用在播放时裁切，不改变原始 MP3。

| 音源 | 短片段 | 较完整的范围 |
| --- | --- | --- |
| 大笑 | `0.04–0.40`；`2.65–2.82` | 全长约 15.65 秒，可自由裁切 |
| hola / ganbadie | `0.135–0.73` | `0.13–1.80` |
| gajiaosai | `0.14–0.32` | `0.13–1.03` |
| gagadilashui | `0.13–0.29`；`0.50–0.69` | `0.13–1.27` |
| dupu | `0.14–0.66` | `0.13–1.14` |

## 界面角色图片

- 文件：`public/assets/naiwa.png`
- 来源：使用 Image Gen 生成的透明背景奶蛙角色图，用于界面展示。
- SHA-256：`54f5347ed4825366d3176885151ad2d6f1b9e571b67cec6cabb1ac7358d364d3`
- 角色本身的权利不因图像生成或代码 MIT 许可而改变。

## GIF 参考链接

以下原始 GIF 作为来源记录保留链接，**不随本仓库分发**：

- [奶蛙大笑 GIF](https://raw.githubusercontent.com/musemantic/NaiLoong/ab974a47c2a5e731a22ff9f5a7f23f60e62c3fd9/assets/memes/naiwa_0028.gif)
- [来源仓库文件](https://github.com/musemantic/NaiLoong/blob/ab974a47c2a5e731a22ff9f5a7f23f60e62c3fd9/assets/memes/naiwa_0028.gif)
- 固定提交：`ab974a47c2a5e731a22ff9f5a7f23f60e62c3fd9`
- 原始大小：886889 字节；108 × 144 像素；86 帧；一轮 4.3 秒。
- Git blob SHA：`e9503c885d22e4281876e4b0c334703753d00c78`
- SHA-256：`bc6a0065f3c4213ccd91ffb5e283b7892f7b68d26cba602d3000181a98c46c00`

## 上游许可信息

[上游代码许可证](https://github.com/lin-alg/NaiLoong/blob/fc5d92ba3a6434aef4cda638d1247d540b5d3993/LICENSE) 为 MIT，版权声明为 `Copyright (c) 2026 linalg`。[上游 README](https://github.com/lin-alg/NaiLoong/blob/fc5d92ba3a6434aef4cda638d1247d540b5d3993/README.md) 区分代码与图片，并提示部分图片商用需要原作者同意。

未查到上述 5 款录音各自的原作者授权或独立音频许可证，也未确认 GIF 的完整权利链。本项目不将代码 MIT 许可扩大解释为第三方录音、GIF 或角色形象的授权。
