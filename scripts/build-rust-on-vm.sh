#!/bin/bash
# Sync Jarvis Rust source to Linux VM and build
# Usage: ./build-rust-on-vm.sh

VM_IP="192.168.236.129"
PASSWORD="jarvis.linux.123"
RUST_DIR="/Users/Ninot/NinotQuyi/jarvis-rs"
JARVIS_DIR="/Users/Ninot/NinotQuyi/jarvis"

echo "=== Building Jarvis Rust on Linux VM ==="

# First, sync source code (exclude target)
echo "Syncing source to VM..."
sshpass -p "$PASSWORD" rsync -avz \
  --exclude target \
  --exclude node_modules \
  --exclude .git \
  --exclude Cargo.lock \
  -e "ssh -o StrictHostKeyChecking=no -o PreferredAuthentications=password" \
  "$RUST_DIR/" \
  user@${VM_IP}:~/jarvis-rs/

echo "Installing Rust on VM if needed..."
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no -o PreferredAuthentications=password user@$VM_IP << 'EOF'
# Install Rust if not present
if ! command -v cargo &> /dev/null; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi
source ~/.cargo/env

# Build
cd ~/jarvis-rs
cargo build --release
EOF

echo "Done! Binary location: ~/jarvis-rs/target/release/jarvis-rs"
