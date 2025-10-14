#!/bin/bash
docker stop auth-app || true
docker rm auth-app || true