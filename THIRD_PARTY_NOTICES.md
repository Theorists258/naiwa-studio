# 第三方材料与权利说明

本项目 [MIT License](LICENSE) 适用于原创程序代码。第三方音频、角色形象、名称及相关权利由各自权利人保留，不因本项目使用 MIT 而取得新的授权。

## 音频采样

`public/audio/` 内的 5 个 MP3 来自 [lin-alg/NaiLoong](https://github.com/lin-alg/NaiLoong)。原始文件名、固定提交、时长和 SHA-256 记录在 [ASSET-SOURCES.md](ASSET-SOURCES.md)。

上游仓库的代码许可证为 MIT，声明 `Copyright (c) 2026 linalg`。未查到这 5 个录音各自的原作者授权或独立音频许可证，因此不将上游代码许可证解释为录音、角色或表演内容的再分发及商用授权。公开托管和可下载状态也不代表这些授权已经取得。

## 角色图像

`public/assets/naiwa.png` 是使用 Image Gen 生成的透明背景奶蛙角色图。生成过程不会改变既有角色形象本身的权利；本项目不通过代码许可证授予该角色、名称或相关商标的权利。

[ASSET-SOURCES.md](ASSET-SOURCES.md) 另记录了奶蛙大笑 GIF 的上游参考链接。该原始 GIF 不随本仓库分发。

## 软件依赖

项目直接使用的 React、React DOM、Vite、`@vitejs/plugin-react` 和 `@phosphor-icons/react` 均在其软件包元数据中声明 MIT 许可。具体版本见 [pnpm-lock.yaml](pnpm-lock.yaml)；各依赖及其传递依赖的版权声明、许可全文和附加要求，以相应软件包内的原始许可文件为准。

## 复用与替换

复用、重新分发或商用时，请分别确认代码和素材的授权范围。可通过修改 [src/music.js](src/music.js) 中的音源表及替换 `public/` 中的素材，改用自己有权使用的声音与形象。用户导入的内容同样由其确认使用权。

如你是相关素材的权利人并需要更正来源或移除素材，请通过仓库 Issue 提供文件名和相关说明。
