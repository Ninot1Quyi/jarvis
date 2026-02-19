#!/bin/bash
# Linux VM Startup Script for Jarvis Evaluation
# Usage: ./vm-start.sh [options]
#
# Options:
#   -s, --snapshot NAME   Revert to snapshot before starting
#   -h, --headless       Run in headless mode
#   -w, --wait           Wait for VM to be ready
#   -i, --ip             Just show VM IP
#   --no-start           Don't start VM, just get info

set -e

# Configuration
VM_PATH="/Users/Ninot/NinotQuyi/OSWorld/vmware_vm_data/Ubuntu0/Ubuntu.vmx"
VM_NAME="Ubuntu"
SNAPSHOT_NAME="init_state"
HEADLESS=false
WAIT_READY=false
SHOW_IP=false
NO_START=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -s|--snapshot)
      SNAPSHOT_NAME="$2"
      shift 2
      ;;
    -h|--headless)
      HEADLESS=true
      shift
      ;;
    -w|--wait)
      WAIT_READY=true
      shift
      ;;
    -i|--ip)
      SHOW_IP=true
      shift
      ;;
    --no-start)
      NO_START=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

echo "=== Jarvis Linux VM Controller ==="
echo "VM Path: $VM_PATH"

# Check if VM is already running
if vmrun -T fusion list 2>&1 | grep -q "Ubuntu0"; then
  echo "VM is already running"
else
  if [ "$NO_START" = true ]; then
    echo "VM is not running (--no-start specified)"
  else
    echo "Starting VM..."
    if [ "$HEADLESS" = true ]; then
      vmrun -T fusion start "$VM_PATH" nogui
    else
      vmrun -T fusion start "$VM_PATH"
    fi
    echo "VM started"
  fi
fi

# Get IP address
echo "Getting VM IP address..."
VM_IP=$(vmrun -T fusion getGuestIPAddress "$VM_PATH" -wait)
echo "VM IP: $VM_IP"

# Show just IP and exit
if [ "$SHOW_IP" = true ]; then
  echo "$VM_IP"
  exit 0
fi

# If --no-start, just show info
if [ "$NO_START" = true ]; then
  echo ""
  echo "=== Connection Info ==="
  echo "SSH: sshpass -p 'jarvis.linux.123' ssh -o StrictHostKeyChecking=no user@$VM_IP"
  echo ""
  echo "To run jarvis:"
  echo "  sshpass -p 'jarvis.linux.123' ssh -o StrictHostKeyChecking=no user@$VM_IP \\"
  echo "    'export NVM_DIR=\"\$HOME/.nvm\" && [ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\" && nvm use 22 && cd ~/jarvis && export DISPLAY=:0 && node dist/cli/main.js --no-ui \"任务\"'"
  exit 0
fi

# Wait for VM to be ready
if [ "$WAIT_READY" = true ]; then
  echo "Waiting for OSWorld server..."

  # Wait for HTTP server (max 30 seconds)
  for i in {1..30}; do
    if nc -z -w2 "$VM_IP" 5000 2>/dev/null; then
      echo "OSWorld server is ready!"
      break
    fi
    echo "Waiting for server... ($i/30)"
    sleep 2
  done

  # Wait for SSH (max 30 seconds)
  for i in {1..30}; do
    if nc -z -w2 "$VM_IP" 22 2>/dev/null; then
      echo "SSH is ready!"
      break
    fi
    echo "Waiting for SSH... ($i/30)"
    sleep 2
  done

  echo ""
  echo "=== VM Ready ==="
  echo "VM IP: $VM_IP"
  echo "OSWorld Server: http://$VM_IP:5000"
  echo "SSH: user@$VM_IP"
fi

echo ""
echo "=== Done ==="
echo "VM IP: $VM_IP"
