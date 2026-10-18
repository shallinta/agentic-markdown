# 无引擎迁移验证收据说明

主线实际exec session33685运行materialize、inputs、preflight，exit0，输出
`{"preflight":"complete","engineExecuted":false}`。
这是会话执行证据的文字记录，不是伪造命令stdout文件；原命令完整终端日志未额外写成本目录文件。

工作目录：`/private/tmp/agentic-f064a-replay-check.rxgBGU/work`。
旁边四文件逐字节复制自该目录：145行migration.patch、migration-sources.json、
migration-environment.json、inputs.complete.json。6个实际变化源仅路径及离线cache接入：
crud/run.mjs、literal/run.mjs、real/run.py、real/sqlite.mjs、scale/processes.py、scale/run.py。

两独立轴核2584历史成员SHA、78派生文件、36真实原文及11328合成raw/pins，
无target或新引擎run。仅入口和输入重建已验证；迁移版引擎完整复跑未执行。
历史source/receipt绝对路径保留，不能把迁移路径差异冒原源码SHA相同。
