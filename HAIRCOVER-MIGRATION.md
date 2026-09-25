# HairCover 语义迁移（2026-09-09）

## 依据与范围

本地参考仓库 `.tmp/Yu-ki016-Articles`，提交 `00c0d1c9868a9f4b910fbb502b5c8080bc8f0cb6`。
参考目录 `卡通渲染/学园偶像大师/角色渲染` 中的文章第 3.12、3.13 节，及
`UnityProject/GakumasSample/Assets/Reverse/Shader/GakumasActor_Sample.shader`、`GakumasCommon.hlsl`。

本次只迁移 HairCover 的绘制选择、顺序和 Alpha；沿用现有 Actor GLSL 光照及已实测成功的基础 Stencil。
不宣称完整移植 URP 光照，也不把新的 Shader 应用到身体或替换 PMX。旧复制网格方案不再使用。

## 映射与风险

| Unity 语义 | Three.js r152 对应实现 | 必须避免的问题 |
| --- | --- | --- |
| 基础 Pass | 原来的 renderer.render(scene, camera) | 不重排已成功的基础材质，不改原始透明度 |
| HairCover Pass | 基础 scene.onAfterRender 内，对原 mesh/geometry 的 m_hir group 调用 renderBufferDirect | 只能在 renderState 仍有效时调用，不能在 renderer.render 返回后调用 |
| disabledShaderPasses | CPU 建立严格的 m_hir 绘制白名单 | 不绘制身体、不传 group=null、不用全场景 overrideMaterial、不以隐藏基础材质代替禁用第二 Pass |
| 共用 GakumasCommon | 基础和覆盖材质共用 injectActorShader | 不丢 UV、贴图、蒙皮、Morph；覆盖仅增加独立 Alpha 分支 |
| ZWrite Off / 默认 LEqual | depthWrite=false / depthTest=true / LessEqualDepth | 不清深度、不偏移顶点，不让后脑勺穿过脸 |
| SrcAlpha / OneMinusSrcAlpha | CustomBlending，RGB 对应因子，画布 Alpha 单独 One/OneMinusSrcAlpha | opacity 不是 Blend 开关；不能无意二次预乘，也不能把不透明脸的画布 Alpha 改为 0.35 |
| 覆盖不执行基础 Stencil 剔除 | stencilWrite=false | Three.js 此属性同时关闭模板测试；不能仅用 writeMask=0 替代 |
| Outline 后续 Pass | 补绘完成后执行原 OutlineEffect.renderOutline | 不让覆盖材质进入 OutlineEffect 的临时材质替换流程 |

绘制顺序：基础场景（包含眉眼、基础头发和原高光）→ m_hir HairCover → 原描边。
基础场景内的分组排序保持原样；透明列表排序不能仅凭 renderOrder 跨越不透明列表，因此第二阶段显式调度。
只借用原对象的骨架、Morph 和几何缓冲，既不新建 Mesh，也不更换 object.material 或 geometry.groups。
附加绘制时重新计算 modelViewMatrix、normalMatrix；材质独立、光照 uniform 共用，贴图不重复释放。
当前仅支持本项目默认 framebuffer + 普通相机；离屏 MSAA resolve 与 ArrayCamera 需要另行迁移，不静默套用。

文章截图的 HairCover 是 ZWrite Off，本地仓库后续版本是 ZWrite On。本次明确选文章的 Off，避免覆盖层写入深度影响眉眼/后续透明绘制。
示例 m_hir 的 Alpha Blend 为 One/Zero，但当前透明 WebGL canvas 的 Alpha 会被浏览器拿去与 CSS 背景合成，不能覆盖为头发淡出系数。本次使用 source-over Alpha：aOut=aSrc+aDst*(1-aSrc)，保持已绘制不透明脸部的画布覆盖率为 1；RGB 仍使用示例因子。这是目标缓冲语义适配，而非改变头发 RGB 混合。
截图注释掉 Stencil 不足以证明 Unity 没有继承 SubShader 状态；此处明确选择覆盖阶段不受基础头发剔除，否则不能补回眉眼区域。
文章 3.13 也区分示例与原游戏描边顺序；本次维持示例顺序，不新增另一套眉毛描边。

## Alpha 不是普通透明贴图

源码公式（头部方向和片元到相机方向均在世界空间）：

```
fadeX = clamp((fadeParam.x - dot(headForward, viewDirection)) * fadeParam.y, 0, 1)
fadeZ = clamp((abs(dot(headUp, viewDirection)) - fadeParam.z) * fadeParam.w, 0, 1)
alpha = mix(1, max(fadeX, fadeZ), textureAlpha) * materialAlpha
```

纹理 A=0 是不参与视角淡出，A=1 是完全参与，不是“黑色透明、白色不透明”。
使用 Shader 默认 FadeParam=(0.75,2,0.4,4)，不伪称是琴音原始运行时参数。
已测当前琴音 PNG A 全为 255；严格公式在正面可产生接近 0 的覆盖 Alpha，不能保证半透。
UI 提供明确标注的“正面最低覆盖（补偿）”，默认 0.35：把 max(fadeX,fadeZ) 的下限设为该值。
设为 0 即严格示例公式；该补偿不是游戏原始公式，也不替代后续源纹理检查。侧后方仍按原公式恢复不透明。

## 验证门槛

- 单元测试：公式正/侧/背/俯视，白/黑/灰遮罩；仅 m_hir group 被补绘；开关、异常恢复、资源释放。
- 真实 WebGL：完整 PMX，开关反复切换，材质引用/map/groups 不变，无 null/编译错误；身体像素不变。
- 固定正面同机位对照：严格模式、补偿模式；侧面、背面；骨骼与 Morph 动画两遍同步。
- 不再用旧的“透明复制网格存在”断言验证多 Pass，测试必须检查实际新增 draw call。
