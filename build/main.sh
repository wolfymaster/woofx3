#!/bin/bash
set -e

# Main build script for monorepo build system
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config/services.json"
BUILD_ENV="${SCRIPT_DIR}/.env"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Default values
BUILD_CLEAN=false
VERBOSE=false
TARGET=""

# Load environment variables if .env exists
if [[ -f "$BUILD_ENV" ]]; then
    log_info "Loading build environment from .env"
    set -a
    source "$BUILD_ENV"
    set +a
fi

# Check if services.json exists
if [[ ! -f "$CONFIG_FILE" ]]; then
    log_error "Configuration file not found: $CONFIG_FILE"
    exit 1
fi

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --clean)
            BUILD_CLEAN=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --target)
            TARGET="$2"
            shift 2
            ;;
        *)
            log_error "Unknown option: $1"
            echo "Usage: $0 [--clean] [--verbose] [--target linux-amd64|windows-amd64]"
            exit 1
            ;;
    esac
done

# Get output directory from config
OUTPUT_DIR=$(jq -r '.build.output_dir' "$CONFIG_FILE")
if [[ "$OUTPUT_DIR" == "null" ]]; then
    OUTPUT_DIR="./dist"
fi

# Clean if requested
if [[ "$BUILD_CLEAN" == "true" ]]; then
    log_info "Cleaning output directory: $OUTPUT_DIR"
    rm -rf "$OUTPUT_DIR"
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Get build targets
if [[ -n "$TARGET" ]]; then
    TARGETS=("$TARGET")
else
    readarray -t TARGETS < <(jq -r '.build.targets[]' "$CONFIG_FILE")
fi

log_info "Building for targets: ${TARGETS[*]}"

# Build orchestrator first
log_info "Building orchestrator..."
"$SCRIPT_DIR/scripts/build-orchestrator.sh" "$CONFIG_FILE" "${TARGETS[@]}"

# Build each service type
for script in "$SCRIPT_DIR/scripts/build-"*.sh; do
    if [[ "$(basename "$script")" != "build-orchestrator.sh" ]] && [[ -f "$script" ]]; then
        log_info "Running $(basename "$script")..."
        "$script" "$CONFIG_FILE" "${TARGETS[@]}"
    fi
done

# Package the builds
log_info "Packaging builds..."
"$SCRIPT_DIR/scripts/package.sh" "$CONFIG_FILE" "${TARGETS[@]}"

log_info "Build complete! Artifacts available in: $OUTPUT_DIR"