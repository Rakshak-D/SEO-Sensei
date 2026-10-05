# OCI Always Free deployment

This is the preferred $0-first deployment path for SEO-Sensei. It runs the
existing production Compose stack on one Oracle Cloud Infrastructure (OCI)
Always Free ARM64 VM:

```text
Internet → OCI security rules → Ubuntu LTS ARM64 VM → Docker Compose → Caddy
                                                               ├─ dashboard:8501
                                                               └─ api:8000
```

Only Caddy is public. The API and dashboard use private Docker networking. The
dashboard calls `http://api:8000` inside that network, while browsers and the
extension use the public API hostname.

## Free-tier scope and prerequisites

OCI Always Free availability depends on account, home region, capacity, and
Oracle's current published terms. The target is an Ampere A1 ARM64 allocation
equivalent to up to 2 OCPUs and 12 GB RAM, with Always Free block storage and
outbound transfer subject to the published limits. Create the VM in the
account's home region using an Ubuntu LTS ARM64 image.

The application does not require an OCI API role or access keys. Keep OCI
operator credentials outside the repository and application containers.

Potentially non-free items include a custom domain, usage beyond OCI Always
Free limits, optional Gemini usage beyond its eligible free quota, and paid
third-party tunnel or DNS services. Gemini quotas and availability are not
unlimited or guaranteed by this project.

## VM sizing and ARM64 compatibility

Use an A1 shape with enough of the Always Free allocation for the API,
Streamlit, Caddy, Docker overhead, and bounded crawler/Gemini concurrency. Do
not raise application limits merely because memory is available.

The runtime images use multi-architecture base images:

- `python:3.11.11-slim-bookworm` for API and dashboard.
- `caddy:2.10.2-alpine` for ingress.

The Python dependencies are installed during image build and the application
contains no x86-specific native code. Build and verify on the target platform:

```bash
docker buildx build --platform linux/arm64 --load --file Dockerfile.api --tag seo-sensei-api:arm64 .
docker buildx build --platform linux/arm64 --load --file Dockerfile.dashboard --tag seo-sensei-dashboard:arm64 .
docker run --rm --platform linux/arm64 seo-sensei-api:arm64 python -c "import httpx, google.genai; print('runtime imports ok')"
```

If Buildx cannot load ARM64 images on the operator workstation, run these on
the A1 VM. A local x86 build is not proof of ARM64 compatibility.

## OCI networking and SSH

Create a security list or network security group with only:

- TCP 80 from the internet for HTTP redirect and ACME validation.
- TCP 443 from the internet for HTTPS.
- TCP 22 only from the administrator's restricted public IP/range.

Do not expose 8000, 8501, Docker's socket, or arbitrary high ports. Use
key-based SSH; do not commit private keys or enable password authentication.
The VM needs outbound DNS and HTTPS for updates, image pulls, Caddy ACME,
SafeFetcher requests, and optional Gemini requests.

## Host setup

Install Ubuntu updates and Docker Engine plus the official Compose plugin using
the current official Docker instructions for the selected Ubuntu release. Do
not use an unverified shell installer. Confirm:

```bash
docker version
docker compose version
```

Use a standard deployment directory and keep the production environment outside
Git:

```bash
sudo install -d -m 0755 /opt/seo-sensei /etc/seo-sensei
sudo chown -R "$USER":"$USER" /opt/seo-sensei
git clone <repository-url> /opt/seo-sensei
cp /opt/seo-sensei/.env.example /etc/seo-sensei/seo-sensei.env
sudo chmod 600 /etc/seo-sensei/seo-sensei.env
```

Edit the environment file without printing it. Set `APP_ENV=production`,
`CONTAINER_APP_ENV=production`, random matching API/dashboard tokens,
`APP_DOMAIN`, `API_DOMAIN`, `ACME_EMAIL`, exact CORS origins, and
`TRUSTED_PROXY_NETWORKS=172.30.0.2/32` unless the Compose network changes.
Set `GEMINI_API_KEY` only when AI features are enabled. Deterministic analysis
works without the key.

## DNS and TLS

For normal production HTTPS, create DNS A records pointing both hostnames to
the VM public address:

```text
app.example.com  A  <VM public address>
api.example.com  A  <VM public address>
```

Once DNS resolves and ports 80/443 are reachable, Caddy obtains certificates,
redirects HTTP to HTTPS, and proxies the configured hosts. Set the extension's
API base URL to `https://api.example.com` and open the dashboard at
`https://app.example.com`, replacing the examples.

The custom domain is not included in OCI Always Free. Do not expose bearer-token
API traffic over plain HTTP on a public IP.

For demo/testing without a domain, use an operator-reviewed HTTPS tunnel that
terminates TLS and forwards privately to Caddy or the local service. Treat a
temporary tunnel URL as an unstable demo address, do not use it for production
credentials, and do not add tunnel tooling to the application. A bare public
IP over HTTP is not an acceptable production substitute.

## Deploy and verify

From the checkout, use the existing host-agnostic deployment helper:

```bash
cd /opt/seo-sensei
ENV_FILE=/etc/seo-sensei/seo-sensei.env ./scripts/deploy.sh
```

The script validates settings and Compose, builds API/dashboard images, pulls
Caddy, starts the stack, waits for health, and prints status. It does not print
secrets, enable reload/debug servers, or publish internal ports. To update a
clean checkout first:

```bash
UPDATE_SOURCE=true ENV_FILE=/etc/seo-sensei/seo-sensei.env ./scripts/deploy.sh
```

After DNS and certificates are ready, optionally verify public URLs:

```bash
VERIFY_PUBLIC_URLS=true ENV_FILE=/etc/seo-sensei/seo-sensei.env ./scripts/deploy.sh
```

Check `/health` and `/ready` through the API hostname. Confirm an unauthenticated
analysis receives 401, then use a controlled target for one authenticated smoke
test. Do not use a production deployment as an arbitrary crawl test.

## Restart and recovery

The API and dashboard are stateless. Caddy's `caddy_data` and `caddy_config`
named volumes preserve certificate and proxy state across recreation. Back up
those volumes only if retaining ACME state matters; there is no application
database or generated data to back up.

All services use `restart: unless-stopped`. Verify recovery with:

```bash
docker compose --env-file /etc/seo-sensei/seo-sensei.env -f compose.yaml restart
docker compose --env-file /etc/seo-sensei/seo-sensei.env -f compose.yaml ps
```

The in-memory rate limiter is local to the one API process. Horizontal scaling
later would require shared state and is outside this free single-VM plan.

## Implemented versus operator actions

Implemented: ARM64-capable container definitions, private API/dashboard
services, Caddy HTTPS topology, health/readiness probes, non-root containers,
restart policies, persistent Caddy volumes, and the deployment helper.

Operator actions: create the OCI account/VM, select the home region and A1
shape, configure networking and SSH, install Docker, create DNS records, set
secrets with restrictive permissions, and validate live TLS.

Future infrastructure: infrastructure-as-code, image registry, managed secret
storage, autoscaling, load balancing, distributed rate limiting, and automatic
deployment. None is required for this first $0-first deployment.
