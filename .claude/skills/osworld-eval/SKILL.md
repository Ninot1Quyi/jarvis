---
name: osworld-eval
description: 使用 OSWorld 框架评估 Jarvis 在 Linux 虚拟机上的任务执行效果，包括自动快照管理、任务执行和结果评估。
---

# OSWorld Evaluation Skill

通过 OSWorld 框架自动化评测 Jarvis 在 Linux 虚拟机上的任务执行效果。

## 环境信息

- VM: VMware Fusion (Ubuntu 22.04 LTS)
- VM 路径: `/Users/Ninot/NinotQuyi/OSWorld/vmware_vm_data/Ubuntu0/Ubuntu.vmx`
- VM IP: 192.168.236.129
- SSH 用户: user
- SSH 密码: jarvis.linux.123
- 宿主机代理: 192.168.236.1:7897
- Jarvis 路径 (VM): /home/user/jarvis

## 评估脚本

评估脚本位于: `/Users/Ninot/NinotQuyi/jarvis/scripts/run_jarvis_eval.py`

### 快速启动

```bash
source /Users/Ninot/NinotQuyi/OSWorld/.venv/bin/activate
python /Users/Ninot/NinotQuyi/jarvis/scripts/run_jarvis_eval.py \
  --vm-ip 192.168.236.129 \
  --vm-path /Users/Ninot/NinotQuyi/OSWorld/vmware_vm_data/Ubuntu0/Ubuntu.vmx \
  --jarvis-dir /home/user/jarvis \
  --task-file /Users/Ninot/NinotQuyi/OSWorld/evaluation_examples/test_small.json \
  --output-dir ./results \
  --max-tasks 1 \
  --max-time 180
```

### 参数说明

- `--vm-ip`: Linux VM IP 地址
- `--vm-path`: VMware VMX 文件路径
- `--jarvis-dir`: VM 上 Jarvis 的目录
- `--task-file`: 任务 JSON 文件 (支持 OSWorld 格式: `{domain: [id1, id2, ...]}`)
- `--output-dir`: 结果输出目录
- `--max-tasks`: 最大任务数
- `--max-time`: 单任务最大时间 (秒)

### 任务文件格式

创建自定义任务文件:

```json
{
  "chrome": [
    "bb5e4c0d-f964-439c-97b6-bdb9747de3f4"
  ],
  "chrome": [
    "任务ID"
  ]
}
```

任务 ID 对应 `/Users/Ninot/NinotQuyi/OSWorld/evaluation_examples/examples/{app}/{id}.json`

## 快照管理

脚本会自动管理 VM 快照:
- 首次运行自动创建 `init_state` 快照
- 每次任务前自动恢复到快照状态
- 确保评估环境的一致性

如需手动管理快照:

```bash
# 创建快照
vmrun -T fusion snapshot /Users/Ninot/NinotQuyi/OSWorld/vmware_vm_data/Ubuntu0/Ubuntu.vmx init_state

# 列出快照
vmrun -T fusion listSnapshots /Users/Ninot/NinotQuyi/OSWorld/vmware_vm_data/Ubuntu0/Ubuntu.vmx

# 恢复快照
vmrun -T fusion revertToSnapshot /Users/Ninot/NinotQuyi/OSWorld/vmware_vm_data/Ubuntu0/Ubuntu.vmx init_state
```

## 调试模式

如需实时观察 Jarvis 执行过程，可以临时修改脚本使用 tmux 模式，或手动运行:

```bash
# 创建任务脚本
cat > /tmp/run_task.sh << 'EOF'
#!/bin/bash
export http_proxy=http://192.168.236.1:7897
export https_proxy=http://192.168.236.1:7897
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22
cd ~/jarvis
export DISPLAY=:0
node dist/cli/main.js --eval --no-ui "你的任务"
EOF

# 上传到 VM
sshpass -p 'jarvis.linux.123' scp -o StrictHostKeyChecking=no /tmp/run_task.sh user@192.168.236.129:/tmp/run_task.sh

# 创建 tmux 会话
tmux new-session -d -s jarvis "sshpass -p 'jarvis.linux.123' ssh -o StrictHostKeyChecking=no user@192.168.236.129"

# 执行任务
tmux send-keys -t jarvis "bash /tmp/run_task.sh" Enter

# 观察输出
tmux attach -t jarvis
```

## 代码同步

修改代码后需要同步到 VM:

```bash
# 同步源代码
sshpass -p 'jarvis.linux.123' rsync -avz \
  --exclude node_modules --exclude .git --exclude dist \
  -e "ssh -o StrictHostKeyChecking=no" \
  /Users/Ninot/NinotQuyi/jarvis/ \
  user@192.168.236.129:~/jarvis/

# 在 VM 中编译
sshpass -p 'jarvis.linux.123' ssh -o StrictHostKeyChecking=no user@192.168.236.129 \
  "export http_proxy=http://192.168.236.1:7897 && https_proxy=http://192.168.236.1:7897 && export NVM_DIR=\"\$HOME/.nvm\" && [ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\" && nvm use 22 && cd /home/user/jarvis && npm run build"
```

## 评估结果

结果保存在 `--output-dir` 指定的目录中:

- `summary.json`: 汇总统计
- `{task_id}/result.json`: 单任务结果
- `{task_id}/jarvis_output.txt`: Jarvis 完整输出
- `{task_id}/task_config.json`: 任务配置
