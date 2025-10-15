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
sudo yum install awscli -y

echo "--- Prerequisites installation complete. ---"

# Note: The 'usermod' command above requires the user to log in again to take effect.
# In CodeDeploy's sequential script execution, relying on 'newgrp' is risky.
# For simplicity, we assume the CodeDeploy agent's next phase starts a clean shell 
# that respects the group change, but this is the most common point of failure.

# We must exit with success for the pipeline to continue.
exit 0