# 参与贡献

欢迎提交问题修复、交互改进、音频引擎改进和文档补充。较大的功能变更请先通过 [Issue](https://github.com/Theorists258/naiwa-studio/issues) 说明使用场景与预期行为。

## 本地开发

使用 Node.js 24.12+（24 LTS）和 pnpm 11.25.0。在自己的功能分支中工作：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

提交 Pull Request 前运行：

```bash
pnpm test
pnpm build
pnpm test:sites
```

`test:sites` 包含构建产物检查，必须在构建后运行。

修改 Windows 启动器或打包逻辑时，在 Windows 上继续运行：

```bash
pnpm package:windows
pnpm test:portable
```

打包命令使用系统的 .NET Framework C# 编译器，生成 `release/` 下的 ZIP 和 `.zip.sha256` 文件；便携测试针对打包时编译的启动器运行。开发打包需要 Node.js 和 pnpm，便携版用户不需要安装它们。CI 也会执行 Windows 打包与便携测试，并上传 ZIP 和校验文件作为工作流产物。

PR 描述请说明解决的问题、用户可见的变化和验证方式。界面改动附截图；音频改动说明使用的采样、裁切和音高条件。测试应覆盖有意义的行为，例如播放时序、尾音、工程校验或保存恢复。

## 修改约定

- 两种视图应继续共享同一份作品状态。增加功能时兼顾音序器、打击垫和工程保存格式。
- 保持键盘操作、可访问名称和输入框行为可用；新增控件不要遮挡主要编曲区域。
- 使用 pnpm 管理依赖，依赖变化同步更新 `pnpm-lock.yaml`。
- 不提交 `node_modules/`、构建产物、个人作品、临时录音、令牌或本机配置。

## 素材贡献

仅提交你有权使用和再分发的音频、图片或其他素材。请在 [ASSET-SOURCES.md](ASSET-SOURCES.md) 中记录作者、来源、许可及适用限制，必要时附授权依据；来源可下载并不代表允许再分发。

本项目代码采用 MIT 许可，但第三方素材与角色权利单独处理，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。如只调整音频逻辑，优先使用测试生成的信号或已有素材，避免新增不必要的录音文件。
