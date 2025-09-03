#!/bin/bash
set -e

CONFIG_FILE="$1"
shift
TARGETS=("$@")

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log_info() {
    echo -e "\033[0;32m[BUN]\033[0m $1"
}

log_error() {
    echo -e "\033[0;31m[BUN ERROR]\033[0m $1"
}

# Check if bun is installed
if ! command -v bun &> /dev/null; then
    log_error "Bun is not installed or not in PATH"
    exit 1
fi

# Get output directory
OUTPUT_DIR=$(jq -r '.build.output_dir' "$CONFIG_FILE")
if [[ "$OUTPUT_DIR" == "null" ]]; then
    OUTPUT_DIR="./dist"
fi

# Get bun services from config
readarray -t BUN_SERVICES < <(jq -c '.services[] | select(.type == "bun" and .enabled == true)' "$CONFIG_FILE")

if [[ ${#BUN_SERVICES[@]} -eq 0 ]]; then
    log_info "No enabled bun services found"
    exit 0
fi

for service_json in "${BUN_SERVICES[@]}"; do
    SERVICE_NAME=$(echo "$service_json" | jq -r '.name')
    SERVICE_PATH=$(echo "$service_json" | jq -r '.path')
    SERVICE_ENTRY=$(echo "$service_json" | jq -r '.entry // "src/index.ts"')
    SERVICE_OUTPUT=$(echo "$service_json" | jq -r '.output // .name')
    
    log_info "Building service: $SERVICE_NAME"
    
    # Check if service directory exists
    if [[ ! -d "$SERVICE_PATH" ]]; then
        log_error "Service directory not found: $SERVICE_PATH"
        continue
    fi
    
    # Check if entry file exists
    if [[ ! -f "$SERVICE_PATH/$SERVICE_ENTRY" ]]; then
        log_error "Entry file not found: $SERVICE_PATH/$SERVICE_ENTRY"
        continue
    fi
    
    # Build for each target
    for target in "${TARGETS[@]}"; do
        case "$target" in
            linux-amd64)
                BUN_TARGET="bun-linux-x64"
                BINARY_EXT=""
                ;;
            windows-amd64)
                BUN_TARGET="bun-windows-x64"
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
            
            # Install dependencies if package.json exists
            if [[ -f "package.json" ]]; then
                bun install
            fi
            
            # Compile to executable
            bun build --compile --target="$BUN_TARGET" --outfile="$DIST_PATH" "$SERVICE_ENTRY"
        )
        
        if [[ -f "$OUTPUT_PATH" ]]; then
            log_info "  ✓ Built successfully: $(basename "$OUTPUT_PATH")"
        else
            log_error "  ✗ Build failed: $(basename "$OUTPUT_PATH")"
        fi
    done
done

log_info "Bun services build complete"