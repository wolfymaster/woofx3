# Monorepo Build System

A cross-platform build system for services written in Bun, Rust, and Go.

## Quick Start

1. Configure your services in `build/config/services.json`
2. Run the build: `cd build && ./main.sh`
3. Deploy the generated archives from `dist/`

## Structure

```
build/
├── config/
│   └── services.json          # Service configuration
├── scripts/
│   ├── build-bun.sh          # Bun service builder
│   ├── build-rust.sh         # Rust service builder  
│   ├── build-go.sh           # Go service builder
│   ├── build-orchestrator.sh # Orchestrator builder
│   └── package.sh            # Archive packaging
├── orchestrator/
│   ├── main.go               # Supervisor process
│   └── go.mod                # Go module
├── main.sh                   # Build entry point
└── README.md                 # This file
```

## Configuration

### services.json

Define your services in `build/config/services.json`:

```json
{
  "services": [
    {
      "name": "my-bun-service",
      "type": "bun", 
      "path": "./services/bun-service",
      "enabled": true,
      "entry": "src/index.ts",
      "output": "bun-service",
      "dependencies": [],
      "health_endpoint": "http://localhost:3001/health"
    },
    {
      "name": "my-rust-service",
      "type": "rust",
      "path": "./services/rust-service",
      "enabled": true, 
      "output": "rust-service",
      "dependencies": []
    },
    {
      "name": "my-go-service", 
      "type": "go",
      "path": "./services/go-service",
      "enabled": false,
      "output": "go-service",
      "dependencies": []
    }
  ],
  "build": {
    "output_dir": "./dist",
    "targets": ["linux-amd64", "windows-amd64"]
  }
}
```

### Environment Variables

Override settings with BUILD_* environment variables in `.env`:

```bash
# Example .env file
BUILD_CLEAN=true
BUILD_VERBOSE=true
```

## Usage

### Basic Build
```bash
cd build
./main.sh
```

### Build Options
```bash
./main.sh --clean              # Clean before build
./main.sh --verbose            # Verbose output
./main.sh --target linux-amd64 # Build specific target
```

### Output

The build produces:
- `dist/linux-amd64/` - Linux binaries
- `dist/windows-amd64/` - Windows binaries
- `dist/services-linux-amd64.tar.gz` - Linux deployment package
- `dist/services-windows-amd64.zip` - Windows deployment package

## Prerequisites

- **Bun**: For compiling TypeScript/JavaScript services
- **Rust**: For compiling Rust services (with rustup for cross-compilation targets)
- **Go**: For compiling Go services and the orchestrator
- **jq**: For JSON configuration parsing

### Installing Cross-compilation Targets

```bash
# Rust targets
rustup target add x86_64-unknown-linux-musl
rustup target add x86_64-pc-windows-gnu

# Go supports cross-compilation out of the box
```

## Service Requirements

### Bun Services
- Must have a main entry file (default: `src/index.ts`)
- Should have `package.json` for dependencies
- Will be compiled to native executable

### Rust Services  
- Must have `Cargo.toml`
- Will be compiled as static binaries
- Binary name should match the `output` field or package name

### Go Services
- Must have `go.mod`
- Entry point defaults to current directory (`.`)
- Will be compiled as static binaries

## Deployment

1. Extract the appropriate archive on your target system
2. Run `./start.sh` (Linux) or `start.bat` (Windows)
3. The orchestrator will start and manage all enabled services

The orchestrator provides:
- Process supervision and restart on crash
- Graceful shutdown handling
- Service lifecycle management
- Environment variable inheritance

## Adding New Services

1. Add service definition to `services.json`
2. Ensure service directory has proper structure for its type
3. Run build - no code changes required!

## Troubleshooting

### Build Fails
- Check that all required tools are installed and in PATH
- Verify service paths in `services.json` are correct
- Use `--verbose` flag for detailed output

### Service Won't Start
- Check that service binary exists in deployment package
- Verify service reads configuration from environment variables
- Check orchestrator logs for startup errors

### Cross-compilation Issues
- Ensure cross-compilation targets are installed
- For Rust static linking issues, check MUSL toolchain installation
- For Windows builds on Linux, ensure MinGW-w64 is available