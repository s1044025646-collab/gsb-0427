# DTMF Goertzel 按键识别后端（TypeScript + Node.js + SQLite）

离线双音多频（DTMF）按键识别服务：输入一段 8 kHz 采样的单声道浮点数组（一个完整窗口），
用自行实现的 Goertzel 递推在 8 个标准频点上计算能量，按固定教学规则判定它对应哪个电话键，
或明确返回不能判定及原因。只做 API 与 CLI，无网页、无后台作业、不依赖 Docker/WSL/在线服务。

## 运行环境

- Windows 本地，Node.js ≥ 22（使用内置 `node:sqlite` 与 `node:http`，无原生编译依赖）
- 安装依赖：`npm install`

## 常用命令

```bash
npm run build     # 编译 TypeScript 到 dist/
npm test          # 构建并运行全部测试
npm start         # 启动 API 服务（默认选择空闲端口；PORT=8080 npm start 指定端口）
npm run demo      # 演示按键 5 及单频/静音/幅度失衡三种拒绝场景
node dist/src/cli.js <command>   # CLI（见下）
```

## 算法说明

- 采样率固定 8000 Hz；行频率 697/770/852/941 Hz，列频率 1209/1336/1477/1633 Hz，
  按标准 4×4 表映射 0–9、`*`、`#`、`A`–`D`。
- 对每个实际频率 f 计算系数 `coeff = 2·cos(2πf/fs)`（**不**四舍五入到 DFT 整数频格），
  状态 `q1=q2=0` 起步，递推 `q0 = coeff·q1 − q2 + x[n]`，
  功率 `P = q1² + q2² − coeff·q1·q2`；极小浮点负值（|P| < 1e-12）按 0 处理。
- 使用矩形窗；归一化功率 = 原始功率 × 2/N²。报告同时给出每个频点的原始值与归一化值。
- 分析前对样本去均值（消除直流偏置）。

## 判定规则（固定教学口径，非通信标准认证）

全部满足才返回按键，否则返回拒绝原因：

1. 去均值 RMS ≥ 0.01（否则 `SILENCE`）；
2. 行组、列组各自最大能量 ≥ 次大值的 4 倍（否则 `ROW_NO_DOMINANT` / `COL_NO_DOMINANT`；
   前两名在 1e-9 相对容差内相等报 `ROW_TIE` / `COL_TIE`）；
3. 行/列赢家能量比在 [0.25, 4] 含端点（否则 `ENERGY_RATIO_OUT_OF_RANGE`）；
4. 两个赢家归一化功率之和 ≥ 去均值均方值的 0.6（否则 `INSUFFICIENT_DUAL_TONE`）。

零分母（次大能量为 0）时只要赢家能量为正即视为通过优势比检查，不通过加任意小常数让缺失频率通过。
结果区分三类：`KEY`（有效按键）、`SILENCE`（静音）、`INSUFFICIENT_EVIDENCE`（证据不足）。

## 输入校验与错误码

- 样本必须是有限数字、取值在 [-1, 1]、长度 400–8000；非法输入先拒绝，不写入半份报告。
- 错误码：`ERR_BAD_PARAMS`、`ERR_LENGTH`、`ERR_NONFINITE`、`ERR_RANGE`、`ERR_BAD_JSON`、`ERR_NOT_FOUND`、`ERR_INTERNAL`。

## 已知限制

- 只识别一个完整窗口：不录音、不连电话、不分割连续拨号流、不估计任意乐音基频。
- 矩形窗 + 有限长度存在频谱泄漏，窗口越短泄漏越明显；阈值固定，不做自动训练。
- 不能保证任意噪声均被拒绝：与某对频点能量结构相近的噪声可能被误判为按键。
- 本规则为教学口径，未做通信标准（如 ITU Q.24）符合性认证。

## API（默认端口 0 即自动选空闲端口，启动时打印实际端口）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/frequencies` | 8 个频点与阈值 |
| POST | `/api/samples` | 保存采样 `{samples}` → `{sampleId}` |
| POST | `/api/analyze` | 识别 `{samples}` 或 `{sampleId}`，`persist:false` 可只算不存 |
| POST | `/api/synthesize` | 合成窗口：`{kind:"key",key:"5"}` / `{kind:"dual",rowFreq,colFreq}` / `{kind:"single",freq}` / `{kind:"silence"}` |
| GET | `/api/reports` / `/api/reports/:id` | 查询历史报告 |
| POST | `/api/reports/:id/recompute` | 用原样本重算，生成新报告 |
| GET | `/api/reports/:id/export` | 导出报告 JSON |
| GET | `/api/compare?ids=1,2` | 比较两份报告（算法版本、按键、各频点能量差） |
| GET | `/api/recurrence?sampleId=&freq=&limit=` | 查看某频点有限条递推状态（≤1000 条；完整分析始终使用全部样本，展示上限不截断实际计算） |

## CLI

```bash
node dist/src/cli.js serve [port]                 # 启动 API
node dist/src/cli.js synth 5 [length]             # 打印合成窗口
node dist/src/cli.js analyze 5 [len] [pRow] [pCol] [dc]   # 合成+识别+入库
node dist/src/cli.js analyze --file samples.json  # 从文件识别
node dist/src/cli.js demo                         # 按键 5 + 三种拒绝演示
node dist/src/cli.js report <id> / list / recompute <id> / compare <a> <b>
node dist/src/cli.js recurrence <sampleId> 770 [limit]
node dist/src/cli.js export <reportId> [out.json]
```

## 数据与持久化

- SQLite 数据库位于项目内 `data/dtmf.sqlite`（自动创建）。
- `samples` 表保存原始数组；`reports` 表保存算法版本（`goertzel-dtmf/1.0.0`）、参数与完整判断摘要。
- 重算生成新报告而不覆盖旧报告；重启进程后可用 `list`/`report` 查询旧结果。

## 合成夹具

本地合成，不下载音频文件：默认 640 个样本、两个正弦各 0.3 幅度，可配置长度、相位、直流偏置。

## 测试

`npm test` 覆盖：16 个标准键、直流偏置、不同相位、较短窗口（400）、重复分析一致性、
非有限输入与范围/长度错误、单频/静音/幅度失衡拒绝；并用独立的直接正弦/余弦求和
（`X = Σ x[n]·e^(−i2πfn/fs)`）核对 8 个频点功率，验证 Goertzel 结果在 1e-9 相对容差内一致。
