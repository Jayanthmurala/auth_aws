#!/bin/bash
# =============================================================================
# CodeDeploy Lifecycle Script: AfterInstall
# Installs all necessary prerequisites (Docker, Docker Compose, AWS CLI)
# on the EC2 instance so the application can be built and run.
# =============================================================================

set -e # Exit immediately if a command exits with a non-zero status

echo "--- Starting prerequisite installation (Docker, Compose, AWS CLI) ---"

# --- 1. Install Docker ---
sudo yum update -y
sudo yum install docker -y

# --- 2. Start Docker Service ---
sudo service docker start
sudo systemctl enable docker

# --- 3. Add ec2-user to docker group (CRITICAL for running docker without sudo) ---
# The CodeDeploy agent runs scripts as ec2-user
sudo usermod -aG docker ec2-user
echo "Added ec2-user to docker group. Reboot is usually required, but we will rely on new session."

# --- 4. Install Docker Compose V2 (CRITICAL for 'docker compose' command) ---
# Installs it as a plugin, enabling the 'docker compose' syntax
sudo yum install docker-compose-plugin -y

# --- 5. Install AWS CLI v2 (CRITICAL for secure secret retrieval) ---
# AWS CLI is required to run 'aws secretsmanager get-secret-value'
#!/bin/bash
set -e

echo "--- Starting prerequisite installation (Docker, Compose, AWS CLI) ---"

# Update package list
sudo dnf update -y

# Install Docker
sudo dnf install -y docker

# Enable and start Docker
sudo systemctl enable docker
sudo systemctl start docker

# Add ec2-user to docker group
sudo usermod -aG docker ec2-user

# Install Docker Compose v2 manually (Amazon Linux 2023)
COMPOSE_VERSION=v2.27.0
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -SL https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-x86_64 \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# Verify installation
docker compose version

# Install AWS CLI if not installed
if ! command -v aws &> /dev/null
then
    echo "Installing AWS CLI..."
    curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
    unzip -q awscliv2.zip
    sudo ./aws/install
    rm -rf aws awscliv2.zip
fi

echo "--- Dependencies installed successfully ---"

# Note: The 'usermod' command above requires the user to log in again to take effect.
# In CodeDeploy's sequential script execution, relying on 'newgrp' is risky.
# For simplicity, we assume the CodeDeploy agent's next phase starts a clean shell 
# that respects the group change, but this is the most common point of failure.

# We must exit with success for the pipeline to continue.
exit 0