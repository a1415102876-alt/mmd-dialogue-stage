# 模型与动作资源

本仓库已捆绑 `library.json` 引用的资源（Private）：

| 来源 | 仓库路径 |
|---|---|
| `E:\gakumas-pmx-workflow\output\*`（偶像 PMX/贴图） | `library/file/idols/<id>/` |
| `E:\gakumas-motion-batches\cmmn-001\vmd-hips` / `vmd-face` | `library/file/motions/cmmn-body/` 、`cmmn-face/` |
| `...\gakumas-motion-workbench\generated\dedicated-vmd\*` | `library/file/motions/<id>-dedicated-body/` |

未包含：`author-source`、Unity 工程、未引用的 cstm 变体、以及 `cmmn-001` 里除 vmd-hips/vmd-face 外的中间产物（约 4GB）。

`library.json` 的 `packs.*.root` 现为相对本仓库根目录的路径。接到 SillyTavern 时，请把本仓库放到 `public/mmd-dialogue-stage`，或把 `root` 改成绝对路径；服务端 `mmd-library.js` 用 `path.resolve(pack.root)` 读文件。

版权：学马仕导出资源请保持 Private，勿公开分发。
