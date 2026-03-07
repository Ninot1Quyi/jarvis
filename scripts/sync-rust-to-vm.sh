#!/bin/bash
# Sync Jarvis Rust binary to Linux VM
# Usage: ./sync-rust-to-vm.sh

VM_IP="192.168.236.129"
PASSWORD="jarvis.linux.123"
RUST_DIR="/Users/Ninot/NinotQuyi/jarvis-rs"
JARVIS_DIR="/Users/Ninot/NinotQuyi/jarvis"

echo "=== Syncing Jarvis Rust to Linux VM ==="

# Build release binary
echo "Building Rust binary..."
cd "$RUST_DIR"
cargo build --release 2>/dev/null

# Copy binary to jarvis directory
cp "$RUST_DIR/target/release/jarvis-rs" "$JARVIS_DIR/"

# Sync to VM
sshpass -p "$PASSWORD" rsync -avz \
  --exclude node_modules \
  --exclude .git \
  --exclude target \
  --exclude src \
  -e "ssh -o StrictHostKeyChecking=no" \
  "$JARVIS_DIR/" \
  user@${VM_IP}:~/jarvis/

echo "Done! VM IP: $VM_IP"
