# 游戏物理算法静态还原

这份文档记录从运行时机器码和 Job 结构中已经确认的算法，不把 Ghidra 的未知辅助函数或推测名称当作已恢复源码。

## v15 反编译结果（2026-09-22）

本轮使用的捕获目录：

`G:\gkmas\gakumas\gakumas-local\physics-diagnostics\capture-2026-9-22-7-24-44-37148-101716671`

离线反编译目录：

`G:\SillyTavern\SillyTavern\tools\gkms-localify-dmm\build\offline-v15-capture-20260922-0724-rerun`

本轮已完成深度 3 的调用链导出：`3919` 个目标进入审计，`3858` 个目标成功写出机器码；队列剩余和丢弃数均为 `0`，函数边界审计中的 `truncated` 数为 `0`。仍有 `61` 个下游目标因可读区域不足而未写出，它们不属于核心入口的直接依赖。

Ghidra 已完成核心函数反编译，包括：

- `ActorAnimationQuartzDriverSkirtBone.Calc`
- `ActorAnimationQuartzDriverHairBone.Calc`
- `ActorAnimationQuartzDriverPonchoBone.Calc`
- `ActorAnimationQuartzDriverPonchoBone.CalcRotation`
- `ActorAnimationQuartzDriverPonchoBone.CalcPosition`
- `ActorAnimationQuartzDriverSkirtJobBone.Execute`
- `ActorAnimationQuartzDriverHairJobBone.Execute`
- `ActorAnimationQuartzDriverPonchoJobBone.Execute`
- `CampusActorAnimationJob.ProcessAnimation`
- `CampusActorAnimationJob.ProcessQuartzDriver`
- `CampusActorAnimationJob.ProcessSwingSkeleton`

对应伪代码位于 `runtime-decompilation.txt` 的核心区段，裙子从第 `7` 行、头发从第 `511` 行、外套位置从第 `1629` 行、各 Job 从第 `1941` 行开始。

### 已确认的通用辅助函数

从机器码和辅助函数伪代码可以确认以下语义：

- `CallTarget_7FFB57BA34C0`：读取 float 向量的指定分量。
- `CallTarget_7FFB57BA4870`：写入 float 向量的指定分量。
- `CallTarget_7FFB557302D0`：把角度包回一个周期范围。
- `CallTarget_7FFB5572EF50`：按上下限选择影响量，再乘以系数差值。
- `CallTarget_7FFB55730760`：先取两个候选限制值中的较小值，再乘以系数。
- `CallTarget_7FFB55730900`：按 `RotationOrder` 将四元数转换为欧拉角或构造对应旋转中间值；六个顺序分支在机器码中真实存在。
- `CallTarget_7FFB5572E2F0`：按轴角构造旋转四元数，内部使用弧度转换常量。

这些辅助函数的原始 C# 名称仍未知，因此恢复实现时应使用语义名称，不应把 Ghidra 生成的 `CallTarget_*` 当作游戏 API 名称。

本轮从 `native-data-references.jsonl` 进一步核对到的常量为：

- `0.017453292f`：角度转弧度，即 `PI / 180`；
- `57.29578f`：弧度转角度，即 `180 / PI`；
- `180.0f`、`360.0f`：角度包回使用的周期边界；
- `PI / 2`、`PI`、`2 * PI`：四元数/欧拉角辅助分支中的旋转常量；
- `-1.0f`、`-2.0f`、`-10.0f` 等同窗数据不是全局常量，应视为相邻方法数据，不能直接解释为统一物理参数。

已把可独立验证的数学核心放入 `src/GakumasLocalify/RecoveredPhysics.hpp`，目前只包含四元数逆、四元数乘法、角度包回、`[0, 1]` 限制和向量线性插值。它是还原用参考代码，不会直接替换游戏 Hook。

### 裙子主公式

`ActorAnimationQuartzDriverSkirtBone.Calc` 的核心流程已可写成：

1. 对输入四元数 `q` 计算 `1 / dot(q, q)`。
2. 将 `q.xyz` 乘以 `-1`，保持 `q.w`，得到逆四元数 `inverse(q)`。
3. 用逆四元数与另一输入旋转相乘，按 `RotationOrder` 提取三个角度分量。
4. 每个轴分别读取当前旋转、内侧参考、外侧参考和限制参数。
5. 经过上下限选择和系数差值计算，得到三个角度影响量。
6. 将角度乘 `PI / 180`，按连接轴构造输出四元数。

因此裙子不是单纯把骨骼沿某个方向平移，也不是统一的欧拉角相加。裙子外偏移异常应优先检查 Job 元素中的内外系数、轴向限制和输入参考旋转。

### 头发主公式

`ActorAnimationQuartzDriverHairBone.Calc` 的确认流程为：

1. 分别从头部、颈部和驱动骨骼输入中提取相对旋转或位移分量。
2. 三个轴分别执行角度包回、限制值选择和系数缩放。
3. 头部平移、头部旋转、颈部旋转是三组独立影响，不应合并为一个重力参数。
4. 最终角度乘 `PI / 180`。
5. `composeType` 走四条真实存在的旋转合成分支，不能用统一的欧拉角相加替代。

这解释了为什么只调整末端骨骼或统一施加向下力，无法修复根部朝向：根部姿态属于头部/颈部驱动和 `composeType` 分支，尾部才继续受到链条二次运动影响。

### 外套主公式

外套由三个独立函数组成：

- `CalcPosition`：先把驱动向量归一化，再根据正负方向分别除以内侧或外侧限制，并把结果夹到 `[0, 1]`，随后在对应参考位置之间线性插值。
- `CalcRotation`：对两个参考位置按插值系数混合，减去当前位置，归一化方向后，与参考旋转组合。
- `Calc`：组合旋转与位置结果，交给 Job 写回 Transform。

因此外套“向前顶”不能只看一个碰撞球半径；至少要同时核对 `innerLimit`、`outerLimit`、插值系数、参考位置以及 `CalcRotation` 使用的方向向量。

### 当前不能声称已恢复的内容

- `AnimationStream` 的真实骨骼输入、输出和写回顺序；
- 每帧 `deltaTime`、碰撞体状态和缓存状态；
- 角色参数写入 Job 数组的完整路径；
- 61 个可读区域不足的下游辅助目标；
- 当前 Hook 仍未命中，`algorithm_invocation_count` 仍为 `0`。

所以本轮已经可以开始编写独立的参考算法，但参考实现必须先以 Job 字段和静态公式为输入，不能声称已经与游戏逐帧等价。

## 离线证据管线

对一次 F8 捕获运行：

```powershell
tools\decompile-capture.ps1 `
  -Capture G:\gkmas\gakumas\gakumas-local\physics-diagnostics\capture-... `
  -Headless G:\ghidra_12.0.4_PUBLIC_20260303\ghidra_12.0.4_PUBLIC\support\analyzeHeadless.bat `
  -OutputDirectory build\offline-v10
```

流程会先生成 `evidence` 目录：

- `methods.json`：按入口地址合并 `manifest.tsv` 中的共享泛型/重复入口。
- `memory.tsv`：合并代码窗口和 RIP-relative 数据窗口。
- `layouts.json`：从实际 `PlayableHandle.GetJobData()` 快照导出的 Job 数组元素布局。
- `evidence-summary.json`：代码覆盖、数据覆盖、冲突和未覆盖调用目标。

从 v11 开始，游戏内一次 F8 导出还会自动生成 `native-helper-manifest.tsv` 和
`native-helper__*.bin`。它们包含目标方法中的直接调用目标，以及沿核心调用链扩展的辅助目标，
当前最多处理三层依赖。v15 对已确认函数边界的目标按实际函数长度读取，其他目标仍使用固定窗口，
这样下一次捕获不需要再手工定位每一个数学辅助函数。

随后 Ghidra 会导入这些内存块，给已知入口建立函数，并输出：

- `runtime-decompilation.txt`：汇编和 Ghidra 伪代码。
- `runtime-decompilation.txt.audit.tsv`：函数内跳转和调用目标是否落在已导入代码中的审计表。

固定窗口不是函数边界。缺失的辅助函数保持为未知目标，不能用猜测实现替代。

## 当前捕获结果

捕获目录：

`G:\gkmas\gakumas\gakumas-local\physics-diagnostics\capture-2026-9-21-19-52-50-44612-60202187`

离线证据摘要：

- `16` 条清单记录合并为 `12` 个入口地址。
- 代码证据 `36,592` 字节。
- 数据证据 `2,586` 字节。
- `166` 个直接调用目标中，`19` 个已有代码窗口覆盖。
- 数据窗口没有地址冲突。
- `12` 个目标函数全部由 Ghidra 完成反编译。

## 已确认的数学片段

### 共享常量

从运行时数据窗口读到：

- `0x7ffb63de9c74 = 1.0f`
- `0x7ffb63de9c78 ≈ 57.29578f`，即弧度转角度常量 `180 / PI`
- `0x7ffb63de9c58 ≈ 0.017453292f`，即角度转弧度常量 `PI / 180`
- `0x7ffb63de9c80 = -1.0f`

### 裙子 `ActorAnimationQuartzDriverSkirtBone.Calc`

从伪代码和机器码可确认：

1. 读取两个四元数。
2. 对第一个四元数计算 `1 / dot(q, q)`，再对 XYZ 分量乘 `-1`，W 保持正值。这是四元数共轭除以长度平方，也就是逆四元数；不是单纯的归一化。
3. 通过 `quaternion * quaternion` 类辅助函数与旋转顺序参数组合参考旋转。
4. 读取另一组结果四元数的三个分量，并分别通过限制/分量辅助函数处理。
5. 按三个轴计算结果分量，结果形式可抽象为：

   ```text
   resultAxis = (outerAxis * limitedRotationAxis + innerAxis) * degreesToRadians
   ```

6. 最后通过一个四元数构造辅助函数生成输出旋转。

`innerCoefficient`、`outerCoefficient`、`limitMin`、`limitMax` 和 `connectionAxis` 来自 `ActorAnimationQuartzDriverSkirtJobBone` 的元素字段。当前琴音样本中裙子数组为 `12` 项，其中 `8` 项激活。

### 头发 `ActorAnimationQuartzDriverHairBone.Calc`

头发函数已经确认包含两组独立的影响：

- 头部平移影响：`headTranslateCoefficient`、`headTranslateLimitMin/Max`；
- 头部旋转影响：`headRotateCoefficient`、`headRotateLimitMin/Max`；
- 颈部旋转影响：`neckRotateCoefficient`、`neckRotateLimitMin/Max`。

流程是：

1. 读取头部、颈部和驱动骨骼四元数。
2. 使用四元数组合辅助函数得到相对旋转。
3. 对每个轴分别计算系数乘积，并经过轴向限制辅助函数。
4. 用 `degreesToRadians` 将最终角度分量转换为弧度。
5. 根据 `composeType` 走四条不同的旋转合成分支。
6. 将头部/颈部影响合成为驱动骨骼的输出旋转。

`composeType` 的四个分支在机器码中是真实存在的，不能用一个统一的欧拉角相加替代。当前琴音样本的头发数组为 `10` 项，其中 `2` 项激活。

### 外套/斗篷 `ActorAnimationQuartzDriverPonchoBone`

`Calc`、`CalcRotation` 和 `CalcPosition` 是独立的三个函数：

- `Calc` 先按 `lerpCoefficient` 在两个参考位置之间插值，再减去当前偏移。
- 插值结果会经过向量归一化/方向辅助函数。
- `CalcRotation` 使用参考旋转和方向向量计算外套旋转。
- `CalcPosition` 使用多个参考偏移、`innerLimit`、`outerLimit` 和轴向参数计算外套位置。
- `Calc` 最后把旋转和位置组合成输出 Transform。

当前捕获中 Poncho 数组存在，但 `6` 项全部未激活；这能解释为什么琴音样本对外套算法只能完成静态代码还原，不能从该样本验证运行时结果。

## 当前仍缺失

以下部分还不能声称已经恢复：

- Ghidra 伪代码中的 Unity 数学辅助函数原始语义；
- `ProcessQuartzDriver` 调用的各个 Quartz 分区函数与其完整函数体；
- `AnimationStream` 读写的真实骨骼值；
- 每帧的 `deltaTime`、碰撞结果和状态缓存；
- 头发/裙子参数如何从角色配置写入 Job 数组的完整路径。

下一阶段应优先扩大缺失调用目标的机器码导出，而不是修改前端二次运动参数。只要补齐 `Calc` 调用的四元数、限制、欧拉角和 `AnimationStream` 辅助函数，就可以把当前伪代码整理成可移植的 C++/JavaScript 参考实现。
