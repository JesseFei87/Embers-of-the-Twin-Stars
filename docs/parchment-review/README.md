# 羊皮纸界面统一 · 设计审核稿

独立 React / Vite 交互原型，覆盖 12 类界面、51 个状态。

- 本地审核地址：http://127.0.0.1:5175/
- 完整清单与边界：[AUDIT.md](AUDIT.md)
- 设计验收记录：[design-qa.md](design-qa.md)
- 游戏现状截图：`public/evidence/`
- 最终设计截图：`public/designs/`

原型已由助手启动。它不接入正式游戏，不结算战斗、不读写正式存档。素材复用游戏当前资源，场景图只用于独立审核上下文。审核意见保存在此原型浏览器存储，支持导出 Markdown。

维护命令：`npm run dev -- --host 127.0.0.1 --port 5175 --strictPort`；构建：`npm run build`。
