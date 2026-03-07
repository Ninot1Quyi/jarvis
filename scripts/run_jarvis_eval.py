#!/usr/bin/env python3
"""
OSWorld 评估 Jarvis 的主脚本

Usage:
    python scripts/run_jarvis_eval.py \
        --task-file evaluation_examples/test_small.json \
        --vm-ip 192.168.236.129 \
        --jarvis-dir ~/jarvis \
        --output-dir ./results
"""

import argparse
import json
import os
import subprocess
import sys
import time
import signal
import logging
from pathlib import Path
from typing import Optional, List, Dict, Any


class TeeLogger:
    """同时输出到 stdout 和文件"""
    def __init__(self, log_file: Path):
        self.terminal = sys.stdout
        self.log = open(log_file, 'a', encoding='utf-8')

    def write(self, message: str):
        self.terminal.write(message)
        self.terminal.flush()
        self.log.write(message)
        self.log.flush()

    def flush(self):
        self.terminal.flush()
        self.log.flush()

    def close(self):
        self.log.close()

# Add OSWorld to path
osworld_dir = Path(__file__).parent.parent / "OSWorld"
if not osworld_dir.exists():
    # Try alternative location
    osworld_dir = Path("/Users/Ninot/NinotQuyi/OSWorld")
sys.path.insert(0, str(osworld_dir))

from desktop_env.desktop_env import DesktopEnv


class JarvisEvalRunner:
    def __init__(
        self,
        vm_ip: str,
        vm_path: str,
        jarvis_dir: str,
        output_dir: str,
        max_time: int = 300,
        provider_name: str = "vmware",
        action_space: str = "pyautogui",
        observation_type: str = "screenshot",
    ):
        self.vm_ip = vm_ip
        self.vm_path = vm_path
        self.jarvis_dir = jarvis_dir
        self.output_dir = Path(output_dir)
        self.max_time = max_time
        self.provider_name = provider_name
        self.action_space = action_space
        self.observation_type = observation_type
        self.osworld_dir = osworld_dir

        self.output_dir.mkdir(parents=True, exist_ok=True)
        self._iterm_pane_opened = False  # 只开一次分屏

    def _attach_tmux_to_iterm(self, tmux_session: str):
        """使用 iTerm2 Python API 在右侧分屏连接 tmux（只开一次，后续复用）"""
        import asyncio

        if self._iterm_pane_opened:
            print(f"[iTerm2] Reusing existing pane for tmux session '{tmux_session}'")
            return

        async def _open_pane():
            import iterm2
            connection = await iterm2.Connection.async_create()
            app = await iterm2.async_get_app(connection)
            window = app.current_terminal_window
            if window is None:
                return
            tab = window.current_tab
            session = tab.current_session
            new_session = await session.async_split_pane(vertical=True)
            await new_session.async_send_text(
                f"while true; do tmux attach -t {tmux_session} 2>/dev/null || sleep 1; done\n"
            )

        try:
            asyncio.run(_open_pane())
            print(f"[iTerm2] Opened new pane and attached tmux session '{tmux_session}'")
            self._iterm_pane_opened = True
        except Exception as e:
            print(f"[iTerm2] Attach failed: {e}")

    def _manage_snapshot(self, vm_path: str, snapshot_name: str):
        """管理 VM 快照：检查是否存在，不存在则创建，每次任务前恢复"""
        import subprocess

        # 检查快照是否存在
        result = subprocess.run(
            ['vmrun', '-T', 'fusion', 'listSnapshots', vm_path],
            capture_output=True, text=True
        )

        if snapshot_name not in result.stdout:
            print(f"[Snapshot] Creating snapshot '{snapshot_name}'...")
            subprocess.run(
                ['vmrun', '-T', 'fusion', 'snapshot', vm_path, snapshot_name],
                check=True
            )
            print(f"[Snapshot] Snapshot '{snapshot_name}' created")
        else:
            print(f"[Snapshot] Reverting to snapshot '{snapshot_name}'...")
            subprocess.run(
                ['vmrun', '-T', 'fusion', 'revertToSnapshot', vm_path, snapshot_name],
                check=True
            )
            print(f"[Snapshot] Reverted to snapshot '{snapshot_name}'")

    def _prepare_vm_environment(self):
        """在 reset 后恢复 Jarvis 运行环境，避免快照回滚导致依赖/配置丢失"""
        print("[VM] Preparing Jarvis environment after snapshot reset...")

        # rsync: 只同步必要文件，不覆盖 dist 和 node_modules（保持快照中的正确版本）
        rsync_cmd = [
            'sshpass', '-p', 'jarvis.linux.123',
            'rsync', '-avz',
            '--exclude', 'node_modules',
            '--exclude', '.git',
            '--exclude', 'dist',
            '--exclude', 'target',
            '--exclude', 'cache',
            '--exclude', 'results',
            '--exclude', 'results_rust',
            '--exclude', 'data',
            '--exclude', 'jarvis-memory',
            '--exclude', 'config',
            '--exclude', 'src',
            '--exclude', 'scripts',
            '--exclude', 'prompts',
            '--exclude', 'test',
            '--exclude', 'native',
            '--exclude', 'overlay-ui',
            '--exclude', 'package.json',
            '--exclude', 'package-lock.json',
            '--exclude', 'tsconfig.json',
            '--exclude', '.claude',
            '--exclude', 'logs',
            '--exclude', '*.md',
            '-e', 'ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -o PreferredAuthentications=password',
            '/Users/Ninot/NinotQuyi/jarvis/',
            f'user@{self.vm_ip}:{self.jarvis_dir}/'
        ]
        subprocess.run(rsync_cmd, check=True)

        # 创建必要目录（不需要编译，快照中已有 dist）
        remote_setup = f'''
export http_proxy=http://192.168.236.1:7897
export https_proxy=http://192.168.236.1:7897
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22
cd {self.jarvis_dir}
mkdir -p /home/user/jarvis-memory
mkdir -p {{self.jarvis_dir}}/workspace/screenshots
mkdir -p {{self.jarvis_dir}}/workspace/traces
'''

        subprocess.run([
            'sshpass', '-p', 'jarvis.linux.123',
            'ssh', '-o', 'StrictHostKeyChecking=no', '-o', 'IdentitiesOnly=yes',
            '-o', 'PreferredAuthentications=password',
            f'user@{self.vm_ip}', remote_setup
        ], check=True)

    def _wait_for_vm_ready(self, vm_ip: str, timeout: int = 120):
        """等待 VM 就绪（SSH 可连接）"""
        import socket
        import time

        print(f"[VM] Waiting for VM to be ready at {vm_ip}...", flush=True)
        start_time = time.time()
        check_count = 0

        while time.time() - start_time < timeout:
            check_count += 1
            # 检查 SSH 端口是否开放
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(2)
            result = sock.connect_ex((vm_ip, 22))
            sock.close()

            if result == 0:
                # 端口开放了，再尝试 SSH 连接
                result = subprocess.run(
                    ['sshpass', '-p', 'jarvis.linux.123', 'ssh', '-o', 'StrictHostKeyChecking=no',
                     '-o', 'ConnectTimeout=5', f'user@{vm_ip}', 'echo ready'],
                    capture_output=True, text=True
                )
                if result.returncode == 0:
                    print(f"[VM] VM is ready! (took {int(time.time() - start_time)}s)", flush=True)
                    return True
                else:
                    print(f"[VM] SSH port open, waiting for auth...", flush=True)

            elapsed = int(time.time() - start_time)
            if check_count % 5 == 0:
                print(f"[VM] Still waiting... ({elapsed}s elapsed)", flush=True)

            time.sleep(3)

        print(f"[VM] Timeout waiting for VM to be ready", flush=True)
        return False

    def load_tasks(self, task_file: str) -> List[Dict[str, Any]]:
        """Load tasks from JSON file (OSWorld format: {domain: [id1, id2, ...]})"""
        with open(task_file, 'r') as f:
            data = json.load(f)

        tasks = []

        # Check if it's OSWorld format (dict with domain -> list of IDs)
        if isinstance(data, dict) and not 'tasks' in data:
            examples_dir = self.osworld_dir / "evaluation_examples" / "examples"
            for domain, example_ids in data.items():
                for example_id in example_ids:
                    task_path = examples_dir / domain / f"{example_id}.json"
                    if task_path.exists():
                        with open(task_path, 'r') as f:
                            task_config = json.load(f)
                            tasks.append(task_config)
                    else:
                        print(f"Warning: Task not found: {task_path}")
        elif isinstance(data, list):
            return data
        elif isinstance(data, dict) and 'tasks' in data:
            return data['tasks']
        else:
            raise ValueError(f"Unknown task file format: {task_file}")

        return tasks

    def run_task(self, task_config: Dict[str, Any], task_index: int) -> Dict[str, Any]:
        """运行单个任务"""
        task_id = task_config.get('id', f'task_{task_index}')
        instruction = task_config.get('instruction', '')

        result_data: Dict[str, Any] = {
            'task_id': task_id,
            'instruction': instruction,
            'result': 0.0,
            'done': False,
            'elapsed_time': 0,
            'error': None,
        }
        start_time = time.time()
        env = None
        tmux_session = 'jarvis_eval'
        output_lines: List[str] = []

        try:
            print(f"\n{'='*60}")
            print(f"Task {task_index + 1}: {task_id}")
            print(f"Instruction: {instruction[:100]}...")
            print(f"{'='*60}")
            print("[OSWorld] Initializing DesktopEnv...", flush=True)
            print(f"[OSWorld]   provider: {self.provider_name}", flush=True)
            print(f"[OSWorld]   vm_ip: {self.vm_ip}", flush=True)
            print(f"[OSWorld]   action_space: {self.action_space}", flush=True)
            print(f"[OSWorld]   screen_size: (1920, 1080)", flush=True)
            print(f"[OSWorld]   os_type: Ubuntu", flush=True)
            print(f"[OSWorld]   headless: False", flush=True)

            # 创建任务结果目录
            task_result_dir = self.output_dir / task_id
            task_result_dir.mkdir(parents=True, exist_ok=True)

            # 保存任务配置
            with open(task_result_dir / 'task_config.json', 'w') as f:
                json.dump(task_config, f, indent=2)

            # 等待 VM 就绪（确保 OSWorld 可以连接）
            self._wait_for_vm_ready(self.vm_ip)

            # 初始化 OSWorld 环境（快照管理由 OSWorld reset() 自动处理）
            print("[OSWorld] Creating DesktopEnv instance...", flush=True)
            print(f"[OSWorld]   vm_path: {self.vm_path}", flush=True)
            env = DesktopEnv(
                provider_name=self.provider_name,
                path_to_vm=self.vm_path,
                action_space=self.action_space,
                screen_size=(1920, 1080),
                headless=False,  # 需要显示桌面
                os_type="Ubuntu",
                snapshot_name="jarvis_eval_20260307_v4",
                require_a11y_tree=(self.observation_type != "screenshot"),
            )
            print("[OSWorld] DesktopEnv instance created, calling reset()...", flush=True)

            # 重置环境到任务初始状态
            print(f"[OSWorld] Resetting environment...")
            try:
                env.reset(task_config=task_config)
            except Exception as e:
                print(f"[OSWorld] Failed to reset: {e}")
                result_data['error'] = f'Reset failed: {e}'
                return result_data

            # OSWorld reset 后 VM IP 可能改变，需要重新获取
            print("[VM] Getting new IP after reset...")
            time.sleep(5)
            try:
                result = subprocess.run(
                    ['vmrun', '-T', 'fusion', 'getGuestIPAddress', self.vm_path, '-wait'],
                    capture_output=True, text=True, timeout=30
                )
                if result.returncode == 0 and result.stdout.strip():
                    self.vm_ip = result.stdout.strip()
                    print(f"[VM] New IP: {self.vm_ip}")
            except Exception as e:
                print(f"[VM] Failed to get new IP: {e}")

            # 快照重制后、任务开始前：将宿主机 data 同步到 VM
            print(f"[Data] Syncing host -> VM (post-reset)...")
            try:
                subprocess.run([
                    'sshpass', '-p', 'jarvis.linux.123',
                    'rsync', '-avz', '--exclude=*.db-shm', '--exclude=*.db-wal',
                    '-e', 'ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -o PreferredAuthentications=password',
                    '/Users/Ninot/NinotQuyi/jarvis/data/',
                    f'user@{self.vm_ip}:/home/user/jarvis/data/'
                ], check=False, capture_output=True)
                print(f"[Data] Synced host -> VM")
            except Exception as e:
                print(f"[Data] Sync host -> VM failed: {e}")

            # 在 reset 后恢复快照丢失的 Jarvis 运行环境
            try:
                self._prepare_vm_environment()
            except Exception as e:
                print(f"[VM] Failed to prepare Jarvis environment: {e}")
                result_data['error'] = f'Prepare VM environment failed: {e}'
                return result_data

            # 启动 Jarvis
            print(f"[Jarvis] Starting task...")

            # 创建任务脚本
            task_script = f'''#!/bin/bash
PASSWORD="jarvis.linux.123"

# 确保 memory 目录存在
mkdir -p /home/user/jarvis-memory

export http_proxy=http://192.168.236.1:7897
export https_proxy=http://192.168.236.1:7897
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22
cd {self.jarvis_dir}
export DISPLAY=:0
node dist/cli/main.js --eval --no-ui "{instruction}"
'''

            # 上传任务脚本到 VM
            task_script_path = '/tmp/jarvis_task.sh'
            with open(task_script_path, 'w') as f:
                f.write(task_script)

            subprocess.run([
                'sshpass', '-p', 'jarvis.linux.123',
                'scp', '-o', 'StrictHostKeyChecking=no', '-o', 'IdentitiesOnly=yes',
                '-o', 'PreferredAuthentications=password',
                task_script_path,
                f'user@{self.vm_ip}:/tmp/jarvis_task.sh'
            ], check=True)

            # 创建 tmux 会话（使用固定名称，便于监控）
            subprocess.run(['tmux', 'kill-session', '-t', tmux_session], stderr=subprocess.DEVNULL)
            subprocess.run([
                'tmux', 'new-session', '-d', '-s', tmux_session,
                f"sshpass -p 'jarvis.linux.123' ssh -o StrictHostKeyChecking=no user@{self.vm_ip}"
            ])

            # 自动在 iTerm2 右侧分屏连接 tmux (忽略错误)
            try:
                self._attach_tmux_to_iterm(tmux_session)
            except Exception as e:
                print(f"[iTerm2] Attach skipped: {e}")

            # 执行任务
            subprocess.run(['tmux', 'send-keys', '-t', tmux_session, 'bash /tmp/jarvis_task.sh', 'Enter'])

            print(f"[Jarvis] Running in tmux session: {tmux_session}")

            # 监控输出
            done = False
            trace_path = None  # VM 上的 trace 路径

            # 等待一小段时间让任务启动
            time.sleep(5)

            try:
                while True:
                    # 读取 tmux 输出
                    result = subprocess.run(
                        ['tmux', 'capture-pane', '-t', tmux_session, '-p'],
                        capture_output=True, text=True
                    )
                    output = result.stdout
                    output_lines.append(output)
                    print(output)  # 打印输出

                    # 解析 trace 路径
                    if not trace_path:
                        for line in output.split('\n'):
                            if line.startswith('[TRACE]'):
                                trace_path = line.replace('[TRACE]', '').strip()
                                print(f"\n[TRACE] Trace file: {trace_path}")
                                print(f"[TRACE] Local trace will be synced to: /Users/Ninot/NinotQuyi/jarvis/data/traces/")
                                break

                    # 检测完成标志
                    if '[JARVIS_EVAL]' in output and 'Task completed' in output:
                        done = True
                        print(f"\n[Jarvis] Task completed, exiting...")
                        break

                    # 检测其他完成标志
                    if 'Agent finished after' in output:
                        done = True
                        print(f"\n[Jarvis] Agent finished, exiting...")
                        break

                    # 超时检查
                    if time.time() - start_time > self.max_time:
                        print(f"\n[Timeout] Task exceeded {self.max_time}s, killing...")
                        break

                    time.sleep(10)  # 每10秒检查一次

            except KeyboardInterrupt:
                print("\n[Interrupted] Killing Jarvis...")

            # 保存 trace 路径到结果
            if trace_path:
                result_data['trace_path_vm'] = trace_path
                # 转换 VM 路径到本地路径
                local_trace = trace_path.replace('/home/user/jarvis/', '/Users/Ninot/NinotQuyi/jarvis/')
                result_data['trace_path_local'] = local_trace
                print(f"\n[TRACE] Task trace: {local_trace}")

            # 任务完成后、快照重制前：将 VM data 同步回宿主机（保留完整 trace）
            print(f"\n[Data] Syncing VM -> host (post-task)...")
            try:
                subprocess.run([
                    'sshpass', '-p', 'jarvis.linux.123',
                    'rsync', '-avz', '--exclude=*.db-shm', '--exclude=*.db-wal',
                    '-e', 'ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -o PreferredAuthentications=password',
                    f'user@{self.vm_ip}:/home/user/jarvis/data/',
                    '/Users/Ninot/NinotQuyi/jarvis/data/'
                ], check=True, capture_output=True)
                print(f"[Data] Synced VM -> host")
            except Exception as e:
                print(f"[Data] Sync VM -> host failed: {e}")

            # 保存 Jarvis 输出
            with open(task_result_dir / 'jarvis_output.txt', 'w') as f:
                f.writelines(output_lines)

            # OSWorld 评估
            print(f"\n[OSWorld] Evaluating...")
            result = 0.0
            try:
                if env:
                    result = env.evaluate()
                    print(f"[OSWorld] Result: {result}")
            except Exception as e:
                print(f"[OSWorld] Evaluation failed: {e}")
                result_data['error'] = f'Evaluation failed: {e}'

            # 保存结果
            result_data.update({
                'result': result,
                'done': done,
            })

        except Exception as e:
            print(f"\n[ERROR] Task failed with exception: {e}")
            import traceback
            traceback.print_exc()
            result_data['error'] = f'Exception: {e}'
            result_data['traceback'] = traceback.format_exc()

        finally:
            # 总是清理 tmux 会话
            try:
                subprocess.run(['tmux', 'kill-session', '-t', tmux_session], stderr=subprocess.DEVNULL)
            except:
                pass

            # 总是尝试同步 VM data 到宿主机（确保 trace 不丢失）
            try:
                sync_result = subprocess.run([
                    'sshpass', '-p', 'jarvis.linux.123',
                    'rsync', '-avz', '--exclude=*.db-shm', '--exclude=*.db-wal',
                    '-e', 'ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -o PreferredAuthentications=password',
                    f'user@{self.vm_ip}:/home/user/jarvis/data/',
                    '/Users/Ninot/NinotQuyi/jarvis/data/'
                ], capture_output=False, timeout=60)
                print(f"[Data] Final sync VM -> host complete (rc={sync_result.returncode})")
            except Exception as e:
                print(f"[Data] Final sync VM -> host failed: {e}")

            # 总是保存结果
            result_data['elapsed_time'] = time.time() - start_time
            task_result_dir = self.output_dir / task_id
            task_result_dir.mkdir(parents=True, exist_ok=True)

            # 如果有输出，保存它
            if output_lines:
                try:
                    with open(task_result_dir / 'jarvis_output.txt', 'w') as f:
                        f.writelines(output_lines)
                except:
                    pass

            # 保存结果
            try:
                with open(task_result_dir / 'result.json', 'w') as f:
                    json.dump(result_data, f, indent=2)
            except Exception as e:
                print(f"[ERROR] Failed to save result: {e}")

        return result_data

    def run(self, task_file: str, max_tasks: Optional[int] = None):
        """运行所有任务"""
        # 设置日志输出到文件
        log_file = self.output_dir / 'eval.log'
        tee = TeeLogger(log_file)
        old_stdout = sys.stdout
        sys.stdout = tee

        try:
            tasks = self.load_tasks(task_file)

            if max_tasks:
                tasks = tasks[:max_tasks]

            print(f"Loaded {len(tasks)} tasks")

            results = []
            for i, task in enumerate(tasks):
                result = self.run_task(task, i)
                results.append(result)

                # 打印当前统计
                successful = sum(1 for r in results if r.get('result', 0) > 0)
                print(f"\n{'='*60}")
                print(f"Progress: {i+1}/{len(tasks)}")
                print(f"Success rate: {successful}/{len(results)} = {successful/len(results):.2%}")
                print(f"{'='*60}\n")

            # 保存汇总结果
            summary = {
                'total_tasks': len(results),
                'successful': sum(1 for r in results if r.get('result', 0) > 0),
                'avg_result': sum(r.get('result', 0) for r in results) / len(results) if results else 0,
                'results': results,
            }

            with open(self.output_dir / 'summary.json', 'w') as f:
                json.dump(summary, f, indent=2)

            print(f"\n{'='*60}")
            print(f"EVALUATION COMPLETE")
            print(f"Total: {summary['total_tasks']}")
            print(f"Success: {summary['successful']}")
            print(f"Success Rate: {summary['successful']/summary['total_tasks']:.2%}")
            print(f"Average Score: {summary['avg_result']:.3f}")
            print(f"{'='*60}")

        finally:
            # 恢复 stdout 并关闭日志
            sys.stdout = old_stdout
            tee.close()


def main():
    parser = argparse.ArgumentParser(description='Run Jarvis evaluation on OSWorld')

    # OSWorld 配置
    parser.add_argument('--vm-ip', type=str, required=True,
                        help='Linux VM IP address')
    parser.add_argument('--vm-path', type=str,
                        default='/Users/Ninot/NinotQuyi/OSWorld/vmware_vm_data/Ubuntu0/Ubuntu.vmx',
                        help='Path to VMware VMX file')
    parser.add_argument('--task-file', type=str,
                        default='evaluation_examples/test_small.json',
                        help='Path to task JSON file')
    parser.add_argument('--max-tasks', type=int, default=None,
                        help='Maximum number of tasks to run')
    parser.add_argument('--max-time', type=int, default=300,
                        help='Max time per task (seconds)')
    parser.add_argument('--provider-name', type=str, default='vmware',
                        help='Virtualization provider')
    parser.add_argument('--action-space', type=str, default='pyautogui',
                        help='Action space')
    parser.add_argument('--observation-type', type=str,
                        default='screenshot',
                        choices=['screenshot', 'a11y_tree', 'screenshot_a11y_tree'],
                        help='Observation type')

    # Jarvis 配置
    parser.add_argument('--jarvis-dir', type=str, required=True,
                        help='Jarvis directory on VM')
    parser.add_argument('--output-dir', type=str, default='./results',
                        help='Output directory for results')
    parser.add_argument('--init-snapshot', action='store_true',
                        help='Create initial snapshot before running tasks')

    args = parser.parse_args()

    # 如果指定了 --init-snapshot，创建快照并退出
    if args.init_snapshot:
        runner = JarvisEvalRunner(
            vm_ip=args.vm_ip,
            vm_path=args.vm_path,
            jarvis_dir=args.jarvis_dir,
            output_dir=args.output_dir,
        )
        runner._manage_snapshot(args.vm_path, "init_state")
        print("Snapshot created successfully!")
        return

    runner = JarvisEvalRunner(
        vm_ip=args.vm_ip,
        vm_path=args.vm_path,
        jarvis_dir=args.jarvis_dir,
        output_dir=args.output_dir,
        max_time=args.max_time,
        provider_name=args.provider_name,
        action_space=args.action_space,
        observation_type=args.observation_type,
    )

    runner.run(args.task_file, args.max_tasks)


if __name__ == '__main__':
    main()
