#!/bin/bash
# Sync Jarvis to Linux VM and run task
# Usage: ./run-on-vm.sh "your task here"

VM_IP="192.168.236.129"
PASSWORD="jarvis.linux.123"
TASK="$1"

if [ -z "$TASK" ]; then
  echo "Usage: ./run-on-vm.sh \"your task here\""
  exit 1
fi

echo "=== Step 1: Syncing code to VM ==="

# Sync source code (exclude node_modules, .git, dist)
sshpass -p "$PASSWORD" rsync -avz \
  --exclude node_modules \
  --exclude .git \
  --exclude dist \
  --exclude target \
  -e "ssh -o StrictHostKeyChecking=no" \
  /Users/Ninot/NinotQuyi/jarvis/ \
  user@${VM_IP}:~/jarvis/

echo "=== Step 2: Building on VM ==="

# Build TypeScript on VM
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no user@$VM_IP \
  "export NVM_DIR=\"\$HOME/.nvm\" && [ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\" && nvm use 22 && cd ~/jarvis && npm run build"

echo "=== Step 3: Creating tmux session ==="

# Kill old tmux and create new session
tmux kill-server 2>/dev/null
tmux new-session -d -s work "sshpass -p '$PASSWORD' ssh -o StrictHostKeyChecking=no user@$VM_IP"

echo "=== Step 4: Running task ==="

# Create task script
cat > /tmp/run_task.sh << EOF
#!/bin/bash
export NVM_DIR="\$HOME/.nvm"
[ -s "\$NVM_DIR/nvm.sh" ] && . "\$NVM_DIR/nvm.sh"
nvm use 22
cd ~/jarvis
export DISPLAY=:0
export http_proxy=http://192.168.236.1:7897
export https_proxy=http://192.168.236.1:7897
node dist/cli/main.js --no-ui "$TASK"
EOF
chmod +x /tmp/run_task.sh

# Upload and execute
sshpass -p "$PASSWORD" scp -o StrictHostKeyChecking=no /tmp/run_task.sh user@${VM_IP}:/tmp/run_task.sh
tmux send-keys -t work "bash /tmp/run_task.sh" Enter

echo "Task started! Monitor with: tmux capture-pane -t work -b buf && tmux save-buffer -b buf -"
echo "VM IP: $VM_IP"
