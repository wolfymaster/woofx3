FROM nixos/nix:2.15.0

# Set user and group
RUN addgroup -S woof && adduser -S woof -G woof
USER woof

# Install Devbox
RUN nix-env -iA nixpkgs.devbox

# Copy Devbox configuration
WORKDIR /app
COPY ../devbox.json /app/devbox.json

# Copy application files
COPY --chown=woof:woof . .

# Install the Devbox environment
RUN devbox install

# Set working directory
CMD ["bun", ""]