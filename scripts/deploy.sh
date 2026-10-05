#!/usr/bin/env bash

# Idempotent single-host deployment for a Linux VM + Docker Compose installation.
# The script intentionally never sources or prints the environment file.

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env}"
UPDATE_SOURCE="${UPDATE_SOURCE:-false}"
VERIFY_PUBLIC_URLS="${VERIFY_PUBLIC_URLS:-false}"
export ENV_FILE

COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${ROOT_DIR}/compose.yaml")

fail() {
    printf 'Deployment failed: %s\n' "$1" >&2
    exit 1
}

read_env_value() {
    local key="$1"
    awk -F= -v wanted="$key" '$1 == wanted {sub(/^[^=]*=/, ""); print; exit}' "${ENV_FILE}"
}

require_env_value() {
    local key="$1"
    if ! awk -F= -v wanted="$key" '$1 == wanted && $0 !~ /^[[:space:]]*#/ {value=$0; sub(/^[^=]*=/, "", value); gsub(/^[[:space:]]+|[[:space:]]+$/, "", value); if (value != "" && value != "\"\"") found=1} END {exit !found}' "${ENV_FILE}"; then
        fail "${key} is missing or empty in ${ENV_FILE}"
    fi
}

wait_for_health() {
    local service="$1"
    local container_id
    local status
    local deadline=$((SECONDS + 180))

    while (( SECONDS < deadline )); do
        container_id="$("${COMPOSE[@]}" ps -q "${service}")"
        if [[ -n "${container_id}" ]]; then
            status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}" 2>/dev/null || true)"
            case "${status}" in
                healthy)
                    printf '%s is healthy.\n' "${service}"
                    return 0
                    ;;
                unhealthy)
                    "${COMPOSE[@]}" logs --tail=40 "${service}" >&2 || true
                    fail "${service} became unhealthy"
                    ;;
            esac
        fi
        sleep 3
    done

    "${COMPOSE[@]}" ps >&2 || true
    fail "timed out waiting for ${service}"
}

cd "${ROOT_DIR}"
[[ -f "${ENV_FILE}" ]] || fail "environment file ${ENV_FILE} does not exist"
command -v docker >/dev/null 2>&1 || fail "Docker is not installed or is not on PATH"
docker info >/dev/null 2>&1 || fail "Docker daemon is not available"

for key in APP_ENV CONTAINER_APP_ENV API_ACCESS_TOKEN DASHBOARD_API_ACCESS_TOKEN APP_DOMAIN API_DOMAIN ACME_EMAIL ALLOWED_CORS_ORIGINS TRUSTED_PROXY_NETWORKS; do
    require_env_value "${key}"
done

[[ "$(read_env_value CONTAINER_APP_ENV)" == "production" ]] || fail "CONTAINER_APP_ENV must be production"
chmod 600 "${ENV_FILE}"

if [[ "${UPDATE_SOURCE}" == "true" ]]; then
    [[ -z "$(git status --porcelain)" ]] || fail "working tree contains local changes; refusing to update source"
    git pull --ff-only origin main
fi

"${COMPOSE[@]}" config --quiet
"${COMPOSE[@]}" pull caddy
"${COMPOSE[@]}" build --pull api dashboard
"${COMPOSE[@]}" up -d --remove-orphans

wait_for_health api
wait_for_health dashboard
wait_for_health caddy

if [[ "${VERIFY_PUBLIC_URLS}" == "true" ]]; then
    api_domain="$(read_env_value API_DOMAIN)"
    app_domain="$(read_env_value APP_DOMAIN)"
    [[ -n "${api_domain}" && -n "${app_domain}" ]] || fail "public domains are not configured"
    curl --fail --silent --show-error --location --max-time 20 "https://${api_domain}/health" >/dev/null
    curl --fail --silent --show-error --location --max-time 20 "https://${app_domain}/" >/dev/null
    printf 'Public API and dashboard checks passed.\n'
fi

"${COMPOSE[@]}" ps
printf 'SEO-Sensei deployment completed.\n'
