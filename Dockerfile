FROM node:22.11.0-bookworm

# Install dependencies for Buildah and Docker
RUN apt-get update \
    && apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    software-properties-common \
    python3-pip python3-dev unzip \
    iptables

# Create the working directory
WORKDIR /usr/src/app

# Copy package files and install npm dependencies
COPY --chown=node:node package*.json /usr/src/app/
RUN npm clean-install

# Copy source files
COPY --chown=node:node . /usr/src/app/
RUN mkdir /usr/src/app/image-cache

# Build the Node.js application
RUN npm run build

# Set the user to root to run Buildah if needed
USER root

VOLUME /var/lib/containers

# Start the application
CMD [ "npm", "start" ]
