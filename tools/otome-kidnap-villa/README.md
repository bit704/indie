# 《囚笼与玫瑰》检验工具集

针对单文件游戏 `game/otome-kidnap-villa.html` 的一套**独立可复跑**的自动化检验工具。
不启动浏览器、不依赖 DOM（存档工具除外，它用 `vm` 沙箱加载游戏真实函数并 mock 环境），
可在 Node 下直接运行，也可接入 CI 作为提交前门禁。

## 目录结构

```
tools/
└── otome-kidnap-villa/          # 按游戏名称归档，每款游戏一个独立文件夹
    ├── lib/
    │   └── extract-data.cjs      # 共享数据层：抽取 SCENES / SCENE_LOCATIONS /
    │                             #   DEFAULT_DATA / ENDING_SCENE_MAP，复刻 evalCondition /
    │                             #   applyEffects 与静态分析辅助函数
    ├── verify-clues.cjs          # 线索可达性（BFS）
    ├── verify-data-integrity.cjs # 数据完整性
    ├── verify-storyflow.cjs      # 剧情流程
    ├── verify-endings.cjs        # 结局分支
    ├── verify-characters.cjs     # 角色交互
    ├── verify-events.cjs         # 事件触发条件
    ├── verify-saveload.cjs       # 存档 / 读档
    └── README.md
```

> 约定：新增游戏时，在 `tools/` 下新建 `tools/<游戏名>/` 文件夹，复用同样的结构与
> `lib/extract-data.cjs` 的思路（每款游戏的脚本标记不同，抽取层需按游戏适配）。

## 运行方式

```bash
# 默认从仓库根目录 game/otome-kidnap-villa.html 读取
node tools/otome-kidnap-villa/verify-clues.cjs

# 也可显式指定游戏文件
node tools/otome-kidnap-villa/verify-endings.cjs path/to/otome-kidnap-villa.html
```

建议 Node ≥ 18。所有工具都通过**退出码**作为门禁信号：

| 退出码 | 含义 |
|---|---|
| `0` | 检查通过 |
| `1` | 存在致命错误 / 不可达 / 逻辑异常 |
| `2` | 参数错误或游戏文件未找到 |

## 各工具说明

### 1. verify-clues.cjs — 线索可达性
- **检查**：本地预设剧情下，每条线索的条件能否被某条可达路径满足并正确解锁。
- **方法**：BFS 遍历 `(场景, flag掩码, 白澈好感)`，复刻"进入场景→设地点→`updateClues()`"语义。
- **输入**：游戏 HTML（可选路径）。**输出**：每条线索可达性 + 探索状态数。
- **退出码**：全部可达→0；任意不可达→1。

### 2. verify-data-integrity.cjs — 数据完整性
- **检查**：脚本可编译；场景 `text/choices` 结构；选项引用的场景真实存在；`SCENE_LOCATIONS`
  覆盖；线索/结局字段完整且 `id` 唯一；角色定义完整；`effects.characters` 引用的角色存在；
  条件引用的 flag 是否被赋值。
- **输入**：游戏 HTML。**输出**：错误（致命）/ 警告（如缺失地点、未赋值 flag）列表。
- **退出码**：有致命错误→1；仅警告→0。

### 3. verify-storyflow.cjs — 剧情流程
- **检查**：从开场场景出发的可达性；悬空场景引用（致命）；自循环死锁（致命）；
  软锁死胡同（无选项且非结局入口，致命）；孤儿场景（警告）。
- **输入**：游戏 HTML。**输出**：可达场景数、各类流程缺陷。
- **退出码**：存在悬空/自循环/死胡同→1。

### 4. verify-endings.cjs — 结局分支
- **检查**：8 个结局结构完整、`id` 唯一；`ENDING_SCENE_MAP` 与即时触发 flag 一致；
  每个结局的触发条件在某条可达路径上可被满足（即时触发类精确判定，阈值/条件类用
  各维度最佳值传播做充分性判定）。
- **输入**：游戏 HTML。**输出**：各结局可达性判定与依据。
- **退出码**：有不可达/结构错误→1。

### 5. verify-characters.cjs — 角色交互
- **检查**：4 位男主定义完整；`choices/条件` 引用的角色与属性（`affection/trust/fear`）
  真实存在；每位角色至少有可提升好感的选项；各男主线结局所需好感/信任阈值可达。
- **输入**：游戏 HTML。**输出**：各角色可达数值上限、男主线可达性。
- **退出码**：存在角色相关错误→1。

### 6. verify-events.cjs — 事件触发条件
- **检查**：所有线索/结局条件串能被修复后的 `evalCondition`（`with(gameData)`）正确解析、
  不抛 `ReferenceError`；用 `with + Proxy` 提取条件里解析到的顶层标识符，校验无未知变量；
  条件引用的 flag 是否被赋值（警告级）。
- **输入**：游戏 HTML。**输出**：全部条件清单 + 解析结果。
- **退出码**：存在非法条件→1。

### 7. verify-saveload.cjs — 存档 / 读档
- **检查**：在 `vm` 沙箱加载游戏**真实** `saveGame/loadGame/ensureCompatibility/saveGallery/
  loadGallery`，mock DOM 与 localStorage，验证：
  1. 存档正确序列化 `gameData` 与图鉴；
  2. 读档完整还原 flags/好感/信任/线索/结局/场景/进度/日志/历史；
  3. `loadGallery` 跨周目对线索与结局取并集；
  4. `ensureCompatibility` 对损坏老存档兜底且不抛错；
  5. 空存档读档不崩溃。
- **输入**：游戏 HTML。**输出**：逐项断言结果。
- **退出码**：存在异常→1。

## 一键运行全部

```bash
for f in verify-clues verify-data-integrity verify-storyflow verify-endings \
         verify-characters verify-events verify-saveload; do
  node tools/otome-kidnap-villa/$f.cjs || exit 1
done
```

## 设计原则

- **独立可运行**：每个工具自带入口，不依赖外部服务；共享解析逻辑统一放在 `lib/extract-data.cjs`。
- **不污染游戏**：纯只读抽取与静态分析（除 `verify-saveload` 在沙箱内加载真实函数，但不写任何文件）。
- **门禁友好**：以退出码表达"通过/失败"，便于挂到 pre-commit 或 CI。
- **范围说明**：仅覆盖本地预设剧情（LOCAL 模式）。AI 模式（DeepSeek 动态生成）无法静态穷举，
  但复用同一套解锁/存档逻辑，故静态工具的覆盖仍具代表性。
