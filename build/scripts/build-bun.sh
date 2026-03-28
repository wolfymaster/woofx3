#!/bin/bash
set -e

CONFIG_FILE="$1"
shift
TARGETS=("$@")

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=resolve-build-paths.sh
source "$SCRIPT_DIR/resolve-build-paths.sh"

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

woofx3_set_output_dir "$CONFIG_FILE"

# Get bun services from config
readarray -t BUN_SERVICES < <(jq -c '.services[] | select(.type == "bun" and .enabled == true)' "$CONFIG_FILE")

if [[ ${#BUN_SERVICES[@]} -eq 0 ]]; then
    log_info "No enabled bun services found"
    exit 0
fi

REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMMON_TS="$REPO_ROOT/shared/common/typescript"
CLIENTS_TS="$REPO_ROOT/shared/clients/typescript"
shared_ts_roots=()
[[ -d "$COMMON_TS" ]] && shared_ts_roots+=("$COMMON_TS")
[[ -d "$CLIENTS_TS" ]] && shared_ts_roots+=("$CLIENTS_TS")
if [[ ${#shared_ts_roots[@]} -gt 0 ]]; then
    log_info "bun install in shared TypeScript packages (path-alias deps)"
    while IFS= read -r -d '' pj; do
        dir="$(dirname "$pj")"
        log_info "  -> $dir"
        (cd "$dir" && bun install)
    done < <(find "${shared_ts_roots[@]}" \
        -name package.json \
        -not -path "*/node_modules/*" \
        -print0)
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
                # Some services reference local shared packages as workspace:*
                # but this repo doesn't declare a Bun workspace at root.
                # Rewrite to file: path only for this install, then restore.
                if jq -e '.dependencies["@woofx3/common"] == "workspace:*"' package.json >/dev/null 2>&1; then
                    cp package.json package.json.woofx3.bak
                    trap 'mv -f package.json.woofx3.bak package.json' EXIT
                    jq --arg v "file:$REPO_ROOT/shared/common/typescript" \
                        '.dependencies["@woofx3/common"] = $v' \
                        package.json > package.json.tmp
                    mv package.json.tmp package.json
                fi
                bun install
                if [[ -f package.json.woofx3.bak ]]; then
                    mv -f package.json.woofx3.bak package.json
                    trap - EXIT
                fi
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