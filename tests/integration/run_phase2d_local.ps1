$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$webRoot = Join-Path $repoRoot "web"
$projectName = "seo-sensei-p2d-$PID"
$composeArgs = @("compose", "--project-name", $projectName, "-f", "compose.integration.yaml")
$tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$taskTemp = Join-Path $tempRoot "seo-sensei-phase2d-$PID"
$caPem = Join-Path $taskTemp "caddy-root.pem"
$caCer = Join-Path $taskTemp "caddy-root.cer"
$certificate = $null
$certificateAdded = $false
$stackStarted = $false
$repoLocationPushed = $false

function Invoke-CheckedDocker([string[]] $Arguments) {
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Docker command failed with exit code $LASTEXITCODE." }
}

function Test-PortAvailable([int] $Port) {
    $client = [Net.Sockets.TcpClient]::new()
    try {
        try { $operation = $client.BeginConnect("127.0.0.1", $Port, $null, $null) }
        catch { return $true }
        if ($operation.AsyncWaitHandle.WaitOne(500)) {
            try { $client.EndConnect($operation); return $false }
            catch { return $true }
        }
        return $true
    } finally {
        $client.Dispose()
    }
}

if (-not (Test-PortAvailable 8443)) { throw "Port 8443 is already in use; the isolated harness will not bind it." }
if (-not (Test-Path (Join-Path $webRoot "node_modules"))) { throw "Install the web dependencies with npm ci before running this harness." }
New-Item -ItemType Directory -Path $taskTemp | Out-Null
$resolvedTaskTemp = [IO.Path]::GetFullPath($taskTemp)
if (-not $resolvedTaskTemp.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The temporary workspace is outside the system temporary directory."
}

$randomBytes = [byte[]]::new(32)
$randomGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
$randomGenerator.GetBytes($randomBytes)
$randomGenerator.Dispose()
$env:PHASE2D_TEST_PASSWORD = [Convert]::ToBase64String($randomBytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
$env:PHASE2D_TEST_USERNAME = "phase2d-reviewer"
$env:PHASE2D_BASE_URL = "https://seo-sensei.localhost:8443"
$env:PHASE2D_API_BASE_URL = "https://seo-sensei-api.localhost:8443"

try {
    Push-Location $repoRoot
    $repoLocationPushed = $true
    Invoke-CheckedDocker ($composeArgs + @("config", "--quiet"))
    $stackStarted = $true
    Invoke-CheckedDocker ($composeArgs + @("up", "--build", "--detach"))

    $apiIdArgs = $composeArgs + @("ps", "-q", "api")
    $apiId = (& docker @apiIdArgs).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $apiId) { throw "The isolated API container is unavailable." }
    $apiPorts = & docker inspect --format '{{json .NetworkSettings.Ports}}' $apiId
    if ($LASTEXITCODE -ne 0) { throw "Could not inspect the integration API port mapping." }
    if ($apiPorts -match '"HostPort"') { throw "The integration API unexpectedly publishes a host port." }

    $caddyIdArgs = $composeArgs + @("ps", "-q", "caddy")
    $caddyId = (& docker @caddyIdArgs).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $caddyId) { throw "The isolated Caddy container is unavailable." }
    Invoke-CheckedDocker @("cp", "${caddyId}:/data/caddy/pki/authorities/local/root.crt", $caPem)
    $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::CreateFromPem([IO.File]::ReadAllText($caPem))
    [IO.File]::WriteAllBytes($caCer, $certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert))
    Import-Certificate -FilePath $caCer -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
    $certificateAdded = $true
    $env:NODE_EXTRA_CA_CERTS = $caPem

    $apiHost = "seo-sensei-api.localhost"
    $extensionOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
    $preflightHeaders = & curl.exe --silent --show-error --ssl-no-revoke --resolve "${apiHost}:8443:127.0.0.1" --cacert $caPem `
        --output NUL --dump-header - --write-out "`n%{http_code}" --request OPTIONS `
        --header "Origin: $extensionOrigin" --header "Access-Control-Request-Method: POST" `
        --header "Access-Control-Request-Headers: authorization,content-type" "https://${apiHost}:8443/analyse-url"
    if ($LASTEXITCODE -ne 0 -or $preflightHeaders -notmatch '(?im)^access-control-allow-origin:\s*chrome-extension://abcdefghijklmnopabcdefghijklmnop\s*$' -or $preflightHeaders -notmatch '(?m)^200\s*$') {
        throw "The existing extension CORS preflight did not return its configured origin and HTTP 200."
    }
    $originBody = Join-Path $taskTemp "origin-rejected.json"
    $appHost = "seo-sensei.localhost"
    $originStatus = & curl.exe --silent --show-error --ssl-no-revoke --resolve "${appHost}:8443:127.0.0.1" --cacert $caPem `
        --output $originBody --write-out "%{http_code}" --request POST --header "Origin: https://attacker.example" `
        --header "Content-Type: application/json" --data '{"url":"https://phase2d.test/pages/noindex"}' `
        "https://${appHost}:8443/api/browser/v1/analyse-url"
    if ($LASTEXITCODE -ne 0 -or $originStatus -ne "403" -or (Get-Content -LiteralPath $originBody -Raw) -notmatch '"code":"origin_rejected"') {
        throw "A foreign Origin was not rejected at the app-domain browser namespace."
    }
    $legacyStatus = & curl.exe --silent --show-error --ssl-no-revoke --resolve "${apiHost}:8443:127.0.0.1" --cacert $caPem `
        --output NUL --write-out "%{http_code}" --request POST --header "Origin: $extensionOrigin" `
        --header "Content-Type: application/json" --data "{}" "https://${apiHost}:8443/analyse-url"
    if ($LASTEXITCODE -ne 0 -or $legacyStatus -ne "401") {
        throw "The API domain did not preserve the unauthenticated legacy bearer-route rejection."
    }

    Push-Location $webRoot
    try {
        npm run test:e2e:integration
        if ($LASTEXITCODE -ne 0) { throw "HTTPS browser integration tests failed with exit code $LASTEXITCODE." }
    } finally {
        Pop-Location
    }
} finally {
    if ($certificateAdded -and $certificate) {
        & certutil.exe -user -delstore Root $certificate.Thumbprint | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Warning "Could not remove the task-owned local CA from the current-user trust store." }
        $remaining = Get-ChildItem Cert:\CurrentUser\Root | Where-Object Thumbprint -eq $certificate.Thumbprint
        if ($remaining) { Write-Warning "The task-owned local CA remains in the current-user trust store." }
    }
    if ($stackStarted) {
        $downArgs = $composeArgs + @("down", "--volumes", "--remove-orphans")
        & docker @downArgs
        if ($LASTEXITCODE -ne 0) { Write-Warning "The isolated Compose stack did not shut down cleanly." }
    }
    if (Test-Path -LiteralPath $resolvedTaskTemp) {
        if (-not $resolvedTaskTemp.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove a path outside the temporary directory."
        }
        Remove-Item -LiteralPath $resolvedTaskTemp -Recurse -Force
    }
    if ($repoLocationPushed) { Pop-Location }
}
