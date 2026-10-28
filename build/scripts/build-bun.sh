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
log_info "bun install in the workspace"
(cd "$REPO_ROOT" && bun install --frozen-lockfile)

# sceneManager's build:client imports @woofx3/module-sdk from dist/ and copies
# the widget host shim IIFE (dist/widget-host-shim.iife.js) into its public/.
# Rebuild both so Docker/CI are not dependent on a pre-built (and possibly
# stale) tree.
MODULE_SDK="$REPO_ROOT/shared/clients/typescript/module-sdk"
if [[ -f "$MODULE_SDK/package.json" ]] && jq -e '.scripts.build' "$MODULE_SDK/package.json" >/dev/null 2>&1; then
    log_info "Building @woofx3/module-sdk"
    (cd "$MODULE_SDK" && bun run build && bun run build:shim)
fi

for service_json in "${BUN_SERVICES[@]}"; do
    SERVICE_NAME=$(echo "$service_json" | jq -r '.name')
    SERVICE_PATH=$(echo "$service_json" | jq -r '.path')
    SERVICE_ENTRY=$(echo "$service_json" | jq -r '.entry // "src/index.ts"')
    SERVICE_OUTPUT=$(echo "$service_json" | jq -r '.output // .name')
    SERVICE_ASSETS=$(echo "$service_json" | jq -r '.assets // empty')
    
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

            # Optional browser/client asset build (e.g. sceneManager public/)
            if [[ -n "$SERVICE_ASSETS" ]]; then
                if jq -e '.scripts["build:client"]' package.json >/dev/null 2>&1; then
                    log_info "  -> running build:client for $SERVICE_NAME"
                    bun run build:client
                fi
            fi
            
            # Compile to executable
            bun build --compile --target="$BUN_TARGET" --outfile="$DIST_PATH" "$SERVICE_ENTRY"
        )
        
        if [[ -f "$OUTPUT_PATH" ]]; then
            log_info "  ✓ Built successfully: $(basename "$OUTPUT_PATH")"
        else
            log_error "  ✗ Build failed: $(basename "$OUTPUT_PATH")"
            continue
        fi

        # Copy declared static assets next to the binary for release layout.
        # sceneManager resolves publicDir as `<exe-dir>/public` when present.
        if [[ -n "$SERVICE_ASSETS" ]]; then
            ASSET_SRC="$SERVICE_PATH/$SERVICE_ASSETS"
            ASSET_DST="$TARGET_DIR/$SERVICE_ASSETS"
            if [[ ! -d "$ASSET_SRC" ]]; then
                log_error "  ✗ Assets directory not found: $ASSET_SRC"
                continue
            fi
            log_info "  -> copying assets $SERVICE_ASSETS -> $ASSET_DST"
            rm -rf "$ASSET_DST"
            mkdir -p "$(dirname "$ASSET_DST")"
            cp -a "$ASSET_SRC" "$ASSET_DST"
        fi
    done
done

log_info "Bun services build complete"
