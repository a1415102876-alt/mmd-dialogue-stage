# v25：恢复角色级逐帧骨骼姿态追踪

- `idol-parameters.json` 继续保存角色级 NativeList、组件和 Quartz 参数；成功读取第一个 Actor 后同时打开 `frame-trace.jsonl`。
- `frame-trace.jsonl` 记录该 Actor `CampusActorController.LateUpdate` 前后的物理相关 Transform，包括局部/世界位置和旋转，以及原始回调期间发生的 Transform 写入。它不能替代 Native 参数，也不包含 Burst 内部粒子状态。
- `capture.json` 增加 `frame_trace_ready`、`frame_trace_file`、`frame_count` 和 `transform_write_count`，用于区分“参数导出成功”和“逐帧追踪实际写出”。
- 逐帧追踪只在成功打开输出文件后启用；打开失败会让本次捕获进入失败状态，避免生成看似完整但缺少逐帧数据的目录。

# v24：导出 NativeList 与组件的运行时对应证据

- `idol-parameters.json` 的 `schema_version` 为 2。每个 `native_lists[].items[]` 动力项都会带 `mapping_status` 和 `component_candidates`；只有运行时参数、rest/local/modeling 变换、限制和碰撞参数组成唯一匹配时，才写入 `resolved_component`。
- `resolved_component` 同时记录 `swingDynamicBones` 的组件索引、骨骼名、Transform 路径和 Native 项索引。多个组件共享完全相同的运行时状态时保留所有候选并标记 `ambiguous`，没有足够字段时标记 `signature_missing` 或 `unmatched`，不按列表顺序强行配对。
- 每个偶像还会有 `native_component_mapping` 汇总 `resolved`、`ambiguous`、`unmatched` 数量。这个汇总用于判断是否需要补抓，不代表所有算法已经完整还原。

## v25：恢复完整运行时与 Playable Job 快照

- F8 捕获现在同时写出 `idol-parameters.json`、`runtime-data.json` 和 `runtime-job-data.json`。
- `runtime-data.json` 保存当前已捕获 Actor 的完整类型约束对象图，以及 `CampusActorAnimationJob` 的可读字段、Quartz `NativeArray` 头和最多 32 个数组元素。它保留原始地址、字段状态和跳过原因，适合定位“参数不存在、数组为空、引用没解析”三类问题。
- `runtime-job-data.json` 是同一批数据的窄投影，只保留角色身份、`animation_job_references` 和 `playable_jobs`，便于比较不同偶像的 Job 数组长度、激活槽、元素类型和 `GetJobData` 读取状态。
- 两个文件都由主线程在原有 `CampusActorController` 回调内只读写出，不调用或改写 Burst 求解器，也不在工作线程解引用 `AnimationStream`。因此它能拿到 Job 输入配置和数组快照，但仍不能单独证明每一帧的内部粒子状态。
- `capture.json` 的 `runtime_graph_written`、`runtime_job_written` 必须都是 `true` 才算导出完整。若任一项为 `false`，优先查看 `capture_failed`、`runtime-progress.jsonl` 和对应文件是否存在。

# v23：每次 F8 只导出该偶像的个性化参数

- 角色参数主文件仍是 `idol-parameters.json`，另有 v25 恢复的 `runtime-data.json` 和 `runtime-job-data.json`；公共求解器审计和原生机器码仍不会随每次角色捕获重复导出。
- 公共模块、整份对象图、类元数据和原生函数机器码仍不会随每次角色捕获重复导出；角色级 `frame-trace.jsonl` 由 v25 单独恢复，用于逐帧骨骼对齐。
- 未启用的 Quartz Job 槽不写入。组件上的引用会展开成对应 Setting 或骨骼名；进程地址、`raw_hex` 和模块基址不写入。`physics_parameters_complete` 仍是 false。读失败、截断或跳过的列表留在 `gaps`。

# v22：定向补读 Swing NativeList，关闭大范围原生代码导出

- F8 捕获保留现有控制流 hook 和运行时对象快照，但不再调用 `CaptureTargetMethods` 或 `CaptureQueuedNativeHelpers`，因此不会再次生成大批原生函数 `.bin`、反编译输入和调用图文件。
- `ActorAnimationSwingJobSkeleton` 只展开 `dynamicBones`、`staticBones`、`breastBones`、`chainBones` 四个 `NativeList<T>`：读取 `NativeList<T>.m_ListData`、`UnsafeList<T>` 的 buffer/length/capacity 和最多 256 个元素。
- `runtime-data.json` 的 `capture_mode` 为 `targeted_swing_native_lists`，`capture.json` 的 build 为 `targeted-swing-native-lists-v22`。`staticBones` 是 `5573E010` 在 `param_1 + 0x60` 使用的缺口。
- 本轮不会把 NativeList 元素误当成 NativeArray 16 字节头；无效指针、长度、容量和元素类型会写出明确状态并停止该列表读取。

# Gakumas runtime physics diagnostics — manual-capture-v21-depth-and-64k

## v21：深度到顶的有边界函数继续跟调用，无边界窗口改为 64 KiB

- v20 队列已经排空，但普通调用到深度 3 就停，所以 `0x7ff97dd49240` 一类函数里的 14 个直接调用没有字节。现在深度到顶、并且能对上 unwind 边界的函数仍会收集直接 `CALL`，再沿有边界的被调函数最多跟 16 层。
- 没有边界的目标以前只读 16 KiB。摆动正文直接调进的那 11 个窗口就是这样。现在这类目标读到 64 KiB；读满会在扫描记录里标 `unknown_boundary_capped`，并在 `capture.json` 里计数。
- 辅助函数上限提到 65536。`native_helper_graph_closed` 仍表示队列排空。它不表示超过 64 KiB 且没有边界的函数、或间接跳转已经完整。

## v20：一次把物理调用图收到队列排空

- 先前每次只再跟一层，所以 `0x7ffa0f959c10`、`0x7ffa0f95ae60` 和 `0x7ffa16774130` 里面的五个调用要等下一次。现在有 unwind 边界的函数会继续收集直接 `CALL`，最多 16 层；已经见过的地址不重复进队。
- 没有边界的窗口只收集距离入口 64 KiB 内的调用，不把整个运行时库拖进来。辅助函数上限提到 32768。
- `capture.json` 的 `native_helper_graph_closed` 为 true 表示队列排空且没有丢弃。它表示这次从物理入口出发的直接调用和条件跳转落点已经收完，不表示间接跳转或游戏里所有代码都已导出。

## v19：补抓有边界的延续调用的下一层

- v18 拿到了摆动正文的直接调用，但这些函数自身的 `CALL` 仍停在深度 3。因此 `0x7ffa0f95bb40` 调用的 `0x7ffa0f955f60`、`0x7ffa0f956360`、`0x7ffa0f95b9c0`，以及 `0x7ffa0f95ef00` 调用的 `0x7ffa16774130` 没有落盘。
- 从延续片段收来的调用若能对上自己的 unwind 边界，再收集一层直接 `CALL`。没有边界的 16 KiB 窗口不再向外展开。辅助函数上限提到 16384。
- 地址随 ASLR 变化。下一次捕获用调用关系定位，不依赖上面的绝对地址。

## v18：补抓深度上限处延续正文的直接调用

- v17 已经拿到三段摆动正文，但它们位于调用深度 3。深度达到上限后不再跟踪 `CALL`，所以正文里的 `0x7ffa1136e630`、`0x7ffa11366e20`、`0x7ffa11367b70`、`0x7ffa1136bb40`、`0x7ffa1136ef00`、`0x7ffa1136a1e0`、`0x7ffa17fd5840` 和三个 `0x7ffa1809` 目标没有单独落盘。
- 现在深度已经到顶、但本身是延续片段的函数，仍会收集直接 `CALL`。这些调用留在同一深度，不再向更深处展开。辅助函数上限提到 12288。
- 地址随 ASLR 变化。下一次捕获用同样的调用关系定位，不依赖上面的绝对地址。

## v17：补抓条件跳转没走的那一侧

- v16 跟到的 `JZ` 目标是返回垫片：`557380A0` 只多了 16 字节的 `add rsp` 和 `ret`，另外两个垫片还因为短于 16 字节被丢掉。摆动正文不是跳转目标，而是函数头结束处直接往下的那段，上次起点是 `0x7ffa11c0e099`、`0x7ffa11c081a1`、`0x7ffa11c0bf6a`。
- 捕获范围正好结束在条件分支上时，把下一条指令的地址也加入队列，仍然限在入口 64 KiB 内。跳转目标继续保留。延续片段不再因为短于 16 字节被拒绝。
- 这仍依赖落点处的 unwind 边界；没有边界时从落点读 64 KiB。不表示整段粒子求解都已完整。

## v16：补抓 unwind 窗口外的直接跳转正文

- 上一轮 `5573E010`、`557380A0`、`5573BE80` 的 Windows unwind 只覆盖函数头（137 到 257 字节）。函数头末尾的 `JZ` 跳到窗口外，调用图只跟踪 `CALL`，所以摆动正文没有落盘。
- 现在每个已抓函数会额外收集落在捕获范围之外、且距离入口不超过 64 KiB 的直接 `JMP`/`Jcc` 目标。每个函数最多 16 个，沿同一入口再跟 2 跳。这些目标与调用边共用队列，不增加调用深度，因此深度 3 的摆动函数也能带出正文。
- 跳转目标若落在某个 unwind 函数内部，从落点读到该函数末尾，仍以 64 KiB 为上限；没有边界时按 64 KiB 读取。辅助函数捕获上限从 4096 提到 8192。超限仍写入 `native_helper_queue_dropped`，不表示整段算法都已齐全。

## v15：按已确认函数边界扩大读取窗口

- 辅助目标入口与 Windows unwind 起点一致时，按函数实际长度读取，安全上限为 64 KiB；边界未知时仍使用 16 KiB。读取不跨当前已验证的可执行内存区域。
- 不固定旧进程的绝对地址，每次重新解析边界；深度 3、4096 个目标的上限不变。
- 用于补齐上一轮长度为 0x805e（32862）字节、被 16 KiB 窗口截断的辅助函数。超限或区域不足仍通过 `truncated` 报告，不保证所有函数或全部算法完整。

## v14：针对核心调用链补采集第三层辅助机器码

- 辅助函数导出使用广度优先队列：先收集所有物理入口的直接调用目标，再处理最多三级依赖；当前上限为 4096 个目标，只沿核心物理入口的直接调用链扩展，不做全模块扫描。
- 使用 Windows x64 unwind function table 判断函数边界；能确定边界时，写入 `.bin` 和 manifest 的长度只覆盖该函数，无法确定时才回退到固定窗口，并写入 `native-scan-ranges.jsonl`。
- `native-helper-audit.jsonl` 记录每个目标的来源入口、深度和捕获状态；`native_helper_pending` 与 `native_helper_queue_dropped` 写入 `capture.json`。

## v10：运行时机器码反编译与常量引用导出

- 磁盘上的 `GameAssembly.dll` 的 `il2cpp` 段并不包含运行时方法正文；目标 RVA 在磁盘文件中可能只是零填充。反编译必须使用 F8 导出的运行时 `.bin`，按 manifest 中的实际地址加载为 x64 代码。
- `tools/ExportPhysicsDecomp.java` 可对运行时机器码执行反汇编和 Ghidra 伪代码导出。当前已经成功得到 `ActorAnimationQuartzDriverSkirtBone.Calc` 与 `ActorAnimationQuartzDriverHairBone.Calc` 的伪代码。
- 诊断会扫描机器码中的常见 RIP-relative 常量引用，并将目标地址、模块 RVA 和最多 32 字节原始数据写入 `native-data-references.jsonl`。这些数据用于在 ASLR 后还原公式常量；不可读引用会明确记录为 `unreadable`。
- 同时记录直接 `CALL rel32` 的目标到 `native-call-references.jsonl`，用于追踪 `ProcessQuartzDriver` 复制 Job 后实际调用的泛型辅助函数；这只是调用图证据，不把目标函数自动认定为物理求解器。
- 常量引用导出仍不是完整函数边界，也不会把伪代码直接当作可运行源码。需要结合下一次捕获的引用数据、调用关系和输入输出样本进行验证。

## v9：Job 数组布局修正与调用级验证

- 保留两个包装入口，并新增 `QuartzSkirtJob.Execute`、`QuartzHairJob.Execute`、`QuartzPonchoJob.Execute` 和 `ProcessAnimation` 调度入口。只选择当前声明类中签名为 `System.Void(UnityEngine.Animations.AnimationStream)` 的非静态、非抽象方法；拒绝不明确的候选和复用地址，不钩住共享接口桩。
- `algorithm_hooks` 分别记录创建和启用结果、模块、RVA、trampoline。旧 `ADD_HOOK` 的日志只反映创建返回值，不能单凭它证明启用结果；v6 导出机器码的跳转补丁是额外证据。
- `algorithm_completed_call_counts` 只统计同一次捕获、同一线程、同一调用 ID 的进入/返回配对。包装入口、具体 Quartz Job、调度入口分开报告；仅 `ProcessAnimation` 命中不会把物理算法标为已验证。`algorithm_io_verified` 仍是 false。
- `algorithm_lifetime_counts` 是 DLL 本次加载以来的累计进入/返回次数，不受 F8 窗口限制。可区分“只在捕获外执行”和“这些入口始终未观察到”。它不是角色归属证据。
- 工作线程只写固定容量缓冲，不生成 JSON、不写文件、不调用 Unity/IL2CPP API、不解引用 Job/Stream 参数。主回调批量落盘；溢出由 `algorithm_events_dropped` 明示，记录器异常由 `algorithm_recorder_errors` 明示。窗口在最后一个新角色的快照完成后保留约 3 秒。
- `modules.json` 提供实际加载模块和地址范围，便于后续定位 Burst；仅模块存在不能证明物理执行路径。机器码导出会覆盖回本诊断钩子安装前保存的 32 字节入口，不再把自己的跳转补丁误当游戏原始指令；依然不是完整函数边界。
- 运行 `node physics-trace-report.mjs <capture目录>/frame-trace.jsonl <capture目录>/frame-report.json` 生成 schema 3 离线报告。以下 v5/v6 章节保留历史背景，以此处 v7 语义为准。

### 离线验证范围

`tests/algorithm-trace.test.cpp` 验证配对、捕获隔离、容量限制、累计次数和多线程记录。`tests/algorithm-hook-abi.test.cpp` 在独立进程中真实安装 MinHook，验证 Windows x64 下 56 字节按值参数的间接传递及 self/MethodInfo 转发；这不是游戏内 ABI 或命中验证的替代品。运行 `tests/verify-diagnostics.ps1` 可重复执行测试和 DLL 构建。

This source tree keeps Localify's existing Windows loader and IL2CPP initialization path. The added diagnostics are read-only:

- Startup only logs `hotkey_ready`. Press F8 in a foreground game window with an updating 3D actor to run the runtime graph, metadata and frame trace capture manually. Holding F8 triggers only once; release before pressing again.
- The same phase exports up to 4096 readable bytes from the native implementations of the skirt, hair, poncho, and job-processing methods, then exports up to 16 KiB from direct native call targets and their first-level call targets. The files are raw machine code, not reconstructed C# source.
- Automatic `SnapshotSetup()` capture is disconnected. Manual capture records controller names and Transform ancestor names observed in LateUpdate over approximately 1.5 seconds, up to 64 controllers.
- `frame-trace.jsonl` records an `input` and `output` transform snapshot around each original `CampusActorController.LateUpdate`, relevant Transform injected setter writes observed during the original call, and entry/exit records for the shared `CampusActorAnimationJob.ProcessQuartzDriver` and `ProcessSwingSkeleton` methods. The algorithm records only pointer identity, timestamp and thread ID; they do not read or modify `AnimationStream` memory.
- Each actor snapshot is taken within that actor's current LateUpdate callback, using trusted declared-field metadata. No actor pointer survives to a later callback. Graph traversal is limited to ActorAnimation and selected CampusActor model/animation routing classes; unrelated UI references are not traversed.
- List fields are resolved via metadata for `_items` and `_size`. Only reference-element physics collections are traversed after checking declared classes, element stride, capacity and each readable slot. Value-type collections are explicitly skipped, never interpreted as object pointers. Scalars retain their real widths; vectors and embedded structures are retained as typed raw bytes for later decoding.
- Every completed object is flushed to `runtime-progress.jsonl`; rejected reads and truncation are reported. Snapshot limits are 8 reference levels, 2048 objects, 512 items per collection and 256 fields per declaring class.
- No diagnostic code writes physics values, changes poses, installs a second loader, or creates a worker thread.

## Build

From the repository root:

```powershell
conan install . -of build -s build_type=Release -s compiler.version=194 -s compiler.cppstd=17 --build=missing
utils\bin\premake5.exe vs2022
cmd /c "`"C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat`" -arch=x64 -host_arch=x64 && msbuild build\gakumas_localify_dmm.sln /m /p:Configuration=Release /p:Platform=x64"
```

The diagnostic build is produced at `build/bin/x64/Release/version.dll`. It is intentionally not copied into the game directory by the build.

## Capture

Keep the known-good game installation unchanged until the build is ready to test. For a controlled test, back up the installed Localify `version.dll`, replace it only for one run, enter a 3D scene, then restore the backup before comparing results.

进入偶像已加载的 3D 场景，使游戏窗口位于前台，松开后按一次 **F8**，保持场景至少五秒。切换角色后可再次按 F8，每次生成独立目录，不覆盖旧记录。导出可能短暂卡顿，不需要重启游戏来导出下一次。

输出位于 `gakumas-local/physics-diagnostics/capture-<UTC日期时间>-<进程号>-<时钟计数>/`：

- `capture.json`：触发信息、状态、线程号、角色控制器对象名、Transform 祖先名称。
 - `runtime-data.json`：schema 6；按 `actors[]` 保存当前回调的类型约束语义快照，并带有角色身份。除原始结构体字节外，值类型会递归导出字段，`GameObject`/`Transform` 引用会记录对象名和 Transform 祖先链，骨骼/碰撞体对象会尝试记录自身 Unity 对象名。只有安全到达的对象才导出，不保证包含完整 RigData。结构体集合、未知类型、与声明类型不一致的实例会明确跳过。
 - `runtime-job-data.json`：schema 1；只保留每个角色的 `animation_job_references` 和 `playable_jobs`，用于快速比较 `CampusActorAnimationJob` 的 NativeArray、Job 类型和 `GetJobData` 状态。
 - `runtime-progress.jsonl`：逐对象写入开始、完成或跳过记录，用于定位异常中断；不会等整张对象图遍历完才落盘。
- `runtime-data.json` 中的 `animation_job_references`：记录声明为 `UnityEngine.Animations.IAnimationJob` 的引用是否能安全解析到已知的具体 Job 类型；当前只允许已解析的 `ActorAnimation.CampusActorAnimationJob` 深入遍历，未知实现会明确标为 `job_class_not_allowlisted`，不会把任意对象头当作类元数据。
- 已解析 Job 顶层的 `NativeArray<T>` 会记录数组头、泛型元素类型、元素大小，并最多读取 32 个值类型元素；未知引用元素、异常长度和超过 1 MiB 的范围会拒绝读取。
- 内联值类型的元数据偏移会转换为值内存偏移后再读取；装箱 Job 对象字段仍使用对象偏移。`NativeArray<T>` 只按已确认的 16 字节 `buffer + length + allocator` 头读取，不再把后续内存误记为 safety。
- `frame-trace.jsonl`：逐帧 `input`/`output` 骨骼姿态，以及 LateUpdate 内实际发生的相关 Transform 写入；只记录名称包含物理相关骨骼关键词的 Transform。
- `frame-trace.jsonl` 中的 `algorithm_invocation`：共享 Job 的进入/返回事件、线程和原始指针。`capture.json` 的 `algorithm_execution_verified` 只有在两个 Job 都出现成对的 `enter`/`exit` 时才为 `true`；这证明入口命中，不等于已经取得内部 `AnimationStream` 数值或完整公式。
- `manifest.tsv`：程序集、类、方法、签名、地址、字节数、机器码文件名（无表头）。
- `.bin`：目标方法入口起最多 4096 字节的机器码片段；`native-helper__*.bin` 是直接调用目标及其一级调用目标起最多 16 KiB 的片段。
- `native-helper-manifest.tsv`：辅助原生函数的地址、大小和机器码文件名。
- `native-data-references.jsonl`：机器码中可识别的 RIP-relative 数据引用及其运行时原始字节。
- `native-call-references.jsonl`：机器码中的直接调用目标及模块 RVA。

日志 `gakumas-local/log.txt` 中搜索 `PHYSICS_DIAG capture_begin`、`capture_actor`、`capture_end`。没有正在更新的角色时，F8 不会触发；触发后若立刻暂停或离开场景，状态可能停在 collecting，需要等待后续角色更新。

## 角色归属与限制

Calc/Execute 是共用原生方法，不是某个偶像独有的算法。`capture.json` 记录按键后约 300 毫秒内进入 `CampusActorController.LateUpdate` 的控制器，不是画面可见性筛选，也不是角色选择器。多人场景分别记录，首次对比建议使用单角色场景。

对象名/层级可能包含模型标识，但不能保证有偶像姓名。识别状态为 `runtime_names_only_not_verified_idol_id`，不猜测姓名。本版只记录可达字段，没有采样算法实际输入输出，不能证明列出的角色执行过全部导出方法。

所有读取在现有 LateUpdate 回调线程执行，跨回调只保存 JSON 和地址数值用于去重，不再保存待解引用的对象指针。读取使用 ReadProcessMemory，拒绝保护页、不可读页及越界范围。元数据 API 只接收由已知类和字段获得的类型，不再把未知内存的首字解释成类元数据。长按与失焦不会连续导出。

## v2 闪退修正

2026-09-21 的琴音抓取停在 `exporting`，未写出 runtime-data.json；日志遍历到了 TMPro/UI、数组和乱码类名。v2 对所有 List 使用 List<void*>、未验证容量/元素类型，并跨回调保存裸指针，存在原生访问违规风险。该版本不应继续用于抓取。日志不足以确定崩溃指令，因此不能将某个具体字段断言为唯一原因。

v3 以类型和边界约束替换这条危险路径。v4 在此基础上增加值类型递归解码和 Unity 对象语义映射。`runtime_snapshot_written` 只表示快照文件写出；`physics_parameters_captured` 和 `physics_parameters_complete` 保持 false，直到离线确认参数覆盖度。只发现非空列表不再算完整参数成功。优先做单角色单次 F8 验证；编译和离线内存检查不代表游戏内稳定性已验证。

v4 首次运行时曾在快照进入 `ActorSwingStaticCollider` 后闪退。原因是该类型是纯托管物理数据，不继承 `UnityEngine.Object`，却被错误地传给了 `Object.get_name()`。修复后只有通过父类链确认继承 `UnityEngine.Object` 的 Bone 类型才会进行 Unity 对象名称解析；Collider 和 Setting 类型继续只读取字段，不调用 Unity 对象方法。

### v8 接口 Job 引用解析

v7 捕获已经确认 `CampusActorAnimationRig._job` 存在，但它的声明类型是 `UnityEngine.Animations.IAnimationJob`，旧遍历器因此只能记录 `reference_only`，没有继续读取具体 Job。v8 在主线程快照时读取该引用目标的对象头，仅将具体类地址与已解析的 `CampusActorAnimationJob` 比对后加入队列，并同时记录声明类型、运行时类型、实例大小和拒绝原因。此步骤仍是只读诊断，不调用 `GetJobData`、不修改 Playable，也不宣称已经获取 Burst 内部输入输出。

当前捕获中已经看到 `CampusActorAnimationBuilder` 的 `AnimationScriptPlayable` 原始字段以及 `CampusActorAnimationRig._job` 地址。下一步必须先由 `animation_job_references` 确认具体 Job 类型，再决定是否继续追踪 `PlayableHandle.GetJobData` 或 Burst 调度入口；不要凭 `lib_burst_generated.dll` 已加载推断公式已命中。

值类型的 `raw_hex` 与元数据字段偏移目前没有确认存在统一的 16 字节错位；先保留原始字节和递归字段，待新捕获中具体 Job 可达后再用独立字段交叉验证。

## 还原判定

### v5 逐帧对照的实测限制（2026-09-21）

琴音捕获 `capture-2026-9-21-5-13-46-5804-7458187` 和 `capture-2026-9-21-5-21-27-5804-7918921` 分别有 18、20 对回调采样，每次包含 275 根骨骼。同一次 LateUpdate 的前后位姿分量完全相同、setter 写入记录为零，但相邻回调之间的头发、Skirt、Jacket 局部旋转均发生变化。不能把回调前后不变解释为角色静止，也不能据此认定物理未运行。现有证据只能把变化定位在两次采样之间，尚不能确认具体 Job 的执行时点或区分各算法贡献。

`physics-trace-report.mjs` 的 schema 2 报告将两种统计分开：`frames` 和 `bones_sorted_by_observed_rotation_change` 仅统计单次回调前后；`inter_frame_transitions` 和 `inter_frame_bones_sorted_by_observed_rotation_change` 比较同一控制器上一回调输出与下一回调输入。不会将不同控制器配对，也不会混合两类样本计算均值。`elapsed_ms` 是记录时间戳之差，不是游戏物理 deltaTime。跨回调变化仍包含动画、父级变换和二次运动，不能直接当作纯物理求解输入输出。较大旋转差也可能受同步采样造成的卡顿影响。报告同时列出 `algorithm_invocation_counts` 与 `algorithm_invocation_phase_counts`，用于确认共享入口是否实际运行。

两份旧报告已用修正后的脚本重新生成。v6 新增了两个共享 Job 的只读入口钩子，签名按 `void(self, AnimationStream, MethodInfo*)` 转发，不改参数、不在工作线程调用 Unity API。下一次 F8 捕获若 `capture.json` 中 `algorithm_execution_verified` 为 `true`，即可确认这两个入口实际执行；随后才能在保持稳定的前提下增加窄范围参数采样。若为 `false`，先检查 `log.txt` 中的 `algorithm_method_resolved`、`algorithm_method_missing` 和 `capture_failed`，不要把骨骼跨帧变化当作入口命中。

`runtime-data.json` 是参数和对象布局的第一阶段证据。`frame-trace.jsonl` 是第二阶段的逐帧外部输入/输出证据，可以用于确认某根骨骼在 LateUpdate 前后如何变化、哪些 Transform 写入实际发生以及写入顺序；v6 还可以证明两个共享 Job 入口被调用，但仍不能直接证明内部 `AnimationStream` 参数。`Calc` 和具体骨骼 Job 的调用关系、参数结构、计算顺序仍需后续在已确认 ABI 后逐步增加只读采样。

4096/16 KiB 窗口不是精确函数边界，部分目标仍可能是接口/泛型桩，辅助函数窗口也可能在内存区段边界处截断。状态 `export_finished_check_manifest_and_log_for_method_failures` 表示导出流程结束，不表示每个方法都成功；需检查清单、辅助清单和日志。编译通过不等于已通过游戏内按键验证。
