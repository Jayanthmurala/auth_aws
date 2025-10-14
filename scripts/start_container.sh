#!/bin/bash
cd /home/ec2-user/app
docker build -t auth-app .
docker run -d -p 4001:4001 --name auth-app auth-app