# Use the official devbox image as base
FROM jetpackio/devbox:latest

# Set the working directory
WORKDIR /app

# Install tini for proper process handling
RUN sudo apt-get update && sudo apt-get install -y --no-install-recommends tini \
    && sudo rm -rf /var/lib/apt/lists/*

# Copy package management files first for better layer caching
COPY devbox.json devbox.lock ./

# Install devbox dependencies
RUN devbox install

# Copy environment variables
COPY .env .

# Copy configuration files
COPY process-compose.yml Caddyfile ./

# Copy application directories
COPY --chown=devbox:devbox barkloader/ ./barkloader/
COPY --chown=devbox:devbox barkloader-rust/ ./barkloader-rust/
COPY --chown=devbox:devbox buf/ ./buf/
COPY --chown=devbox:devbox db/ ./db/
COPY --chown=devbox:devbox permissions/ ./permissions/
COPY --chown=devbox:devbox shared/ ./shared/
COPY --chown=devbox:devbox streamlabs/ ./streamlabs/
COPY --chown=devbox:devbox treats/ ./treats/
COPY --chown=devbox:devbox twitch/ ./twitch/
COPY --chown=devbox:devbox wooflow/ ./wooflow/
COPY --chown=devbox:devbox woofwoofwoof/ ./woofwoofwoof/

# Ensure the user owns the app directory
RUN chown -R devbox:devbox /app

# Switch to non-root user
USER devbox

# Set the entrypoint to use tini
ENTRYPOINT ["/usr/bin/tini", "--"]

# Default command to run process-compose
CMD ["process-compose", "up"]
