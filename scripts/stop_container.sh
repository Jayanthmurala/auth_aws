#!/bin/bash
# Stop and remove the existing container defined in the docker-compose.yml
cd /home/ec2-user/app
docker compose down || true