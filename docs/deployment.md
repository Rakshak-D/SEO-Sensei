# Production ingress and container deployment

SEO-Sensei uses Caddy as the only public ingress and keeps the application
containers private:

```mermaid
flowchart LR
    Browser[Browser or extension] --> Caddy[Caddy :80/:443]
    Caddy --> Dashboard[dashboard container :8501]
    Caddy --> API[api container :8000]
    Dashboard -->|private Docker DNS: api:8000| API
    API --> Fetcher[SafeFetcher]
    API --> Gemini[Optional Gemini service]
```

The API and dashboard remain separate processes and images. The extension is a
browser-loaded artifact and is not part of either image. Caddy routes
`APP_DOMAIN` to the dashboard and `API_DOMAIN` to the API; separate hostnames
avoid path-prefix rewriting and simplify Streamlit websocket traffic and CORS.

## Images and startup

Both images use the pinned Python 3.11 slim Bookworm base, install only their
service-specific runtime requirements (`requirements-api.txt` or
`requirements-dashboard.txt`), run as the non-root `seo-sensei` user, and log to
stdout or stderr. The commands are:

```text
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-8000}
streamlit run backend/dashboard.py --server.address 0.0.0.0 --server.port ${PORT:-8501} --server.headless true
```

The images contain no `.env` file or credentials. Configuration is injected at
container start.

## Local Compose

Create a local environment file and set the local credentials and fake hostnames
to appropriate values:

```bash
copy .env.example .env  # PowerShell; use cp on Linux/macOS
# Set API_ACCESS_TOKEN, CONTAINER_APP_ENV=production, and optionally GEMINI_API_KEY in .env.
docker compose -f compose.yaml -f compose.dev.yaml build
docker compose -f compose.yaml -f compose.dev.yaml up -d
curl http://127.0.0.1:8000/health
```

Open the dashboard at `http://127.0.0.1:8501`. In the Compose network, the
dashboard reaches the API at `http://api:8000`; `127.0.0.1` inside the dashboard
container would refer to the dashboard container itself. The development
overlay publishes the API only on host loopback for local extension/API
testing.

The production `compose.yaml` publishes only Caddy on ports 80 and 443. API and
dashboard ports are exposed only to the Compose network. `compose.dev.yaml`
adds loopback-only API and dashboard ports and disables Caddy for convenient
local HTTP development. Do not use that overlay as a public deployment.

When `APP_DOMAIN` and `API_DOMAIN` resolve to the host, Caddy automatically
obtains certificates through ACME and redirects HTTP to HTTPS. The dashboard
is available at `https://app.example.com` and the extension should be pointed
at `https://api.example.com` (replace both examples with the configured values).

## Configuration and secrets

Required for protected production API operation:

- `API_ACCESS_TOKEN`
- `ALLOWED_CORS_ORIGINS` appropriate to browser clients
- `APP_DOMAIN`, `API_DOMAIN`, and `ACME_EMAIL` for Caddy-managed HTTPS
- `TRUSTED_PROXY_NETWORKS`, containing only the configured Caddy peer/network

`GEMINI_API_KEY` is optional. If it is empty, deterministic analysis remains
available and AI functionality reports a controlled unavailable/configuration
state. `DASHBOARD_API_ACCESS_TOKEN` must match the API token and remains only in
the dashboard container environment; it is never rendered to browser state.

The complete application/resource/rate-limit settings remain in `.env.example`.
Never commit `.env`, put secrets in a Dockerfile, or pass credentials in image
build arguments.

## Health and resources

The API liveness check calls the lightweight public `/health` endpoint. Compose
uses the separate `/ready` endpoint to confirm local SafeFetcher initialization.
Neither
endpoint authenticates, crawls, performs DNS resolution, or calls Gemini. The dashboard health check uses
Streamlit's local `/_stcore/health` endpoint. Compose waits for API health
before starting the dashboard and restarts unhealthy services according to the
container runtime policy.

The application is stateless: it has no database, SQLite file, generated file,
or required persistent volume. SafeFetcher response limits, connection pools,
Gemini concurrency, and process-local rate limits remain controlled by the
existing environment settings. The in-memory limiter is not global across
multiple replicas.

The containers use read-only root filesystems, a `/tmp` tmpfs, dropped Linux
capabilities, and `no-new-privileges`. These settings assume a normal container
runtime; no privileged mode, host networking, or Docker socket is required.

Caddy stores ACME certificates and its runtime configuration in the named
`caddy_data` and `caddy_config` volumes. These are the only persistent volumes;
back them up as deployment metadata, protect them like infrastructure state,
and do not place application secrets in them. The API and dashboard have no
persistent application state.

## Proxy trust, CORS, and limits

Caddy preserves the method, body, status, and websocket upgrade traffic while
reverse-proxying. FastAPI remains responsible for bearer authentication and
authorization. The API trusts forwarded client identity only from the static
Caddy address configured in `TRUSTED_PROXY_NETWORKS`; arbitrary client headers
are ignored. Caddy removes Authorization and Cookie fields from its access-log
format and the application never accepts query-string authentication.

Set `ALLOWED_CORS_ORIGINS` to the exact browser origins that need API access,
such as the deployed dashboard origin and the extension origin. Do not use `*`.
The proxy applies a 1 MB API request-body ceiling, matching the application's
1,000,000-byte body limit as defense in depth. SafeFetcher, Gemini, and API
timeouts remain application-controlled; Caddy does not impose a shorter
request timeout on normal API operations.

## What this phase does not provide

This phase provides a Caddy-based ingress configuration but is not a complete
cloud deployment. It does not provide DNS automation, cloud infrastructure, a
registry, automatic deployment, persistent users, or distributed rate limiting.
Real DNS records and ports 80/443 must reach the host before public ACME HTTPS
can succeed. TLS terminates at Caddy; internal API traffic remains HTTP on the
private Docker network.

## Optional paid AWS single-host deployment

The preferred free target is documented in
[`free-deployment.md`](free-deployment.md). If AWS is selected instead, one
Ubuntu LTS x86_64 EC2 instance
running the existing production `compose.yaml`:

```text
Internet → security group → EC2 → Docker Compose → Caddy → API/dashboard
```

### Recommended instance and operating system

Start with a `t3.small` (2 vCPU, 2 GiB RAM) using a current Ubuntu LTS 64-bit
AMI. The application has one API process, one Streamlit process, Caddy, bounded
SafeFetcher pools, and bounded Gemini concurrency; this is a sensible small
portfolio deployment size. Move to a larger instance only after observing real
memory/CPU usage. No AWS price is assumed by this recommendation.

The host needs outbound DNS and HTTPS access for package updates, Caddy ACME,
and optional Gemini calls. The application itself does not require an IAM role
or AWS API permissions. If an operator uses AWS CLI, keep those credentials
outside the application host/container environment.

### Security group and SSH

Configure the EC2 security group with only:

- TCP 80 from `0.0.0.0/0` for HTTP redirect and ACME HTTP validation.
- TCP 443 from `0.0.0.0/0` for HTTPS application traffic.
- TCP 22 only from the administrator's fixed public IP or restricted range.

Do not open 8000, 8501, Docker's API socket, or arbitrary high ports. Use
key-based SSH with an administrator-owned private key. Do not enable password
SSH authentication or place private keys in this repository.

### Host layout and Docker installation

Use `/opt/seo-sensei` for the Git checkout and keep the production environment
file outside Git, for example `/etc/seo-sensei/seo-sensei.env`:

```bash
sudo install -d -m 0755 /opt/seo-sensei /etc/seo-sensei
sudo chown -R "$USER":"$USER" /opt/seo-sensei
git clone <repository-url> /opt/seo-sensei
cp /opt/seo-sensei/.env.example /etc/seo-sensei/seo-sensei.env
sudo chmod 600 /etc/seo-sensei/seo-sensei.env
```

Install Docker Engine and the Compose plugin using the official Docker Ubuntu
repository instructions for the selected Ubuntu LTS release. The required
packages are Docker Engine, Docker CLI, containerd, Buildx, and the Compose
plugin. Do not use an unverified third-party installer. Confirm with:

```bash
docker version
docker compose version
```

### Environment and DNS

Edit `/etc/seo-sensei/seo-sensei.env` without printing it. Set
`APP_ENV=production` and `CONTAINER_APP_ENV=production`, real random values for
`API_ACCESS_TOKEN` and `DASHBOARD_API_ACCESS_TOKEN`, and the optional
`GEMINI_API_KEY`. Set `APP_DOMAIN` and `API_DOMAIN` to the public hostnames,
`ACME_EMAIL` to the certificate contact, and keep
`TRUSTED_PROXY_NETWORKS=172.30.0.2/32` unless the Compose network is
deliberately changed. Set `ALLOWED_CORS_ORIGINS` to the exact dashboard and
extension origins that need API access; never use `*`.

Create DNS A records pointing both hostnames to the EC2 public address:

```text
app.example.com  A  <EC2 public address>
api.example.com  A  <EC2 public address>
```

DNS records, the EC2 address, SSH key, security group, and secrets are operator
actions and are not stored in Git.

### Deploy and verify

The repository provides `scripts/deploy.sh`. It validates the environment file
without sourcing or printing it, validates Compose, pulls Caddy, builds the API
and dashboard production images, starts the stack, waits for API/dashboard/Caddy
health, and prints service status:

```bash
cd /opt/seo-sensei
ENV_FILE=/etc/seo-sensei/seo-sensei.env ./scripts/deploy.sh
```

To update a clean checkout from `origin/main`, explicitly opt in:

```bash
UPDATE_SOURCE=true ENV_FILE=/etc/seo-sensei/seo-sensei.env ./scripts/deploy.sh
```

The script refuses to update a dirty working tree. It never enables Uvicorn
reload, Streamlit development mode, shell tracing, or public API/dashboard
ports. Public HTTPS checks can be enabled after DNS and certificates are ready:

```bash
VERIFY_PUBLIC_URLS=true ENV_FILE=/etc/seo-sensei/seo-sensei.env ./scripts/deploy.sh
```

Verify the public endpoints manually as well:

```bash
curl -I http://api.example.com/health       # should redirect to HTTPS
curl https://api.example.com/health
curl https://api.example.com/ready
```

The API health endpoints are public and lightweight. Analysis remains bearer
authenticated; an unauthenticated analysis request should return 401. Use a
controlled test target for an authenticated analysis smoke test rather than
making a production deployment crawl an arbitrary site solely for validation.

The dashboard is available at `https://app.example.com`. Configure the
extension with `https://api.example.com` and its operator-managed token.

### TLS, persistence, and recovery

Caddy terminates TLS, redirects HTTP to HTTPS, supports Streamlit websocket
traffic, and obtains certificates automatically once DNS and ports 80/443 are
correct. The named `caddy_data` and `caddy_config` volumes persist certificate
and Caddy state across container recreation. Back up those two Docker volumes
as infrastructure state if recovery of existing ACME state matters; the API and
dashboard have no application data that requires backup.

All services use `restart: unless-stopped`, so Docker restart policy recovers
them after a daemon or EC2 reboot. The host should have Docker enabled at boot.
Test recovery with `docker compose restart` and, during a maintenance window,
an EC2 reboot. If the API fails readiness, Compose health output and JSON
container logs identify the failing service without exposing secrets.

### Implemented, operator actions, and future work

Implemented in this repository: production Compose, private API/dashboard
services, Caddy HTTPS topology, health/readiness probes, non-root containers,
restart policies, persistent Caddy volumes, and the deployment helper.

Operator actions: create the EC2 instance and security group, install Docker,
configure SSH, create DNS records, generate secrets, set the environment file
permissions, and verify public TLS.

Future infrastructure work: infrastructure-as-code, a registry/prebuilt-image
pipeline, managed secret storage, autoscaling, load balancing, centralized
metrics/logs, and distributed rate limiting. The current limiter remains local
to the single API process/container.
