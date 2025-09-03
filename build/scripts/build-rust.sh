#!/bin/bash
set -e

CONFIG_FILE="$1"
shift
TARGETS=("$@")

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log_info() {
    echo -e "\033[0;32m[RUST]\033[0m $1"
}

log_error() {
    echo -e "\033[0;31m[RUST ERROR]\033[0m $1"
}

# Check if cargo is installed
if ! command -v cargo &> /dev/null; then
    log_error "Cargo is not installed or not in PATH"
    exit 1
fi

# Get output directory
OUTPUT_DIR=$(jq -r '.build.output_dir' "$CONFIG_FILE")
if [[ "$OUTPUT_DIR" == "null" ]]; then
    OUTPUT_DIR="./dist"
fi

# Get rust services from config
readarray -t RUST_SERVICES < <(jq -c '.services[] | select(.type == "rust" and .enabled == true)' "$CONFIG_FILE")

if [[ ${#RUST_SERVICES[@]} -eq 0 ]]; then
    log_info "No enabled rust services found"
    exit 0
fi

for service_json in "${RUST_SERVICES[@]}"; do
    SERVICE_NAME=$(echo "$service_json" | jq -r '.name')
    SERVICE_PATH=$(echo "$service_json" | jq -r '.path')
    SERVICE_OUTPUT=$(echo "$service_json" | jq -r '.output // .name')
    
    log_info "Building service: $SERVICE_NAME"
    
    # Check if service directory exists
    if [[ ! -d "$SERVICE_PATH" ]]; then
        log_error "Service directory not found: $SERVICE_PATH"
        continue
    fi
    
    # Check if Cargo.toml exists
    if [[ ! -f "$SERVICE_PATH/Cargo.toml" ]]; then
        log_error "Cargo.toml not found: $SERVICE_PATH/Cargo.toml"
        continue
    fi
    
    # Build for each target
    for target in "${TARGETS[@]}"; do
        case "$target" in
            linux-amd64)
                RUST_TARGET="x86_64-unknown-linux-musl"
                BINARY_EXT=""
                ;;
            windows-amd64)
                RUST_TARGET="x86_64-pc-windows-gnu"
                BINARY_EXT=".exe"
                ;;
            *)
                log_error "Unsupported target: $target"
                continue
                ;;
        esac
        
        TARGET_DIR="$OUTPUT_DIR/$target"
        mkdir -p "$TARGET_DIR"
        
        OUTPUT_PATH="$TARGET_DIR/${SERVICE_OUTPUT}${BINARY_EXT}"
        DIST_PATH=$(realpath "$OUTPUT_PATH")
        
        log_info "  -> $target: $OUTPUT_PATH"
        
        # Build the service
        (
            cd "$SERVICE_PATH"
            
            # Add target if not already added
            rustup target add "$RUST_TARGET" 2>/dev/null || true
            
            # Build static binary
            RUSTFLAGS="-C target-feature=+crt-static" cargo build --release --target="$RUST_TARGET"
            
            # Copy binary to output directory
            BUILT_BINARY="target/$RUST_TARGET/release/${SERVICE_OUTPUT}${BINARY_EXT}"
            if [[ -f "$BUILT_BINARY" ]]; then
                cp "$BUILT_BINARY" "$DIST_PATH"
            else
                # Try with different binary name (Cargo.toml name vs directory name)
                CARGO_NAME=$(cargo metadata --no-deps --format-version 1 | jq -r '.packages[0].name')
                BUILT_BINARY="target/$RUST_TARGET/release/${CARGO_NAME}${BINARY_EXT}"
                if [[ -f "$BUILT_BINARY" ]]; then
                    cp "$BUILT_BINARY" "$DIST_PATH"
                else
                    log_error "Built binary not found in expected locations"
                    continue
                fi
            fi
        )
        
        if [[ -f "$OUTPUT_PATH" ]]; then
            log_info "  ✓ Built successfully: $(basename "$OUTPUT_PATH")"
        else
            log_error "  ✗ Build failed: $(basename "$OUTPUT_PATH")"
        fi
    done
done

log_info "Rust services build complete"