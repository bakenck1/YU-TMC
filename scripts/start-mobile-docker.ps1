[CmdletBinding()]
param(
  [switch]$NoBuild
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$existingSubst = @(subst.exe)
$driveName = @("Y:", "X:", "W:") |
  Where-Object { $candidate = $_; -not ($existingSubst | Where-Object { $_ -like "$candidate*" }) } |
  Select-Object -First 1

if (-not $driveName) {
  throw "No free temporary drive letter is available (checked Y:, X:, W:)."
}

subst.exe $driveName $repositoryRoot
if ($LASTEXITCODE -ne 0) {
  throw "Could not map the repository to temporary drive $driveName."
}

try {
  Push-Location -LiteralPath "$driveName\"
  try {
    $arguments = @("compose")
    if (Test-Path -LiteralPath ".env.local") {
      $arguments += @("--env-file", ".env.local")
    }
    $arguments += @("-f", "docker-compose.mobile.yml", "up")
    if (-not $NoBuild) {
      $arguments += "--build"
    }
    $arguments += "-d"
    & docker @arguments
    if ($LASTEXITCODE -ne 0) {
      throw "Docker Compose failed with exit code $LASTEXITCODE."
    }
    docker compose -f docker-compose.mobile.yml ps --all
    if ($LASTEXITCODE -ne 0) {
      throw "Could not read Docker Compose service status."
    }
  } finally {
    Pop-Location
  }
} finally {
  subst.exe $driveName /D
}

$ready = $false
for ($attempt = 1; $attempt -le 30; $attempt += 1) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:3000/login" -TimeoutSec 3
    if ($response.StatusCode -eq 200) {
      $ready = $true
      break
    }
  } catch {
    if ($attempt -eq 30) { throw }
  }
  Start-Sleep -Seconds 1
}

if (-not $ready) {
  throw "The application container started but did not become HTTP-ready."
}

Write-Host "YU Inventory is ready:"
Write-Host "  Application: https://172.20.10.2/login"
Write-Host "  Local health check only: http://127.0.0.1:3000/login"
