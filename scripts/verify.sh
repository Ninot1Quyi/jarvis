#!/bin/bash
# Dum-E Comprehensive Verification Script
# Runs after code changes to verify functional correctness

set -e

DUM_E_DIR="/Users/Ninot/NinotQuyi/dum-e"
cd "$DUM_E_DIR"

echo "=== Dum-E Comprehensive Verification ==="
echo "Timestamp: $(date)"
echo ""

# 1. Check compilation
echo "[1/5] Checking compilation..."
if cargo build 2>&1 | grep -q "error"; then
    echo "FAIL: Compilation errors found"
    exit 1
fi
echo "PASS: Compiles successfully"

# 2. Run unit tests
echo ""
echo "[2/5] Running unit tests..."
if cargo test --lib 2>&1; then
    echo "PASS: All unit tests passed"
else
    echo "FAIL: Unit tests failed"
    exit 1
fi

# 3. Run integration tests
echo ""
echo "[3/5] Running integration tests..."
if cargo test --tests 2>&1; then
    echo "PASS: Integration tests passed"
else
    echo "FAIL: Integration tests failed"
    exit 1
fi

# 4. Check formatting
echo ""
echo "[4/5] Checking code formatting..."
if cargo fmt --check 2>&1; then
    echo "PASS: Code properly formatted"
else
    echo "WARN: Run 'cargo fmt' to fix formatting"
fi

# 5. Run clippy (warn only, don't fail)
echo ""
echo "[5/5] Running clippy (advisory)..."
CLIPPY_OUTPUT=$(cargo clippy --lib 2>&1 || true)
if echo "$CLIPPY_OUTPUT" | grep -q "error:"; then
    echo "WARN: Clippy found issues (advisory only)"
    echo "$CLIPPY_OUTPUT" | grep "error:" | head -5
else
    echo "PASS: Clippy clean"
fi

echo ""
echo "=== Verification Complete ==="
echo "All tests passed. Dum-E is ready for deployment."
