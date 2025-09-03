#!/bin/bash
set -e

CONFIG_FILE="$1"
shift
TARGETS=("$@")

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORCHESTRATOR_DIR="$SCRIPT_DIR/../orchestrator"

log_info() {
    echo -e "\033[0;32m[ORCHESTRATOR]\033[0m $1"
}

log_error() {
    echo -e "\033[0;31m[ORCHESTRATOR ERROR]\033[0m $1"
}

# Check if go is installed
if ! command -v go &> /dev/null; then
    log_error "Go is not installed or not in PATH"
    exit 1
fi

# Get output directory
OUTPUT_DIR=$(jq -r '.build.output_dir' "$CONFIG_FILE")
if [[ "$OUTPUT_DIR" == "null" ]]; then
    OUTPUT_DIR="./dist"
fi

# Check if orchestrator directory exists
if [[ ! -d "$ORCHESTRATOR_DIR" ]]; then
    log_error "Orchestrator directory not found: $ORCHESTRATOR_DIR"
    exit 1
fi

# Check if go.mod exists
if [[ ! -f "$ORCHESTRATOR_DIR/go.mod" ]]; then
    log_error "go.mod not found: $ORCHESTRATOR_DIR/go.mod"
    exit 1
fi

log_info "Building orchestrator..."

# Build for each target
for target in "${TARGETS[@]}"; do
    case "$target" in
        linux-amd64)
            GOOS="linux"
            GOARCH="amd64"
            BINARY_EXT=""
            ;;
        windows-amd64)
            GOOS="windows"
            GOARCH="amd64"
            BINARY_EXT=".exe"
            ;;
        *)
            log_error "Unsupported target: $target"
            continue
            ;;
    esac
    
    TARGET_DIR="$OUTPUT_DIR/$target"
    mkdir -p "$TARGET_DIR"
    
    OUTPUT_PATH="$TARGET_DIR/orchestrator${BINARY_EXT}"
    DIST_PATH=$(realpath "$OUTPUT_PATH")
    
    log_info "  -> $target: $OUTPUT_PATH"
    
    # Build the orchestrator
    (
        cd "$ORCHESTRATOR_DIR"
        
        # Download dependencies
        go mod download
        
        # Build binary
        CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" go build \
            -ldflags="-w -s" \
            -o "$DIST_PATH" \
            .
    )
    
    if [[ -f "$OUTPUT_PATH" ]]; then
        log_info "  ✓ Built successfully: orchestrator${BINARY_EXT}"
    else
        log_error "  ✗ Build failed: orchestrator${BINARY_EXT}"
    fi
done

log_info "Orchestrator build complete"