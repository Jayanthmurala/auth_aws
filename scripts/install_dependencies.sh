#!/bin/bash
# =============================================================================
# CodeDeploy Lifecycle Script: BeforeInstall / Install Dependencies
# Installs prerequisites: Docker, Docker Compose, AWS CLI v2
# Compatible with Amazon Linux 2023
# =============================================================================

set -e  # Exit immediately if a command fails

echo "--- Starting prerequisite installation (Docker, Compose, AWS CLI) ---"

# --- 1. Update packages ---
sudo dnf update -y

# --- 2. Install Docker ---
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    sudo dnf install -y docker
    echo "Docker installed successfully."
else
    echo "Docker already installed."
fi

# Enable and start Docker service
sudo systemctl enable docker
sudo systemctl start docker

# --- 3. Add ec2-user to docker group ---
sudo usermod -aG docker ec2-user
echo "Added ec2-user to docker group. (Re-login may be required for effect)"

# --- 4. Install Docker Compose manually (plugin version not available) ---
COMPOSE_VERSION=v2.27.0
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -SL https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-x86_64 \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
echo "Docker Compose installed successfully."

# Verify Docker Compose installation
docker compose version || echo "Docker Compose installation check failed — verify manually."

# --- 5. Install AWS CLI v2 ---
if ! command -v aws &> /dev/null; then
    echo "Installing AWS CLI..."
    curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
    unzip -q awscliv2.zip
    sudo ./aws/install
    rm -rf aws awscliv2.zip
    echo "AWS CLI installed successfully."
else
    echo "AWS CLI already installed."
fi

echo "--- All dependencies installed successfully ---"
exit 0