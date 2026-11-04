# Orca HTML Embed · 虎鲸笔记 HTML 嵌入插件

将离线 HTML、交互图表和内嵌图片显示在虎鲸笔记的块中，保留网页原有的样式与交互。

**当前版本：1.0.1** · **已实测：Windows / Orca Note 1.99.0** · **许可证：MIT**

[下载安装包](https://github.com/wushimin/orca-html-embed/releases/latest) · [交互演示源码](examples/interactive-demo.html) · [反馈问题](https://github.com/wushimin/orca-html-embed/issues)

## 功能

- 从 `.html` / `.htm` 文件导入，或直接粘贴 HTML 源码。
- 支持自包含的 HTML、内联 CSS / JavaScript、SVG、Canvas 和 data URL 图片。
- 调整显示高度、适应内容、展开查看、重载和导出原始 HTML。
- 使用虎鲸笔记的编辑命令保存，支持插入和编辑的撤销、重做。
- 原始 HTML 与独立预览保存至笔记库资源，导入后不再依赖原文件所在路径。
- 默认启用交互脚本、关闭联网；在隔离的 iframe 中显示内容。

安装和日常使用无需 Node.js、npm 或额外下载运行依赖。

## 安装

1. 打开 [Releases](https://github.com/wushimin/orca-html-embed/releases/latest)，下载 `orca-html-embed-1.0.1.zip`。
2. 解压后，将整个 `orca-html-embed` 文件夹放入系统“文档”目录下的 `orca/plugins/`。
3. 完整退出并重新启动虎鲸笔记，在 **设置 → 插件 → orca-html-embed** 中启用插件。

安装后的目录结构应为：

```text
系统文档目录/
└─ orca/
   └─ plugins/
      └─ orca-html-embed/
         ├─ dist/
         │  └─ index.js
         ├─ package.json
         ├─ icon.png
         ├─ README.md
         └─ LICENSE
```

系统“文档”目录可能已被重定向到其他位置，请以本机实际文档目录为准。不要只复制 `index.js`，也不要多套一层同名目录。Release 中的安装 ZIP 与 GitHub 自动生成的源码压缩包用途不同。

更新时，先停用插件并退出虎鲸笔记，再用新版发行文件覆盖插件目录，重新启动并启用。卸载时先停用，再移走该插件目录；插件不会主动删除已有 HTML 块或仓库资源，重新安装同名插件可恢复显示。

## 使用

1. 在普通笔记文字块中输入 `/`，选择 **HTML 嵌入**；也可点击编辑工具栏中的代码图标。
2. 选择 HTML 文件，或在编辑器中粘贴源码。
3. 设置标题、显示高度，以及是否启用交互脚本或联网。
4. 点击 **保存 HTML 嵌入**，新块会插入到当前块之后。

块顶部的操作：

| 操作 | 作用 |
| --- | --- |
| 编辑 | 重新导入文件，修改源码、标题、高度或脚本/联网选项 |
| 重载 | 重新读取已保存内容，重置网页临时交互状态 |
| 适应内容 | 使用网页报告的高度，限制为 240–2000 像素；更长内容可滚动 |
| 展开 / 收起 | 在应用窗口内放大查看；宿主有焦点时也可按 Escape 收起 |
| 导出 | 下载原始 HTML，供浏览器打开或再次导入 |

只读笔记可查看和导出，编辑及插入操作会被禁用或拒绝。标题与内容等编辑合为一次撤销操作。

## 试用演示

仓库提供原创、自包含的简单交互示例 [examples/interactive-demo.html](examples/interactive-demo.html)。保存该文件后，用插件导入即可试用；也可先用浏览器打开，比较嵌入后的效果。

该示例仅用于演示插件功能，不包含实际笔记或实机验收使用的用户资料。

## 保存方式

正常情况下，每个嵌入块关联两份仓库资源：

- **原始 HTML**：保留导入的原文，用于编辑与导出。
- **独立预览 HTML**：由原文生成，加入内容隔离策略和尺寸报告代码，用于显示与交互。

插件通过虎鲸笔记的资源接口上传并回读校验，再把资源引用写入块。预览单独保存，用于解决宿主页面对内联脚本的限制；生成预览时会移除 `base` 和 `http-equiv` 控制标签，原文不受影响。

如果宿主无法回读原始 HTML 资源，插件会提示并将原文保存在块内。如果独立交互预览无法生成，会显示重新保存提示。预览文件丢失而原文仍在时，可通过 **编辑 → 保存 HTML 嵌入** 重建预览。

两种资源字段均已注册到宿主。跨设备使用仍需要虎鲸完成资源同步，并在目标设备安装插件；本项目尚未完成跨设备同步验收。

## 支持范围

| 项目 | 说明 |
| --- | --- |
| 文件 | UTF-8 编码，原始 HTML 最大 5 MB |
| 本地资源 | 支持内嵌资源；不会自动打包同目录的图片、样式、脚本或字体 |
| 联网 | 默认关闭；显式开启后可加载 HTTP / HTTPS 绝对地址资源，仍受资源可用性与跨域规则影响 |
| 脚本 | 默认启用；关闭后仅静态展示，依赖脚本的图表及“适应内容”不可用 |
| 隔离 | iframe 不获同源权限，不能读取宿主页面、笔记 API 或宿主存储 |
| 完整网站 | 不支持依赖登录态、同源存储、嵌套 iframe、系统权限或弹窗的完整网站 |
| 页面跳转 | 外部资料链接不会打开新窗口；可导出后在浏览器访问。表单提交与刷新跳转不属于支持范围 |
| 临时状态 | 悬停、筛选等网页状态不持久化，重载或重启后回到 HTML 初始状态 |
| 笔记导出 | 普通 Markdown / 纯文本导出仅保留标题与资源引用，不会转换为原生笔记图表 |

已验证的宿主为 Windows 上的 Orca Note 1.99.0。其他宿主版本、macOS 和移动端尚未完成验收。

## 常见问题

**插件列表里没有出现插件。**

检查是否放入实际系统文档目录的 `orca/plugins/`，并确认 `dist/index.js` 位于上面的目录层级。完整退出应用后再启动。

**图片丢失，或图表没有显示。**

检查 HTML 是否引用了同目录文件或在线依赖。将依赖资源内嵌后再导入；在线资源需要开启联网。交互图表还需要启用交互脚本。若提示交互预览尚未生成，打开编辑器重新保存。

**展开后按 Escape 没有收起。**

焦点位于嵌入网页内部时，按键不会传到宿主。直接点击块顶部的 **收起** 即可。

**重启后图表在，但筛选条件恢复了。**

这是预期行为：插件保存 HTML、标题、高度和选项，不保存网页脚本运行中的临时状态。

**如何备份或取回原始内容？**

使用块顶部的 **导出** 获取原始 HTML。笔记库备份还应包含仓库资源，不能只保存插件文件夹。

## 验证与版本说明

1.0.1 已在 Windows / Orca Note 1.99.0 的真实笔记库中完成三份自包含 HTML 的测试：

- 图表显示、悬停详情、列表筛选与行点击，以及内嵌图片显示。
- 保存至仓库的原始 HTML 与输入文件逐字节一致。
- 插入的撤销/重做；标题及高度编辑一次撤销共同恢复，重做恢复修改。
- 三个嵌入块展开、收起与展开后的交互。
- 完整退出应用再启动，插件自动启用，内容恢复，交互复测通过。
- iframe 无法读取宿主页面；测试期间未捕获未处理的脚本异常。

当前单元测试共 8 项，覆盖路径解析、输入限制、并发资源读取、原文与派生预览大小限制隔离、源码与发行文件一致性等。

1.0.1 修复了相对资源路径解析、宿主内联脚本限制及展开视图被编辑器布局压缩的问题，并补充预览缺失重建和派生文件大小余量。原始实机截图、笔记数据与机器专用诊断脚本留在本地，不随仓库或安装包发布。

## 开发

要求 Node.js 20+。源码使用宿主提供的 React / Valtio，无运行时第三方模块依赖；构建和单元测试也不需要安装额外依赖。

```sh
git clone https://github.com/wushimin/orca-html-embed.git
cd orca-html-embed
npm run build
npm test
```

`npm run build` 将 `src/main.js` 原样复制到 `dist/index.js`。修改源码后先构建，再运行测试；单元测试会检查两者是否一致。

在 PowerShell 7+ 中生成并校验安装包：

```powershell
.\scripts\package.ps1
.\scripts\verify-release.ps1
```

版本号来自 `package.json`，输出为项目根目录的 `orca-html-embed-<版本号>.zip`。校验脚本会干净解压，检查文件清单、散列和入口语法，并生成本地验证记录。

从源码手工安装时，构建后仅将发行所需的 **`dist/index.js`、`package.json`、`icon.png`、`README.md`、`LICENSE`** 五项文件按安装树复制到插件目录，无需复制测试、示例或构建目录。

## 参考

- [Orca Note 官方插件 Quick Start](https://www.orca-studio.com/orcanote-docs/documents/Quick_Start.html)
- [官方插件模板与类型](https://github.com/sethyuan/orca-plugin-template)
- [核心编辑器命令](https://github.com/sethyuan/orca-plugin-template/blob/main/plugin-docs/documents/Core-Editor-Commands.md)
- [Backend API](https://github.com/sethyuan/orca-plugin-template/blob/main/plugin-docs/documents/Backend-API.md)

## 许可证

插件源码与仓库原创演示按 [MIT License](LICENSE) 提供。用户导入的 HTML 及其中的文字、图片、脚本等内容由其各自权利人授权，不因导入插件而改变许可证。
