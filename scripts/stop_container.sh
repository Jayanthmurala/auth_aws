#!/bin/bash
# Stop and remove the existing container defined in the docker-compose.yml
set -e

echo

cd /home/ec2-user/app
docker compose down || true

echo
exit 0 