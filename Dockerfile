FROM node:22.11.0-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create the working directory
WORKDIR /usr/src/app

# Copy package files and install npm dependencies
COPY --chown=node:node package*.json /usr/src/app/
RUN npm clean-install && npm cache clean --force

# Copy source files
COPY --chown=node:node . /usr/src/app/
RUN mkdir /usr/src/app/image-cache

RUN npm run build \
    && rm -rf node_modules .git .github .vscode tests docs

# Set the user to root to run Buildah if needed
USER root

VOLUME /var/lib/containers

# Start the application
CMD [ "npm", "start" ]
