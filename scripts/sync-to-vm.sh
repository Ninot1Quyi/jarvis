#!/bin/bash
# Sync Jarvis code to Linux VM
# Usage: ./sync-to-vm.sh

VM_IP="192.168.236.129"
PASSWORD="jarvis.linux.123"

echo "Syncing Jarvis to Linux VM..."

# Sync all source code (exclude node_modules, .git, dist)
sshpass -p "$PASSWORD" rsync -avz \
  --exclude node_modules \
  --exclude .git \
  --exclude dist \
  --exclude target \
  --exclude "*.ts" \
  -e "ssh -o StrictHostKeyChecking=no" \
  /Users/Ninot/NinotQuyi/jarvis/ \
  user@${VM_IP}:~/jarvis/

echo "Done! VM IP: $VM_IP"
