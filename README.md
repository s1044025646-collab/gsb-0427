# DTMF Goertzel 双音拨号键识别后端

离线、本地运行的 DTMF（双音多频）按键识别服务。输入 8000 Hz 采样的单声道浮点数组（一个完整窗口），用自行实现的 Goertzel 递推在 8 个标准频点上计算能量，按固定教学口径判断对应电话键（0–9、`*`、`#`、`A`–`D`），或明确返回不能判定及原因。只做 API 与 CLI，无网页、无后台作业、不录音、不连接电话、不分割连续拨号流。

## 环境要求

- Windows 本地，Node.js >= 22.5（使用内置 `node:sqlite`，无需原生编译、Docker、WSL 或任何外部服务）
- 依赖仅 `typescript` 与 `@types/node`（开发依赖）

## 快速开始

```powershell
npm install
npm run build     # 编译 TypeScript 到 dist/
npm test          # 构建并运行全部测试
npm start         # 启动 API（默认 127.0.0.1 + 空闲端口，PORT 环境变量可指定）
npm run demo      # 演示：按键 5、单频、静音、幅度失衡
npm run cli -- analyze --key 5 --save   # CLI 示例
```

数据目录为项目内 `data/`（SQLite 文件 `data/dtmf.sqlite`，可用环境变量 `DTMF_DB` 覆盖）。

## 算法说明

- 采样率固定 8000 Hz；行频 697/770/852/941 Hz，列频 1209/1336/1477/1633 Hz，标准 4×4 映射。
- 对每个频点 f，系数 `coeff = 2·cos(2πf/fs)`，**不把频率四舍五入到 DFT 整数频格**。
- 样本先去均值，再递推 `s = x + coeff·q1 − q2`（初始 q1=q2=0），功率 `P = q1² + q2² − coeff·q1·q2`。
- 矩形窗口；归一化功率 `= P · 2 / N²`。报告中同时给出原始值与归一化值。
- 极小浮点负功率按公开容差（`NEGATIVE_POWER_TOLERANCE = 1e-9`，相对量级）归零处理。
- 不调用任何现成 DTMF/频谱库；测试中用独立的直接正弦/余弦求和核对 8 个频点功率。

## 判定规则（固定教学口径，非通信标准认证）

全部满足才返回按键：

1. 去均值 RMS ≥ 0.01（否则判为静音 `SILENT`）；
2. 行组、列组各自最大归一化能量 ≥ 次大值的 4 倍（赢家并列明确报 `WINNER_TIE`）；
3. 行/列赢家能量比在 [0.25, 4]（含端点）；
4. 两个赢家归一化功率之和 ≥ 去均值均方值的 0.6。

零分母（如次大能量为 0、均方值为 0）显式处理为不通过，**不通过加任意小常数让缺失频率通过**。拒绝原因码：`SILENT`、`ROW_NOT_DOMINANT`、`COL_NOT_DOMINANT`、`ROW_COL_IMBALANCE`、`INSUFFICIENT_DUAL_TONE_ENERGY`、`WINNER_TIE`。结果状态区分 `ok`（有效按键）、`silent`（静音）、`insufficient_evidence`（证据不足）。

## 输入校验与错误码

- 样本必须是数组，长度 400–8000，每个元素为有限数且在 [-1, 1]。
- 错误码：`E_NOT_ARRAY`、`E_LENGTH`、`E_NON_FINITE`、`E_RANGE`、`E_PARAM`、`E_KEY`、`E_JSON`、`E_NOT_FOUND`、`E_INTERNAL`。
- 非法窗口在分析前被拒绝，不会写入半份报告（先校验、后落库）。

## 合成夹具

本地合成，不下载音频文件。默认 640 样本、两个正弦各 0.3 幅度。可调：键名、长度、行列各自幅度、相位、直流偏置、任意频率组合。

## API（默认只监听 127.0.0.1，端口默认 0 即自动选空闲端口）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| POST | `/api/synth` | 生成合成窗口；`analyze:true` 同时分析，`save:true` 落库 |
| POST | `/api/analyze` | 分析 `{samples:[...]}`；`save:true` 保存样本+报告 |
| POST | `/api/samples` | 仅保存样本 |
| GET | `/api/samples` / `/api/samples/:id` | 列出 / 查看样本 |
| POST | `/api/samples/:id/analyze` | 重算并生成新报告 |
| GET | `/api/samples/:id/compare` | 比较该样本各报告（算法版本间一致性） |
| GET | `/api/reports` / `/api/reports/:id` | 列出 / 查看报告（含完整判断摘要） |
| GET | `/api/reports/:id/export` | 导出报告 JSON 文件 |
| GET | `/api/trace?sampleId=&freq=&limit=` | 查看某频点有限条递推状态（完整分析始终用全部样本，展示上限不截断计算） |

## CLI

```
node dist/src/cli.js synth --key 5 [--length 640] [--analyze] [--save]
node dist/src/cli.js analyze (--key 5 | --file f.json | --samples "[...]") [--save]
node dist/src/cli.js save (--key 5 | --file f.json | ...)
node dist/src/cli.js samples | show-sample <id>
node dist/src/cli.js reports [--sample <id>] | show-report <id>
node dist/src/cli.js reanalyze <sampleId>     # 重算生成新报告
node dist/src/cli.js compare <sampleId>       # 比较版本间结果
node dist/src/cli.js trace <sampleId> --freq 770 [--limit 20]
node dist/src/cli.js export <reportId> [--out report.json]
node dist/src/cli.js demo
```

SQLite 保存原数组、算法版本、参数与完整判断摘要；重算生成新报告而非覆盖，重启后可查询旧结果。

## 已知限制

- 只识别单个完整窗口，不分割连续拨号流，不估计任意乐音基频。
- 矩形窗口 + 有限长度存在频谱泄漏：窗口过短或非整数周期截断时，邻近频点能量升高，可能触发拒绝或（在强噪声/干扰音下）误判；本规则不保证任意噪声均被拒绝。
- 阈值为固定教学口径，未做自动训练，也不构成任何通信标准（如 ITU Q.24）一致性认证。
- 同步处理小窗口，无后台调度；`node:sqlite` 在 Node 25 仍标记为实验特性（会打印一条 ExperimentalWarning，不影响功能）。
