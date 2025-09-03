#!/bin/bash
set -e

CONFIG_FILE="$1"
shift
TARGETS=("$@")

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log_info() {
    echo -e "\033[0;32m[GO]\033[0m $1"
}

log_error() {
    echo -e "\033[0;31m[GO ERROR]\033[0m $1"
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

# Get go services from config
readarray -t GO_SERVICES < <(jq -c '.services[] | select(.type == "go" and .enabled == true)' "$CONFIG_FILE")

if [[ ${#GO_SERVICES[@]} -eq 0 ]]; then
    log_info "No enabled go services found"
    exit 0
fi

for service_json in "${GO_SERVICES[@]}"; do
    SERVICE_NAME=$(echo "$service_json" | jq -r '.name')
    SERVICE_PATH=$(echo "$service_json" | jq -r '.path')
    SERVICE_OUTPUT=$(echo "$service_json" | jq -r '.output // .name')
    SERVICE_ENTRY=$(echo "$service_json" | jq -r '.entry // "."')
    
    log_info "Building service: $SERVICE_NAME"
    
    # Check if service directory exists
    if [[ ! -d "$SERVICE_PATH" ]]; then
        log_error "Service directory not found: $SERVICE_PATH"
        continue
    fi
    
    # Check if go.mod exists
    if [[ ! -f "$SERVICE_PATH/go.mod" ]]; then
        log_error "go.mod not found: $SERVICE_PATH/go.mod"
        continue
    fi
    
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
        
        OUTPUT_PATH="$TARGET_DIR/${SERVICE_OUTPUT}${BINARY_EXT}"
        DIST_PATH=$(realpath "$OUTPUT_PATH")
        
        log_info "  -> $target: $OUTPUT_PATH"
        
        # Build the service
        (
            cd "$SERVICE_PATH"
            
            # Download dependencies
            go mod download
            
            # Build binary
            CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" go build \
                -ldflags="-w -s" \
                -o "$DIST_PATH" \
                "$SERVICE_ENTRY"
        )
        
        if [[ -f "$OUTPUT_PATH" ]]; then
            log_info "  ✓ Built successfully: $(basename "$OUTPUT_PATH")"
        else
            log_error "  ✗ Build failed: $(basename "$OUTPUT_PATH")"
        fi
    done
done

log_info "Go services build complete"