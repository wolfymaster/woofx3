#!/bin/bash
set -e

CONFIG_FILE="$1"
shift
TARGETS=("$@")

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log_info() {
    echo -e "\033[0;32m[PACKAGE]\033[0m $1"
}

log_error() {
    echo -e "\033[0;31m[PACKAGE ERROR]\033[0m $1"
}

# Get output directory
OUTPUT_DIR=$(jq -r '.build.output_dir' "$CONFIG_FILE")
if [[ "$OUTPUT_DIR" == "null" ]]; then
    OUTPUT_DIR="./dist"
fi

# Get enabled services for copying config
readarray -t ENABLED_SERVICES < <(jq -c '.services[] | select(.enabled == true)' "$CONFIG_FILE")

if [[ ${#ENABLED_SERVICES[@]} -eq 0 ]]; then
    log_error "No enabled services found to package"
    exit 1
fi

log_info "Packaging builds for ${#TARGETS[@]} target(s)..."

for target in "${TARGETS[@]}"; do
    TARGET_DIR="$OUTPUT_DIR/$target"
    
    if [[ ! -d "$TARGET_DIR" ]]; then
        log_error "Target directory not found: $TARGET_DIR"
        continue
    fi
    
    log_info "Packaging $target..."
    
    # Copy services.json to the target directory for runtime use
    # Filter to only include enabled services
    jq '.services |= [.[] | select(.enabled == true)]' "$CONFIG_FILE" > "$TARGET_DIR/services.json"
    
    # Create a simple startup script
    case "$target" in
        linux-amd64)
            cat > "$TARGET_DIR/start.sh" << 'EOF'
#!/bin/bash
set -e

# Get the directory of this script
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Start the orchestrator
exec "$DIR/orchestrator"
EOF
            chmod +x "$TARGET_DIR/start.sh"
            ;;
        windows-amd64)
            cat > "$TARGET_DIR/start.bat" << 'EOF'
@echo off
cd /d "%~dp0"
orchestrator.exe
EOF
            ;;
    esac
    
    # Create README for the package
    cat > "$TARGET_DIR/README.md" << 'EOF'
# Service Deployment Package

This package contains all the compiled services and the orchestrator.

## Running

### Linux
```bash
./start.sh
```

### Windows
```cmd
start.bat
```

Or run the orchestrator directly:
```bash
./orchestrator        # Linux
orchestrator.exe      # Windows
```

## Configuration

The services are configured via environment variables. The orchestrator will
start all enabled services defined in `services.json`.

## Services Included

EOF
    
    # Add service list to README
    for service_json in "${ENABLED_SERVICES[@]}"; do
        SERVICE_NAME=$(echo "$service_json" | jq -r '.name')
        SERVICE_TYPE=$(echo "$service_json" | jq -r '.type')
        echo "- **$SERVICE_NAME** ($SERVICE_TYPE)" >> "$TARGET_DIR/README.md"
    done
    
    # Count binaries in target directory
    BINARY_COUNT=$(find "$TARGET_DIR" -maxdepth 1 -type f -executable | wc -l)
    log_info "  Found $BINARY_COUNT binaries in $target"
    
    # Create archive
    ARCHIVE_NAME="services-$target"
    case "$target" in
        linux-amd64)
            ARCHIVE_FILE="$OUTPUT_DIR/${ARCHIVE_NAME}.tar.gz"
            (cd "$OUTPUT_DIR" && tar -czf "$(basename "$ARCHIVE_FILE")" "$(basename "$TARGET_DIR")")
            ;;
        windows-amd64)
            ARCHIVE_FILE="$OUTPUT_DIR/${ARCHIVE_NAME}.zip"
            (cd "$OUTPUT_DIR" && zip -r "$(basename "$ARCHIVE_FILE")" "$(basename "$TARGET_DIR")")
            ;;
    esac
    
    if [[ -f "$ARCHIVE_FILE" ]]; then
        ARCHIVE_SIZE=$(du -h "$ARCHIVE_FILE" | cut -f1)
        log_info "  ✓ Created archive: $(basename "$ARCHIVE_FILE") ($ARCHIVE_SIZE)"
    else
        log_error "  ✗ Failed to create archive: $(basename "$ARCHIVE_FILE")"
    fi
done

log_info "Packaging complete!"
log_info "Deployment packages:"
for target in "${TARGETS[@]}"; do
    case "$target" in
        linux-amd64)
            echo "  - services-$target.tar.gz"
            ;;
        windows-amd64)
            echo "  - services-$target.zip"
            ;;
    esac
done