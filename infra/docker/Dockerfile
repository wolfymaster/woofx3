# =============================================================================
# Builder Stage - Install and compile everything
# =============================================================================
FROM ubuntu:22.04 AS builder

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies for building
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    git \
    build-essential \
    ca-certificates \
    gnupg \
    lsb-release \
    unzip \
    tar \
    gzip \
    libssl-dev \
    libreadline-dev \
    zlib1g-dev \
    libyaml-dev \
    libffi-dev \
    libgdbm-dev \
    libncurses5-dev \
    libgmp-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Install Caddy (latest)
RUN curl -L https://github.com/caddyserver/caddy/releases/latest/download/caddy_2.10.0_linux_amd64.tar.gz \
    -o /tmp/caddy.tar.gz \
    && cd /tmp && tar -xzf caddy.tar.gz \
    && chmod +x caddy

# Install Go 1.23.3
RUN wget https://go.dev/dl/go1.23.3.linux-amd64.tar.gz \
    && tar -C /usr/local -xzf go1.23.3.linux-amd64.tar.gz \
    && rm go1.23.3.linux-amd64.tar.gz
ENV PATH="/usr/local/go/bin:${PATH}"
ENV GOPATH="/go"
ENV PATH="${GOPATH}/bin:${PATH}"
RUN mkdir -p ${GOPATH}

# Install Bun 1.1.34
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v1.1.34"

# Install Ruby 3.3.9 via rbenv
RUN curl -fsSL https://github.com/rbenv/rbenv-installer/raw/HEAD/bin/rbenv-installer | bash
RUN ~/.rbenv/bin/rbenv install 3.3.9 \
    && ~/.rbenv/bin/rbenv global 3.3.9

# Install Python UV (latest)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

# Install Buf 1.47.2
RUN curl -sSL "https://github.com/bufbuild/buf/releases/download/v1.47.2/buf-$(uname -s)-$(uname -m)" \
    -o /tmp/buf \
    && chmod +x /tmp/buf

# Install NATS CLI 0.1.5
RUN curl -L https://github.com/nats-io/natscli/releases/download/v0.1.5/nats-0.1.5-linux-amd64.zip \
    -o /tmp/nats.zip \
    && cd /tmp && unzip nats.zip \
    && chmod +x nats-0.1.5-linux-amd64/nats

# Install process-compose 1.64.1
RUN curl -L https://github.com/F1bonacc1/process-compose/releases/download/v1.64.1/process-compose_linux_amd64.tar.gz \
    -o /tmp/process-compose.tar.gz \
    && cd /tmp && tar -xzf process-compose.tar.gz \
    && chmod +x process-compose

# Install protoc-gen-twirp 8.1.2
RUN go install github.com/twitchtv/twirp/protoc-gen-twirp@v8.1.2

# Install Twitch CLI 1.1.24
RUN curl -L https://github.com/twitchdev/twitch-cli/releases/download/v1.1.24/twitch-cli_1.1.24_Linux_x86_64.tar.gz \
    -o /tmp/twitch-cli.tar.gz \
    && cd /tmp && mkdir twitchfiles && tar -xzf twitch-cli.tar.gz -C twitchfiles --strip-components 1 \
    && mv twitchfiles/twitch twitch && chmod +x twitch && rm -rf twitchfiles

# Install Temporal CLI 1.4.1
RUN curl -L https://github.com/temporalio/cli/releases/download/v1.4.1/temporal_cli_1.4.1_linux_amd64.tar.gz \
    -o /tmp/temporal-cli.tar.gz \
    && cd /tmp && tar -xzf temporal-cli.tar.gz \
    && chmod +x temporal

# =============================================================================
# Runtime Stage - Minimal final image
# =============================================================================
FROM ubuntu:22.04 AS runtime

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive
ENV CADDY_ROOT_DIR=.

# Install only runtime dependencies
RUN apt-get update && apt-get install -y \
    curl \
    sudo \
    ca-certificates \
    git \
    sqlite3 \
    inotify-tools \
    && rm -rf /var/lib/apt/lists/*

# Copy Go installation
COPY --from=builder /usr/local/go /usr/local/go
ENV PATH="/usr/local/go/bin:${PATH}"
ENV GOPATH="/go"
ENV PATH="${GOPATH}/bin:${PATH}"

# Copy Go binaries
COPY --from=builder /go/bin /go/bin
RUN mkdir -p /go/bin

# Copy Bun
COPY --from=builder /root/.bun/bin/bun /usr/local/bin/bun

# Copy Ruby installation
COPY --from=builder /root/.rbenv /root/.rbenv
ENV PATH="/root/.rbenv/versions/3.3.5/bin:${PATH}"

# Copy UV
COPY --from=builder /root/.local/bin/uv /usr/local/bin/uv

# Copy all compiled binaries
COPY --from=builder /tmp/caddy /usr/local/bin/caddy
COPY --from=builder /tmp/buf /usr/local/bin/buf
COPY --from=builder /tmp/nats-0.1.5-linux-amd64/nats /usr/local/bin/nats
COPY --from=builder /tmp/process-compose /usr/local/bin/process-compose
COPY --from=builder /tmp/twitch /usr/local/bin/twitch-cli
COPY --from=builder /tmp/temporal /usr/local/bin/temporal-cli

RUN groupadd -g 1000 woofx3 && \
    useradd -u 1000 -g 1000 -m -s /bin/bash woofx3

USER woofx3
WORKDIR /home/woofx3/code

# Default command
CMD ["/bin/bash"]
