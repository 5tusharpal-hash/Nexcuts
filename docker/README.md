# Infrastructure Orchestration
This directory contains configuration for the project's infrastructure services.

## Services
- **Nginx**: Reverse proxy and load balancer.
- **Redis**: Distributed caching and session management.
- **ElasticSearch**: Full-text search and analytics.
- **Postgres**: Primary relational database.

## Setup
Run `docker compose -f docker-compose.yml up -d` from this directory to start the local development Redis service. Postgres and Elasticsearch container configuration is not included here.
