# MMD 对话舞台交接文档

更新时间：2026-09-08

## 项目位置与入口

- 项目目录：`G:\SillyTavern\SillyTavern\public\mmd-dialogue-stage`
- 页面入口：`http://127.0.0.1:8000/mmd-dialogue-stage/`
- SillyTavern 根页面：`http://127.0.0.1:8000/`
- 启动命令（仓库根目录）：`npm run start -- --port 8000`
- 当前入口缓存版本：`app.js?v=20260908-05`（Shader 子模块与 CSS 同步更新）

注意：`config.yaml` 当前启用了 `basicAuthMode: true`。主 WebUI 黑屏且控制台显示 `/lib.js 404` 时，实际可能是静态资源请求返回 `401 Unauthorized`，不是 MMD 舞台覆盖了根路由。

## 当前文件

- `index.html`：舞台与控制台结构
- `style.css`：舞台 UI
- `app.js`：Three.js、PMX/VMD、材质、灯光、描边逻辑
- `core.js`：动作指令和名称处理
- `picker-bootstrap.js`：文件/文件夹选择初始化
- `tests/core.test.mjs`：核心逻辑测试
- `vendor/three/`：本地 Three.js 0.152.2 与 MMD 相关模块

整个 `public/mmd-dialogue-stage/` 当前在 Git 中仍显示为未跟踪目录。不要重置或覆盖其中用户已有修改。

## 已实现功能

- 导入 PMX/PMD，并通过本地文件映射解析贴图。
- 补充选择贴图文件夹。
- 导入、播放、暂停和循环 VMD。
- Morph 列表、预设表情和独立滚动区域。
- JSON 演出指令。
- MMD 原生、学马仕、舞台对比、柔和肤色等预设。
- 环境光、主光、轮廓光、投影强度和光照方向控制。
- 主光与角色阴影方向的水平/上下角，角度范围包含 `-180..180`。
- 描边颜色、透明度、粗细控制。
- 页面左上角有在新标签页打开 SillyTavern 的入口。

## 描边现状

当前仍使用 Three.js `OutlineEffect`，不是完整 MToon 或学马仕本家描边。

重要修复：`MMDLoader` 已经把 PMX 的 `edgeFlag / edgeSize / edgeColor` 解码到：

```js
material.userData.outlineParameters
```

现在 `applyOutlineToMaterial()` 会先保存为：

```js
material.userData.mmdOutlineParameters
```

并优先保留 PMX 原生 `visible` 开关。名称匹配只对没有 PMX 描边元数据的材质兜底。

2026-09-09：确认当前导出的 PMX 保留了学马仕顶点色：`PMX Additional UV 3` 对应导出器原始 `mesh.colors`。`MMDLoader` 将其暴露为 `gakumasVertexColor`，并按 Gakumas 约定解码为 OutlineColor、OutlineWidth、OutlineOffset、RampAddID、RimMask。只有“学马仕风格”预设且顶点数完整匹配时启用，普通 PMX 回退到原 OutlineEffect。

当前描边已做 Three.js 语义迁移：OutlineEffect 的第二次背面绘制保留；顶点色在顶点阶段解包，宽度按相机距离和全局描边粗细计算，偏移转换为 WebGL 视图空间位置。Unity 的 HLSL/URP 不能直接照搬；当前没有原始 SmoothNormal/Tangent，使用 Three.js skinned normal 作为近似，因此不是逐像素完全复刻。RampAdd、RimMask 和原始平滑切线仍待后续验证。

## 学马仕材质 v2：当前实现

本节取代下方 v1 材质描述。沿用“学马仕风格”预设，不改 PMX/VMD 文件、骨骼映射、动画采样与播放链路。

- `gakumas-materials.js`：以 `material.userData.MMD.mapFileName` 为主要依据逐材质绑定，而不是按合并 SkinnedMesh 的名字分类。支持原始 `sdw/def/rmp/hhl/rma/lyr` 后缀；同角色共享 Ramp，其他图严格匹配部位和服装 stem。重名冲突不选第一张，检查面板会报告。
- `gakumas-shader.js`：仍通过 `MMDToonMaterial.onBeforeCompile` 注入，但在光照汇总阶段替换旧 Toon 直接光结果；学马仕模式不再叠加原来的额外明暗分段、PMX 环境发光与 PMX Matcap。其他三个预设保持原有材质路径。
- 主光使用视角相关 MatCap 坐标基。修正世界／视图空间混用和 Def.R 偏移幅度（`2R-1`）。新默认主光角度为水平 25°、上下 40°；旧 153° 属于旧公式下的调参，不要机械搬回来。
- Shade.A 用于皮肤混合，Ramp RGB 调制皮肤，Ramp A 混合非皮肤 Base/Shade。脸部 Def.B 用于反射法线照明混合，不再当作金属度；Head／頭／頭部 骨骼的横轴每帧转换到视图空间，随转头和镜头更新。找不到头骨时明确提示跟随模型。
- 头发 `hhl` 结合视角、高光遮罩计算高光区域，不再全表面直接相加；直接高光改为基于 Def 的 GGX 近似，轮廓光加入方向控制。仍不是完整游戏 BRDF／环境反射复现。
- 所有 Def（包括脸／眼）与各向异性数据使用线性数据色彩空间，Shade/Ramp/Highlight 使用 sRGB。Ramp 禁用 mipmap 并使用线性过滤、Clamp。缺失贴图使用共享中性资源或解析回退，不在每次编译时新建占位纹理。
- 灯光面板下增加“学马仕材质检查”：查看逐材质资源绑定、头骨来源，以及 Base、Shade、Def、Ramp、皮肤遮罩、Ramp 输入光照。

已加入两个默认关闭的实验开关：角色专用阴影采样、眉眼半透（HairCover）。角色阴影仍额外采样 `characterShadowLight.shadow.map`；阴影 caster 以 SkinnedMesh 为粒度，不宣称完整复现原版 ShadowDepth。

2026-09-09：舍弃旧透明复制网格方案。`gakumas-hair-cover.js` 在基础场景的 `scene.onAfterRender` 内、r152 当前 renderState 有效时，仅针对原 mesh 的 m_hir group 执行 `renderBufferDirect`，之后才调用 `OutlineEffect.renderOutline`。不新增 Mesh、不改原 material 数组或 geometry groups、不重画身体或 m_hir+。回调由 try/finally 恢复。纹理引用共用，覆盖材质独立，清理时只 dispose 覆盖材质。特别注意 MMDToonMaterial 继承 ShaderMaterial，其 clone 会复制纹理 uniform，需要重新绑定到原纹理引用。

基础 Stencil 和已经成功的眉眼全透保留。额外绘制选文章版 ZWrite Off，关闭模板测试，RGB 使用 SrcAlpha/OneMinusSrcAlpha；透明网页画布的输出 Alpha 使用 source-over，不能照抄 Unity One/Zero 把脸的画布覆盖率改为半透明。完整对应关系和版本差异见 `HAIRCOVER-MIGRATION.md`。

示例 GakumasCommon 的头发 A 是视角淡出权重：`mix(1,max(fadeX,fadeZ),textureAlpha)`，不是直接 opacity。世界空间头 forward/up 与视线方向配对；两遍共用原骨架、Morph、UV 和 Actor GLSL 光照。当前已检查琴音 PNG A 全白，UI 的“正面最低覆盖（补偿）”默认 0.35；设为 0 才是严格示例公式，该模式正面可能依然全透。补偿不是游戏原参数，源遮罩是否丢失尚未证实。

仍尚未完成：逐材质 ShadowDepth 过滤、原始平滑切线恢复、RampAdd、Layer、完整环境反射和后处理。`rma/lyr/aniso` 仍只登记资源并显示“算法待接入”，不伪装成已启用。

验证入口：

```powershell
node --check public/mmd-dialogue-stage/app.js
node --check public/mmd-dialogue-stage/gakumas-materials.js
node --check public/mmd-dialogue-stage/gakumas-shader.js
node --test public/mmd-dialogue-stage/tests/core.test.mjs public/mmd-dialogue-stage/tests/gakumas-materials.test.mjs
node public/mmd-dialogue-stage/tests/render-smoke.mjs <playwright/index.mjs的绝对路径> <琴音PMX路径> <VMD路径>
```

`render-smoke.mjs` 启动仅监听 127.0.0.1 的临时静态服务与独立无界面 Chrome，不接入现有浏览器、不上传模型。可用 `CHROME_PATH` 指定浏览器。检查实际模型贴图、Shader 编译、调试通道、预设切换、相机变化、缺图回退和可选 VMD 时间轴推进；截图在仓库 `.tmp/gakumas-shader-qa/`。测试中仅为完整构图放宽镜头距离，不修改产品的镜头配置。

已验证琴音兼容 PMX 的 16 个材质、Head 骨骼识别、27 个编译程序，无控制台／Shader 错误；`mot_all_chr_fktn_idle-001_in_b.vmd` 时间轴推进正常。单元测试 10/10 通过。此验证不等于与游戏原画面逐像素一致。

## 学马仕材质 v1：历史记录

这仍是 `MMDToonMaterial + onBeforeCompile` 的近似实现，不是独立、完整的 `GakumasActorMaterial`。

目前包括：

- 自动寻找 `*_def`、`*_sdw`/`*_shade`、`*_ramp`/`*_toon`、`*_highlight`、`*_aniso`。
- `ehl_col` 已从通用 HighlightMap 排除，避免眼睛高光贴到脸或身体。
- ShadeMap、RampMap、HighlightMap、DefMap、AnisotropicMap uniforms。
- 脸/皮肤与非皮肤的两条 Ramp 分支。
- 头发简化各向异性高光。
- 简化 Rim 光。

DefMap 通道当前映射：

- R：阴影 Offset + 边缘光 Mask
- G：Smoothness/高光锐度
- B：风格化 Metallic/高光颜色与强度
- A：Specular 强度

缺少 DefMap 时使用中性像素 `(128, 0, 0, 0)`，避免所有材质默认满高光。通用高光已压低，以保持较平的二次元效果。

Ramp/阴影分色当前逻辑：

- `GK_FACE`：Ramp RGB 用于偏暖的皮肤阴影/近似 SSS；ShadeMap 仍提供阴影基础色。
- 非脸部：Ramp A 控制基础色到 ShadeMap 阴影色的插值；Ramp RGB 仅做轻度调色。

最近修复过“切换学马仕后基础贴图变白”：不能用白色 Alpha=1 或 PMX `gradientMap` 作为 Gakumas Ramp/Shade 回退。当前使用白色 RGB、Alpha=0 的中性 Ramp/Shade 回退。

已知不足：

- 仍按 mesh 名粗略判断脸/头发；一个 SkinnedMesh 内含多材质时可能错误。
- 贴图匹配不是严格按每个 PMX 基础材质逐一关联。
- 角色 ShadowDepth 仍不是独立过滤后的深度 Pass。
- 阴影和文章/本家 Shader 只是近似，不要宣称完整移植。

## 阴影现状

模型仍主要使用 Three.js 普通阴影图。`classifyShadowRole()` 用名称把 mesh 粗分为 internal、eye、face、hairOuter、clothing、body，仅 body/hairOuter/clothing 投射和接收阴影。

这个分类对多材质单 Mesh 不可靠。用户之前指出口腔、眼窝等内部结构错误投影到底层表面，问题尚未从架构上彻底解决。真正稳妥的方向是材质级 ShadowDepth/过滤投影 Pass，而不是继续堆名称规则。

## 参考资料

用户提供的逆向 Shader：

`C:\Users\86139\.codex\attachments\26b09e72-b3c5-400e-9402-61d04a4a389e\pasted-text.txt`

Shader 名：

```text
Shader "Unlit/GakumasActor_Sample"
```

相关文章：

- `https://zhuanlan.zhihu.com/p/1901300706872394096`
- `https://zhuanlan.zhihu.com/p/1898275837159126787`
- `https://zhuanlan.zhihu.com/p/1908718263602489063`
- `https://zhuanlan.zhihu.com/p/670837192`
- `https://zhuanlan.zhihu.com/p/672607537`

示例 Shader 里只有主 Actor Pass，没有看到完整独立 Outline Pass。顶点色被压缩/解包后用于 AO、Ramp 等数据，但不要据此假定当前 PMX 仍有这些数据。

## 学马仕解包资源

解包项目：

`G:\Gakuen-idolmaster-ab-decrypt-main\Gakuen-idolmaster-ab-decrypt-main`

当前实际使用的解包 AB 目录：

```text
E:\gakumas-unpack-2026-09-06\asset_bundle
```

README 标注 Unity 版本：

```text
Unity 2022.3.21f1
```

原始动作 AssetBundle：

`output\asset_bundle\mot_*`

已复制整理 549 个动作包到：

`output\motion_assets`

操作是复制，原文件未删除。动作包文件无扩展名，但文件头是 `UnityFS`。

AssetRipper/导出结果：

`output\asset_bundle_export\ani`

其中：

- `AnimationClip`：881 个 `.txt`，约 572 MB
- `MonoBehaviour`：动作组合和身体/面部 Clip 引用

当前 AnimationClip 主要是 Unity Humanoid MuscleClip：

```text
m_RotationCurves size = 0
m_PositionCurves size = 0
m_FloatCurves size = 0
m_MuscleClipSize > 0
m_SampleRate = 30
```

因此这些 TXT 不能直接作为普通 Transform 曲线转 VMD。绑定里大量是哈希 path。骨骼名称与 Humanoid 求解已改在 Unity 工作台完成（见下文），不要从 TXT 猜欧拉。

## 推荐动作样本

优先研究这 6 组：

1. `mot_all_chr_fktn_idle-001_in`：藤田琴音待机进入段，身体 `_b` + 面部 `_f` + MonoBehaviour，最完整。进入后接同名 `_pose`。
2. `mot_all_chr_cmmn_talk-003_in`：通用说话身体动作。
3. `mot_all_chr_cmmn_angry-001_in`：身体 + 面部。
4. `mot_all_chr_cmmn_yes-001_in`：身体 + 面部。
5. `mot_all_chr_cmmn_facial-all-normal1-egao1_in`：通用微笑面部动作。
6. `mot_all_chr_fktn_facial-all-unique-kirakira1_in`：藤田琴音专用表情。

后缀推断：

- `_b`：身体 Humanoid MuscleClip
- `_f`：面部 Clip（脸模是独立包，不是身体网格的一部分）
- `_c`：镜头
- `_in`：进入段，通常约 1 秒、不循环
- `_pose`：进入后的站定姿势（短 Clip，几乎无帧间变化）
- `_lp`：循环段（走路、课程待机、坐下等）
- 整份解包里**没有** `mot_*_out` 包。角色待机成对的是 `_in` + `_pose`，不是 `_in` + `_out`。把 `_in` 循环播放会跳回起点，看起来像没播完。

藤田琴音待机对应文件：

```text
MonoBehaviour\mot_all_chr_fktn_idle-001_in.txt
MonoBehaviour\mot_all_chr_fktn_idle-001_pose.txt
AnimationClip\mot_all_chr_fktn_idle-001_in_b.txt
AnimationClip\mot_all_chr_fktn_idle-001_in_f.txt
AnimationClip\mot_all_chr_fktn_idle-001_pose_b.txt
AnimationClip\mot_all_chr_fktn_idle-001_pose_f.txt
```

MonoBehaviour 中明确有：

```text
baseAnimation.clip -> 身体 AnimationClip PathID
faceAnimation.clip -> 面部 AnimationClip PathID
```

## PMX/VMD 当前实测进度（2026-09-08）

已用拼出的藤田琴音 CASL 模型测试启发式 VMD。用户确认：该 PMX 可以被 MMD 打开，VMD 也已经能够在模型上播放。当前验证文件：

```text
PMX: E:\gakumas-pmx-workflow\output\fktn-casl-reference-matched\fktn-casl-reference-matched.pmx
VMD: G:\SillyTavern\SillyTavern\tools\gakumas-vmd-prototype\fktn_idle_heuristic.vmd
```

静态匹配结果：

- VMD 共 608 个骨骼关键帧，19 个不同骨骼，动作数据为 32 帧、30 FPS，约 1.07 秒。
- 19/19 个 VMD 骨骼名称都能在当前 PMX 中精确找到，不需要额外的日文 MMD 骨骼改名即可播放。
- 已匹配骨骼包括 `Head`、`Neck`、`Spine2`、左右肩/上臂/前臂/手、左右大腿/小腿/脚/脚趾。
- 当前 VMD 仅包含旋转，没有根骨骼/腰部位移、IK 关键帧或面部 Morph；`Spine`、`Spine1` 也没有实际关键帧。
- 因此当前“能播放”已经验证，但动作仍属于启发式结果，可能幅度小、姿态僵硬或关节方向不准确。**不要再继续猜 Python 欧拉。** Unity Humanoid 求解已经跑通（见下文），后续 VMD 应以 Unity Bake 出的骨骼 Transform 为准，用启发式 VMD 只做对照。

`mmd-dialogue-stage` 通过 `MMDLoader.loadAnimation(vmd, model)` 按骨骼和 Morph 名称绑定 VMD。SillyTavern 本地服务启动后访问：

```text
http://127.0.0.1:8000/mmd-dialogue-stage/
```

## Unity Humanoid 求解（2026-09-08，已跑通预览与采样）

地面真值是 Unity 的 Humanoid 求解器（`Animator` + `AnimationClipPlayable` + `HumanPoseHandler`），不是 Python 欧拉。工程：

```text
G:\SillyTavern\SillyTavern\tools\gakumas-motion-workbench
Unity 工程：tools/gakumas-motion-workbench/UnityProject
编辑器：C:\Program Files\Unity\Hub\Editor\2022.3.21f1\Editor\Unity.exe
菜单：Tools > Gakumas > Build and validate sample
报告：tools/gakumas-motion-workbench/generated/
```

Hub 必须打开 `UnityProject` 这一层，不要打开上一级，也不要打开里面误建的 `My project`（URP 空工程）。版本是国际版 `2022.3.21f1`，不是中国版 `f1c1`。磁盘上没有偶像原装 `Avatar` / `HumanDescription`，禁止为这件事去反编译商业 `GameAssembly`。CroakFang 文章解决的是**模型转 PMX**，不是 Humanoid Clip 转 VMD。

### 已确认可以这样做

1. 从原装身体包 `mdl_chr_fktn-casl-0000_body` `Instantiate` 角色（与 PMX 导出同一思路）。JSON 重拼网格会 `Invalid AABB`，Humanoid 蒙皮会炸。
2. `AvatarFactory` 重建 Humanoid Avatar：`isValid=true`，`isHuman=true`，52 根映射骨。`Hips` 世界坐标约 `(0, 0.917, 0.014)`，应在腰部，不应在脚底原点。
3. 关掉 `Apply Root Motion`。原装预制体上常有 Unity **假空 Animator**，C# `??` 不会 `AddComponent`，Inspector 会只剩 Transform；要先清掉再挂新的。
4. 网格必须 `CreateAsset` 进 `Assets/Generated/Run-*/Meshes`，材质换成工程内 `Standard` 肉色。否则进 Play 场景重载后网格引用丢失，人消失、骨骼还在。
5. 清掉原装缺失脚本（衣服/IK 上的游戏组件，这个工程里没有）。`Graphs.Edge.WakeUp` 可关 Animator 窗口，可忽略。
6. **不要**把 AssetBundle 里的 Humanoid Clip `CreateAsset` 成 `.anim`。YAML 会丢掉 MuscleClip，变成空片段、`human=False`。那时 Play 只套 Avatar 默认站姿，看起来像“有姿势但不动”。
7. 预览和采样都用内存里的原片：`PlayableGraph` + `AnimationClipPlayable.SetTime` + `Evaluate`。Play 模式由 `HumanoidClipPlayer` 再 `LoadFromFile` `sample-motion.bundle.bytes`。
8. 没头是正常的：身体包没有脸；脸在 `mdl_chr_fktn-base-0000_face` + `*_f`。

### 最近一次数值（编辑器 Bake）

```text
unityVersion: 2022.3.21f1
status: numerical-validation-passed-visual-review-required
sampledFrames: 31
clipLength: 1.0
maximumPositionChange: ~0.032 m
maximumRotationChange: ~44.8 deg
maximumMuscleChange: ~0.995
```

用户已确认：Play 时 `_in` 身体动作会动，幅度看起来自然。原片 DenseClip 为 32 帧 / 126 条曲线，其中 122 条有帧间变化。

### 待机预览怎么播

藤田琴音 `idle-001` 只有：

```text
mot_all_chr_fktn_idle-001_in
mot_all_chr_fktn_idle-001_pose
```

正确顺序：先播 `_in_b`（约 1 秒进待机），再接到 `_pose_b` 并站住。原装 pose 包的 `m_Container` **不包含** AnimationClip 名，Unity `LoadAllAssets<AnimationClip>()` 会空，必须先经 `prepare.py` 打成：

```text
tools/gakumas-motion-workbench/UnityProject/Assets/Input/sample-pose.bundle.bytes
```

pose 加载失败时预览必须仍能播 `_in`，不能整段 `StopPlayback`。

准备输入：

```powershell
python tools/gakumas-motion-workbench/prepare.py --source "E:\gakumas-unpack-2026-09-06\asset_bundle"
```

会写出 `sample-motion.bundle.bytes`（`_in`）和 `sample-pose.bundle.bytes`（`_pose`）。

### 还没做

- 把 Unity Bake 的 `BodyLegacy.anim` / `body-sampled.json` / `.bvh` 转成给当前 PMX 用的 VMD（替换启发式欧拉）。
- 挂脸模并播 `*_f`。
- 导出根位移、手指、IK。
- 用课程 `_lp` 验证循环动作。

## Miritore 参考结论

本地 Miritore/MillionDance：

```text
G:\yjsp\miritore-appveyor-rel-v0.3.0.84
```

反编译报告：

```text
E:\gakumas-unpack-2026-09-06\milliondance_il.txt
```

Miritore 确实实现了以下与 MMD 相关的工作：

- `BoneLookup`：Unity Avatar/骨骼路径与 PMX/VMD 骨骼名称之间的映射。
- `VmdCreator`：结合动作源、Avatar 骨架和目标 `PmxModel` 生成 VMD 骨骼帧。
- 可选追加 IK 骨骼和眼睛骨骼。
- Facial Expression 到 MMD Morph 名称的映射，并生成 VMD 表情帧。

但它不是通用的 PMX 修复器或标准 MMD 模型自动重构器。其 VMD 流程依赖可识别的 MLTD `PrettyAvatar` 和目标 PMX；学马仕当前未找到偶像 Avatar，因此不能直接照搬。MillionDance 的模型导出仍是 alpha 状态，已有重复骨骼、骨骼不匹配和缩放问题记录。当前应借鉴它的映射表、坐标转换和表情映射，另行编写 Gakumas 骨骼适配层。

## Unity Bake → VMD：静止基准重定向阶段结果

已确认身体基线文件：`G:\SillyTavern\SillyTavern\tools\gakumas-vmd-prototype\fktn_idle_unity_rest_retargeted.vmd`。
目标 PMX：`E:\gakumas-pmx-workflow\output\fktn-casl-reference-matched\fktn-casl-reference-matched.pmx`。

- 旧 `fktn_idle_unity_baked.vmd` 减去了动作首帧，错误抵消了手臂下垂姿态，表现为仍接近 T 字。
- `fktn_idle_unity_absolute_local.vmd` 保留首帧，用户确认手能下垂，但腿前后伸、方向不对。原因还包括静止骨骼轴以及错误的 Unity → 原始 PMX 坐标换算。
- 真正静止姿态已从最近一次重建 Avatar 的 HumanDescription skeleton 恢复到 `tools/gakumas-motion-workbench/generated/unity-rest.json`，共 197 骨。不是采样第 0 帧。Unity 工作台新增后续 Bake 自动导出，但该 C# 路径尚未重新运行验证。
- 新 `rest_retarget.py` 累积模型空间旋转，计算 `D=Q_anim*inverse(Q_rest)`，按实际导出器 `(-x,y,-z)*12.5` 换基，再算 `inverse(D_parent)*D_bone` 写 VMD。实际 PMX 静止位置、骨名和父节点已核对。
- 新 VMD 共 24 骨（22 核心 + Reference/Pelvis 祖先）、31 时刻、744 条骨骼帧，帧号 0–30。仍然只输出旋转。
- 24 项 Python 测试通过；独立 MMDParser + Three.js 回读实际 PMX/VMD 后，核心骨旋转最大误差约 0.0000064 度，Hips 对齐后位置误差约 9.3e-8 米。不对齐时仍有约 0.0301 米误差，因为未导出 Hips 平移。
- **用户已确认身体重定向版播放成功**，随后提出补齐手指；不能据此声称物理、辅助骨、面部或游戏 IK 已完整还原。

命令与报告见 `tools/gakumas-vmd-prototype/POSE_DIAGNOSTIC.md`，旧两版 VMD 保留。

### 后续：手指版已导出，待视觉验收

- 新动作：`G:\SillyTavern\SillyTavern\tools\gakumas-vmd-prototype\fktn_idle_unity_rest_fingers.vmd`。
- 必须配套加载：`E:\gakumas-pmx-workflow\output\fktn-casl-reference-matched\fktn-casl-reference-matched-vmd.pmx`。原 PMX 与已确认身体 VMD 不变。
- 采样已有双手完整 30 节指骨，不需要重跑 Unity。沿用身体相同重定向算法，增加 `--include-fingers --bone-aliases tools/gakumas-vmd-prototype/finger-bone-aliases.json`。
- 右手中指 `RightHandMiddle1/2/3` 超出 15 字节 VMD 骨名字段，不能截断。兼容 PMX 只改主骨名为 `RHandMiddle1/2/3`；英文备用名、索引、父节点、顶点、材质和贴图均不变，并已完整解析比对。副本放在原目录，沿用贴图。
- 总计 54 骨、31 帧、1674 条记录；身体 744 条记录逐字节保持不变。30 节指骨均有变化（相对首帧最大局部角变化约 4.38–44.76 度）。
- 31 项 Python / 6 项 Node 测试通过；独立实际文件回读最大旋转差约 `0.00000819` 度、Hips 对齐关节误差约 `2.32e-7` 米。
- 手指视觉效果尚待确认，下一步看第 0/15/30 帧拇指及握指方向。仍不含 Hips 平移、面部、物理、游戏 IK 和未选择辅助骨动画。

## 当前动作转换路线（含前阶段记录）

### 最新：补齐 Hips 位移，修正导出导致的足部轨迹偏移

- 用户反馈角色像被固定在骨盆处、脚会飘。已确认 Unity 采样有 Hips 升降和横移，而旧 VMD 对 Hips 只写旋转、平移全零；例如 kobiru-001 的骨盆 Y 变化约 14.5 厘米。
- 新推荐目录：`G:\SillyTavern\SillyTavern\tools\gakumas-motion-workbench\generated\batches\fktn-001\vmd-hips`。13 条 VMD 已生成；原 `vmd` 目录保留。仍搭配同一个 `fktn-casl-reference-matched-vmd.pmx`，不必改模型。
- 使用原采样，不重开 Unity。根据父骨形变求局部平移 `inverse(D_parent)*(p_anim_pmx-p_reconstructed_parent)-bind_offset`，不是减首帧，不是强制把脚压在地面。
- 401004 条骨骼记录的名称、帧号、旋转、插值字节不变，只补 7426 帧 Hips 三轴平移。
- 新 `--hips-translation` 模式必须通过绝对位置校验，不允许靠 Hips 对齐掩盖偏移。整批绝对关节位置差从约 19.65 米降至约 8.01e-7 米；四个 Foot/ToeBase 最大误差约 6.62e-7 米。
- 52 项 Python / 6 项 Node 测试通过；旧零位移 VMD 在绝对位置负例检查中被正确拒绝。绝对坐标匹配的是现有 Unity Bake，不是额外还原游戏 IK 或足底接触约束；本次修正版仍待用户实际播放确认。
- 新索引 `INDEX-HIPS.md`、新汇总 `summary-hips.json`。命令见 `tools/gakumas-motion-workbench/BATCH.md`。仍不含面部、游戏 IK、头发/裙摆物理及任意外部模型根运动；若仍脚滑，先对比原采样对应时刻，而不是继续盲改骨轴。

### 前阶段：琴音其他动作完成首批旋转导出

- 用户已经确认完整手指版播放无误。随后新增批处理，13 条身体 Clip（原 idle-in 回归基线 + 12 条其他动作）均通过独立数值验证，14 条面部 Clip 明确跳过。
- 输出：`G:\SillyTavern\SillyTavern\tools\gakumas-motion-workbench\generated\batches\fktn-001\vmd`；完整清单与限制见同级 `INDEX.md`、`summary.json`。
- 继续使用 `fktn-casl-reference-matched-vmd.pmx` 兼容模型，所有成品为 54 骨旋转（包含手指）。累计 7426 帧、401004 条记录。
- 已在独立 Unity 工程中复用成功 prefab/Avatar 和真实 rest；没有关闭或修改用户已打开的场景。源动作包和原成功文件保留。
- 原料准备、隔离工程、先小批后全量、逐条失败隔离和报告已脚本化。入口 `tools/gakumas-motion-workbench/batch.py`、`run-batch.ps1`；操作说明 `tools/gakumas-motion-workbench/BATCH.md`。后面的“尚未写回 VMD”及“下一步写 VMD”属于历史，不代表最新状态。
- 部分浮点末帧会映射到重复 VMD 帧号，现对原始采样做 30 FPS 线性/SLERP 重采样，而不是放宽转换器时序检查。重 Bake 基线最大局部角差约 0.000083 度，符合既有 0.001 度标准，但不是逐字节相同。
- 41 项 Python / 6 项 Node 测试通过，全批回读最大旋转差约 0.0000177 度，Hips 对齐位置差约 2.63e-7 米。
- **这些新动作尚待用户实际播放确认，且仍未导出 Hips 平移。** 155 秒 Live 未对齐位置差可达约 19.65 米，oneoff-001 约 1.20 米；不能说舞台走位或完整动作已还原。下一步优先补 Hips 平移，再处理面部与完整待机拼接。原始采样已保留，补位移不必重新解包。

### 早期路线对照

已经验证的两条路径：

```text
路径 A（能出 VMD，姿态不可靠）
Gakumas AnimationClip
-> UnityPy 读取 DenseClip/MuscleClip
-> 启发式 Muscle 到 PMX 骨骼旋转
-> 当前 PMX 英文骨名写出 VMD
-> MMD / mmd-dialogue-stage 播放

路径 B（Unity 已求解，尚未写回 VMD）
原装身体 AssetBundle Instantiate
-> 重建 Humanoid Avatar（52 骨）
-> 原装 MuscleClip（不要存成空 .anim）
-> PlayableGraph 逐帧 Evaluate / HumanPoseHandler
-> 骨骼 local Transform（BodyLegacy.anim、body-sampled.json、BVH）
-> 下一步：映射到 PMX 并写出 VMD
```

磁盘上找不到原装偶像 Avatar。重建 Avatar 已足够让 Unity 播 Humanoid Clip。Python 侧 `m_IndexArray` 与 HumanTrait 槽位（肌肉 `i` 在槽 `i+7`）已核对，见 `tools/gakumas-vmd-prototype/humanoid.py`。

下一步优先级：

1. 用路径 B 的 Bake 结果写 VMD，与 `fktn_idle_heuristic.vmd` 对照，不要再调启发式欧拉。
2. 预览与导出都按 `_in` 再 `_pose` 拼接待机，不要循环 `_in`。
3. 将 `_f` 面部 AnimationClip 与 PMX Morph 建立映射。
4. 如需兼容外部标准 MMD 动作，再增加日文骨骼名、标准 IK 和显示枠。

## PC 客户端 Avatar 检索（2026-09-08）

游戏当前在 `G:\gkmas\gakumas`。Player.log 里的 `F:\gkmas` 是换硬盘前的旧盘符。

已检查：

- `G:\gkmas\gakumas\gakumas_Data`：无 Avatar 文件名；`data.unity3d` 无 `HumanDescription` / `m_Avatar`
- `C:\Users\86139\AppData\LocalLow\BANDAI NAMCO Entertainment Inc_\gakumas`：日志和本地缓存无 Avatar 资产
- `G:\gkmas\gakumas\octo\pdb\400\705100\octocacheevai`：解密后的资源目录无 `avatar` / `humanoid` / `PrettyAvatar`；角色包前缀是 `mdl_`、`mot_`

运行时 metadata 只有 Unity 引擎 Avatar API 和 ADV `AvatarMask`，没有可导出的偶像 Avatar 资产。当前 PC 客户端 Unity 版本是 `6000.0.77f1` IL2CPP。工作台用 **2022.3.21f1** 加载解包 AB；重建 Avatar 已能播放，不必再从客户端挖原装 Avatar。

探针插件：

```text
G:\SillyTavern\SillyTavern\tools\gakumas-runtime-probe
```

安装 BepInEx 6 IL2CPP 后进入 3D 角色场景按 F8，导出运行时 `Avatar` / `HumanDescription`。

## 验证命令

修改 `public/mmd-dialogue-stage/app.js` 后至少运行：

```powershell
cd G:\SillyTavern\SillyTavern\public\mmd-dialogue-stage
node --check app.js
node --test tests/core.test.mjs
```

当前最后一次验证结果：语法检查通过，4 个核心测试全部通过。

## 下一步建议

若继续网页 Shader：

1. 先把材质角色分类从 mesh 级改成 material 级。
2. 按 PMX `mapFileName` 做逐材质的 Def/Sdw/Ramp 关联。
3. 把角色 ShadowDepth 做成独立材质过滤 Pass。
4. 浏览器里实际加载用户模型并检查控制台/WebGL 编译错误。

若继续动作提取：

1. 打开 `tools/gakumas-motion-workbench/UnityProject`，菜单 **Tools > Gakumas > Build and validate sample**。
2. 确认 Play：`_in` 约 1 秒，然后 `_pose` 站住；Console 有 `GAKUMAS_PLAY_SEQUENCE` 与 `GAKUMAS_SAMPLE_DELTA`（`rot`/`muscle` 大于 0）。
3. 把 `generated/body-sampled.json` 或 `BodyLegacy.anim` 转成 VMD，在当前 PMX / `mmd-dialogue-stage` 对照启发式文件。
4. 再单独研究 `_f` 面部 Clip 和 PMX Morph。
5. 不要把 Humanoid Clip 另存为 YAML `.anim`，不要循环 `_in` 当完整待机，不要反编译 `GameAssembly`。
